// PostgREST / GoTrue SIMULATI, per provare SupabaseStore senza un progetto Supabase.
// NON e' Supabase: riproduce solo quello che serve ai test: select/insert/update/delete con filtri semplici, tetto di 1000 righe
// per risposta, RLS minima per tabella (funzione di visibilita'), RPC con errori SQLSTATE (CHxxx, 23505, 23514, 42501), token di accesso.
// Le RPC vere sono provate in SQL (supabase/tests); qui si prova la mappatura lato TypeScript.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;
export interface PgErr { code: string; message: string }
export interface Caller { role: 'anon' | 'authenticated' | 'service_role'; uid?: string }
export type RpcFn = (args: Row, who: Caller, db: FakeSupabase) => { data?: any; error?: PgErr };

export const SERVICE_KEY = 'service-key-di-prova';
export const ANON_KEY = 'anon-key-di-prova';
export const PG_ROW_CAP = 1000;

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  rpcs: Record<string, RpcFn> = {};
  /** visibilita' per tabella e chiamante (RLS): assente = tutte le righe */
  rls: Record<string, (row: Row, who: Caller) => boolean> = {};
  /** colonne vietate al chiamante (GRANT per colonna): lettura = errore 42501 */
  deniedColumns: Record<string, string[]> = {};
  /** access token -> id utente */
  tokens = new Map<string, string>();
  staffLogins = new Map<string, { password: string; uid: string; access: string; refresh: string }>();
  calls: { kind: 'rpc' | 'from'; name: string; args?: Row; role: string; uid?: string }[] = [];
  /** join semplici: "hotels(...)" nelle select */
  joins: Record<string, (row: Row, db: FakeSupabase) => any> = {};

  table(name: string): Row[] { return (this.tables[name] ??= []); }
  seed(name: string, rows: Row[]) { this.table(name).push(...rows); return this; }

  createClient = (_url: string, key: string, options?: { global?: { headers?: Record<string, string> } }) => {
    const auth = options?.global?.headers?.Authorization?.replace(/^Bearer\s+/i, '');
    const who: Caller = key === SERVICE_KEY ? { role: 'service_role' } : auth && this.tokens.has(auth) ? { role: 'authenticated', uid: this.tokens.get(auth) } : { role: 'anon' };
    return new FakeClient(this, who);
  };
}

type Pred = (r: Row) => boolean;
class Query implements PromiseLike<{ data: any; error: PgErr | null; count?: number | null }> {
  private preds: Pred[] = [];
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: any;
  private lim: number | null = null;
  private ord: { col: string; asc: boolean }[] = [];
  private single: 'none' | 'maybe' | 'one' = 'none';
  private head = false;
  private wantCount = false;
  private returning = false;
  private cols = '*';
  constructor(private db: FakeSupabase, private name: string, private who: Caller) {}

  select(cols = '*', o?: { count?: string; head?: boolean }) {
    if (this.op === 'select') this.cols = cols; else this.returning = true;
    if (o?.count) this.wantCount = true;
    if (o?.head) this.head = true;
    return this;
  }
  insert(p: Row | Row[]) { this.op = 'insert'; this.payload = p; return this; }
  update(p: Row) { this.op = 'update'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c: string, v: any) { this.preds.push((r) => r[c] === v); return this; }
  neq(c: string, v: any) { this.preds.push((r) => r[c] !== v); return this; }
  gt(c: string, v: any) { this.preds.push((r) => r[c] > v); return this; }
  gte(c: string, v: any) { this.preds.push((r) => r[c] >= v); return this; }
  lt(c: string, v: any) { this.preds.push((r) => r[c] < v); return this; }
  in(c: string, v: any[]) { this.preds.push((r) => v.includes(r[c])); return this; }
  is(c: string, v: null) { this.preds.push((r) => (r[c] ?? null) === v); return this; }
  not(c: string, _op: string, v: null) { this.preds.push((r) => (r[c] ?? null) !== v); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.ord.push({ col, asc: o?.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.single = 'maybe'; return this; }
  single_() { this.single = 'one'; return this; }

  then<T1, T2>(ok?: (v: any) => T1 | PromiseLike<T1>, ko?: (e: any) => T2 | PromiseLike<T2>) { return Promise.resolve(this.run()).then(ok, ko); }

  private denied(): PgErr | null {
    const deny = this.db.deniedColumns[this.name];
    if (deny && this.who.role === 'authenticated') {
      const used = new Set<string>(this.cols.split(',').map((c) => c.trim().split('(')[0]));
      if (this.cols.trim() === '*') used.add('*');
      for (const d of deny) if (used.has(d) || used.has('*')) return { code: '42501', message: `permission denied for column ${d}` };
    }
    return null;
  }
  private visible(r: Row) {
    const f = this.db.rls[this.name];
    return this.who.role === 'service_role' || !f || f(r, this.who);
  }
  private project(r: Row): Row {
    const out = { ...r };
    for (const m of this.cols.matchAll(/(\w+)\(/g)) {
      const j = this.db.joins[`${this.name}.${m[1]}`];
      if (j) out[m[1]] = j(r, this.db);
    }
    return out;
  }

  private run() {
    this.db.calls.push({ kind: 'from', name: `${this.name}:${this.op}`, role: this.who.role, uid: this.who.uid });
    const all = this.db.table(this.name);
    if (this.op === 'insert') {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r: Row) => ({ ...r }));
      const hook = this.db.rpcs[`__insert:${this.name}`];
      if (hook) { const e = hook({ rows }, this.who, this.db); if (e.error) return { data: null, error: e.error }; }
      all.push(...rows);
      return { data: this.returning ? rows : null, error: null };
    }
    const denied = this.denied();
    if (denied) return { data: null, error: denied };
    const hit = all.filter((r) => this.visible(r) && this.preds.every((p) => p(r)));
    if (this.op === 'update') { for (const r of hit) Object.assign(r, this.payload); return { data: this.returning ? hit : null, error: null }; }
    if (this.op === 'delete') { for (const r of hit) all.splice(all.indexOf(r), 1); return { data: this.returning ? hit : null, error: null }; }
    let rows = hit;
    for (const o of [...this.ord].reverse()) rows = [...rows].sort((a, b) => (a[o.col] > b[o.col] ? 1 : a[o.col] < b[o.col] ? -1 : 0) * (o.asc ? 1 : -1));
    const total = rows.length;
    // come PostgREST: al massimo 1000 righe per risposta, anche senza limit
    rows = rows.slice(0, Math.min(this.lim ?? PG_ROW_CAP, PG_ROW_CAP)).map((r) => this.project(r));
    if (this.head) return { data: null, error: null, count: total };
    if (this.single === 'none') return { data: rows, error: null, count: this.wantCount ? total : null };
    if (rows.length === 0) return this.single === 'one' ? { data: null, error: { code: 'PGRST116', message: 'no rows' } } : { data: null, error: null };
    return { data: rows[0], error: null };
  }
}

class FakeClient {
  constructor(private db: FakeSupabase, private who: Caller) {}
  from(name: string) { return new Query(this.db, name, this.who); }
  rpc(fn: string, args: Row = {}) {
    this.db.calls.push({ kind: 'rpc', name: fn, args, role: this.who.role, uid: this.who.uid });
    const f = this.db.rpcs[fn];
    return Promise.resolve(f ? { data: null, error: null, ...f(args, this.who, this.db) } : { data: null, error: { code: '42883', message: `function ${fn} does not exist` } });
  }
  auth = {
    getUser: async (jwt?: string) => {
      const uid = jwt ? this.db.tokens.get(jwt) : this.who.uid;
      return uid ? { data: { user: { id: uid } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } };
    },
    signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
      const l = this.db.staffLogins.get(email);
      if (!l || l.password !== password) return { data: { session: null, user: null }, error: { message: 'invalid' } };
      this.db.tokens.set(l.access, l.uid);
      return { data: { session: { access_token: l.access, refresh_token: l.refresh }, user: { id: l.uid } }, error: null };
    },
  };
}
// alias leggibile per i test: .single() sul builder
(Query.prototype as any).single = Query.prototype.single_;
