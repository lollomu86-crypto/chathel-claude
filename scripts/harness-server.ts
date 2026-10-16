// Harness HTTP SENZA Next.js: espone gli stessi route handler di src/app/api su un server Node puro.
// Serve a provare con curl le API in modalita' demo anche dove `next` non e' installabile.
// NON e' il server dell'app e non serve le pagine. Uso: npm run harness  (porta 3100, o PORT)

import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import * as onboarding from '../src/app/api/onboarding/route';
import * as aiChat from '../src/app/api/ai/chat/route';
import * as guest from '../src/app/api/guest/[action]/route';
import * as staff from '../src/app/api/staff/[action]/route';
import * as identity from '../src/app/api/identity/[action]/route';
import * as health from '../src/app/api/health/route';

type H = (req: Request, ctx: { params: Promise<{ action: string }> }) => Promise<Response>;
function route(path: string): { handlers: Record<string, H>; action: string } | null {
  if (path === '/api/onboarding') return { handlers: onboarding as unknown as Record<string, H>, action: '' };
  if (path === '/api/ai/chat') return { handlers: aiChat as unknown as Record<string, H>, action: '' };
  if (path === '/api/health') return { handlers: health as unknown as Record<string, H>, action: '' };
  let m = /^\/api\/guest\/([a-z-]+)$/.exec(path);
  if (m) return { handlers: guest as unknown as Record<string, H>, action: m[1] };
  m = /^\/api\/identity\/([a-z-]+)$/.exec(path);
  if (m) return { handlers: identity as unknown as Record<string, H>, action: m[1] };
  m = /^\/api\/staff\/([a-z-]+)$/.exec(path);
  if (m) return { handlers: staff as unknown as Record<string, H>, action: m[1] };
  return null;
}

process.env.CHATHEL_DEMO ??= '1';
const port = Number(process.env.PORT || 3100);
createServer(async (nreq, nres) => {
  try {
    const url = new URL(nreq.url ?? '/', `http://localhost:${port}`);
    const r = route(url.pathname);
    if (!r) { nres.writeHead(404, { 'content-type': 'application/json' }); nres.end('{"ok":false,"error":"not_found"}'); return; }
    const method = nreq.method ?? 'GET';
    const body = method === 'GET' || method === 'HEAD' ? undefined : (Readable.toWeb(nreq) as unknown as ReadableStream);
    const req = new Request(url, { method, headers: nreq.headers as Record<string, string>, body, duplex: 'half' } as RequestInit);
    const fn = r.handlers[method];
    const res = fn ? await fn(req, { params: Promise.resolve({ action: r.action }) }) : Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
    const headers: Record<string, string | string[]> = {};
    res.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
    const cookies = res.headers.getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies;
    nres.writeHead(res.status, headers);
    nres.end(Buffer.from(await res.arrayBuffer()));
  } catch {
    nres.writeHead(500, { 'content-type': 'application/json' });
    nres.end('{"ok":false,"error":"internal"}');
  }
}).listen(port, () => console.log(`harness API in ascolto su http://localhost:${port} (demo=${!process.env.NEXT_PUBLIC_SUPABASE_URL})`));
