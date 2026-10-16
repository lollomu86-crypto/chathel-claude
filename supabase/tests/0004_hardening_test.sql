-- Prova di 0004: privilegi (T-S8), cancellazione (T-S9), colonne dello staff (T-S10), generate_slots (T-S11),
-- ospiti scaduti (T-S6), KPI su tabelle grandi, tetti coupon per hotel, limiti in database, reception sulle sole chat passate all'operatore.
begin;
\ir _helpers.sql

insert into auth.users(id, email, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000a1', null, true), ('00000000-0000-0000-0000-0000000000b1', null, true),
  ('00000000-0000-0000-0000-0000000000c1', null, true), ('00000000-0000-0000-0000-0000000000d1', null, true),
  ('00000000-0000-0000-0000-0000000000e1', 'adm1@x.test', false), ('00000000-0000-0000-0000-0000000000e2', 'rec1@x.test', false),
  ('00000000-0000-0000-0000-0000000000e3', 'multi@x.test', false), ('00000000-0000-0000-0000-0000000000e4', 'adm2@x.test', false);
insert into public.hotels(id, slug, name, bonus_season_cap, qr_token_hash, reception_phone) values
  ('11111111-1111-1111-1111-111111111111', 'uno', 'Hotel Uno', 5000, extensions.digest('qr-uno', 'sha256'), 'interno 9'),
  ('22222222-2222-2222-2222-222222222222', 'due', 'Hotel Due', 5, extensions.digest('qr-due', 'sha256'), null);
insert into public.hotel_staff(hotel_id, user_id, role, display_name) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e1', 'hotel_admin', 'Adm1'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e2', 'reception', 'Rec1'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e3', 'reception', 'Multi'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000e3', 'reception', 'Multi'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000e4', 'hotel_admin', 'Adm2');
insert into public.guests(id, hotel_id, auth_user_id, display_name, is_adult) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', 'Anna', true),
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b1', 'Bruno', true),
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000c1', 'Cora', true),
  ('d1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000d1', 'Dino', true);
insert into public.stays(hotel_id, guest_id, checkin_date, checkout_date, expires_at)
select hotel_id, id, current_date, current_date + 5, now() + interval '5 days' from public.guests;
\set A '''00000000-0000-0000-0000-0000000000a1'''
\set B '''00000000-0000-0000-0000-0000000000b1'''
\set C '''00000000-0000-0000-0000-0000000000c1'''
\set D '''00000000-0000-0000-0000-0000000000d1'''
\set ADM1 '''00000000-0000-0000-0000-0000000000e1'''
\set REC1 '''00000000-0000-0000-0000-0000000000e2'''
\set MULTI '''00000000-0000-0000-0000-0000000000e3'''
\set ADM2 '''00000000-0000-0000-0000-0000000000e4'''

-- ---------------------------------------------------------------- T-S8: nessuna funzione eseguibile da anon / PUBLIC tranne public_hotel
select tt.expect('T-S8 funzioni eseguibili da anon: solo public_hotel',
  coalesce((select string_agg(n.nspname || '.' || p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public', 'app') and has_function_privilege('anon', p.oid, 'execute')), ''), 'public.public_hotel');
select tt.expect('T-S8 nessuna funzione e'' eseguibile da PUBLIC (tranne public_hotel)',
  coalesce((select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public', 'app') and p.proname <> 'public_hotel'
               and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')), ''), '');
select tt.expect('T-S8 le funzioni interne (app.*) non sono eseguibili da authenticated, salvo gli helper delle policy',
  coalesce((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'app' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'execute')), ''),
  'hotel_day_start,is_service,my_guest_id,my_hotel_id,my_staff_id,raw_guest_id,social_nick_ok,social_normalize_text,social_report_staff_hotels,staff_hotel_ids');
select tt.expect('T-S8 funzioni riservate al server: non eseguibili da authenticated',
  coalesce((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('start_stay','identity_register','rate_limit_hit','append_assistant_message','purge_expired_stays','expire_social_coupons')
               and has_function_privilege('authenticated', p.oid, 'execute')), ''), '');

-- ---------------------------------------------------------------- T-S11: generate_slots termina anche a fine giornata
insert into public.facilities(id, hotel_id, kind, name) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'spa', '{"it":"Spa"}'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'spa', '{"it":"Spa due"}');
set local role authenticated; select tt.as_user(:REC1::uuid);
select tt.expect('T-S11 23:00-23:59 con slot da 30 minuti: 1 slot (prima: ciclo infinito)', (public.generate_slots('f1000000-0000-0000-0000-000000000001', current_date + 1, current_date + 1, '23:00', '23:59', 30))::text, '1');
select tt.expect('T-S11 23:30-23:59 con slot da 30: nessuno slot, nessun ciclo', (public.generate_slots('f1000000-0000-0000-0000-000000000001', current_date + 1, current_date + 1, '23:30', '23:59', 30))::text, '0');
select tt.expect('T-S11 fascia 10-12 da 30 minuti: 4 slot', (public.generate_slots('f1000000-0000-0000-0000-000000000001', current_date + 2, current_date + 2, '10:00', '12:00', 30))::text, '4');
select tt.expect('T-S11 rigenerare non duplica', (public.generate_slots('f1000000-0000-0000-0000-000000000001', current_date + 2, current_date + 2, '10:00', '12:00', 30))::text, '0');
select tt.expect('T-S11 intervallo di 3 giorni', (public.generate_slots('f1000000-0000-0000-0000-000000000001', current_date + 3, current_date + 5, '00:00', '23:59', 480))::text, '6');
select tt.expect('T-S11 fine prima dell''inizio', tt.try($$select public.generate_slots('f1000000-0000-0000-0000-000000000001', current_date, current_date, '12:00', '10:00', 30)$$), 'CH003:invalid_range');
select tt.expect('T-S11 oltre 92 giorni', tt.try($$select public.generate_slots('f1000000-0000-0000-0000-000000000001', current_date, current_date + 93, '10:00', '12:00', 30)$$), 'CH003:invalid_range');
select tt.expect('T-S11 servizio di un altro hotel', tt.try($$select public.generate_slots('f2000000-0000-0000-0000-000000000001', current_date + 1, current_date + 1, '10:00', '12:00', 30)$$), 'CH004:forbidden');
-- salto all'ora legale (ultima domenica di marzo del 2027: 28/03): le 02:30 locali non esistono, nessun errore
select tt.expect('T-S11 cambio ora legale senza errori', tt.try($$select public.generate_slots('f1000000-0000-0000-0000-000000000001', date '2027-03-28', date '2027-03-28', '00:00', '06:00', 60)$$), 'ok');
reset role;

-- servizio disattivato = non prenotabile
update public.facilities set active = false where id = 'f1000000-0000-0000-0000-000000000001';
set local role authenticated; select tt.as_user(:A::uuid);
select tt.expect('servizio disattivato: slot non prenotabile', tt.try($$select public.book_slot((select id from public.slots where facility_id = 'f1000000-0000-0000-0000-000000000001' order by starts_at limit 1), 1)$$), 'CH003:slot_unavailable');
reset role;
update public.facilities set active = true where id = 'f1000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------- limiti di frequenza condivisi (rate_limit_hit)
set local role service_role; select tt.as_service();
select tt.expect('rate: 1', public.rate_limit_hit('k1', 3, 60)::text, 'true');
select tt.expect('rate: 2', public.rate_limit_hit('k1', 3, 60)::text, 'true');
select tt.expect('rate: 3', public.rate_limit_hit('k1', 3, 60)::text, 'true');
select tt.expect('rate: 4 = bloccato', public.rate_limit_hit('k1', 3, 60)::text, 'false');
select tt.expect('rate: altra chiave indipendente', public.rate_limit_hit('k2', 3, 60)::text, 'true');
reset role;
update public.rate_limits set window_start = now() - interval '2 minutes' where key = 'k1';
set local role service_role; select tt.as_service();
select tt.expect('rate: finestra scaduta, si riparte', public.rate_limit_hit('k1', 3, 60)::text, 'true');
select tt.expect('rate: parametri non validi', tt.try($$select public.rate_limit_hit('k', 3, 0)$$), 'CH003:invalid_input');
reset role;
set local role authenticated; select tt.as_user(:A::uuid);
select tt.expect('rate: non chiamabile da un ospite', tt.try($$select public.rate_limit_hit('k', 3, 60)$$) like '42501%', 'true');
-- richieste del QR bonus: 30 ogni 10 minuti per ospite
reset role;
insert into public.welcome_bonuses(hotel_id, guest_id, season_year, expires_at)
values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', (select season_year from public.hotels where slug = 'uno'), now() + interval '5 days');
set local role authenticated; select tt.as_user(:A::uuid);
do $$ declare i int; r text; begin
  for i in 1..31 loop
    r := tt.try('select public.request_bonus_qr()');
    if r <> 'ok' then perform tt.expect('request_bonus_qr: blocco alla 31a richiesta', i::text || '/' || r, '31/CH007:rate_limited'); return; end if;
  end loop;
  raise exception 'FALLITO [request_bonus_qr senza limite]';
end $$;
reset role;

-- ---------------------------------------------------------------- tetti coupon per hotel + social: ospiti scaduti non visibili (T-S6)
set local role authenticated;
select tt.as_user(:A::uuid); select public.social_update_settings(p_visible => true); select public.social_accept_rules();
select tt.as_user(:B::uuid); select public.social_update_settings(p_visible => true); select public.social_accept_rules();
select tt.as_user(:C::uuid); select public.social_update_settings(p_visible => true); select public.social_accept_rules();
select tt.as_user(:A::uuid);
select set_config('t.b', (select id::text from public.social_guests() where nickname = 'Bruno'), false);
select set_config('t.c', (select id::text from public.social_guests() where nickname = 'Cora'), false);
select set_config('t.thB', public.social_start_thread(current_setting('t.b')::uuid, 'Ciao Bruno')::text, false);
select set_config('t.thC', public.social_start_thread(current_setting('t.c')::uuid, 'Ciao Cora')::text, false);
select tt.as_user(:B::uuid); select public.social_respond(current_setting('t.thB')::uuid, true);
select tt.as_user(:C::uuid); select public.social_respond(current_setting('t.thC')::uuid, true);
select public.social_post_public('messaggio di Cora');
select tt.as_user(:A::uuid);
select tt.expect('prima della scadenza: A vede B e C', tt.count('select 1 from public.social_guests()'), '2');
select tt.expect('prima della scadenza: il messaggio di Cora e'' nel feed', tt.count($$select 1 from public.social_feed() where body = 'messaggio di Cora'$$), '1');

reset role;
update public.hotels set coupon_daily_cap = 1 where slug = 'uno';
set local role authenticated; select tt.as_user(:A::uuid);
select tt.expect('coupon 1: ok', tt.try($$select public.social_send_coupon(current_setting('t.thB')::uuid, 'coffee')$$), 'ok');
select tt.expect('coupon 2: tetto giornaliero dell''hotel', tt.try($$select public.social_send_coupon(current_setting('t.thC')::uuid, 'coffee')$$), 'CH007:hotel_coupon_limit');
reset role;
update public.hotels set coupon_daily_cap = 60, coupon_active_cap = 1 where slug = 'uno';
set local role authenticated; select tt.as_user(:A::uuid);
select tt.expect('coupon: tetto dei coupon in circolazione dell''hotel', tt.try($$select public.social_send_coupon(current_setting('t.thC')::uuid, 'coffee')$$), 'CH007:hotel_coupon_limit');
reset role;
update public.hotels set coupon_active_cap = 40 where slug = 'uno';

-- parita' con la demo (T-D3): un profilo rimosso dalla moderazione non genera il QR di un coupon ricevuto (CH004 social_removed)
select set_config('t.cp', (select id::text from public.social_coupons where recipient_id = current_setting('t.b')::uuid limit 1), false);
update public.social_profiles set removed = true, visible = false where id = current_setting('t.b')::uuid;
set local role authenticated; select tt.as_user(:B::uuid);
select tt.expect('parita'' demo: profilo rimosso = QR coupon negato', tt.try($$select public.social_coupon_qr(current_setting('t.cp')::uuid)$$), 'CH004:social_removed');
reset role;
update public.social_profiles set removed = false, visible = true where id = current_setting('t.b')::uuid;

-- Cora: il soggiorno e'' scaduto ma il job non e'' ancora passato
update public.stays set expires_at = now() - interval '1 minute', started_at = now() - interval '2 days' where guest_id = 'c1000000-0000-0000-0000-000000000001';
update public.social_profiles set stay_expires_at = now() - interval '1 minute' where guest_id = 'c1000000-0000-0000-0000-000000000001';
set local role authenticated; select tt.as_user(:A::uuid);
select tt.expect('T-S6 ospite scaduto non piu'' nell''elenco', tt.count('select 1 from public.social_guests()'), '1');
select tt.expect('T-S6 il suo messaggio non e'' piu'' nel feed', tt.count($$select 1 from public.social_feed() where body = 'messaggio di Cora'$$), '0');
select tt.expect('T-S6 la sua conversazione non e'' piu'' nell''elenco', tt.count($$select 1 from public.social_threads_list() where peer_nickname = 'Cora'$$), '0');
select tt.expect('T-S6 non gli si puo'' scrivere', tt.try($$select public.social_send_private(current_setting('t.thC')::uuid, 'sei li''?')$$) like 'CH004%', 'true');
reset role;

-- ---------------------------------------------------------------- M7: staff con due hotel e moderazione per oggetto
set local role authenticated; select tt.as_user(:D::uuid);
select public.social_update_settings(p_visible => true); select public.social_accept_rules();
select public.social_post_public('annuncio dal due');
reset role;
set local role authenticated; select tt.as_user(:MULTI::uuid);
select tt.expect('M7 staff su due hotel: statistiche senza indicare quale = errore', tt.try('select public.social_stats()'), 'CH003:hotel_required');
select tt.expect('M7 statistiche dell''hotel indicato', (public.social_stats('7d', '22222222-2222-2222-2222-222222222222') ->> 'public_messages'), '1');
select tt.expect('M7 statistiche di un hotel non suo', tt.try($$select public.social_stats('7d', '99999999-9999-9999-9999-999999999999')$$), 'CH004:forbidden');
select tt.expect('M7 nasconde un messaggio del secondo hotel (non "il primo")', tt.try($$select public.social_hide_message((select id from public.social_public_messages where body = 'annuncio dal due'), true)$$), 'ok');
select tt.as_user(:REC1::uuid);
select tt.expect('M7 la reception dell''hotel 1 non tocca il messaggio dell''hotel 2', tt.try($$select public.social_hide_message((select id from public.social_public_messages where body = 'messaggio di Cora'), true)$$), 'ok');
select tt.expect('M7 ...ma neppure quello dell''hotel 2 (id sconosciuto per lui)', tt.try($$select public.social_hide_message('99999999-9999-9999-9999-999999999999', true)$$), 'CH003:invalid_message');
select tt.as_user(:D::uuid);
select tt.expect('M7 un ospite non e'' staff', tt.try($$select public.social_hide_message('99999999-9999-9999-9999-999999999999', true)$$), 'CH004:forbidden');
reset role;
select tt.expect('M7 il messaggio del due e'' nascosto, quello dell''uno pure', (select count(*) from public.social_public_messages where hidden)::text, '2');

-- ---------------------------------------------------------------- reception e chat AI: solo conversazioni passate all'operatore
insert into public.ai_conversations(id, hotel_id, guest_id, status, handoff_at) values
  ('c1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'ai', null),
  ('c1000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001', 'handoff_pending', now());
insert into public.ai_messages(hotel_id, conversation_id, role, content) values
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000a1', 'guest', 'domanda riservata di Anna'),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000b1', 'guest', 'domanda passata all''operatore');
set local role authenticated; select tt.as_user(:REC1::uuid);
select tt.expect('M3 la reception vede solo la conversazione passata', tt.count('select 1 from public.ai_conversations'), '1');
select tt.expect('M3 ...e solo i suoi messaggi', tt.count('select 1 from public.ai_messages'), '1');
select tt.expect('M3 non risponde in una chat non passata', tt.try($$insert into public.ai_messages(hotel_id, conversation_id, role, staff_id, content) values ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000a1', 'operator', (select app.my_staff_id('11111111-1111-1111-1111-111111111111')), 'ciao')$$) like '42501%', 'true');
select tt.expect('M3 risponde in quella passata', tt.try($$insert into public.ai_messages(hotel_id, conversation_id, role, staff_id, content) values ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000b1', 'operator', (select app.my_staff_id('11111111-1111-1111-1111-111111111111')), 'ciao')$$), 'ok');
select tt.expect('M3 non chiude una chat non passata (nessuna riga)', tt.try($$update public.ai_conversations set status = 'closed' where id = 'c1000000-0000-0000-0000-0000000000a1'$$), 'ok');
select tt.as_user(:A::uuid);
select tt.expect('l''ospite vede la propria chat', tt.count('select 1 from public.ai_conversations'), '1');
select tt.expect('ai_context contiene il telefono della reception', public.ai_context() -> 'hotel' ->> 'reception_phone', 'interno 9');
reset role;
select tt.expect('M3 la chat non passata non e'' stata chiusa', (select status::text from public.ai_conversations where id = 'c1000000-0000-0000-0000-0000000000a1'), 'ai');

-- limiti in database sui messaggi dell'ospite (rete di sicurezza)
set local role authenticated; select tt.as_user(:A::uuid);
select tt.expect('messaggio oltre 1000 caratteri', tt.try($$insert into public.ai_messages(hotel_id, conversation_id, role, content) values ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000a1', 'guest', repeat('x', 1001))$$), 'CH003:too_long');
do $$ declare i int; r text; begin
  for i in 1..25 loop
    r := tt.try($q$insert into public.ai_messages(hotel_id, conversation_id, role, content) values ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000a1', 'guest', 'ciao')$q$);
    if r <> 'ok' then perform tt.expect('limite al minuto in database (20)', i::text || '/' || r, '20/CH007:rate_limited'); return; end if;
  end loop;
  raise exception 'FALLITO [nessun limite al minuto]';
end $$;
reset role;

-- messaggio dell'assistente atomico e priorita'
set local role service_role; select tt.as_service();
select public.append_assistant_message('c1000000-0000-0000-0000-0000000000a1', 'risposta 1');
select public.append_assistant_message('c1000000-0000-0000-0000-0000000000a1', 'risposta 2');
reset role;
select tt.expect('contatore risposte', (select ai_answer_count::text from public.ai_conversations where id = 'c1000000-0000-0000-0000-0000000000a1'), '2');
set local role service_role; select tt.as_service();
select public.append_assistant_message('c1000000-0000-0000-0000-0000000000a1', 'chiamate il 112', null, null, 'safety', 'emergenza', 'urgent');
select public.append_assistant_message('c1000000-0000-0000-0000-0000000000a1', 'altro', null, null, 'kb_gap', 'wifi', 'normal');
reset role;
select tt.expect('emergenza: priorita'' urgent, motivo safety, resta cosi'' anche dopo un altro passaggio',
  (select handoff_priority || '/' || handoff_reason::text || '/' || status::text from public.ai_conversations where id = 'c1000000-0000-0000-0000-0000000000a1'), 'urgent/safety/handoff_pending');
set local role authenticated; select tt.as_user(:A::uuid);
select tt.expect('append_assistant_message non chiamabile dall''ospite', tt.try($$select public.append_assistant_message('c1000000-0000-0000-0000-0000000000a1','falso')$$) like '42501%', 'true');
reset role;

-- "risposta sbagliata": una sola segnalazione per messaggio
insert into public.audit_log(hotel_id, action, meta) values ('11111111-1111-1111-1111-111111111111', 'ai.marked_wrong', '{"message_id": 77}');
select tt.expect('segnalazione ripetuta = vincolo di unicita''', tt.try($$insert into public.audit_log(hotel_id, action, meta) values ('11111111-1111-1111-1111-111111111111', 'ai.marked_wrong', '{"message_id": 77}')$$) like '23505%', 'true');

-- ---------------------------------------------------------------- KPI su tabelle grandi: conteggi SQL esatti oltre le 1000 righe
insert into public.stays(hotel_id, guest_id, checkin_date, checkout_date, started_at, expires_at, status)
select '22222222-2222-2222-2222-222222222222', null, current_date, current_date, now() - interval '1 hour', now() + interval '1 hour', 'ended' from generate_series(1, 1500);
update public.hotels set bonus_season_cap = 5000 where slug = 'due';
insert into public.welcome_bonuses(hotel_id, guest_id, season_year, status, expires_at, redeemed_at)
select '22222222-2222-2222-2222-222222222222', null, (select season_year from public.hotels where slug = 'due'), case when g % 3 = 0 then 'redeemed' else 'issued' end::public.bonus_status, now() + interval '1 day',
       case when g % 3 = 0 then now() else null end from generate_series(1, 1500) g;
insert into public.bonus_redemptions(hotel_id, bonus_id, token_hash, status, expires_at, redeemed_at)
select hotel_id, id, extensions.digest(id::text, 'sha256'), 'redeemed', now() + interval '1 hour', now()
  from public.welcome_bonuses where hotel_id = '22222222-2222-2222-2222-222222222222' and status = 'redeemed';
insert into public.ai_conversations(hotel_id, guest_id, status, ai_answer_count, handoff_at)
select '22222222-2222-2222-2222-222222222222', null, 'closed', 2, case when g % 5 = 0 then now() else null end from generate_series(1, 1500) g;
set local role authenticated; select tt.as_user(:ADM2::uuid);
select set_config('t.kpi', public.hotel_kpi_counts('22222222-2222-2222-2222-222222222222', 'season')::text, false);
select tt.expect('KPI: soggiorni = 1501 (1500 anonimi + 1 ospite; oltre le 1000 righe di PostgREST)', current_setting('t.kpi')::jsonb ->> 'stays_started', '1501');
select tt.expect('KPI: bonus emessi = 1500', current_setting('t.kpi')::jsonb ->> 'bonuses_issued', '1500');
select tt.expect('KPI: riscattati = 500 (1 su 3)', current_setting('t.kpi')::jsonb ->> 'bonuses_redeemed', '500');
select tt.expect('KPI: conversazioni 1500, passate 300, risolte 1200, risposte 3000',
  (current_setting('t.kpi')::jsonb ->> 'conversations') || '/' || (current_setting('t.kpi')::jsonb ->> 'handoffs') || '/' || (current_setting('t.kpi')::jsonb ->> 'resolved_by_ai') || '/' || (current_setting('t.kpi')::jsonb ->> 'ai_answers'),
  '1500/300/1200/3000');
select tt.expect('KPI: I6 conta solo ospiti ancora collegati (1) e nessuna azione (0)', (current_setting('t.kpi')::jsonb ->> 'i6_base') || '/' || (current_setting('t.kpi')::jsonb ->> 'i6_engaged'), '1/0');
select tt.expect('KPI: un periodo non valido e'' rifiutato', tt.try($$select public.hotel_kpi_counts('22222222-2222-2222-2222-222222222222', 'forever')$$), 'CH003:invalid_input');
select tt.as_user(:REC1::uuid);
select tt.expect('KPI: la reception non li vede', tt.try($$select public.hotel_kpi_counts('11111111-1111-1111-1111-111111111111', 'season')$$), 'CH004:forbidden');
select tt.as_user(:ADM1::uuid);
select tt.expect('KPI: il direttore di un altro hotel non vede quelli del due', tt.try($$select public.hotel_kpi_counts('22222222-2222-2222-2222-222222222222', 'season')$$), 'CH004:forbidden');
select tt.expect('KPI: i propri si', tt.try($$select public.hotel_kpi_counts('11111111-1111-1111-1111-111111111111', 'season')$$), 'ok');
reset role;

-- ---------------------------------------------------------------- M5: un errore su un ospite non ferma la pulizia degli altri
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000f1'), ('00000000-0000-0000-0000-0000000000f2');
insert into public.guests(id, hotel_id, auth_user_id, display_name) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000f1', 'Boom'),
  ('f2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000f2', 'Regolare');
insert into public.stays(hotel_id, guest_id, checkin_date, checkout_date, started_at, expires_at)
select '11111111-1111-1111-1111-111111111111', id, current_date - 3, current_date - 1, now() - interval '3 days', now() - interval '1 minute' from public.guests where display_name in ('Boom', 'Regolare');
create function tt.boom() returns trigger language plpgsql as $$ begin if old.display_name = 'Boom' then raise exception 'boom'; end if; return old; end $$;
create trigger tt_boom before delete on public.guests for each row execute function tt.boom();
select public.purge_expired_stays();
select tt.expect('M5 l''ospite regolare e'' stato cancellato nonostante l''errore sull''altro', (select count(*) from public.guests where display_name = 'Regolare')::text, '0');
select tt.expect('M5 ...l''errore e'' registrato', (select count(*) from public.audit_log where action = 'purge.failed')::text, '1');
select tt.expect('M5 ...e riassunto', (select count(*) from public.audit_log where action = 'purge.errors')::text, '1');
drop trigger tt_boom on public.guests;
select public.purge_expired_stays();
select tt.expect('M5 al passaggio successivo anche l''ospite problematico e'' cancellato', (select count(*) from public.guests where display_name = 'Boom')::text, '0');

rollback;
\echo 'TUTTI I CONTROLLI SQL SUPERATI'
