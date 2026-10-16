// Funzioni di formato e scelta lingua dei contenuti. Nessuna dipendenza dai file di traduzione:
// usabili anche nei componenti client senza portarsi dietro le tre lingue.

import { DEFAULT_LOCALE, isLocale, type I18nText, type Locale } from './types';

/**
 * Testo di contenuto (eventi, servizi, avvisi) nella lingua dell'ospite.
 * Ripiego documentato: lingua dell'ospite -> lingua predefinita dell'hotel -> italiano -> qualunque.
 */
export function pick(text: I18nText | null | undefined, locale: Locale, hotelDefault: Locale = DEFAULT_LOCALE): string {
  if (!text) return '';
  return text[locale] || text[hotelDefault] || text.it || text.en || text.de || '';
}

/** Dalla intestazione Accept-Language: prima lingua supportata, altrimenti ripiego en (QR-04). */
export function detectLocale(acceptLanguage: string | null | undefined, fallback: Locale = 'en'): Locale {
  if (!acceptLanguage) return fallback;
  const parts = acceptLanguage
    .split(',')
    .map((p) => {
      const [tag, q] = p.trim().split(';q=');
      return { lang: tag.slice(0, 2).toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const p of parts) if (isLocale(p.lang)) return p.lang;
  return fallback;
}

export function formatDateTime(iso: string, locale: Locale, tz: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    ...opts,
  }).format(new Date(iso));
}

export function formatTime(iso: string, locale: Locale, tz: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function formatDate(iso: string, locale: Locale, tz: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(iso),
  );
}

export function formatMoney(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);
}
