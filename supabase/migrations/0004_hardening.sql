-- =============================================================================
-- ChatHel - migrazione 0004: correzioni della revisione backend (docs/10-revisione-backend.md)
--
-- Contenuto (le sigle sono quelle della revisione):
--  - B1 (opt-in perso) e B2 (demo) sono in 0003 / nel codice; qui: A1 privilegi (EXECUTE tolto ad anon e a PUBLIC, solo
--    public_hotel resta aperta), A2 concorrenza (advisory lock su profilo/ospite/hotel), A3 token con prefisso b. / c.,
--    A4 KPI con count(*) lato SQL (hotel_kpi_counts), A5 ospiti scaduti non visibili agli altri, A6 generate_slots
--    senza ciclo infinito, A7 push_subscription / auth_user_id / identity_id non leggibili dallo staff,
--    M1 tetti per hotel sui coupon, M2 limiti di frequenza in database (rate_limits, trigger sui messaggi AI),
--    M3 reception: solo conversazioni passate all'operatore, M4 messaggio assistente atomico con priorita',
--    M5 purge_expired_stays che non si ferma al primo errore + orfani, M6 parita' di normalizzazione testi/nickname,
--    M7 moderazione: l'hotel si ricava dall'oggetto (non "il primo hotel dello staff"), statistiche per hotel,
--    telefono della reception per il messaggio di emergenza, segnalazione "risposta sbagliata" una volta sola.
--
-- Requisiti: 0001, 0002, 0003. Provata su Postgres 16 (supabase/tests/*.sql, scripts/sql-test.sh). NON provata su Supabase reale.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Colonne e tabelle nuove
-- -----------------------------------------------------------------------------
alter table public.hotels
  add column coupon_daily_cap  int  not null default 60 check (coupon_daily_cap  >= 0),   -- coupon inviabili nel giorno, tutto l'hotel
  add column coupon_active_cap int  not null default 40 check (coupon_active_cap >= 0),   -- coupon in circolazione, tutto l'hotel
  add column reception_phone   text check (reception_phone is null or char_length(reception_phone) <= 40);
grant select (coupon_daily_cap, coupon_active_cap, reception_phone) on public.hotels to authenticated;
-- la reception puo' impostare il proprio numero; il tetto dei coupon lo decide ChatHel. bonus_dedupe_mode non e' piu' modificabile dall'hotel.
grant update (reception_phone) on public.hotels to authenticated;
revoke update (bonus_dedupe_mode) on public.hotels from authenticated;

alter table public.ai_conversations
  add column handoff_priority text not null default 'normal' check (handoff_priority in ('normal', 'urgent'));
create index ai_conversations_handoff_idx on public.ai_conversations(hotel_id, handoff_priority, handoff_at desc) where handoff_at is not null;

-- contatori di frequenza condivisi tra le istanze dell'applicazione (finestra fissa)
create table public.rate_limits (
  key           text primary key check (char_length(key) <= 200),
  window_start  timestamptz not null,
  n             int not null
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

create function app.rate_hit(p_key text, p_limit int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  -- l'upsert prende il lock sulla riga: due richieste parallele si contano entrambe
  insert into public.rate_limits as r(key, window_start, n) values (p_key, now(), 1)
  on conflict (key) do update
     set n = case when r.window_start <= now() - make_interval(secs => p_window_seconds) then 1 else r.n + 1 end,
         window_start = case when r.window_start <= now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning n into v_n;
  return v_n <= p_limit;
end $$;

create function public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_service() then raise exception 'forbidden' using errcode = 'CH004'; end if;
  if p_limit < 0 or p_window_seconds not between 1 and 86400 then raise exception 'invalid_input' using errcode = 'CH003'; end if;
  return app.rate_hit(p_key, p_limit, p_window_seconds);
end $$;

-- un solo "risposta sbagliata" per messaggio (la segnalazione ripetuta falsava l'indicatore I5)
create unique index audit_marked_wrong_once on public.audit_log ((meta ->> 'message_id')) where action = 'ai.marked_wrong';

-- -----------------------------------------------------------------------------
-- 2. Parita' di normalizzazione con il codice TypeScript (rules/social.ts)
--    Si tolgono caratteri di controllo e invisibili, si comprimono spazi e tabulazioni, tre o piu' a capo diventano due.
-- -----------------------------------------------------------------------------
create function app.social_normalize_text(p text) returns text
language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''),
           '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮]', '', 'g'),
           '[ \t]+', ' ', 'g'),
           '\n{3,}', E'\n\n', 'g'), E' \t\n\r\f\v\u00a0\ufeff')
$$;

-- Nickname: stesse regole di sanitizeNickname() (solo lettere, numeri, spazio . ' _ -; mai e-mail/link/numeri lunghi)
create or replace function app.social_nick_ok(p text) returns boolean
language sql immutable as $$
  select p is not null
     and char_length(p) between 2 and 20
     and p = btrim(p)
     and p ~ '^[[:alnum:] .''_-]+$'
     and regexp_replace(p, '[ .-]', '', 'g') !~ '[0-9]{5,}'
     and p !~* '(https?|www|\.com|\.it|\.de)'
     and p ~ '[[:alpha:]]'
$$;

-- -----------------------------------------------------------------------------
-- 3. Funzioni riscritte (concorrenza, scadenza, token, normalizzazione)
-- -----------------------------------------------------------------------------
create or replace function app.social_profile(p_write boolean default false) returns public.social_profiles
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
    -- un solo scrittore alla volta per profilo: i limiti (frequenza, tetti giornalieri) non si superano con richieste parallele
    perform pg_advisory_xact_lock(hashtextextended('soc:' || v_guest::text, 0));
    if p.rules_accepted_at is null then raise exception 'rules_required' using errcode = 'CH004'; end if;
    if p.muted_until is not null and p.muted_until > now() then raise exception 'muted' using errcode = 'CH004'; end if;
  end if;
  return p;
end $$;

create or replace function app.social_eligible(p_profile uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.social_profiles sp join public.guests g on g.id = sp.guest_id
                  where sp.id = p_profile and sp.visible and not sp.removed and g.is_adult
                    and sp.stay_expires_at > now())
$$;

create or replace function public.social_guests() returns table (id uuid, nickname text, locale text, can_message boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.social_profiles := app.social_profile(false);
begin
  return query
    select sp.id, sp.nickname, g.locale, sp.accepts_private
      from public.social_profiles sp join public.guests g on g.id = sp.guest_id
     where sp.hotel_id = me.hotel_id and sp.id <> me.id and sp.visible and not sp.removed and g.is_adult and sp.stay_expires_at > now()
       and not app.social_is_blocked(me.id, sp.id)
     order by sp.nickname;
end $$;

create or replace function public.social_feed() returns table (id uuid, author_id uuid, nickname text, body text, created_at timestamptz, mine boolean, reported_by_me boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.social_profiles := app.social_profile(false);
begin
  return query
    select * from (
      select m.id, m.author_id, sp.nickname, m.body, m.created_at, (m.author_id = me.id),
             exists (select 1 from public.social_reports r where r.kind = 'public' and r.message_id = m.id and r.reporter_id = me.id)
        from public.social_public_messages m join public.social_profiles sp on sp.id = m.author_id
       where m.hotel_id = me.hotel_id and not m.hidden and (sp.stay_expires_at > now() or sp.id = me.id) and not app.social_is_blocked(me.id, m.author_id)
       order by m.created_at desc limit 100) x
    order by x.created_at;
end $$;

create or replace function public.social_threads_list() returns table (id uuid, peer_id uuid, peer_nickname text, status public.thread_status, incoming boolean, last_at timestamptz, preview text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.social_profiles := app.social_profile(false);
begin
  return query
    select t.id, sp.id, sp.nickname, t.status, (t.recipient_id = me.id), t.last_at,
           coalesce((select left(m.body, 80) from public.social_messages m where m.thread_id = t.id and m.kind = 'text' order by m.created_at desc limit 1), '')
      from public.social_threads t
      join public.social_profiles sp on sp.id = case when t.initiator_id = me.id then t.recipient_id else t.initiator_id end
     where (t.initiator_id = me.id or t.recipient_id = me.id) and t.blocked_by is distinct from me.id
       and sp.stay_expires_at > now()
     order by t.last_at desc;
end $$;

create or replace function public.social_post_public(p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(true);
  v_body text := app.social_normalize_text(p_body);
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

create or replace function public.social_start_thread(p_to uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(true);
  v_body text := app.social_normalize_text(p_body);
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

create or replace function public.social_send_private(p_thread uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(true);
  v_body text := app.social_normalize_text(p_body);
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

create or replace function public.social_coupon_qr(p_coupon uuid) returns jsonb
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
  v_token := 'c.' || translate(encode(gen_random_bytes(18), 'base64'), '+/', '-_');
  v_exp := least(now() + interval '90 seconds', c.expires_at);
  insert into public.social_coupon_qrs(hotel_id, coupon_id, token_hash, expires_at) values (c.hotel_id, c.id, digest(v_token, 'sha256'), v_exp);
  return jsonb_build_object('token', v_token, 'expires_at', v_exp, 'kind', c.kind);
end $$;

create or replace function public.request_bonus_qr() returns jsonb
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

  if not app.rate_hit('bqr:' || v_guest::text, 30, 600) then raise exception 'rate_limited' using errcode = 'CH007'; end if;
  v_token := 'b.' || translate(encode(gen_random_bytes(18), 'base64'), '+/', '-_');   -- 144 bit
  v_exp := least(now() + make_interval(secs => h.bonus_qr_ttl_seconds), b.expires_at);
  insert into public.bonus_redemptions(hotel_id, bonus_id, token_hash, expires_at)
  values (b.hotel_id, b.id, digest(v_token, 'sha256'), v_exp);

  return jsonb_build_object('token', v_token, 'expires_at', v_exp, 'label', h.bonus_label);
end $$;

create or replace function public.social_update_settings(p_visible boolean default null, p_accepts_private boolean default null, p_nickname text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p public.social_profiles := app.social_ensure_profile();
  v_adult boolean := (select is_adult from public.guests where id = p.guest_id);
begin
  if p_nickname is not null then
    p_nickname := regexp_replace(app.social_normalize_text(p_nickname), '\s+', ' ', 'g');
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

-- Ospiti che ho bloccato (per poterli sbloccare): id sociale e nickname, nient'altro
create function public.social_blocked() returns table (id uuid, nickname text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.social_profiles := app.social_profile(false);
begin
  return query select sp.id, sp.nickname from public.social_blocks b join public.social_profiles sp on sp.id = b.target_id
   where b.by_id = me.id order by sp.nickname;
end $$;

-- Id dell'ospite dell'utente corrente (null se il soggiorno non e' attivo): il filtro per auth_user_id non e' piu' possibile dal client
create function public.current_guest_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$ select app.my_guest_id() $$;

-- Coupon: tetti per ospite (come prima) e per hotel (nuovo). I lock sul profilo (social_profile(true)) e sull'hotel
-- rendono il controllo e la scrittura un'unica sezione critica.
create or replace function public.social_send_coupon(p_thread uuid, p_kind public.coupon_kind) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(true);
  h public.hotels;
  v_peer uuid;
  v_exp timestamptz;
  v_peer_exp timestamptz;
  v_id uuid;
begin
  v_peer := app.social_open_peer(me, p_thread);
  perform pg_advisory_xact_lock(hashtextextended('hcoupon:' || me.hotel_id::text, 0));
  select * into h from public.hotels where id = me.hotel_id;
  if (select count(*) from public.social_coupons where sender_id = me.id and created_at >= app.hotel_day_start(me.hotel_id)) >= 3 then
    raise exception 'coupon_daily_limit' using errcode = 'CH007';
  end if;
  if (select count(*) from public.social_coupons where sender_id = me.id and status = 'issued' and expires_at > now()) >= 5 then
    raise exception 'coupon_active_limit' using errcode = 'CH007';
  end if;
  if (select count(*) from public.social_coupons where hotel_id = me.hotel_id and created_at >= app.hotel_day_start(me.hotel_id)) >= h.coupon_daily_cap
     or (select count(*) from public.social_coupons where hotel_id = me.hotel_id and status = 'issued' and expires_at > now()) >= h.coupon_active_cap then
    raise exception 'hotel_coupon_limit' using errcode = 'CH007';
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

-- Prenotazione: serializza per ospite (tetto giornaliero) e controlla che il servizio sia attivo.
create or replace function public.book_slot(p_slot uuid, p_party_size int default 1) returns uuid
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
  perform pg_advisory_xact_lock(hashtextextended('book:' || v_guest::text, 0));

  select * into s from public.slots where id = p_slot and hotel_id = v_hotel;
  if not found or s.status <> 'open' or s.starts_at <= now()
     or not exists (select 1 from public.facilities f where f.id = s.facility_id and f.hotel_id = v_hotel and f.active) then
    raise exception 'slot_unavailable' using errcode = 'CH003';
  end if;
  select * into h from public.hotels where id = v_hotel;

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

-- Generazione slot: si avanza su timestamp (non su "time", che a 24:00 ricomincia da 00:00 e non finiva mai)
create or replace function public.generate_slots(
  p_facility uuid, p_from date, p_to date, p_start time, p_end time,
  p_minutes int, p_capacity int default null
) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f public.facilities%rowtype;
  h public.hotels%rowtype;
  d date;
  v_cur timestamp;
  v_end timestamp;
  v_ts timestamptz;
  v_step interval;
  v_cap int;
  v_n int := 0;
  v_rows int;
begin
  select * into f from public.facilities where id = p_facility;
  if not found or f.hotel_id not in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])) then
    raise exception 'forbidden' using errcode = 'CH004';
  end if;
  if p_minutes is null or p_minutes not between 15 and 480 or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92
     or p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid_range' using errcode = 'CH003';
  end if;
  if p_capacity is not null and p_capacity < 1 then raise exception 'invalid_range' using errcode = 'CH003'; end if;
  select * into h from public.hotels where id = f.hotel_id;
  v_cap := coalesce(p_capacity, f.default_capacity);
  v_step := make_interval(mins => p_minutes);

  d := p_from;
  while d <= p_to loop
    v_cur := d + p_start;
    v_end := d + p_end;
    while v_cur + v_step <= v_end loop
      v_ts := v_cur at time zone h.timezone;
      -- un orario locale che non esiste (salto all'ora legale) non genera slot; la durata e'' sempre quella richiesta
      if (v_ts at time zone h.timezone) = v_cur then
        insert into public.slots(hotel_id, facility_id, starts_at, ends_at, capacity)
        values (f.hotel_id, f.id, v_ts, v_ts + v_step, v_cap)
        on conflict (facility_id, starts_at) do nothing;
        get diagnostics v_rows = row_count;
        v_n := v_n + v_rows;
      end if;
      v_cur := v_cur + v_step;       -- sempre in avanti: il ciclo termina
    end loop;
    d := d + 1;
  end loop;
  return v_n;
end $$;

-- Contesto AI: aggiunge il telefono della reception (serve al messaggio fisso di emergenza)
create or replace function public.ai_context() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_guest uuid := app.my_guest_id();
  v_hotel uuid := app.my_hotel_id();
begin
  if v_guest is null then raise exception 'forbidden' using errcode = 'CH004'; end if;
  return jsonb_build_object(
    'hotel', (select jsonb_build_object('name', h.name, 'default_locale', h.default_locale, 'timezone', h.timezone,
                                        'reception_phone', h.reception_phone)
                from public.hotels h where h.id = v_hotel),
    'knowledge', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', k.id, 'category', k.category, 'title', k.title,
                    'content', k.content, 'locale', k.locale) order by k.sort_order, k.created_at)
                  from public.ai_knowledge k where k.hotel_id = v_hotel and k.active), '[]'::jsonb));
end $$;

-- -----------------------------------------------------------------------------
-- 4. Reception AI: solo conversazioni passate all'operatore; limiti in database; messaggio assistente atomico
-- -----------------------------------------------------------------------------
drop policy conv_select_staff on public.ai_conversations;
create policy conv_select_staff on public.ai_conversations for select to authenticated
  using (handoff_at is not null and hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));
drop policy conv_update_staff on public.ai_conversations;
create policy conv_update_staff on public.ai_conversations for update to authenticated
  using (handoff_at is not null and hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])))
  with check (handoff_at is not null and hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));
drop policy messages_select_staff on public.ai_messages;
create policy messages_select_staff on public.ai_messages for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[]))
         and exists (select 1 from public.ai_conversations c
                      where c.id = conversation_id and c.hotel_id = ai_messages.hotel_id and c.handoff_at is not null));
drop policy messages_insert_operator on public.ai_messages;
create policy messages_insert_operator on public.ai_messages for insert to authenticated
  with check (role = 'operator'
              and hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[]))
              and staff_id = (select app.my_staff_id(hotel_id))
              and exists (select 1 from public.ai_conversations c
                           where c.id = conversation_id and c.hotel_id = ai_messages.hotel_id and c.handoff_at is not null));

-- Rete di sicurezza in database contro i messaggi in massa (l'ospite scrive con il proprio JWT).
-- I tetti "veri" (12 al minuto, 30 al giorno) li applica l'applicazione, che sa riconoscere un'emergenza e farla passare;
-- qui, dove l'emergenza non e' distinguibile, i valori sono piu' larghi (20 al minuto, 100 al giorno, 1000 caratteri).
create function app.ai_guest_message_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_guest uuid;
begin
  if new.role <> 'guest' then return new; end if;
  if char_length(new.content) > 1000 then raise exception 'too_long' using errcode = 'CH003'; end if;
  select guest_id into v_guest from public.ai_conversations where id = new.conversation_id;
  if v_guest is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('aimsg:' || v_guest::text, 0));
  if (select count(*) from public.ai_messages m join public.ai_conversations c on c.id = m.conversation_id
       where c.guest_id = v_guest and m.role = 'guest' and m.created_at > now() - interval '60 seconds') >= 20 then
    raise exception 'rate_limited' using errcode = 'CH007';
  end if;
  if (select count(*) from public.ai_messages m join public.ai_conversations c on c.id = m.conversation_id
       where c.guest_id = v_guest and m.role = 'guest' and m.created_at >= app.hotel_day_start(new.hotel_id)) >= 100 then
    raise exception 'daily_limit' using errcode = 'CH007';
  end if;
  return new;
end $$;
create trigger ai_messages_guest_guard before insert on public.ai_messages
  for each row execute function app.ai_guest_message_guard();

-- Risposta dell'assistente: scrittura + contatore + passaggio all'operatore in una sola transazione (prima: lettura e
-- scrittura separate, il contatore perdeva colpi). Chiamata solo dal server (service_role) dopo aver verificato l'ospite.
create function public.append_assistant_message(
  p_conversation uuid, p_content text, p_tokens_in int default null, p_tokens_out int default null,
  p_handoff_reason public.handoff_reason default null, p_handoff_topic text default null, p_priority text default 'normal'
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.ai_conversations;
begin
  if not app.is_service() then raise exception 'forbidden' using errcode = 'CH004'; end if;
  if p_priority not in ('normal', 'urgent') then raise exception 'invalid_input' using errcode = 'CH003'; end if;
  select * into c from public.ai_conversations where id = p_conversation for update;
  if not found then raise exception 'invalid_conversation' using errcode = 'CH003'; end if;
  insert into public.ai_messages(hotel_id, conversation_id, role, content, tokens_in, tokens_out)
  values (c.hotel_id, c.id, 'assistant', p_content, p_tokens_in, p_tokens_out);
  if p_handoff_reason is not null then
    update public.ai_conversations
       set last_message_at = now(),
           status = case when status = 'ai' then 'handoff_pending'::public.conversation_status else status end,
           handoff_at = coalesce(handoff_at, now()),
           handoff_reason = case when p_priority = 'urgent' or handoff_reason is null then p_handoff_reason else handoff_reason end,
           handoff_topic = coalesce(left(p_handoff_topic, 120), handoff_topic),
           handoff_priority = case when p_priority = 'urgent' then 'urgent' else handoff_priority end
     where id = c.id;
  else
    update public.ai_conversations set last_message_at = now(), ai_answer_count = ai_answer_count + 1 where id = c.id;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Dati personali dell'ospite: colonne che lo staff non deve leggere (A7)
-- -----------------------------------------------------------------------------
revoke select on public.guests from authenticated;
grant select (id, hotel_id, display_name, locale, is_adult, notifications_seen_at, created_at, consent_at, privacy_version, adult_declared_at)
  on public.guests to authenticated;
-- la sottoscrizione push resta scrivibile dall'ospite (update) ma non e' leggibile da nessun client: la usa solo il server

-- -----------------------------------------------------------------------------
-- 6. Moderazione sociale: l'hotel si ricava dall'oggetto, non "il primo hotel dello staff" (M7)
-- -----------------------------------------------------------------------------
create function app.social_staff_in(p_hotel uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_hotel is null or not exists (select 1 from app.social_report_staff_hotels() h where h = p_hotel) then
    raise exception 'forbidden' using errcode = 'CH004';
  end if;
  return p_hotel;
end $$;

create function app.social_staff_any() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from app.social_report_staff_hotels()) then raise exception 'forbidden' using errcode = 'CH004'; end if;
end $$;

create or replace function public.social_hide_message(p_message uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hotel uuid;
begin
  perform app.social_staff_any();
  v_hotel := (select hotel_id from public.social_public_messages where id = p_message);
  if v_hotel is null then raise exception 'invalid_message' using errcode = 'CH003'; end if;
  perform app.social_staff_in(v_hotel);
  update public.social_public_messages set hidden = p_hidden, hidden_at = case when p_hidden then now() end where id = p_message;
  if p_hidden then
    update public.social_reports set status = 'actioned', closed_at = now()
     where hotel_id = v_hotel and kind = 'public' and message_id = p_message and status = 'open';
  end if;
  perform app.audit(v_hotel, case when p_hidden then 'social.hide' else 'social.unhide' end, 'social_message', p_message);
end $$;

create or replace function public.social_mute(p_profile uuid, p_until timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hotel uuid;
begin
  perform app.social_staff_any();
  v_hotel := (select hotel_id from public.social_profiles where id = p_profile);
  if v_hotel is null then raise exception 'invalid_guest' using errcode = 'CH003'; end if;
  perform app.social_staff_in(v_hotel);
  update public.social_profiles set muted_until = p_until where id = p_profile;
  perform app.audit(v_hotel, case when p_until is null then 'social.unmute' else 'social.mute' end, 'social_profile', p_profile);
end $$;

create or replace function public.social_set_removed(p_profile uuid, p_removed boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hotel uuid;
begin
  perform app.social_staff_any();
  v_hotel := (select hotel_id from public.social_profiles where id = p_profile);
  if v_hotel is null then raise exception 'invalid_guest' using errcode = 'CH003'; end if;
  perform app.social_staff_in(v_hotel);
  update public.social_profiles set removed = p_removed, visible = case when p_removed then false else visible end where id = p_profile;
  perform app.audit(v_hotel, case when p_removed then 'social.remove' else 'social.restore' end, 'social_profile', p_profile);
end $$;

create or replace function public.social_close_report(p_report uuid, p_outcome public.report_status) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hotel uuid;
begin
  perform app.social_staff_any();
  v_hotel := (select hotel_id from public.social_reports where id = p_report);
  if p_outcome not in ('actioned', 'dismissed') then raise exception 'invalid_input' using errcode = 'CH003'; end if;
  if v_hotel is null then raise exception 'invalid_report' using errcode = 'CH003'; end if;
  perform app.social_staff_in(v_hotel);
  update public.social_reports set status = p_outcome, closed_at = now() where id = p_report and status = 'open';
  if not found then raise exception 'report_closed' using errcode = 'CH005'; end if;
end $$;

-- Statistiche: con piu' hotel si indica quale (p_hotel); con uno solo si puo' omettere.
drop function public.social_stats(text);
create function public.social_stats(p_period text default '7d', p_hotel uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hotel uuid;
  v_from timestamptz;
begin
  if p_hotel is null then
    if (select count(*) from app.social_report_staff_hotels()) > 1 then raise exception 'hotel_required' using errcode = 'CH003'; end if;
    v_hotel := (select h from app.social_report_staff_hotels() h limit 1);
  else
    v_hotel := p_hotel;
  end if;
  perform app.social_staff_in(v_hotel);
  v_from := case p_period when 'today' then app.hotel_day_start(v_hotel) when '7d' then now() - interval '7 days' else '-infinity'::timestamptz end;
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

-- -----------------------------------------------------------------------------
-- 7. KPI con aggregazioni SQL (A4). Stesse definizioni di computeKpis() in src/lib/kpi.ts.
--    Solo il direttore dell'hotel (o service_role) puo' chiamarla. Nessun dato personale: solo conteggi.
-- -----------------------------------------------------------------------------
create function public.hotel_kpi_counts(p_hotel uuid, p_period text default '7d') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  h public.hotels;
  v_from timestamptz;
  v_res jsonb;
begin
  if not app.is_service() and (p_hotel is null or p_hotel not in (select app.staff_hotel_ids(array['hotel_admin']::public.app_role[]))) then
    raise exception 'forbidden' using errcode = 'CH004';
  end if;
  select * into h from public.hotels where id = p_hotel;
  if not found then raise exception 'forbidden' using errcode = 'CH004'; end if;
  v_from := case p_period when 'today' then app.hotel_day_start(p_hotel) when '7d' then now() - interval '7 days'
                          when 'season' then '-infinity'::timestamptz else null end;
  if v_from is null then raise exception 'invalid_input' using errcode = 'CH003'; end if;

  with first_action as (
    select s.id as stay_id, s.started_at,
           least(
             (select min(b.created_at) from public.bookings b where b.guest_id = s.guest_id),
             (select min(a.created_at) from public.event_attendance a where a.guest_id = s.guest_id),
             (select min(c.started_at) from public.ai_conversations c where c.guest_id = s.guest_id),
             (select min(r.redeemed_at) from public.bonus_redemptions r join public.welcome_bonuses w on w.id = r.bonus_id
               where w.guest_id = s.guest_id and r.status = 'redeemed')
           ) as first_at
      from public.stays s
     where s.hotel_id = p_hotel and s.guest_id is not null and s.started_at >= v_from and s.started_at <= now()
  )
  select jsonb_build_object(
    'stays_started',     (select count(*) from public.stays s where s.hotel_id = p_hotel and s.started_at >= v_from and s.started_at <= now()),
    'bonuses_issued',    (select count(*) from public.welcome_bonuses w where w.hotel_id = p_hotel and w.season_year = h.season_year and w.issued_at >= v_from and w.issued_at <= now()),
    'bonuses_redeemed',  (select count(*) from public.bonus_redemptions r where r.hotel_id = p_hotel and r.status = 'redeemed' and r.redeemed_at >= v_from and r.redeemed_at <= now()),
    'cap_used',          (select count(*) from public.welcome_bonuses w where w.hotel_id = p_hotel and w.season_year = h.season_year and w.status in ('issued','redeemed')),
    'bookings',          (select count(*) from public.bookings b where b.hotel_id = p_hotel and b.status in ('confirmed','attended') and b.created_at >= v_from and b.created_at <= now()),
    'per_facility',      coalesce((select jsonb_agg(jsonb_build_object('facility_id', f.id, 'name', f.name,
                             'booked_seats', coalesce((select sum(x.booked_count) from public.slots x where x.facility_id = f.id and x.starts_at < now() and x.starts_at >= v_from), 0),
                             'available_seats', coalesce((select sum(x.capacity) from public.slots x where x.facility_id = f.id and x.starts_at < now() and x.starts_at >= v_from), 0))
                             order by f.created_at) from public.facilities f where f.hotel_id = p_hotel), '[]'::jsonb),
    'events',            coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'rsvps', q.n) order by e.starts_at)
                             from (select a.event_id, count(*) n from public.event_attendance a
                                    where a.hotel_id = p_hotel and a.status in ('going','attended') and a.created_at >= v_from and a.created_at <= now()
                                    group by a.event_id) q join public.events e on e.id = q.event_id), '[]'::jsonb),
    'conversations',     (select count(*) from public.ai_conversations c where c.hotel_id = p_hotel and c.started_at >= v_from and c.started_at <= now()),
    'resolved_by_ai',    (select count(*) from public.ai_conversations c where c.hotel_id = p_hotel and c.started_at >= v_from and c.started_at <= now() and c.handoff_at is null and c.ai_answer_count > 0),
    'handoffs',          (select count(*) from public.ai_conversations c where c.hotel_id = p_hotel and c.started_at >= v_from and c.started_at <= now() and c.handoff_at is not null),
    'ai_answers',        (select coalesce(sum(c.ai_answer_count), 0) from public.ai_conversations c where c.hotel_id = p_hotel and c.started_at >= v_from and c.started_at <= now()),
    'wrong_marked',      (select count(*) from public.audit_log l where l.hotel_id = p_hotel and l.action = 'ai.marked_wrong' and l.created_at >= v_from and l.created_at <= now()),
    'i6_base',           (select count(*) from first_action),
    'i6_engaged',        (select count(*) from first_action where first_at is not null),
    'i6_24h',            (select count(*) from first_action where first_at is not null and first_at - started_at <= interval '24 hours'),
    'i6_72h',            (select count(*) from first_action where first_at is not null and first_at - started_at <= interval '72 hours')
  ) into v_res;
  return v_res;
end $$;

-- -----------------------------------------------------------------------------
-- 8. Pulizia periodica (M5): un errore su un ospite non blocca gli altri; si ripuliscono anche le identita' orfane
-- -----------------------------------------------------------------------------
create or replace function public.purge_expired_stays() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  n int := 0;
  v_failed int := 0;
begin
  update public.stays set status = 'ended', ended_at = now(), end_reason = 'expired'
   where status = 'active' and expires_at <= now();
  update public.welcome_bonuses set status = 'expired' where status = 'issued' and expires_at <= now();
  update public.bonus_redemptions set status = 'expired' where status = 'pending' and expires_at <= now();

  for r in select distinct guest_id from public.stays where guest_id is not null and status in ('ended','revoked')
           union
           select g.id from public.guests g
            where g.created_at < now() - interval '2 days'
              and not exists (select 1 from public.stays s where s.guest_id = g.id and s.status = 'active' and s.expires_at > now()) loop
    begin
      perform app.purge_guest(r.guest_id);
      n := n + 1;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.audit_log(action, entity, entity_id, meta) values ('purge.failed', 'guest', r.guest_id, jsonb_build_object('sqlstate', sqlstate));
    end;
  end loop;

  -- identita' senza soggiorno (login Google fatto, QR mai usato): dopo un giorno si cancellano, con l'utente auth (mai uno staff)
  for r in select gi.id, gi.auth_user_id from public.guest_identities gi
            where gi.created_at < now() - interval '1 day'
              and not exists (select 1 from public.guests g where g.identity_id = gi.id) loop
    begin
      delete from public.guest_identities where id = r.id;
      if not exists (select 1 from public.hotel_staff st where st.user_id = r.auth_user_id)
         and not exists (select 1 from public.guests g where g.auth_user_id = r.auth_user_id) then
        delete from auth.users where id = r.auth_user_id;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.audit_log(action, entity, entity_id, meta) values ('purge.failed', 'identity', r.id, jsonb_build_object('sqlstate', sqlstate));
    end;
  end loop;

  delete from public.rate_limits where window_start < now() - interval '2 days';
  if v_failed > 0 then
    insert into public.audit_log(action, entity, meta) values ('purge.errors', 'job', jsonb_build_object('failed', v_failed));
  end if;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- 9. Privilegi (A1): niente EXECUTE a PUBLIC/anon. Sola eccezione: public_hotel (pagina di ingresso del QR).
-- -----------------------------------------------------------------------------
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema app revoke execute on functions from public, anon, authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function public.public_hotel(text) to anon, authenticated;

-- gli helper delle policy e dei vincoli devono poter essere eseguiti da chi legge
grant execute on function app.is_service(), app.raw_guest_id(), app.my_guest_id(), app.my_hotel_id(),
  app.staff_hotel_ids(public.app_role[]), app.my_staff_id(uuid), app.social_report_staff_hotels(), app.hotel_day_start(uuid),
  app.social_nick_ok(text), app.social_normalize_text(text)
  to authenticated, service_role;
grant execute on all functions in schema app to service_role;

-- RPC pubbliche (schema public) riservate al server
revoke execute on function public.rate_limit_hit(text, int, int), public.append_assistant_message(uuid, text, int, int, public.handoff_reason, text, text),
  public.hotel_kpi_counts(uuid, text) from public, anon;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
grant execute on function public.append_assistant_message(uuid, text, int, int, public.handoff_reason, text, text) to service_role;
grant execute on function public.hotel_kpi_counts(uuid, text) to authenticated, service_role;
grant execute on function public.social_stats(text, uuid) to authenticated;

-- le funzioni riscritte con "create or replace" mantengono i privilegi; si riconfermano per chiarezza
grant execute on function public.social_blocked(), public.current_guest_id(), public.social_update_settings(boolean, boolean, text), public.request_bonus_qr(), public.book_slot(uuid, int), public.generate_slots(uuid,date,date,time,time,int,int),
  public.ai_context(), public.social_send_coupon(uuid, public.coupon_kind), public.social_coupon_qr(uuid),
  public.social_guests(), public.social_feed(), public.social_threads_list(),
  public.social_post_public(text), public.social_start_thread(uuid, text), public.social_send_private(uuid, text),
  public.social_hide_message(uuid, boolean), public.social_mute(uuid, timestamptz), public.social_set_removed(uuid, boolean),
  public.social_close_report(uuid, public.report_status)
  to authenticated;
revoke execute on function public.purge_expired_stays() from public, anon, authenticated;
grant execute on function public.purge_expired_stays() to service_role;

commit;
