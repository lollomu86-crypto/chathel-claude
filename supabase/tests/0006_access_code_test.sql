-- Prova di 0005: codice numerico dell'hotel (formato, unicita', ricerca solo da server, ingresso, permessi, rotazione)
begin;
\ir _helpers.sql

insert into auth.users(id, email, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000a1', 'g1@x.test', false), ('00000000-0000-0000-0000-0000000000e1', 'adm@x.test', false),
  ('00000000-0000-0000-0000-0000000000e2', 'rec@x.test', false);
insert into public.hotels(id, slug, name, bonus_season_cap, qr_token_hash, access_code) values
  ('11111111-1111-1111-1111-111111111111', 'uno', 'Hotel Uno', 0, extensions.digest('qr-uno', 'sha256'), '123456'),
  ('22222222-2222-2222-2222-222222222222', 'due', 'Hotel Due', 0, extensions.digest('qr-due', 'sha256'), null);

select tt.expect('gli hotel senza codice ne ricevono uno alla creazione manuale', (select count(*) from public.hotels where access_code is null)::text, '1');
select tt.expect('il formato e'' di 6 cifre', tt.try($$update public.hotels set access_code = '12345' where slug = 'due'$$), '23514:new row for relation "hotels" violates check constraint "hotels_access_code_fmt"');
select tt.expect('il codice e'' unico', substr(tt.try($$update public.hotels set access_code = '123456' where slug = 'due'$$), 1, 5), '23505');

-- ricerca: solo il server
select tt.as_service();
select tt.expect('hotel_by_code trova l''hotel', public.hotel_by_code('123456'), 'uno');
select tt.expect('hotel_by_code: codice sconosciuto', coalesce(public.hotel_by_code('654321'), 'null'), 'null');
select tt.expect('hotel_by_code: formato errato', coalesce(public.hotel_by_code('12'), 'null'), 'null');
select tt.as_anon();
select tt.expect('anon non puo'' cercare per codice', substr(tt.try($$select public.hotel_by_code('123456')$$), 1, 5), 'CH004');
select tt.as_user('00000000-0000-0000-0000-0000000000a1');
select tt.expect('un utente autenticato non puo'' cercare per codice', substr(tt.try($$select public.hotel_by_code('123456')$$), 1, 5), 'CH004');

-- ingresso: il codice vale come il QR, un codice sbagliato no
select tt.as_service();
select tt.expect('start_stay con codice errato', substr(tt.try($$select public.start_stay('00000000-0000-0000-0000-0000000000a1','uno','999999','x','it',(now() at time zone 'Europe/Rome')::date + 2, true, false, '\x01', 'v1')$$), 1, 5), 'CH003');
select tt.expect('start_stay col codice numerico supera il controllo del QR (poi manca l''identita'')', substr(tt.try($$select public.start_stay('00000000-0000-0000-0000-0000000000a1','uno','123456','x','it',(now() at time zone 'Europe/Rome')::date + 2, true, false, '\x01', 'v1')$$), 1, 5), 'CH004');
select tt.expect('start_stay col codice del QR resta valido', substr(tt.try($$select public.start_stay('00000000-0000-0000-0000-0000000000a1','uno','qr-uno','x','it',(now() at time zone 'Europe/Rome')::date + 2, true, false, '\x01', 'v1')$$), 1, 5), 'CH004');

-- amministratore: legge e ruota solo il proprio hotel
insert into public.hotel_staff(hotel_id, user_id, role, display_name) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e1', 'hotel_admin', 'Admin'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000e2', 'reception', 'Rec');
select tt.as_user('00000000-0000-0000-0000-0000000000e1');
select tt.expect('l''admin legge il codice', public.get_hotel_access_code('11111111-1111-1111-1111-111111111111'), '123456');
select tt.expect('l''admin non legge quello di un altro hotel', substr(tt.try($$select public.get_hotel_access_code('22222222-2222-2222-2222-222222222222')$$), 1, 5), 'CH004');
select tt.expect('la rotazione dà un nuovo codice di 6 cifre', (public.rotate_hotel_access_code('11111111-1111-1111-1111-111111111111') ~ '^[0-9]{6}$')::text, 'true');
select tt.expect('il codice è cambiato', (public.get_hotel_access_code('11111111-1111-1111-1111-111111111111') <> '123456')::text, 'true');
select tt.as_service();
select tt.expect('il vecchio codice non trova più l''hotel', coalesce(public.hotel_by_code('123456'), 'null'), 'null');
select tt.as_user('00000000-0000-0000-0000-0000000000e2');
select tt.expect('la reception non legge il codice', substr(tt.try($$select public.get_hotel_access_code('11111111-1111-1111-1111-111111111111')$$), 1, 5), 'CH004');
select tt.expect('la reception non lo ruota', substr(tt.try($$select public.rotate_hotel_access_code('11111111-1111-1111-1111-111111111111')$$), 1, 5), 'CH004');
select tt.as_anon();
select tt.expect('anon non legge il codice', substr(tt.try($$select public.get_hotel_access_code('11111111-1111-1111-1111-111111111111')$$), 1, 5), 'CH004');

rollback;
\echo SUPERATI 0005 codice hotel
