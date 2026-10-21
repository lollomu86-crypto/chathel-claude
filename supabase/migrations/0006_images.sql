-- 0006: immagine facoltativa per eventi e servizi prenotabili.
-- Solo un percorso interno ("/demo/x.svg") o un indirizzo https: mai altri schemi (niente javascript:, data:, http:).
alter table public.events     add column image_url text
  check (image_url is null or (length(image_url) <= 500 and image_url ~ '^(/[^/]|https://)'));
alter table public.facilities add column image_url text
  check (image_url is null or (length(image_url) <= 500 and image_url ~ '^(/[^/]|https://)'));
