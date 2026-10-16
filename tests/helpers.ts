import { DemoStore, type DemoOptions } from '../src/lib/store/demo';
import type { GuestIdentity, StartStayInput } from '../src/lib/types';

export interface Clock { now: () => Date; advance: (ms: number) => void; set: (d: Date) => void }
export function makeClock(start = '2026-10-12T10:00:00Z'): Clock {
  let t = new Date(start).getTime();
  return { now: () => new Date(t), advance: (ms) => { t += ms; }, set: (d) => { t = d.getTime(); } };
}
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export function makeStore(opts: DemoOptions & { start?: string } = {}) {
  const clock = makeClock(opts.start);
  const store = new DemoStore({ now: clock.now, ...opts });
  return { store, clock };
}

/** YYYY-MM-DD a `n` giorni dal giorno locale (Roma) dell'istante dato */
export function dayPlus(clock: Clock, n: number): string {
  const d = new Date(clock.now().getTime() + n * DAY);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Identita' simulata (come il login "Giulia (demo)"): una per nome, il soggetto e' stabile. */
export function demoIdentity(name: string): GuestIdentity {
  return { provider: 'demo', subject: `demo-${name.toLowerCase().replace(/\s+/g, '-')}`, givenName: name.split(' ')[0] };
}

export async function join(store: DemoStore, clock: Clock, name: string, days = 5, extra: Partial<StartStayInput> = {}) {
  const r = await store.startStay({ slug: 'demo', qrToken: 'demo-qr-token', identity: demoIdentity(name), locale: 'it', checkout: dayPlus(clock, days), isAdult: true, ...extra });
  const g = await store.guest(r.session);
  if (!g) throw new Error('guest api mancante');
  return { session: r.session, bonus: r.bonus, g };
}

export async function login(store: DemoStore, email: string, password: string) {
  const r = await store.staffLogin(email, password);
  if (!r) throw new Error('login fallito');
  const s = await store.staff(r.session);
  if (!s) throw new Error('staff api mancante');
  return s;
}
export const bar = (store: DemoStore) => login(store, 'bar@demo.chathel.test', 'demo-bar');
export const admin = (store: DemoStore) => login(store, 'admin@demo.chathel.test', 'demo-admin');
export const reception = (store: DemoStore) => login(store, 'reception@demo.chathel.test', 'demo-reception');
