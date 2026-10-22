-- Prova di 0010_hotel_customization.sql (dopo 0001-0010): personalizzazione e interruttori delle funzioni.
-- Uso: psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/0010_hotel_customization_test.sql
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
  ('00000000-0000-0000-0000-0000000000a1', null, true),
  ('00000000-0000-0000-0000-0000000000d1', 'dir@x.test', false), ('00000000-0000-0000-0000-0000000000e1', 'rec@x.test', false);
insert into public.hotels(id, slug, name) values ('11111111-1111-1111-1111-111111111111', 'demo', 'Hotel Demo');
insert into public.hotel_staff(hotel_id, user_id, role, display_name) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000d1', 'hotel_admin', 'Dora'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e1', 'reception', 'Marta');
insert into public.guests(id, hotel_id, auth_user_id, display_name, is_adult) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', 'Anna', true);
insert into public.stays(hotel_id, guest_id, checkin_date, checkout_date, expires_at) values
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', current_date, current_date + 3, now() + interval '3 days');
insert into public.social_profiles(id, hotel_id, guest_id, nickname, visible, rules_accepted_at, stay_expires_at) values
  ('5b000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'Anna', true, now(), now() + interval '3 days');
insert into public.facilities(id, hotel_id, kind, name) values
  ('fa000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'spa', '{"it":"Spa"}');
insert into public.slots(id, hotel_id, facility_id, starts_at, ends_at, capacity) values
  ('5a000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'fa000000-0000-0000-0000-000000000001', now() + interval '1 day', now() + interval '25 hours', 4);

\set A '''00000000-0000-0000-0000-0000000000a1'''
\set DIR '''00000000-0000-0000-0000-0000000000d1'''
\set REC '''00000000-0000-0000-0000-0000000000e1'''
\set H1 '''11111111-1111-1111-1111-111111111111'''

-- ---------------------------------------------------------------- valori ammessi
select tt.expect('di base tutto acceso', (select app.feature_on(:H1::uuid, 'bookings')::text), 'true');
select tt.expect('chiave sconosciuta rifiutata', left(tt.try($$update public.hotels set features = '{"foo": true}' where slug = 'demo'$$), 5), '23514');
select tt.expect('valore non booleano rifiutato', left(tt.try($$update public.hotels set features = '{"social": "no"}' where slug = 'demo'$$), 5), '23514');
select tt.expect('benvenuto oltre 500 caratteri rifiutato', left(tt.try(format('update public.hotels set welcome = %L where slug = ''demo''', jsonb_build_object('it', repeat('x', 501)))), 5), '23514');
select tt.expect('benvenuto in una lingua sconosciuta rifiutato', left(tt.try($$update public.hotels set welcome = '{"fr": "Bonjour"}' where slug = 'demo'$$), 5), '23514');
select tt.expect('copertina javascript: rifiutata', left(tt.try($$update public.hotels set cover_url = 'javascript:alert(1)' where slug = 'demo'$$), 5), '23514');
select tt.expect('copertina dalla pagina di ingresso', tt.try($$update public.hotels set cover_url = 'https://x.supabase.co/storage/v1/object/public/hotel-media/c.jpg' where slug = 'demo'$$), 'ok');
select tt.expect('public_hotel restituisce la copertina', (select cover_url from public.public_hotel('demo')), 'https://x.supabase.co/storage/v1/object/public/hotel-media/c.jpg');

-- ---------------------------------------------------------------- chi puo' cambiare cosa
set local role authenticated;
select tt.as_user(:DIR::uuid);
select tt.expect('il direttore cambia benvenuto e interruttori',
  tt.try($$update public.hotels set welcome = '{"it": "Benvenuti!"}', features = '{"coupons": false}' where slug = 'demo'$$), 'ok');
select tt.expect('il direttore non cambia il logo dal client', left(tt.try($$update public.hotels set logo_url = 'https://evil.test/x.png' where slug = 'demo'$$), 5), '42501');
select tt.as_user(:REC::uuid);
select tt.expect('la reception legge ma non cambia (0 righe)',
  (with u as (update public.hotels set features = '{}' where slug = 'demo' returning 1) select count(*)::text from u), '0');
select tt.as_user(:A::uuid);
select tt.expect('l''ospite legge benvenuto e interruttori', (select (welcome->>'it') || '/' || (features->>'coupons') from public.hotels where slug = 'demo'), 'Benvenuti!/false');
select tt.expect('l''ospite non cambia nulla', (with u as (update public.hotels set features = '{}' where slug = 'demo' returning 1) select count(*)::text from u), '0');
reset role;

-- ---------------------------------------------------------------- scritture rifiutate a funzione spenta
update public.hotels set features = '{"bookings": false}' where slug = 'demo';
select tt.expect('prenotazioni spente: niente nuova prenotazione',
  tt.try($$insert into public.bookings(hotel_id, slot_id, guest_id, party_size) values ('11111111-1111-1111-1111-111111111111', '5a000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 1)$$), 'CH004:feature_disabled');
update public.hotels set features = '{}' where slug = 'demo';
select tt.expect('prenotazioni accese: si prenota',
  tt.try($$insert into public.bookings(hotel_id, slot_id, guest_id, party_size) values ('11111111-1111-1111-1111-111111111111', '5a000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 1)$$), 'ok');

update public.hotels set features = '{"public_chat": false}' where slug = 'demo';
select tt.expect('chat pubblica spenta: niente messaggio',
  tt.try($$insert into public.social_public_messages(hotel_id, author_id, body) values ('11111111-1111-1111-1111-111111111111', '5b000000-0000-0000-0000-000000000001', 'ciao')$$), 'CH004:feature_disabled');
select tt.expect('chat pubblica spenta: niente sfida pubblica',
  tt.try($$insert into public.social_challenges(hotel_id, game, challenger_id, starts_at, stake) values ('11111111-1111-1111-1111-111111111111', '{"it":"Ping pong"}', '5b000000-0000-0000-0000-000000000001', now() + interval '1 hour', 'coffee')$$), 'CH004:feature_disabled');
update public.hotels set features = '{"social": false, "public_chat": true}' where slug = 'demo';
select tt.expect('social spento: spenta anche la chat pubblica', app.feature_on(:H1::uuid, 'public_chat')::text, 'false');
select tt.expect('social spento: spenti anche i coupon', app.feature_on(:H1::uuid, 'coupons')::text, 'false');
select tt.expect('social spento: le prenotazioni restano', app.feature_on(:H1::uuid, 'bookings')::text, 'true');
select tt.expect('social spento: niente messaggio pubblico',
  tt.try($$insert into public.social_public_messages(hotel_id, author_id, body) values ('11111111-1111-1111-1111-111111111111', '5b000000-0000-0000-0000-000000000001', 'ciao')$$), 'CH004:feature_disabled');
set local role authenticated;
select tt.as_user(:A::uuid);
select tt.expect('social spento: le funzioni sociali dell''ospite rispondono feature_disabled', tt.try('select * from public.social_guests()'), 'CH004:feature_disabled');
reset role;

update public.hotels set features = '{}' where slug = 'demo';
select tt.expect('riacceso: si scrive di nuovo',
  tt.try($$insert into public.social_public_messages(hotel_id, author_id, body) values ('11111111-1111-1111-1111-111111111111', '5b000000-0000-0000-0000-000000000001', 'ciao')$$), 'ok');
update public.hotels set features = '{"social": false}' where slug = 'demo';
select tt.expect('spegnere non cancella nulla', (select count(*)::text from public.social_public_messages) || '/' || (select count(*)::text from public.bookings), '1/1');

-- reception AI spenta: niente messaggi dell'ospite, le risposte dello staff si'
update public.hotels set features = '{"reception": false}' where slug = 'demo';
insert into public.ai_conversations(id, hotel_id, guest_id) values ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001');
select tt.expect('reception AI spenta: niente messaggio dell''ospite',
  tt.try($$insert into public.ai_messages(hotel_id, conversation_id, role, content) values ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', 'guest', 'ciao')$$), 'CH004:feature_disabled');
select tt.expect('reception AI spenta: lo staff risponde ancora',
  tt.try($$insert into public.ai_messages(hotel_id, conversation_id, role, content) values ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', 'operator', 'Arrivo')$$), 'ok');

rollback;
