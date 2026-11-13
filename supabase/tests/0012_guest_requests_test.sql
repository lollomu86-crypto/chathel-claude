-- Prova di 0012_guest_requests.sql (dopo 0001-0012): richieste degli ospiti, ruolo team, limiti, cancellazione alla partenza.
-- Uso: psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/0012_guest_requests_test.sql
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
  ('00000000-0000-0000-0000-0000000000e1', 'rec@x.test', false), ('00000000-0000-0000-0000-0000000000c1', 'pulizie@x.test', false),
  ('00000000-0000-0000-0000-0000000000c2', 'manutenzione@x.test', false), ('00000000-0000-0000-0000-0000000000f1', 'bar@x.test', false);
insert into public.hotels(id, slug, name) values ('11111111-1111-1111-1111-111111111111', 'demo', 'Hotel Demo');
insert into public.hotel_staff(hotel_id, user_id, role, display_name, department) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e1', 'reception', 'Marta', null),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000c1', 'team', 'Gina', 'housekeeping'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000c2', 'team', 'Piero', 'maintenance'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000f1', 'bartender', 'Luca', null);
insert into public.guests(id, hotel_id, auth_user_id, display_name, is_adult) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', 'Anna', true),
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b1', 'Bruno', true);
insert into public.stays(hotel_id, guest_id, checkin_date, checkout_date, expires_at)
select hotel_id, id, current_date, current_date + 3, now() + interval '3 days' from public.guests;

\set A '''00000000-0000-0000-0000-0000000000a1'''
\set B '''00000000-0000-0000-0000-0000000000b1'''
\set REC '''00000000-0000-0000-0000-0000000000e1'''
\set PUL '''00000000-0000-0000-0000-0000000000c1'''
\set MAN '''00000000-0000-0000-0000-0000000000c2'''
\set BAR '''00000000-0000-0000-0000-0000000000f1'''
\set H1 '''11111111-1111-1111-1111-111111111111'''

select tt.expect('categorie di partenza create col nuovo hotel', (select count(*)::text from public.request_categories where hotel_id = :H1::uuid), '4');
create temp table ids(name text, id uuid);
grant all on ids to authenticated;
insert into ids select 'pulizia', id from public.request_categories where name->>'it' = 'Pulizia e biancheria';
insert into ids select 'guasto', id from public.request_categories where name->>'it' = 'Guasto o manutenzione';

-- ---------------------------------------------------------------- ospite: crea, limiti, vede solo le sue
set local role authenticated;
select tt.as_user(:A::uuid);
insert into ids select 'r1', public.request_create((select id from ids where name = 'pulizia'), ' Due asciugamani ', 'camera 214');
select tt.expect('nota e luogo ripuliti dagli spazi', (select note || '|' || place from public.guest_requests where id = (select id from ids where name = 'r1')), 'Due asciugamani|camera 214');
insert into ids select 'r2', public.request_create((select id from ids where name = 'guasto'), 'La doccia perde', null);
insert into ids select 'r3', public.request_create((select id from ids where name = 'pulizia'), null, null);
select tt.expect('al massimo 3 aperte', tt.try(format('select public.request_create(%L)', (select id from ids where name = 'pulizia'))), 'CH007:request_open_limit');
select tt.expect('luogo troppo lungo', tt.try(format('select public.request_create(%L, null, %L)', (select id from ids where name = 'pulizia'), repeat('x', 41))), 'CH003:too_long');
select tt.as_user(:B::uuid);
select tt.expect('Bruno non vede le richieste di Anna', (select count(*)::text from public.guest_requests), '0');
select tt.expect('categoria inesistente', tt.try('select public.request_create(gen_random_uuid())'), 'CH003:invalid_category');
select tt.expect('l''ospite non scrive direttamente', left(tt.try($$update public.guest_requests set status = 'done'$$), 5), '42501');

-- ---------------------------------------------------------------- staff: reception tutto, team solo il suo reparto, bar niente
select tt.as_user(:REC::uuid);
select tt.expect('reception vede tutte le aperte', (select jsonb_array_length(public.staff_requests(:H1::uuid))::text), '3');
select tt.as_user(:PUL::uuid);
select tt.expect('team pulizie: solo le sue (2)', (select jsonb_array_length(public.staff_requests(:H1::uuid))::text), '2');
select tt.expect('team pulizie: non tocca la manutenzione', tt.try(format('select public.request_update(%L, %L)', (select id from ids where name = 'r2'), 'taken')), 'CH004:forbidden');
select tt.expect('team: non cambia la priorita''', tt.try(format('select public.request_update(%L, null, %L)', (select id from ids where name = 'r1'), 'high')), 'CH004:forbidden');
select public.request_update((select id from ids where name = 'r1'), 'taken');
select tt.expect('presa in carico da Gina', (select (x->>'status') || '|' || (x->>'taken_by') from jsonb_array_elements(public.staff_requests(:H1::uuid)) x where (x->>'id')::uuid = (select id from ids where name = 'r1')), 'taken|Gina');
select public.request_update((select id from ids where name = 'r1'), 'done');
select tt.expect('chiusa: non si riapre', tt.try(format('select public.request_update(%L, %L)', (select id from ids where name = 'r1'), 'taken')), 'CH003:request_closed');
select tt.as_user(:BAR::uuid);
select tt.expect('il bar non vede le richieste', tt.try(format('select public.staff_requests(%L)', :H1)), 'CH004:forbidden');
select tt.as_user(:REC::uuid);
select public.request_update((select id from ids where name = 'r2'), null, 'high', 'housekeeping');
select tt.expect('reception sposta reparto e priorita''', (select department || '|' || priority from public.guest_requests where id = (select id from ids where name = 'r2')), 'housekeeping|high');

-- ---------------------------------------------------------------- ospite: annulla e vota
select tt.as_user(:A::uuid);
select public.request_cancel((select id from ids where name = 'r3'));
select tt.expect('annullata', (select status from public.guest_requests where id = (select id from ids where name = 'r3')), 'cancelled');
select public.request_rate((select id from ids where name = 'r1'), true);
select tt.expect('voto una volta sola', tt.try(format('select public.request_rate(%L, false)', (select id from ids where name = 'r1'))), 'CH003:request_closed');
select tt.as_user(:REC::uuid);
select tt.expect('statistiche: 3 richieste, 1 fatta, 1 voto positivo',
  (select (s->>'total') || '|' || (s->>'done') || '|' || (s->>'up') from (select public.request_stats(:H1::uuid, now() - interval '1 day') s) x), '3|1|1');

-- ---------------------------------------------------------------- interruttore e partenza
reset role;
update public.hotels set features = '{"requests": false}' where id = :H1::uuid;
set local role authenticated;
select tt.as_user(:B::uuid);
select tt.expect('richieste spente: niente nuove', tt.try(format('select public.request_create(%L)', (select id from ids where name = 'pulizia'))), 'CH004:feature_disabled');
reset role;
update public.hotels set features = '{}' where id = :H1::uuid;
delete from public.guests where id = 'a0000000-0000-0000-0000-000000000001';
select tt.expect('alla partenza: via nota, luogo e ospite; restano categoria, tempi e voto',
  (select count(*)::text from public.guest_requests where guest_id is null and note is null and place is null) || '|' ||
  (select count(*)::text from public.guest_requests where rating = 1) || '|' ||
  (select status from public.guest_requests where id = (select id from ids where name = 'r2')), '3|1|cancelled');

rollback;
