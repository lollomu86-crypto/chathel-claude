// Client minimo verso PostgREST VERO (stessa API REST di Supabase), iniettabile come `createClient` in SupabaseStore.
// Serve alle prove contro un database reale quando supabase-js non e' installabile. Copre solo le chiamate che lo store usa.
// Auth (GoTrue) NON c'e': signInWithPassword/getUser rispondono con errore, quindi il login staff con password non si prova qui.
/* eslint-disable @typescript-eslint/no-explicit-any */
// PostgREST puro risponde alla radice; Supabase lo espone sotto /rest/v1. Locale: PGRST_PREFIX=''
const PFX = process.env.PGRST_PREFIX ?? '/rest/v1';
import { createHmac } from 'node:crypto';
type Res = { data: any; error: { code?: string; message: string; details?: string; hint?: string } | null; count?: number | null };

class Q implements PromiseLike<Res> {
  private params = new URLSearchParams();
  private method = 'GET';
  private body: unknown;
  private prefer: string[] = [];
  private mode: 'many' | 'one' | 'maybe' = 'many';
  private head = false;
  constructor(private base: string, private headers: Record<string, string>, private table: string) {}
  select(cols = '*', o?: { count?: string; head?: boolean }) {
    this.params.set('select', cols.replace(/\s+/g, ''));
    if (this.method !== 'GET') this.prefer.push('return=representation');
    if (o?.count) this.prefer.push(`count=${o.count}`);
    if (o?.head) { this.head = true; }
    return this;
  }
  insert(row: unknown) { this.method = 'POST'; this.body = row; return this; }
  update(row: unknown) { this.method = 'PATCH'; this.body = row; return this; }
  delete() { this.method = 'DELETE'; return this; }
  private f(col: string, op: string, v: unknown) { this.params.append(col, `${op}.${v}`); return this; }
  eq(c: string, v: unknown) { return this.f(c, 'eq', v); }
  neq(c: string, v: unknown) { return this.f(c, 'neq', v); }
  gt(c: string, v: unknown) { return this.f(c, 'gt', v); }
  gte(c: string, v: unknown) { return this.f(c, 'gte', v); }
  lt(c: string, v: unknown) { return this.f(c, 'lt', v); }
  lte(c: string, v: unknown) { return this.f(c, 'lte', v); }
  is(c: string, v: unknown) { return this.f(c, 'is', v === null ? 'null' : v); }
  in(c: string, vs: unknown[]) { this.params.append(c, `in.(${vs.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(',')})`); return this; }
  not(c: string, op: string, v: unknown) { this.params.append(c, `not.${op}.${v === null ? 'null' : v}`); return this; }
  order(c: string, o?: { ascending?: boolean }) { const prev = this.params.get('order'); this.params.set('order', `${prev ? prev + ',' : ''}${c}.${o?.ascending === false ? 'desc' : 'asc'}`); return this; }
  limit(n: number) { this.params.set('limit', String(n)); return this; }
  single() { this.mode = 'one'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then<A, B>(ok?: ((v: Res) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) { return this.run().then(ok, ko); }
  private async run(): Promise<Res> {
    const h: Record<string, string> = { ...this.headers, 'content-type': 'application/json' };
    if (this.prefer.length) h.Prefer = this.prefer.join(',');
    if (this.mode === 'one') h.Accept = 'application/vnd.pgrst.object+json';
    const qs = this.params.toString();
    const r = await fetch(`${this.base}${PFX}/${this.table}${qs ? '?' + qs : ''}`, { method: this.head ? 'HEAD' : this.method, headers: h, body: this.body === undefined ? undefined : JSON.stringify(this.body) });
    let count: number | null = null;
    const cr = r.headers.get('content-range');
    if (cr && cr.includes('/') && !cr.endsWith('/*')) count = Number(cr.split('/')[1]);
    if (this.head) return r.ok ? { data: null, error: null, count } : { data: null, error: { message: `HTTP ${r.status}` }, count };
    const txt = await r.text();
    const json = txt ? JSON.parse(txt) : null;
    if (!r.ok) return { data: null, error: { code: json?.code, message: json?.message ?? `HTTP ${r.status}`, details: json?.details, hint: json?.hint } };
    if (this.mode === 'maybe') return { data: Array.isArray(json) ? json[0] ?? null : json, error: null, count };
    return { data: this.method === 'DELETE' || this.method === 'POST' || this.method === 'PATCH' ? (json ?? null) : json, error: null, count };
  }
}

export function makePgrstClient(url: string, key: string, options?: { global?: { headers?: Record<string, string> } }) {
  const headers: Record<string, string> = { apikey: key, Authorization: `Bearer ${key}`, ...(options?.global?.headers ?? {}) };
  const noAuth = async () => ({ data: { user: null, session: null }, error: { message: 'auth non disponibile nel backend di prova' } });
  return {
    from: (t: string) => new Q(url, headers, t),
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      const p = (async (): Promise<Res> => {
        const r = await fetch(`${url}${PFX}/rpc/${fn}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(args) });
        const txt = await r.text(); const json = txt ? JSON.parse(txt) : null;
        if (!r.ok) return { data: null, error: { code: json?.code, message: json?.message ?? `HTTP ${r.status}`, details: json?.details, hint: json?.hint } };
        return { data: json, error: null };
      })();
      return Object.assign(p, { single: () => p.then((x) => (x.error ? x : { data: Array.isArray(x.data) ? x.data[0] ?? null : x.data, error: null })), maybeSingle: () => p.then((x) => (x.error ? x : { data: Array.isArray(x.data) ? x.data[0] ?? null : x.data, error: null })) });
    },
    auth: {
      signInWithPassword: noAuth,
      // al posto di GoTrue: legge `sub` dal JWT e ne verifica la firma con lo stesso segreto di PostgREST (PGRST_JWT_SECRET)
      getUser: async (tok: string) => {
        try {
          const [h, p, sig] = tok.split('.');
          const ok = createHmac('sha256', process.env.SB_SECRET ?? '').update(`${h}.${p}`).digest('base64url') === sig;
          const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
          if (!ok || claims.exp * 1000 < Date.now()) throw new Error('bad');
          return { data: { user: { id: claims.sub } }, error: null };
        } catch { return { data: { user: null }, error: { message: 'invalid token' } }; }
      },
    },
  };
}
