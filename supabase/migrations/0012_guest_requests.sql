-- 0012: richieste degli ospiti (Chathel Staff).
--
-- L'ospite chiede qualcosa (pulizia, guasto, oggetti per la camera...) scegliendo una categoria; la richiesta va al reparto
-- giusto; lo staff la prende in carico e la chiude; l'ospite puo' dire se e' andato tutto bene. Il pannello misura i tempi.
-- - Ruolo nuovo "team" (personale di reparto) con il proprio reparto in hotel_staff.department: vede SOLO le richieste del
--   suo reparto (categoria, nota, luogo, nome di battesimo). Mai chat, elenco ospiti o altro.
-- - "Dove?" (camera, ombrellone...) e' facoltativo, scritto dall'ospite sulla singola richiesta: lo vede solo lo staff che la
--   gestisce e si cancella alla partenza insieme alla nota (restano categoria, tempi e voto, anonimi, per le statistiche).
-- - Interruttore "requests" in hotels.features (0010): spento = nessuna nuova richiesta.
-- Da eseguire in Supabase PRIMA di pubblicare il codice che la usa.

-- -----------------------------------------------------------------------------
-- 1. Ruolo Team e reparto
-- -----------------------------------------------------------------------------
-- (il valore nuovo si confronta come testo, role::text = 'team': nella stessa transazione non si puo' usare come enum)
alter type public.app_role add value if not exists 'team';
alter table public.hotel_staff add column department text
  check (department is null or department in ('housekeeping', 'maintenance', 'roomservice', 'reception'));

-- interruttore delle richieste (0010): chiave in piu'
create or replace function app.valid_features(j jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(j) = 'object' and not exists (
    select 1 from jsonb_each(j) e
     where e.key not in ('social', 'public_chat', 'challenges', 'coupons', 'bookings', 'reception', 'requests')
        or jsonb_typeof(e.value) <> 'boolean')
$$;

-- -----------------------------------------------------------------------------
-- 2. Categorie (per hotel, gestite dal direttore)
-- -----------------------------------------------------------------------------
create function app.valid_request_name(j jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(j) = 'object' and coalesce(char_length(j ->> 'it'), 0) between 1 and 60 and not exists (
    select 1 from jsonb_each(j) e
     where e.key not in ('it','en','de','ru') or jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') > 60)
$$;
grant execute on function app.valid_request_name(jsonb) to authenticated, service_role;

create table public.request_categories (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  name        jsonb not null check (app.valid_request_name(name)),
  department  text not null check (department in ('housekeeping', 'maintenance', 'roomservice', 'reception')),
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (id, hotel_id)
);
create index request_categories_hotel_idx on public.request_categories(hotel_id, sort_order);
alter table public.request_categories enable row level security;
revoke all on public.request_categories from anon, authenticated;
grant select, insert, update, delete on public.request_categories to authenticated;
grant all on public.request_categories to service_role;
create policy request_categories_select on public.request_categories for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids()) or (hotel_id = (select app.my_hotel_id()) and active));
create policy request_categories_admin on public.request_categories for all to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin']::public.app_role[])))
  with check (hotel_id in (select app.staff_hotel_ids(array['hotel_admin']::public.app_role[])));

-- categorie di partenza (si possono rinominare, spegnere, aggiungere dal pannello)
create function app.request_default_categories(p_hotel uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.request_categories(hotel_id, name, department, sort_order) values
    (p_hotel, '{"it":"Pulizia e biancheria","en":"Cleaning and linen","de":"Reinigung und Wäsche","ru":"Уборка и бельё"}', 'housekeeping', 1),
    (p_hotel, '{"it":"Guasto o manutenzione","en":"Fault or maintenance","de":"Defekt oder Wartung","ru":"Поломка или ремонт"}', 'maintenance', 2),
    (p_hotel, '{"it":"Oggetti per la camera","en":"Items for the room","de":"Dinge für das Zimmer","ru":"Вещи для номера"}', 'housekeeping', 3),
    (p_hotel, '{"it":"Altro","en":"Other","de":"Sonstiges","ru":"Другое"}', 'reception', 4)
$$;
select app.request_default_categories(h.id) from public.hotels h;
create function app.request_categories_for_new_hotel() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin perform app.request_default_categories(new.id); return new; end $$;
create trigger hotels_request_categories after insert on public.hotels
  for each row execute function app.request_categories_for_new_hotel();

-- -----------------------------------------------------------------------------
-- 3. Richieste
-- -----------------------------------------------------------------------------
create table public.guest_requests (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references public.hotels(id) on delete cascade,
  guest_id       uuid,
  category_id    uuid,
  category_name  jsonb not null,                     -- nome al momento della richiesta (le statistiche restano leggibili)
  department     text not null check (department in ('housekeeping', 'maintenance', 'roomservice', 'reception')),
  note           text check (note is null or char_length(note) between 1 and 300),
  place          text check (place is null or char_length(place) between 1 and 40),
  status         text not null default 'open' check (status in ('open', 'taken', 'done', 'cancelled')),
  priority       text not null default 'normal' check (priority in ('normal', 'high')),
  created_at     timestamptz not null default now(),
  taken_at       timestamptz,
  done_at        timestamptz,
  cancelled_at   timestamptz,
  taken_by       uuid references public.hotel_staff(id) on delete set null,
  rating         smallint check (rating in (-1, 1)),
  foreign key (guest_id, hotel_id)    references public.guests(id, hotel_id)             on delete set null (guest_id),
  foreign key (category_id, hotel_id) references public.request_categories(id, hotel_id) on delete set null (category_id)
);
create index guest_requests_hotel_idx on public.guest_requests(hotel_id, status, created_at);
create index guest_requests_guest_idx on public.guest_requests(guest_id) where guest_id is not null;
alter table public.guest_requests enable row level security;
revoke all on public.guest_requests from anon, authenticated;
grant select on public.guest_requests to authenticated;     -- le scritture passano dalle funzioni qui sotto
grant all on public.guest_requests to service_role;

-- personale di reparto: hotel e reparto dell'utente (ruolo team, attivo)
create function app.team_departments() returns table (hotel_id uuid, department text)
language sql stable security definer set search_path = public, pg_temp as $$
  select st.hotel_id, st.department from public.hotel_staff st join public.hotels h on h.id = st.hotel_id
   where st.user_id = auth.uid() and st.active and h.status = 'active' and st.role::text = 'team' and st.department is not null
$$;
grant execute on function app.team_departments() to authenticated;

create policy guest_requests_select on public.guest_requests for select to authenticated using (
  guest_id = (select app.my_guest_id())
  or hotel_id in (select app.staff_hotel_ids(array['hotel_admin', 'reception']::public.app_role[]))
  or (hotel_id, department) in (select t.hotel_id, t.department from app.team_departments() t)
);

-- interruttore: spento = nessuna nuova richiesta (0010)
create trigger guest_requests_feature before insert on public.guest_requests
  for each row execute function app.require_feature('requests');

-- alla partenza (o "cancella i miei dati"): via nota e luogo, le aperte si chiudono come annullate; restano categoria, tempi, voto
create function app.guest_requests_purge() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.guest_requests
     set note = null, place = null,
         status = case when status in ('open', 'taken') then 'cancelled' else status end,
         cancelled_at = case when status in ('open', 'taken') then now() else cancelled_at end
   where guest_id = old.id;
  return old;
end $$;
create trigger guests_requests_purge before delete on public.guests
  for each row execute function app.guest_requests_purge();

-- -----------------------------------------------------------------------------
-- 4. Funzioni dell'ospite
-- -----------------------------------------------------------------------------
create function public.request_create(p_category uuid, p_note text default null, p_place text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_guest uuid := app.my_guest_id();
  g public.guests;
  c public.request_categories;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_place text := nullif(btrim(coalesce(p_place, '')), '');
  v_id uuid;
begin
  if v_guest is null then raise exception 'forbidden' using errcode = 'CH004'; end if;
  select * into g from public.guests where id = v_guest;
  -- una richiesta alla volta per ospite: i limiti non si superano con richieste parallele
  perform pg_advisory_xact_lock(hashtextextended('req:' || v_guest::text, 0));
  select * into c from public.request_categories where id = p_category and hotel_id = g.hotel_id and active;
  if not found then raise exception 'invalid_category' using errcode = 'CH003'; end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'too_long' using errcode = 'CH003'; end if;
  if v_place is not null and char_length(v_place) > 40 then raise exception 'too_long' using errcode = 'CH003'; end if;
  if (select count(*) from public.guest_requests where guest_id = v_guest and status in ('open', 'taken')) >= 3 then
    raise exception 'request_open_limit' using errcode = 'CH007';
  end if;
  if (select count(*) from public.guest_requests where guest_id = v_guest and created_at >= app.hotel_day_start(g.hotel_id)) >= 10 then
    raise exception 'request_daily_limit' using errcode = 'CH007';
  end if;
  insert into public.guest_requests(hotel_id, guest_id, category_id, category_name, department, note, place)
  values (g.hotel_id, v_guest, c.id, c.name, c.department, v_note, v_place)
  returning id into v_id;
  return v_id;
end $$;

create function public.request_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.guest_requests set status = 'cancelled', cancelled_at = now()
   where id = p_id and guest_id = app.my_guest_id() and status = 'open';
  if not found then raise exception 'request_closed' using errcode = 'CH003'; end if;
end $$;

create function public.request_rate(p_id uuid, p_up boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.guest_requests set rating = case when p_up then 1 else -1 end
   where id = p_id and guest_id = app.my_guest_id() and status = 'done' and rating is null;
  if not found then raise exception 'request_closed' using errcode = 'CH003'; end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Funzioni dello staff
-- -----------------------------------------------------------------------------
-- Direttore e reception: tutto (stato, priorita', reparto). Team: solo il proprio reparto e solo lo stato (presa in carico, fatta).
create function public.request_update(p_id uuid, p_status text default null, p_priority text default null, p_department text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.guest_requests;
  st public.hotel_staff;
  v_full boolean;
begin
  select * into r from public.guest_requests where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'CH003'; end if;
  select * into st from public.hotel_staff where user_id = auth.uid() and hotel_id = r.hotel_id and active;
  if not found then raise exception 'forbidden' using errcode = 'CH004'; end if;
  v_full := st.role::text in ('hotel_admin', 'reception');
  if not v_full and not (st.role::text = 'team' and st.department = r.department) then
    raise exception 'forbidden' using errcode = 'CH004';
  end if;
  if not v_full and (p_priority is not null or p_department is not null) then
    raise exception 'forbidden' using errcode = 'CH004';
  end if;
  if r.status in ('done', 'cancelled') then raise exception 'request_closed' using errcode = 'CH003'; end if;

  if p_status is not null then
    if p_status = 'taken' and r.status = 'open' then
      update public.guest_requests set status = 'taken', taken_at = now(), taken_by = st.id where id = p_id;
    elsif p_status = 'done' then
      update public.guest_requests set status = 'done', done_at = now(),
             taken_at = coalesce(taken_at, now()), taken_by = coalesce(taken_by, st.id) where id = p_id;
    else
      raise exception 'invalid_status' using errcode = 'CH003';
    end if;
  end if;
  if p_priority is not null then
    if p_priority not in ('normal', 'high') then raise exception 'invalid_input' using errcode = 'CH003'; end if;
    update public.guest_requests set priority = p_priority where id = p_id;
  end if;
  if p_department is not null then
    if p_department not in ('housekeeping', 'maintenance', 'roomservice', 'reception') then raise exception 'invalid_input' using errcode = 'CH003'; end if;
    update public.guest_requests set department = p_department where id = p_id;
  end if;
end $$;

-- elenco per il pannello e per il Team: nome di battesimo dell'ospite e nome di chi l'ha presa, niente altro
create function public.staff_requests(p_hotel uuid, p_include_closed boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_full boolean := p_hotel in (select app.staff_hotel_ids(array['hotel_admin', 'reception']::public.app_role[]));
  v_dept text := (select t.department from app.team_departments() t where t.hotel_id = p_hotel limit 1);
  v jsonb;
begin
  if not v_full and v_dept is null then raise exception 'forbidden' using errcode = 'CH004'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'guest_name', g.display_name, 'category', r.category_name, 'department', r.department,
           'note', r.note, 'place', r.place, 'status', r.status, 'priority', r.priority,
           'created_at', r.created_at, 'taken_at', r.taken_at, 'done_at', r.done_at, 'taken_by', st.display_name, 'rating', r.rating)
         order by (r.priority = 'high') desc, r.created_at), '[]'::jsonb) into v
    from public.guest_requests r
    left join public.guests g on g.id = r.guest_id
    left join public.hotel_staff st on st.id = r.taken_by
   where r.hotel_id = p_hotel
     and (v_full or r.department = v_dept)
     and (r.status in ('open', 'taken') or (p_include_closed and r.created_at > now() - interval '2 days'));
  return v;
end $$;

-- numeri per Statistiche (direttore e reception): tempi medi in minuti, voti, per categoria
create function public.request_stats(p_hotel uuid, p_since timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if p_hotel not in (select app.staff_hotel_ids(array['hotel_admin', 'reception']::public.app_role[])) then
    raise exception 'forbidden' using errcode = 'CH004';
  end if;
  with r as (select * from public.guest_requests where hotel_id = p_hotel and created_at >= p_since)
  select jsonb_build_object(
    'total', (select count(*) from r),
    'done', (select count(*) from r where status = 'done'),
    'open', (select count(*) from r where status in ('open', 'taken')),
    'take_minutes', (select round(avg(extract(epoch from taken_at - created_at)) / 60.0, 1) from r where taken_at is not null),
    'done_minutes', (select round(avg(extract(epoch from done_at - created_at)) / 60.0, 1) from r where done_at is not null),
    'up', (select count(*) from r where rating = 1),
    'down', (select count(*) from r where rating = -1),
    'by_category', coalesce((select jsonb_agg(x) from (
        select r.category_name as name, count(*) as total,
               round(avg(extract(epoch from r.done_at - r.created_at)) filter (where r.done_at is not null) / 60.0, 1) as done_minutes
          from r group by r.category_name order by count(*) desc) x), '[]'::jsonb)
  ) into v;
  return v;
end $$;

revoke all on function public.request_create(uuid, text, text), public.request_cancel(uuid), public.request_rate(uuid, boolean),
  public.request_update(uuid, text, text, text), public.staff_requests(uuid, boolean), public.request_stats(uuid, timestamptz) from public, anon;
grant execute on function public.request_create(uuid, text, text), public.request_cancel(uuid), public.request_rate(uuid, boolean),
  public.request_update(uuid, text, text, text), public.staff_requests(uuid, boolean), public.request_stats(uuid, timestamptz) to authenticated;
