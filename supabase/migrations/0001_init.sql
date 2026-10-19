-- =============================================================================
-- ChatHel - schema Postgres P0 (multi-hotel, RLS)
-- Coerente con /home/claude/docs/02-architettura.md
--
-- Requisiti: PostgreSQL 15+ (usa ON DELETE SET NULL (colonna) e security_invoker).
-- Target: Supabase (regione UE, Francoforte). Eseguibile anche su Postgres
-- "liscio": la sezione 0 crea uno shim minimo di auth/ruoli solo se mancano.
--
-- Principi:
--  1. Ogni tabella con dati di tenant ha hotel_id NOT NULL e RLS attiva.
--  2. Le chiavi esterne sono composite (id, hotel_id): un record non puo' mai
--     puntare a un record di un altro hotel, nemmeno per errore del codice.
--  3. L'ospite (utente anonimo Supabase) vede solo se ha un soggiorno attivo e
--     non scaduto: la scadenza e' applicata dalle policy, non da un cron.
--  4. Le operazioni sensibili (bonus, prenotazioni, accesso) passano da funzioni
--     RPC atomiche; l'ospite non ha INSERT diretto su quelle tabelle.
--  5. Al check-out i dati personali vengono cancellati (purge_guest); restano
--     solo righe anonime per le statistiche e per la fatturazione dei bonus.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Shim ambiente (no-op su Supabase)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists auth;
-- Su Supabase lo schema auth e la tabella auth.users esistono gia' e sono di sistema (l'editor SQL non puo' crearvi nulla):
-- la tabella si crea SOLO se manca (database di prova senza Supabase).
do $authusers$
begin
  if to_regclass('auth.users') is null then
    create table auth.users (
      id            uuid primary key default gen_random_uuid(),
      email         text,
      is_anonymous  boolean not null default false,
      created_at    timestamptz not null default now()
    );
  end if;
end $authusers$;

do $shim$
begin
  if to_regprocedure('auth.jwt()') is null then
    execute $f$create function auth.jwt() returns jsonb language sql stable as
      $b$select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)$b$$f$;
  end if;
  if to_regprocedure('auth.uid()') is null then
    execute $f$create function auth.uid() returns uuid language sql stable as
      $b$select nullif(auth.jwt() ->> 'sub', '')::uuid$b$$f$;
  end if;
end $shim$;

-- su Supabase questi permessi ci sono gia' e non sono nostri da modificare
do $authgrant$ begin
  grant usage on schema auth to anon, authenticated, service_role;
exception when insufficient_privilege then null;
end $authgrant$;

-- -----------------------------------------------------------------------------
-- 1. Schema applicativo e tipi
-- -----------------------------------------------------------------------------
create schema if not exists app;  -- funzioni di supporto, NON esposte dall'API REST
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

create type public.app_role           as enum ('hotel_admin', 'reception', 'bartender');
create type public.hotel_status       as enum ('active', 'suspended');
create type public.stay_status        as enum ('active', 'ended', 'revoked');
create type public.bonus_status       as enum ('issued', 'redeemed', 'expired', 'void');
create type public.redemption_status  as enum ('pending', 'redeemed', 'expired', 'cancelled');
create type public.booking_status     as enum ('confirmed', 'cancelled', 'attended', 'no_show');
create type public.attendance_status  as enum ('going', 'attended', 'cancelled');
create type public.facility_kind      as enum ('spa', 'pool', 'gamesroom', 'other');
create type public.slot_status        as enum ('open', 'closed');
create type public.conversation_status as enum ('ai', 'handoff_pending', 'operator', 'closed');
create type public.message_role       as enum ('guest', 'assistant', 'operator', 'system');
create type public.handoff_reason     as enum ('kb_gap', 'guest_request', 'complaint', 'safety', 'other');
create type public.notification_kind  as enum ('announcement', 'event_reminder', 'booking', 'bonus', 'handoff_reply', 'system');
create type public.bonus_funding      as enum ('hotel', 'chathel_grant');

-- Trigger generici ------------------------------------------------------------
create function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function app.forbid_hotel_change() returns trigger
language plpgsql as $$
begin
  if new.hotel_id is distinct from old.hotel_id then
    raise exception 'hotel_id e'' immutabile' using errcode = 'CH900';
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Tabelle
-- -----------------------------------------------------------------------------

-- 2.1 hotels -------------------------------------------------------------------
create table public.hotels (
  id                           uuid primary key default gen_random_uuid(),
  slug                         text not null unique
                                 check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name                         text not null check (length(name) between 2 and 120),
  status                       public.hotel_status not null default 'active',
  timezone                     text not null default 'Europe/Rome',
  default_locale               text not null default 'it' check (default_locale in ('it','en','de')),
  supported_locales            text[] not null default array['it','en','de'],
  logo_url                     text,
  -- stagione e soggiorno
  season_year                  smallint not null default extract(year from now())::smallint,
  season_start                 date,
  season_end                   date,
  checkout_time                time not null default '11:00',
  max_stay_days                int  not null default 21 check (max_stay_days between 1 and 60),
  -- bonus di benvenuto
  bonus_enabled                boolean not null default true,
  bonus_label                  text not null default 'Caffe'' di benvenuto',
  bonus_value_cents            int  not null default 0 check (bonus_value_cents >= 0),
  bonus_season_cap             int  not null default 0 check (bonus_season_cap >= 0), -- 0 = nessun bonus
  bonus_funding                public.bonus_funding not null default 'hotel',
  bonus_dedupe_mode            text not null default 'none' check (bonus_dedupe_mode in ('none','room_name')),
  bonus_qr_ttl_seconds         int  not null default 90 check (bonus_qr_ttl_seconds between 30 and 300),
  -- prenotazioni
  max_bookings_per_guest_day   int  not null default 2 check (max_bookings_per_guest_day between 1 and 10),
  booking_cancel_cutoff_minutes int not null default 60 check (booking_cancel_cutoff_minutes >= 0),
  -- QR dell'hotel: si salva solo l'hash SHA-256; il token in chiaro esiste solo nel QR stampato
  qr_token_hash                bytea,
  qr_token_prev_hash           bytea,
  qr_prev_valid_until          timestamptz,
  qr_rotated_at                timestamptz,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  check (season_start is null or season_end is null or season_start <= season_end)
);
create trigger hotels_touch before update on public.hotels
  for each row execute function app.touch_updated_at();

-- 2.2 hotel_staff ----------------------------------------------------------------
create table public.hotel_staff (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          public.app_role not null,
  display_name  text not null check (length(display_name) between 1 and 60),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (hotel_id, user_id),
  unique (id, hotel_id)
);
create index hotel_staff_user_idx on public.hotel_staff(user_id) where active;
create trigger hotel_staff_hotel_lock before update on public.hotel_staff
  for each row execute function app.forbid_hotel_change();

-- 2.3 guests ------------------------------------------------------------------------
-- Una riga per utente anonimo. display_name e' solo nome/nickname: mai cognome o camera.
create table public.guests (
  id                    uuid primary key default gen_random_uuid(),
  hotel_id              uuid not null references public.hotels(id) on delete cascade,
  auth_user_id          uuid not null unique references auth.users(id) on delete cascade,
  display_name          text not null check (length(btrim(display_name)) between 2 and 24),
  locale                text not null default 'it' check (locale in ('it','en','de')),
  is_adult              boolean not null default false,   -- dichiarato; serve alle funzioni sociali (P1)
  push_subscription     jsonb,
  notifications_seen_at timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  unique (id, hotel_id)
);
create index guests_hotel_idx on public.guests(hotel_id);
create trigger guests_hotel_lock before update on public.guests
  for each row execute function app.forbid_hotel_change();

-- 2.4 stays ---------------------------------------------------------------------------
-- Il soggiorno e' la finestra di accesso. Dopo la cancellazione dell'ospite resta
-- come riga anonima (guest_id = null) per le statistiche.
create table public.stays (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references public.hotels(id) on delete cascade,
  guest_id       uuid,
  checkin_date   date not null,
  checkout_date  date not null,
  started_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  status         public.stay_status not null default 'active',
  ended_at       timestamptz,
  end_reason     text check (end_reason in ('expired','guest_request','hotel_closed')),
  check (checkout_date >= checkin_date),
  check (expires_at > started_at and expires_at <= started_at + interval '61 days'),
  unique (id, hotel_id),
  foreign key (guest_id, hotel_id) references public.guests(id, hotel_id) on delete set null (guest_id)
);
create unique index stays_one_active_per_guest on public.stays(guest_id) where status = 'active';
create index stays_hotel_status_idx on public.stays(hotel_id, status, expires_at);
create trigger stays_hotel_lock before update on public.stays
  for each row execute function app.forbid_hotel_change();

-- 2.5 events ------------------------------------------------------------------------------
-- title/description sono jsonb per lingua: {"it":"...","en":"...","de":"..."}
create table public.events (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references public.hotels(id) on delete cascade,
  title        jsonb not null check (jsonb_typeof(title) = 'object'),
  description  jsonb check (description is null or jsonb_typeof(description) = 'object'),
  location     text,
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  capacity     int check (capacity is null or capacity > 0),
  published    boolean not null default false,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  unique (id, hotel_id)
);
create index events_hotel_start_idx on public.events(hotel_id, starts_at);
create trigger events_touch before update on public.events for each row execute function app.touch_updated_at();
create trigger events_hotel_lock before update on public.events for each row execute function app.forbid_hotel_change();

-- 2.6 event_attendance -----------------------------------------------------------------------
create table public.event_attendance (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references public.hotels(id) on delete cascade,
  event_id       uuid not null,
  guest_id       uuid,
  status         public.attendance_status not null default 'going',
  created_at     timestamptz not null default now(),
  checked_in_at  timestamptz,
  unique (event_id, guest_id),
  foreign key (event_id, hotel_id) references public.events(id, hotel_id) on delete cascade,
  foreign key (guest_id, hotel_id) references public.guests(id, hotel_id) on delete set null (guest_id)
);
create index event_attendance_event_idx on public.event_attendance(event_id, status);
create index event_attendance_guest_idx on public.event_attendance(guest_id) where guest_id is not null;
create trigger event_attendance_hotel_lock before update on public.event_attendance
  for each row execute function app.forbid_hotel_change();

-- 2.7 facilities -------------------------------------------------------------------------------
create table public.facilities (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references public.hotels(id) on delete cascade,
  kind              public.facility_kind not null,
  name              jsonb not null check (jsonb_typeof(name) = 'object'),
  description       jsonb check (description is null or jsonb_typeof(description) = 'object'),
  default_capacity  int not null default 4 check (default_capacity > 0),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (id, hotel_id)
);
create index facilities_hotel_idx on public.facilities(hotel_id) where active;
create trigger facilities_hotel_lock before update on public.facilities
  for each row execute function app.forbid_hotel_change();

-- 2.8 slots -------------------------------------------------------------------------------------
-- Anti-overbooking: booked_count e' mantenuto da un trigger e protetto dal CHECK.
create table public.slots (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  facility_id   uuid not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  capacity      int not null check (capacity > 0),
  booked_count  int not null default 0,
  status        public.slot_status not null default 'open',
  check (ends_at > starts_at),
  constraint slots_no_overbooking check (booked_count >= 0 and booked_count <= capacity),
  unique (id, hotel_id),
  unique (facility_id, starts_at),
  foreign key (facility_id, hotel_id) references public.facilities(id, hotel_id) on delete cascade
);
create index slots_hotel_start_idx on public.slots(hotel_id, starts_at);
create trigger slots_hotel_lock before update on public.slots
  for each row execute function app.forbid_hotel_change();

-- 2.9 bookings -----------------------------------------------------------------------------------
create table public.bookings (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  slot_id       uuid not null,
  guest_id      uuid,
  party_size    int not null default 1 check (party_size between 1 and 10),
  status        public.booking_status not null default 'confirmed',
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  foreign key (slot_id, hotel_id)  references public.slots(id, hotel_id) on delete cascade,
  foreign key (guest_id, hotel_id) references public.guests(id, hotel_id) on delete set null (guest_id)
);
create unique index bookings_one_per_guest_slot on public.bookings(slot_id, guest_id)
  where status in ('confirmed','attended') and guest_id is not null;
create index bookings_slot_idx on public.bookings(slot_id);
create index bookings_guest_idx on public.bookings(guest_id) where guest_id is not null;
create index bookings_hotel_idx on public.bookings(hotel_id, created_at);
create trigger bookings_hotel_lock before update on public.bookings
  for each row execute function app.forbid_hotel_change();

-- Contatore posti: unico punto in cui booked_count cambia. L'UPDATE sulla riga
-- dello slot prende un lock di riga, quindi due prenotazioni concorrenti sullo
-- stesso slot si serializzano e il CHECK blocca la seconda se manca posto.
create function app.bookings_sync_slot() returns trigger
language plpgsql as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.status in ('confirmed','attended') then
    update public.slots set booked_count = booked_count - old.party_size where id = old.slot_id;
  end if;
  if tg_op in ('INSERT','UPDATE') and new.status in ('confirmed','attended') then
    update public.slots set booked_count = booked_count + new.party_size where id = new.slot_id;
  end if;
  return coalesce(new, old);
end $$;
create trigger bookings_sync_slot after insert or update of status, party_size, slot_id or delete
  on public.bookings for each row execute function app.bookings_sync_slot();

-- 2.10 welcome_bonuses -----------------------------------------------------------------------------
create table public.welcome_bonuses (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references public.hotels(id) on delete cascade,
  guest_id     uuid,
  stay_id      uuid,
  season_year  smallint not null,
  status       public.bonus_status not null default 'issued',
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  redeemed_at  timestamptz,
  dedupe_key   bytea,   -- HMAC(camera|check-in|nome) calcolato dal server con pepper; mai in chiaro
  unique (id, hotel_id),
  unique (guest_id),    -- un solo bonus per ospite (i NULL post-cancellazione non collidono)
  foreign key (guest_id, hotel_id) references public.guests(id, hotel_id) on delete set null (guest_id),
  foreign key (stay_id, hotel_id)  references public.stays(id, hotel_id)  on delete set null (stay_id)
);
create unique index welcome_bonuses_dedupe on public.welcome_bonuses(hotel_id, season_year, dedupe_key)
  where dedupe_key is not null and status in ('issued','redeemed');
create index welcome_bonuses_cap_idx on public.welcome_bonuses(hotel_id, season_year, status);
create trigger welcome_bonuses_hotel_lock before update on public.welcome_bonuses
  for each row execute function app.forbid_hotel_change();

-- Tetto stagionale applicato dal database, anche contro inserimenti diretti.
-- Il lock sulla riga dell'hotel serializza le emissioni concorrenti.
-- Il tetto conta emessi + riscattati; scaduti/annullati liberano posto.
create function app.enforce_bonus_cap() returns trigger
language plpgsql as $$
declare
  v_cap  int;
  v_used int;
begin
  select bonus_season_cap into v_cap from public.hotels where id = new.hotel_id for update;
  select count(*) into v_used from public.welcome_bonuses
   where hotel_id = new.hotel_id and season_year = new.season_year
     and status in ('issued','redeemed');
  if v_used >= coalesce(v_cap, 0) then
    raise exception 'bonus_cap_reached' using errcode = 'CH001';
  end if;
  return new;
end $$;
create trigger welcome_bonuses_cap before insert on public.welcome_bonuses
  for each row execute function app.enforce_bonus_cap();

-- 2.11 bonus_redemptions ------------------------------------------------------------------------------
-- Una riga per ogni QR monouso generato. Il token in chiaro non e' mai salvato.
create table public.bonus_redemptions (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references public.hotels(id) on delete cascade,
  bonus_id     uuid not null,
  token_hash   bytea not null unique,
  status       public.redemption_status not null default 'pending',
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  redeemed_at  timestamptz,
  redeemed_by  uuid references public.hotel_staff(id) on delete set null,
  foreign key (bonus_id, hotel_id) references public.welcome_bonuses(id, hotel_id) on delete cascade,
  check ((status = 'redeemed') = (redeemed_at is not null))
);
-- Garanzie finali anti-doppio-riscatto, indipendenti dal codice applicativo:
create unique index bonus_redemptions_one_redeemed on public.bonus_redemptions(bonus_id) where status = 'redeemed';
create unique index bonus_redemptions_one_pending  on public.bonus_redemptions(bonus_id) where status = 'pending';
create index bonus_redemptions_hotel_idx on public.bonus_redemptions(hotel_id, redeemed_at);
create trigger bonus_redemptions_hotel_lock before update on public.bonus_redemptions
  for each row execute function app.forbid_hotel_change();

-- 2.12 ai_knowledge --------------------------------------------------------------------------------------
create table public.ai_knowledge (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  category    text not null default 'general'
                check (category in ('general','hours','dining','spa','pool','rooms','transport','rules','contacts','events','other')),
  title       text not null check (length(title) between 1 and 160),
  content     text not null check (length(content) between 1 and 4000),
  locale      text not null default 'it' check (locale in ('it','en','de')),  -- lingua in cui e' scritta la voce
  active      boolean not null default true,
  sort_order  int not null default 0,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index ai_knowledge_hotel_idx on public.ai_knowledge(hotel_id, sort_order) where active;
create trigger ai_knowledge_touch before update on public.ai_knowledge for each row execute function app.touch_updated_at();
create trigger ai_knowledge_hotel_lock before update on public.ai_knowledge for each row execute function app.forbid_hotel_change();

-- 2.13 ai_conversations ----------------------------------------------------------------------------------
-- Dopo il check-out i messaggi vengono cancellati, la riga resta anonima (guest_id null)
-- con i contatori che alimentano "domande gestite dall'AI".
create table public.ai_conversations (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references public.hotels(id) on delete cascade,
  guest_id          uuid,
  status            public.conversation_status not null default 'ai',
  locale            text not null default 'it' check (locale in ('it','en','de')),
  started_at        timestamptz not null default now(),
  last_message_at   timestamptz not null default now(),
  closed_at         timestamptz,
  ai_answer_count   int not null default 0,
  handoff_at        timestamptz,
  handoff_reason    public.handoff_reason,
  handoff_topic     text check (handoff_topic is null or length(handoff_topic) <= 120), -- etichetta generica, senza dati personali
  assigned_to       uuid references public.hotel_staff(id) on delete set null,
  unique (id, hotel_id),
  foreign key (guest_id, hotel_id) references public.guests(id, hotel_id) on delete set null (guest_id)
);
create index ai_conversations_hotel_status_idx on public.ai_conversations(hotel_id, status, last_message_at desc);
create index ai_conversations_guest_idx on public.ai_conversations(guest_id) where guest_id is not null;
create trigger ai_conversations_hotel_lock before update on public.ai_conversations
  for each row execute function app.forbid_hotel_change();

-- Tabella aggiuntiva rispetto all'elenco minimo: i messaggi non stanno in un jsonb
-- perche' crescono in append e vanno cancellati in blocco al check-out.
create table public.ai_messages (
  id               bigint generated always as identity primary key,
  hotel_id         uuid not null references public.hotels(id) on delete cascade,
  conversation_id  uuid not null,
  role             public.message_role not null,
  content          text not null check (length(content) between 1 and 4000),
  staff_id         uuid references public.hotel_staff(id) on delete set null,
  tokens_in        int,
  tokens_out       int,
  created_at       timestamptz not null default now(),
  foreign key (conversation_id, hotel_id) references public.ai_conversations(id, hotel_id) on delete cascade
);
create index ai_messages_conv_idx on public.ai_messages(conversation_id, id);

-- 2.14 notifications ----------------------------------------------------------------------------------------
-- guest_id NULL = annuncio dell'hotel a tutti gli ospiti con soggiorno attivo (resta come storico).
-- guest_id valorizzato = notifica personale (cancellata al check-out).
create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references public.hotels(id) on delete cascade,
  guest_id       uuid,
  kind           public.notification_kind not null default 'announcement',
  title          jsonb not null check (jsonb_typeof(title) = 'object'),
  body           jsonb check (body is null or jsonb_typeof(body) = 'object'),
  url            text check (url is null or url ~ '^/[^/]'),   -- solo percorsi interni
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  push_sent_at   timestamptz,
  read_at        timestamptz,
  foreign key (guest_id, hotel_id) references public.guests(id, hotel_id) on delete cascade
);
create index notifications_hotel_idx on public.notifications(hotel_id, created_at desc);
create index notifications_guest_idx on public.notifications(guest_id, created_at desc) where guest_id is not null;
create trigger notifications_hotel_lock before update on public.notifications
  for each row execute function app.forbid_hotel_change();

-- 2.15 audit_log (aggiuntiva) -----------------------------------------------------------------------------------
-- Tracce per antiabuso e supporto. Mai dati personali dell'ospite nel campo meta.
create table public.audit_log (
  id             bigint generated always as identity primary key,
  hotel_id       uuid references public.hotels(id) on delete cascade,
  actor_user_id  uuid,
  action         text not null,
  entity         text,
  entity_id      uuid,
  meta           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index audit_log_hotel_idx on public.audit_log(hotel_id, created_at desc);
create index audit_log_action_idx on public.audit_log(actor_user_id, action, created_at desc);

-- -----------------------------------------------------------------------------
-- 3. Funzioni di supporto per le policy (schema app, SECURITY DEFINER)
-- -----------------------------------------------------------------------------

create function app.is_service() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
$$;

-- Id ospite dell'utente corrente, anche se il soggiorno e' scaduto
create function app.raw_guest_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select g.id from public.guests g where g.auth_user_id = auth.uid()
$$;

-- Id ospite SOLO se ha un soggiorno attivo e non scaduto (cuore dell'accesso a tempo)
create function app.my_guest_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select g.id
    from public.guests g
    join public.stays s on s.guest_id = g.id and s.hotel_id = g.hotel_id
    join public.hotels h on h.id = g.hotel_id
   where g.auth_user_id = auth.uid()
     and s.status = 'active' and s.expires_at > now()
     and h.status = 'active'
   limit 1
$$;

create function app.my_hotel_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select g.hotel_id from public.guests g where g.id = app.my_guest_id()
$$;

-- Hotel dove l'utente e' staff attivo con uno dei ruoli indicati (null = qualsiasi ruolo)
create function app.staff_hotel_ids(p_roles public.app_role[] default null) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select st.hotel_id
    from public.hotel_staff st
    join public.hotels h on h.id = st.hotel_id
   where st.user_id = auth.uid() and st.active and h.status = 'active'
     and (p_roles is null or st.role = any (p_roles))
$$;

create function app.my_staff_id(p_hotel uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select st.id from public.hotel_staff st
   where st.user_id = auth.uid() and st.hotel_id = p_hotel and st.active
   limit 1
$$;

create function app.audit(p_hotel uuid, p_action text, p_entity text, p_entity_id uuid, p_meta jsonb default '{}')
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_log(hotel_id, actor_user_id, action, entity, entity_id, meta)
  values (p_hotel, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_meta, '{}'::jsonb))
$$;

-- -----------------------------------------------------------------------------
-- 4. Row Level Security
-- -----------------------------------------------------------------------------
alter table public.hotels             enable row level security;
alter table public.hotel_staff        enable row level security;
alter table public.guests             enable row level security;
alter table public.stays              enable row level security;
alter table public.events             enable row level security;
alter table public.event_attendance   enable row level security;
alter table public.facilities         enable row level security;
alter table public.slots              enable row level security;
alter table public.bookings           enable row level security;
alter table public.welcome_bonuses    enable row level security;
alter table public.bonus_redemptions  enable row level security;
alter table public.ai_knowledge       enable row level security;
alter table public.ai_conversations   enable row level security;
alter table public.ai_messages        enable row level security;
alter table public.notifications      enable row level security;
alter table public.audit_log          enable row level security;

-- Privilegi di base: nessun accesso ad anon, accesso minimo a authenticated.
-- Le policy filtrano le righe, i GRANT sulle colonne filtrano i campi.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- hotels: i campi segreti (hash QR) non sono selezionabili da nessun client
grant select (id, slug, name, status, timezone, default_locale, supported_locales, logo_url,
              season_year, season_start, season_end, checkout_time, max_stay_days,
              bonus_enabled, bonus_label, bonus_value_cents, bonus_season_cap, bonus_funding,
              bonus_dedupe_mode, bonus_qr_ttl_seconds, max_bookings_per_guest_day,
              booking_cancel_cutoff_minutes, qr_rotated_at, created_at, updated_at)
  on public.hotels to authenticated;
-- Tetto, finanziamento, stagione e stato li decide ChatHel (service_role), non l'hotel
grant update (name, logo_url, default_locale, supported_locales, checkout_time, max_stay_days,
              bonus_enabled, bonus_label, bonus_dedupe_mode, bonus_qr_ttl_seconds,
              max_bookings_per_guest_day, booking_cancel_cutoff_minutes)
  on public.hotels to authenticated;

create policy hotels_select on public.hotels for select to authenticated
  using (id in (select app.staff_hotel_ids()) or id = (select app.my_hotel_id()));
create policy hotels_update on public.hotels for update to authenticated
  using (id in (select app.staff_hotel_ids(array['hotel_admin']::public.app_role[])))
  with check (id in (select app.staff_hotel_ids(array['hotel_admin']::public.app_role[])));

-- hotel_staff: ognuno vede la propria riga; l'admin gestisce lo staff del proprio hotel
grant select, insert, update, delete on public.hotel_staff to authenticated;
create policy staff_select_self on public.hotel_staff for select to authenticated
  using (user_id = (select auth.uid()));
create policy staff_select_admin on public.hotel_staff for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin']::public.app_role[])));
create policy staff_admin_write on public.hotel_staff for all to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin']::public.app_role[])))
  with check (hotel_id in (select app.staff_hotel_ids(array['hotel_admin']::public.app_role[])));

-- guests: l'ospite vede e modifica solo se stesso; il barista NON legge questa tabella
grant select on public.guests to authenticated;
grant update (display_name, locale, push_subscription, notifications_seen_at) on public.guests to authenticated;
create policy guests_select_self on public.guests for select to authenticated
  using (auth_user_id = (select auth.uid()));
create policy guests_select_staff on public.guests for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));
create policy guests_update_self on public.guests for update to authenticated
  using (id = (select app.my_guest_id()))
  with check (id = (select app.my_guest_id()));

-- stays
grant select on public.stays to authenticated;
create policy stays_select_self on public.stays for select to authenticated
  using (guest_id = (select app.raw_guest_id()));
create policy stays_select_staff on public.stays for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));

-- events
grant select, insert, update, delete on public.events to authenticated;
create policy events_select_guest on public.events for select to authenticated
  using (published and hotel_id = (select app.my_hotel_id()));
create policy events_select_staff on public.events for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));
create policy events_write_staff on public.events for all to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])))
  with check (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));

-- event_attendance: l'ospite aderisce tramite rsvp_event(); lo staff segna le presenze
grant select on public.event_attendance to authenticated;
grant update (status, checked_in_at) on public.event_attendance to authenticated;
create policy attendance_select_self on public.event_attendance for select to authenticated
  using (guest_id = (select app.my_guest_id()));
create policy attendance_select_staff on public.event_attendance for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));
create policy attendance_update_staff on public.event_attendance for update to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])))
  with check (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));

-- facilities
grant select, insert, update, delete on public.facilities to authenticated;
create policy facilities_select_guest on public.facilities for select to authenticated
  using (active and hotel_id = (select app.my_hotel_id()));
create policy facilities_select_staff on public.facilities for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));
create policy facilities_write_admin on public.facilities for all to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin']::public.app_role[])))
  with check (hotel_id in (select app.staff_hotel_ids(array['hotel_admin']::public.app_role[])));

-- slots: l'ospite vede disponibilita' (capacity/booked_count), mai chi ha prenotato
grant select, insert, update, delete on public.slots to authenticated;
create policy slots_select_guest on public.slots for select to authenticated
  using (status = 'open' and hotel_id = (select app.my_hotel_id()));
create policy slots_select_staff on public.slots for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));
create policy slots_write_staff on public.slots for all to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])))
  with check (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));

-- bookings: creazione/annullo ospite solo via RPC; lo staff aggiorna lo stato
grant select on public.bookings to authenticated;
grant update (status, cancelled_at) on public.bookings to authenticated;
create policy bookings_select_self on public.bookings for select to authenticated
  using (guest_id = (select app.my_guest_id()));
create policy bookings_select_staff on public.bookings for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));
create policy bookings_update_staff on public.bookings for update to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])))
  with check (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));

-- welcome_bonuses: sola lettura (nessuna scrittura dai client)
grant select on public.welcome_bonuses to authenticated;
create policy bonuses_select_self on public.welcome_bonuses for select to authenticated
  using (guest_id = (select app.my_guest_id()));
create policy bonuses_select_staff on public.welcome_bonuses for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));

-- bonus_redemptions: l'admin vede tutto; il barista vede solo i propri riscatti; l'ospite nulla
grant select on public.bonus_redemptions to authenticated;
create policy redemptions_select_admin on public.bonus_redemptions for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin']::public.app_role[])));
create policy redemptions_select_own_bartender on public.bonus_redemptions for select to authenticated
  using (redeemed_by in (select st.id from public.hotel_staff st where st.user_id = (select auth.uid())));

-- ai_knowledge: solo staff; l'AI la legge tramite ai_context()
grant select, insert, update, delete on public.ai_knowledge to authenticated;
create policy knowledge_staff on public.ai_knowledge for all to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])))
  with check (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));

-- ai_conversations
grant select on public.ai_conversations to authenticated;
grant insert (hotel_id, guest_id, locale) on public.ai_conversations to authenticated;
grant update (status, assigned_to, closed_at) on public.ai_conversations to authenticated;
create policy conv_select_self on public.ai_conversations for select to authenticated
  using (guest_id = (select app.my_guest_id()));
create policy conv_select_staff on public.ai_conversations for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));
create policy conv_insert_self on public.ai_conversations for insert to authenticated
  with check (guest_id = (select app.my_guest_id()) and hotel_id = (select app.my_hotel_id()));
create policy conv_update_staff on public.ai_conversations for update to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])))
  with check (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));

-- ai_messages: l'ospite scrive solo come 'guest', lo staff solo come 'operator';
-- i messaggi 'assistant' li inserisce solo il server (service_role), cosi' non sono falsificabili.
grant select, insert on public.ai_messages to authenticated;
create policy messages_select_self on public.ai_messages for select to authenticated
  using (exists (select 1 from public.ai_conversations c
                  where c.id = conversation_id and c.hotel_id = ai_messages.hotel_id
                    and c.guest_id = (select app.my_guest_id())));
create policy messages_select_staff on public.ai_messages for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));
create policy messages_insert_guest on public.ai_messages for insert to authenticated
  with check (role = 'guest' and staff_id is null
              and exists (select 1 from public.ai_conversations c
                           where c.id = conversation_id and c.hotel_id = ai_messages.hotel_id
                             and c.guest_id = (select app.my_guest_id())
                             and c.status <> 'closed'));
create policy messages_insert_operator on public.ai_messages for insert to authenticated
  with check (role = 'operator'
              and hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[]))
              and staff_id = (select app.my_staff_id(hotel_id)));

-- notifications
grant select, insert, update, delete on public.notifications to authenticated;
create policy notifications_select_guest on public.notifications for select to authenticated
  using (hotel_id = (select app.my_hotel_id())
         and (guest_id is null or guest_id = (select app.my_guest_id())));
create policy notifications_select_staff on public.notifications for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));
create policy notifications_insert_staff on public.notifications for insert to authenticated
  with check (guest_id is null
              and hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));
create policy notifications_delete_staff on public.notifications for delete to authenticated
  using (guest_id is null
         and hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (guest_id = (select app.my_guest_id()))
  with check (guest_id = (select app.my_guest_id()));
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- audit_log: lettura per l'admin dell'hotel; scrittura solo da funzioni
grant select on public.audit_log to authenticated;
create policy audit_select_admin on public.audit_log for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin']::public.app_role[])));

-- -----------------------------------------------------------------------------
-- 5. RPC (public, SECURITY DEFINER). Tutta la logica sensibile e' qui, atomica.
--    Codici d'errore applicativi (SQLSTATE):
--    CH001 bonus_cap_reached, CH002 slot_full, CH003 invalid_*, CH004 forbidden,
--    CH005 conflict (gia' prenotato/aderito), CH006 too_late, CH900 immutabile.
-- -----------------------------------------------------------------------------

-- 5.1 Pagina di atterraggio del QR: solo nome e logo, nessun segreto. Callable da anon.
create function public.public_hotel(p_slug text)
returns table (name text, logo_url text, default_locale text, supported_locales text[])
language sql stable security definer set search_path = public, pg_temp as $$
  select h.name, h.logo_url, h.default_locale, h.supported_locales
    from public.hotels h where h.slug = p_slug and h.status = 'active'
$$;
grant execute on function public.public_hotel(text) to anon, authenticated;

-- 5.2 Creazione soggiorno da QR. SOLO service_role: la chiama il server Next.js dopo
--     aver verificato captcha e rate limit e aver creato l'utente anonimo.
--     Il server calcola p_dedupe_key (HMAC con pepper), cosi' il client non puo' manometterlo.
create function public.start_stay(
  p_auth_user    uuid,
  p_slug         text,
  p_qr_token     text,
  p_display_name text,
  p_locale       text,
  p_checkout     date,
  p_is_adult     boolean,
  p_dedupe_key   bytea default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  h          public.hotels%rowtype;
  v_hash     bytea;
  v_guest    public.guests%rowtype;
  v_stay     public.stays%rowtype;
  v_today    date;
  v_exp      timestamptz;
  v_name     text := btrim(coalesce(p_display_name, ''));
  v_bonus    text := 'disabled';
  v_bonus_id uuid;
begin
  if not app.is_service() then
    raise exception 'forbidden' using errcode = 'CH004';
  end if;

  select * into h from public.hotels where slug = p_slug and status = 'active';
  if not found then raise exception 'invalid_qr' using errcode = 'CH003'; end if;

  v_hash := digest(coalesce(p_qr_token, ''), 'sha256');
  if not ((h.qr_token_hash is not null and h.qr_token_hash = v_hash)
       or (h.qr_token_prev_hash is not null and h.qr_token_prev_hash = v_hash
           and h.qr_prev_valid_until > now())) then
    raise exception 'invalid_qr' using errcode = 'CH003';
  end if;

  v_today := (now() at time zone h.timezone)::date;
  if (h.season_start is not null and v_today < h.season_start)
     or (h.season_end is not null and v_today > h.season_end) then
    raise exception 'out_of_season' using errcode = 'CH003';
  end if;
  if length(v_name) not between 2 and 24 then
    raise exception 'invalid_name' using errcode = 'CH003';
  end if;
  if p_locale not in ('it','en','de') then p_locale := h.default_locale; end if;
  if p_checkout is null or p_checkout < v_today or p_checkout > v_today + h.max_stay_days then
    raise exception 'invalid_checkout' using errcode = 'CH003';
  end if;
  if h.bonus_dedupe_mode = 'room_name' and h.bonus_enabled and p_dedupe_key is null then
    raise exception 'dedupe_key_required' using errcode = 'CH003';
  end if;

  -- Idempotenza: stesso utente, stesso hotel, soggiorno ancora attivo
  select * into v_guest from public.guests where auth_user_id = p_auth_user;
  if found then
    if v_guest.hotel_id <> h.id then
      raise exception 'already_in_other_hotel' using errcode = 'CH005';
    end if;
    select * into v_stay from public.stays
      where guest_id = v_guest.id and status = 'active' and expires_at > now();
    if found then
      return jsonb_build_object('guest_id', v_guest.id, 'stay_id', v_stay.id,
                                'expires_at', v_stay.expires_at, 'bonus', 'existing');
    end if;
    raise exception 'stay_ended_purge_first' using errcode = 'CH005';
  end if;

  -- Scadenza = giorno di check-out + orario di check-out dell'hotel (nel suo fuso),
  -- con un minimo di 3 ore da adesso per chi si registra il giorno della partenza.
  v_exp := greatest(((p_checkout + h.checkout_time)::timestamp at time zone h.timezone),
                    now() + interval '3 hours');

  insert into public.guests(hotel_id, auth_user_id, display_name, locale, is_adult)
  values (h.id, p_auth_user, v_name, p_locale, coalesce(p_is_adult, false))
  returning * into v_guest;

  insert into public.stays(hotel_id, guest_id, checkin_date, checkout_date, expires_at)
  values (h.id, v_guest.id, v_today, p_checkout, v_exp)
  returning * into v_stay;

  if h.bonus_enabled and h.bonus_season_cap > 0 then
    begin
      insert into public.welcome_bonuses(hotel_id, guest_id, stay_id, season_year, expires_at, dedupe_key)
      values (h.id, v_guest.id, v_stay.id, h.season_year, v_stay.expires_at, p_dedupe_key)
      returning id into v_bonus_id;
      v_bonus := 'issued';
    exception
      when sqlstate 'CH001' then v_bonus := 'cap_reached';
      when unique_violation then v_bonus := 'already_claimed';   -- stessa camera/nome/data o stesso ospite
    end;
  end if;

  perform app.audit(h.id, 'stay.start', 'stay', v_stay.id, jsonb_build_object('bonus', v_bonus));
  return jsonb_build_object('guest_id', v_guest.id, 'stay_id', v_stay.id,
                            'expires_at', v_stay.expires_at, 'bonus', v_bonus);
end $$;
revoke all on function public.start_stay(uuid,text,text,text,text,date,boolean,bytea) from public, anon, authenticated;
grant execute on function public.start_stay(uuid,text,text,text,text,date,boolean,bytea) to service_role;

-- 5.3 Cancellazione dati di un ospite (interna). Lascia solo righe anonime.
create function app.purge_guest(p_guest uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_auth uuid;
begin
  select auth_user_id into v_auth from public.guests where id = p_guest;
  if not found then return; end if;

  -- libera capienza futura (il trigger aggiorna slots.booked_count)
  update public.bookings b set status = 'cancelled', cancelled_at = now()
    from public.slots s
   where b.guest_id = p_guest and s.id = b.slot_id and s.starts_at > now() and b.status = 'confirmed';
  update public.event_attendance a set status = 'cancelled'
    from public.events e
   where a.guest_id = p_guest and e.id = a.event_id and e.starts_at > now() and a.status = 'going';

  -- bonus non usato: annullato, libera il tetto
  update public.bonus_redemptions r set status = 'cancelled'
   where r.status = 'pending'
     and r.bonus_id in (select id from public.welcome_bonuses where guest_id = p_guest);
  update public.welcome_bonuses set status = 'void'
   where guest_id = p_guest and status = 'issued';

  -- contenuti personali
  delete from public.ai_messages
   where conversation_id in (select id from public.ai_conversations where guest_id = p_guest);
  update public.ai_conversations
     set status = 'closed', closed_at = coalesce(closed_at, now())
   where guest_id = p_guest;
  delete from public.notifications where guest_id = p_guest;

  update public.stays
     set status = case when status = 'active' then 'ended' else status end,
         ended_at = coalesce(ended_at, now()),
         end_reason = coalesce(end_reason, 'expired')
   where guest_id = p_guest;

  -- Cancellando l'utente auth si cancella la riga guests (FK ON DELETE CASCADE);
  -- le FK composite portano a NULL guest_id nelle tabelle storiche.
  delete from auth.users where id = v_auth;
  delete from public.guests where id = p_guest;
end $$;

-- 5.4 Uscita volontaria dell'ospite ("Esci e cancella i miei dati")
create function public.end_my_stay() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_guest uuid := app.raw_guest_id();
begin
  if v_guest is null then raise exception 'forbidden' using errcode = 'CH004'; end if;
  update public.stays set status = 'ended', ended_at = now(), end_reason = 'guest_request'
   where guest_id = v_guest and status = 'active';
  perform app.purge_guest(v_guest);
end $$;
grant execute on function public.end_my_stay() to authenticated;

-- 5.5 Chiusura anticipata di un soggiorno da parte della reception
create function public.close_stay(p_stay uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.stays%rowtype;
begin
  select * into s from public.stays where id = p_stay;
  if not found or s.hotel_id not in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])) then
    raise exception 'forbidden' using errcode = 'CH004';
  end if;
  update public.stays set status = 'revoked', ended_at = now(), end_reason = 'hotel_closed' where id = p_stay;
  perform app.audit(s.hotel_id, 'stay.close', 'stay', p_stay);
  if s.guest_id is not null then perform app.purge_guest(s.guest_id); end if;
end $$;
grant execute on function public.close_stay(uuid) to authenticated;

-- 5.6 Job periodico (pg_cron ogni 10 minuti): scadenze e cancellazioni.
--     L'accesso e' gia' bloccato dalle policy alla scadenza; il job cancella i dati.
create function public.purge_expired_stays() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  n int := 0;
begin
  update public.stays set status = 'ended', ended_at = now(), end_reason = 'expired'
   where status = 'active' and expires_at <= now();
  update public.welcome_bonuses set status = 'expired'
   where status = 'issued' and expires_at <= now();
  update public.bonus_redemptions set status = 'expired'
   where status = 'pending' and expires_at <= now();

  for r in select distinct guest_id from public.stays
            where guest_id is not null and status in ('ended','revoked') loop
    perform app.purge_guest(r.guest_id);
    n := n + 1;
  end loop;

  -- difesa in profondita': ospiti senza alcun soggiorno attivo e piu' vecchi di 2 giorni
  for r in select g.id as guest_id from public.guests g
            where g.created_at < now() - interval '2 days'
              and not exists (select 1 from public.stays s
                               where s.guest_id = g.id and s.status = 'active' and s.expires_at > now()) loop
    perform app.purge_guest(r.guest_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.purge_expired_stays() from public, anon, authenticated;
grant execute on function public.purge_expired_stays() to service_role;

-- 5.7 Bonus: l'ospite genera un QR monouso a vita breve.
--     Ritorna il token in chiaro UNA sola volta; nel DB resta solo l'hash.
create function public.request_bonus_qr() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_guest uuid := app.my_guest_id();
  b       public.welcome_bonuses%rowtype;
  h       public.hotels%rowtype;
  v_token text;
  v_exp   timestamptz;
begin
  if v_guest is null then raise exception 'forbidden' using errcode = 'CH004'; end if;

  select * into b from public.welcome_bonuses where guest_id = v_guest for update;
  if not found or b.status <> 'issued' or b.expires_at <= now() then
    raise exception 'invalid_bonus' using errcode = 'CH003';
  end if;
  select * into h from public.hotels where id = b.hotel_id;

  -- un solo QR attivo per volta: i precedenti vengono invalidati
  update public.bonus_redemptions set status = 'cancelled' where bonus_id = b.id and status = 'pending';

  v_token := translate(encode(gen_random_bytes(18), 'base64'), '+/', '-_');   -- 144 bit
  v_exp := least(now() + make_interval(secs => h.bonus_qr_ttl_seconds), b.expires_at);
  insert into public.bonus_redemptions(hotel_id, bonus_id, token_hash, expires_at)
  values (b.hotel_id, b.id, digest(v_token, 'sha256'), v_exp);

  return jsonb_build_object('token', v_token, 'expires_at', v_exp, 'label', h.bonus_label);
end $$;
grant execute on function public.request_bonus_qr() to authenticated;

-- 5.8 Bonus: il barista valida il QR. Atomico; un solo esito "ok" possibile per bonus.
create function public.redeem_bonus(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  r        public.bonus_redemptions%rowtype;
  b        public.welcome_bonuses%rowtype;
  v_staff  uuid;
  v_fails  int;
  v_name   text;
  v_label  text;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = 'CH004'; end if;

  -- limite ai tentativi falliti (anti-bruteforce e anti-errore): 10 ogni 10 minuti per utente
  select count(*) into v_fails from public.audit_log
   where actor_user_id = auth.uid() and action = 'bonus.redeem_fail' and created_at > now() - interval '10 minutes';
  if v_fails >= 10 then return jsonb_build_object('ok', false, 'reason', 'rate_limited'); end if;

  select * into r from public.bonus_redemptions
   where token_hash = digest(coalesce(p_token, ''), 'sha256') for update;
  if not found then
    perform app.audit(null, 'bonus.redeem_fail', 'redemption', null, '{"why":"unknown"}');
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  v_staff := (select st.id from public.hotel_staff st
               where st.user_id = auth.uid() and st.hotel_id = r.hotel_id and st.active
                 and st.role in ('bartender','hotel_admin')
                 and exists (select 1 from public.hotels h where h.id = st.hotel_id and h.status = 'active'));
  if v_staff is null then
    perform app.audit(r.hotel_id, 'bonus.redeem_fail', 'redemption', r.id, '{"why":"wrong_staff"}');
    return jsonb_build_object('ok', false, 'reason', 'invalid');   -- non rivelare l'esistenza del token
  end if;

  if r.status = 'redeemed' then
    perform app.audit(r.hotel_id, 'bonus.redeem_fail', 'redemption', r.id, '{"why":"already_used"}');
    return jsonb_build_object('ok', false, 'reason', 'already_used', 'redeemed_at', r.redeemed_at);
  end if;
  if r.status <> 'pending' or r.expires_at <= now() then
    update public.bonus_redemptions set status = 'expired' where id = r.id and status = 'pending';
    perform app.audit(r.hotel_id, 'bonus.redeem_fail', 'redemption', r.id, '{"why":"expired"}');
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select * into b from public.welcome_bonuses where id = r.bonus_id for update;
  if b.status <> 'issued' or b.expires_at <= now() or b.guest_id is null
     or not exists (select 1 from public.stays s
                     where s.guest_id = b.guest_id and s.status = 'active' and s.expires_at > now()) then
    perform app.audit(r.hotel_id, 'bonus.redeem_fail', 'redemption', r.id, '{"why":"bonus_not_valid"}');
    return jsonb_build_object('ok', false, 'reason', 'bonus_not_valid');
  end if;

  update public.bonus_redemptions
     set status = 'redeemed', redeemed_at = now(), redeemed_by = v_staff where id = r.id;
  update public.welcome_bonuses set status = 'redeemed', redeemed_at = now() where id = b.id;
  perform app.audit(r.hotel_id, 'bonus.redeem', 'redemption', r.id);

  select g.display_name into v_name from public.guests g where g.id = b.guest_id;
  select h.bonus_label into v_label from public.hotels h where h.id = r.hotel_id;
  return jsonb_build_object('ok', true, 'guest_name', v_name, 'label', v_label);
end $$;
grant execute on function public.redeem_bonus(text) to authenticated;

-- 5.9 QR dell'hotel: nuova rotazione. Il token in chiaro si vede una volta sola.
--     Il precedente resta valido p_grace_days per non invalidare subito i cartoncini stampati.
create function public.rotate_hotel_qr(p_hotel uuid, p_grace_days int default 7) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_token text;
begin
  if not (app.is_service() or p_hotel in (select app.staff_hotel_ids(array['hotel_admin']::public.app_role[]))) then
    raise exception 'forbidden' using errcode = 'CH004';
  end if;
  v_token := translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_');   -- 192 bit
  update public.hotels
     set qr_token_prev_hash = qr_token_hash,
         qr_prev_valid_until = case when qr_token_hash is null then null
                                    else now() + make_interval(days => greatest(p_grace_days, 0)) end,
         qr_token_hash = digest(v_token, 'sha256'),
         qr_rotated_at = now()
   where id = p_hotel;
  perform app.audit(p_hotel, 'hotel.qr_rotate', 'hotel', p_hotel);
  return v_token;
end $$;
grant execute on function public.rotate_hotel_qr(uuid, int) to authenticated, service_role;

-- 5.10 Prenotazione slot. La capienza e' garantita dal trigger + CHECK; qui le regole di business.
create function public.book_slot(p_slot uuid, p_party_size int default 1) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_guest uuid := app.my_guest_id();
  v_hotel uuid := app.my_hotel_id();
  s       public.slots%rowtype;
  h       public.hotels%rowtype;
  v_day   date;
  v_count int;
  v_id    uuid;
begin
  if v_guest is null then raise exception 'forbidden' using errcode = 'CH004'; end if;
  if p_party_size is null or p_party_size not between 1 and 10 then
    raise exception 'invalid_party_size' using errcode = 'CH003';
  end if;

  select * into s from public.slots where id = p_slot and hotel_id = v_hotel;
  if not found or s.status <> 'open' or s.starts_at <= now() then
    raise exception 'slot_unavailable' using errcode = 'CH003';
  end if;
  select * into h from public.hotels where id = v_hotel;

  -- tetto giornaliero per ospite (conteggio per giorno locale dell'hotel)
  v_day := (s.starts_at at time zone h.timezone)::date;
  select count(*) into v_count
    from public.bookings b join public.slots x on x.id = b.slot_id
   where b.guest_id = v_guest and b.status in ('confirmed','attended')
     and (x.starts_at at time zone h.timezone)::date = v_day;
  if v_count >= h.max_bookings_per_guest_day then
    raise exception 'daily_limit' using errcode = 'CH005';
  end if;

  begin
    insert into public.bookings(hotel_id, slot_id, guest_id, party_size)
    values (v_hotel, p_slot, v_guest, p_party_size) returning id into v_id;
  exception
    when check_violation then raise exception 'slot_full' using errcode = 'CH002';
    when unique_violation then raise exception 'already_booked' using errcode = 'CH005';
  end;
  return v_id;
end $$;
grant execute on function public.book_slot(uuid, int) to authenticated;

create function public.cancel_booking(p_booking uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_guest uuid := app.my_guest_id();
  b public.bookings%rowtype;
  s public.slots%rowtype;
  h public.hotels%rowtype;
begin
  if v_guest is null then raise exception 'forbidden' using errcode = 'CH004'; end if;
  select * into b from public.bookings where id = p_booking and guest_id = v_guest for update;
  if not found or b.status <> 'confirmed' then raise exception 'invalid_booking' using errcode = 'CH003'; end if;
  select * into s from public.slots where id = b.slot_id;
  select * into h from public.hotels where id = b.hotel_id;
  if s.starts_at - make_interval(mins => h.booking_cancel_cutoff_minutes) <= now() then
    raise exception 'too_late' using errcode = 'CH006';
  end if;
  update public.bookings set status = 'cancelled', cancelled_at = now() where id = b.id;
end $$;
grant execute on function public.cancel_booking(uuid) to authenticated;

-- 5.11 Generazione slot (reception/admin): un intervallo di giorni, fascia oraria e durata
create function public.generate_slots(
  p_facility uuid, p_from date, p_to date, p_start time, p_end time,
  p_minutes int, p_capacity int default null
) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f public.facilities%rowtype;
  h public.hotels%rowtype;
  d date;
  t time;
  v_cap int;
  v_n int := 0;
  v_rows int;
begin
  select * into f from public.facilities where id = p_facility;
  if not found or f.hotel_id not in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])) then
    raise exception 'forbidden' using errcode = 'CH004';
  end if;
  if p_minutes not between 15 and 480 or p_to < p_from or p_to - p_from > 92 or p_end <= p_start then
    raise exception 'invalid_range' using errcode = 'CH003';
  end if;
  select * into h from public.hotels where id = f.hotel_id;
  v_cap := coalesce(p_capacity, f.default_capacity);

  d := p_from;
  while d <= p_to loop
    t := p_start;
    while t + make_interval(mins => p_minutes) <= p_end loop
      insert into public.slots(hotel_id, facility_id, starts_at, ends_at, capacity)
      values (f.hotel_id, f.id,
              (d + t)::timestamp at time zone h.timezone,
              (d + t + make_interval(mins => p_minutes))::timestamp at time zone h.timezone,
              v_cap)
      on conflict (facility_id, starts_at) do nothing;
      get diagnostics v_rows = row_count;
      v_n := v_n + v_rows;
      t := t + make_interval(mins => p_minutes);
    end loop;
    d := d + 1;
  end loop;
  return v_n;
end $$;
grant execute on function public.generate_slots(uuid,date,date,time,time,int,int) to authenticated;

-- 5.12 Adesione a un evento (con capienza opzionale)
create function public.rsvp_event(p_event uuid, p_going boolean default true) returns public.attendance_status
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_guest uuid := app.my_guest_id();
  v_hotel uuid := app.my_hotel_id();
  e public.events%rowtype;
  v_taken int;
  v_status public.attendance_status;
begin
  if v_guest is null then raise exception 'forbidden' using errcode = 'CH004'; end if;
  select * into e from public.events where id = p_event and hotel_id = v_hotel and published for update;
  if not found or coalesce(e.ends_at, e.starts_at + interval '3 hours') <= now() then
    raise exception 'event_unavailable' using errcode = 'CH003';
  end if;

  if p_going then
    if e.capacity is not null then
      select count(*) into v_taken from public.event_attendance
       where event_id = e.id and status in ('going','attended') and guest_id is distinct from v_guest;
      if v_taken >= e.capacity then raise exception 'event_full' using errcode = 'CH002'; end if;
    end if;
    insert into public.event_attendance(hotel_id, event_id, guest_id, status)
    values (v_hotel, e.id, v_guest, 'going')
    on conflict (event_id, guest_id) do update set status = 'going'
      where public.event_attendance.status = 'cancelled'
    returning status into v_status;
    if v_status is null then v_status := 'going'; end if;
  else
    update public.event_attendance set status = 'cancelled'
     where event_id = e.id and guest_id = v_guest and status = 'going';
    v_status := 'cancelled';
  end if;
  return v_status;
end $$;
grant execute on function public.rsvp_event(uuid, boolean) to authenticated;

-- 5.13 Contesto per la reception AI: nome hotel, lingua e SOLO le voci attive della sua
--      base di conoscenza. L'hotel e' ricavato dall'utente, mai passato dal client.
create function public.ai_context() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_guest uuid := app.my_guest_id();
  v_hotel uuid := app.my_hotel_id();
begin
  if v_guest is null then raise exception 'forbidden' using errcode = 'CH004'; end if;
  return jsonb_build_object(
    'hotel', (select jsonb_build_object('name', h.name, 'default_locale', h.default_locale, 'timezone', h.timezone)
                from public.hotels h where h.id = v_hotel),
    'knowledge', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', k.id, 'category', k.category, 'title', k.title,
                    'content', k.content, 'locale', k.locale) order by k.sort_order, k.created_at)
                  from public.ai_knowledge k where k.hotel_id = v_hotel and k.active), '[]'::jsonb));
end $$;
grant execute on function public.ai_context() to authenticated;

-- -----------------------------------------------------------------------------
-- 6. KPI del pannello hotel (security_invoker: rispetta la RLS di chi legge)
-- -----------------------------------------------------------------------------
create view public.v_hotel_kpi with (security_invoker = true) as
select h.id as hotel_id,
  (select count(*) from public.stays s where s.hotel_id = h.id)                                        as stays_total,
  (select count(*) from public.stays s where s.hotel_id = h.id and s.status = 'active' and s.expires_at > now()) as guests_active,
  (select count(*) from public.welcome_bonuses w where w.hotel_id = h.id and w.season_year = h.season_year and w.status in ('issued','redeemed')) as bonuses_issued,
  (select count(*) from public.bonus_redemptions r where r.hotel_id = h.id and r.status = 'redeemed') as bonus_redemptions,
  h.bonus_season_cap                                                                                    as bonus_cap,
  (select count(*) from public.bookings b where b.hotel_id = h.id and b.status in ('confirmed','attended')) as bookings,
  (select count(*) from public.event_attendance a where a.hotel_id = h.id and a.status = 'attended')  as event_attendances,
  (select count(*) from public.event_attendance a where a.hotel_id = h.id and a.status in ('going','attended')) as event_rsvps,
  (select count(*) from public.ai_conversations c where c.hotel_id = h.id)                             as ai_conversations,
  (select count(*) from public.ai_conversations c where c.hotel_id = h.id and c.handoff_at is null and c.ai_answer_count > 0) as ai_resolved,
  (select count(*) from public.ai_conversations c where c.hotel_id = h.id and c.handoff_at is not null) as ai_handoffs
from public.hotels h;
grant select on public.v_hotel_kpi to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Realtime e job pianificati (solo se disponibili nell'ambiente)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.ai_messages, public.ai_conversations, public.notifications, public.welcome_bonuses;
  else
    raise notice 'Publication supabase_realtime assente: realtime non configurato (ok fuori da Supabase).';
  end if;

  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('chathel-purge-expired', '*/10 * * * *', 'select public.purge_expired_stays()');
  else
    raise notice 'pg_cron non disponibile: pianificare purge_expired_stays() dall''esterno.';
  end if;
end $$;

commit;
