-- =============================================================================
-- ChatHel - migrazione 0003: identita' dell'ospite (accesso con Google) e registro dei consensi
--
-- Decisione dei soci del 13 ottobre 2026: l'ospite entra con il QR dell'hotel PIU' l'accesso con Google.
--  - Dati salvati dal profilo Google: SOLO provider_subject (per Google il campo `sub`) e nome di battesimo.
--    Nickname scelto dall'ospite. Mai e-mail o foto nell'elenco, nei messaggi, nelle tabelle dell'app.
--    (Supabase Auth conserva da se' l'e-mail del login Google in auth.users: l'app non la copia ne' la legge;
--    viene cancellata con l'utente al check-out. Da scrivere nell'informativa e far valutare al legale.)
--  - La sessione di soggiorno e' legata all'identita': un'identita' = al massimo un soggiorno attivo per hotel
--    (indice unico su guests) e un solo bonus per hotel e stagione (chiave anti-doppione HMAC, calcolata dal server
--    con un pepper; e' l'unico dato che sopravvive al check-out, sulla riga anonima del bonus).
--  - Check-out: la riga di identita' e l'utente auth vengono cancellati (salvo che sia anche staff).
--
-- Cambia anche start_stay: ora crea in un colpo solo ospite, soggiorno, profilo sociale (con la scelta di opt-in,
-- che prima si perdeva: revisione B1) e bonus, con tetto di bonus emessi nell'ora e registro di consenso/maggiore eta'.
--
-- Requisiti: 0001 e 0002 applicate. Provata su Postgres 16 con supabase/tests/0003_identity_test.sql.
-- NON provata con GoTrue/Google reali.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Identita'
-- -----------------------------------------------------------------------------
create table public.guest_identities (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null check (provider in ('google', 'demo')),
  provider_subject  text not null check (char_length(provider_subject) between 1 and 255),
  given_name        text not null check (char_length(btrim(given_name)) between 1 and 40),
  auth_user_id      uuid not null unique references auth.users(id) on delete cascade,
  created_at        timestamptz not null default now(),
  unique (provider, provider_subject)
);
alter table public.guest_identities enable row level security;
revoke all on public.guest_identities from anon, authenticated;
grant all on public.guest_identities to service_role;
-- nessuna policy: l'ospite e lo staff non leggono mai le identita' (solo service_role, dal server)

alter table public.hotels
  add column bonus_max_per_hour int not null default 60 check (bonus_max_per_hour >= 0);
grant select (bonus_max_per_hour) on public.hotels to authenticated;

alter table public.guests
  add column identity_id        uuid references public.guest_identities(id) on delete set null,
  add column consent_at         timestamptz,       -- quando ha accettato l'informativa
  add column privacy_version    text,              -- quale versione
  add column adult_declared_at  timestamptz;       -- quando ha dichiarato la maggiore eta'
-- un'identita' = al massimo un soggiorno (una riga guest) per hotel
create unique index guests_one_per_identity_hotel on public.guests(identity_id, hotel_id) where identity_id is not null;
-- il barista e la reception non devono leggere dati d'identita': i grant per colonna sono ristretti in 0004

alter table public.social_profiles
  add column opt_in_at timestamptz;                -- quando ha scelto di comparire nell'elenco

-- -----------------------------------------------------------------------------
-- 2. Registrazione dell'identita' (dopo il login Google, chiamata dal server con service_role)
-- -----------------------------------------------------------------------------
create function public.identity_register(p_auth_user uuid, p_provider text, p_subject text, p_given_name text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id   uuid;
  v_name text := left(btrim(coalesce(p_given_name, '')), 40);
begin
  if not app.is_service() then raise exception 'forbidden' using errcode = 'CH004'; end if;
  if p_auth_user is null or p_provider not in ('google', 'demo') or coalesce(p_subject, '') = '' or v_name = '' then
    raise exception 'invalid_identity' using errcode = 'CH003';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('idreg:' || p_provider || '|' || p_subject, 0));
  select id into v_id from public.guest_identities where provider = p_provider and provider_subject = p_subject;
  if found then
    update public.guest_identities set given_name = v_name, auth_user_id = p_auth_user where id = v_id;
  else
    insert into public.guest_identities(provider, provider_subject, given_name, auth_user_id)
    values (p_provider, p_subject, v_name, p_auth_user) returning id into v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.identity_register(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.identity_register(uuid, text, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3. Nickname unico per hotel (riuso da start_stay e dal profilo sociale)
-- -----------------------------------------------------------------------------
create function app.social_unique_nick(p_hotel uuid, p_base text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_base text := p_base;
  v_nick text;
  i int := 1;
begin
  if not app.social_nick_ok(v_base) then v_base := 'Ospite'; end if;
  v_nick := v_base;
  while exists (select 1 from public.social_profiles where hotel_id = p_hotel and lower(nickname) = lower(v_nick)) loop
    i := i + 1;
    v_nick := left(v_base, 17) || ' ' || i;
  end loop;
  return v_nick;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Cancellazione dati dell'ospite (sostituisce app.purge_guest di 0001)
--    p_keep_auth = true: si cancella solo il soggiorno e i dati (usato quando lo stesso account rientra dopo
--    una scadenza non ancora ripulita dal job); false: si cancellano anche identita' e utente auth.
-- -----------------------------------------------------------------------------
drop function app.purge_guest(uuid);
create function app.purge_guest(p_guest uuid, p_keep_auth boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_auth  uuid;
  v_ident uuid;
begin
  select auth_user_id, identity_id into v_auth, v_ident from public.guests where id = p_guest;
  if not found then return; end if;

  -- libera capienza futura (il trigger aggiorna slots.booked_count)
  update public.bookings b set status = 'cancelled', cancelled_at = now()
    from public.slots s
   where b.guest_id = p_guest and s.id = b.slot_id and s.starts_at > now() and b.status = 'confirmed';
  update public.event_attendance a set status = 'cancelled'
    from public.events e
   where a.guest_id = p_guest and e.id = a.event_id and e.starts_at > now() and a.status = 'going';

  -- bonus non usato: annullato, libera il tetto (la chiave anti-doppione resta sulla riga anonima)
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

  -- la riga guests sparisce (le FK composite portano a NULL guest_id nelle tabelle storiche; il sociale va in cascata)
  delete from public.guests where id = p_guest;

  if not p_keep_auth then
    if v_ident is not null then
      delete from public.guest_identities gi where gi.id = v_ident
        and not exists (select 1 from public.guests g where g.identity_id = gi.id);
    end if;
    -- non si cancella mai un utente che e' anche staff di un hotel
    if v_auth is not null and not exists (select 1 from public.hotel_staff st where st.user_id = v_auth) then
      delete from auth.users where id = v_auth;
    end if;
  end if;
end $$;
revoke all on function app.purge_guest(uuid, boolean) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. start_stay: ingresso da QR con identita' (sostituisce la versione di 0001)
-- -----------------------------------------------------------------------------
drop function public.start_stay(uuid, text, text, text, text, date, boolean, bytea);
create function public.start_stay(
  p_auth_user        uuid,
  p_slug             text,
  p_qr_token         text,
  p_nickname         text,
  p_locale           text,
  p_checkout         date,
  p_is_adult         boolean,
  p_social_opt_in    boolean,
  p_identity_key     bytea,
  p_privacy_version  text default 'v1'
) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  h          public.hotels%rowtype;
  v_hash     bytea;
  v_ident    public.guest_identities%rowtype;
  v_guest    public.guests%rowtype;
  v_stay     public.stays%rowtype;
  v_today    date;
  v_exp      timestamptz;
  v_name     text;
  v_nick     text;
  v_bonus    text := 'disabled';
  v_adult    boolean := coalesce(p_is_adult, false);
begin
  if not app.is_service() then
    raise exception 'forbidden' using errcode = 'CH004';
  end if;
  if p_auth_user is null then raise exception 'identity_required' using errcode = 'CH004'; end if;

  -- serializza gli ingressi dello stesso account (doppio tocco, due schede): nessun doppione, nessun errore di unicita'
  perform pg_advisory_xact_lock(hashtextextended('stay:' || p_auth_user::text, 0));

  -- il lock sulla riga dell'hotel serializza il tetto orario dei bonus (il trigger del tetto stagionale lo prende comunque)
  select * into h from public.hotels where slug = p_slug and status = 'active' for update;
  if not found then raise exception 'invalid_qr' using errcode = 'CH003'; end if;

  v_hash := digest(coalesce(p_qr_token, ''), 'sha256');
  if not ((h.qr_token_hash is not null and h.qr_token_hash = v_hash)
       or (h.qr_token_prev_hash is not null and h.qr_token_prev_hash = v_hash
           and h.qr_prev_valid_until > now())) then
    raise exception 'invalid_qr' using errcode = 'CH003';
  end if;

  select * into v_ident from public.guest_identities where auth_user_id = p_auth_user;
  if not found then raise exception 'identity_required' using errcode = 'CH004'; end if;

  v_today := (now() at time zone h.timezone)::date;
  if (h.season_start is not null and v_today < h.season_start)
     or (h.season_end is not null and v_today > h.season_end) then
    raise exception 'out_of_season' using errcode = 'CH003';
  end if;
  if p_locale not in ('it','en','de','ru') then p_locale := h.default_locale; end if;
  if p_checkout is null or p_checkout < v_today or p_checkout > v_today + h.max_stay_days then
    raise exception 'invalid_checkout' using errcode = 'CH003';
  end if;
  if h.bonus_enabled and h.bonus_season_cap > 0 and p_identity_key is null then
    raise exception 'identity_key_required' using errcode = 'CH003';
  end if;

  -- Idempotenza: stesso account, stesso hotel, soggiorno ancora attivo
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
    -- soggiorno scaduto e non ancora ripulito dal job: si ripulisce ora (tenendo l'account) e si riparte
    perform app.purge_guest(v_guest.id, true);
  end if;

  -- nome mostrato = nome di battesimo dell'identita' (mai il cognome)
  v_name := left(btrim(v_ident.given_name), 24);
  if char_length(v_name) < 2 then v_name := 'Ospite'; end if;

  -- nickname: scelto dall'ospite oppure il nome di battesimo; sempre unico nell'hotel
  if p_nickname is not null and btrim(p_nickname) <> '' then
    v_nick := regexp_replace(app.social_normalize_text(p_nickname), '\s+', ' ', 'g');
    if not app.social_nick_ok(v_nick) then raise exception 'invalid_nickname' using errcode = 'CH003'; end if;
    if exists (select 1 from public.social_profiles where hotel_id = h.id and lower(nickname) = lower(v_nick)) then
      raise exception 'nickname_taken' using errcode = 'CH005';
    end if;
  else
    v_nick := app.social_unique_nick(h.id, split_part(v_name, ' ', 1));
  end if;

  -- Scadenza = giorno di check-out + orario di check-out dell'hotel (nel suo fuso),
  -- con un minimo di 3 ore da adesso per chi si registra il giorno della partenza.
  v_exp := greatest(((p_checkout + h.checkout_time)::timestamp at time zone h.timezone),
                    now() + interval '3 hours');

  insert into public.guests(hotel_id, auth_user_id, display_name, locale, is_adult, identity_id,
                            consent_at, privacy_version, adult_declared_at)
  values (h.id, p_auth_user, v_name, p_locale, v_adult, v_ident.id,
          now(), coalesce(p_privacy_version, 'v1'), case when v_adult then now() end)
  returning * into v_guest;

  insert into public.stays(hotel_id, guest_id, checkin_date, checkout_date, expires_at)
  values (h.id, v_guest.id, v_today, p_checkout, v_exp)
  returning * into v_stay;

  -- profilo sociale: nasce qui con la scelta esplicita dell'ospite (si compare solo se maggiorenne E se ha scelto)
  insert into public.social_profiles(hotel_id, guest_id, nickname, visible, stay_expires_at, opt_in_at)
  values (h.id, v_guest.id, v_nick, v_adult and coalesce(p_social_opt_in, false), v_exp,
          case when v_adult and coalesce(p_social_opt_in, false) then now() end);

  if h.bonus_enabled and h.bonus_season_cap > 0 then
    if p_identity_key is not null and exists (select 1 from public.welcome_bonuses
         where hotel_id = h.id and season_year = h.season_year and dedupe_key = p_identity_key and status in ('issued','redeemed')) then
      v_bonus := 'already_claimed';   -- stesso account: un solo bonus per hotel e stagione (vale prima del tetto)
    elsif (select count(*) from public.welcome_bonuses
         where hotel_id = h.id and issued_at > now() - interval '1 hour') >= h.bonus_max_per_hour then
      v_bonus := 'throttled';   -- tetto di bonus emessi nell'ora: l'ospite entra, il bonus non viene emesso
    else
      begin
        insert into public.welcome_bonuses(hotel_id, guest_id, stay_id, season_year, expires_at, dedupe_key)
        values (h.id, v_guest.id, v_stay.id, h.season_year, v_stay.expires_at, p_identity_key);
        v_bonus := 'issued';
      exception
        when sqlstate 'CH001' then v_bonus := 'cap_reached';
        when unique_violation then v_bonus := 'already_claimed';   -- stesso account: un solo bonus per hotel e stagione
      end;
    end if;
  end if;

  perform app.audit(h.id, 'stay.start', 'stay', v_stay.id, jsonb_build_object('bonus', v_bonus));
  return jsonb_build_object('guest_id', v_guest.id, 'stay_id', v_stay.id,
                            'expires_at', v_stay.expires_at, 'bonus', v_bonus);
end $$;
revoke all on function public.start_stay(uuid, text, text, text, text, date, boolean, boolean, bytea, text) from public, anon, authenticated;
grant execute on function public.start_stay(uuid, text, text, text, text, date, boolean, boolean, bytea, text) to service_role;

-- Locali: aggiunge il russo ai controlli (lingua di P0; l'interfaccia Next.js non lo ha ancora)
alter table public.guests            drop constraint guests_locale_check,            add constraint guests_locale_check            check (locale in ('it','en','de','ru'));
alter table public.hotels            drop constraint hotels_default_locale_check,    add constraint hotels_default_locale_check    check (default_locale in ('it','en','de','ru'));
alter table public.ai_knowledge      drop constraint ai_knowledge_locale_check,      add constraint ai_knowledge_locale_check      check (locale in ('it','en','de','ru'));
alter table public.ai_conversations  drop constraint ai_conversations_locale_check,  add constraint ai_conversations_locale_check  check (locale in ('it','en','de','ru'));

commit;
