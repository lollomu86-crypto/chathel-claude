// Validazione dell'OUTPUT del modello. Il prompt dice "usa solo la base di conoscenza", ma un prompt non e' una garanzia:
// se la risposta contiene un link, un numero di telefono, un prezzo o un orario che NON compaiono nella base di conoscenza
// (o negli eventi) dell'hotel, non viene mostrata. L'ospite riceve "non lo so, ti passo la reception" e la conversazione
// passa all'operatore. Controllo deterministico, senza modello.
//
// Limiti: non verifica i fatti (un orario presente nella KB ma riferito alla cosa sbagliata passa); controlla solo
// link, telefoni, importi e orari con minuti. Numeri interi isolati ("dalle 9") non sono controllati.

import type { AiContext } from '../types';
import { SYSTEM_RULES } from './prompt';

export type Violation = 'url' | 'phone' | 'price' | 'time' | 'leak';

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s)]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|it|de|org|net|eu|ru|info|app|io|me)\b(?:\/[^\s)]*)?/gi;
const PHONE_RE = /(?:\+|00)?\d(?:[\s().-]?\d){5,}/g;
const PRICE_RE = /(?:€|eur|euro|usd|\$|£)\s?(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s?(?:€|eur\b|euro\b|usd\b|\$|£)/gi;
const TIME_RE = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b(?!\s?(?:€|eur|euro))/g;

const urlKey = (u: string) => u.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/.,;]+$/, '');
const digits = (s: string) => s.replace(/\D/g, '');
const priceKey = (n: string) => String(Number(n.replace(',', '.')));
const timeKey = (h: string, m: string) => `${Number(h)}:${m}`;

interface Facts {
  urls: Set<string>;
  phones: Set<string>;
  prices: Set<string>;
  times: Set<string>;
}

function extract(text: string, into: Facts) {
  for (const m of text.matchAll(URL_RE)) into.urls.add(urlKey(m[0]));
  const noUrls = text.replace(URL_RE, ' ');
  for (const m of noUrls.matchAll(PRICE_RE)) into.prices.add(priceKey(m[1] ?? m[2]));
  const noPrices = noUrls.replace(PRICE_RE, ' ');
  // gli orari prima dei telefoni: "19:30" non e' un numero di telefono
  for (const m of noPrices.matchAll(TIME_RE)) into.times.add(timeKey(m[1], m[2]));
  const noTimes = noPrices.replace(TIME_RE, ' ');
  for (const m of noTimes.matchAll(PHONE_RE)) {
    const d = digits(m[0]);
    if (d.length >= 6) into.phones.add(d);
  }
}

function emptyFacts(): Facts {
  return { urls: new Set(), phones: new Set(), prices: new Set(), times: new Set() };
}

/** Fatti ammessi = tutto cio' che l'hotel ha scritto nella base di conoscenza + gli eventi in programma. */
export function allowedFacts(ctx: AiContext): Facts {
  const f = emptyFacts();
  for (const k of ctx.knowledge) extract(`${k.title}\n${k.content}`, f);
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ctx.timezone });
  for (const e of ctx.events) {
    extract(`${e.title}\n${e.location ?? ''}`, f);
    const parts = fmt.formatToParts(new Date(e.startsAt));
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    f.times.add(timeKey(h, m));
  }
  return f;
}

export interface OutputCheck {
  ok: boolean;
  violations: Violation[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Frasi delle regole di sistema (almeno 8 parole): se compaiono nella risposta il prompt e' stato rivelato. */
const RULE_FRAGMENTS = SYSTEM_RULES.split(/[.\n]/).map(norm).filter((f) => f.split(' ').length >= 8);
function leaksPrompt(text: string): boolean {
  const n = norm(text);
  return RULE_FRAGMENTS.some((f) => n.includes(f));
}

export function validateModelOutput(text: string, ctx: AiContext): OutputCheck {
  const allowed = allowedFacts(ctx);
  const found = emptyFacts();
  extract(text, found);
  const violations: Violation[] = [];
  const phoneOk = (d: string) => [...allowed.phones].some((a) => a === d || a.endsWith(d) || d.endsWith(a));
  if ([...found.urls].some((u) => !allowed.urls.has(u))) violations.push('url');
  if ([...found.phones].some((p) => !phoneOk(p))) violations.push('phone');
  if ([...found.prices].some((p) => !allowed.prices.has(p))) violations.push('price');
  if ([...found.times].some((t) => !allowed.times.has(t))) violations.push('time');
  if (leaksPrompt(text)) violations.push('leak');
  return { ok: violations.length === 0, violations };
}

/** Per il confronto in test e log: nessun testo, solo i tipi di violazione. */
export function describe(v: OutputCheck): string {
  return v.ok ? 'ok' : v.violations.join(',');
}
