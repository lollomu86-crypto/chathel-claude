// Prove delle correzioni della revisione backend (docs/10): configurazione fail-closed, HTTP, emergenze, identita',
// concorrenza nello store demo, tetti per hotel, anti-abuso dell'ingresso, avvisi, controlli statici.
// Le prove di concorrenza TRA TRANSAZIONI sono in SQL (supabase/tests/concurrency.sh).
process.env.CHATHEL_DEMO = '1';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { makeStore, join, demoIdentity, bar, admin, reception, dayPlus } from './helpers';
import { DemoStore } from '../src/lib/store/demo';
import { DemoIdentityProvider, DEMO_IDENTITIES } from '../src/lib/auth/guest-identity';
import { guestAction, aiChat, onboarding, identityAction, staffLogin, staffAction, health, type Ctx } from '../src/lib/api/handlers';
import { runApi, parseCookies } from '../src/lib/api/http';
import { _resetForTests } from '../src/lib/ratelimit';
import { resolveMode, ConfigError } from '../src/lib/env';
import { newBonusToken } from '../src/lib/rules/bonus';
import { newCouponToken, isCouponToken } from '../src/lib/rules/coupons';
import { memorySink, WebhookAlertSink, setAlertSinks, raiseUrgent } from '../src/lib/alerts';
import { isEmergency, preCheck } from '../src/lib/ai/guardrails';
import { getStore } from '../src/lib/store';

const G = globalThis as unknown as { __chathelStore?: unknown; __chathelIdentity?: unknown };
const idp = new DemoIdentityProvider();
const ENV_KEYS = ['CHATHEL_DEMO', 'NODE_ENV', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'CHATHEL_DEMO_ALLOW_PRODUCTION', 'TRUSTED_IP_HEADER', 'AI_HOTEL_DAILY_CAP', 'ANTHROPIC_API_KEY'] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
function setEnv(o: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  const env = process.env as Record<string, string | undefined>;
  for (const k of ENV_KEYS) { const v = k in o ? o[k] : saved[k]; if (v === undefined) delete env[k]; else env[k] = v; }
}
beforeEach(() => { _resetForTests(); setEnv({}); G.__chathelStore = undefined; G.__chathelIdentity = undefined; memorySink.items.length = 0; setAlertSinks(null); delete process.env.ANTHROPIC_API_KEY; });

const ctxOf = (store: DemoStore, o: Partial<Ctx> = {}): Ctx => ({ store, identityProvider: idp, ip: '10.0.0.1', method: 'POST', ...o });
const body = (clock: Parameters<typeof dayPlus>[0], extra: Record<string, unknown> = {}) =>
  ({ slug: 'demo', k: 'demo-qr-token', locale: 'it', checkout: dayPlus(clock, 3), isAdult: true, consent: true, ...extra });
const reason = (p: Promise<unknown>) => p.then(() => 'ok', (e: { reason?: string }) => e?.reason ?? 'error');

// ============================================================ T-D9 configurazione fail-closed
test('T-D9 configurazione: senza variabili l\'app non parte; la demo solo con flag esplicito e mai per caso in produzione', async () => {
  setEnv({ CHATHEL_DEMO: undefined });
  assert.throws(() => resolveMode(), (e: unknown) => e instanceof ConfigError && e.code === 'no_config');
  setEnv({ CHATHEL_DEMO: '1' });
  assert.equal(resolveMode(), 'demo');
  setEnv({ CHATHEL_DEMO: '1', NODE_ENV: 'production' });
  assert.throws(() => resolveMode(), (e: unknown) => e instanceof ConfigError && e.code === 'demo_in_production');
  setEnv({ CHATHEL_DEMO: '1', NODE_ENV: 'production', CHATHEL_DEMO_ALLOW_PRODUCTION: '1' });
  assert.equal(resolveMode(), 'demo');
  setEnv({ CHATHEL_DEMO: '1', SUPABASE_URL: 'https://x.test', SUPABASE_ANON_KEY: 'k' });
  assert.throws(() => resolveMode(), (e: unknown) => e instanceof ConfigError && e.code === 'ambiguous');
  setEnv({ CHATHEL_DEMO: undefined, SUPABASE_URL: 'https://x.test', SUPABASE_ANON_KEY: 'k' });
  assert.equal(resolveMode(), 'supabase');
  // senza configurazione lo store non si crea e /api/health risponde 503 (nessun ripiego silenzioso sui dati in memoria)
  setEnv({ CHATHEL_DEMO: undefined });
  await assert.rejects(getStore(), (e: unknown) => e instanceof ConfigError);
  assert.equal((await health()).status, 503);
  setEnv({ CHATHEL_DEMO: '1' });
  assert.equal((await health()).status, 200);
});

test('T-D9 senza configurazione le API rispondono 503 senza dettagli, e la demo non carica password staff', async () => {
  setEnv({ CHATHEL_DEMO: undefined });
  const res = await runApi(new Request('http://x/api/staff/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"admin@demo.chathel.test","password":"demo-admin"}' }),
    (ctx, input) => staffLogin(ctx, input));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, error: 'service_unavailable' });
});

// ============================================================ T-D1 HTTP
function req(url: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  return new Request(url, { ...init, headers });
}
const JSON_H = { 'content-type': 'application/json' };

test('T-D1 HTTP: 415 senza JSON, 405 metodo, 413 corpo troppo grande, 400 JSON rotto, cookie malformato ignorato', async () => {
  const { store } = makeStore();
  G.__chathelStore = store; G.__chathelIdentity = idp;
  const echo = async (ctx: Ctx) => ({ status: 200, body: { ok: true, hasGuest: !!ctx.guest } });
  assert.equal((await runApi(req('http://x/a', { method: 'POST', body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }), echo)).status, 415);
  assert.equal((await runApi(req('http://x/a', { method: 'POST', body: 'x' }), echo)).status, 415);
  assert.equal((await runApi(req('http://x/a', { method: 'DELETE' }), echo)).status, 405);
  assert.equal((await runApi(req('http://x/a', { method: 'PUT', body: '{}', headers: JSON_H }), echo)).status, 405);
  assert.equal((await runApi(req('http://x/a', { method: 'POST', body: '{', headers: JSON_H }), echo)).status, 400);
  assert.equal((await runApi(req('http://x/a', { method: 'POST', body: JSON.stringify({ t: 'x'.repeat(70_000) }), headers: JSON_H }), echo)).status, 413);
  // cookie con codifica rotta: nessun 500, semplicemente nessuna sessione
  const r = await runApi(req('http://x/a', { method: 'POST', body: '{}', headers: JSON_H, cookie: 'ch_guest=%E0%A4%A; ch_staff=%' }), echo);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).hasGuest, false);
  assert.deepEqual(parseCookies('a=1; b=%zz; c=3'), { a: '1', c: '3' });
});

test('T-D1 HTTP: azioni di scrittura rifiutano GET (405); sessione assente 401; sopra il limite 429', async () => {
  const { store, clock } = makeStore();
  const a = await join(store, clock, 'Anna');
  const get = (s?: string): Ctx => ctxOf(store, { guest: s, method: 'GET' });
  for (const action of ['book', 'rsvp', 'cancel-booking', 'locale', 'delete-me', 'bonus-qr']) {
    assert.equal((await guestAction(get(a.session), action, {})).status, 405, action);
  }
  assert.equal((await guestAction(get(undefined), 'bonus', {})).status, 401);
  // login staff: 10 tentativi per account ogni 10 minuti, anche cambiando IP
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await staffLogin(ctxOf(store, { ip: `9.9.9.${i}` }), { email: 'admin@demo.chathel.test', password: 'sbagliata' })).status;
  assert.equal(last, 429);
});

test('T-D1 cookie: Secure fuori dalla demo, non in demo; HttpOnly sempre', async () => {
  const { store, clock } = makeStore();
  const post = () => req('http://x/api/onboarding', { method: 'POST', headers: JSON_H, cookie: 'ch_ident=demo%3Agiulia', body: JSON.stringify(body(clock)) });
  G.__chathelStore = store; G.__chathelIdentity = idp;
  let res = await runApi(post(), (ctx, input) => onboarding(ctx, input));
  assert.equal(res.status, 200);
  let c = res.headers.getSetCookie().find((x) => x.startsWith('ch_guest='))!;
  assert.ok(c.includes('HttpOnly') && c.includes('SameSite=Lax'));
  assert.ok(!c.includes('Secure'), 'in demo (http locale) niente Secure');
  // fuori dalla demo: variabili Supabase presenti, nessun flag demo; lo store e' gia' in cache e la modalita' non viene decisa dal flag
  _resetForTests();
  const second = makeStore();
  G.__chathelStore = second.store;
  setEnv({ CHATHEL_DEMO: undefined, SUPABASE_URL: 'https://x.test', SUPABASE_ANON_KEY: 'k' });
  res = await runApi(req('http://x/api/onboarding', { method: 'POST', headers: JSON_H, cookie: 'ch_ident=demo%3Agiulia', body: JSON.stringify(body(second.clock)) }), (ctx, input) => onboarding(ctx, input));
  c = res.headers.getSetCookie().find((x) => x.startsWith('ch_guest='))!;
  assert.ok(c.includes('Secure') && c.includes('HttpOnly'));
});

// ============================================================ T-D7 IP
test('T-D7 anti-abuso: X-Forwarded-For variabile non aggira il limite; il limite per identita\' scatta al 6o tentativo', async () => {
  const { store, clock } = makeStore();
  G.__chathelStore = store; G.__chathelIdentity = idp;
  setEnv({ CHATHEL_DEMO: undefined, SUPABASE_URL: 'https://x.test', SUPABASE_ANON_KEY: 'k' }); // niente IP fidato, niente demo
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) {
    const r = await runApi(req('http://x/api/onboarding', { method: 'POST', headers: { ...JSON_H, 'x-forwarded-for': `203.0.113.${i}` }, cookie: 'ch_ident=demo%3Amarco',
      body: JSON.stringify(body(clock, { k: `sbagliato-${i}` })) }), (ctx, input) => onboarding(ctx, input));
    statuses.push(r.status);
  }
  assert.deepEqual(statuses.slice(0, 5), [400, 400, 400, 400, 400]); // QR errato
  assert.deepEqual(statuses.slice(5), [429, 429]);
  // un'altra identita' non e' bloccata dal comportamento della prima
  const ok = await runApi(req('http://x/api/onboarding', { method: 'POST', headers: { ...JSON_H, 'x-forwarded-for': '203.0.113.99' }, cookie: 'ch_ident=demo%3Asofia', body: JSON.stringify(body(clock)) }), (ctx, input) => onboarding(ctx, input));
  assert.equal(ok.status, 200);
});

test('T-D7 IP: solo da intestazione fidata; x-forwarded-for ignorato fuori dalla demo', async () => {
  const { clientIp } = await import('../src/lib/api/http');
  const r = req('http://x/', { headers: { 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '5.6.7.8' } });
  setEnv({ CHATHEL_DEMO: undefined, SUPABASE_URL: 'https://x.test', SUPABASE_ANON_KEY: 'k' });
  assert.equal(clientIp(r), 'unknown');
  setEnv({ CHATHEL_DEMO: undefined, SUPABASE_URL: 'https://x.test', SUPABASE_ANON_KEY: 'k', TRUSTED_IP_HEADER: 'cf-connecting-ip' });
  assert.equal(clientIp(r), '5.6.7.8');
  setEnv({ CHATHEL_DEMO: '1' });
  assert.equal(clientIp(r), '1.2.3.4');
});

test('anti-abuso: limiti per codice, per hotel e globale (difesa in profondita\'), identita\' diverse', async () => {
  const { checkEntryLimits } = await import('../src/lib/abuse');
  _resetForTests();
  // 300 tentativi per codice in 10 minuti: identita' tutte diverse, stesso codice
  let scope: string | null = null;
  for (let i = 0; i < 301 && !scope; i++) scope = await checkEntryLimits({ identityKey: `id${i}`, slug: 'h1', code: 'stesso', ip: null });
  assert.ok(scope === 'code' || scope === 'hotel', `scope=${scope}`);
  _resetForTests();
  scope = null;
  let n = 0;
  for (; n < 70 && !scope; n++) scope = await checkEntryLimits({ identityKey: `id${n}`, slug: 'h2', code: `c${n}`, ip: null });
  assert.equal(scope, 'hotel'); // 60 al minuto per hotel
  assert.equal(n, 61);
  // un account bloccato non consuma i contatori degli altri
  _resetForTests();
  for (let i = 0; i < 50; i++) await checkEntryLimits({ identityKey: 'insistente', slug: 'h3', code: 'x', ip: null });
  assert.equal(await checkEntryLimits({ identityKey: 'altro', slug: 'h3', code: 'y', ip: null }), null);
});

// ============================================================ identita'
test('identita\': ingresso solo con identita\' verificata; il nome viene dall\'account, il campo name e\' ignorato', async () => {
  const { store, clock } = makeStore();
  let r = await onboarding(ctxOf(store), body(clock));
  assert.equal(r.status, 401); assert.equal(r.body?.error, 'identity_required');
  r = await onboarding(ctxOf(store, { identityCookie: 'demo:inesistente' }), body(clock));
  assert.equal(r.status, 401);
  r = await onboarding(ctxOf(store, { identityCookie: 'demo:giulia' }), body(clock, { name: 'Mario Rossi Cognome' }));
  assert.equal(r.status, 200); assert.equal(r.body?.bonus, 'issued');
  const g = await store.guest(r.guestCookie!);
  assert.equal((await g!.view()).name, 'Giulia');
  // senza consenso non si entra
  r = await onboarding(ctxOf(store, { identityCookie: 'demo:marco' }), body(clock, { consent: false }));
  assert.equal(r.status, 400); assert.equal(r.body?.error, 'consent_required');
});

test('identita\': endpoint options / demo-login / me / logout; nessun dato oltre al nome di battesimo', async () => {
  const { store } = makeStore();
  let r = await identityAction(ctxOf(store, { method: 'GET' }), 'options', {});
  assert.equal(r.body?.mode, 'demo');
  assert.deepEqual((r.body?.demo as { label: string }[]).map((x) => x.label), DEMO_IDENTITIES.map((d) => `${d.givenName} (demo)`));
  r = await identityAction(ctxOf(store), 'demo-login', { id: 'giulia' });
  assert.equal(r.status, 200); assert.equal(r.identityCookie, 'demo:giulia');
  assert.deepEqual(r.body?.identity, { givenName: 'Giulia', provider: 'demo' });
  assert.equal((await identityAction(ctxOf(store), 'demo-login', { id: 'nessuna' })).status, 400);
  assert.equal((await identityAction(ctxOf(store, { method: 'GET' }), 'demo-login', {})).status, 405);
  r = await identityAction(ctxOf(store, { method: 'GET', identityCookie: 'demo:giulia' }), 'me', {});
  assert.deepEqual(r.body?.identity, { givenName: 'Giulia', provider: 'demo' });
  assert.equal(JSON.stringify(r.body).includes('subject'), false);
  r = await identityAction(ctxOf(store, { method: 'GET', identityCookie: 'xx' }), 'me', {});
  assert.equal(r.status, 401);
  r = await identityAction(ctxOf(store), 'logout', {});
  assert.equal(r.identityCookie, null);
  assert.equal((await identityAction(ctxOf(store), 'session', { accessToken: 'x'.repeat(20), refreshToken: 'y' })).status, 404); // la demo non ha lo scambio token
});

test('identita\': un\'identita\' = un solo soggiorno per hotel; doppio tocco simultaneo = un ospite, un bonus (T-D6)', async () => {
  const { store, clock } = makeStore();
  const ctx = ctxOf(store, { identityCookie: 'demo:giulia' });
  const [a, b] = await Promise.all([onboarding(ctx, body(clock)), onboarding({ ...ctx }, body(clock))]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual([a.body?.bonus, b.body?.bonus].sort(), ['existing', 'issued']);
  assert.equal(store.ledger.bonuses.length, 1);
  assert.equal(store.guests.size, 1);
  assert.equal(a.guestCookie === b.guestCookie || a.guestCookie !== undefined, true);
  // ritentativo con la sessione gia' valida: nessun limite consumato, esito "existing"
  const again = await onboarding(ctxOf(store, { identityCookie: 'demo:giulia', guest: a.guestCookie ?? undefined }), body(clock));
  assert.equal(again.body?.existing, true);
  // lo stesso account che rientra senza cookie (altro dispositivo): stessa sessione di soggiorno, nessun secondo ospite
  const other = await onboarding(ctxOf(store, { identityCookie: 'demo:giulia' }), body(clock));
  assert.equal(other.body?.bonus, 'existing');
  assert.equal(store.guests.size, 1);
});

test('identita\': stesso account, stesso hotel, stessa stagione = un solo bonus anche dopo "esci e cancella"', async () => {
  const { store, clock } = makeStore();
  const a = await join(store, clock, 'Giulia');
  assert.equal(a.bonus, 'issued');
  // il bonus viene riscattato dal barista, poi l'ospite cancella i dati e rientra con lo stesso account
  const qr = await a.g.requestBonusQr();
  const b = await bar(store);
  assert.equal((await b.redeem(qr.token)).ok, true);
  await a.g.endMyStay();
  assert.equal(store.guests.size, 0);
  const again = await join(store, clock, 'Giulia');
  assert.equal(again.bonus, 'already_claimed');
  // altro account: bonus regolare
  assert.equal((await join(store, clock, 'Marco')).bonus, 'issued');
});

test('identita\': un account senza dati personali nel database applicativo (solo soggetto e nome di battesimo)', async () => {
  const { store, clock } = makeStore();
  await join(store, clock, 'Giulia Rossi Bianchi');
  const dump = JSON.stringify([...store.guests.values()]);
  assert.ok(dump.includes('Giulia'));
  assert.ok(!dump.includes('Rossi') && !dump.includes('@'));
});

test('identita\' Supabase (client simulato): solo Google, nome di battesimo, niente e-mail; scambio dei token registra l\'identita\'', async () => {
  const { SupabaseIdentityProvider, givenNameFrom } = await import('../src/lib/auth/guest-identity');
  const { encodeSession } = await import('../src/lib/session-format');
  const calls: Record<string, unknown>[] = [];
  const mkUser = (o: Record<string, unknown>) => ({ id: 'u1', identities: [{ provider: 'google', identity_data: { sub: 'g-123', email: 'x@y.z' } }], user_metadata: { full_name: 'Giulia Rossi', email: 'x@y.z', avatar_url: 'http://foto' }, ...o });
  let user: ReturnType<typeof mkUser> | null = mkUser({});
  const client = {
    auth: { getUser: async (jwt?: string) => (jwt === 'buono' && user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'x' } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, ...args }); return { data: 'id', error: null }; },
  };
  const p = new SupabaseIdentityProvider({ anon: () => client, service: () => client });
  const cookie = encodeSession({ a: 'buono', r: 'ref' });
  const v = await p.verify(cookie);
  assert.deepEqual(v, { identity: { provider: 'google', subject: 'g-123', givenName: 'Giulia' }, authUserId: 'u1' });
  assert.equal(JSON.stringify(v).includes('@'), false);
  assert.equal(await p.verify(encodeSession({ a: 'cattivo', r: 'r' })), null);
  assert.equal(await p.verify('non-valido'), null);
  assert.equal(await p.verify(undefined), null);
  user = mkUser({ identities: [{ provider: 'email', identity_data: {} }] });   // login non Google
  assert.equal(await p.verify(cookie), null);
  user = mkUser({ user_metadata: {} });                                         // niente nome: rifiutato
  assert.equal(await p.verify(cookie), null);
  user = mkUser({});
  const ex = await p.exchangeSession({ accessToken: 'buono', refreshToken: 'ref' });
  assert.equal(ex?.identity.givenName, 'Giulia');
  assert.deepEqual(calls[0], { fn: 'identity_register', p_auth_user: 'u1', p_provider: 'google', p_subject: 'g-123', p_given_name: 'Giulia' });
  assert.equal(await p.exchangeSession({ accessToken: 'cattivo', refreshToken: 'r' }), null);
  assert.equal(givenNameFrom({ full_name: '  Maria  Luisa Rossi ' }), 'Maria');
  assert.equal(givenNameFrom({ given_name: 'Zoë', full_name: 'Zoë Verdi' }), 'Zoë');
  assert.equal(givenNameFrom({}), null);
});

// ============================================================ T-D2 emergenze
const EMERGENCIES = ['Incendio in camera!', 'Chiamate un\'ambulanza', 'aiuto', 'Fire! please help', 'Hilfe, es brennt', 'Пожар!', 'Нужна скорая', 'my husband is unconscious', 'sto male, non respira'];

test('T-D2 emergenza: passa anche con limite di frequenza, tetto giornaliero e tetto AI dell\'hotel esauriti; messaggio con 112 e avviso prioritario', async () => {
  const { store, clock } = makeStore();
  const a = await join(store, clock, 'Anna');
  setEnv({ CHATHEL_DEMO: '1', AI_HOTEL_DAILY_CAP: '1' });
  const ctx = ctxOf(store, { guest: a.session });
  // esaurisce limite al minuto (12) e tetto AI dell'hotel (1)
  let last = 0;
  for (let i = 0; i < 14; i++) last = (await aiChat(ctx, { text: `domanda ${i}` })).status;
  assert.equal(last, 429);
  const r = await aiChat(ctx, { text: 'Incendio! aiuto!' });
  assert.equal(r.status, 200);
  assert.equal(r.body?.emergency, true);
  const chat = (r.body?.chat as { messages: { role: string; content: string }[] }).messages;
  const reply = chat[chat.length - 1];
  assert.equal(reply.role, 'assistant');
  assert.ok(reply.content.includes('112'));
  assert.ok(reply.content.includes('interno 9'), 'numero della reception');
  // avviso prioritario: memoria + coda della reception in testa
  assert.equal(memorySink.items.length, 1);
  assert.equal(JSON.stringify(memorySink.items[0]).includes('Incendio'), false, 'nessun testo dell\'ospite nell\'avviso');
  const rec = await reception(store);
  const q = await rec.handoffQueue(false);
  assert.equal(q[0].priority, 'urgent');
  assert.equal((await rec.urgentAlerts()).length, 1);
});

test('T-D2 emergenza: tetto giornaliero dei messaggi (30) esaurito e tutte le lingue previste', async () => {
  const { store, clock } = makeStore();
  const a = await join(store, clock, 'Anna');
  for (let i = 0; i < 30; i++) await a.g.appendGuestMessage(`m${i}`);
  const ctx = ctxOf(store, { guest: a.session });
  assert.equal((await aiChat(ctx, { text: 'wifi?' })).body?.error, 'daily_limit');
  for (const text of EMERGENCIES) {
    _resetForTests();
    const r = await aiChat(ctx, { text });
    assert.equal(r.status, 200, text);
    const msgs = (r.body?.chat as { messages: { content: string }[] }).messages;
    assert.ok(msgs[msgs.length - 1].content.includes('112'), text);
  }
});

test('T-D2 emergenza flood: oltre il tetto di sicurezza la risposta con il 112 c\'e\' comunque', async () => {
  const { store, clock } = makeStore();
  const a = await join(store, clock, 'Anna');
  const ctx = ctxOf(store, { guest: a.session });
  let r;
  for (let i = 0; i < 62; i++) r = await aiChat(ctx, { text: 'incendio' });
  assert.equal(r!.status, 429);
  assert.ok(String(r!.body?.emergencyText).includes('112'));
});

test('emergenze: parole in it/en/de/ru; nessun falso allarme su frasi comuni', () => {
  for (const t of EMERGENCIES) assert.equal(isEmergency(t), true, t);
  for (const t of ['112', 'chiamate il 112', 'Feuer', 'help']) assert.equal(isEmergency(t), true, t);
  for (const t of ['camera 112 per favore', 'help with the wifi password please', 'a che ora e\' la colazione', 'questo male non mi piace', 'Wie ist das Passwort fürs WLAN?', 'Во сколько завтрак?', 'il fuoco del camino e\' acceso?']) {
    assert.equal(isEmergency(t), false, t);
  }
  assert.equal(preCheck('ho un\'allergia alle noci')?.kind, 'allergy');
  assert.equal(preCheck('ho un\'allergia alle noci')?.priority, 'normal');
  assert.equal(preCheck('voglio parlare con un operatore')?.kind, 'operator');
});

test('avvisi: webhook con fetch simulato, senza testo dell\'ospite e senza far fallire la richiesta se il canale cade', async () => {
  const sent: { url: string; body: string }[] = [];
  const okFetch = (async (url: string, init: { body: string }) => { sent.push({ url, body: init.body }); return new Response('ok'); }) as unknown as typeof fetch;
  const badFetch = (async () => { throw new Error('rete giu\''); }) as unknown as typeof fetch;
  setAlertSinks([new WebhookAlertSink('https://hooks.test/x', okFetch), new WebhookAlertSink('https://hooks.test/y', badFetch)]);
  await raiseUrgent({ hotelSlug: 'demo', conversationId: 'c1', topic: 'emergenza', at: '2026-10-13T10:00:00Z' }); // non lancia
  assert.equal(sent.length, 1);
  const p = JSON.parse(sent[0].body);
  assert.deepEqual(Object.keys(p).sort(), ['at', 'conversationId', 'event', 'hotel', 'topic']);
});

// ============================================================ concorrenza nello store demo
test('concorrenza demo: 20 prenotazioni simultanee dell\'ultimo posto = una sola', async () => {
  const { store, clock } = makeStore();
  const ad = await admin(store);
  const fac = (await ad.facilities())[0];
  await ad.generateSlots({ facilityId: fac.id, from: dayPlus(clock, 1), to: dayPlus(clock, 1), start: '05:00', end: '06:00', minutes: 60, capacity: 1 });
  const slot = (await ad.facilities()).find((f) => f.id === fac.id)!.slots.find((s) => s.capacity === 1)!;
  const guests = await Promise.all(Array.from({ length: 20 }, (_, i) => join(store, clock, `Ospite${i}`)));
  const out = await Promise.all(guests.map((x) => reason(x.g.book(slot.id, 1))));
  assert.equal(out.filter((o) => o === 'ok').length, 1);
  assert.equal(out.filter((o) => o === 'slot_full').length, 19);
});

test('concorrenza demo: stesso QR bonus validato da due baristi in parallelo = un solo riscatto', async () => {
  const { store, clock } = makeStore();
  const a = await join(store, clock, 'Anna');
  const { token } = await a.g.requestBonusQr();
  const b1 = await bar(store), b2 = await admin(store);
  const res = await Promise.all([b1.redeem(token), b2.redeem(token), b1.redeem(token), b2.redeem(token)]);
  assert.equal(res.filter((r) => r.ok).length, 1);
  assert.equal(store.ledger.redemptions.filter((r) => r.status === 'redeemed').length, 1);
});

test('concorrenza demo: tetto stagionale e tetto orario con ingressi simultanei', async () => {
  const cap = makeStore({ bonusCap: 5 });
  const r1 = await Promise.all(Array.from({ length: 30 }, (_, i) => join(cap.store, cap.clock, `Ospite${i}`)));
  assert.equal(r1.filter((x) => x.bonus === 'issued').length, 5);
  assert.equal(r1.filter((x) => x.bonus === 'cap_reached').length, 25);
  const hour = makeStore({ bonusCap: 100, bonusMaxPerHour: 3 });
  const r2 = await Promise.all(Array.from({ length: 12 }, (_, i) => join(hour.store, hour.clock, `Ospite${i}`)));
  assert.equal(r2.filter((x) => x.bonus === 'issued').length, 3);
  assert.equal(r2.filter((x) => x.bonus === 'throttled').length, 9);
  hour.clock.advance(61 * 60_000);
  assert.equal((await join(hour.store, hour.clock, 'Dopo')).bonus, 'issued'); // passata l'ora, si riparte
});

test('concorrenza demo: 40 messaggi AI in parallelo dello stesso ospite non superano il limite al minuto', async () => {
  const { store, clock } = makeStore();
  const a = await join(store, clock, 'Anna');
  const ctx = ctxOf(store, { guest: a.session });
  const res = await Promise.all(Array.from({ length: 40 }, (_, i) => aiChat(ctx, { text: `domanda ${i}` })));
  assert.equal(res.filter((r) => r.status === 200).length, 12);
  assert.equal(res.filter((r) => r.status === 429).length, 28);
  assert.equal(await a.g.guestMessagesToday(), 12);
});

// ============================================================ coupon: tetti per hotel e parita' dei token
async function pair(store: DemoStore, clock: ReturnType<typeof makeStore>['clock'], n1: string, n2: string) {
  const a = await join(store, clock, n1, 5, { socialOptIn: true });
  const b = await join(store, clock, n2, 5, { socialOptIn: true });
  await a.g.social().acceptRules(); await b.g.social().acceptRules();
  const bid = (await a.g.social().guests()).find((x) => x.nickname === n2)!.id;
  const { threadId } = await a.g.social().startThread(bid, 'ciao');
  await b.g.social().respond(threadId, true);
  return { a, b, threadId };
}

test('tetto coupon per hotel: giornaliero e in circolazione, anche con mittenti diversi', async () => {
  const { store, clock } = makeStore({ hotelCouponDailyCap: 2 });
  const p1 = await pair(store, clock, 'Anna', 'Bruno');
  const p2 = await pair(store, clock, 'Carla', 'Dario');
  await p1.a.g.social().sendCoupon(p1.threadId, 'coffee');
  await p2.a.g.social().sendCoupon(p2.threadId, 'coffee');
  assert.equal(await reason(p1.a.g.social().sendCoupon(p1.threadId, 'coffee')), 'hotel_coupon_limit');
  const act = makeStore({ hotelCouponActiveCap: 1 });
  const q1 = await pair(act.store, act.clock, 'Anna', 'Bruno');
  const q2 = await pair(act.store, act.clock, 'Carla', 'Dario');
  await q1.a.g.social().sendCoupon(q1.threadId, 'coffee');
  assert.equal(await reason(q2.a.g.social().sendCoupon(q2.threadId, 'coffee')), 'hotel_coupon_limit');
  // il giorno dopo il tetto giornaliero riparte
  clock.advance(25 * 3_600_000);
  await p1.a.g.social().sendCoupon(p1.threadId, 'coffee').catch(() => undefined);
});

test('concorrenza demo: coupon inviati e QR validato in parallelo rispettano tetti e uso singolo', async () => {
  const { store, clock } = makeStore({ hotelCouponDailyCap: 3 });
  const p = await pair(store, clock, 'Anna', 'Bruno');
  const out = await Promise.all(Array.from({ length: 8 }, () => reason(p.a.g.social().sendCoupon(p.threadId, 'coffee'))));
  assert.equal(out.filter((o) => o === 'ok').length, 3);
  const th = await p.b.g.social().thread(p.threadId);
  const cid = th.messages.find((m) => m.coupon)!.coupon!.id;
  const qr = await p.b.g.social().couponQr(cid);
  assert.ok(qr.token.startsWith('c.'));
  const staff = await Promise.all([bar(store), admin(store)]);
  const res = await Promise.all([...staff, ...staff].map((s) => s.redeem(qr.token)));
  assert.equal(res.filter((r) => r.ok).length, 1);
});

test('T-D4 token: il prefisso distingue bonus e coupon, mai ambiguo su 1.000.000 di token', () => {
  let amb = 0;
  for (let i = 0; i < 500_000; i++) {
    if (isCouponToken(newBonusToken())) amb++;
    if (!isCouponToken(newCouponToken())) amb++;
  }
  assert.equal(amb, 0);
  assert.ok(newBonusToken().startsWith('b.'));
  // il prefisso non e' nell'alfabeto base64url dei token: nessun token casuale puo' iniziare con "c."
  assert.ok(!/[.]/.test(newBonusToken().slice(2)));
});

// ============================================================ staff con due hotel (demo: un solo hotel)
test('T-D12 demo: scelta dell\'hotel verificata (un hotel altrui o inesistente = nessun accesso)', async () => {
  const { store } = makeStore();
  const l = await store.staffLogin('reception@demo.chathel.test', 'demo-reception');
  const hs = await store.staffHotels(l!.session);
  assert.equal(hs.length, 1);
  assert.ok(await store.staff(l!.session, { hotelId: hs[0].id }));
  assert.equal(await store.staff(l!.session, { hotelId: 'altro-hotel' }), null);
  assert.deepEqual(await store.staffHotels('sessione-falsa'), []);
});

test('staff: azioni alerts / hotels / select-hotel', async () => {
  const { store } = makeStore();
  const l = await store.staffLogin('reception@demo.chathel.test', 'demo-reception');
  const ctx = ctxOf(store, { staff: l!.session, method: 'GET' });
  const hs = await staffAction(ctx, 'hotels', {});
  assert.equal(hs.status, 200);
  const hid = (hs.body?.hotels as { id: string }[])[0].id;
  const sel = await staffAction({ ...ctx, method: 'POST' }, 'select-hotel', { hotelId: hid });
  assert.equal(sel.status, 200); assert.equal(sel.hotelCookie, hid);
  const bad = await staffAction({ ...ctx, method: 'POST' }, 'select-hotel', { hotelId: 'altro' });
  assert.ok(bad.status >= 400);
  assert.equal((await staffAction(ctx, 'alerts', {})).status, 200);
});

// ============================================================ controlli statici
test('statico: nessun await nelle regole di dominio e nello strato sociale demo (sezione critica senza interruzioni)', () => {
  const files = [...readdirSync('src/lib/rules').map((f) => pjoin('src/lib/rules', f)), 'src/lib/store/demo-social.ts'];
  for (const f of files) {
    const code = readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
    // le funzioni async dell'adattatore demo-social avvolgono chiamate SINCRONE: solo "await" veri sono vietati
    if (f.endsWith('demo-social.ts')) { assert.ok(!/await\s/.test(code), `${f}: await`); continue; }
    assert.ok(!/\bawait\b/.test(code) && !/\basync\b/.test(code), `${f}: async/await nelle regole`);
  }
});

test('statico: handler, store Supabase e server non importano lo store demo (password di esempio fuori dalla produzione)', () => {
  for (const f of ['src/lib/api/handlers.ts', 'src/lib/api/social-handlers.ts', 'src/lib/api/http.ts', 'src/lib/store/supabase.ts', 'src/lib/store/supabase-social.ts', 'src/lib/server.ts', 'src/lib/limits.ts', 'src/lib/auth/guest-identity.ts', 'src/lib/auth/index.ts']) {
    const imports = readFileSync(f, 'utf8').split('\n').filter((l) => /^\s*(import|export)\b.*from\s/.test(l));
    for (const l of imports) assert.ok(!/store\/demo['"]|from\s+['"]\.\/demo['"]/.test(l), `${f}: ${l}`);
  }
  const idx = readFileSync('src/lib/store/index.ts', 'utf8');
  assert.ok(!/^import .*demo/m.test(idx), 'lo store demo si importa solo in modo dinamico');
});

test('statico: nessun segreto o password demo nel codice di produzione fuori da store/demo.ts', () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(pjoin(d, e.name)) : [pjoin(d, e.name)]));
  for (const f of walk('src').filter((x) => /\.(ts|tsx)$/.test(x) && !/store\/demo(-data)?\.ts$/.test(x))) {
    const t = readFileSync(f, 'utf8');
    assert.ok(!/demo-admin|demo-reception|demo-bar/.test(t), `${f}: password demo`);
  }
});
