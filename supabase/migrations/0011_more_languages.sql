-- 0011: otto lingue in piu' per l'app degli ospiti: francese, spagnolo, olandese, polacco, svedese, portoghese, ceco, cinese
-- (in tutto 12: it, en, de, ru, fr, es, nl, pl, sv, pt, cs, zh). Solo i controlli sui valori: nessun dato cambia.
-- start_stay non si ridefinisce: con una lingua che non conosce mette la lingua dell'hotel, e subito dopo l'app salva
-- quella scelta dall'ospite (guests.locale, scrivibile dall'ospite).
-- Da eseguire in Supabase PRIMA di pubblicare il codice che la usa.

alter table public.guests             drop constraint guests_locale_check,
  add constraint guests_locale_check             check (locale in ('it','en','de','ru','fr','es','nl','pl','sv','pt','cs','zh'));
alter table public.hotels             drop constraint hotels_default_locale_check,
  add constraint hotels_default_locale_check     check (default_locale in ('it','en','de','ru','fr','es','nl','pl','sv','pt','cs','zh'));
alter table public.ai_knowledge       drop constraint ai_knowledge_locale_check,
  add constraint ai_knowledge_locale_check       check (locale in ('it','en','de','ru','fr','es','nl','pl','sv','pt','cs','zh'));
alter table public.ai_conversations   drop constraint ai_conversations_locale_check,
  add constraint ai_conversations_locale_check   check (locale in ('it','en','de','ru','fr','es','nl','pl','sv','pt','cs','zh'));
alter table public.push_subscriptions drop constraint push_subscriptions_locale_check,
  add constraint push_subscriptions_locale_check check (locale in ('it','en','de','ru','fr','es','nl','pl','sv','pt','cs','zh'));

-- messaggio di benvenuto dell'hotel (0010): anche nelle lingue nuove
create or replace function app.valid_welcome(j jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(j) = 'object' and not exists (
    select 1 from jsonb_each(j) e
     where e.key not in ('it','en','de','ru','fr','es','nl','pl','sv','pt','cs','zh')
        or jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') > 500)
$$;
