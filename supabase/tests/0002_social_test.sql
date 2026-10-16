-- Prova delle regole sociali su un Postgres pulito (dopo 0001_init.sql e 0002_social.sql).
-- Uso: psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/0002_social_test.sql
-- Ogni controllo che fallisce fa terminare lo script con un errore. NON e' un test Supabase reale:
-- l'impersonificazione e' fatta con request.jwt.claims + SET ROLE authenticated (stesso meccanismo di PostgREST).
begin;

create schema tt;
grant usage on schema tt to authenticated;
-- esegue un comando come l'utente corrente e ritorna 'ok' oppure 'SQLSTATE:messaggio'
create function tt.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $$;
create function tt.expect(p_label text, p_actual text, p_expected text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then raise exception 'FALLITO [%]: atteso %, ottenuto %', p_label, p_expected, p_actual; end if;
  raise notice 'OK   %', p_label;
end $$;
grant execute on function tt.try(text), tt.expect(text, text, text) to authenticated;

-- ---------------------------------------------------------------- dati di prova
insert into auth.users(id, email, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000a1', null, true), ('00000000-0000-0000-0000-0000000000b1', null, true),
  ('00000000-0000-0000-0000-0000000000c1', null, true), ('00000000-0000-0000-0000-0000000000d1', null, true),
  ('00000000-0000-0000-0000-0000000000e1', 'rec@x.test', false), ('00000000-0000-0000-0000-0000000000f1', 'bar@x.test', false),
  ('00000000-0000-0000-0000-0000000000a2', null, true);
insert into public.hotels(id, slug, name) values
  ('11111111-1111-1111-1111-111111111111', 'demo', 'Hotel Demo'), ('22222222-2222-2222-2222-222222222222', 'altro', 'Hotel Altro');
insert into public.hotel_staff(hotel_id, user_id, role, display_name) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e1', 'reception', 'Marta'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000f1', 'bartender', 'Luca');
-- a1 Anna, b1 Bruno (adulti), c1 minorenne, d1 adulto che NON fa opt-in, a2 ospite di un altro hotel
insert into public.guests(id, hotel_id, auth_user_id, display_name, is_adult) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', 'Anna Bianchi', true),
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b1', 'Bruno Verdi', true),
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000c1', 'Teo', false),
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000d1', 'Dario', true),
  ('a0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000a2', 'Zoe', true);
insert into public.stays(hotel_id, guest_id, checkin_date, checkout_date, expires_at)
select hotel_id, id, current_date, current_date + 5, now() + interval '5 days' from public.guests;

-- impersonificazione
create function tt.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;
grant execute on function tt.as_user(uuid) to authenticated;
\set A '''00000000-0000-0000-0000-0000000000a1'''
\set B '''00000000-0000-0000-0000-0000000000b1'''
\set C '''00000000-0000-0000-0000-0000000000c1'''
\set D '''00000000-0000-0000-0000-0000000000d1'''
\set REC '''00000000-0000-0000-0000-0000000000e1'''
\set BAR '''00000000-0000-0000-0000-0000000000f1'''
\set Z '''00000000-0000-0000-0000-0000000000a2'''


-- ---------------------------------------------------------------- 1. opt-in, minorenni, elenco
set local role authenticated;
select tt.as_user(:A::uuid);
select tt.expect('profilo creato nascosto, nickname = solo nome di battesimo',
  (public.social_settings()->>'nickname') || '/' || (public.social_settings()->>'visible'), 'Anna/false');
select tt.expect('senza opt-in niente elenco', tt.try('select * from public.social_guests()'), 'CH004:social_opt_in_required');
select tt.expect('senza opt-in niente chat pubblica', tt.try($$select public.social_post_public('ciao')$$), 'CH004:social_opt_in_required');
select tt.expect('opt-in', (public.social_update_settings(p_visible => true)->>'visible'), 'true');
select tt.expect('scrivere richiede le regole', tt.try($$select public.social_post_public('ciao')$$), 'CH004:rules_required');
select public.social_accept_rules();
select tt.as_user(:B::uuid);
select public.social_update_settings(p_visible => true); select public.social_accept_rules();
select tt.as_user(:C::uuid);
select tt.expect('minorenne: niente opt-in', tt.try('select public.social_update_settings(p_visible => true)'), 'CH004:adult_required');
select tt.expect('minorenne: niente elenco', tt.try('select * from public.social_guests()'), 'CH004:adult_required');
select tt.as_user(:D::uuid);
select public.social_settings();                               -- profilo creato, resta nascosto
select tt.as_user(:Z::uuid);
select public.social_update_settings(p_visible => true); select public.social_accept_rules();
select tt.as_user(:A::uuid);
select tt.expect('elenco: solo Bruno (non D senza opt-in, non il minorenne, non altro hotel)',
  (select string_agg(nickname, ',') from public.social_guests()), 'Bruno');
select tt.expect('elenco: nessun altro campo oltre a id, nickname, locale, can_message',
  (select array_to_string(proargnames, ',') from pg_proc where proname = 'social_guests'), 'id,nickname,locale,can_message');
select tt.expect('RLS: l''ospite non legge direttamente le chat', tt.try('select * from public.social_threads'), '42501:permission denied for table social_threads');
select tt.expect('RLS: i profili degli altri non sono leggibili', (select count(*) from public.social_profiles)::text, '0');
select tt.expect('nickname con contatto rifiutato', tt.try($$select public.social_update_settings(p_nickname => 'mario@mail.it')$$), 'CH003:invalid_nickname');
select tt.expect('nickname con numero rifiutato', tt.try($$select public.social_update_settings(p_nickname => 'camera 12345')$$), 'CH003:invalid_nickname');
select tt.expect('nickname gia'' usato', tt.try($$select public.social_update_settings(p_nickname => 'bruno')$$), 'CH005:nickname_taken');
select tt.expect('uscire dall''elenco', (public.social_update_settings(p_visible => false)->>'visible'), 'false');
select tt.as_user(:B::uuid);
select tt.expect('Anna uscita: Bruno non la vede', (select count(*) from public.social_guests())::text, '0');
select tt.as_user(:A::uuid);
select public.social_update_settings(p_visible => true);

-- ---------------------------------------------------------------- 2. chat pubblica
select tt.expect('281 caratteri rifiutati', tt.try('select public.social_post_public(repeat(''x'', 281))'), 'CH003:too_long');
select tt.expect('280 caratteri ok', tt.try('select public.social_post_public(repeat(''x'', 280))'), 'ok');
select public.social_post_public('m1'); select public.social_post_public('m2'); select public.social_post_public('m3'); select public.social_post_public('m4');
select tt.expect('limite di frequenza (5/minuto)', tt.try($$select public.social_post_public('troppi')$$), 'CH007:rate_limited');
select tt.as_user(:B::uuid);
select tt.expect('Bruno vede 5 messaggi', (select count(*) from public.social_feed())::text, '5');
select tt.expect('segnalazione ok', tt.try($$select public.social_report_public((select id from public.social_feed() where body = 'm1'), 'harassment')$$), 'ok');
select tt.expect('segnalazione ripetuta idempotente', tt.try($$select public.social_report_public((select id from public.social_feed() where body = 'm1'), 'harassment')$$), 'ok');
select tt.as_user(:A::uuid);
select tt.expect('segnalare il proprio messaggio non si puo''', tt.try($$select public.social_report_public((select id from public.social_feed() where body = 'm1'), 'spam')$$), 'CH003:invalid_message');
select tt.as_user(:Z::uuid);
select tt.expect('altro hotel: chat separata', (select count(*) from public.social_feed())::text, '0');

-- ---------------------------------------------------------------- 3. moderazione
select tt.as_user(:REC::uuid);
select tt.expect('reception: coda con 1 segnalazione aperta', (select count(*) from public.social_reports where status = 'open')::text, '1');
select tt.expect('reception: nessun accesso alle chat private', tt.try('select count(*) from public.social_messages'), '42501:permission denied for table social_messages');
select tt.expect('reception: non legge le preferenze dei profili', tt.try('select accepts_private from public.social_profiles'), '42501:permission denied for table social_profiles');
select public.social_hide_message((select message_id from public.social_reports where status = 'open'), true);
select tt.expect('nascondere chiude la segnalazione', (select count(*) from public.social_reports where status = 'actioned')::text, '1');
select tt.as_user(:B::uuid);
select tt.expect('messaggio nascosto non piu'' visibile', (select count(*) from public.social_feed())::text, '4');
select tt.as_user(:BAR::uuid);
select tt.expect('barista: moderazione vietata', tt.try($$select public.social_hide_message(gen_random_uuid(), true)$$), 'CH004:forbidden');
select tt.expect('barista: stats vietate', tt.try($$select public.social_stats('7d')$$), 'CH004:forbidden');
select tt.as_user(:REC::uuid);
select public.social_mute((select id from public.social_profiles where nickname = 'Anna'), now() + interval '1 hour');
select tt.as_user(:A::uuid);
select tt.expect('silenziata: non scrive in pubblico', tt.try($$select public.social_post_public('x')$$), 'CH004:muted');
select tt.as_user(:REC::uuid);
select public.social_mute((select id from public.social_profiles where nickname = 'Anna'), null);
-- (nel test tutto sta in una transazione, quindi now() non avanza: si retrodatano i messaggi per superare il limite di frequenza)
reset role; update public.social_public_messages set created_at = created_at - interval '5 minutes'; set local role authenticated;
select tt.as_user(:A::uuid);
select tt.expect('riattivata: scrive', tt.try($$select public.social_post_public('di nuovo')$$), 'ok');

-- ---------------------------------------------------------------- 4. chat privata: richiesta, accetta, limiti, blocco
reset role;
select set_config('t.bruno', (select id::text from public.social_profiles where nickname = 'Bruno'), false);
select set_config('t.anna',  (select id::text from public.social_profiles where nickname = 'Anna'),  false);
select set_config('t.dario', (select id::text from public.social_profiles where nickname = 'Dario'), false);
select set_config('t.zoe',   (select id::text from public.social_profiles where nickname = 'Zoe'),   false);
set local role authenticated;
select tt.as_user(:A::uuid);
select tt.expect('richiesta a chi non e'' visibile: indisponibile', tt.try('select public.social_start_thread(current_setting(''t.dario'')::uuid, ''ciao'')'), 'CH004:recipient_unavailable');
select tt.expect('richiesta a un ospite di un altro hotel: non valida', tt.try('select public.social_start_thread(current_setting(''t.zoe'')::uuid, ''ciao'')'), 'CH003:invalid_guest');
select set_config('t.thread', public.social_start_thread(current_setting('t.bruno')::uuid, 'Un aperitivo?')::text, false);
select tt.expect('il mittente non puo'' insistere', tt.try('select public.social_send_private(current_setting(''t.thread'')::uuid, ''rispondi'')'), 'CH004:thread_not_open');
select tt.expect('richiesta doppia', tt.try('select public.social_start_thread(current_setting(''t.bruno'')::uuid, ''ancora'')'), 'CH005:thread_exists');
select tt.expect('nessun coupon prima dell''accettazione', tt.try('select public.social_send_coupon(current_setting(''t.thread'')::uuid, ''coffee'')'), 'CH004:thread_not_open');
select tt.as_user(:B::uuid);
select tt.expect('Bruno vede la richiesta in arrivo', (select incoming::text || '/' || status::text from public.social_threads_list()), 'true/pending');
select tt.expect('Bruno non puo'' rispondere senza accettare', tt.try('select public.social_send_private(current_setting(''t.thread'')::uuid, ''si'')'), 'CH004:thread_not_open');
select tt.as_user(:A::uuid);
select tt.expect('chi ha scritto non puo'' accettare', tt.try('select public.social_respond(current_setting(''t.thread'')::uuid, true)'), 'CH004:forbidden');
select tt.as_user(:B::uuid);
select public.social_respond(current_setting('t.thread')::uuid, true);
select tt.expect('richiesta non ripetibile', tt.try('select public.social_respond(current_setting(''t.thread'')::uuid, true)'), 'CH005:thread_not_pending');
select tt.expect('Bruno risponde', tt.try('select public.social_send_private(current_setting(''t.thread'')::uuid, ''Volentieri'')'), 'ok');
select tt.expect('messaggio privato oltre 280 caratteri', tt.try('select public.social_send_private(current_setting(''t.thread'')::uuid, repeat(''y'', 281))'), 'CH003:too_long');
select tt.as_user(:C::uuid);
select tt.expect('un terzo non vede la conversazione', tt.try('select * from public.social_thread_messages(current_setting(''t.thread'')::uuid)'), 'CH004:adult_required');
select tt.as_user(:Z::uuid);
select tt.expect('un ospite di un altro hotel non la vede', tt.try('select * from public.social_thread_messages(current_setting(''t.thread'')::uuid)'), 'CH003:invalid_thread');
select tt.as_user(:REC::uuid);
select tt.expect('l''hotel non legge i messaggi privati', tt.try('select * from public.social_thread_messages(current_setting(''t.thread'')::uuid)'), 'CH004:forbidden');

-- rifiuto: Anna -> Dario non e' possibile (Dario nascosto); proviamo Anna -> Dario dopo opt-in e rifiuto
select tt.as_user(:D::uuid);
select public.social_update_settings(p_visible => true); select public.social_accept_rules();
select tt.as_user(:A::uuid);
select set_config('t.th2', public.social_start_thread(current_setting('t.dario')::uuid, 'Ciao Dario')::text, false);
select tt.as_user(:D::uuid);
select public.social_respond(current_setting('t.th2')::uuid, false);
select tt.as_user(:A::uuid);
select tt.expect('rifiutata: Anna vede "declined"', (select status::text from public.social_threads_list() where peer_nickname = 'Dario'), 'declined');
select tt.expect('rifiutata: non si ripete', tt.try('select public.social_start_thread(current_setting(''t.dario'')::uuid, ''riprovo'')'), 'CH004:recipient_unavailable');

-- opzione "non ricevere privati" e risposta identica
select tt.as_user(:D::uuid);
select public.social_update_settings(p_accepts_private => false);
select tt.as_user(:B::uuid);
select tt.expect('privati disattivati: indisponibile', tt.try('select public.social_start_thread(current_setting(''t.dario'')::uuid, ''ciao'')'), 'CH004:recipient_unavailable');

-- limite di frequenza dei messaggi privati (10/minuto), rimasto dopo i precedenti
select tt.as_user(:B::uuid);
do $$ declare i int; r text; begin
  for i in 1..12 loop
    r := tt.try('select public.social_send_private(current_setting(''t.thread'')::uuid, ''msg' || i || ''')');
    if r <> 'ok' then perform tt.expect('limite 10/minuto raggiunto', r, 'CH007:rate_limited'); exit; end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- 5. segnalazione privata (solo il messaggio e i precedenti vicini)
reset role;
-- nella stessa transazione now() e' costante: si distanziano i messaggi in ordine di inserimento
with o as (select id, row_number() over (order by ctid) n from public.social_messages)
  update public.social_messages m set created_at = now() - interval '5 minutes' + o.n * interval '1 second' from o where o.id = m.id;
set local role authenticated;
select tt.as_user(:A::uuid);
select set_config('t.msg', (select id::text from public.social_thread_messages(current_setting('t.thread')::uuid) where body = 'msg3'), false);
select tt.expect('segnalazione privata', tt.try('select public.social_report_private(current_setting(''t.thread'')::uuid, current_setting(''t.msg'')::uuid, ''harassment'')'), 'ok');
select tt.as_user(:REC::uuid);
select tt.expect('lo snapshot contiene al massimo 5 messaggi', (select jsonb_array_length(snapshot)::text from public.social_reports where kind = 'private'), '5');
select tt.expect('...e nessun messaggio successivo', (select (snapshot::text like '%msg4%')::text from public.social_reports where kind = 'private'), 'false');

-- ---------------------------------------------------------------- 6. coupon: invio, QR, uso singolo, scadenza, blocco
select tt.as_user(:A::uuid);
select set_config('t.c1', public.social_send_coupon(current_setting('t.thread')::uuid, 'aperitif')::text, false);
select tt.expect('coupon visibile nella chat privata', (select coupon_kind::text || '/' || coupon_direction from public.social_thread_messages(current_setting('t.thread')::uuid) where kind = 'coupon'), 'aperitif/sent');
select tt.expect('il mittente non puo'' generare il QR', tt.try('select public.social_coupon_qr(current_setting(''t.c1'')::uuid)'), 'CH003:invalid_coupon');
select tt.as_user(:B::uuid);
select set_config('t.tok', (public.social_coupon_qr(current_setting('t.c1')::uuid))->>'token', false);
select tt.expect('token con prefisso c.', (current_setting('t.tok') like 'c.%')::text, 'true');
select tt.as_user(:REC::uuid);
select tt.expect('la reception non valida', (public.redeem_coupon(current_setting('t.tok')))->>'reason', 'invalid');
select tt.as_user(:BAR::uuid);
select tt.expect('il barista valida', (public.redeem_coupon(current_setting('t.tok')))->>'from_name', 'Anna');
select tt.expect('secondo uso rifiutato', (public.redeem_coupon(current_setting('t.tok')))->>'reason', 'already_used');
select tt.as_user(:B::uuid);
select tt.expect('QR su coupon gia'' usato', tt.try('select public.social_coupon_qr(current_setting(''t.c1'')::uuid)'), 'CH003:invalid_coupon');

-- scadenza: coupon scaduto non validabile
select tt.as_user(:A::uuid);
select set_config('t.c2', public.social_send_coupon(current_setting('t.thread')::uuid, 'dinner')::text, false);
select tt.as_user(:B::uuid);
select set_config('t.tok2', (public.social_coupon_qr(current_setting('t.c2')::uuid))->>'token', false);
reset role; update public.social_coupons set expires_at = now() - interval '1 minute', created_at = now() - interval '2 days' where id = current_setting('t.c2')::uuid;
update public.social_coupon_qrs set expires_at = now() + interval '1 minute'; set local role authenticated;
select tt.as_user(:BAR::uuid);
select tt.expect('coupon scaduto non valido', (public.redeem_coupon(current_setting('t.tok2')))->>'reason', 'bonus_not_valid');

-- il soggiorno del destinatario limita la scadenza
reset role; update public.stays set expires_at = now() + interval '3 hours' where guest_id = 'b0000000-0000-0000-0000-000000000001';
update public.social_profiles set stay_expires_at = now() + interval '3 hours' where nickname = 'Bruno'; set local role authenticated;
select tt.as_user(:A::uuid);
select set_config('t.c3', public.social_send_coupon(current_setting('t.thread')::uuid, 'coffee')::text, false);
reset role;
select tt.expect('scadenza <= fine soggiorno del destinatario', (select (expires_at <= now() + interval '3 hours 1 minute')::text from public.social_coupons where id = current_setting('t.c3')::uuid), 'true');
set local role authenticated;

-- tetto giornaliero (3) e blocco
select tt.as_user(:A::uuid);
select tt.expect('terzo coupon di oggi', tt.try('select public.social_send_coupon(current_setting(''t.thread'')::uuid, ''coffee'')'), 'ok');
select tt.expect('quarto coupon rifiutato', tt.try('select public.social_send_coupon(current_setting(''t.thread'')::uuid, ''coffee'')'), 'CH007:coupon_daily_limit');
select tt.as_user(:B::uuid);
select public.social_block(current_setting('t.anna')::uuid);
reset role;
select tt.expect('blocco: nessun coupon ancora valido', (select count(*)::text from public.social_coupons where status = 'issued'), '0');
set local role authenticated;
select tt.as_user(:A::uuid);
select tt.expect('bloccata: non puo'' scrivere', tt.try('select public.social_send_private(current_setting(''t.thread'')::uuid, ''ciao'')'), 'CH004:recipient_unavailable');
select tt.expect('bloccata: non compare in elenco', (select count(*) from public.social_guests() where nickname = 'Bruno')::text, '0');
select tt.expect('bloccata: nuova richiesta indisponibile', tt.try('select public.social_start_thread(current_setting(''t.bruno'')::uuid, ''ciao'')'), 'CH004:recipient_unavailable');
select tt.as_user(:B::uuid);
select tt.expect('chi blocca non vede piu'' la conversazione', (select count(*) from public.social_threads_list())::text, '0');
select tt.expect('...e non puo'' piu'' aprirla', tt.try('select * from public.social_thread_messages(current_setting(''t.thread'')::uuid)'), 'CH003:invalid_thread');

-- ---------------------------------------------------------------- 7. numeri aggregati
select tt.as_user(:REC::uuid);
select tt.expect('stats: coupon inviati / riscattati', (public.social_stats('season')->>'coupons_sent') || '/' || (public.social_stats('season')->>'coupons_redeemed'), '4/1');
select tt.expect('stats: nessun dato personale', (public.social_stats('season')::text ~* '(anna|bruno|dario)')::text, 'false');

-- ---------------------------------------------------------------- 8. check-out: tutto sparisce, restano righe anonime
reset role;
select tt.expect('prima: segnalazioni aperte', (select count(*) from public.social_reports where status = 'open')::text, '1');
select app.purge_guest('a0000000-0000-0000-0000-000000000001');
select tt.expect('profilo cancellato', (select count(*) from public.social_profiles where nickname = 'Anna')::text, '0');
select tt.expect('messaggi pubblici dell''ospite cancellati', (select count(*) from public.social_public_messages where body in ('m2','m3','m4','di nuovo'))::text, '0');
select tt.expect('conversazioni con l''ospite cancellate', (select count(*) from public.social_threads)::text, '0');
select tt.expect('messaggi privati cancellati', (select count(*) from public.social_messages)::text, '0');
select tt.expect('segnalazioni svuotate e chiuse', (select count(*) from public.social_reports where snapshot <> '[]'::jsonb or status = 'open')::text, '0');
select tt.expect('coupon restano come righe anonime', (select count(*) from public.social_coupons where sender_id is null)::text, '4');
select tt.expect('coupon non usati annullati', (select count(*) from public.social_coupons where status = 'issued')::text, '0');
select tt.expect('contatori anonimi conservati', (select (count(*) > 0)::text from public.social_events where type = 'public_message'), 'true');

rollback;
\echo 'TUTTI I CONTROLLI SQL SUPERATI'
