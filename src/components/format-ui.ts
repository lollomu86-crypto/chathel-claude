// Formati di sola presentazione per i componenti (nessun testo: le parole stanno in messages/*.json).
import { formatDateTime, formatTime } from '@/lib/format';
import type { Locale } from '@/lib/types';

/** Giorno della settimana abbreviato e numero del giorno, nel fuso dell'hotel e nella lingua dell'app (per .date-chip). */
export function dateChip(iso: string, locale: Locale, tz: string): { weekday: string; day: string } {
  const d = new Date(iso);
  return {
    weekday: new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short' }).format(d).replace('.', ''),
    day: new Intl.DateTimeFormat(locale, { timeZone: tz, day: 'numeric' }).format(d),
  };
}

/** "mar 14:05" o, se e' un altro giorno, "mar 12 ott 14:05"; sempre nella lingua dell'app (mai in quella del telefono). */
export function chatTime(iso: string, locale: Locale, tz: string): string {
  return formatTime(iso, locale, tz);
}

/** Etichetta del giorno per i separatori delle chat: "oggi/ieri" li decide il chiamante con le sue parole; qui la data lunga. */
export function dayLabel(iso: string, locale: Locale, tz: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
}

/** Chiave AAAA-MM-GG del giorno nel fuso dell'hotel (per raggruppare i messaggi). */
export function dayKeyOf(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export const when = (iso: string, locale: Locale, tz: string) => formatDateTime(iso, locale, tz);
