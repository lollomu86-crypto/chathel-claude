import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, join, bar, admin, reception, HOUR, MIN } from './helpers';

async function qrToken(g: Awaited<ReturnType<typeof join>>['g']) {
  return (await g.requestBonusQr()).token;
}

test(`demo: onboarding emette il bonus e il QR monouso e' riscattabile solo una volta`, async () => {
  const { store, clock } = makeStore();
  const { g } = await join(store, clock, 'Anna');
  const b = await bar(store);
  const tok = await qrToken(g);
  const r1 = await b.redeem(tok);
  assert.equal(r1.ok, true);
  const r2 = await b.redeem(tok);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.reason, 'already_used');
  assert.equal((await g.bonus()).state, 'redeemed');
});

test('demo: il QR scade dopo il TTL', async () => {
  const { store, clock } = makeStore();
  const { g } = await join(store, clock, 'Bea');
  const b = await bar(store);
  const tok = await qrToken(g);
  clock.advance(5 * MIN);
  const r = await b.redeem(tok);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'expired');
});

test('demo: token inventato rifiutato; troppi tentativi falliti limitano il barista', async () => {
  const { store } = makeStore();
  const b = await bar(store);
  let last: any;
  for (let i = 0; i < 12; i++) last = await b.redeem('x'.repeat(24) + i);
  assert.equal(last.ok, false);
  assert.equal(last.reason, 'rate_limited');
});

test(`demo: la reception non puo' validare bonus (ruolo)`, async () => {
  const { store, clock } = makeStore();
  const { g } = await join(store, clock, 'Carla');
  const rec = await reception(store);
  const tok = await qrToken(g);
  const r = await rec.redeem(tok);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'invalid');
  assert.equal((await g.bonus()).state !== 'redeemed', true);
});

test('demo: prenotazione slot con controllo capienza', async () => {
  const { store, clock } = makeStore();
  const a = await join(store, clock, 'Anna');
  const facs = await a.g.facilities();
  const slot = facs.flatMap((f) => f.slots).find((s) => new Date(s.startsAt).getTime() > clock.now().getTime() + 3 * HOUR && s.booked < s.capacity)!;
  assert.ok(slot);
  await a.g.book(slot.id, 1);
  const mine = await a.g.myBookings();
  assert.equal(mine.length, 1);
  await assert.rejects(() => a.g.book(slot.id, 1)); // seconda prenotazione identica
  await a.g.cancelBooking(mine[0].id);
});

test('privacy: la vista ospite non espone liste di altri ospiti, solo conteggi', async () => {
  const { store, clock } = makeStore();
  const a = await join(store, clock, 'SegretoNome');
  const c = await join(store, clock, 'Altro');
  const ev = (await a.g.events())[0];
  await a.g.rsvp(ev.id, true);
  const evC = (await c.g.events()).find((e) => e.id === ev.id)!;
  const dump = JSON.stringify([await c.g.events(), await c.g.facilities(), await c.g.notifications(), await c.g.chat()]);
  assert.ok(!dump.includes('SegretoNome'));
  assert.ok(evC.goingCount === null || typeof evC.goingCount === 'number');
});

test(`privacy: dopo "esci e cancella" la sessione non e' piu' valida e i dati sono rimossi`, async () => {
  const { store, clock } = makeStore();
  const { session, g } = await join(store, clock, 'Dora');
  await g.endMyStay();
  assert.equal(await store.guest(session), null);
});

test('admin: KPI coerenti con i dati (attivati, emessi, riscattati)', async () => {
  const { store, clock } = makeStore();
  const x = await join(store, clock, 'Uno');
  await join(store, clock, 'Due');
  const b = await bar(store);
  await b.redeem(await qrToken(x.g));
  const a = await admin(store);
  const k = await a.kpis('season');
  assert.equal(k.i2.redeemed, 1);
  assert.ok(k.i2.issued >= 1);
  assert.ok(k.i1.activated >= 2);
});

test('admin: limite di 2 avvisi al giorno', async () => {
  const { store } = makeStore();
  const a = await admin(store);
  const n = { title: { it: 'Avviso' } };
  await a.publishNotification(n);
  await a.publishNotification(n);
  await assert.rejects(() => a.publishNotification(n));
  assert.equal(await a.notificationsLeftToday(), 0);
});

test(`admin: il passaggio all'operatore compare in coda`, async () => {
  const { store, clock } = makeStore();
  const { g } = await join(store, clock, 'Elena');
  const { conversationId } = await g.appendGuestMessage('voglio parlare con una persona');
  await g.appendAssistantMessage(conversationId, { text: 'ok', handoff: { reason: 'guest_request', topic: 'richiesta operatore' } });
  const rec = await reception(store);
  const q = await rec.handoffQueue(false);
  assert.equal(q.length, 1);
  await rec.handoffReply(conversationId, 'Arrivo');
  await rec.handoffClose(conversationId);
  assert.equal((await rec.handoffQueue(false)).length, 0);
  void HOUR;
});
