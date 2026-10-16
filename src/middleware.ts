// Rinnovo dei token di sessione Supabase (ospite e staff) PRIMA che le pagine vengano renderizzate.
// I server component non possono scrivere cookie e i refresh token Supabase sono a uso singolo:
// il rinnovo va fatto qui, una volta per richiesta, e riscritto nel cookie. In modalita' DEMO non fa nulla.
// NON VERIFICATO contro un vero Supabase (vedi NOTE-SVILUPPO).
import { NextResponse, type NextRequest } from 'next/server';
import { decodeSession, encodeSession, GUEST_COOKIE, IDENT_COOKIE, jwtExp, STAFF_COOKIE } from '@/lib/session-format';

export const config = { matcher: ['/stay/:path*', '/admin/:path*', '/bar/:path*', '/api/:path*'] };

export async function middleware(req: NextRequest) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.next(); // demo

  const renewed: Record<string, string> = {};
  // Il cookie di identita' e quello del soggiorno ospite contengono la stessa coppia di token (Supabase): il refresh token
  // e' a uso singolo, quindi si rinnova UNA volta per refresh token e il risultato vale per entrambi i cookie.
  const done = new Map<string, string>();
  const now = Math.floor(Date.now() / 1000);
  for (const name of [GUEST_COOKIE, IDENT_COOKIE, STAFF_COOKIE]) {
    const tok = decodeSession(req.cookies.get(name)?.value);
    if (!tok) continue;
    const exp = jwtExp(tok.a);
    if (exp === null || exp - now > 60) continue;
    const already = done.get(tok.r);
    if (already) {
      renewed[name] = already;
      continue;
    }
    try {
      const r = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: anon, 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: tok.r }),
      });
      if (!r.ok) continue;
      const j = (await r.json()) as { access_token?: string; refresh_token?: string };
      if (j.access_token && j.refresh_token) {
        renewed[name] = encodeSession({ a: j.access_token, r: j.refresh_token });
        done.set(tok.r, renewed[name]);
      }
    } catch {
      /* rete: si prosegue col token vecchio, la richiesta fallira' in modo pulito */
    }
  }
  if (!Object.keys(renewed).length) return NextResponse.next();

  // i nuovi cookie valgono sia per la richiesta in corso (server component) sia per il browser
  const headers = new Headers(req.headers);
  const jar = req.cookies.getAll().map((c) => (renewed[c.name] ? `${c.name}=${encodeURIComponent(renewed[c.name])}` : `${c.name}=${encodeURIComponent(c.value)}`));
  headers.set('cookie', jar.join('; '));
  const res = NextResponse.next({ request: { headers } });
  const secure = true;
  for (const [name, value] of Object.entries(renewed)) {
    res.cookies.set(name, value, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: name === GUEST_COOKIE || name === IDENT_COOKIE ? 61 * 86400 : 14 * 86400 });
  }
  return res;
}
