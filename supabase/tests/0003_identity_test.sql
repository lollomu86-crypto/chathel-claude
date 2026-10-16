-- Prova di 0003: identita' dell'ospite (accesso con Google), un soggiorno per identita' e hotel, un bonus per stagione,
-- opt-in sociale, cancellazione al check-out. Su Postgres 16, senza Google ne' GoTrue reali.
begin;
\ir _helpers.sql

insert into auth.users(id, email, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000a1', 'privata1@example.test', false), ('00000000-0000-0000-0000-0000000000a2', 'privata2@example.test', false),
  ('00000000-0000-0000-0000-0000000000a3', 'privata3@example.test', false), ('00000000-0000-0000-0000-0000000000a4', 'privata4@example.test', false),
  ('00000000-0000-0000-0000-0000000000a5', 'privata5@example.test', false),
  ('00000000-0000-0000-0000-0000000000b2', 'rec@example.test', false);
insert into public.hotels(id, slug, name, bonus_season_cap, qr_token_hash) values
  ('11111111-1111-1111-1111-111111111111', 'uno', 'Hotel Uno', 3, extensions.digest('qr-uno', 'sha256')),
  ('22222222-2222-2222-2222-222222222222', 'due', 'Hotel Due', 3, extensions.digest('qr-due', 'sha256'));
insert into public.hotel_staff(hotel_id, user_id, role, display_name) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b2', 'reception', 'Rec1');
\set A1 '''00000000-0000-0000-0000-0000000000a1'''
\set A2 '''00000000-0000-0000-0000-0000000000a2'''
\set A3 '''00000000-0000-0000-0000-0000000000a3'''
\set A4 '''00000000-0000-0000-0000-0000000000a4'''
\set A5 '''00000000-0000-0000-0000-0000000000a5'''
\set B2 '''00000000-0000-0000-0000-0000000000b2'''
\set KEY1 '''\\x0101010101010101010101010101010101010101010101010101010101010101'''
\set KEY2 '''\\x0202020202020202020202020202020202020202020202020202020202020202'''
\set KEY3 '''\\x0303030303030303030303030303030303030303030303030303030303030303'''

-- ---------------------------------------------------------------- 1. registrazione identita' e ingresso
set local role service_role;
select tt.as_service();
select public.identity_register(:A1::uuid, 'google', 'sub-giulia', 'Giulia');
select public.identity_register(:A2::uuid, 'google', 'sub-marco', 'Marco');
select public.identity_register(:A3::uuid, 'google', 'sub-sofia', 'Sofia');
select public.identity_register(:A4::uuid, 'google', 'sub-luca', 'Luca');
select tt.expect('identita'' non valida rifiutata', tt.try($$select public.identity_register('00000000-0000-0000-0000-0000000000a5', 'facebook', 'x', 'X')$$), 'CH003:invalid_identity');

select tt.expect('QR sbagliato', tt.try(format($$select public.start_stay(%L,'uno','sbagliato',null,'it',current_date+3,true,true,%L,'v1')$$, :A1, :KEY1)), 'CH003:invalid_qr');
select tt.expect('senza identita'' registrata', tt.try(format($$select public.start_stay(%L,'uno','qr-uno',null,'it',current_date+3,true,true,%L,'v1')$$, :A5, :KEY1)), 'CH004:identity_required');
select tt.expect('hotel sconosciuto = QR non valido', tt.try(format($$select public.start_stay(%L,'nessuno','qr-uno',null,'it',current_date+3,true,true,%L,'v1')$$, :A1, :KEY1)), 'CH003:invalid_qr');
select tt.expect('bonus attivo senza chiave anti-doppione', tt.try(format($$select public.start_stay(%L,'uno','qr-uno',null,'it',current_date+3,true,true,null,'v1')$$, :A1)), 'CH003:identity_key_required');
select tt.expect('check-out nel passato', tt.try(format($$select public.start_stay(%L,'uno','qr-uno',null,'it',current_date-1,true,true,%L,'v1')$$, :A1, :KEY1)), 'CH003:invalid_checkout');
select tt.expect('nickname non valido (e-mail)', tt.try(format($$select public.start_stay(%L,'uno','qr-uno','a@b.it','it',current_date+3,true,true,%L,'v1')$$, :A1, :KEY1)), 'CH003:invalid_nickname');
select tt.expect('nickname non valido (numero lungo)', tt.try(format($$select public.start_stay(%L,'uno','qr-uno','Mario 3331234567','it',current_date+3,true,true,%L,'v1')$$, :A1, :KEY1)), 'CH003:invalid_nickname');

select set_config('t.r1', public.start_stay(:A1::uuid, 'uno', 'qr-uno', 'Giuly', 'it', current_date + 3, true, true, :KEY1::bytea, 'v1')::text, false);
select tt.expect('primo ingresso: bonus emesso', current_setting('t.r1')::jsonb ->> 'bonus', 'issued');
select tt.expect('doppio tocco: stessa sessione, nessun doppione', (public.start_stay(:A1::uuid, 'uno', 'qr-uno', 'Giuly', 'it', current_date + 3, true, true, :KEY1::bytea, 'v1')) ->> 'bonus', 'existing');
select tt.expect('...stesso id ospite', (public.start_stay(:A1::uuid, 'uno', 'qr-uno', null, 'it', current_date + 3, true, true, :KEY1::bytea, 'v1')) ->> 'guest_id', current_setting('t.r1')::jsonb ->> 'guest_id');
select tt.expect('stesso account in un altro hotel: rifiutato', tt.try(format($$select public.start_stay(%L,'due','qr-due',null,'it',current_date+3,true,true,%L,'v1')$$, :A1, :KEY1)), 'CH005:already_in_other_hotel');

reset role;
select tt.expect('un solo ospite e un solo bonus per l''identita''', (select count(*) from public.guests where auth_user_id = :A1::uuid)::text || '/' || (select count(*) from public.welcome_bonuses where hotel_id = '11111111-1111-1111-1111-111111111111')::text, '1/1');
select tt.expect('nome mostrato = nome di battesimo da Google', (select display_name from public.guests where auth_user_id = :A1::uuid), 'Giulia');
select tt.expect('nickname scelto dall''ospite', (select nickname from public.social_profiles where guest_id = (select id from public.guests where auth_user_id = :A1::uuid)), 'Giuly');
select tt.expect('opt-in sociale conservato (B1)', (select visible::text || '/' || (opt_in_at is not null)::text from public.social_profiles where nickname = 'Giuly'), 'true/true');
select tt.expect('consenso registrato', (select (consent_at is not null)::text || '/' || privacy_version || '/' || (adult_declared_at is not null)::text from public.guests where auth_user_id = :A1::uuid), 'true/v1/true');
select tt.expect('nessuna e-mail nelle tabelle dell''app', (select count(*) from public.guests where display_name like '%@%')::text, '0');

-- ---------------------------------------------------------------- 2. nickname, maggiore eta', tetti
set local role service_role; select tt.as_service();
select tt.expect('nickname gia'' preso (senza distinguere maiuscole)', tt.try(format($$select public.start_stay(%L,'uno','qr-uno','GIULY','it',current_date+3,true,true,%L,'v1')$$, :A2, :KEY2)), 'CH005:nickname_taken');
select set_config('t.r2', public.start_stay(:A2::uuid, 'uno', 'qr-uno', null, 'de', current_date + 3, false, true, :KEY2::bytea, 'v1')::text, false);
select tt.expect('senza nickname: il nome di battesimo', (select nickname from public.social_profiles where guest_id = (current_setting('t.r2')::jsonb ->> 'guest_id')::uuid), 'Marco');
select tt.expect('minorenne con opt-in: NON compare nell''elenco', (select visible::text from public.social_profiles where guest_id = (current_setting('t.r2')::jsonb ->> 'guest_id')::uuid), 'false');
select tt.expect('nickname uguale al nome di un altro: rifiutato', tt.try(format($$select public.start_stay(%L,'uno','qr-uno','marco','it',current_date+3,true,false,%L,'v1')$$, :A3, :KEY3)), 'CH005:nickname_taken');

-- tetto di bonus emessi nell'ora (throttling): l'ospite entra, il bonus no
reset role;
update public.hotels set bonus_max_per_hour = 2 where slug = 'uno';
set local role service_role; select tt.as_service();
select set_config('t.r3', public.start_stay(:A3::uuid, 'uno', 'qr-uno', 'Sofi', 'it', current_date + 3, true, false, :KEY3::bytea, 'v1')::text, false);
select tt.expect('terzo ingresso nell''ora: ospite creato, bonus throttled', current_setting('t.r3')::jsonb ->> 'bonus', 'throttled');
reset role;
select tt.expect('...e nessun bonus emesso', (select count(*) from public.welcome_bonuses w where w.guest_id = (current_setting('t.r3')::jsonb ->> 'guest_id')::uuid)::text, '0');
update public.hotels set bonus_max_per_hour = 60, bonus_season_cap = 2 where slug = 'uno';
set local role service_role; select tt.as_service();
select tt.expect('tetto stagionale raggiunto (2 emessi): cap_reached', (public.start_stay(:A4::uuid, 'uno', 'qr-uno', 'Lucky', 'it', current_date + 3, true, false, '\x0404040404040404040404040404040404040404040404040404040404040404'::bytea, 'v1')) ->> 'bonus', 'cap_reached');

-- ---------------------------------------------------------------- 3. privacy: le identita' non si leggono dai client
reset role;
set local role authenticated; select tt.as_user(:B2::uuid);
select tt.expect('reception: guest_identities chiusa', tt.count('select 1 from public.guest_identities'), '42501');
select tt.expect('reception: identity_register chiusa', tt.try($$select public.identity_register('00000000-0000-0000-0000-0000000000a5','google','x','X')$$) like '42501%', 'true');
select tt.expect('reception: start_stay chiusa', tt.try($$select public.start_stay('00000000-0000-0000-0000-0000000000a5','uno','qr-uno',null,'it',current_date,true,false,null,'v1')$$) like '42501%', 'true');
select tt.expect('reception: non legge identity_id', tt.count('select identity_id from public.guests'), '42501');
reset role;
set local role anon; select tt.as_anon();
select tt.expect('anon: guest_identities chiusa', tt.count('select 1 from public.guest_identities'), '42501');
reset role;

-- elenco sociale: solo nickname e lingua (nessun nome di battesimo diverso dal nickname, nessuna e-mail)
set local role authenticated; select tt.as_user(:A1::uuid);
select public.social_accept_rules();
select tt.expect('elenco ospiti: il minorenne non compare, il resto e'' vuoto', tt.count('select 1 from public.social_guests()'), '0');
reset role;

-- ---------------------------------------------------------------- 4. check-out: cancellazione completa, bonus riscattato resta anonimo e blocca il doppione
set local role authenticated; select tt.as_user(:A1::uuid);
select set_config('t.tok', public.request_bonus_qr() ->> 'token', false);
select tt.as_user(:B2::uuid);
reset role;
-- il barista non c'e' in questa prova: si riscatta come amministratore del database simulando il barista
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000b9', 'bar@example.test');
insert into public.hotel_staff(hotel_id, user_id, role, display_name) values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b9', 'bartender', 'Bar1');
set local role authenticated; select tt.as_user('00000000-0000-0000-0000-0000000000b9');
select tt.expect('riscatto del bonus di Giulia', public.redeem_bonus(current_setting('t.tok')) ->> 'ok', 'true');
select tt.as_user(:A1::uuid);
select public.social_update_settings(p_visible => true);
select public.end_my_stay();
reset role;
select tt.expect('check-out: ospite cancellato', (select count(*) from public.guests where auth_user_id = :A1::uuid)::text, '0');
select tt.expect('check-out: identita'' cancellata', (select count(*) from public.guest_identities where provider_subject = 'sub-giulia')::text, '0');
select tt.expect('check-out: utente auth (con la sua e-mail) cancellato', (select count(*) from auth.users where id = :A1::uuid)::text, '0');
select tt.expect('check-out: profilo sociale cancellato', (select count(*) from public.social_profiles where nickname = 'Giuly')::text, '0');
select tt.expect('il soggiorno resta, anonimo', (select count(*) from public.stays where guest_id is null and hotel_id = '11111111-1111-1111-1111-111111111111')::text, '1');
select tt.expect('il bonus riscattato resta, senza persona, con la sola chiave anti-doppione', (select count(*) from public.welcome_bonuses where status = 'redeemed' and guest_id is null and dedupe_key is not null)::text, '1');

-- lo stesso account Google rientra (nuovo utente auth): nello stesso hotel non ottiene un secondo bonus nella stagione
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a6', 'privata1@example.test');
set local role service_role; select tt.as_service();
select public.identity_register('00000000-0000-0000-0000-0000000000a6', 'google', 'sub-giulia', 'Giulia');
select tt.expect('stesso account, stesso hotel, stessa stagione: niente secondo bonus', (public.start_stay('00000000-0000-0000-0000-0000000000a6', 'uno', 'qr-uno', 'Giuly', 'it', current_date + 3, true, false, :KEY1::bytea, 'v1')) ->> 'bonus', 'already_claimed');
reset role;

-- ---------------------------------------------------------------- 5. T-S9: la cancellazione e'' completa e non tocca lo staff
-- un utente che e'' anche staff non viene mai cancellato dall'eliminazione dell'ospite
set local role service_role; select tt.as_service();
select public.identity_register(:B2::uuid, 'google', 'sub-staff', 'Rita');
select public.start_stay(:B2::uuid, 'uno', 'qr-uno', 'Rita', 'it', current_date + 1, true, false, '\x0505050505050505050505050505050505050505050505050505050505050505'::bytea, 'v1');
reset role;
select public.purge_expired_stays();   -- nessuno e'' scaduto: non cambia nulla
select tt.expect('prima del check-out: ospite-staff presente', (select count(*) from public.guests where auth_user_id = :B2::uuid)::text, '1');
update public.stays set expires_at = now() - interval '1 minute', started_at = now() - interval '2 days' where guest_id = (select id from public.guests where auth_user_id = :B2::uuid);
select public.purge_expired_stays();
select tt.expect('scaduto: ospite cancellato', (select count(*) from public.guests where auth_user_id = :B2::uuid)::text, '0');
select tt.expect('...ma l''utente staff resta', (select count(*) from auth.users where id = :B2::uuid)::text || '/' || (select count(*) from public.hotel_staff where user_id = :B2::uuid)::text, '1/1');

-- ---------------------------------------------------------------- 6. identita' orfane (login fatto, QR mai usato) ripulite dal job
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a7', 'orfano@example.test');
set local role service_role; select tt.as_service();
select public.identity_register('00000000-0000-0000-0000-0000000000a7', 'google', 'sub-orfano', 'Orfano');
reset role;
select public.purge_expired_stays();
select tt.expect('identita'' fresca: resta', (select count(*) from public.guest_identities where provider_subject = 'sub-orfano')::text, '1');
update public.guest_identities set created_at = now() - interval '2 days' where provider_subject = 'sub-orfano';
select public.purge_expired_stays();
select tt.expect('identita'' orfana vecchia: cancellata con l''utente auth', (select count(*) from public.guest_identities where provider_subject = 'sub-orfano')::text || '/' || (select count(*) from auth.users where id = '00000000-0000-0000-0000-0000000000a7')::text, '0/0');

rollback;
\echo 'TUTTI I CONTROLLI SQL SUPERATI'
