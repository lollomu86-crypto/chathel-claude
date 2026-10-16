import { AsyncLocalStorage } from 'node:async_hooks';
export interface ReqCtx { cookies: Map<string, string>; headers: Headers }
export const als = new AsyncLocalStorage<ReqCtx>();
const ctx = () => { const c = als.getStore(); if (!c) throw new Error('fuori da una richiesta'); return c; };
export async function cookies() {
  const c = ctx().cookies;
  return { get: (n: string) => (c.has(n) ? { name: n, value: c.get(n)! } : undefined), getAll: () => [...c].map(([name, value]) => ({ name, value })), has: (n: string) => c.has(n) };
}
export async function headers() { return ctx().headers; }
