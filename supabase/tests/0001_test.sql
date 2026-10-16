-- Prova di 0001_init.sql (+ 0004): isolamento tra hotel, ruoli, bonus, prenotazioni, eventi. T-S7 della revisione.
-- Uso: scripts/sql-test.sh supabase/tests/0001_test.sql  (oppure psql -v ON_ERROR_STOP=1 -f ...)
begin;
\ir _helpers.sql

-- ---------------------------------------------------------------- dati: due hotel, due squadre, un ospite ciascuno
insert into auth.users(id, email, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000a1', null, true),      -- g1 (hotel 1)
  ('00000000-0000-0000-0000-0000000000a2', null, true),      -- g2 (hotel 2)
  ('00000000-0000-0000-0000-0000000000a3', null, true),      -- g3 (hotel 1, secondo ospite)
  ('00000000-0000-0000-0000-0000000000b1', 'adm1@x.test', false), ('00000000-0000-0000-0000-0000000000b2', 'rec1@x.test', false),
  ('00000000-0000-0000-0000-0000000000b3', 'bar1@x.test', false), ('00000000-0000-0000-0000-0000000000c2', 'adm2@x.test', false),
  ('00000000-0000-0000-0000-0000000000c3', 'bar2@x.test', false), ('00000000-0000-0000-0000-0000000000c4', 'rec2@x.test', false);
insert into public.hotels(id, slug, name, bonus_season_cap, bonus_label, qr_token_hash) values
  ('11111111-1111-1111-1111-111111111111', 'uno', 'Hotel Uno', 10, 'Caffe', extensions.digest('qr-uno', 'sha256')),
  ('22222222-2222-2222-2222-222222222222', 'due', 'Hotel Due', 10, 'Caffe', extensions.digest('qr-due', 'sha256'));
insert into public.hotel_staff(hotel_id, user_id, role, display_name) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b1', 'hotel_admin', 'Admin1'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b2', 'reception', 'Rec1'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b3', 'bartender', 'Bar1'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000c2', 'hotel_admin', 'Admin2'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000c3', 'bartender', 'Bar2'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000c4', 'reception', 'Rec2');
insert into public.guests(id, hotel_id, auth_user_id, display_name, is_adult) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', 'Ada', true),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000a2', 'Zoe', true),
  ('a3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a3', 'Carlo', true);
insert into public.stays(id, hotel_id, guest_id, checkin_date, checkout_date, expires_at)
select gen_random_uuid(), hotel_id, id, current_date, current_date + 5, now() + interval '5 days' from public.guests;

insert into public.events(id, hotel_id, title, starts_at, published, capacity) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '{"it":"Serata uno"}', now() + interval '1 day', true, 1),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '{"it":"Serata due"}', now() + interval '1 day', true, null);
insert into public.facilities(id, hotel_id, kind, name) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'spa', '{"it":"Spa uno"}'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'spa', '{"it":"Spa due"}');
insert into public.slots(id, hotel_id, facility_id, starts_at, ends_at, capacity) values
  ('51000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', now() + interval '1 day', now() + interval '1 day 1 hour', 1),
  ('52000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'f2000000-0000-0000-0000-000000000001', now() + interval '1 day', now() + interval '1 day 1 hour', 2);
insert into public.ai_knowledge(hotel_id, category, title, content, locale) values
  ('11111111-1111-1111-1111-111111111111', 'general', 'Wifi', 'rete uno', 'it'), ('22222222-2222-2222-2222-222222222222', 'general', 'Wifi', 'rete due', 'it');
insert into public.notifications(hotel_id, kind, title, guest_id) values
  ('11111111-1111-1111-1111-111111111111', 'announcement', '{"it":"Avviso uno"}', null), ('22222222-2222-2222-2222-222222222222', 'announcement', '{"it":"Avviso due"}', null);
insert into public.ai_conversations(id, hotel_id, guest_id, handoff_at, status) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', now(), 'handoff_pending'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000001', now(), 'handoff_pending');
insert into public.ai_messages(hotel_id, conversation_id, role, content) values
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'guest', 'domanda uno'),
  ('22222222-2222-2222-2222-222222222222', 'c2000000-0000-0000-0000-000000000001', 'guest', 'domanda due');
insert into public.welcome_bonuses(hotel_id, guest_id, season_year, expires_at)
select hotel_id, id, (select season_year from public.hotels h where h.id = g.hotel_id), now() + interval '5 days' from public.guests g;
\set G1 '''00000000-0000-0000-0000-0000000000a1'''
\set G2 '''00000000-0000-0000-0000-0000000000a2'''
\set G3 '''00000000-0000-0000-0000-0000000000a3'''
\set ADM1 '''00000000-0000-0000-0000-0000000000b1'''
\set REC1 '''00000000-0000-0000-0000-0000000000b2'''
\set BAR1 '''00000000-0000-0000-0000-0000000000b3'''
\set ADM2 '''00000000-0000-0000-0000-0000000000c2'''
\set BAR2 '''00000000-0000-0000-0000-0000000000c3'''
\set H2 '''22222222-2222-2222-2222-222222222222'''

-- prenotazione di partenza per le tabelle con righe (come amministratore del database)
insert into public.bookings(hotel_id, slot_id, guest_id) values
  ('22222222-2222-2222-2222-222222222222', '52000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001');
insert into public.event_attendance(hotel_id, event_id, guest_id) values
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001');
insert into public.audit_log(hotel_id, action) values ('22222222-2222-2222-2222-222222222222', 'test.altro_hotel');

-- ---------------------------------------------------------------- 1. matrice di isolamento: nessuno dell'hotel 1 vede righe dell'hotel 2
set local role authenticated;
do $$
declare
  p text; tbl text; col text; r text; bad text := '';
  principals text[] := array['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3',
                             '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b3'];
  tables text[] := array['events','facilities','slots','bookings','welcome_bonuses','bonus_redemptions','ai_knowledge','ai_conversations',
                         'ai_messages','notifications','stays','guests','event_attendance','hotel_staff','audit_log','hotels'];
begin
  foreach p in array principals loop
    perform tt.as_user(p::uuid);
    foreach tbl in array tables loop
      col := case when tbl = 'hotels' then 'id' else 'hotel_id' end;
      r := tt.count(format('select 1 from public.%I where %I = %L', tbl, col, '22222222-2222-2222-2222-222222222222'));
      if r not in ('0', '42501') then bad := bad || p || '/' || tbl || '=' || r || ' '; end if;
    end loop;
  end loop;
  perform tt.expect('matrice di isolamento (5 utenti x 16 tabelle): nessuna riga dell''altro hotel', bad, '');
end $$;

-- ---------------------------------------------------------------- 2. ognuno vede il proprio perimetro (e non di piu')
select tt.as_user(:G1::uuid);
select tt.expect('ospite: eventi del proprio hotel', tt.count('select 1 from public.events'), '1');
select tt.expect('ospite: non vede i dati dell''altro ospite dello stesso hotel (bonus)', tt.count('select 1 from public.welcome_bonuses'), '1');
select tt.expect('ospite: non vede gli ospiti degli altri', tt.count('select 1 from public.guests'), '1');
select tt.expect('ospite: non legge l''elenco staff', tt.count('select 1 from public.hotel_staff'), '0');
select tt.expect('ospite: hash del QR dell''hotel non selezionabile', tt.count('select qr_token_hash from public.hotels'), '42501');
select tt.expect('ospite: sottoscrizione push non leggibile', tt.count('select push_subscription from public.guests'), '42501');
select tt.expect('ospite: l''ospite non scrive eventi', tt.try($$insert into public.events(hotel_id, title, starts_at) values ('11111111-1111-1111-1111-111111111111', '{}', now())$$) like '42501%' , 'true');
select tt.expect('ospite: non legge il registro operazioni', tt.count('select 1 from public.audit_log'), '0');

select tt.as_user(:BAR1::uuid);
select tt.expect('barista: non legge ospiti', tt.count('select 1 from public.guests'), '0');
select tt.expect('barista: non legge prenotazioni', tt.count('select 1 from public.bookings'), '0');
select tt.expect('barista: non legge conversazioni', tt.count('select 1 from public.ai_conversations'), '0');
select tt.expect('barista: non legge la base di conoscenza', tt.count('select 1 from public.ai_knowledge'), '0');

select tt.as_user(:REC1::uuid);
select tt.expect('reception: vede gli ospiti del proprio hotel (2)', tt.count('select 1 from public.guests'), '2');
select tt.expect('reception: non legge auth_user_id', tt.count('select auth_user_id from public.guests'), '42501');
select tt.expect('reception: non legge identity_id', tt.count('select identity_id from public.guests'), '42501');
select tt.expect('reception: non legge push_subscription', tt.count('select push_subscription from public.guests'), '42501');
select tt.expect('reception: non legge gli hash QR', tt.count('select qr_token_hash from public.hotels'), '42501');
select tt.expect('reception non cambia il tetto bonus', tt.try($$update public.hotels set bonus_season_cap = 999 where slug = 'uno'$$) like '42501%', 'true');
select tt.expect('reception non cambia la modalita'' anti-doppione', tt.try($$update public.hotels set bonus_dedupe_mode = 'none' where slug = 'uno'$$) like '42501%', 'true');
select tt.expect('reception non puo'' rimuovere un amministratore', tt.try($$delete from public.hotel_staff where role = 'hotel_admin'$$), 'ok');
reset role;
select tt.expect('...e infatti non ha cancellato nulla', (select count(*) from public.hotel_staff where role = 'hotel_admin' and hotel_id = '11111111-1111-1111-1111-111111111111')::text, '1');
set local role authenticated;

select tt.as_user(:ADM1::uuid);
select tt.expect('direttore: vede il proprio staff (3)', tt.count('select 1 from public.hotel_staff'), '3');
select tt.expect('direttore: aggiorna il proprio hotel', tt.try($$update public.hotels set name = 'Hotel Uno bis' where slug = 'uno'$$), 'ok');
select tt.expect('direttore: modifica effettiva', (select name from public.hotels where slug = 'uno'), 'Hotel Uno bis');
select tt.expect('direttore non tocca l''altro hotel', tt.try($$update public.hotels set name = 'x' where slug = 'due'$$), 'ok');
reset role;
select tt.expect('...nessuna riga modificata', (select name from public.hotels where slug = 'due'), 'Hotel Due');
set local role authenticated;

-- ---------------------------------------------------------------- 3. anonimo: niente tabelle, niente RPC tranne public_hotel
select tt.as_anon();
reset role; set local role anon;
select tt.expect('anon: tabelle chiuse', tt.count('select 1 from public.hotels'), '42501');
select tt.expect('anon: public_hotel aperta', tt.try($$select public.public_hotel('uno')$$), 'ok');
select tt.expect('anon: request_bonus_qr chiusa', tt.try('select public.request_bonus_qr()'), '42501:permission denied for function request_bonus_qr');
select tt.expect('anon: redeem_bonus chiusa', tt.try($$select public.redeem_bonus('x')$$), '42501:permission denied for function redeem_bonus');
select tt.expect('anon: start_stay chiusa', tt.try($$select public.start_stay(null,'uno','x',null,'it',current_date,true,false,null,'v1')$$) like '42501%', 'true');
set local role authenticated;

-- ---------------------------------------------------------------- 4. bonus: QR con prefisso, riscatto unico, barista di un altro hotel
select tt.as_user(:G1::uuid);
select set_config('t.tok', (public.request_bonus_qr()->>'token'), false);
select tt.expect('token bonus con prefisso b.', (current_setting('t.tok') like 'b.%')::text, 'true');
select tt.as_user(:BAR2::uuid);
select tt.expect('barista di un altro hotel: invalid', (public.redeem_bonus(current_setting('t.tok'))->>'reason'), 'invalid');
select tt.as_user(:REC1::uuid);
select tt.expect('reception non riscatta', (public.redeem_bonus(current_setting('t.tok'))->>'reason'), 'invalid');
select tt.as_user(:BAR1::uuid);
select tt.expect('barista dell''hotel: ok', (public.redeem_bonus(current_setting('t.tok'))->>'ok'), 'true');
select tt.expect('secondo riscatto: already_used', (public.redeem_bonus(current_setting('t.tok'))->>'reason'), 'already_used');
select tt.as_user(:G1::uuid);
select tt.expect('bonus gia'' riscattato: niente nuovo QR', tt.try('select public.request_bonus_qr()'), 'CH003:invalid_bonus');

-- ---------------------------------------------------------------- 5. prenotazioni e eventi: capienza, limite giornaliero, hotel
select tt.as_user(:G1::uuid);
select tt.expect('prenota lo slot', tt.try($$select public.book_slot('51000000-0000-0000-0000-000000000001', 1)$$), 'ok');
select tt.as_user(:G3::uuid);
select tt.expect('slot pieno (capienza 1)', tt.try($$select public.book_slot('51000000-0000-0000-0000-000000000001', 1)$$), 'CH002:slot_full');
select tt.expect('slot di un altro hotel: non disponibile', tt.try($$select public.book_slot('52000000-0000-0000-0000-000000000001', 1)$$), 'CH003:slot_unavailable');
select tt.as_user(:G1::uuid);
select tt.expect('stessa persona, stesso slot', tt.try($$select public.book_slot('51000000-0000-0000-0000-000000000001', 1)$$) in ('CH005:already_booked', 'CH002:slot_full'), 'true');
select tt.expect('evento con capienza 1: primo ok', tt.try($$select public.rsvp_event('e1000000-0000-0000-0000-000000000001')$$), 'ok');
select tt.as_user(:G3::uuid);
select tt.expect('evento pieno', tt.try($$select public.rsvp_event('e1000000-0000-0000-0000-000000000001')$$), 'CH002:event_full');
select tt.expect('evento di un altro hotel', tt.try($$select public.rsvp_event('e2000000-0000-0000-0000-000000000001')$$), 'CH003:event_unavailable');

-- ---------------------------------------------------------------- 6. scadenza: dopo la scadenza il soggiorno non apre piu' nulla
reset role;
update public.stays set expires_at = now() - interval '1 minute', started_at = now() - interval '2 days'
 where guest_id = 'a3000000-0000-0000-0000-000000000001';
set local role authenticated;
select tt.as_user(:G3::uuid);
select tt.expect('ospite scaduto: eventi chiusi', tt.count('select 1 from public.events'), '0');
select tt.expect('ospite scaduto: RPC chiuse', tt.try($$select public.book_slot('51000000-0000-0000-0000-000000000001', 1)$$), 'CH004:forbidden');
select tt.expect('ospite scaduto: contesto AI chiuso', tt.try('select public.ai_context()'), 'CH004:forbidden');

rollback;
\echo 'TUTTI I CONTROLLI SQL SUPERATI'
