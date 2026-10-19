-- 0005: codice numerico dell'hotel (6 cifre) come ingresso alternativo al QR.
-- L'ospite digita il codice, il server ricava l'hotel (hotel_by_code) e l'ingresso passa dagli stessi controlli del QR
-- (identita' verificata, limiti anti-abuso, stagione, soggiorno): il codice vale come il token del QR.

alter table public.hotels add column access_code text;
alter table public.hotels add constraint hotels_access_code_fmt check (access_code is null or access_code ~ '^[0-9]{6}$');
create unique index hotels_access_code_uidx on public.hotels (access_code) where access_code is not null;

-- nuovo codice casuale non in uso (6 cifre, senza zeri iniziali per evitare errori di digitazione)
create function app.new_access_code() returns text
language plpgsql volatile set search_path = public, extensions, pg_temp as $$
declare c text;
begin
  loop
    c := (100000 + floor(random() * 900000))::int::text;
    exit when not exists (select 1 from public.hotels where access_code = c);
  end loop;
  return c;
end $$;
revoke all on function app.new_access_code() from public, anon, authenticated;

update public.hotels set access_code = app.new_access_code() where access_code is null;

-- ricerca dell'hotel dal codice: solo il server (service_role), con i suoi limiti di frequenza
create function public.hotel_by_code(p_code text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_slug text;
begin
  if not app.is_service() then raise exception 'forbidden' using errcode = 'CH004'; end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' then return null; end if;
  select slug into v_slug from public.hotels where access_code = p_code and status = 'active';
  return v_slug;
end $$;
revoke all on function public.hotel_by_code(text) from public, anon, authenticated;
grant execute on function public.hotel_by_code(text) to service_role;

-- codice corrente (lo vede solo l'amministratore dell'hotel)
create function public.get_hotel_access_code(p_hotel uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text;
begin
  if not (app.is_service() or p_hotel in (select app.staff_hotel_ids(array['hotel_admin']::public.app_role[]))) then
    raise exception 'forbidden' using errcode = 'CH004';
  end if;
  select access_code into v from public.hotels where id = p_hotel;
  return v;
end $$;
revoke all on function public.get_hotel_access_code(uuid) from public, anon;
grant execute on function public.get_hotel_access_code(uuid) to authenticated, service_role;

-- nuovo codice (il precedente smette di valere subito: e' un codice digitato, non stampato in un QR)
create function public.rotate_hotel_access_code(p_hotel uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text;
begin
  if not (app.is_service() or p_hotel in (select app.staff_hotel_ids(array['hotel_admin']::public.app_role[]))) then
    raise exception 'forbidden' using errcode = 'CH004';
  end if;
  v := app.new_access_code();
  update public.hotels set access_code = v where id = p_hotel;
  perform app.audit(p_hotel, 'hotel.access_code_rotate', 'hotel', p_hotel);
  return v;
end $$;
revoke all on function public.rotate_hotel_access_code(uuid) from public, anon;
grant execute on function public.rotate_hotel_access_code(uuid) to authenticated, service_role;

-- start_stay: accetta anche il codice numerico (stessa firma di 0003: i privilegi restano)
create or replace function public.start_stay(
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

  -- p_qr_token e' il token del QR oppure il codice numerico dell'hotel (6 cifre)
  v_hash := digest(coalesce(p_qr_token, ''), 'sha256');
  if not ((h.qr_token_hash is not null and h.qr_token_hash = v_hash)
       or (h.qr_token_prev_hash is not null and h.qr_token_prev_hash = v_hash
           and h.qr_prev_valid_until > now())
       or (h.access_code is not null and p_qr_token ~ '^[0-9]{6}$' and h.access_code = p_qr_token)) then
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
