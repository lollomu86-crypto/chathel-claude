-- 0008: giochi dell'hotel e sfide tra ospiti.
--
-- Giochi (ping pong, calcio balilla...): li gestisce l'hotel dal pannello (direttore e reception) e NON si prenotano.
-- Sfide: proposta di partita a un gioco, a un orario vicino, con una posta fissa ('coffee' = chi perde offre il caffe',
-- 'aperitif' = l'aperitivo, 'fun' = solo per divertimento). In privato dentro una conversazione accettata, oppure aperta
-- nella chat pubblica (la accetta il primo). Nessun risultato registrato. Stesse regole di rules/social.ts (SOCIAL_LIMITS):
-- 5 sfide al giorno, 3 aperte insieme, orario tra 5 minuti e 12 ore, mai oltre il soggiorno di chi sfida.
--
-- La sala giochi esce dai servizi prenotabili: per ogni hotel con una 'gamesroom' attiva si creano i giochi
-- "Ping pong" e "Calcio balilla" e la sala viene disattivata (le prenotazioni gia' fatte restano valide).
-- Da eseguire in Supabase PRIMA di pubblicare il codice che la usa.

-- -----------------------------------------------------------------------------
-- 1. Giochi
-- -----------------------------------------------------------------------------
create table public.games (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references public.hotels(id) on delete cascade,
  name         jsonb not null check (jsonb_typeof(name) = 'object'),
  description  jsonb check (description is null or jsonb_typeof(description) = 'object'),
  location     text check (location is null or char_length(location) <= 120),
  active       boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  unique (id, hotel_id)
);
create index games_hotel_idx on public.games(hotel_id, sort_order);

alter table public.games enable row level security;
grant select, insert, update, delete on public.games to authenticated;
create policy games_select_guest on public.games for select to authenticated
  using (active and hotel_id = (select app.my_hotel_id()));
create policy games_select_staff on public.games for select to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));
create policy games_write_staff on public.games for all to authenticated
  using (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])))
  with check (hotel_id in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])));

-- -----------------------------------------------------------------------------
-- 2. Sfide (accesso solo via RPC, come il resto del livello sociale)
-- -----------------------------------------------------------------------------
create table public.social_challenges (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references public.hotels(id) on delete cascade,
  game_id        uuid,
  game           jsonb not null check (jsonb_typeof(game) = 'object'),   -- nome al momento della sfida
  challenger_id  uuid not null,
  opponent_id    uuid,
  thread_id      uuid,
  starts_at      timestamptz not null,
  stake          text not null check (stake in ('coffee', 'aperitif', 'fun')),
  status         text not null default 'open' check (status in ('open', 'accepted', 'declined', 'cancelled')),
  created_at     timestamptz not null default now(),
  responded_at   timestamptz,
  check (thread_id is null or opponent_id is not null),
  check (challenger_id is distinct from opponent_id),
  foreign key (game_id, hotel_id)       references public.games(id, hotel_id)           on delete set null (game_id),
  foreign key (challenger_id, hotel_id) references public.social_profiles(id, hotel_id) on delete cascade,
  foreign key (opponent_id, hotel_id)   references public.social_profiles(id, hotel_id) on delete cascade,
  foreign key (thread_id, hotel_id)     references public.social_threads(id, hotel_id)  on delete cascade
);
create index social_challenges_hotel_idx on public.social_challenges(hotel_id, starts_at) where thread_id is null;
create index social_challenges_thread_idx on public.social_challenges(thread_id) where thread_id is not null;
create index social_challenges_challenger_idx on public.social_challenges(challenger_id, created_at);

alter table public.social_challenges enable row level security;
revoke all on public.social_challenges from anon, authenticated;
grant all on public.social_challenges to service_role;

-- 'expired' = aperta ma l'orario e' passato (calcolato, non salvato)
create function app.challenge_status(c public.social_challenges) returns text
language sql stable as $$ select case when c.status = 'open' and c.starts_at <= now() then 'expired' else c.status end $$;

-- -----------------------------------------------------------------------------
-- 3. RPC ospite
-- -----------------------------------------------------------------------------
create function public.social_challenge_create(p_game uuid, p_starts_at timestamptz, p_stake text, p_thread uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(true);
  g public.games;
  v_opp uuid;
  v_id uuid;
begin
  if p_stake is null or p_stake not in ('coffee', 'aperitif', 'fun') then raise exception 'invalid_stake' using errcode = 'CH003'; end if;
  select * into g from public.games where id = p_game and hotel_id = me.hotel_id and active;
  if not found then raise exception 'invalid_game' using errcode = 'CH003'; end if;
  if p_starts_at is null or p_starts_at < now() + interval '5 minutes' or p_starts_at > now() + interval '12 hours'
     or p_starts_at >= me.stay_expires_at then
    raise exception 'invalid_time' using errcode = 'CH003';
  end if;
  if (select count(*) from public.social_challenges where challenger_id = me.id and created_at >= app.hotel_day_start(me.hotel_id)) >= 5 then
    raise exception 'challenge_daily_limit' using errcode = 'CH007';
  end if;
  if (select count(*) from public.social_challenges where challenger_id = me.id and status = 'open' and starts_at > now()) >= 3 then
    raise exception 'challenge_active_limit' using errcode = 'CH007';
  end if;
  if p_thread is not null then
    v_opp := app.social_open_peer(me, p_thread);
    perform app.social_check_private_rate(me.id);
  elsif (select count(*) from public.social_challenges where challenger_id = me.id and thread_id is null and created_at > now() - interval '60 seconds') >= 5 then
    raise exception 'rate_limited' using errcode = 'CH007';
  end if;
  insert into public.social_challenges(hotel_id, game_id, game, challenger_id, opponent_id, thread_id, starts_at, stake)
  values (me.hotel_id, g.id, g.name, me.id, v_opp, p_thread, p_starts_at, p_stake) returning id into v_id;
  if p_thread is not null then update public.social_threads set last_at = now() where id = p_thread; end if;
  return v_id;
end $$;
grant execute on function public.social_challenge_create(uuid, timestamptz, text, uuid) to authenticated;

-- Sfida visibile all'ospite: privata = solo le due parti; pubblica = non bloccato con chi l'ha lanciata
create function app.social_challenge_of(me public.social_profiles, p_challenge uuid) returns public.social_challenges
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.social_challenges;
begin
  select * into c from public.social_challenges where id = p_challenge and hotel_id = me.hotel_id for update;
  if not found
     or (c.thread_id is not null and c.challenger_id <> me.id and c.opponent_id is distinct from me.id)
     or (c.thread_id is null and app.social_is_blocked(me.id, c.challenger_id)) then
    raise exception 'invalid_challenge' using errcode = 'CH003';
  end if;
  return c;
end $$;

-- Accetta (o, in privato, rifiuta). Nella chat pubblica vince il primo: la riga e' bloccata (for update).
create function public.social_challenge_respond(p_challenge uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(true);
  c public.social_challenges := app.social_challenge_of(me, p_challenge);
begin
  if app.challenge_status(c) <> 'open' then raise exception 'challenge_closed' using errcode = 'CH005'; end if;
  if c.challenger_id = me.id then raise exception 'forbidden' using errcode = 'CH004'; end if;
  if c.thread_id is not null then
    if c.opponent_id <> me.id then raise exception 'forbidden' using errcode = 'CH004'; end if;
    perform app.social_open_peer(me, c.thread_id);
    update public.social_challenges set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now() where id = c.id;
  else
    if not p_accept then raise exception 'forbidden' using errcode = 'CH004'; end if;
    if not app.social_eligible(c.challenger_id) then raise exception 'recipient_unavailable' using errcode = 'CH004'; end if;
    update public.social_challenges set status = 'accepted', opponent_id = me.id, responded_at = now() where id = c.id;
  end if;
end $$;
grant execute on function public.social_challenge_respond(uuid, boolean) to authenticated;

create function public.social_challenge_cancel(p_challenge uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(false);
  c public.social_challenges := app.social_challenge_of(me, p_challenge);
  v_st text := app.challenge_status(c);
begin
  if c.challenger_id <> me.id then raise exception 'forbidden' using errcode = 'CH004'; end if;
  if not (v_st = 'open' or (v_st = 'accepted' and c.starts_at > now())) then raise exception 'challenge_closed' using errcode = 'CH005'; end if;
  update public.social_challenges set status = 'cancelled' where id = c.id;
end $$;
grant execute on function public.social_challenge_cancel(uuid) to authenticated;

-- Sfide della chat pubblica (p_thread null) o di una conversazione dell'ospite
create function public.social_challenges(p_thread uuid default null)
returns table (id uuid, game jsonb, starts_at timestamptz, stake text, status text, thread_id uuid,
               challenger_id uuid, challenger_nickname text, opponent_id uuid, opponent_nickname text,
               mine boolean, me_opponent boolean, can_accept boolean, can_decline boolean, can_cancel boolean, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.social_profiles := app.social_profile(false);
begin
  if p_thread is not null and not exists (select 1 from public.social_threads t where t.id = p_thread
       and (t.initiator_id = me.id or t.recipient_id = me.id) and t.blocked_by is distinct from me.id) then
    raise exception 'invalid_thread' using errcode = 'CH003';
  end if;
  return query
    select c.id, c.game, c.starts_at, c.stake, app.challenge_status(c), c.thread_id,
           c.challenger_id, sc.nickname, c.opponent_id, so.nickname,
           (c.challenger_id = me.id), (c.opponent_id is not distinct from me.id),
           (app.challenge_status(c) = 'open' and c.challenger_id <> me.id and (c.thread_id is null or c.opponent_id = me.id)),
           (app.challenge_status(c) = 'open' and c.thread_id is not null and c.opponent_id = me.id),
           (c.challenger_id = me.id and (app.challenge_status(c) = 'open' or (app.challenge_status(c) = 'accepted' and c.starts_at > now()))),
           c.created_at
      from public.social_challenges c
      join public.social_profiles sc on sc.id = c.challenger_id
      left join public.social_profiles so on so.id = c.opponent_id
     where c.hotel_id = me.hotel_id
       and ((p_thread is not null and c.thread_id = p_thread)
         or (p_thread is null and c.thread_id is null and c.status <> 'cancelled' and c.starts_at > now() - interval '2 hours'
             and not app.social_is_blocked(me.id, c.challenger_id)
             and (c.opponent_id is null or not app.social_is_blocked(me.id, c.opponent_id))))
     order by c.created_at, c.id;
end $$;
grant execute on function public.social_challenges(uuid) to authenticated;

-- Blocco: come prima (0002) + annulla le sfide ancora in piedi tra le due parti
create or replace function public.social_block(p_target uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me public.social_profiles := app.social_profile(false);
begin
  if not exists (select 1 from public.social_profiles where id = p_target and hotel_id = me.hotel_id and id <> me.id) then
    raise exception 'invalid_guest' using errcode = 'CH003';
  end if;
  insert into public.social_blocks(by_id, target_id) values (me.id, p_target) on conflict do nothing;
  update public.social_threads set blocked_by = coalesce(blocked_by, me.id)
   where hotel_id = me.hotel_id and least(initiator_id, recipient_id) = least(me.id, p_target) and greatest(initiator_id, recipient_id) = greatest(me.id, p_target);
  update public.social_coupon_qrs set status = 'cancelled'
   where status = 'pending' and coupon_id in (select id from public.social_coupons
     where status = 'issued' and ((sender_id = me.id and recipient_id = p_target) or (sender_id = p_target and recipient_id = me.id)));
  update public.social_coupons set status = 'void'
   where status = 'issued' and ((sender_id = me.id and recipient_id = p_target) or (sender_id = p_target and recipient_id = me.id));
  update public.social_challenges set status = 'cancelled'
   where status in ('open', 'accepted')
     and ((challenger_id = me.id and opponent_id = p_target) or (challenger_id = p_target and opponent_id = me.id));
end $$;

-- -----------------------------------------------------------------------------
-- 4. Dati: la sala giochi diventa una lista di giochi e non si prenota piu'
-- -----------------------------------------------------------------------------
insert into public.games(hotel_id, name, description, location, sort_order)
select f.hotel_id, x.name, x.description, 'Sala giochi', x.ord
  from (select distinct hotel_id from public.facilities where kind = 'gamesroom' and active) f
 cross join (values
   ('{"it":"Ping pong","en":"Table tennis","de":"Tischtennis","ru":"Настольный теннис"}'::jsonb,
    '{"it":"Racchette e palline alla reception.","en":"Bats and balls at the front desk.","de":"Schläger und Bälle an der Rezeption.","ru":"Ракетки и мячи на ресепшене."}'::jsonb, 1),
   ('{"it":"Calcio balilla","en":"Table football","de":"Tischfußball","ru":"Настольный футбол"}'::jsonb, null::jsonb, 2)
 ) as x(name, description, ord);
update public.facilities set active = false where kind = 'gamesroom' and active;
