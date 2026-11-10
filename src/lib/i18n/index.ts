// i18n minimale: file di traduzione in /messages/<lingua>.json (12 lingue), nessuna dipendenza.
// (L'architettura proponeva next-intl con segmento [locale]; qui la lingua e' nel cookie
// e nel profilo ospite perche' le rotte richieste sono /h/[slug], /bar, /admin. Vedi NOTE-SVILUPPO.)

import it from '../../../messages/it.json';
import en from '../../../messages/en.json';
import de from '../../../messages/de.json';
import ru from '../../../messages/ru.json';
import fr from '../../../messages/fr.json';
import es from '../../../messages/es.json';
import nl from '../../../messages/nl.json';
import pl from '../../../messages/pl.json';
import sv from '../../../messages/sv.json';
import pt from '../../../messages/pt.json';
import cs from '../../../messages/cs.json';
import zh from '../../../messages/zh.json';
import type { Locale } from '../types';

export type Messages = typeof it;
// ru: traduzione del FRONTEND, da far rivedere a un madrelingua prima del pilota (vedi docs/11).
// fr, es, nl, pl, sv, pt, cs, zh (0011): traduzioni da far rivedere a un madrelingua prima del lancio.
// Le 8 lingue nuove non traducono le sezioni del personale (admin, staff, bar): ripiegano sull'inglese in translate().
const guestOnly = (m: unknown) => m as Messages;
export const messages: Record<Locale, Messages> = {
  it, en, de, ru,
  fr: guestOnly(fr), es: guestOnly(es), nl: guestOnly(nl), pl: guestOnly(pl), sv: guestOnly(sv), pt: guestOnly(pt), cs: guestOnly(cs), zh: guestOnly(zh),
};

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
