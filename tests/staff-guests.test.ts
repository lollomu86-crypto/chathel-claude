import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, join, admin, reception, bar, MIN, HOUR } from './helpers';

test('ospiti: direttore e reception vedono nome, soggiorno, prenotazioni, eventi e bonus; il barista no', async () => {
  const { store, clock } = makeStore();
  const anna = await join(store, clock, 'Anna Rossi');
  await join(store, clock, 'Bruno');
  const fac = (await anna.g.facilities())[0];
  const slot = fac.slots.find((s) => s.capacity - s.booked >= 2)!;
  await anna.g.book(slot.id, 2);
  const ev = (await anna.g.events())[0];
  await anna.g.rsvp(ev.id, true);

  const list = await (await reception(store)).guests();
  assert.deepEqual(list.map((g) => g.name), ['Anna', 'Bruno']); // solo il nome di battesimo, in ordine
  const a = list[0];
  assert.equal(a.bookings.length, 1);
  assert.equal(a.bookings[0].slotId, slot.id);
  assert.equal(a.bookings[0].party, 2);
  assert.equal(a.events[0].id, ev.id);
  assert.equal(a.bonus?.status, 'issued');
  assert.ok(a.lastSeenAt, 'ultimo accesso registrato');
  // nessun campo oltre a quelli previsti: niente e-mail, id Google, chat o contatti
  assert.deepEqual(Object.keys(a).sort(), ['arrivedAt', 'bonus', 'bookings', 'events', 'expiresAt', 'id', 'lastSeenAt', 'locale', 'name']);
  assert.equal((await (await admin(store)).guests()).length, 2);
  await assert.rejects((await bar(store)).guests(), { reason: 'forbidden' });
});

test('ospiti: ultimo accesso scritto al massimo ogni 10 minuti; chi cancella i dati sparisce dall\'elenco', async () => {
  const { store, clock } = makeStore();
  const anna = await join(store, clock, 'Anna');
  const first = (await (await reception(store)).guests())[0].lastSeenAt;
  clock.advance(5 * MIN);
  await store.guest(anna.session);
  assert.equal((await (await reception(store)).guests())[0].lastSeenAt, first, 'entro 10 minuti non cambia');
  clock.advance(6 * MIN);
  await store.guest(anna.session);
  assert.notEqual((await (await reception(store)).guests())[0].lastSeenAt, first);
  clock.advance(HOUR);
  await anna.g.endMyStay();
  assert.equal((await (await reception(store)).guests()).length, 0);
});
