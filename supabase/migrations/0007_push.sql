-- 0007: notifiche push (Web Push). Una riga per dispositivo dell'ospite.
-- Dato personale: si cancella a cascata con l'ospite (checkout / "cancella i miei dati").
-- Accesso SOLO dal server con la chiave di servizio: RLS attiva e nessuna policy.
create table if not exists public.push_subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  hotel_id             uuid not null references public.hotels(id) on delete cascade,
  guest_id             uuid not null,
  endpoint             text not null check (length(endpoint) <= 1000 and endpoint ~ '^https://'),
  p256dh               text not null check (length(p256dh) <= 200),
  auth                 text not null check (length(auth) <= 100),
  locale               text not null default 'it' check (locale in ('it','en','de','ru')),
  prefs                jsonb not null default '{"announcements":true,"reception":true,"private":true,"public":false}'::jsonb,
  last_public_push_at  timestamptz,
  created_at           timestamptz not null default now(),
  unique (endpoint),
  foreign key (guest_id, hotel_id) references public.guests(id, hotel_id) on delete cascade
);
create index if not exists push_subscriptions_guest_idx on public.push_subscriptions(guest_id);
create index if not exists push_subscriptions_hotel_idx on public.push_subscriptions(hotel_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant all on public.push_subscriptions to service_role;
