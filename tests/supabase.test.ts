// SupabaseStore contro PostgREST/GoTrue SIMULATI (tests/fake-supabase.ts). NON prova Supabase: prova la mappatura lato TypeScript
// (errori CHxxx, parametri delle RPC, tetto 1000 righe, staff su piu' hotel, idempotenza). Le RPC vere sono provate in supabase/tests (SQL).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseStore, raise } from '../src/lib/store/supabase';
import { FakeSupabase, SERVICE_KEY, ANON_KEY } from './fake-supabase';
import { encodeSession } from '../src/lib/session-format';
import { ChError } from '../src/lib/errors';

const ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'CHATHEL_DEMO'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.SUPABASE_URL = 'https://x.test'; process.env.SUPABASE_ANON_KEY = ANON_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
});
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; reason?: string; message?: string }) => (e?.code ? `${e.code}:${e.reason ?? e.message}` : `err:${e?.message}`));
const H1 = { id: 'h1', slug: 'uno', name: 'Uno', timezone: 'Europe/Rome', default_locale: 'it', bonus_label: 'x', bonus_value_cents: 500, bonus_season_cap: 30, bonus_funding: 'hotel', season_year: 2026 };
const H2 = { ...H1, id: 'h2', slug: 'due', name: 'Due' };

function staffDb() {
  const db = new FakeSupabase();
  db.seed('hotel_staff', [
    { id: 's1', user_id: 'u1', hotel_id: 'h1', role: 'hotel_admin', display_name: 'Dir', active: true },
    { id: 's2', user_id: 'u1', hotel_id: 'h2', role: 'reception', display_name: 'Rec', active: true },
    { id: 's3', user_id: 'u2', hotel_id: 'h1', role: 'bar', display_name: 'Bar', active: true },
  ]);
  db.joins['hotel_staff.hotels'] = (r) => (r.hotel_id === 'h1' ? H1 : H2);
  db.rls['hotel_staff'] = (r, who) => r.user_id === who.uid;
  db.tokens.set('tok-u1', 'u1'); db.tokens.set('tok-u2', 'u2');
  db.staffLogins.set('multi@x.test', { password: 'pw', uid: 'u1', access: 'tok-u1', refresh: 'r1' });
  return { db, store: new SupabaseStore({ createClient: db.createClient }) };
}
const sess = (a: string) => encodeSession({ a, r: 'r' });

test('T-D5 mappatura errori: CHxxx, 42501, 23514, 23505, sconosciuto', () => {
  const t = (c: string, m = 'm') => { try { raise({ code: c, message: m }); } catch (e) { return e as ChError & Error; } };
  assert.equal((t('CH001', 'cap_reached') as ChError).code, 'CH001');
  assert.equal((t('CH002', 'slot_full') as ChError).reason, 'slot_full');
  assert.equal((t('CH007', 'rate_limited') as ChError).code, 'CH007');
  assert.equal((t('42501') as ChError).code, 'CH004');
  assert.equal((t('23514') as ChError).reason, 'capacity_below_booked');
  assert.equal((t('23505') as ChError).code, 'CH005');
  assert.match((t('XX000') as Error).message, /db_error:XX000/);
});

test('T-D5 startStay: senza identita verificata = identity_required, nessuna chiamata al database', async () => {
  const { db, store } = staffDb();
  const base = { slug: 'uno', qrToken: 'q', locale: 'it' as const, checkout: '2026-10-20', isAdult: true, privacyVersion: 'v1' };
  assert.equal(await code(store.startStay(base as never)), 'CH004:identity_required');
  assert.equal(db.calls.filter((c) => c.name === 'start_stay').length, 0);
});

test('T-D5 startStay: RPC solo con service_role, opt-in solo se maggiorenne, chiave d\'identita in hex', async () => {
  const { db, store } = staffDb();
  db.rpcs.start_stay = () => ({ data: { bonus: 'issued' } });
  const base = { slug: 'uno', qrToken: 'q', locale: 'it' as const, checkout: '2026-10-20', privacyVersion: 'v1', authUserId: 'u9', identityCredential: 'cred', identityKey: 'ab12' };
  const r = await store.startStay({ ...base, isAdult: true, socialOptIn: true } as never);
  assert.equal(r.bonus, 'issued'); assert.equal(r.session, 'cred');
  const c = db.calls.find((x) => x.name === 'start_stay')!;
  assert.equal(c.role, 'service_role');
  assert.equal(c.args!.p_social_opt_in, true);
  assert.equal(c.args!.p_identity_key, '\\xab12');
  await store.startStay({ ...base, isAdult: false, socialOptIn: true } as never);
  assert.equal(db.calls.filter((x) => x.name === 'start_stay')[1].args!.p_social_opt_in, false, 'un minorenne non entra mai nel livello sociale');
  db.rpcs.start_stay = () => ({ error: { code: 'CH001', message: 'cap_reached' } });
  assert.equal(await code(store.startStay({ ...base, isAdult: true } as never)), 'CH001:cap_reached');
});

test('T-D12 staff su due hotel: elenco, scelta verificata, hotel di default', async () => {
  const { store } = staffDb();
  const s = sess('tok-u1');
  assert.deepEqual((await store.staffHotels(s)).map((h) => `${h.slug}:${h.role}`), ['uno:hotel_admin', 'due:reception']);
  assert.equal((await store.staff(s))!.info.hotel.id, 'h1');
  assert.equal((await store.staff(s, { hotelId: 'h2' }))!.info.role, 'reception');
  assert.equal(await store.staff(s, { hotelId: 'h-altrui' }), null, 'un hotel di cui non si e\' staff non si sceglie');
  assert.equal(await store.staff(sess('token-falso')), null);
  assert.deepEqual(await store.staffHotels(undefined), []);
});

test('T-D12 staff: i ruoli sono controllati anche lato applicazione (il barista non vede KPI ne\' coda)', async () => {
  const { store } = staffDb();
  const bar = (await store.staff(sess('tok-u2')))!;
  assert.equal(await code(bar.kpis('season')), 'CH004:forbidden');
  assert.equal(await code(bar.handoffQueue(false)), 'CH004:forbidden');
});

test('T-D12 scritture dello staff limitate all\'hotel scelto: 0 righe toccate = errore, non successo silenzioso', async () => {
  const { db, store } = staffDb();
  db.seed('events', [{ id: 'e-h2', hotel_id: 'h2' }]);
  db.seed('ai_conversations', [{ id: 'cv-h2', hotel_id: 'h2', status: 'open' }]);
  const api = (await store.staff(sess('tok-u1'), { hotelId: 'h1' }))!; // hotel_admin su h1
  assert.equal(await code(api.deleteEvent('e-h2')), 'CH003:not_found');
  assert.equal(await code(api.handoffClose('cv-h2')), 'CH003:not_found');
  assert.equal(db.table('events').length, 1, 'l\'evento dell\'altro hotel non e\' stato toccato');
  assert.equal(db.table('ai_conversations')[0].status, 'open');
});

test('T-D8 KPI: conteggi dal database, nessun taglio a 1000 righe', async () => {
  const { db, store } = staffDb();
  db.seed('ai_conversations', Array.from({ length: 1500 }, (_, i) => ({ id: `c${i}`, hotel_id: 'h1' })));
  db.rpcs.hotel_kpi_counts = (a, _w, d) => ({ data: { stays_started: 1500, conversations: d.table('ai_conversations').filter((r) => r.hotel_id === a.p_hotel).length, handoffs: 300, resolved_by_ai: 1200, ai_answers: 3000 } });
  const k = await (await store.staff(sess('tok-u1'), { hotelId: 'h1' }))!.kpis('season');
  assert.equal(k.i5.conversations, 1500);
  assert.equal(k.i5.handoffs, 300);
  assert.equal(k.i5.aiAnswers, 3000);
  assert.equal(k.i1.activated, 1500);
  // la lettura diretta della tabella sarebbe stata tagliata a 1000: e' il difetto che il conteggio SQL evita
  const direct = await db.createClient('u', SERVICE_KEY).from('ai_conversations').select('id');
  assert.equal(direct.data.length, 1000);
});

test('T-D5 redeem: il prefisso "c." va a redeem_coupon, il resto a redeem_bonus', async () => {
  const { db, store } = staffDb();
  db.rpcs.redeem_coupon = () => ({ data: { ok: true, coupon_kind: 'coffee', guest_name: 'Anna', from_name: 'Marco' } });
  db.rpcs.redeem_bonus = () => ({ data: { ok: false, reason: 'already_used', redeemed_at: '2026-10-13T10:00:00Z' } });
  const bar = (await store.staff(sess('tok-u2')))!;
  const c = await bar.redeem('c.abc');
  assert.deepEqual(c, { ok: true, kind: 'coupon', couponKind: 'coffee', guestName: 'Anna', fromName: 'Marco', label: 'coffee' });
  const b = await bar.redeem('b.abc');
  assert.equal(b.ok, false);
  assert.deepEqual(db.calls.filter((x) => x.kind === 'rpc').map((x) => x.name), ['redeem_coupon', 'redeem_bonus']);
});

test('limite di frequenza: RPC rate_limit_hit, e se il database non risponde ripiega sul contatore locale', async () => {
  const { db, store } = staffDb();
  db.rpcs.rate_limit_hit = (a) => ({ data: a.p_limit > 1 });
  assert.equal(await store.rateHit('k1', 5, 60_000), true);
  assert.equal(await store.rateHit('k1', 1, 60_000), false);
  assert.equal(db.calls.find((c) => c.name === 'rate_limit_hit')!.role, 'service_role');
  delete db.rpcs.rate_limit_hit; // funzione assente = errore
  const k = `fallback-${Math.random()}`;
  assert.equal(await store.rateHit(k, 1, 60_000), true);
  assert.equal(await store.rateHit(k, 1, 60_000), false, 'il ripiego locale conta comunque');
});

test('markWrong: solo messaggi assistant, idempotente (23505 ignorato); appendAssistantMessage solo sulla propria conversazione', async () => {
  const { db, store } = staffDb();
  db.seed('ai_messages', [{ id: 'm1', hotel_id: 'h1', role: 'assistant' }, { id: 'm2', hotel_id: 'h1', role: 'guest' }]);
  const rec = (await store.staff(sess('tok-u1'), { hotelId: 'h1' }))!;
  assert.equal(await code(rec.markWrong('m2')), 'CH003:invalid_message');
  db.rpcs['__insert:audit_log'] = () => ({});
  assert.equal(await code(rec.markWrong('m1')), 'ok');
  db.rpcs['__insert:audit_log'] = () => ({ error: { code: '23505', message: 'dup' } });
  assert.equal(await code(rec.markWrong('m1')), 'ok', 'seconda segnalazione: nessun errore');
  db.rpcs['__insert:audit_log'] = () => ({ error: { code: 'XX001', message: 'boom' } });
  assert.match(await code(rec.markWrong('m1')), /db_error/);
});
