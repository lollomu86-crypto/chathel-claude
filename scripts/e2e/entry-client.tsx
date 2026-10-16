// Runtime del browser del harness: monta il risultato del mini-RSC e fa la navigazione lato client (Link, router.push/refresh).
import { Fragment, StrictMode, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { registry } from 'virtual:registry';

type F = null | string | number | F[] | { t: string; k?: string | null; p: Record<string, unknown>; c: F } | { f: F } | { r: string; k?: string | null; p: Record<string, unknown>; c: F };
interface Doc { tree: F; title?: string; url: string; status: number; redirect?: string; html?: { lang?: string; theme?: string; cls?: string } }

const reg = registry as Record<string, unknown>;
function val(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(val);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('$el' in o) return node(o.$el as F);
    if ('$date' in o) return new Date(o.$date as string);
    if ('$fn' in o) return () => (window as unknown as { __chRefresh: () => void }).__chRefresh();
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, val(x)]));
  }
  return v;
}
function kids(c: F): ReactNode[] { return Array.isArray(c) ? c.map(node) : c === null ? [] : [node(c)]; }
function node(f: F): ReactNode {
  if (f === null || typeof f === 'string' || typeof f === 'number') return f;
  if (Array.isArray(f)) return f.map(node);
  if ('f' in f) return createElement(Fragment, { key: (f as { k?: string | null }).k ?? undefined }, ...kids(f.f));
  const key = f.k ?? undefined;
  const props = { ...(val(f.p) as object), key };
  if ('t' in f) return createElement(f.t, props, ...kids(f.c));
  const C = reg[f.r];
  if (!C) throw new Error(`Componente client non registrato: ${f.r}`);
  return createElement(C as never, props as never, ...kids(f.c));
}

const rootEl = document.getElementById('root')!;
const root = createRoot(rootEl);
const w = window as unknown as Record<string, unknown>;
function show(d: Doc) {
  if (d.title !== undefined) document.title = d.title;
  const h = document.documentElement;
  if (d.html?.lang) h.lang = d.html.lang;
  if (d.html?.theme) h.setAttribute('data-theme', d.html.theme); else h.removeAttribute('data-theme');
  root.render(createElement(StrictMode, null, node(d.tree)));
}
async function load(url: string, mode: 'push' | 'replace' | 'pop' | 'refresh') {
  const u = new URL(url, location.href);
  if (u.origin !== location.origin) { location.assign(url); return; }
  const r = await fetch(`/__flight?url=${encodeURIComponent(u.pathname + u.search)}`, { credentials: 'same-origin', cache: 'no-store' });
  const d = (await r.json()) as Doc;
  if (d.redirect) { await load(d.redirect, mode === 'refresh' || mode === 'pop' ? 'replace' : mode); return; }
  if (mode === 'push') history.pushState(null, '', d.url);
  else if (mode === 'replace') history.replaceState(null, '', d.url);
  show(d);
  window.dispatchEvent(new Event('ch:nav'));
  if (mode === 'push') window.scrollTo(0, 0);
}
w.__chNavigate = (url: string, replace?: boolean) => void load(url, replace ? 'replace' : 'push');
w.__chRefresh = () => void load(location.pathname + location.search, 'refresh');
window.addEventListener('popstate', () => void load(location.pathname + location.search, 'pop'));
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
  const u = new URL(a.href);
  if (u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  if (u.pathname === location.pathname && u.search === location.search && u.hash) return;
  e.preventDefault();
  void load(u.pathname + u.search, 'push');
});
show(JSON.parse(document.getElementById('__flight')!.textContent!) as Doc);
w.__chReady = true;
