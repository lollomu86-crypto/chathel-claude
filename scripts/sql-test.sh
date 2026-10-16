#!/usr/bin/env bash
# Crea un database temporaneo, applica le migration e lancia i test SQL.
# Uso: PGHOST=<socket|host> PGPORT=<porta> PGUSER=postgres scripts/sql-test.sh [file_test.sql ...]
# Richiede un Postgres 16 raggiungibile; NON e' Supabase reale (ruoli e schema auth simulati).
set -euo pipefail
cd "$(dirname "$0")/.."
DB="chathel_t_$$"
psql -qAt -d postgres -c "create database $DB" >/dev/null
OUT=$(mktemp)
trap 'rm -f $OUT; psql -qAt -d postgres -c "drop database if exists $DB with (force)" >/dev/null' EXIT
psql -q -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
SQL
for f in supabase/migrations/*.sql; do
  echo "== $f"; psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f" >"$OUT" 2>&1 || { grep -v NOTICE "$OUT" | tail -20; echo "ERRORE in $f"; exit 1; }
done
FILES=("$@"); [ ${#FILES[@]} -gt 0 ] || FILES=(supabase/tests/[0-9]*.sql)
for t in "${FILES[@]}"; do
  echo "== $t"; psql -q -d "$DB" -v ON_ERROR_STOP=1 -v db="$DB" -v parity_cases="$(cat tests/parity-cases.json)" -f "$t" >"$OUT" 2>&1 || { grep -v 'NOTICE:  OK' "$OUT" | tail -20; echo "FALLITO $t"; exit 1; }
  grep -c 'NOTICE:  OK' "$OUT" | sed 's/^/   controlli OK: /'; grep -E 'SUPERATI' "$OUT" || true
done
if [ ${#} -eq 0 ]; then
  echo "== supabase/tests/concurrency.sh"
  bash supabase/tests/concurrency.sh "$DB" >"$OUT" 2>&1 || { grep -v 'NOTICE:  OK' "$OUT" | tail -20; echo "FALLITO concurrency.sh"; exit 1; }
  grep -c 'NOTICE:  OK' "$OUT" | sed 's/^/   controlli OK: /'; grep SUPERATI "$OUT" || true
fi
echo "SQL: tutto superato"
