-- 0009: pagina "Ospiti" del pannello hotel.
--
-- Direttore e reception vedono gli ospiti con soggiorno in corso: nome di battesimo, lingua, date del soggiorno,
-- ultimo accesso, prenotazioni, eventi e bonus. MAI chat private, contatti tra ospiti, messaggi, e-mail o id Google
-- (decisione dei soci del 22/10/2026; l'informativa lo dice). Le tabelle lette erano gia' visibili allo staff via RLS (0001):
-- qui si aggiunge solo l'ultimo accesso e una lettura unica per non fare decine di richieste.
-- Da eseguire in Supabase PRIMA di pubblicare il codice che la usa.

-- -----------------------------------------------------------------------------
-- 1. Ultimo accesso dell'ospite (si cancella con l'ospite al check-out)
-- -----------------------------------------------------------------------------
alter table public.guests add column last_seen_at timestamptz;

-- Chiamata dall'app quando l'ultimo accesso e' vecchio: scrive al massimo una volta ogni 10 minuti per ospite.
create function public.touch_guest() returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.guests set last_seen_at = now()
   where id = app.my_guest_id() and (last_seen_at is null or last_seen_at < now() - interval '10 minutes')
$$;
revoke all on function public.touch_guest() from public, anon;
grant execute on function public.touch_guest() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Elenco per il pannello: una sola lettura, solo direttore e reception dell'hotel
-- -----------------------------------------------------------------------------
create function public.staff_guests(p_hotel uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if p_hotel is null or p_hotel not in (select app.staff_hotel_ids(array['hotel_admin','reception']::public.app_role[])) then
    raise exception 'forbidden' using errcode = 'CH004';
  end if;
  select coalesce(jsonb_agg(x.row order by x.name), '[]'::jsonb) into v from (
    select g.display_name as name, jsonb_build_object(
      'id', g.id, 'name', g.display_name, 'locale', g.locale,
      'started_at', s.started_at, 'expires_at', s.expires_at, 'checkout_date', s.checkout_date, 'last_seen_at', g.last_seen_at,
      'bookings', coalesce((
        select jsonb_agg(jsonb_build_object('id', b.id, 'slot_id', b.slot_id, 'facility', f.name, 'starts_at', sl.starts_at,
                                            'party', b.party_size, 'status', b.status) order by sl.starts_at)
          from public.bookings b
          join public.slots sl on sl.id = b.slot_id
          join public.facilities f on f.id = sl.facility_id
         where b.guest_id = g.id and b.status in ('confirmed', 'attended')), '[]'::jsonb),
      'events', coalesce((
        select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at) order by e.starts_at)
          from public.event_attendance a
          join public.events e on e.id = a.event_id
         where a.guest_id = g.id and a.status in ('going', 'attended')), '[]'::jsonb),
      'bonus', (
        select jsonb_build_object('status', case when wb.status = 'issued' and wb.expires_at <= now() then 'expired' else wb.status::text end,
                                  'redeemed_at', wb.redeemed_at)
          from public.welcome_bonuses wb where wb.guest_id = g.id)
    ) as row
      from public.guests g
      join public.stays s on s.guest_id = g.id and s.status = 'active' and s.expires_at > now()
     where g.hotel_id = p_hotel
  ) x;
  return v;
end $$;
revoke all on function public.staff_guests(uuid) from public, anon;
grant execute on function public.staff_guests(uuid) to authenticated;
