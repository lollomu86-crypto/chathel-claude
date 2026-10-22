-- Prova di 0008_games_challenges.sql (dopo 0001-0008): giochi per hotel, sfide pubbliche e private.
-- Uso: psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/0008_challenges_test.sql
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

-- ---------------------------------------------------------------- dati: un hotel con sala giochi, tre ospiti, un altro hotel
insert into auth.users(id, email, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000a1', null, true), ('00000000-0000-0000-0000-0000000000b1', null, true),
  ('00000000-0000-0000-0000-0000000000c1', null, true), ('00000000-0000-0000-0000-0000000000e1', 'rec@x.test', false),
  ('00000000-0000-0000-0000-0000000000a2', null, true);
insert into public.hotels(id, slug, name) values
  ('11111111-1111-1111-1111-111111111111', 'demo', 'Hotel Demo'), ('22222222-2222-2222-2222-222222222222', 'altro', 'Hotel Altro');
insert into public.hotel_staff(hotel_id, user_id, role, display_name) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e1', 'reception', 'Marta');
insert into public.guests(id, hotel_id, auth_user_id, display_name, is_adult) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', 'Anna', true),
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b1', 'Bruno', true),
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000c1', 'Carla', true),
  ('a0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000a2', 'Zoe', true);
insert into public.stays(hotel_id, guest_id, checkin_date, checkout_date, expires_at)
select hotel_id, id, current_date, current_date + 5, now() + interval '5 days' from public.guests;
insert into public.games(id, hotel_id, name, sort_order) values
  ('9a000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '{"it":"Ping pong"}', 1),
  ('9a000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '{"it":"Biliardo"}', 1);
insert into public.games(id, hotel_id, name, active) values
  ('9a000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '{"it":"Spento"}', false);

\set A '''00000000-0000-0000-0000-0000000000a1'''
\set B '''00000000-0000-0000-0000-0000000000b1'''
\set C '''00000000-0000-0000-0000-0000000000c1'''
\set REC '''00000000-0000-0000-0000-0000000000e1'''
\set Z '''00000000-0000-0000-0000-0000000000a2'''
\set PP '''9a000000-0000-0000-0000-000000000001'''

set local role authenticated;
-- tutti nel sociale, regole accettate
select tt.as_user(:A::uuid); select public.social_update_settings(p_visible => true); select public.social_accept_rules();
select tt.as_user(:B::uuid); select public.social_update_settings(p_visible => true); select public.social_accept_rules();
select tt.as_user(:C::uuid); select public.social_update_settings(p_visible => true); select public.social_accept_rules();
select tt.as_user(:Z::uuid); select public.social_update_settings(p_visible => true); select public.social_accept_rules();

-- ---------------------------------------------------------------- 1. giochi: RLS
select tt.as_user(:A::uuid);
select tt.expect('ospite: vede solo i giochi attivi del suo hotel', (select string_agg(name->>'it', ',') from public.games), 'Ping pong');
select tt.expect('ospite: non crea giochi', tt.try($$insert into public.games(hotel_id, name) values ('11111111-1111-1111-1111-111111111111', '{"it":"x"}')$$),
  '42501:new row violates row-level security policy for table "games"');
select tt.as_user(:REC::uuid);
select tt.expect('reception: vede anche i giochi spenti', (select count(*) from public.games)::text, '2');
select tt.expect('reception: crea un gioco', tt.try($$insert into public.games(hotel_id, name) values ('11111111-1111-1111-1111-111111111111', '{"it":"Freccette"}')$$), 'ok');
select tt.expect('reception: non tocca i giochi di un altro hotel',
  tt.try($$update public.games set active = false where id = '9a000000-0000-0000-0000-000000000002'$$) || '/' ||
  (select count(*) from public.games where id = '9a000000-0000-0000-0000-000000000002')::text, 'ok/0');

-- ---------------------------------------------------------------- 2. sfida pubblica
select tt.as_user(:A::uuid);
select tt.expect('posta non ammessa', tt.try(format($$select public.social_challenge_create(%L, now() + interval '15 minutes', 'soldi')$$, :PP)), 'CH003:invalid_stake');
select tt.expect('orario troppo vicino', tt.try(format($$select public.social_challenge_create(%L, now() + interval '1 minute', 'coffee')$$, :PP)), 'CH003:invalid_time');
select tt.expect('orario troppo lontano', tt.try(format($$select public.social_challenge_create(%L, now() + interval '13 hours', 'coffee')$$, :PP)), 'CH003:invalid_time');
select tt.expect('gioco spento', tt.try($$select public.social_challenge_create('9a000000-0000-0000-0000-000000000003', now() + interval '15 minutes', 'coffee')$$), 'CH003:invalid_game');
select tt.expect('gioco di un altro hotel', tt.try($$select public.social_challenge_create('9a000000-0000-0000-0000-000000000002', now() + interval '15 minutes', 'coffee')$$), 'CH003:invalid_game');
select public.social_challenge_create(:PP::uuid, now() + interval '15 minutes', 'coffee') \gset pub_
\set PUB '''' :pub_social_challenge_create ''''
select tt.expect('Anna vede la sua sfida aperta', (select status || '/' || mine::text || '/' || can_accept::text || '/' || can_cancel::text from public.social_challenges() where id = :PUB::uuid), 'open/true/false/true');
select tt.expect('chi sfida non accetta da solo', tt.try(format($$select public.social_challenge_respond(%L, true)$$, :PUB)), 'CH004:forbidden');
select tt.as_user(:Z::uuid);
select tt.expect('altro hotel: non la vede', (select count(*) from public.social_challenges())::text, '0');
select tt.expect('altro hotel: non la accetta', tt.try(format($$select public.social_challenge_respond(%L, true)$$, :PUB)), 'CH003:invalid_challenge');
select tt.as_user(:B::uuid);
select tt.expect('Bruno: puo'' accettare', (select can_accept::text from public.social_challenges() where id = :PUB::uuid), 'true');
select tt.expect('pubblica: non si rifiuta', tt.try(format($$select public.social_challenge_respond(%L, false)$$, :PUB)), 'CH004:forbidden');
select public.social_challenge_respond(:PUB::uuid, true);
select tt.expect('accettata da Bruno', (select status || '/' || opponent_nickname from public.social_challenges() where id = :PUB::uuid), 'accepted/Bruno');
select tt.as_user(:C::uuid);
select tt.expect('Carla arriva tardi', tt.try(format($$select public.social_challenge_respond(%L, true)$$, :PUB)), 'CH005:challenge_closed');
select tt.expect('Carla vede chi gioca', (select challenger_nickname || ' vs ' || opponent_nickname from public.social_challenges() where id = :PUB::uuid), 'Anna vs Bruno');

-- ---------------------------------------------------------------- 3. blocco e visibilita'
select public.social_block((select id from public.social_profiles where guest_id = 'a0000000-0000-0000-0000-000000000001'));
select tt.expect('Carla ha bloccato Anna: non vede le sue sfide', (select count(*) from public.social_challenges())::text, '0');
select tt.as_user(:A::uuid);
select public.social_challenge_create(:PP::uuid, now() + interval '30 minutes', 'fun') \gset pub2_
select tt.as_user(:C::uuid);
select tt.expect('bloccata: non la accetta', tt.try(format($$select public.social_challenge_respond(%L, true)$$, :'pub2_social_challenge_create')), 'CH003:invalid_challenge');

-- ---------------------------------------------------------------- 4. sfida privata
select tt.as_user(:A::uuid);
select public.social_start_thread((select id from public.social_profiles where guest_id = 'b0000000-0000-0000-0000-000000000001'), 'ciao') \gset th_
\set TH '''' :th_social_start_thread ''''
select tt.expect('conversazione non ancora accettata', tt.try(format($$select public.social_challenge_create(%L, now() + interval '15 minutes', 'aperitif', %L)$$, :PP, :TH)), 'CH004:thread_not_open');
select tt.as_user(:B::uuid);
select public.social_respond(:TH::uuid, true);
select tt.as_user(:A::uuid);
select public.social_challenge_create(:PP::uuid, now() + interval '15 minutes', 'aperitif', :TH::uuid) \gset priv_
\set PRIV '''' :priv_social_challenge_create ''''
select tt.expect('privata: non compare nella chat pubblica', (select count(*) from public.social_challenges() where id = :PRIV::uuid)::text, '0');
select tt.expect('privata: compare nella conversazione', (select stake || '/' || opponent_nickname from public.social_challenges(:TH::uuid) where id = :PRIV::uuid), 'aperitif/Bruno');
select tt.as_user(:C::uuid);
select tt.expect('estranea: non legge la conversazione', tt.try(format($$select * from public.social_challenges(%L)$$, :TH)), 'CH003:invalid_thread');
select tt.expect('estranea: non accetta', tt.try(format($$select public.social_challenge_respond(%L, true)$$, :PRIV)), 'CH003:invalid_challenge');
select tt.as_user(:B::uuid);
select tt.expect('Bruno: puo'' accettare o rifiutare', (select can_accept::text || '/' || can_decline::text from public.social_challenges(:TH::uuid) where id = :PRIV::uuid), 'true/true');
select public.social_challenge_respond(:PRIV::uuid, false);
select tt.expect('rifiutata', (select status from public.social_challenges(:TH::uuid) where id = :PRIV::uuid), 'declined');
select tt.as_user(:A::uuid);
select tt.expect('rifiutata: non si annulla piu''', tt.try(format($$select public.social_challenge_cancel(%L)$$, :PRIV)), 'CH005:challenge_closed');

-- ---------------------------------------------------------------- 5. annullo e limiti
select public.social_challenge_create(:PP::uuid, now() + interval '15 minutes', 'coffee', :TH::uuid) \gset p2_
select public.social_challenge_cancel(:'p2_social_challenge_create');
select tt.expect('annullata', (select status from public.social_challenges(:TH::uuid) where id = :'p2_social_challenge_create'::uuid), 'cancelled');
select tt.as_user(:B::uuid);
select tt.expect('solo chi sfida annulla', tt.try(format($$select public.social_challenge_cancel(%L)$$, :PUB)), 'CH004:forbidden');
select tt.as_user(:A::uuid);
-- oggi Anna ne ha gia' create 4 (pubblica, pubblica 2, privata, privata 2): la quinta passa, la sesta no
select public.social_challenge_create(:PP::uuid, now() + interval '45 minutes', 'fun');
select tt.expect('5 sfide al giorno', tt.try(format($$select public.social_challenge_create(%L, now() + interval '50 minutes', 'fun')$$, :PP)), 'CH007:challenge_daily_limit');

-- ---------------------------------------------------------------- 6. check-out: le sfide spariscono con il profilo
reset role;
delete from public.social_profiles where guest_id = 'a0000000-0000-0000-0000-000000000001';
select tt.expect('nessuna sfida di Anna dopo il check-out',
  (select count(*) from public.social_challenges where challenger_id not in (select id from public.social_profiles))::text, '0');

-- ---------------------------------------------------------------- 7. migrazione: la sala giochi esce dai servizi
select tt.expect('nessuna sala giochi attiva', (select count(*) from public.facilities where kind = 'gamesroom' and active)::text, '0');

rollback;
