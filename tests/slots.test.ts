// Prenotazione slot con capienza (SlotBook): niente overbooking, regole di business, fuso orario.
// Riferimenti: docs/01 US-06, docs/04 PR-02..PR-13.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SlotBook, type BookingPolicy } from '../src/lib/rules/slots';
import { ChError } from '../src/lib/errors';
import { zonedTime } from '../src/lib/time';

const NOW = new Date('2026-10-12T10:00:00Z');
const policy: BookingPolicy = { maxPerGuestDay: 2, cancelCutoffMinutes: 60, timezone: 'Europe/Rome' };
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const code = (e: unknown) => (e instanceof ChError ? e.reason : 'altro');

function slotOf(b: SlotBook, capacity: number, startH = 5, hotelId = 'h1', facility = 'spa') {
  b.addSlot({ id: `s-${facility}-${startH}-${hotelId}`, hotelId, facilityId: facility, startsAt: at(startH), endsAt: at(startH + 1), capacity });
  return `s-${facility}-${startH}-${hotelId}`;
}

test('capienza 10: dieci prenotazioni, l\'undicesima e\' rifiutata (PR-02)', () => {
  const b = new SlotBook();
  const s = slotOf(b, 10);
  for (let i = 1; i <= 10; i++) b.book('h1', `g${i}`, s, 1, policy, NOW);
  assert.equal(b.seatsBooked(s), 10);
  assert.throws(() => b.book('h1', 'g11', s, 1, policy, NOW), (e) => code(e) === 'slot_full');
  assert.equal(b.seatsBooked(s), 10);
});

test('50 richieste in parallelo su 10 posti: esattamente 10 confermate (PR-03)', async () => {
  const b = new SlotBook();
  const s = slotOf(b, 10);
  const results = await Promise.allSettled(
    Array.from({ length: 50 }, (_, i) => Promise.resolve().then(() => b.book('h1', `g${i}`, s, 1, policy, NOW))),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 10);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 40);
  assert.equal(b.seatsBooked(s), 10);
  assert.equal(b.bookings.filter((x) => x.status === 'confirmed').length, 10);
});

test('due ospiti sull\'ultimo posto: ne riesce uno solo (CA1 US-06)', async () => {
  const b = new SlotBook();
  const s = slotOf(b, 1);
  const r = await Promise.allSettled(['a', 'b'].map((g) => Promise.resolve().then(() => b.book('h1', g, s, 1, policy, NOW))));
  assert.deepEqual(r.map((x) => x.status).sort(), ['fulfilled', 'rejected']);
});

test('gruppo di 4 con 3 posti liberi: rifiutato per intero, nessuna conferma parziale (PR-04)', () => {
  const b = new SlotBook();
  const s = slotOf(b, 5);
  b.book('h1', 'a', s, 2, policy, NOW);
  assert.throws(() => b.book('h1', 'b', s, 4, policy, NOW), (e) => code(e) === 'slot_full');
  assert.equal(b.seatsBooked(s), 2);
  assert.equal(b.bookings.length, 1);
});

test('annullo libera i posti; il doppio annullo non li libera due volte (PR-05, PR-06)', () => {
  const b = new SlotBook();
  const s = slotOf(b, 3, 6);
  const k = b.book('h1', 'a', s, 2, policy, NOW);
  b.cancel('a', k.id, policy, NOW);
  assert.equal(b.seatsBooked(s), 0);
  assert.throws(() => b.cancel('a', k.id, policy, NOW), (e) => code(e) === 'invalid_booking');
  assert.equal(b.seatsBooked(s), 0, 'mai sotto zero');
  // i posti liberati sono riprenotabili
  assert.doesNotThrow(() => b.book('h1', 'b', s, 3, policy, NOW));
});

test('annullo oltre la soglia (60 min prima): "too_late"; un altro ospite non puo\' annullare (PR)', () => {
  const b = new SlotBook();
  const s = slotOf(b, 3, 5); // fra 5 ore
  const k = b.book('h1', 'a', s, 1, policy, NOW);
  assert.throws(() => b.cancel('b', k.id, policy, NOW), (e) => code(e) === 'invalid_booking');
  const nearly = new Date(NOW.getTime() + 4.5 * 3_600_000 + 1);
  assert.throws(() => b.cancel('a', k.id, policy, nearly), (e) => code(e) === 'too_late');
  assert.equal(b.seatsBooked(s), 1);
});

test('slot nel passato, chiuso o di un altro hotel: rifiutati (PR-07, PR-13)', () => {
  const b = new SlotBook();
  const past = slotOf(b, 3, -2);
  const closed = slotOf(b, 3, 7);
  b.setStatus(closed, 'closed');
  const other = slotOf(b, 3, 8, 'h2');
  for (const s of [past, closed, other]) assert.throws(() => b.book('h1', 'a', s, 1, policy, NOW), (e) => code(e) === 'slot_unavailable');
});

test('limite giornaliero per ospite e doppia prenotazione dello stesso slot (PR-09)', () => {
  const b = new SlotBook();
  const s1 = slotOf(b, 5, 3);
  const s2 = slotOf(b, 5, 4);
  const s3 = slotOf(b, 5, 5);
  b.book('h1', 'a', s1, 1, policy, NOW);
  assert.throws(() => b.book('h1', 'a', s1, 1, policy, NOW), (e) => code(e) === 'already_booked');
  b.book('h1', 'a', s2, 1, policy, NOW);
  assert.throws(() => b.book('h1', 'a', s3, 1, policy, NOW), (e) => code(e) === 'daily_limit');
});

test('numero di persone fuori da 1-10: rifiutato', () => {
  const b = new SlotBook();
  const s = slotOf(b, 50);
  for (const n of [0, 11, -1, 1.5]) assert.throws(() => b.book('h1', 'a', s, n, policy, NOW), (e) => code(e) === 'invalid_party_size');
});

test('la capienza non scende sotto i posti gia\' prenotati (CHECK slots_no_overbooking, PR-10)', () => {
  const b = new SlotBook();
  const s = slotOf(b, 5);
  b.book('h1', 'a', s, 3, policy, NOW);
  assert.throws(() => b.setCapacity(s, 2), (e) => code(e) === 'capacity_below_booked');
  assert.doesNotThrow(() => b.setCapacity(s, 3));
});

test('check-out: le prenotazioni future si annullano e la capienza torna libera (PR-15)', () => {
  const b = new SlotBook();
  const s = slotOf(b, 4);
  b.book('h1', 'a', s, 2, policy, NOW);
  b.purgeGuest('a', NOW);
  assert.equal(b.seatsBooked(s), 0);
  assert.ok(b.bookings.every((x) => x.guestId === null), 'le righe restano solo in forma anonima');
});

test('generazione slot idempotente: (servizio, orario) gia\' presente non si duplica', () => {
  const b = new SlotBook();
  const mk = () => b.addSlot({ hotelId: 'h1', facilityId: 'spa', startsAt: at(5), endsAt: at(6), capacity: 4 });
  assert.equal(mk(), true);
  assert.equal(mk(), false);
  assert.equal(b.slots.size, 1);
});

test('fuso orario e ora legale: Roma 12:00 e\' 10:00Z in ottobre (CEST) e 11:00Z dopo il cambio (CET) (PR-12)', () => {
  assert.equal(zonedTime('2026-10-24', '12:00', 'Europe/Rome').toISOString(), '2026-10-24T10:00:00.000Z');
  assert.equal(zonedTime('2026-10-25', '12:00', 'Europe/Rome').toISOString(), '2026-10-25T11:00:00.000Z');
  assert.equal(zonedTime('2027-03-28', '12:00', 'Europe/Rome').toISOString(), '2027-03-28T10:00:00.000Z');
  assert.equal(zonedTime('2027-03-27', '12:00', 'Europe/Rome').toISOString(), '2027-03-27T11:00:00.000Z');
});
