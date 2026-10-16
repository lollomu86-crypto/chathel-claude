// i18n minimale: file di traduzione in /messages/{it,en,de}.json, nessuna dipendenza.
// (L'architettura proponeva next-intl con segmento [locale]; qui la lingua e' nel cookie
// e nel profilo ospite perche' le rotte richieste sono /h/[slug], /bar, /admin. Vedi NOTE-SVILUPPO.)

import it from '../../../messages/it.json';
import en from '../../../messages/en.json';
import de from '../../../messages/de.json';
import ru from '../../../messages/ru.json';
import type { Locale } from '../types';

export type Messages = typeof it;
// ru: traduzione del FRONTEND, da far rivedere a un madrelingua prima del pilota (vedi docs/11).
export const messages: Record<Locale, Messages> = { it, en, de, ru };

import { interpolate, lookup, translateTree, hasKey, type Vars } from './core';
export { translateTree, hasKey };
export type { Vars };

/** Traduce `key`; ripiego: en, poi it, poi la chiave stessa (visibile in sviluppo). */
export function translate(tree: unknown, locale: Locale, key: string, vars?: Vars): string {
  const hit = lookup(tree, key) ?? lookup(messages[locale], key) ?? lookup(messages.en, key) ?? lookup(messages.it, key);
  return interpolate(hit ?? key, vars);
}

export type TFn = (key: string, vars?: Vars) => string;

export function makeT(locale: Locale): TFn {
  const tree = messages[locale];
  return (key, vars) => translate(tree, locale, key, vars);
}

export { pick, detectLocale, formatDateTime, formatTime, formatDate, formatMoney } from '../format';
