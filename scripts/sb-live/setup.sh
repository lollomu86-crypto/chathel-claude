#!/usr/bin/env bash
# Backend vero in locale: Postgres 16 + migrazioni + PostgREST (stessa API REST di Supabase). Non include GoTrue (login staff con password).
# Uso: scripts/sb-live/setup.sh   -> scrive /tmp/sb-live.env con URL e chiavi
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=chathel_live
SECRET=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
psql -qAt -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null
psql -q -d $DB -v ON_ERROR_STOP=1 >/dev/null <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator noinherit login password 'auth'; end if;
end \$\$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth;
SQL
for f in supabase/migrations/*.sql; do psql -q -d $DB -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { echo "ERRORE in $f"; exit 1; }; done
psql -q -d $DB -c "grant usage on schema auth to anon, authenticated, service_role" >/dev/null
jwt() { node -e "
const c=require('crypto'),b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const h=b({alg:'HS256',typ:'JWT'}),p=b({role:process.argv[1],iss:'chathel-live',exp:Math.floor(Date.now()/1000)+86400*30});
console.log(h+'.'+p+'.'+c.createHmac('sha256','$SECRET').update(h+'.'+p).digest('base64url'))" "$1"; }
cat > /tmp/postgrest.conf <<CONF
db-uri = "postgres://authenticator:auth@localhost:5432/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = 3100
db-pre-request = ""
CONF
sed -i '/db-pre-request/d' /tmp/postgrest.conf
for p in $(ps -eo pid,args | grep "pgrst/postgre[s]t" | awk '{print $1}'); do kill $p 2>/dev/null || true; done
sleep 1
nohup /tmp/pgrst/postgrest /tmp/postgrest.conf >/tmp/postgrest.log 2>&1 &
for i in $(seq 1 30); do [ "$(curl -s -o /dev/null -w %{http_code} http://localhost:3100/)" = 200 ] && break; sleep 1; done
cat > /tmp/sb-live.env <<ENV
SUPABASE_URL=http://localhost:3100
SUPABASE_ANON_KEY=$(jwt anon)
SUPABASE_SERVICE_ROLE_KEY=$(jwt service_role)
SB_DB=$DB
PGRST_PREFIX=
SB_SECRET=$SECRET
ENV
curl -s -o /dev/null -w "postgrest: %{http_code}\n" http://localhost:3100/
