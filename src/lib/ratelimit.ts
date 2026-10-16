// Limiti di frequenza.
//  - `allow` / `bumpDaily`: finestra scorrevole in memoria (una sola istanza: demo, sviluppo, e difesa a livello di processo).
//  - `hit`: interfaccia ASINCRONA con backend sostituibile. In modalita' Supabase il backend e' il database
//    (tabella rate_limits + funzione rate_limit_hit, migrazione 0004): contatore condiviso tra istanze.
//    NON verificato contro Supabase reale; la funzione SQL e' provata su Postgres 16.
//  - `withLock`: sezione critica per chiave nel processo (evita che due richieste dello stesso ospite
//    interleavino tra controllo e scrittura quando nel mezzo c'e' un await).
// Le chiavi non contengono dati personali (si usa un hash).

import { createHash } from 'node:crypto';

const buckets = new Map<string, number[]>();

/** true se la richiesta e' consentita. */
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const list = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    buckets.set(key, list);
    return false;
  }
  list.push(now);
  buckets.set(key, list);
  if (buckets.size > 10_000) {
    // pulizia: toglie le chiavi senza richieste recenti; se restano troppe (chiavi tutte attive) elimina le piu' vecchie
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
    if (buckets.size > 20_000) {
      let n = buckets.size - 10_000;
      for (const k of buckets.keys()) {
        if (n-- <= 0) break;
        buckets.delete(k);
      }
    }
  }
  return true;
}

export function ipKey(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}
/** Hash corto per chiavi di limite derivate da testo del client (slug, codice QR, identita'): mai il testo in chiaro. */
export function hashKey(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 20);
}

/** Contatore giornaliero (UTC) senza finestra scorrevole, per il tetto di risposte AI per hotel. */
const daily = new Map<string, { day: string; n: number }>();
export function bumpDaily(key: string, cap: number, now = new Date()): boolean {
  const day = now.toISOString().slice(0, 10);
  const cur = daily.get(key);
  if (!cur || cur.day !== day) {
    daily.set(key, { day, n: 1 });
    return cap >= 1;
  }
  if (cur.n >= cap) return false;
  cur.n += 1;
  return true;
}

// ---------------------------------------------------------------- backend asincrono
export interface RateBackend {
  /** true = consentito. Deve essere atomico. */
  hit(key: string, limit: number, windowMs: number): Promise<boolean>;
}
const memoryBackend: RateBackend = { hit: async (key, limit, windowMs) => allow(key, limit, windowMs) };
let backend: RateBackend = memoryBackend;
export function setRateBackend(b: RateBackend | null) {
  backend = b ?? memoryBackend;
}
export async function hit(key: string, limit: number, windowMs: number): Promise<boolean> {
  return backend.hit(key, limit, windowMs);
}

// ---------------------------------------------------------------- sezioni critiche per chiave
const tails = new Map<string, Promise<unknown>>();
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const mine = prev.then(() => gate);
  tails.set(key, mine);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === mine) tails.delete(key);
  }
}

export function _resetForTests() {
  buckets.clear();
  daily.clear();
  tails.clear();
  backend = memoryBackend;
}
