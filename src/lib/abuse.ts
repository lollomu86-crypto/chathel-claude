// Anti-abuso dell'INGRESSO da QR. Il QR dell'hotel e' pubblico (stampato, fotografabile): il limite per IP non basta
// (l'IP si falsifica o si cambia, e dietro il Wi-Fi dell'hotel molti ospiti condividono lo stesso IP).
// Livelli, nell'ordine (ci si ferma al primo superato; i tentativi falliti contano):
//   1. identita' Google dell'ospite (limite principale: un account = pochi tentativi);
//   2. codice QR (hash di slug + codice);
//   3. hotel (slug);
//   4. globale;
//   5. IP, solo se la piattaforma fornisce un'intestazione fidata (TRUSTED_IP_HEADER); altrimenti non si usa.
// In piu', nel dominio: un solo bonus per identita' e stagione, tetto di bonus emessi nell'ora per hotel, tetto stagionale.
//
// Il contatore e' quello di ratelimit.ts: in memoria per default, condiviso (Postgres) in modalita' Supabase.

import { ENTRY_LIMITS } from './limits';
import { hashKey, hit } from './ratelimit';

export type EntryScope = 'identity' | 'code' | 'hotel' | 'global' | 'ip';

export interface EntryAttempt {
  /** chiave dell'identita' (identityKey): mai il subject in chiaro */
  identityKey: string;
  slug: string;
  code: string;
  /** IP fidato oppure null se non disponibile */
  ip: string | null;
}

/**
 * null = ammesso; altrimenti il primo livello che ha superato il limite. Ci si ferma al primo: un account bloccato
 * non consuma i contatori di hotel e globali (altrimenti un solo account che insiste esaurirebbe l'ingresso di tutti).
 */
export async function checkEntryLimits(a: EntryAttempt): Promise<EntryScope | null> {
  const L = ENTRY_LIMITS;
  const checks: [EntryScope, string, { limit: number; windowMs: number }][] = [
    ['identity', `ob:id:${hashKey(a.identityKey)}`, L.perIdentity],
    ['code', `ob:code:${hashKey(`${a.slug}|${a.code}`)}`, L.perCode],
    ['hotel', `ob:hotel:${hashKey(a.slug)}`, L.perHotel],
    ['global', 'ob:global', L.global],
  ];
  if (a.ip) checks.push(['ip', `ob:ip:${hashKey(a.ip)}`, L.perIp]);
  for (const [scope, key, lim] of checks) {
    if (!(await hit(key, lim.limit, lim.windowMs))) return scope;
  }
  return null;
}

/** QR errato: conteggio per hotel (ricerca del codice). true = ancora ammesso. */
export async function noteBadCode(slug: string): Promise<boolean> {
  return hit(`ob:bad:${hashKey(slug)}`, ENTRY_LIMITS.badCodePerHotel.limit, ENTRY_LIMITS.badCodePerHotel.windowMs);
}
