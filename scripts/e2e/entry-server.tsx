// Server del harness e2e: NON e' Next. Risolve i server component con un mini-RSC (async/await sull'albero React),
// serializza il risultato per il runtime del browser e serve le API reali (src/app/api) nello stesso processo.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { Fragment, Suspense, createElement, isValidElement, type ReactNode } from 'react';
import { routes, rootLayout, notFound } from 'virtual:routes';
import { als } from './shims/headers';
import { RedirectError } from './shims/navigation';
import * as onboarding from '@/app/api/onboarding/route';
import * as hotelCode from '@/app/api/hotel-code/route';
import * as aiChat from '@/app/api/ai/chat/route';
import * as guest from '@/app/api/guest/[action]/route';
import * as staff from '@/app/api/staff/[action]/route';
import * as identity from '@/app/api/identity/[action]/route';
import * as health from '@/app/api/health/route';

type H = (req: Request, ctx: { params: Promise<{ action: string }> }) => Promise<Response>;
type Mod = { default?: (p: never) => unknown; generateMetadata?: (p: never) => Promise<{ title?: unknown }>; metadata?: { title?: unknown } };
interface Route { segs: string[]; page: Mod; layouts: Mod[]; error: Mod | null; loading: Mod | null }
const ROOT = process.cwd();

function api(path: string): { handlers: Record<string, H>; action: string } | null {
  if (path === '/api/onboarding') return { handlers: onboarding as unknown as Record<string, H>, action: '' };
  if (path === '/api/hotel-code') return { handlers: hotelCode as unknown as Record<string, H>, action: '' };
  if (path === '/api/ai/chat') return { handlers: aiChat as unknown as Record<string, H>, action: '' };
  if (path === '/api/health') return { handlers: health as unknown as Record<string, H>, action: '' };
  const m = /^\/api\/(guest|identity|staff)\/([a-z-]+)$/.exec(path);
  if (!m) return null;
  const handlers = (m[1] === 'guest' ? guest : m[1] === 'staff' ? staff : identity) as unknown as Record<string, H>;
  return { handlers, action: m[2] };
}

// ---- mini-RSC -------------------------------------------------------------------------------------------------
type F = null | string | number | F[] | Record<string, unknown>;
const bad = (what: string, where: string): never => { throw new Error(`${what} (non ammesso fra server e client component: ${where})`); };
async function val(v: unknown, where: string): Promise<unknown> {
  if (typeof v === 'function') return bad('Funzione passata come prop a un Client Component', where);
  if (typeof v === 'symbol') return bad('Symbol come prop', where);
  if (isValidElement(v)) return { $el: await node(v) };
  if (Array.isArray(v)) return Promise.all(v.map((x) => val(x, where)));
  if (v instanceof Date) return { $date: v.toISOString() };
  if (v && typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return bad(`Oggetto di classe ${proto?.constructor?.name} come prop`, where);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = await val(x, where);
    return out;
  }
  return v;
}
async function props(p: Record<string, unknown>, where: string) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (k !== 'children' && v !== undefined) out[k] = await val(v, `${where}.${k}`);
  return out;
}
async function node(n: unknown): Promise<F> {
  if (n === null || n === undefined || typeof n === 'boolean') return null;
  if (typeof n === 'string' || typeof n === 'number') return n;
  if (Array.isArray(n)) return Promise.all(n.map(node));
  if (isValidElement(n)) {
    const e = n as unknown as { type: unknown; props: Record<string, unknown>; key: string | null };
    const t = e.type as { $$ref?: string; name?: string } & ((p: unknown) => unknown);
    if (typeof t === 'string') return { t, k: e.key, p: await props(e.props, t), c: await node(e.props.children) };
    if (t === Fragment || t === Suspense) return { f: await node(e.props.children) };
    if (typeof t === 'function' && t.$$ref) return { r: t.$$ref, k: e.key, p: await props(e.props, t.$$ref), c: await node(e.props.children) };
    if (typeof t === 'function') {
      const out = await node(await t(e.props));
      if (e.key === null) return out;
      // la chiave dell'elemento server si trasferisce al suo risultato (come fa RSC)
      return out && typeof out === 'object' && !Array.isArray(out) && !('f' in out) ? { ...out, k: e.key } : { f: out, k: e.key };
    }
    throw new Error(`Tipo di elemento non gestito: ${String(e.type)}`);
  }
  throw new Error(`Valore non renderizzabile: ${typeof n}`);
}

// ---- routing --------------------------------------------------------------------------------------------------
function match(path: string): { route: Route; params: Record<string, string> } | null {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  for (const r of routes as unknown as Route[]) {
    if (r.segs.length !== parts.length) continue;
    const params: Record<string, string> = {}; let ok = true;
    r.segs.forEach((s, i) => { const m = /^\[(.+)\]$/.exec(s); if (m) params[m[1]] = parts[i]; else if (s !== parts[i]) ok = false; });
    if (ok) return { route: r, params };
  }
  return null;
}
async function titleOf(mods: Mod[], p: Record<string, string>, sp: Record<string, string>): Promise<string> {
  let tpl: string | null = null; let cur = '';
  for (const m of mods) {
    let t: unknown;
    try { t = m.generateMetadata ? (await m.generateMetadata({ params: Promise.resolve(p), searchParams: Promise.resolve(sp) } as never)).title : m.metadata?.title; } catch { continue; }
    if (typeof t === 'string') cur = tpl ? tpl.replace('%s', t) : t;
    else if (t && typeof t === 'object') { const o = t as { default?: string; template?: string; absolute?: string }; if (o.template) tpl = o.template; if (o.absolute) cur = o.absolute; else if (o.default && !cur) cur = o.default; }
  }
  return cur;
}
interface Doc { tree: F; title: string; url: string; status: number; html: Record<string, string | undefined>; redirect?: string }

async function renderPage(urlStr: string): Promise<Doc> {
  const url = new URL(urlStr, 'http://x');
  const sp = Object.fromEntries(url.searchParams);
  const special = sp.__e2e; delete sp.__e2e;
  const m = match(url.pathname);
  const layouts: Mod[] = m ? m.route.layouts : [rootLayout as Mod];
  const params = m ? m.params : {};
  const wrap = (inner: unknown, ls: Mod[]) => ls.reduceRight((acc, L) => createElement(L.default as never, { params: Promise.resolve(params), children: acc } as never), inner as ReactNode);
  const finish = async (inner: unknown, ls: Mod[], status: number): Promise<Doc> => {
    const top = (await node(wrap(inner, ls))) as { t?: string; p?: Record<string, unknown>; c?: F };
    // il layout radice produce <html><body>…</body></html>: il harness tiene html come attributi e il body come albero
    const html = top.t === 'html' ? top : null;
    const bodyEl = html ? (html.c as { t?: string; c?: F }) : null;
    const tree = bodyEl && bodyEl.t === 'body' ? bodyEl.c : (top as unknown as F);
    const p = (html?.p ?? {}) as Record<string, unknown>;
    return { tree, status, url: url.pathname + url.search, title: await titleOf([rootLayout as Mod, ...(m ? [m.route.page] : [])], params, sp),
      html: { lang: p.lang as string | undefined, theme: p['data-theme'] as string | undefined, cls: p.className as string | undefined } };
  };
  if (!m) {
    const nf = notFound as Mod | null;
    return { ...(await finish(nf?.default ? createElement(nf.default as never) : 'Not found', [rootLayout as Mod], 404)), title: 'Not found' };
  }
  const r = m.route;
  try {
    if (special === 'loading' && r.loading) return await finish(createElement(r.loading.default as never), r.layouts, 200);
    if (special === 'error' && r.error) return await finish(createElement(r.error.default as never, { error: { message: 'Errore di prova (e2e)', digest: 'e2e' }, reset: { $fn: 'refresh' } } as never), r.layouts, 200);
    const page = createElement(r.page.default as never, { params: Promise.resolve(params), searchParams: Promise.resolve(sp) } as never);
    return await finish(page, r.layouts, 200);
  } catch (e) {
    if (e instanceof RedirectError) return { tree: null, title: '', url: urlStr, status: 307, html: {}, redirect: e.url };
    console.error('[e2e-server] errore di rendering', url.pathname, e);
    if (r.error?.default) {
      const E = r.error.default as never;
      const err = { message: (e as Error).message, digest: 'e2e' };
      const el = createElement(E, { error: err, reset: { $fn: 'refresh' } } as never);
      // reset: la prop e' marcata per il client; il server non la valuta
      const d = await finish(el, r.layouts, 500).catch(() => null);
      if (d) return d;
    }
    return { tree: String((e as Error).message), title: 'Error', url: urlStr, status: 500, html: {} };
  }
}

// ---- HTTP -----------------------------------------------------------------------------------------------------
const MIME: Record<string, string> = { '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.html': 'text/html', '.ico': 'image/x-icon' };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function shell(d: Doc) {
  const h = d.html;
  return `<!doctype html><html lang="${esc(h.lang ?? 'it')}"${h.theme ? ` data-theme="${esc(h.theme)}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>${esc(d.title)}</title><link rel="stylesheet" href="/__app.css"><link rel="icon" href="/icons/icon-192.png"><link rel="manifest" href="/manifest.webmanifest"></head><body><div id="root"></div><script id="__flight" type="application/json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script><script src="/__client.js"></script></body></html>`;
}
function parseCookie(h: string | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of (h ?? '').split(';')) { const i = part.indexOf('='); if (i > 0) { try { m.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())); } catch { /* ignorato */ } } }
  return m;
}
async function handle(nreq: IncomingMessage, nres: ServerResponse, port: number, outDir: string) {
  const url = new URL(nreq.url ?? '/', `http://localhost:${port}`);
  const send = (status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}) => { nres.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra }); nres.end(body); };
  const hdrs = new Headers(); for (const [k, v] of Object.entries(nreq.headers)) if (typeof v === 'string') hdrs.set(k, v);
  const ctx = { cookies: parseCookie(nreq.headers.cookie), headers: hdrs };
  await als.run(ctx, async () => {
    if (url.pathname === '/__client.js') return send(200, readFileSync(join(outDir, 'client.js')), MIME['.js']);
    if (url.pathname === '/__app.css') return send(200, readFileSync(join(ROOT, 'src/app/globals.css')), MIME['.css']);
    const a = api(url.pathname);
    if (a) {
      const method = nreq.method ?? 'GET';
      const body = method === 'GET' || method === 'HEAD' ? undefined : (Readable.toWeb(nreq) as unknown as ReadableStream);
      const req = new Request(url, { method, headers: hdrs, body, duplex: 'half' } as RequestInit);
      const fn = a.handlers[method];
      const res = fn ? await fn(req, { params: Promise.resolve({ action: a.action }) }) : Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
      const out: Record<string, string | string[]> = {};
      res.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
      const sc = res.headers.getSetCookie(); if (sc.length) out['set-cookie'] = sc;
      nres.writeHead(res.status, out); nres.end(Buffer.from(await res.arrayBuffer())); return;
    }
    const file = normalize(join(ROOT, 'public', url.pathname));
    if (file.startsWith(join(ROOT, 'public')) && existsSync(file) && statSync(file).isFile()) return send(200, readFileSync(file), MIME[extname(file)] ?? 'application/octet-stream');
    if (url.pathname === '/__flight') {
      const d = await renderPage(url.searchParams.get('url') ?? '/');
      return send(200, JSON.stringify(d), 'application/json');
    }
    const d = await renderPage(url.pathname + url.search);
    if (d.redirect) { nres.writeHead(302, { location: d.redirect, 'cache-control': 'no-store' }); nres.end(); return; }
    send(d.status === 500 ? 500 : d.status, shell(d), 'text/html; charset=utf-8');
  });
}
export function startServer(port: number, outDir: string): Promise<{ close: () => Promise<void> }> {
  process.env.CHATHEL_DEMO ??= '1';
  const srv = createServer((q, s) => { handle(q, s, port, outDir).catch((e) => { console.error('[e2e-server]', e); if (!s.headersSent) { s.writeHead(500); s.end('errore del harness'); } }); });
  return new Promise((ok) => srv.listen(port, () => ok({ close: () => new Promise<void>((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }) })));
}
