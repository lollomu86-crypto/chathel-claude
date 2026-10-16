-- =============================================================================
-- ChatHel - migrazione 0002: livello sociale P0 (elenco ospiti, chat pubblica,
-- chat privata con richiesta, coupon tra ospiti, segnalazioni e moderazione)
--
-- Decisione dei soci del 13 ottobre 2026. Regole di riferimento: CONTESTO.md,
-- "Regole sociali e privacy". Replica in SQL le stesse regole di
-- src/lib/rules/social.ts e coupons.ts (che sono la versione provata in memoria).
--
-- Principi:
--  1. Compare e usa il sociale SOLO chi e' maggiorenne (guests.is_adult) E ha scelto
--     di comparire (social_profiles.visible, di default false, modificabile).
--  2. Gli altri ospiti vedono solo nickname e lingua. L'id esposto e' un id sociale
--     casuale (social_profiles.id), mai guests.id. Mai camera, cognome, date, contatti.
--  3. I client NON scrivono ne' leggono direttamente le tabelle sociali: tutto passa
--     da funzioni RPC SECURITY DEFINER che applicano le regole (limiti inclusi).
--     Le chat private non hanno alcuna policy per lo staff: l'hotel le vede solo
--     attraverso lo "snapshot" che chi segnala condivide (social_reports.snapshot).
--  4. Al check-out (app.purge_guest cancella guests) tutto cio' che e' personale
--     sparisce per CASCADE; un trigger annulla i coupon non usati e svuota gli snapshot
--     delle segnalazioni. Restano righe anonime (coupon, contatori) per i numeri.
--
-- NON ancora collegata a src/lib/store/supabase.ts (vedi NOTE-SVILUPPO.md).
-- Requisiti: 0001_init.sql applicata; PostgreSQL 15+.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Tipi
-- -----------------------------------------------------------------------------
create type public.coupon_kind     as enum ('coffee', 'aperitif', 'dinner');
create type public.coupon_status   as enum ('issued', 'redeemed', 'expired', 'void');
create type public.thread_status   as enum ('pending', 'accepted', 'declined');
create type public.report_reason   as enum ('spam', 'harassment', 'inappropriate', 'other');
create type public.report_status   as enum ('open', 'actioned', 'dismissed', 'subject_left');
create type public.report_kind     as enum ('public', 'private');

-- -----------------------------------------------------------------------------
-- 2. Tabelle
-- -----------------------------------------------------------------------------

-- 2.1 Profilo sociale: una riga per ospite che ha mai aperto la scheda "Ospiti".
create table public.social_profiles (
  id                 uuid primary key default gen_random_uuid(),   -- "socialId" esposto agli altri ospiti
  hotel_id           uuid not null references public.hotels(id) on delete cascade,
  guest_id           uuid not null,
  nickname           text not null,
  visible            boolean not null default false,               -- opt-in esplicito: default NO
  accepts_private    boolean not null default true,
  rules_accepted_at  timestamptz,
  muted_until        timestamptz,                                  -- silenziato dall'hotel
  removed            boolean not null default false,               -- escluso dall'hotel
  stay_expires_at    timestamptz not null,
  created_at         timestamptz not null default now(),
  unique (id, hotel_id),
  unique (guest_id),
  foreign key (guest_id, hotel_id) references public.guests(id, hotel_id) on delete cascade
);
create unique index social_profiles_nick_idx on public.social_profiles(hotel_id, lower(nickname));
create index social_profiles_hotel_visible_idx on public.social_profiles(hotel_id) where visible and not removed;

-- Nickname ammesso: 2-20 caratteri, niente e-mail/link/numeri di telefono o di camera.
create function app.social_nick_ok(p text) returns boolean
language sql immutable as $$
  select p is not null
     and char_length(btrim(p)) between 2 and 20
     and p = btrim(p)
     and p !~ '[@/\\:<>]'
     and regexp_replace(p, '[ .-]', '', 'g') !~ '[0-9]{5,}'
     and p !~* '(https?|www|\.com|\.it|\.de)'
     and p ~ '[[:alpha:]]'
$$;
alter table public.social_profiles add constraint social_profiles_nick_chk check (app.social_nick_ok(nickname));

-- 2.2 Chat pubblica (una per struttura = per hotel_id)
create table public.social_public_messages (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  author_id   uuid not null,
  body        text not null check (char_length(body) between 1 and 280),
  hidden      boolean not null default false,
  hidden_at   timestamptz,
  created_at  timestamptz not null default now(),
  unique (id, hotel_id),
  foreign key (author_id, hotel_id) references public.social_profiles(id, hotel_id) on delete cascade
);
create index social_public_hotel_idx on public.social_public_messages(hotel_id, created_at desc);
create index social_public_author_idx on public.social_public_messages(author_id, created_at desc);

-- 2.3 Conversazioni private. Il primo messaggio e' una RICHIESTA ('pending').
create table public.social_threads (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  initiator_id  uuid not null,
  recipient_id  uuid not null,
  status        public.thread_status not null default 'pending',
  blocked_by    uuid,                      -- chi ha bloccato (l'altra parte non lo vede)
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  last_at       timestamptz not null default now(),
  check (initiator_id <> recipient_id),
  unique (id, hotel_id),
  foreign key (initiator_id, hotel_id) references public.social_profiles(id, hotel_id) on delete cascade,
  foreign key (recipient_id, hotel_id) references public.social_profiles(id, hotel_id) on delete cascade
);
-- una sola conversazione per coppia (in qualunque direzione): una richiesta rifiutata non si ripete
create unique index social_threads_pair_idx on public.social_threads(hotel_id, least(initiator_id, recipient_id), greatest(initiator_id, recipient_id));
create index social_threads_initiator_idx on public.social_threads(initiator_id, created_at);
create index social_threads_recipient_idx on public.social_threads(recipient_id);

-- 2.4 Coupon (valgono solo nei locali dell'hotel: li valida lo staff bar dello stesso hotel)
create table public.social_coupons (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references public.hotels(id) on delete cascade,
  kind         public.coupon_kind not null,
  sender_id    uuid,
  recipient_id uuid,
  thread_id    uuid,
  status       public.coupon_status not null default 'issued',
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  redeemed_at  timestamptz,
  redeemed_by  uuid references public.hotel_staff(id) on delete set null,
  unique (id, hotel_id),
  check (expires_at > created_at),
  check ((status = 'redeemed') = (redeemed_at is not null)),
  foreign key (sender_id, hotel_id)    references public.social_profiles(id, hotel_id) on delete set null (sender_id),
  foreign key (recipient_id, hotel_id) references public.social_profiles(id, hotel_id) on delete set null (recipient_id),
  foreign key (thread_id, hotel_id)    references public.social_threads(id, hotel_id)  on delete set null (thread_id)
);
create index social_coupons_sender_idx on public.social_coupons(sender_id, created_at);
create index social_coupons_hotel_idx on public.social_coupons(hotel_id, created_at);

create table public.social_messages (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references public.hotels(id) on delete cascade,
  thread_id  uuid not null,
  author_id  uuid not null,
  kind       text not null default 'text' check (kind in ('text', 'coupon')),
  body       text,
  coupon_id  uuid,
  created_at timestamptz not null default now(),
  check ((kind = 'text' and body is not null and char_length(body) between 1 and 280)
      or (kind = 'coupon' and coupon_id is not null and body is null)),
  unique (id, hotel_id),
  foreign key (thread_id, hotel_id)  references public.social_threads(id, hotel_id)  on delete cascade,
  foreign key (author_id, hotel_id)  references public.social_profiles(id, hotel_id) on delete cascade,
  foreign key (coupon_id, hotel_id)  references public.social_coupons(id, hotel_id)  on delete cascade
);
create index social_messages_thread_idx on public.social_messages(thread_id, created_at);
create index social_messages_author_idx on public.social_messages(author_id, created_at desc);

-- QR monouso del coupon: nel database resta solo l'hash (come bonus_redemptions)
create table public.social_coupon_qrs (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  coupon_id   uuid not null,
  token_hash  bytea not null unique,
  status      public.redemption_status not null default 'pending',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  foreign key (coupon_id, hotel_id) references public.social_coupons(id, hotel_id) on delete cascade
);
create unique index social_coupon_qrs_one_pending on public.social_coupon_qrs(coupon_id) where status = 'pending';
-- Garanzia finale di uso singolo, indipendente dal codice applicativo:
create unique index social_coupon_qrs_one_redeemed on public.social_coupon_qrs(coupon_id) where status = 'redeemed';

create table public.social_blocks (
  by_id      uuid not null references public.social_profiles(id) on delete cascade,
  target_id  uuid not null references public.social_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (by_id, target_id),
  check (by_id <> target_id)
);

-- Segnalazioni. `snapshot` e' il testo che chi segnala condivide con l'hotel (per i privati: il messaggio
-- segnalato + al massimo 4 precedenti). Viene svuotato se una delle parti fa check-out.
create table public.social_reports (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references public.hotels(id) on delete cascade,
  kind         public.report_kind not null,
  reason       public.report_reason not null,
  status       public.report_status not null default 'open',
  reporter_id  uuid,
  reported_id  uuid,
  message_id   uuid,
  thread_id    uuid,
  snapshot     jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  closed_at    timestamptz,
  foreign key (reporter_id, hotel_id) references public.social_profiles(id, hotel_id) on delete set null (reporter_id),
  foreign key (reported_id, hotel_id) references public.social_profiles(id, hotel_id) on delete set null (reported_id)
);
create index social_reports_hotel_idx on public.social_reports(hotel_id, status, created_at desc);
create unique index social_reports_once on public.social_reports(reporter_id, kind, message_id) where reporter_id is not null and message_id is not null;

-- Contatori anonimi (nessun riferimento a persone): sopravvivono al check-out e alimentano il pannello.
create table public.social_events (
  id        bigint generated always as identity primary key,
  hotel_id  uuid not null references public.hotels(id) on delete cascade,
  type      text not null check (type in ('public_message','private_request','private_accepted','private_declined','private_message')),
  at        timestamptz not null default now()
);
create index social_events_hotel_idx on public.social_events(hotel_id, type, at);

-- Check-out: i coupon non usati diventano nulli, le segnalazioni vengono chiuse e svuotate.
create function app.social_profile_purge() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.social_coupon_qrs set status = 'cancelled'
   where status = 'pending' and coupon_id in
     (select id from public.social_coupons where sender_id = old.id or recipient_id = old.id);
  update public.social_coupons set status = 'void'
   where status = 'issued' and (sender_id = old.id or recipient_id = old.id);
  update public.social_reports
     set snapshot = '[]'::jsonb, message_id = null, thread_id = null,
         status = case when status = 'open' then 'subject_left' else status end,
         closed_at = case when status = 'open' then now() else closed_at end
   where reporter_id = old.id or reported_id = old.id;
  return old;
end $$;
create trigger social_profiles_purge before delete on public.social_profiles
  for each row execute function app.social_profile_purge();

-- -----------------------------------------------------------------------------
-- 3. Funzioni di supporto (schema app)
-- -----------------------------------------------------------------------------

-- Inizio del giorno locale dell'hotel (per i limiti giornalieri)
create function app.hotel_day_start(p_hotel uuid) returns timestamptz
language sql stable as $$
  select date_trunc('day', now() at time zone h.timezone) at time zone h.timezone from public.hotels h where h.id = p_hotel
$$;

-- Profilo dell'ospite corrente; p_write = serve anche poter scrivere (regole accettate, non silenziato).
create function app.social_profile(p_write boolean default false) returns public.social_profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_guest uuid := app.my_guest_id();
  g public.guests;
  p public.social_profiles;
begin
  if v_guest is null then raise exception 'forbidden' using errcode = 'CH004'; end if;
  select * into g from public.guests where id = v_guest;
  if not g.is_adult then raise exception 'adult_required' using errcode = 'CH004'; end if;
  select * into p from public.social_profiles where guest_id = v_guest;
  if not found then raise exception 'social_opt_in_required' using errcode = 'CH004'; end if;
  if p.removed then raise exception 'social_removed' using errcode = 'CH004'; end if;
  if not p.visible then raise exception 'social_opt_in_required' using errcode = 'CH004'; end if;
  if p_write then
    if p.rules_accepted_at is null then raise exception 'rules_required' using errcode = 'CH004'; end if;
    if p.muted_until is not null and p.muted_until > now() then raise exception 'muted' using errcode = 'CH004'; end if;
  end if;
  return p;
end $$;

create function app.social_is_blocked(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.social_blocks
                  where (by_id = p_a and target_id = p_b) or (by_id = p_b and target_id = p_a))
$$;

-- Altra persona "contattabile": maggiorenne, visibile, non rimossa, stesso hotel
create function app.social_eligible(p_profile uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.social_profiles sp join public.guests g on g.id = sp.guest_id
                  where sp.id = p_profile and sp.visible and not sp.removed and g.is_adult)
$$;

-- Limiti di frequenza e tetti giornalieri (costanti identiche a SOCIAL_LIMITS in rules/social.ts)
create function app.social_check_private_rate(p_profile uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select count(*) from public.social_messages where author_id = p_profile and created_at > now() - interval '60 seconds') >= 10 then
    raise exception 'rate_limited' using errcode = 'CH007';
  end if;
end $$;

create function app.social_report_staff_hotels() returns setof uuid
language sql stable as $$ select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[]) $$;

-- -----------------------------------------------------------------------------
-- 4. RLS e privilegi: i client NON hanno accesso diretto alle tabelle sociali.
--    Lo staff (direttore, reception) legge solo cio' che serve alla moderazione.
--    Nessuna policy su threads, messages, blocks, coupons, qrs: le chat private non sono leggibili dall'hotel.
-- -----------------------------------------------------------------------------
alter table public.social_profiles        enable row level security;
alter table public.social_public_messages enable row level security;
alter table public.social_threads         enable row level security;
alter table public.social_messages        enable row level security;
alter table public.social_coupons         enable row level security;
alter table public.social_coupon_qrs      enable row level security;
alter table public.social_blocks          enable row level security;
alter table public.social_reports         enable row level security;
alter table public.social_events          enable row level security;

revoke all on public.social_profiles, public.social_public_messages, public.social_threads, public.social_messages,
              public.social_coupons, public.social_coupon_qrs, public.social_blocks, public.social_reports, public.social_events
  from anon, authenticated;
grant all on public.social_profiles, public.social_public_messages, public.social_threads, public.social_messages,
             public.social_coupons, public.social_coupon_qrs, public.social_blocks, public.social_reports, public.social_events
  to service_role;

-- Staff: profili (solo colonne di moderazione), chat pubblica, segnalazioni. Scritture solo via RPC.
grant select (id, hotel_id, nickname, visible, muted_until, removed, created_at) on public.social_profiles to authenticated;
create policy social_profiles_staff on public.social_profiles for select to authenticated
  using (hotel_id in (select app.social_report_staff_hotels()));
grant select on public.social_public_messages to authenticated;
create policy social_public_staff on public.social_public_messages for select to authenticated
  using (hotel_id in (select app.social_report_staff_hotels()));
grant select on public.social_reports to authenticated;
create policy social_reports_staff on public.social_reports for select to authenticated
  using (hotel_id in (select app.social_report_staff_hotels()));

-- -----------------------------------------------------------------------------
-- 5. RPC ospite: profilo e impostazioni
-- -----------------------------------------------------------------------------

-- Crea il profilo (nascosto) se manca. Nickname di partenza = prima parola del nome, mai il cognome.
create function app.social_ensure_profile() returns public.social_profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_guest uuid := app.my_guest_id();
  g public.guests;
  p public.social_profiles;
  v_base text;
  v_nick text;
  i int := 1;
  v_exp timestamptz;
begin
  if v_guest is null then raise exception 'forbidden' using errcode = 'CH004'; end if;
  select * into p from public.social_profiles where guest_id = v_guest;
  if found then return p; end if;
  select * into g from public.guests where id = v_guest;
  select expires_at into v_exp from public.stays where guest_id = v_guest and status = 'active' order by expires_at desc limit 1;
  v_base := split_part(btrim(g.display_name), ' ', 1);
  if not app.social_nick_ok(v_base) then v_base := 'Ospite'; end if;
  v_nick := v_base;
  while exists (select 1 from public.social_profiles where hotel_id = g.hotel_id and lower(nickname) = lower(v_nick)) loop
    i := i + 1;
    v_nick := left(v_base, 17) || ' ' || i;
  end loop;
  insert into public.social_profiles(hotel_id, guest_id, nickname, stay_expires_at)
  values (g.hotel_id, v_guest, v_nick, v_exp) returning * into p;
  return p;
end $$;

create function app.social_settings_json(p public.social_profiles) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_adult boolean := (select is_adult from public.guests where id = p.guest_id);
  v_day timestamptz := app.hotel_day_start(p.hotel_id);
  v_contacts int := 5 - (select count(*) from public.social_threads where initiator_id = p.id and created_at >= v_day);
  v_coupons int := 3 - (select count(*) from public.social_coupons where sender_id = p.id and created_at >= v_day);
  v_muted boolean := p.muted_until is not null and p.muted_until > now();
begin
  return jsonb_build_object(
    'id', p.id, 'nickname', p.nickname, 'visible', p.visible and not p.removed, 'accepts_private', p.accepts_private,
    'is_adult', v_adult, 'rules_accepted', p.rules_accepted_at is not null, 'muted', v_muted,
    'muted_until', case when v_muted then p.muted_until end, 'removed', p.removed,
    'new_contacts_left_today', greatest(0, v_contacts), 'coupons_left_today', greatest(0, v_coupons));
end $$;

create function public.social_settings() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return app.social_settings_json(app.social_ensure_profile());
end $$;
grant execute on function public.social_settings() to authenticated;

-- Opt-in / uscita dall'elenco, ricezione privati, nickname. Parametri null = invariato.
create function public.social_update_settings(p_visible boolean default null, p_accepts_private boolean default null, p_nickname text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p public.social_profiles := app.social_ensure_profile();
  v_adult boolean := (select is_adult from public.guests where id = p.guest_id);
begin
  if p_nickname is not null then
    p_nickname := btrim(regexp_replace(p_nickname, '\s+', ' ', 'g'));
    if not app.social_nick_ok(p_nickname) then raise exception 'invalid_nickname' using errcode = 'CH003'; end if;
    if exists (select 1 from public.social_profiles where hotel_id = p.hotel_id and id <> p.id and lower(nickname) = lower(p_nickname)) then
      raise exception 'nickname_taken' using errcode = 'CH005';
    end if;
    update public.social_profiles set nickname = p_nickname where id = p.id;
  end if;
  if p_visible is true then
    if not v_adult then raise exception 'adult_required' using errcode = 'CH004'; end if;
    if p.removed then raise exception 'social_removed' using errcode = 'CH004'; end if;
  end if;
  if p_visible is not null then update public.social_profiles set visible = p_visible where id = p.id; end if;
  if p_accepts_private is not null then update public.social_profiles set accepts_private = p_accepts_private where id = p.id; end if;
  return app.social_settings_json((select sp from public.social_profiles sp where sp.id = p.id));
end $$;
grant execute on function public.social_update_settings(boolean, boolean, text) to authenticated;

create function public.social_accept_rules() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.social_profiles := app.social_profile(false);
begin
  update public.social_profiles set rules_accepted_at = coalesce(rules_accepted_at, now()) where id = p.id;
end $$;
grant execute on function public.social_accept_rules() to authenticated;

-- Elenco ospiti: solo id sociale, nickname, lingua, "accetta privati". Solo per chi e' a sua volta visibile.
create function public.social_guests() returns table (id uuid, nickname text, locale text, can_message boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.social_profiles := app.social_profile(false);
begin
  return query
    select sp.id, sp.nickname, g.locale, sp.accepts_private
      from public.social_profiles sp join public.guests g on g.id = sp.guest_id
     where sp.hotel_id = me.hotel_id and sp.id <> me.id and sp.visible and not sp.removed and g.is_adult
       and not app.social_is_blocked(me.id, sp.id)
     order by sp.nickname;
end $$;
grant execute on function public.social_guests() to authenticated;

-- -----------------------------------------------------------------------------
-- 6. RPC ospite: chat pubblica e segnalazioni
-- -----------------------------------------------------------------------------
create function public.social_post_public(p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(true);
  v_body text := btrim(p_body);
  v_id uuid;
begin
  if v_body is null or v_body = '' then raise exception 'invalid_message' using errcode = 'CH003'; end if;
  if char_length(v_body) > 280 then raise exception 'too_long' using errcode = 'CH003'; end if;
  if (select count(*) from public.social_public_messages where author_id = me.id and created_at >= app.hotel_day_start(me.hotel_id)) >= 100 then
    raise exception 'daily_limit' using errcode = 'CH007';
  end if;
  if (select count(*) from public.social_public_messages where author_id = me.id and created_at > now() - interval '60 seconds') >= 5 then
    raise exception 'rate_limited' using errcode = 'CH007';
  end if;
  insert into public.social_public_messages(hotel_id, author_id, body) values (me.hotel_id, me.id, v_body) returning id into v_id;
  insert into public.social_events(hotel_id, type) values (me.hotel_id, 'public_message');
  return v_id;
end $$;
grant execute on function public.social_post_public(text) to authenticated;

create function public.social_feed() returns table (id uuid, author_id uuid, nickname text, body text, created_at timestamptz, mine boolean, reported_by_me boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.social_profiles := app.social_profile(false);
begin
  return query
    select * from (
      select m.id, m.author_id, sp.nickname, m.body, m.created_at, (m.author_id = me.id),
             exists (select 1 from public.social_reports r where r.kind = 'public' and r.message_id = m.id and r.reporter_id = me.id)
        from public.social_public_messages m join public.social_profiles sp on sp.id = m.author_id
       where m.hotel_id = me.hotel_id and not m.hidden and not app.social_is_blocked(me.id, m.author_id)
       order by m.created_at desc limit 100) x
    order by x.created_at;
end $$;
grant execute on function public.social_feed() to authenticated;

create function public.social_report_public(p_message uuid, p_reason public.report_reason) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(false);
  m public.social_public_messages;
begin
  select * into m from public.social_public_messages where id = p_message and hotel_id = me.hotel_id;
  if not found or m.author_id = me.id then raise exception 'invalid_message' using errcode = 'CH003'; end if;
  if exists (select 1 from public.social_reports where kind = 'public' and message_id = m.id and reporter_id = me.id) then return; end if;
  if (select count(*) from public.social_reports where reporter_id = me.id and created_at >= app.hotel_day_start(me.hotel_id)) >= 10 then
    raise exception 'rate_limited' using errcode = 'CH007';
  end if;
  insert into public.social_reports(hotel_id, kind, reason, reporter_id, reported_id, message_id, snapshot)
  values (me.hotel_id, 'public', p_reason, me.id, m.author_id, m.id,
          jsonb_build_array(jsonb_build_object('nickname', (select nickname from public.social_profiles where id = m.author_id),
                                               'text', m.body, 'at', m.created_at)));
end $$;
grant execute on function public.social_report_public(uuid, public.report_reason) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. RPC ospite: chat privata
-- -----------------------------------------------------------------------------

-- Primo contatto = richiesta con un solo messaggio. Cause di rifiuto indistinguibili per chi scrive.
create function public.social_start_thread(p_to uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(true);
  v_body text := btrim(p_body);
  tgt public.social_profiles;
  t public.social_threads;
  v_id uuid;
begin
  if v_body is null or v_body = '' then raise exception 'invalid_message' using errcode = 'CH003'; end if;
  if char_length(v_body) > 280 then raise exception 'too_long' using errcode = 'CH003'; end if;
  select * into tgt from public.social_profiles where id = p_to and hotel_id = me.hotel_id;
  if not found or tgt.id = me.id then raise exception 'invalid_guest' using errcode = 'CH003'; end if;
  if not app.social_eligible(tgt.id) or not tgt.accepts_private or app.social_is_blocked(me.id, tgt.id) then
    raise exception 'recipient_unavailable' using errcode = 'CH004';
  end if;
  select * into t from public.social_threads
   where hotel_id = me.hotel_id and least(initiator_id, recipient_id) = least(me.id, tgt.id) and greatest(initiator_id, recipient_id) = greatest(me.id, tgt.id);
  if found then
    if t.status = 'declined' then raise exception 'recipient_unavailable' using errcode = 'CH004'; end if;
    raise exception 'thread_exists' using errcode = 'CH005';
  end if;
  if (select count(*) from public.social_threads where initiator_id = me.id and created_at >= app.hotel_day_start(me.hotel_id)) >= 5 then
    raise exception 'daily_contact_limit' using errcode = 'CH007';
  end if;
  perform app.social_check_private_rate(me.id);
  insert into public.social_threads(hotel_id, initiator_id, recipient_id) values (me.hotel_id, me.id, tgt.id) returning id into v_id;
  insert into public.social_messages(hotel_id, thread_id, author_id, kind, body) values (me.hotel_id, v_id, me.id, 'text', v_body);
  insert into public.social_events(hotel_id, type) values (me.hotel_id, 'private_request'), (me.hotel_id, 'private_message');
  return v_id;
end $$;
grant execute on function public.social_start_thread(uuid, text) to authenticated;

create function public.social_respond(p_thread uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(false);
  t public.social_threads;
begin
  select * into t from public.social_threads where id = p_thread and (initiator_id = me.id or recipient_id = me.id) for update;
  if not found then raise exception 'invalid_thread' using errcode = 'CH003'; end if;
  if t.recipient_id <> me.id then raise exception 'forbidden' using errcode = 'CH004'; end if;
  if t.status <> 'pending' then raise exception 'thread_not_pending' using errcode = 'CH005'; end if;
  update public.social_threads set status = case when p_accept then 'accepted' else 'declined' end::public.thread_status,
         responded_at = now(), last_at = now() where id = t.id;
  insert into public.social_events(hotel_id, type) values (me.hotel_id, case when p_accept then 'private_accepted' else 'private_declined' end);
end $$;
grant execute on function public.social_respond(uuid, boolean) to authenticated;

-- Verifica che la conversazione sia aperta tra due persone ancora contattabili (usata da messaggi e coupon)
create function app.social_open_peer(me public.social_profiles, p_thread uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.social_threads;
  v_peer uuid;
begin
  select * into t from public.social_threads where id = p_thread and (initiator_id = me.id or recipient_id = me.id);
  if not found then raise exception 'invalid_thread' using errcode = 'CH003'; end if;
  if t.status <> 'accepted' then raise exception 'thread_not_open' using errcode = 'CH004'; end if;
  v_peer := case when t.initiator_id = me.id then t.recipient_id else t.initiator_id end;
  if t.blocked_by is not null or app.social_is_blocked(me.id, v_peer) or not app.social_eligible(v_peer) then
    raise exception 'recipient_unavailable' using errcode = 'CH004';
  end if;
  return v_peer;
end $$;

create function public.social_send_private(p_thread uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(true);
  v_body text := btrim(p_body);
  v_id uuid;
begin
  if v_body is null or v_body = '' then raise exception 'invalid_message' using errcode = 'CH003'; end if;
  if char_length(v_body) > 280 then raise exception 'too_long' using errcode = 'CH003'; end if;
  perform app.social_open_peer(me, p_thread);
  perform app.social_check_private_rate(me.id);
  insert into public.social_messages(hotel_id, thread_id, author_id, kind, body) values (me.hotel_id, p_thread, me.id, 'text', v_body) returning id into v_id;
  update public.social_threads set last_at = now() where id = p_thread;
  insert into public.social_events(hotel_id, type) values (me.hotel_id, 'private_message');
  return v_id;
end $$;
grant execute on function public.social_send_private(uuid, text) to authenticated;

create function public.social_block(p_target uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(false);
begin
  if not exists (select 1 from public.social_profiles where id = p_target and hotel_id = me.hotel_id and id <> me.id) then
    raise exception 'invalid_guest' using errcode = 'CH003';
  end if;
  insert into public.social_blocks(by_id, target_id) values (me.id, p_target) on conflict do nothing;
  update public.social_threads set blocked_by = coalesce(blocked_by, me.id)
   where hotel_id = me.hotel_id and least(initiator_id, recipient_id) = least(me.id, p_target) and greatest(initiator_id, recipient_id) = greatest(me.id, p_target);
  -- coupon non usati tra le due parti: annullati
  update public.social_coupon_qrs set status = 'cancelled'
   where status = 'pending' and coupon_id in (select id from public.social_coupons
     where status = 'issued' and ((sender_id = me.id and recipient_id = p_target) or (sender_id = p_target and recipient_id = me.id)));
  update public.social_coupons set status = 'void'
   where status = 'issued' and ((sender_id = me.id and recipient_id = p_target) or (sender_id = p_target and recipient_id = me.id));
end $$;
grant execute on function public.social_block(uuid) to authenticated;

create function public.social_unblock(p_target uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.social_profiles := app.social_profile(false);
begin
  delete from public.social_blocks where by_id = me.id and target_id = p_target;
  update public.social_threads set blocked_by = null
   where blocked_by = me.id and (initiator_id = p_target or recipient_id = p_target);
end $$;
grant execute on function public.social_unblock(uuid) to authenticated;

-- Segnalazione di un messaggio privato: condivide solo quel messaggio + al massimo 4 precedenti
create function public.social_report_private(p_thread uuid, p_message uuid, p_reason public.report_reason) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(false);
  m public.social_messages;
  v_snap jsonb;
begin
  if not exists (select 1 from public.social_threads where id = p_thread and (initiator_id = me.id or recipient_id = me.id)) then
    raise exception 'invalid_thread' using errcode = 'CH003';
  end if;
  select * into m from public.social_messages where id = p_message and thread_id = p_thread and kind = 'text';
  if not found or m.author_id = me.id then raise exception 'invalid_message' using errcode = 'CH003'; end if;
  if exists (select 1 from public.social_reports where kind = 'private' and message_id = m.id and reporter_id = me.id) then return; end if;
  if (select count(*) from public.social_reports where reporter_id = me.id and created_at >= app.hotel_day_start(me.hotel_id)) >= 10 then
    raise exception 'rate_limited' using errcode = 'CH007';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('nickname', sp.nickname, 'text', x.body, 'at', x.created_at) order by x.created_at), '[]'::jsonb)
    into v_snap
    from (select * from public.social_messages
           where thread_id = p_thread and kind = 'text' and created_at <= m.created_at
           order by created_at desc, id desc limit 5) x
    join public.social_profiles sp on sp.id = x.author_id;
  insert into public.social_reports(hotel_id, kind, reason, reporter_id, reported_id, message_id, thread_id, snapshot)
  values (me.hotel_id, 'private', p_reason, me.id, m.author_id, m.id, p_thread, v_snap);
end $$;
grant execute on function public.social_report_private(uuid, uuid, public.report_reason) to authenticated;

-- Lettura delle conversazioni (l'ospite non ha SELECT diretto sulle tabelle)
create function public.social_threads_list() returns table (id uuid, peer_id uuid, peer_nickname text, status public.thread_status, incoming boolean, last_at timestamptz, preview text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.social_profiles := app.social_profile(false);
begin
  return query
    select t.id, sp.id, sp.nickname, t.status, (t.recipient_id = me.id), t.last_at,
           coalesce((select left(m.body, 80) from public.social_messages m where m.thread_id = t.id and m.kind = 'text' order by m.created_at desc limit 1), '')
      from public.social_threads t
      join public.social_profiles sp on sp.id = case when t.initiator_id = me.id then t.recipient_id else t.initiator_id end
     where (t.initiator_id = me.id or t.recipient_id = me.id) and t.blocked_by is distinct from me.id
     order by t.last_at desc;
end $$;
grant execute on function public.social_threads_list() to authenticated;

create function public.social_thread_messages(p_thread uuid)
returns table (id uuid, mine boolean, kind text, body text, coupon_id uuid, coupon_kind public.coupon_kind, coupon_status public.coupon_status,
               coupon_expires_at timestamptz, coupon_redeemed_at timestamptz, coupon_direction text, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.social_profiles := app.social_profile(false);
begin
  if not exists (select 1 from public.social_threads t where t.id = p_thread and (t.initiator_id = me.id or t.recipient_id = me.id) and t.blocked_by is distinct from me.id) then
    raise exception 'invalid_thread' using errcode = 'CH003';
  end if;
  return query
    select m.id, (m.author_id = me.id), m.kind, m.body, c.id, c.kind,
           (case when c.status = 'issued' and c.expires_at <= now() then 'expired' else c.status::text end)::public.coupon_status,
           c.expires_at, c.redeemed_at, case when c.id is null then null when c.sender_id = me.id then 'sent' else 'received' end, m.created_at
      from public.social_messages m left join public.social_coupons c on c.id = m.coupon_id
     where m.thread_id = p_thread order by m.created_at, m.id;
end $$;
grant execute on function public.social_thread_messages(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. RPC ospite: coupon
-- -----------------------------------------------------------------------------
create function public.social_send_coupon(p_thread uuid, p_kind public.coupon_kind) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(true);
  v_peer uuid;
  v_exp timestamptz;
  v_peer_exp timestamptz;
  v_id uuid;
begin
  v_peer := app.social_open_peer(me, p_thread);
  if (select count(*) from public.social_coupons where sender_id = me.id and created_at >= app.hotel_day_start(me.hotel_id)) >= 3 then
    raise exception 'coupon_daily_limit' using errcode = 'CH007';
  end if;
  if (select count(*) from public.social_coupons where sender_id = me.id and status = 'issued' and expires_at > now()) >= 5 then
    raise exception 'coupon_active_limit' using errcode = 'CH007';
  end if;
  perform app.social_check_private_rate(me.id);
  select stay_expires_at into v_peer_exp from public.social_profiles where id = v_peer;
  v_exp := least(now() + interval '48 hours', v_peer_exp);       -- mai oltre il soggiorno del destinatario
  insert into public.social_coupons(hotel_id, kind, sender_id, recipient_id, thread_id, expires_at)
  values (me.hotel_id, p_kind, me.id, v_peer, p_thread, v_exp) returning id into v_id;
  insert into public.social_messages(hotel_id, thread_id, author_id, kind, coupon_id) values (me.hotel_id, p_thread, me.id, 'coupon', v_id);
  update public.social_threads set last_at = now() where id = p_thread;
  return v_id;
end $$;
grant execute on function public.social_send_coupon(uuid, public.coupon_kind) to authenticated;

create function public.social_cancel_coupon(p_coupon uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(false);
  c public.social_coupons;
begin
  select * into c from public.social_coupons where id = p_coupon and sender_id = me.id for update;
  if not found then raise exception 'invalid_coupon' using errcode = 'CH003'; end if;
  if c.status <> 'issued' or c.expires_at <= now() then raise exception 'coupon_not_active' using errcode = 'CH005'; end if;
  update public.social_coupon_qrs set status = 'cancelled' where coupon_id = c.id and status = 'pending';
  update public.social_coupons set status = 'void' where id = c.id;
end $$;
grant execute on function public.social_cancel_coupon(uuid) to authenticated;

-- QR monouso: solo il destinatario; il token in chiaro si vede una volta sola (prefisso c_ per distinguerlo dal bonus)
create function public.social_coupon_qr(p_coupon uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(false);
  c public.social_coupons;
  v_token text;
  v_exp timestamptz;
begin
  select * into c from public.social_coupons where id = p_coupon and recipient_id = me.id for update;
  if not found or c.status <> 'issued' or c.expires_at <= now() then raise exception 'invalid_coupon' using errcode = 'CH003'; end if;
  update public.social_coupon_qrs set status = 'cancelled' where coupon_id = c.id and status = 'pending';
  v_token := 'c_' || translate(encode(gen_random_bytes(18), 'base64'), '+/', '-_');
  v_exp := least(now() + interval '90 seconds', c.expires_at);
  insert into public.social_coupon_qrs(hotel_id, coupon_id, token_hash, expires_at) values (c.hotel_id, c.id, digest(v_token, 'sha256'), v_exp);
  return jsonb_build_object('token', v_token, 'expires_at', v_exp, 'kind', c.kind);
end $$;
grant execute on function public.social_coupon_qr(uuid) to authenticated;

-- Il barista valida il coupon. Stesso schema di redeem_bonus: atomico, uso singolo, limite ai tentativi falliti.
create function public.redeem_coupon(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  q public.social_coupon_qrs;
  c public.social_coupons;
  v_staff uuid;
  v_fails int;
  v_to text;
  v_from text;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = 'CH004'; end if;
  select count(*) into v_fails from public.audit_log
   where actor_user_id = auth.uid() and action = 'coupon.redeem_fail' and created_at > now() - interval '10 minutes';
  if v_fails >= 10 then return jsonb_build_object('ok', false, 'reason', 'rate_limited'); end if;

  select * into q from public.social_coupon_qrs where token_hash = digest(coalesce(p_token, ''), 'sha256') for update;
  if not found then
    perform app.audit(null, 'coupon.redeem_fail', 'coupon_qr', null, '{"why":"unknown"}');
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  v_staff := (select st.id from public.hotel_staff st
               where st.user_id = auth.uid() and st.hotel_id = q.hotel_id and st.active and st.role in ('bartender','hotel_admin')
                 and exists (select 1 from public.hotels h where h.id = st.hotel_id and h.status = 'active'));
  if v_staff is null then
    perform app.audit(q.hotel_id, 'coupon.redeem_fail', 'coupon_qr', q.id, '{"why":"wrong_staff"}');
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into c from public.social_coupons where id = q.coupon_id for update;
  if q.status = 'redeemed' or c.status = 'redeemed' then
    perform app.audit(q.hotel_id, 'coupon.redeem_fail', 'coupon_qr', q.id, '{"why":"already_used"}');
    return jsonb_build_object('ok', false, 'reason', 'already_used', 'redeemed_at', c.redeemed_at);
  end if;
  if q.status <> 'pending' or q.expires_at <= now() then
    update public.social_coupon_qrs set status = 'expired' where id = q.id and status = 'pending';
    perform app.audit(q.hotel_id, 'coupon.redeem_fail', 'coupon_qr', q.id, '{"why":"expired"}');
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if c.status <> 'issued' or c.expires_at <= now() or c.recipient_id is null
     or not exists (select 1 from public.social_profiles sp join public.stays s on s.guest_id = sp.guest_id
                     where sp.id = c.recipient_id and s.status = 'active' and s.expires_at > now()) then
    perform app.audit(q.hotel_id, 'coupon.redeem_fail', 'coupon_qr', q.id, '{"why":"not_valid"}');
    return jsonb_build_object('ok', false, 'reason', 'bonus_not_valid');
  end if;
  update public.social_coupon_qrs set status = 'redeemed' where id = q.id;
  update public.social_coupons set status = 'redeemed', redeemed_at = now(), redeemed_by = v_staff where id = c.id;
  perform app.audit(q.hotel_id, 'coupon.redeem', 'coupon', c.id);
  select nickname into v_to from public.social_profiles where id = c.recipient_id;
  select nickname into v_from from public.social_profiles where id = c.sender_id;
  return jsonb_build_object('ok', true, 'kind', 'coupon', 'coupon_kind', c.kind, 'guest_name', v_to, 'from_name', v_from);
end $$;
grant execute on function public.redeem_coupon(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. RPC staff: moderazione e numeri aggregati (direttore e reception)
-- -----------------------------------------------------------------------------
create function app.social_staff_hotel() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  select h into v from app.social_report_staff_hotels() h limit 1;
  if v is null then raise exception 'forbidden' using errcode = 'CH004'; end if;
  return v;
end $$;

create function public.social_hide_message(p_message uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hotel uuid := app.social_staff_hotel();
begin
  update public.social_public_messages set hidden = p_hidden, hidden_at = case when p_hidden then now() end
   where id = p_message and hotel_id = v_hotel;
  if not found then raise exception 'invalid_message' using errcode = 'CH003'; end if;
  if p_hidden then
    update public.social_reports set status = 'actioned', closed_at = now()
     where hotel_id = v_hotel and kind = 'public' and message_id = p_message and status = 'open';
  end if;
  perform app.audit(v_hotel, case when p_hidden then 'social.hide' else 'social.unhide' end, 'social_message', p_message);
end $$;
grant execute on function public.social_hide_message(uuid, boolean) to authenticated;

create function public.social_mute(p_profile uuid, p_until timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hotel uuid := app.social_staff_hotel();
begin
  update public.social_profiles set muted_until = p_until where id = p_profile and hotel_id = v_hotel;
  if not found then raise exception 'invalid_guest' using errcode = 'CH003'; end if;
  perform app.audit(v_hotel, case when p_until is null then 'social.unmute' else 'social.mute' end, 'social_profile', p_profile);
end $$;
grant execute on function public.social_mute(uuid, timestamptz) to authenticated;

create function public.social_set_removed(p_profile uuid, p_removed boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hotel uuid := app.social_staff_hotel();
begin
  update public.social_profiles set removed = p_removed, visible = case when p_removed then false else visible end
   where id = p_profile and hotel_id = v_hotel;
  if not found then raise exception 'invalid_guest' using errcode = 'CH003'; end if;
  perform app.audit(v_hotel, case when p_removed then 'social.remove' else 'social.restore' end, 'social_profile', p_profile);
end $$;
grant execute on function public.social_set_removed(uuid, boolean) to authenticated;

create function public.social_close_report(p_report uuid, p_outcome public.report_status) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hotel uuid := app.social_staff_hotel();
begin
  if p_outcome not in ('actioned', 'dismissed') then raise exception 'invalid_input' using errcode = 'CH003'; end if;
  if not exists (select 1 from public.social_reports where id = p_report and hotel_id = v_hotel) then raise exception 'invalid_report' using errcode = 'CH003'; end if;
  update public.social_reports set status = p_outcome, closed_at = now() where id = p_report and hotel_id = v_hotel and status = 'open';
  if not found then raise exception 'report_closed' using errcode = 'CH005'; end if;
end $$;
grant execute on function public.social_close_report(uuid, public.report_status) to authenticated;

-- Numeri aggregati: nessun dato personale. p_period: 'today' | '7d' | 'season'
create function public.social_stats(p_period text default '7d') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hotel uuid := app.social_staff_hotel();
  v_from timestamptz := case p_period when 'today' then app.hotel_day_start(v_hotel) when '7d' then now() - interval '7 days' else '-infinity'::timestamptz end;
begin
  return jsonb_build_object(
    'visible_guests', (select count(*) from public.social_profiles sp join public.guests g on g.id = sp.guest_id where sp.hotel_id = v_hotel and sp.visible and not sp.removed and g.is_adult),
    'public_messages', (select count(*) from public.social_events where hotel_id = v_hotel and type = 'public_message' and at >= v_from),
    'private_requests', (select count(*) from public.social_events where hotel_id = v_hotel and type = 'private_request' and at >= v_from),
    'private_accepted', (select count(*) from public.social_events where hotel_id = v_hotel and type = 'private_accepted' and at >= v_from),
    'private_declined', (select count(*) from public.social_events where hotel_id = v_hotel and type = 'private_declined' and at >= v_from),
    'private_messages', (select count(*) from public.social_events where hotel_id = v_hotel and type = 'private_message' and at >= v_from),
    'coupons_sent', (select count(*) from public.social_coupons where hotel_id = v_hotel and created_at >= v_from),
    'coupons_redeemed', (select count(*) from public.social_coupons where hotel_id = v_hotel and status = 'redeemed' and redeemed_at >= v_from),
    'coupons_expired', (select count(*) from public.social_coupons where hotel_id = v_hotel and status in ('issued','expired') and expires_at <= now() and expires_at >= v_from),
    'hidden_messages', (select count(*) from public.social_public_messages where hotel_id = v_hotel and hidden),
    'open_reports', (select count(*) from public.social_reports where hotel_id = v_hotel and status = 'open'));
end $$;
grant execute on function public.social_stats(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 10. Job periodico: i coupon scaduti si marcano come tali (il pannello conta anche senza job)
-- -----------------------------------------------------------------------------
create function public.expire_social_coupons() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update public.social_coupon_qrs set status = 'expired' where status = 'pending' and expires_at <= now();
  update public.social_coupons set status = 'expired' where status = 'issued' and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.expire_social_coupons() from public, anon, authenticated;
grant execute on function public.expire_social_coupons() to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('chathel-expire-social-coupons', '*/10 * * * *', 'select public.expire_social_coupons()');
  else
    raise notice 'pg_cron non disponibile: pianificare expire_social_coupons() dall''esterno.';
  end if;
end $$;

-- Le funzioni nuove nascono con EXECUTE a PUBLIC: lo tolgo a PUBLIC/anon per tutte le RPC sociali
-- (restano i GRANT espliciti ad authenticated dati sopra; expire_social_coupons resta solo a service_role).
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'social\_%' or p.proname in ('redeem_coupon', 'expire_social_coupons')) loop
    execute format('revoke all on function %s from public, anon', r.sig);
  end loop;
end $$;

commit;
