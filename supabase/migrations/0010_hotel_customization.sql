-- 0010: personalizzazione dell'hotel (logo, foto di copertina, messaggio di benvenuto) e interruttori delle funzioni.
--
-- - Logo e copertina: immagini nel bucket di Storage "hotel-media" (lettura pubblica). Le carica SOLO il server con la
--   chiave di servizio, dopo aver verificato che chi le invia e' il direttore (hotel_admin) dell'hotel: nessuna policy di
--   scrittura su storage.objects per i client. Per lo stesso motivo logo_url non e' piu' modificabile dai client.
-- - Benvenuto: testo in 4 lingue (max 500 caratteri ciascuno); l'app ripiega sulla lingua predefinita dell'hotel.
-- - Interruttori: chiave mancante = funzione accesa. "social" e' l'interruttore generale (elenco ospiti, chat pubblica,
--   chat private, coupon, sfide): spento lui, sono spente anche public_chat, challenges e coupons.
--   Una funzione spenta: l'app la nasconde, le API rispondono 403 e qui il database rifiuta le nuove scritture
--   (doc 09, S5). Spegnere NON cancella nulla: riaccendendo si ritrova tutto.
-- Da eseguire in Supabase PRIMA di pubblicare il codice che la usa.

-- -----------------------------------------------------------------------------
-- 1. Controlli dei valori
-- -----------------------------------------------------------------------------
create function app.valid_welcome(j jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(j) = 'object' and not exists (
    select 1 from jsonb_each(j) e
     where e.key not in ('it', 'en', 'de', 'ru') or jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') > 500)
$$;

create function app.valid_features(j jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(j) = 'object' and not exists (
    select 1 from jsonb_each(j) e
     where e.key not in ('social', 'public_chat', 'challenges', 'coupons', 'bookings', 'reception') or jsonb_typeof(e.value) <> 'boolean')
$$;
grant execute on function app.valid_welcome(jsonb), app.valid_features(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Colonne dell'hotel
-- -----------------------------------------------------------------------------
alter table public.hotels
  add column cover_url text check (cover_url is null or (char_length(cover_url) <= 500 and cover_url ~ '^(/[^/]|https://)')),
  add column welcome   jsonb not null default '{}'::jsonb check (app.valid_welcome(welcome)),
  add column features  jsonb not null default '{}'::jsonb check (app.valid_features(features));
-- stesso controllo per il logo (not valid: eventuali valori gia' presenti non bloccano la migrazione)
alter table public.hotels add constraint hotels_logo_url_check
  check (logo_url is null or (char_length(logo_url) <= 500 and logo_url ~ '^(/[^/]|https://)')) not valid;

grant select (cover_url, welcome, features) on public.hotels to authenticated;
-- il direttore cambia benvenuto e interruttori (policy hotels_update: solo hotel_admin); le immagini solo dal server
grant update (welcome, features) on public.hotels to authenticated;
revoke update (logo_url) on public.hotels from authenticated;

-- pagina d'ingresso (anonima): anche la copertina. Cambia il tipo restituito, quindi si ricrea.
drop function public.public_hotel(text);
create function public.public_hotel(p_slug text)
returns table (name text, logo_url text, cover_url text, default_locale text, supported_locales text[])
language sql stable security definer set search_path = public, pg_temp as $$
  select h.name, h.logo_url, h.cover_url, h.default_locale, h.supported_locales
    from public.hotels h where h.slug = p_slug and h.status = 'active'
$$;
revoke all on function public.public_hotel(text) from public;
grant execute on function public.public_hotel(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Interruttori: lettura e blocco delle scritture
-- -----------------------------------------------------------------------------
create function app.feature_on(p_hotel uuid, p_key text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select coalesce((h.features ->> p_key)::boolean, true)
       and (p_key not in ('public_chat', 'challenges', 'coupons') or coalesce((h.features ->> 'social')::boolean, true))
      from public.hotels h where h.id = p_hotel), false)
$$;
revoke all on function app.feature_on(uuid, text) from public, anon;
grant execute on function app.feature_on(uuid, text) to authenticated, service_role;

-- trigger generico: tg_argv[0] = chiave della funzione
create function app.require_feature() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.feature_on(new.hotel_id, tg_argv[0]) then
    raise exception 'feature_disabled' using errcode = 'CH004';
  end if;
  return new;
end $$;

-- sfide: sempre "challenges"; quelle nella chat pubblica (senza conversazione) anche "public_chat"
create function app.require_challenge_feature() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.feature_on(new.hotel_id, 'challenges') or (new.thread_id is null and not app.feature_on(new.hotel_id, 'public_chat')) then
    raise exception 'feature_disabled' using errcode = 'CH004';
  end if;
  return new;
end $$;

create trigger social_public_messages_feature before insert on public.social_public_messages
  for each row execute function app.require_feature('public_chat');
create trigger social_threads_feature before insert on public.social_threads
  for each row execute function app.require_feature('social');
create trigger social_coupons_feature before insert on public.social_coupons
  for each row execute function app.require_feature('coupons');
create trigger social_challenges_feature before insert on public.social_challenges
  for each row execute function app.require_challenge_feature();
create trigger bookings_feature before insert on public.bookings
  for each row execute function app.require_feature('bookings');
-- reception AI: si fermano i messaggi dell'ospite (le risposte dello staff a conversazioni aperte restano possibili)
create trigger ai_messages_feature before insert on public.ai_messages
  for each row when (new.role = 'guest') execute function app.require_feature('reception');

-- profilo sociale (usato da tutte le funzioni sociali dell'ospite): con "social" spento niente letture ne' scritture.
-- Uguale alla versione di 0004 piu' il controllo dell'interruttore.
create or replace function app.social_profile(p_write boolean default false) returns public.social_profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_guest uuid := app.my_guest_id();
  g public.guests;
  p public.social_profiles;
begin
  if v_guest is null then raise exception 'forbidden' using errcode = 'CH004'; end if;
  select * into g from public.guests where id = v_guest;
  if not app.feature_on(g.hotel_id, 'social') then raise exception 'feature_disabled' using errcode = 'CH004'; end if;
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

-- -----------------------------------------------------------------------------
-- 4. Bucket delle immagini (solo dove esiste lo schema storage di Supabase)
-- -----------------------------------------------------------------------------
-- Lettura pubblica tramite l'indirizzo pubblico; nessuna policy per anon/authenticated su storage.objects:
-- carica e cancella solo il server (service_role). Massimo 2 MB, solo JPG, PNG e WebP (niente SVG).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('hotel-media', 'hotel-media', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
