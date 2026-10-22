-- Prova di 0009_staff_guests.sql (dopo 0001-0009): elenco ospiti per lo staff e ultimo accesso.
-- Uso: psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/0009_staff_guests_test.sql
-- Stesso meccanismo di 0002_social_test.sql (request.jwt.claims + SET ROLE authenticated). NON e' un test Supabase reale.
begin;

create schema tt;
grant usage on schema tt to authenticated;
create function tt.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $$;
create function tt.expect(p_label text, p_actual text, p_expected text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then raise exception 'FALLITO [%]: atteso %, ottenuto %', p_label, p_expected, p_actual; end if;
  raise notice 'OK   %', p_label;
end $$;
create function tt.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); end $$;
grant execute on function tt.try(text), tt.expect(text, text, text), tt.as_user(uuid) to authenticated;

insert into auth.users(id, email, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000a1', null, true), ('00000000-0000-0000-0000-0000000000b1', null, true),
  ('00000000-0000-0000-0000-0000000000e1', 'rec@x.test', false), ('00000000-0000-0000-0000-0000000000f1', 'bar@x.test', false),
  ('00000000-0000-0000-0000-0000000000e2', 'rec2@x.test', false);
insert into public.hotels(id, slug, name) values
  ('11111111-1111-1111-1111-111111111111', 'demo', 'Hotel Demo'), ('22222222-2222-2222-2222-222222222222', 'altro', 'Hotel Altro');
insert into public.hotel_staff(hotel_id, user_id, role, display_name) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e1', 'reception', 'Marta'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000f1', 'bartender', 'Luca'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000e2', 'reception', 'Rita');
insert into public.guests(id, hotel_id, auth_user_id, display_name, is_adult) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', 'Anna', true),
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b1', 'Bruno', true);
insert into public.stays(hotel_id, guest_id, checkin_date, checkout_date, expires_at) values
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', current_date, current_date + 3, now() + interval '3 days'),
  ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001', current_date - 2, current_date, now() + interval '2 hours');
insert into public.facilities(id, hotel_id, kind, name) values
  ('fa000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'spa', '{"it":"Spa"}');
insert into public.slots(id, hotel_id, facility_id, starts_at, ends_at, capacity) values
  ('5a000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'fa000000-0000-0000-0000-000000000001', now() + interval '1 day', now() + interval '25 hours', 4);
insert into public.bookings(hotel_id, slot_id, guest_id, party_size) values
  ('11111111-1111-1111-1111-111111111111', '5a000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 2);

\set A '''00000000-0000-0000-0000-0000000000a1'''
\set REC '''00000000-0000-0000-0000-0000000000e1'''
\set BAR '''00000000-0000-0000-0000-0000000000f1'''
\set REC2 '''00000000-0000-0000-0000-0000000000e2'''
\set H1 '''11111111-1111-1111-1111-111111111111'''

set local role authenticated;

-- ---------------------------------------------------------------- ultimo accesso
select tt.as_user(:A::uuid);
select public.touch_guest();
select tt.expect('l''ospite registra il suo ultimo accesso', (select (last_seen_at is not null)::text from public.guests where id = 'a0000000-0000-0000-0000-000000000001'), 'true');
reset role;
update public.guests set last_seen_at = now() - interval '5 minutes' where id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
select tt.as_user(:A::uuid);
select public.touch_guest();
reset role;
select tt.expect('entro 10 minuti non riscrive', (select (last_seen_at < now() - interval '4 minutes')::text from public.guests where id = 'a0000000-0000-0000-0000-000000000001'), 'true');
set local role authenticated;

-- ---------------------------------------------------------------- elenco per lo staff
select tt.as_user(:REC::uuid);
select tt.expect('reception: due ospiti in ordine di nome', (select string_agg(x->>'name', ',') from jsonb_array_elements(public.staff_guests(:H1::uuid)) x), 'Anna,Bruno');
select tt.expect('prenotazione di Anna con servizio e persone',
  (select (x->'bookings'->0->'facility'->>'it') || '/' || (x->'bookings'->0->>'party') from jsonb_array_elements(public.staff_guests(:H1::uuid)) x where x->>'name' = 'Anna'), 'Spa/2');
select tt.expect('nessun campo oltre a quelli previsti (niente e-mail, id Google, chat)',
  (select string_agg(k, ',' order by k) from jsonb_array_elements(public.staff_guests(:H1::uuid)) x, jsonb_object_keys(x) k where x->>'name' = 'Anna'),
  'bonus,bookings,checkout_date,events,expires_at,id,last_seen_at,locale,name,started_at');
select tt.as_user(:BAR::uuid);
select tt.expect('barista: niente elenco', tt.try(format('select public.staff_guests(%L)', :H1)), 'CH004:forbidden');
select tt.as_user(:REC2::uuid);
select tt.expect('reception di un altro hotel: niente elenco', tt.try(format('select public.staff_guests(%L)', :H1)), 'CH004:forbidden');
select tt.as_user(:A::uuid);
select tt.expect('ospite: niente elenco', tt.try(format('select public.staff_guests(%L)', :H1)), 'CH004:forbidden');

-- ---------------------------------------------------------------- soggiorno finito: fuori dall'elenco
reset role;
update public.stays set status = 'ended', guest_id = null where guest_id = 'b0000000-0000-0000-0000-000000000001';
set local role authenticated;
select tt.as_user(:REC::uuid);
select tt.expect('dopo il check-out Bruno non c''e'' piu''', (select string_agg(x->>'name', ',') from jsonb_array_elements(public.staff_guests(:H1::uuid)) x), 'Anna');

rollback;
