// Adattatore tra Web Request/Response e gli handler. Usato dai route file di Next.js e dall'harness.
// Solo API standard (nessun import da 'next').

import { getIdentityProvider } from '../auth';
import { ConfigError, isDemoMode, readEnv } from '../env';
import { getStore } from '../store';
import { GUEST_COOKIE, HOTEL_COOKIE, IDENT_COOKIE, STAFF_COOKIE } from '../session-format';
import type { Ctx, Res } from './handlers';

export const MAX_BODY_BYTES = 64 * 1024;

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const raw = part.slice(i + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      continue; // cookie con codifica non valida: ignorato (nessun 500 per un cookie malformato)
    }
    out[part.slice(0, i).trim()] = value;
  }
  return out;
}

function cookieHeader(name: string, value: string | null, maxAgeSec: number): string {
  // HttpOnly: il browser non legge mai la sessione. Secure sempre, tranne in demo (gira anche su http locale).
  const base = `${name}=${value === null ? '' : encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value === null ? 0 : maxAgeSec}`;
  return isDemoMode() ? base : `${base}; Secure`;
}

const GUEST_MAX_AGE = 61 * 86_400; // limite assoluto del soggiorno (schema.sql); la scadenza vera e' lato database
const IDENT_MAX_AGE = 61 * 86_400;
const STAFF_MAX_AGE = 14 * 86_400;
const HOTEL_MAX_AGE = 14 * 86_400;

/**
 * IP del client SOLO da un'intestazione che la piattaforma garantisce (variabile TRUSTED_IP_HEADER, es. cf-connecting-ip
 * dietro Cloudflare, x-vercel-forwarded-for su Vercel). X-Forwarded-For NON si usa: il client puo' scriverci quello che vuole.
 * Senza intestazione fidata il risultato e' 'unknown' e i limiti per IP vengono saltati (restano identita', codice, hotel, globale).
 * Solo in demo, per comodita' di prova in locale, si accetta x-forwarded-for.
 */
export function clientIp(req: Request): string {
  const trusted = readEnv('TRUSTED_IP_HEADER');
  if (trusted) {
    const v = req.headers.get(trusted)?.split(',')[0]?.trim();
    return v || 'unknown';
  }
  if (isDemoMode()) {
    const xf = req.headers.get('x-forwarded-for');
    return (xf ? xf.split(',')[0].trim() : req.headers.get('x-real-ip')) || 'unknown';
  }
  return 'unknown';
}

export async function runApi(req: Request, fn: (ctx: Ctx, input: unknown) => Promise<Res>): Promise<Response> {
  const method = req.method === 'GET' ? 'GET' : req.method === 'POST' ? 'POST' : null;
  const noStore = { 'Cache-Control': 'no-store' };
  if (!method) return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405, headers: noStore });

  let input: unknown;
  if (method === 'POST') {
    // solo JSON: difesa aggiuntiva contro POST cross-site da form (oltre a SameSite=Lax)
    if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return Response.json({ ok: false, error: 'unsupported_media_type' }, { status: 415, headers: noStore });
    }
    const declared = Number(req.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) return Response.json({ ok: false, error: 'payload_too_large' }, { status: 413, headers: noStore });
    try {
      const text = await req.text();
      if (text.length > MAX_BODY_BYTES) return Response.json({ ok: false, error: 'payload_too_large' }, { status: 413, headers: noStore });
      input = JSON.parse(text);
    } catch {
      return Response.json({ ok: false, error: 'invalid_input' }, { status: 400, headers: noStore });
    }
  } else {
    input = Object.fromEntries(new URL(req.url).searchParams);
  }

  return respond(req, method, (ctx) => fn(ctx, input));
}

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Caricamento di un'immagine (solo POST): il corpo e' il file, con Content-Type immagine. Un form di un altro sito non puo'
 * inviare questi tipi senza il controllo CORS del browser, quindi la difesa di "solo JSON" resta valida.
 */
export async function runUpload(req: Request, fn: (ctx: Ctx, bytes: Uint8Array, contentType: string) => Promise<Res>): Promise<Response> {
  const noStore = { 'Cache-Control': 'no-store' };
  if (req.method !== 'POST') return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405, headers: noStore });
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!UPLOAD_TYPES.includes(type)) return Response.json({ ok: false, error: 'unsupported_media_type' }, { status: 415, headers: noStore });
  if (Number(req.headers.get('content-length') ?? '0') > MAX_UPLOAD_BYTES) {
    return Response.json({ ok: false, error: 'image_too_large' }, { status: 413, headers: noStore });
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > MAX_UPLOAD_BYTES) return Response.json({ ok: false, error: 'image_too_large' }, { status: 413, headers: noStore });
  return respond(req, 'POST', (ctx) => fn(ctx, bytes, type));
}

async function respond(req: Request, method: 'GET' | 'POST', fn: (ctx: Ctx) => Promise<Res>): Promise<Response> {
  const noStore = { 'Cache-Control': 'no-store' };
  const cookies = parseCookies(req.headers.get('cookie'));
  let res: Res;
  try {
    const store = await getStore();
    const identityProvider = await getIdentityProvider();
    res = await fn({
      store, identityProvider, guest: cookies[GUEST_COOKIE], staff: cookies[STAFF_COOKIE], identityCookie: cookies[IDENT_COOKIE],
      hotel: cookies[HOTEL_COOKIE], ip: clientIp(req), method,
    });
  } catch (e) {
    if (e instanceof ConfigError) return Response.json({ ok: false, error: 'service_unavailable' }, { status: 503, headers: noStore });
    throw e;
  }

  const headers = new Headers(noStore);
  if (res.guestCookie !== undefined) headers.append('Set-Cookie', cookieHeader(GUEST_COOKIE, res.guestCookie, GUEST_MAX_AGE));
  if (res.staffCookie !== undefined) headers.append('Set-Cookie', cookieHeader(STAFF_COOKIE, res.staffCookie, STAFF_MAX_AGE));
  if (res.identityCookie !== undefined) headers.append('Set-Cookie', cookieHeader(IDENT_COOKIE, res.identityCookie, IDENT_MAX_AGE));
  if (res.hotelCookie !== undefined) headers.append('Set-Cookie', cookieHeader(HOTEL_COOKIE, res.hotelCookie, HOTEL_MAX_AGE));
  if (res.csv) {
    headers.set('Content-Type', 'text/csv; charset=utf-8');
    headers.set('Content-Disposition', `attachment; filename="${res.csv.filename}"`);
    return new Response(res.csv.content, { status: res.status, headers });
  }
  return Response.json(res.body ?? {}, { status: res.status, headers });
}
