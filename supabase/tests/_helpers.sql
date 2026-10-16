-- Funzioni di prova condivise (incluse con \ir). Servono dentro la transazione del test.
create schema tt;
grant usage on schema tt to authenticated, service_role, anon;
-- esegue un comando come l'utente corrente e ritorna 'ok' oppure 'SQLSTATE:messaggio'
create function tt.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $$;
create function tt.expect(p_label text, p_actual text, p_expected text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then raise exception 'FALLITO [%]: atteso %, ottenuto %', p_label, p_expected, p_actual; end if;
  raise notice 'OK   %', p_label;
end $$;
create function tt.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;
create function tt.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end $$;
create function tt.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;
-- conteggio come l'utente corrente (con la sua RLS); ritorna testo o l'errore di privilegio
create function tt.count(p_sql text) returns text language plpgsql as $$
declare n bigint;
begin execute 'select count(*) from (' || p_sql || ') q' into n; return n::text; exception when others then return sqlstate; end $$;
grant execute on all functions in schema tt to authenticated, service_role, anon;
create function tt.expect(p_label text, p_actual boolean, p_expected text) returns void language sql as $$ select tt.expect(p_label, p_actual::text, p_expected) $$;
grant execute on function tt.expect(text, boolean, text) to authenticated, service_role, anon;
