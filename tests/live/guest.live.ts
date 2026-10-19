// Prova di SupabaseStore contro un backend VERO: Postgres 16 con le migrazioni + PostgREST (scripts/sb-live/setup.sh).
// Manca GoTrue: i token degli ospiti sono JWT firmati qui con lo stesso segreto di PostgREST. Il login staff con password non si prova.
// Uso: set -a; . /tmp/sb-live.env; set +a; npx tsx --test tests/live/guest.live.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SupabaseStore } from '../../src/lib/store/supabase';
import { encodeSession } from '../../src/lib/session-format';
import { makePgrstClient } from './pgrst-client';

const DB = process.env.SB_DB!;
const SECRET = process.env.SB_SECRET!;
const psql = (sql: string) => execFileSync('psql', ['-qAt', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const userJwt = (sub: string) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ sub, role: 'authenticated', iss: 'chathel-live', exp: Math.floor(Date.now() / 1000) + 3600 }); return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };

const A = '00000000-0000-0000-0000-0000000000a1', B = '00000000-0000-0000-0000-0000000000a2';
const store = new SupabaseStore({ createClient: makePgrstClient as never });
const key = (n: number) => Buffer.alloc(32, n).toString('hex');
const co = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

test('seed', () => {
  psql(`insert into auth.users(id,email,is_anonymous) values ('${A}','a@example.test',false),('${B}','b@example.test',false) on conflict do nothing;
        insert into public.hotels(slug,name,bonus_season_cap,qr_token_hash) values ('live','Hotel Live',30,extensions.digest('qr-live','sha256')) on conflict do nothing;
        update public.hotels set access_code = coalesce(access_code, app.new_access_code()) where slug='live';`);
  assert.equal(psql(`select count(*) from public.hotels where slug='live'`), '1');
});

let sA = '', sB = '';
test('ingresso: codice numerico, hotel pubblico, soggiorno', async () => {
  const svc = (store as any).serviceClient();
  const code = psql(`select access_code from public.hotels where slug='live'`);
  assert.match(code, /^\d{6}$/, 'il codice a 6 cifre esiste');
  assert.equal(await store.hotelSlugByCode(code), 'live');
  assert.equal(await store.hotelSlugByCode('000000'), null);
  assert.equal((await store.publicHotel('live'))?.name, 'Hotel Live');
  for (const [id, sub, n] of [[A, 'sub-a', 'Giulia'], [B, 'sub-b', 'Marco']] as const) {
    const r = await svc.rpc('identity_register', { p_auth_user: id, p_provider: 'google', p_subject: sub, p_given_name: n });
    assert.equal(r.error, null, JSON.stringify(r.error));
  }
  const mk = async (id: string, k: number, nick: string) => {
    const cred = encodeSession({ a: userJwt(id), r: 'r' });
    const r = await store.startStay({ slug: 'live', qrToken: 'qr-live', identity: { provider: 'google', subject: 's', givenName: nick } as never, identityCredential: cred, authUserId: id, identityKey: key(k), nickname: nick, locale: 'it', checkout: co, isAdult: true, socialOptIn: true, privacyVersion: 'v1' } as never);
    assert.equal(r.bonus, 'issued');
    return r.session;
  };
  sA = await mk(A, 1, 'Giulia'); sB = await mk(B, 2, 'Marco');
});

test('ospite: vista, bonus, eventi, notifiche', async () => {
  const g = (await store.guest(sA))!; assert.ok(g, 'sessione valida');
  const v = await g.view(); assert.equal(v.hotel.slug, 'live'); assert.equal(v.name, 'Giulia');
  const b = await g.bonus(); assert.equal(b.state, 'issued');
  const q = await g.requestBonusQr(); assert.ok(q.token.length > 10);
  assert.ok(Array.isArray(await g.events())); assert.ok(Array.isArray(await g.notifications()));
  await g.setLocale('en'); assert.equal((await (await store.guest(sA))!.view()).locale, 'en');
});

test('sessione sbagliata o assente: nessun accesso', async () => {
  assert.equal(await store.guest(undefined), null);
  assert.equal(await store.guest(encodeSession({ a: userJwt('00000000-0000-0000-0000-0000000000ff'), r: 'r' })), null);
});

test('eventi e prenotazioni', async () => {
  const when = new Date(Date.now() + 86_400_000).toISOString(), end = new Date(Date.now() + 90_000_000).toISOString();
  psql(`delete from public.events;`);
  psql(`insert into public.events(hotel_id,title,starts_at,ends_at,published) select id,'{"it":"Serata","en":"Evening"}'::jsonb,'${when}','${end}',true from public.hotels where slug='live'`);
  const g = (await store.guest(sA))!;
  const evs = await g.events(); assert.equal(evs.length, 1);
  await g.rsvp(evs[0].id, true); assert.equal((await g.events())[0].going, true);
  await g.rsvp(evs[0].id, false); assert.equal((await g.events())[0].going, false);
});

test('social: regole, chat pubblica, richiesta privata, coupon', async () => {
  const a = (await store.guest(sA))!.social(), b = (await store.guest(sB))!.social();
  const sa = await a.settings(); assert.equal(sa.visible, true);
  await a.acceptRules(); await b.acceptRules();
  const list = await a.guests(); assert.ok(list.some((x) => x.nickname === 'Marco'), 'Marco compare nell\'elenco');
  const m = await a.postPublic('Ciao a tutti!'); assert.ok(m.id);
  assert.ok((await b.publicFeed()).some((x) => x.text === 'Ciao a tutti!'));
  const marco = list.find((x) => x.nickname === 'Marco')!;
  const { threadId } = await a.startThread(marco.id, 'Giochiamo a racchettoni?');
  assert.equal((await b.threads()).length, 1);
  await b.respond(threadId, true);
  await b.sendPrivate(threadId, 'Volentieri!');
  const t = await a.thread(threadId); assert.equal(t.messages.length, 2);
  const c = await a.sendCoupon(threadId, 'coffee' as never); assert.ok(c.id);
  assert.ok((await b.couponQr(c.id)).token);
  await b.block(list.find((x) => x.nickname === 'Giulia')?.id ?? (await b.guests())[0].id).catch(() => {});
});

test('uscita: "Esci e cancella i miei dati"', async () => {
  const g = (await store.guest(sB))!; await g.endMyStay();
  assert.equal(await store.guest(sB), null);
});
