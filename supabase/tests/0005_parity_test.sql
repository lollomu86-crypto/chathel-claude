-- Parita' tra TypeScript e SQL: stessi casi (tests/parity-cases.json) per nickname e normalizzazione dei messaggi.
-- Il file JSON arriva da scripts/sql-test.sh come variabile psql :parity_cases
begin;
\ir _helpers.sql
select set_config('t.cases', :'parity_cases', false);

do $$
declare
  c jsonb; v text; r text; bad text := ''; n int := 0;
begin
  for c in select * from jsonb_array_elements(current_setting('t.cases')::jsonb -> 'nicknames') loop
    v := regexp_replace(app.social_normalize_text(c ->> 'input'), '\s+', ' ', 'g');
    r := case when app.social_nick_ok(v) then v end;
    n := n + 1;
    if r is distinct from (c ->> 'expected') then bad := bad || format('[nickname %L: SQL %L, atteso %L] ', c ->> 'input', r, c ->> 'expected'); end if;
  end loop;
  for c in select * from jsonb_array_elements(current_setting('t.cases')::jsonb -> 'messages') loop
    r := app.social_normalize_text(c ->> 'input');
    n := n + 1;
    if r is distinct from (c ->> 'expected') then bad := bad || format('[messaggio %L: SQL %L, atteso %L] ', c ->> 'input', r, c ->> 'expected'); end if;
  end loop;
  if bad <> '' then raise exception 'FALLITO parita'': %', bad; end if;
  raise notice 'OK   parita'' SQL su % casi', n;
end $$;
rollback;
\echo 'TUTTI I CONTROLLI SQL SUPERATI'
