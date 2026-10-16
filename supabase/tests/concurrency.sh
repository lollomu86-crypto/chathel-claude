#!/usr/bin/env bash
# Prove di concorrenza (T-S1..T-S5 e altre): piu' sessioni psql vere, tutte pronte e fatte partire allo stesso istante
# (pg_sleep_until su un orario comune). Si lancia da scripts/sql-test.sh: concurrency.sh <database>
# Ogni scenario conta gli esiti: se il database lasciasse passare due richieste che devono escludersi, il conteggio non torna.
set -uo pipefail
DB="${1:?uso: concurrency.sh <database>}"
P=(psql -X -q -At -d "$DB")
FAIL=0
ok()   { echo "NOTICE:  OK   $1"; }
fail() { echo "FALLITO [$1]: atteso $2, ottenuto $3"; FAIL=1; }
check() { [ "$3" = "$2" ] && ok "$1" || fail "$1" "$2" "$3"; }

"${P[@]}" -v ON_ERROR_STOP=1 <<'SQL'
create schema if not exists ct;
create or replace function ct.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $$;
create or replace function ct.val(p_sql text) returns text language plpgsql as $$
declare r text; begin execute p_sql into r; return r; exception when others then return 'ERR:' || sqlstate || ':' || sqlerrm; end $$;
grant usage on schema ct to authenticated, service_role;
grant execute on all functions in schema ct to authenticated, service_role;

insert into auth.users(id, email, is_anonymous)
select ('00000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid, case when g > 1000 then 'staff' || g || '@x.test' end, g <= 1000 from generate_series(1, 1020) g;
insert into public.hotels(id, slug, name, bonus_season_cap, bonus_max_per_hour, qr_token_hash, max_bookings_per_guest_day, coupon_daily_cap) values
  ('11111111-1111-1111-1111-111111111111', 'uno', 'Hotel Uno', 3, 100, extensions.digest('qr-uno', 'sha256'), 2, 2),
  ('22222222-2222-2222-2222-222222222222', 'due', 'Hotel Due', 100, 2, extensions.digest('qr-due', 'sha256'), 2, 60);
-- staff: 1001 = barista uno
insert into public.hotel_staff(hotel_id, user_id, role, display_name) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000003e9', 'bartender', 'Bar'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000003ea', 'bartender', 'Bar2');
-- ospiti 1..60 dell'hotel uno con soggiorno attivo
insert into public.guests(id, hotel_id, auth_user_id, display_name, is_adult)
select ('a0000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
       ('00000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid, 'Ospite ' || g, true from generate_series(1, 60) g;
insert into public.stays(hotel_id, guest_id, checkin_date, checkout_date, expires_at)
select hotel_id, id, current_date, current_date + 5, now() + interval '5 days' from public.guests;
SQL

# lancia N sessioni; $1=ruolo $2=lista di uid (uno per sessione, separati da spazio, vuoto = service) $3=sql ("{i}" = indice) $4=cartella esiti
run_parallel() {
  local role="$1" uids="$2" sql="$3" out="$4" i=0 start
  mkdir -p "$out"; rm -f "$out"/*
  start=$("${P[@]}" -c "select clock_timestamp() + interval '2 seconds'")
  for uid in $uids; do
    i=$((i + 1))
    local claims
    if [ "$role" = service_role ]; then claims='{"role":"service_role"}'; else claims="{\"sub\":\"$uid\",\"role\":\"authenticated\"}"; fi
    local s="${sql//\{i\}/$i}" ; s="${s//\{uid\}/$uid}"
    ( "${P[@]}" -c "begin; set local role $role; select set_config('request.jwt.claims', '$claims', true); select pg_sleep_until('$start'::timestamptz); select ct.val(\$q\$ $s \$q\$); commit;" 2>&1 | grep -v '^$' | tail -1 > "$out/$i" ) &
  done
  wait
}
count_of() { cat "$1"/* 2>/dev/null | grep -c -- "$2" || true; }
uid() { printf '00000000-0000-0000-0000-%012x' "$1"; }
UIDS() { local a="" n; for n in $(seq "$1" "$2"); do a="$a $(uid "$n")"; done; echo "$a"; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

# ---- T-S1: lo stesso QR bonus riscattato da 2 baristi x 5 sessioni: un solo "ok"
"${P[@]}" -v ON_ERROR_STOP=1 -c "insert into public.welcome_bonuses(id, hotel_id, guest_id, season_year, expires_at) values ('b0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001',(select season_year from public.hotels where slug='uno'), now()+interval '1 day');"
TOK=$("${P[@]}" -c "begin; set local role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$(uid 1)\",\"role\":\"authenticated\"}',true); select public.request_bonus_qr()->>'token'; commit;" | tail -1)
run_parallel authenticated "$(uid 1001) $(uid 1002) $(uid 1001) $(uid 1002) $(uid 1001) $(uid 1002) $(uid 1001) $(uid 1002)" "select public.redeem_bonus('$TOK')->>'ok'" "$T/s1"
check "T-S1 stesso QR bonus da 8 sessioni: un solo riscatto" "1" "$(count_of "$T/s1" '^true$')"
check "T-S1 ...e il database ha una sola riscossione" "1" "$("${P[@]}" -c "select count(*) from public.bonus_redemptions where status='redeemed'")"

# ---- T-S2: lo stesso QR coupon da 8 sessioni
"${P[@]}" -v ON_ERROR_STOP=1 <<'SQL'
insert into public.social_profiles(id, hotel_id, guest_id, nickname, visible, stay_expires_at) values
  ('90000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000002','Mittente',true, now()+interval '1 day'),
  ('90000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000003','Destinataria',true, now()+interval '1 day');
insert into public.social_coupons(id, hotel_id, kind, sender_id, recipient_id, expires_at) values
  ('c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','coffee','90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002', now()+interval '1 day');
insert into public.social_coupon_qrs(hotel_id, coupon_id, token_hash, expires_at) values
  ('11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000001', extensions.digest('c.token-di-prova','sha256'), now()+interval '1 hour');
SQL
run_parallel authenticated "$(uid 1001) $(uid 1002) $(uid 1001) $(uid 1002) $(uid 1001) $(uid 1002) $(uid 1001) $(uid 1002)" "select public.redeem_coupon('c.token-di-prova')->>'ok'" "$T/s2"
check "T-S2 stesso QR coupon da 8 sessioni: un solo riscatto" "1" "$(count_of "$T/s2" '^true$')"

# ---- T-S3: tetto stagionale (3) con 20 ingressi simultanei di identita' diverse
"${P[@]}" -v ON_ERROR_STOP=1 -c "insert into auth.users(id, email) select ('00000000-0000-0000-0001-' || lpad(to_hex(g), 12, '0'))::uuid, 'g' || g || '@x.test' from generate_series(1, 20) g; insert into auth.users(id, email) select ('00000000-0000-0000-0002-' || lpad(to_hex(g), 12, '0'))::uuid, 'h' || g || '@x.test' from generate_series(1, 20) g;"
"${P[@]}" -v ON_ERROR_STOP=1 -c "set role service_role; select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false); select public.identity_register(('00000000-0000-0000-000' || n || '-' || lpad(to_hex(g), 12, '0'))::uuid, 'demo', 'conc-' || n || '-' || g, 'Nome' || g) from generate_series(1, 20) g, (values (1),(2)) v(n);" >/dev/null
U3=""; for n in $(seq 1 20); do U3="$U3 00000000-0000-0000-0001-$(printf '%012x' "$n")"; done
run_parallel service_role "$U3" "select public.start_stay('{uid}'::uuid, 'uno', 'qr-uno', 'Nick{i}', 'it', current_date+2, true, false, ('\\x' || lpad(to_hex({i}), 64, '0'))::bytea, 'v1')->>'bonus'" "$T/s3"
check "T-S3 tetto stagionale (3, di cui 1 gia' usato): 20 ingressi simultanei, 2 bonus" "2" "$(count_of "$T/s3" '^issued$')"
check "T-S3 ...tutti gli altri cap_reached" "18" "$(count_of "$T/s3" '^cap_reached$')"
check "T-S3 ...e nel database mai piu' di 3 bonus emessi o riscattati" "3" "$("${P[@]}" -c "select count(*) from public.welcome_bonuses where hotel_id='11111111-1111-1111-1111-111111111111' and status in ('issued','redeemed')")"
check "T-S3 un solo ospite per identita'" "20" "$("${P[@]}" -c "select count(*) from public.guests where identity_id is not null")"

# ---- T-S3b: tetto orario (2) sull'hotel due, 20 ingressi simultanei di identita' diverse
U3b=""; for n in $(seq 1 20); do U3b="$U3b 00000000-0000-0000-0002-$(printf '%012x' "$n")"; done
run_parallel service_role "$U3b" "select public.start_stay('{uid}'::uuid, 'due', 'qr-due', 'Due{i}', 'it', current_date+2, true, false, ('\\x' || lpad(to_hex({i} + 100), 64, '0'))::bytea, 'v1')->>'bonus'" "$T/s3b"
check "T-S3b tetto orario (2): 20 ingressi simultanei, 2 bonus" "2" "$(count_of "$T/s3b" '^issued$')"
check "T-S3b ...gli altri entrano senza bonus (throttled)" "18" "$(count_of "$T/s3b" '^throttled$')"

# ---- T-S4: tetti giornalieri
# prenotazioni: 2 al giorno per ospite, 6 richieste simultanee dello stesso ospite su slot diversi
"${P[@]}" -v ON_ERROR_STOP=1 <<'SQL'
insert into public.facilities(id, hotel_id, kind, name) values ('f1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','spa','{"it":"Spa"}');
insert into public.slots(id, hotel_id, facility_id, starts_at, ends_at, capacity)
select ('51000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001',
       date_trunc('day', now() + interval '2 days') + interval '10 hours' + g * interval '1 hour', date_trunc('day', now() + interval '2 days') + interval '11 hours' + g * interval '1 hour', 5
  from generate_series(1, 8) g;
update public.hotels set coupon_daily_cap = 3, bonus_season_cap = 100 where slug = 'uno';
insert into public.slots(id, hotel_id, facility_id, starts_at, ends_at, capacity)
values ('52000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','f1000000-0000-0000-0000-000000000001', now() + interval '4 days', now() + interval '4 days 1 hour', 1);
SQL
run_parallel authenticated "$(uid 10) $(uid 10) $(uid 10) $(uid 10) $(uid 10) $(uid 10)" "select case when ct.try(format('select public.book_slot(%L, 1)', '51000000-0000-0000-0000-' || lpad(to_hex({i}), 12, '0'))) = 'ok' then 'ok' else 'no' end" "$T/s4a"
check "T-S4 tetto prenotazioni giornaliere (2) con 6 richieste simultanee" "2" "$(count_of "$T/s4a" '^ok$')"

# ---- T-S5: ultimo posto: 12 ospiti diversi, slot con capienza 1
run_parallel authenticated "$(UIDS 11 22)" "select case when ct.try('select public.book_slot(''52000000-0000-0000-0000-000000000001'', 1)') = 'ok' then 'ok' else ct.try('select public.book_slot(''52000000-0000-0000-0000-000000000001'', 1)') end" "$T/s5"
check "T-S5 ultimo posto: una sola prenotazione riuscita" "1" "$(count_of "$T/s5" '^ok$')"
check "T-S5 ...booked_count mai oltre la capienza" "1" "$("${P[@]}" -c "select booked_count from public.slots where id='52000000-0000-0000-0000-000000000001'")"

# coupon: tetto per ospite (3) con 8 richieste simultanee di invio
"${P[@]}" -v ON_ERROR_STOP=1 <<'SQL'
insert into public.social_profiles(id, hotel_id, guest_id, nickname, visible, rules_accepted_at, stay_expires_at)
select ('91000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111', ('a0000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid,
       'Utente' || chr(64 + g), true, now(), now() + interval '2 days' from generate_series(30, 35) g where false;
SQL
"${P[@]}" -v ON_ERROR_STOP=1 <<'SQL'
-- mittente M (ospite 40) e 8 destinatari (41..48) con conversazioni accettate
insert into public.social_profiles(id, hotel_id, guest_id, nickname, visible, rules_accepted_at, stay_expires_at)
select ('91000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111', ('a0000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid,
       'Persona ' || chr(64 + g - 39), true, now(), now() + interval '2 days' from generate_series(40, 48) g;
insert into public.social_threads(id, hotel_id, initiator_id, recipient_id, status)
select ('92000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
       '91000000-0000-0000-0000-000000000028', ('91000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid, 'accepted' from generate_series(41, 48) g;
SQL
# hotel uno ha coupon_daily_cap = 3 e un coupon e' gia' stato emesso (T-S2): ne passano al massimo 2 (tetto dell'hotel, piu' stretto di quello per ospite: 3)
run_parallel authenticated "$(for n in 1 2 3 4 5 6 7 8; do printf '%s ' "$(uid 40)"; done)" "select case when ct.try(format('select public.social_send_coupon(%L, ''coffee'')', '92000000-0000-0000-0000-' || lpad(to_hex({i} + 40), 12, '0'))) = 'ok' then 'ok' else 'no' end" "$T/s4b"
check "T-S4 tetto coupon dell'hotel (2) con 8 invii simultanei dello stesso ospite" "2" "$(count_of "$T/s4b" '^ok$')"
check "T-S4 ...e nel database 2 coupon nuovi" "2" "$("${P[@]}" -c "select count(*) from public.social_coupons where sender_id='91000000-0000-0000-0000-000000000028'")"

# messaggi AI dell'ospite: massimo 20 al minuto (rete di sicurezza in database), 30 richieste simultanee
"${P[@]}" -v ON_ERROR_STOP=1 -c "insert into public.ai_conversations(id, hotel_id, guest_id) values ('c0000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000032');"
run_parallel authenticated "$(for n in $(seq 1 30); do printf '%s ' "$(uid 50)"; done)" "select case when ct.try('insert into public.ai_messages(hotel_id, conversation_id, role, content) values (''11111111-1111-1111-1111-111111111111'', ''c0000000-0000-0000-0000-0000000000a1'', ''guest'', ''ciao'')') = 'ok' then 'ok' else 'no' end" "$T/s4c"
check "T-S4 messaggi AI: al massimo 20 al minuto con 30 richieste simultanee" "20" "$(count_of "$T/s4c" '^ok$')"

# limite di frequenza condiviso
run_parallel service_role "$(for n in $(seq 1 20); do printf 'x '; done)" "select public.rate_limit_hit('conc', 5, 60)::text" "$T/s6"
check "rate_limit_hit: 20 richieste simultanee, 5 consentite" "5" "$(count_of "$T/s6" '^true$')"

# QR bonus: un solo QR in attesa per bonus anche con 10 richieste simultanee dell'ospite
"${P[@]}" -v ON_ERROR_STOP=1 -c "insert into public.welcome_bonuses(hotel_id, guest_id, season_year, expires_at) values ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-00000000003c',(select season_year from public.hotels where slug='uno'), now()+interval '1 day');"
run_parallel authenticated "$(for n in $(seq 1 10); do printf '%s ' "$(uid 60)"; done)" "select case when ct.try('select public.request_bonus_qr()') = 'ok' then 'ok' else 'no' end" "$T/s7"
"${P[@]}" -c "select 1" >/dev/null
check "QR bonus: nessun errore con 10 richieste simultanee" "0" "$(count_of "$T/s7" '^no$')"
check "QR bonus: al piu' un QR in attesa per bonus" "0" "$("${P[@]}" -c "select count(*) from (select bonus_id from public.bonus_redemptions where status='pending' group by bonus_id having count(*) > 1) q")"

[ "$FAIL" = 0 ] && echo "TUTTI I CONTROLLI SQL SUPERATI" || { echo "CONCORRENZA: ci sono fallimenti"; exit 1; }
