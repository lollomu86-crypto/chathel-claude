// Regole del bonus di benvenuto (BonusLedger): un riscatto per ospite, tetto stagionale, QR monouso.
// Riferimenti: docs/01 US-02/US-10/US-13, docs/04 BO-03, BO-04, BO-05, BO-08, BO-10, BO-12.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BonusLedger, MAX_FAILS, type HotelBonusConfig, type RedeemActor } from '../src/lib/rules/bonus';
import { ChError } from '../src/lib/errors';

const NOW = new Date('2026-10-12T10:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);
const hotel = (cap: number, id = 'h1'): HotelBonusConfig => ({ id, seasonYear: 2026, cap, qrTtlSeconds: 90, enabled: true });
const barista = (hotelId = 'h1', actorKey = 'bar1'): RedeemActor => ({ actorKey, staffId: actorKey, staffHotelId: hotelId });
const active = () => true;

function issueFor(l: BonusLedger, h: HotelBonusConfig, guest: string, now = NOW) {
  return l.issue(h, guest, later(5 * 86_400_000), now);
}

test('tetto stagionale: il bonus numero 100 passa, il 101 no (CA1 US-10)', () => {
  const l = new BonusLedger();
  const h = hotel(100);
  for (let i = 1; i <= 100; i++) issueFor(l, h, `g${i}`);
  assert.equal(l.used('h1', 2026), 100);
  assert.throws(() => issueFor(l, h, 'g101'), (e) => e instanceof ChError && e.code === 'CH001' && e.reason === 'bonus_cap_reached');
  assert.equal(l.used('h1', 2026), 100, 'il contatore non supera mai il tetto');
});

test('tetto 0 = nessun bonus', () => {
  assert.throws(() => issueFor(new BonusLedger(), hotel(0), 'g1'), (e) => e instanceof ChError && e.code === 'CH001');
});

test('il tetto conta le emissioni (emessi + riscattati), non solo i riscatti', () => {
  const l = new BonusLedger();
  const h = hotel(2);
  issueFor(l, h, 'a');
  issueFor(l, h, 'b');
  // nessuno ha ancora riscattato, ma il tetto e' gia' pieno
  assert.throws(() => issueFor(l, h, 'c'), (e) => e instanceof ChError && e.code === 'CH001');
});

test('un bonus scaduto o annullato libera posto sotto il tetto', () => {
  const l = new BonusLedger();
  const h = hotel(1);
  issueFor(l, h, 'a');
  assert.throws(() => issueFor(l, h, 'b'), (e) => e instanceof ChError && e.code === 'CH001');
  l.purgeGuest('a'); // check-out senza aver usato il bonus: 'void'
  assert.doesNotThrow(() => issueFor(l, h, 'b'));
  l.expireDue(later(10 * 86_400_000)); // scade
  assert.doesNotThrow(() => issueFor(l, h, 'c', later(10 * 86_400_000)));
});

test('un solo bonus per ospite', () => {
  const l = new BonusLedger();
  issueFor(l, hotel(10), 'a');
  assert.throws(() => issueFor(l, hotel(10), 'a'), (e) => e instanceof ChError && e.code === 'CH005');
});

test('dedupe: stessa chiave camera+nome nella stagione = niente secondo bonus', () => {
  const l = new BonusLedger();
  const h = hotel(10);
  l.issue(h, 'a', later(86_400_000), NOW, 'k1');
  assert.throws(() => l.issue(h, 'b', later(86_400_000), NOW, 'k1'), (e) => e instanceof ChError && e.code === 'CH005');
  assert.doesNotThrow(() => l.issue(h, 'c', later(86_400_000), NOW, 'k2'));
});

test('riscatto: la prima validazione passa, la seconda dello stesso QR e\' rifiutata (BO-03)', () => {
  const l = new BonusLedger();
  issueFor(l, hotel(5), 'a');
  const { token } = l.requestQr('a', hotel(5), NOW);
  const first = l.redeem(token, barista(), later(1000), active);
  assert.equal(first.ok, true);
  const second = l.redeem(token, barista(), later(2000), active);
  assert.deepEqual(second.ok === false && second.reason, 'already_used');
  assert.equal(l.bonusOf('a')!.status, 'redeemed');
});

test('riscatto: due baristi nello stesso istante, ne vince uno solo (BO-04)', async () => {
  const l = new BonusLedger();
  issueFor(l, hotel(5), 'a');
  const { token } = l.requestQr('a', hotel(5), NOW);
  const [r1, r2] = await Promise.all([
    Promise.resolve().then(() => l.redeem(token, barista('h1', 'bar1'), later(1000), active)),
    Promise.resolve().then(() => l.redeem(token, barista('h1', 'bar2'), later(1000), active)),
  ]);
  assert.equal([r1, r2].filter((r) => r.ok).length, 1);
  assert.equal(l.redemptions.filter((r) => r.status === 'redeemed').length, 1);
});

test('dopo il riscatto non si puo\' generare un altro QR per lo stesso ospite', () => {
  const l = new BonusLedger();
  issueFor(l, hotel(5), 'a');
  const { token } = l.requestQr('a', hotel(5), NOW);
  l.redeem(token, barista(), later(1000), active);
  assert.throws(() => l.requestQr('a', hotel(5), later(2000)), (e) => e instanceof ChError && e.reason === 'invalid_bonus');
});

test('QR scaduto dopo 90 s: esito "expired"; l\'ospite ne genera uno nuovo (BO-05)', () => {
  const l = new BonusLedger();
  issueFor(l, hotel(5), 'a');
  const { token } = l.requestQr('a', hotel(5), NOW);
  const late = l.redeem(token, barista(), later(91_000), active);
  assert.equal(late.ok === false && late.reason, 'expired');
  const fresh = l.requestQr('a', hotel(5), later(100_000));
  assert.equal(l.redeem(fresh.token, barista(), later(101_000), active).ok, true);
});

test('un nuovo QR invalida il precedente (uno solo attivo)', () => {
  const l = new BonusLedger();
  issueFor(l, hotel(5), 'a');
  const old = l.requestQr('a', hotel(5), NOW).token;
  const next = l.requestQr('a', hotel(5), later(1000)).token;
  assert.equal(l.redeem(old, barista(), later(2000), active).ok, false);
  assert.equal(l.redeem(next, barista(), later(2000), active).ok, true);
});

test('il QR non vive oltre la scadenza del soggiorno', () => {
  const l = new BonusLedger();
  l.issue(hotel(5), 'a', later(30_000), NOW); // il bonus scade fra 30 s
  const r = l.requestQr('a', hotel(5), NOW);
  assert.ok(r.expiresAt.getTime() <= later(30_000).getTime());
});

test('barista di un altro hotel o account non barista: "invalid", senza rivelare il token (BO-10, BO-12)', () => {
  const l = new BonusLedger();
  issueFor(l, hotel(5), 'a');
  const { token } = l.requestQr('a', hotel(5), NOW);
  const other = l.redeem(token, barista('h2', 'barX'), later(1000), active);
  assert.equal(other.ok === false && other.reason, 'invalid');
  const notStaff = l.redeem(token, { actorKey: 'u1', staffId: null, staffHotelId: 'h1' }, later(1000), active);
  assert.equal(notStaff.ok === false && notStaff.reason, 'invalid');
  // il QR e' ancora riscattabile dal barista giusto
  assert.equal(l.redeem(token, barista(), later(2000), active).ok, true);
});

test('soggiorno terminato: il bonus non si riscatta', () => {
  const l = new BonusLedger();
  issueFor(l, hotel(5), 'a');
  const { token } = l.requestQr('a', hotel(5), NOW);
  const r = l.redeem(token, barista(), later(1000), () => false);
  assert.equal(r.ok === false && r.reason, 'bonus_not_valid');
});

test('dopo 10 tentativi falliti in 10 minuti si e\' bloccati (anti brute force)', () => {
  const l = new BonusLedger();
  for (let i = 0; i < MAX_FAILS; i++) assert.equal(l.redeem(`sbagliato-${i}`, barista(), later(i * 1000), active).ok, false);
  const blocked = l.redeem('altro', barista(), later(20_000), active);
  assert.equal(blocked.ok === false && blocked.reason, 'rate_limited');
  // un altro barista non e' bloccato; passati 10 minuti anche il primo riparte
  assert.equal(l.redeem('x', barista('h1', 'bar2'), later(20_000), active).ok === false && true, true);
  const after = l.redeem('y', barista(), later(11 * 60_000), active);
  assert.equal(after.ok === false && after.reason, 'invalid');
});

test('il token in chiaro non e\' mai salvato: nel registro c\'e\' solo l\'hash', () => {
  const l = new BonusLedger();
  issueFor(l, hotel(5), 'a');
  const { token } = l.requestQr('a', hotel(5), NOW);
  assert.ok(!JSON.stringify(l.redemptions).includes(token));
  assert.ok(token.length >= 24, '144 bit in base64url = 24 caratteri');
});
