import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, makeClock, join, demoIdentity, bar, admin, reception, dayPlus, DAY, HOUR, MIN } from './helpers';
import { DemoStore } from '../src/lib/store/demo';
import { SocialHub, SOCIAL_LIMITS, checkMessage, defaultNickname, normalizeText, sanitizeNickname } from '../src/lib/rules/social';
import { CouponLedger } from '../src/lib/rules/coupons';
import { guestAction, staffAction, type Ctx } from '../src/lib/api/handlers';
import { _resetForTests } from '../src/lib/ratelimit';

type J = Awaited<ReturnType<typeof join>>;

/** Ospite che si registra con la scelta sociale indicata. */
async function guest(store: DemoStore, clock: ReturnType<typeof makeClock>, name: string, opts: { optIn?: boolean; adult?: boolean; days?: number } = {}) {
  const r = await store.startStay({ slug: 'demo', qrToken: 'demo-qr-token', identity: demoIdentity(name), locale: 'it', checkout: dayPlus(clock, opts.days ?? 5), isAdult: opts.adult ?? true, socialOptIn: opts.optIn ?? false });
  const g = await store.guest(r.session);
  if (!g) throw new Error('guest api mancante');
  return { session: r.session, g, s: g.social() };
}
/** Ospite visibile con regole accettate. */
async function member(store: DemoStore, clock: ReturnType<typeof makeClock>, name: string, days = 5) {
  const x = await guest(store, clock, name, { optIn: true, days });
  await x.s.acceptRules();
  const me = await x.s.settings();
  return { ...x, id: me.id };
}
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { reason?: string }) => e?.reason ?? 'error');

// ---------------------------------------------------------------- funzioni pure
test('rules: messaggio max 280 caratteri (per punti di codice), vuoto rifiutato, caratteri di controllo tolti', () => {
  assert.equal(checkMessage('a'.repeat(280)).length, 280);
  assert.throws(() => checkMessage('a'.repeat(281)), { reason: 'too_long' });
  assert.equal([...checkMessage('😀'.repeat(280))].length, 280); // 280 emoji = 560 unita' UTF-16, ma 280 caratteri
  assert.throws(() => checkMessage('😀'.repeat(281)), { reason: 'too_long' });
  assert.throws(() => checkMessage('  ​ \n '), { reason: 'invalid_message' });
  assert.equal(normalizeText('ci\u0000ao‮'), 'ciao');
});

test('rules: nickname — solo nome di battesimo di default, rifiuta contatti e numeri', () => {
  assert.equal(defaultNickname('Mario Rossi'), 'Mario');
  assert.equal(defaultNickname('1234567'), 'Ospite');
  assert.equal(sanitizeNickname('Anna-Lisa'), 'Anna-Lisa');
  assert.equal(sanitizeNickname('a'), null);
  assert.equal(sanitizeNickname('x'.repeat(21)), null);
  assert.equal(sanitizeNickname('mario@mail.it'), null);
  assert.equal(sanitizeNickname('www.sito'), null);
  assert.equal(sanitizeNickname('camera 12345'), null);
  assert.equal(sanitizeNickname('12'), null); // niente lettere
});

// ---------------------------------------------------------------- visibilita' e maggiorenni
test('elenco: compare solo chi sceglie di comparire; chi non ha scelto non vede neppure l\'elenco', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await guest(store, clock, 'Bruno', { optIn: false });
  const c = await member(store, clock, 'Carla');

  assert.deepEqual((await a.s.guests()).map((x) => x.nickname), ['Carla']); // Bruno non c'e'
  assert.equal(await code(b.s.guests()), 'social_opt_in_required'); // reciprocita'
  assert.equal(await code(b.s.publicFeed()), 'social_opt_in_required');
  assert.equal(await code(b.s.postPublic('ciao')), 'social_opt_in_required');

  // opt-in modificabile in ogni momento
  await b.s.updateSettings({ visible: true });
  assert.deepEqual((await a.s.guests()).map((x) => x.nickname), ['Bruno', 'Carla']);
  await c.s.updateSettings({ visible: false });
  assert.deepEqual((await a.s.guests()).map((x) => x.nickname), ['Bruno']);
  assert.equal(await code(c.s.guests()), 'social_opt_in_required');
});

test('elenco: espone solo id casuale, nickname, lingua; mai cognome, camera, ne\' l\'id interno', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const m = await guest(store, clock, 'Mario Rossi', { optIn: true });
  await m.s.acceptRules();
  const list = await a.s.guests();
  assert.deepEqual(Object.keys(list[0]).sort(), ['canMessage', 'id', 'locale', 'nickname']);
  assert.equal(list[0].nickname, 'Mario');
  const dump = JSON.stringify([list, await a.s.publicFeed(), await a.s.threads(), await m.s.settings()]);
  assert.ok(!dump.includes('Rossi'));
  for (const gid of store.guests.keys()) assert.ok(!dump.includes(gid), 'id interno ospite esposto');
  // nemmeno la data di partenza o la camera
  assert.ok(!/checkout|expires|room|camera|stay/i.test(JSON.stringify(list)));
});

test('minorenni: non compaiono, non entrano nelle funzioni sociali, non possono attivarle', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const kid = await guest(store, clock, 'Teo', { optIn: true, adult: false });
  assert.deepEqual(await a.s.guests(), []);
  const st = await kid.s.settings();
  assert.equal(st.visible, false);
  assert.equal(st.isAdult, false);
  assert.equal(await code(kid.s.updateSettings({ visible: true })), 'adult_required');
  assert.equal(await code(kid.s.guests()), 'adult_required');
  assert.equal(await code(kid.s.postPublic('ciao')), 'adult_required');
  assert.equal(await code(kid.s.acceptRules()), 'adult_required');
  // e non si puo' scrivere a un minorenne anche conoscendone l'id
  assert.equal(await code(a.s.startThread(st.id, 'ciao')), 'recipient_unavailable');
});

// ---------------------------------------------------------------- chat pubblica
test('chat pubblica: regole d\'uso da accettare prima della prima scrittura', async () => {
  const { store, clock } = makeStore();
  const a = await guest(store, clock, 'Anna', { optIn: true });
  assert.equal((await a.s.settings()).rulesAccepted, false);
  assert.equal(await code(a.s.postPublic('ciao')), 'rules_required');
  await a.s.acceptRules();
  assert.equal(await code(a.s.postPublic('ciao')), 'ok');
  assert.equal((await a.s.publicFeed()).length, 1);
});

test('chat pubblica: max 280 caratteri e limite di frequenza (5 al minuto, poi riprende)', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  assert.equal(await code(a.s.postPublic('x'.repeat(281))), 'too_long');
  assert.equal(await code(a.s.postPublic('x'.repeat(280))), 'ok');
  for (let i = 0; i < SOCIAL_LIMITS.publicPerWindow - 1; i++) assert.equal(await code(a.s.postPublic(`m${i}`)), 'ok');
  assert.equal(await code(a.s.postPublic('troppi')), 'rate_limited');
  clock.advance(61_000);
  assert.equal(await code(a.s.postPublic('di nuovo')), 'ok');
});

test('chat pubblica: tetto giornaliero per ospite', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  let rejected = '';
  for (let i = 0; i < SOCIAL_LIMITS.publicPerDay + 1; i++) {
    clock.advance(20_000); // sotto il limite al minuto
    const r = await code(a.s.postPublic(`m${i}`));
    if (r !== 'ok') { rejected = r; break; }
  }
  assert.equal(rejected, 'daily_limit');
});

test('chat pubblica: una per struttura, gli ospiti vedono i messaggi degli altri; segnalare il proprio non si puo\'', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const m = await a.s.postPublic('Qualcuno per il tennis?');
  const feed = await b.s.publicFeed();
  assert.equal(feed[0].text, 'Qualcuno per il tennis?');
  assert.equal(feed[0].nickname, 'Anna');
  assert.equal(feed[0].mine, false);
  assert.equal(await code(a.s.reportPublic(m.id, 'spam')), 'invalid_message');
});

// ---------------------------------------------------------------- segnalazioni e moderazione
test('moderazione: segnalazione -> coda; nascondere il messaggio lo toglie dalla chat e chiude la segnalazione', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const m = await a.s.postPublic('messaggio offensivo');
  await b.s.reportPublic(m.id, 'harassment');
  await b.s.reportPublic(m.id, 'harassment'); // idempotente
  const rec = await reception(store);
  let q = await rec.social().reports(false);
  assert.equal(q.length, 1);
  assert.equal(q[0].kind, 'public');
  assert.equal(q[0].reporter, 'Bruno');
  assert.equal(q[0].reported.nickname, 'Anna');
  assert.equal(q[0].excerpt[0].text, 'messaggio offensivo');
  assert.equal((await b.s.publicFeed())[0].reportedByMe, true);

  await rec.social().hideMessage(m.id, true);
  assert.deepEqual(await b.s.publicFeed(), []);
  assert.deepEqual(await a.s.publicFeed(), []);
  assert.equal((await rec.social().reports(false)).length, 0);
  const closed = await rec.social().reports(true);
  assert.equal(closed[0].status, 'actioned');
  assert.equal((await rec.social().publicFeed())[0].hidden, true); // l'hotel lo vede ancora (con l'indicazione)
  await rec.social().hideMessage(m.id, false);
  assert.equal((await b.s.publicFeed()).length, 1);
});

test('moderazione: silenziare un ospite gli impedisce di scrivere (pubblico e privato) finche\' non viene riattivato', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const { threadId } = await a.s.startThread(b.id, 'ciao');
  await b.s.respond(threadId, true);
  const adm = await admin(store);

  await adm.social().muteGuest(a.id, true, 30);
  assert.equal((await a.s.settings()).muted, true);
  assert.equal(await code(a.s.postPublic('ciao a tutti')), 'muted');
  assert.equal(await code(a.s.sendPrivate(threadId, 'ciao')), 'muted');
  assert.equal(await code(a.s.startThread((await member(store, clock, 'Dario')).id, 'ciao')), 'muted');
  assert.equal(await code(b.s.sendPrivate(threadId, 'rispondo')), 'ok'); // gli altri possono ancora scrivergli
  clock.advance(31 * MIN);
  assert.equal((await a.s.settings()).muted, false);
  assert.equal(await code(a.s.postPublic('sono tornata')), 'ok');

  // silenzio "fino al check-out" (senza durata)
  await adm.social().muteGuest(a.id, true);
  clock.advance(2 * DAY);
  assert.equal(await code(a.s.postPublic('ancora')), 'muted');
  await adm.social().muteGuest(a.id, false);
  assert.equal(await code(a.s.postPublic('libera')), 'ok');
});

test('moderazione: rimuovere un ospite lo toglie da elenco e funzioni sociali e non puo\' rientrare da solo', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const rec = await reception(store);
  await rec.social().removeGuest(a.id, true);
  assert.deepEqual((await b.s.guests()).map((x) => x.nickname), []);
  assert.equal(await code(a.s.postPublic('ciao')), 'social_removed');
  assert.equal(await code(a.s.guests()), 'social_removed');
  assert.equal(await code(a.s.updateSettings({ visible: true })), 'social_removed');
  assert.equal(await code(b.s.startThread(a.id, 'ciao')), 'recipient_unavailable');
  await rec.social().removeGuest(a.id, false);
  await a.s.updateSettings({ visible: true });
  assert.equal(await code(a.s.postPublic('ciao')), 'ok');
});

test('moderazione: solo reception e direttore; il barista no; un ospite non puo\' chiamare le API staff', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const m = await a.s.postPublic('x');
  const b = await bar(store);
  await assert.rejects(() => b.social().reports(false), { reason: 'forbidden' });
  await assert.rejects(() => b.social().hideMessage(m.id, true), { reason: 'forbidden' });
  await assert.rejects(() => b.social().stats('7d'), { reason: 'forbidden' });
  assert.equal((await (await reception(store)).social().publicFeed()).length, 1);
  assert.equal((await (await admin(store)).social().stats('7d')).publicMessages, 1);
});

// ---------------------------------------------------------------- chat privata
test('privata: il primo messaggio e\' una richiesta; il mittente non puo\' insistere finche\' non viene accettata', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const { threadId } = await a.s.startThread(b.id, 'Ciao Bruno, un aperitivo?');
  assert.equal(await code(a.s.sendPrivate(threadId, 'rispondi!')), 'thread_not_open');
  assert.equal(await code(a.s.startThread(b.id, 'ancora')), 'thread_exists');

  const inbox = await b.s.threads();
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].incoming, true);
  assert.equal(inbox[0].status, 'pending');
  const detail = await b.s.thread(threadId);
  assert.equal(detail.canRespond, true);
  assert.equal(detail.canSend, false);
  assert.equal(detail.messages[0].text, 'Ciao Bruno, un aperitivo?');
  assert.equal(await code(b.s.sendPrivate(threadId, 'rispondo senza accettare')), 'thread_not_open');
  assert.equal(await code(a.s.respond(threadId, true)), 'forbidden'); // non puo' accettarsi da solo
});

test('privata: richiesta accettata -> conversazione a due; terzi non vedono nulla', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const c = await member(store, clock, 'Carla');
  const { threadId } = await a.s.startThread(b.id, 'ciao');
  await b.s.respond(threadId, true);
  assert.equal(await code(b.s.respond(threadId, true)), 'thread_not_pending');
  assert.equal(await code(b.s.sendPrivate(threadId, 'Volentieri!')), 'ok');
  assert.equal(await code(a.s.sendPrivate(threadId, 'Alle sette?')), 'ok');
  const d = await a.s.thread(threadId);
  assert.deepEqual(d.messages.map((m) => [m.mine, m.text]), [[true, 'ciao'], [false, 'Volentieri!'], [true, 'Alle sette?']]);
  assert.equal(d.canSend, true);
  assert.deepEqual(await c.s.threads(), []);
  assert.equal(await code(c.s.thread(threadId)), 'invalid_thread');
  assert.equal(await code(c.s.sendPrivate(threadId, 'intruso')), 'invalid_thread');
  // l'hotel non ha alcuna API per leggere le chat private
  const rec = await reception(store);
  assert.ok(!JSON.stringify([await rec.social().reports(true), await rec.social().publicFeed()]).includes('Volentieri'));
});

test('privata: richiesta rifiutata -> chiusa, il mittente vede "non accettata" e non puo\' ripeterla', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const { threadId } = await a.s.startThread(b.id, 'ciao');
  await b.s.respond(threadId, false);
  assert.equal((await a.s.threads())[0].status, 'declined');
  assert.equal(await code(a.s.sendPrivate(threadId, 'dai')), 'thread_not_open');
  assert.equal(await code(a.s.startThread(b.id, 'riprovo')), 'recipient_unavailable');
  assert.equal((await a.s.thread(threadId)).canSend, false);
});

test('privata: opzione "non ricevere privati" — nessuna nuova richiesta, risposta identica a quella di un blocco', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const c = await member(store, clock, 'Carla');
  await b.s.updateSettings({ acceptsPrivate: false });
  assert.equal((await a.s.guests()).find((x) => x.nickname === 'Bruno')!.canMessage, false);
  const e1 = await code(a.s.startThread(b.id, 'ciao'));
  await c.s.block(a.id);
  const e2 = await code(a.s.startThread(c.id, 'ciao'));
  assert.equal(e1, 'recipient_unavailable');
  assert.equal(e2, e1); // chi scrive non capisce la causa
  await b.s.updateSettings({ acceptsPrivate: true });
  assert.equal(await code(a.s.startThread(b.id, 'ciao')), 'ok');
});

test('privata: limite di nuovi contatti al giorno (5), ripristinato il giorno dopo; le risposte non contano', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const others = [];
  for (let i = 0; i < SOCIAL_LIMITS.newContactsPerDay + 1; i++) others.push(await member(store, clock, `Ospite${String.fromCharCode(65 + i)}`));
  for (let i = 0; i < SOCIAL_LIMITS.newContactsPerDay; i++) assert.equal(await code(a.s.startThread(others[i].id, 'ciao')), 'ok');
  assert.equal((await a.s.settings()).limits.newContactsLeftToday, 0);
  assert.equal(await code(a.s.startThread(others[5].id, 'ciao')), 'daily_contact_limit');
  // chi riceve richieste puo' accettarle senza consumare il proprio limite
  const t = (await others[0].s.threads())[0];
  assert.equal(await code(others[0].s.respond(t.id, true)), 'ok');
  assert.equal((await others[0].s.settings()).limits.newContactsLeftToday, SOCIAL_LIMITS.newContactsPerDay);
  clock.advance(DAY);
  assert.equal(await code(a.s.startThread(others[5].id, 'ciao')), 'ok');
});

test('privata: limite di frequenza dei messaggi (10 al minuto)', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const { threadId } = await a.s.startThread(b.id, 'ciao'); // 1
  await b.s.respond(threadId, true);
  for (let i = 0; i < SOCIAL_LIMITS.privatePerWindow - 1; i++) assert.equal(await code(a.s.sendPrivate(threadId, `m${i}`)), 'ok');
  assert.equal(await code(a.s.sendPrivate(threadId, 'troppi')), 'rate_limited');
  assert.equal(await code(b.s.sendPrivate(threadId, 'io posso')), 'ok'); // limite per persona
  clock.advance(61_000);
  assert.equal(await code(a.s.sendPrivate(threadId, 'ok')), 'ok');
  assert.equal(await code(a.s.sendPrivate(threadId, 'x'.repeat(281))), 'too_long');
});

test('blocco: scompaiono a vicenda da elenco e chat pubblica, nessun nuovo contatto, la conversazione si chiude', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const { threadId } = await a.s.startThread(b.id, 'ciao');
  await b.s.respond(threadId, true);
  await a.s.postPublic('messaggio di Anna');
  await b.s.postPublic('messaggio di Bruno');

  await b.s.block(a.id);
  assert.deepEqual((await a.s.guests()).map((x) => x.nickname), []);
  assert.deepEqual((await b.s.guests()).map((x) => x.nickname), []);
  assert.deepEqual((await a.s.publicFeed()).map((m) => m.nickname), ['Anna']);
  assert.deepEqual((await b.s.publicFeed()).map((m) => m.nickname), ['Bruno']);
  assert.deepEqual(await b.s.threads(), []); // chi blocca non la vede piu'
  assert.equal(await code(a.s.sendPrivate(threadId, 'ci sei?')), 'recipient_unavailable');
  assert.equal(await code(b.s.sendPrivate(threadId, 'x')), 'recipient_unavailable'); // chi blocca non puo' scrivere finche' non sblocca
  assert.equal(await code(a.s.startThread(b.id, 'ciao')), 'recipient_unavailable');
  assert.equal(await code(b.s.startThread(a.id, 'ciao')), 'recipient_unavailable');
  assert.deepEqual((await b.s.blocked()).map((x) => x.nickname), ['Anna']);

  await b.s.unblock(a.id);
  assert.deepEqual((await a.s.guests()).map((x) => x.nickname), ['Bruno']);
  assert.equal(await code(b.s.sendPrivate(threadId, 'rieccomi')), 'ok');
});

test('segnalazione privata: l\'hotel riceve solo il messaggio segnalato e al massimo 4 precedenti', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const { threadId } = await a.s.startThread(b.id, 'msg0');
  await b.s.respond(threadId, true);
  for (let i = 1; i <= 7; i++) { clock.advance(10_000); await a.s.sendPrivate(threadId, `msg${i}`); if (i % 3 === 0) clock.advance(61_000); }
  const d = await b.s.thread(threadId);
  const target = d.messages.find((m) => m.text === 'msg6')!;
  await assert.rejects(() => a.s.reportPrivate(threadId, d.messages.find((m) => m.text === 'msg6')!.id, 'spam'), { reason: 'invalid_message' }); // e' di Anna
  await b.s.reportPrivate(threadId, target.id, 'harassment');
  const rec = await reception(store);
  const [r] = await rec.social().reports(false);
  assert.equal(r.kind, 'private');
  assert.deepEqual(r.excerpt.map((e) => e.text), ['msg2', 'msg3', 'msg4', 'msg5', 'msg6']);
  assert.ok(!JSON.stringify(r).includes('msg7') && !JSON.stringify(r).includes('msg0'));
  // l'hotel puo' silenziare l'autore dalla segnalazione e poi chiuderla
  await rec.social().muteGuest(r.reported.id!, true, 60);
  await rec.social().closeReport(r.id, 'actioned');
  assert.equal(await code(a.s.sendPrivate(threadId, 'altro')), 'muted');
  await assert.rejects(() => rec.social().closeReport(r.id, 'dismissed'), { reason: 'report_closed' });
});

// ---------------------------------------------------------------- coupon
async function pair(store: DemoStore, clock: ReturnType<typeof makeClock>, days = 5) {
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno', days);
  const { threadId } = await a.s.startThread(b.id, 'ciao');
  await b.s.respond(threadId, true);
  return { a, b, threadId };
}

test('coupon: arriva nella chat privata e il destinatario lo mostra al barista, che lo valida; uso singolo', async () => {
  const { store, clock } = makeStore();
  const { a, b, threadId } = await pair(store, clock);
  const c = await a.s.sendCoupon(threadId, 'aperitif');
  assert.equal(c.status, 'issued');
  assert.equal(c.direction, 'sent');
  const msg = (await b.s.thread(threadId)).messages.at(-1)!;
  assert.equal(msg.kind, 'coupon');
  assert.equal(msg.coupon!.kind, 'aperitif');
  assert.equal(msg.coupon!.direction, 'received');

  assert.equal(await code(a.s.couponQr(c.id)), 'invalid_coupon'); // il mittente non lo puo' usare
  const qr = await b.s.couponQr(c.id);
  const bartender = await bar(store);
  const r1 = await bartender.redeem(qr.token);
  assert.equal(r1.ok, true);
  if (r1.ok) { assert.equal(r1.kind, 'coupon'); assert.equal(r1.couponKind, 'aperitif'); assert.equal(r1.guestName, 'Bruno'); assert.equal(r1.fromName, 'Anna'); }
  const r2 = await bartender.redeem(qr.token);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.reason, 'already_used');
  assert.equal(await code(b.s.couponQr(c.id)), 'invalid_coupon'); // gia' usato
  assert.equal((await b.s.thread(threadId)).messages.at(-1)!.coupon!.status, 'redeemed');
  assert.equal((await a.s.thread(threadId)).messages.at(-1)!.coupon!.status, 'redeemed');
});

test('coupon: tre tipi ammessi, altri rifiutati; solo in conversazione accettata', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const { threadId } = await a.s.startThread(b.id, 'ciao');
  assert.equal(await code(a.s.sendCoupon(threadId, 'coffee')), 'thread_not_open'); // richiesta ancora in attesa
  await b.s.respond(threadId, true);
  for (const k of ['coffee', 'aperitif', 'dinner'] as const) assert.equal(await code(a.s.sendCoupon(threadId, k)), 'ok');
  assert.equal(await code(a.s.sendCoupon(threadId, 'champagne' as never)), 'invalid_coupon');
  // anche il destinatario puo' offrire a sua volta
  assert.equal(await code(b.s.sendCoupon(threadId, 'coffee')), 'ok');
});

test('coupon: scade dopo 48 ore e la validazione fallisce', async () => {
  const { store, clock } = makeStore();
  const { a, b, threadId } = await pair(store, clock, 10);
  const c = await a.s.sendCoupon(threadId, 'dinner');
  const qr = await b.s.couponQr(c.id);
  clock.advance(48 * HOUR + MIN);
  const r = await (await bar(store)).redeem(qr.token);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'expired'); // il QR (90 s) e' scaduto prima
  assert.equal((await b.s.thread(threadId)).messages.at(-1)!.coupon!.status, 'expired');
  assert.equal(await code(b.s.couponQr(c.id)), 'invalid_coupon');
  // il job periodico lo marca scaduto e il pannello lo conta
  const st = await (await admin(store)).social().stats('season');
  assert.equal(st.couponsSent, 1);
  assert.equal(st.couponsExpired, 1);
  assert.equal(st.couponsRedeemed, 0);
});

test('coupon: il QR ha vita breve (90 s) ma il coupon resta valido e se ne genera un altro', async () => {
  const { store, clock } = makeStore();
  const { a, b, threadId } = await pair(store, clock);
  const c = await a.s.sendCoupon(threadId, 'coffee');
  const old = await b.s.couponQr(c.id);
  clock.advance(2 * MIN);
  const bartender = await bar(store);
  const e = await bartender.redeem(old.token);
  assert.equal(e.ok === false && e.reason, 'expired');
  const fresh = await b.s.couponQr(c.id);
  assert.equal((await bartender.redeem(fresh.token)).ok, true);
});

test('coupon: la scadenza non supera la fine del soggiorno del destinatario', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno', 0); // parte oggi: soggiorno minimo 3 ore
  const { threadId } = await a.s.startThread(b.id, 'ciao');
  await b.s.respond(threadId, true);
  const c = await a.s.sendCoupon(threadId, 'coffee');
  assert.ok(new Date(c.expiresAt).getTime() - clock.now().getTime() <= 3 * HOUR + MIN, 'scadenza oltre il soggiorno');
});

test('coupon: tetto giornaliero (3) e massimo 5 attivi per mittente; il mittente puo\' annullare un coupon non usato', async () => {
  const { store, clock } = makeStore();
  const { a, b, threadId } = await pair(store, clock);
  const ids: string[] = [];
  for (let i = 0; i < SOCIAL_LIMITS.couponsPerDay; i++) ids.push((await a.s.sendCoupon(threadId, 'coffee')).id);
  assert.equal(await code(a.s.sendCoupon(threadId, 'coffee')), 'coupon_daily_limit');
  assert.equal((await a.s.settings()).limits.couponsLeftToday, 0);
  await a.s.cancelCoupon(ids[0]);
  assert.equal(await code(b.s.couponQr(ids[0])), 'invalid_coupon');
  assert.equal(await code(a.s.cancelCoupon(ids[0])), 'coupon_not_active');
  assert.equal(await code(b.s.cancelCoupon(ids[1])), 'invalid_coupon'); // non e' suo
  // giorno nuovo (i coupon di ieri sono ancora validi 24 ore): restano 2 attivi, se ne possono inviare altri 3 al giorno ma non oltre 5 attivi
  clock.advance(DAY - HOUR);
  assert.equal(await code(a.s.sendCoupon(threadId, 'aperitif')), 'ok');
  assert.equal(await code(a.s.sendCoupon(threadId, 'aperitif')), 'ok');
  assert.equal(await code(a.s.sendCoupon(threadId, 'aperitif')), 'ok');
  assert.equal(await code(a.s.sendCoupon(threadId, 'aperitif')), 'coupon_daily_limit');
});

test('coupon: massimo 5 coupon attivi per mittente anche se il tetto giornaliero non e\' raggiunto', async () => {
  const { store, clock } = makeStore();
  const { a, threadId } = await pair(store, clock);
  for (let i = 0; i < 3; i++) await a.s.sendCoupon(threadId, 'coffee');
  clock.advance(DAY - HOUR);
  for (let i = 0; i < 2; i++) assert.equal(await code(a.s.sendCoupon(threadId, 'coffee')), 'ok');
  assert.equal(await code(a.s.sendCoupon(threadId, 'coffee')), 'coupon_active_limit');
});

test('coupon: bloccare annulla i coupon non usati; solo barista/direttore validano; token inventato rifiutato', async () => {
  const { store, clock } = makeStore();
  const { a, b, threadId } = await pair(store, clock);
  const c1 = await a.s.sendCoupon(threadId, 'coffee');
  const c2 = await a.s.sendCoupon(threadId, 'dinner');
  const qr2 = await b.s.couponQr(c2.id);
  assert.equal((await (await reception(store)).redeem(qr2.token)).ok, false); // la reception non valida
  await b.s.block(a.id);
  assert.equal(await code(b.s.couponQr(c1.id)), 'invalid_coupon');
  const r = await (await bar(store)).redeem(qr2.token);
  assert.equal(r.ok, false); // QR annullato dal blocco: il coupon non e' piu' utilizzabile
  if (!r.ok) assert.equal(r.reason, 'expired');
  assert.equal((await (await bar(store)).redeem('c_inventato123456789012')).ok, false);
});

test('coupon: i QR di coupon e bonus convivono e non si confondono', async () => {
  const { store, clock } = makeStore();
  const { a, b, threadId } = await pair(store, clock);
  const c = await a.s.sendCoupon(threadId, 'aperitif');
  const cq = await b.s.couponQr(c.id);
  const bq = await b.g.requestBonusQr();
  const bt = await bar(store);
  const rb = await bt.redeem(bq.token);
  assert.equal(rb.ok && (rb.kind ?? 'bonus'), 'bonus');
  const rc = await bt.redeem(cq.token);
  assert.equal(rc.ok && rc.kind, 'coupon');
});

test('coupon: ledger isolato — validazione di uno staff di un altro hotel respinta', () => {
  const l = new CouponLedger();
  const now = new Date('2026-10-12T10:00:00Z');
  const c = l.issue({ hotelId: 'h1', kind: 'coffee', senderId: 's', recipientId: 'r', threadId: 't', now, expiresAt: new Date(now.getTime() + HOUR) });
  const { token } = l.requestQr('r', c.id, now);
  const other = l.redeem(token, { actorKey: 'x', staffId: 'st', staffHotelId: 'h2' }, now, () => true);
  assert.equal(other.ok, false);
  assert.equal(l.redeem(token, { actorKey: 'x', staffId: 'st', staffHotelId: 'h1' }, now, () => true).ok, true);
});

// ---------------------------------------------------------------- check-out e cancellazione
test('check-out: profilo, chat, richieste e coupon non usati spariscono; l\'altra parte non vede piu\' nulla', async () => {
  const { store, clock } = makeStore();
  const { a, b, threadId } = await pair(store, clock);
  const m = await a.s.postPublic('ciao a tutti');
  await b.s.reportPublic(m.id, 'spam');
  const c = await a.s.sendCoupon(threadId, 'coffee');
  const qr = await b.s.couponQr(c.id);

  await a.g.endMyStay();
  assert.deepEqual((await b.s.guests()).map((x) => x.nickname), []);
  assert.deepEqual(await b.s.publicFeed(), []);
  assert.deepEqual(await b.s.threads(), []);
  assert.equal((await (await bar(store)).redeem(qr.token)).ok, false);
  // segnalazione chiusa e testo condiviso cancellato
  const rep = await (await reception(store)).social().reports(true);
  assert.equal(rep[0].status, 'subject_left');
  assert.deepEqual(rep[0].excerpt, []);
  // nessuna traccia del nickname nello stato del dominio
  assert.ok(!JSON.stringify([store.social.profiles, store.social.publicMsgs, store.social.privMsgs, store.social.threads]).includes('Anna'));
  const st = await (await admin(store)).social().stats('season'); // i contatori anonimi restano
  assert.equal(st.publicMessages, 1);
  assert.equal(st.couponsSent, 1);
});

test('check-out per scadenza: tick() cancella il livello sociale di chi e\' scaduto', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna', 0);
  const b = await member(store, clock, 'Bruno', 10);
  await a.s.postPublic('ciao');
  assert.equal((await b.s.publicFeed()).length, 1);
  clock.advance(4 * HOUR);
  const g = await store.guest(b.session);
  assert.deepEqual(await g!.social().publicFeed(), []);
  assert.equal(store.social.profiles.length, 1);
});

test('statistiche: conteggi aggregati senza dati personali, per periodo', async () => {
  const { store, clock } = makeStore();
  const { a, b, threadId } = await pair(store, clock);
  await a.s.postPublic('uno');
  await b.s.postPublic('due');
  await b.s.sendPrivate(threadId, 'ok');
  const c = await a.s.sendCoupon(threadId, 'coffee');
  await (await bar(store)).redeem((await b.s.couponQr(c.id)).token);
  const adm = await admin(store);
  const st = await adm.social().stats('today');
  assert.deepEqual(
    [st.visibleGuests, st.publicMessages, st.privateRequests, st.privateAccepted, st.privateMessages, st.couponsSent, st.couponsRedeemed, st.openReports],
    [2, 2, 1, 1, 2, 1, 1, 0],
  );
  assert.ok(!/Anna|Bruno/.test(JSON.stringify(st)));
  clock.advance(10 * DAY);
  const later = await adm.social().stats('7d');
  assert.equal(later.publicMessages, 0);
  assert.equal((await adm.social().stats('season')).publicMessages, 2);
});

// ---------------------------------------------------------------- API (handler)
test('API: azioni sociali instradate, errori mappati (403/429), staff protetto, onboarding con opt-in', async () => {
  _resetForTests();
  const { store, clock } = makeStore();
  const mk = (guest?: string, staff?: string, method: 'GET' | 'POST' = 'POST'): Ctx => ({ store, guest, staff, ip: '1.2.3.4', method });
  const a = await guest(store, clock, 'Anna', { optIn: true });
  const b = await guest(store, clock, 'Bruno', { optIn: true });
  const kid = await guest(store, clock, 'Teo', { optIn: true, adult: false });

  let r = await guestAction(mk(a.session), 'social-post', { text: 'ciao' });
  assert.equal(r.status, 403); assert.equal(r.body?.error, 'rules_required');
  await guestAction(mk(a.session), 'social-rules', {});
  await guestAction(mk(b.session), 'social-rules', {});
  r = await guestAction(mk(a.session), 'social-post', { text: 'ciao' });
  assert.equal(r.status, 200);
  r = await guestAction(mk(a.session), 'social-post', { text: 'x'.repeat(281) });
  assert.equal(r.status, 400); assert.equal(r.body?.error, 'too_long');
  for (let i = 0; i < 4; i++) await guestAction(mk(a.session), 'social-post', { text: `m${i}` });
  r = await guestAction(mk(a.session), 'social-post', { text: 'troppi' });
  assert.equal(r.status, 429);

  r = await guestAction(mk(a.session, undefined, 'GET'), 'social-guests', {});
  const list = (r.body as { guests: { id: string; nickname: string }[] }).guests;
  assert.deepEqual(list.map((x) => x.nickname), ['Bruno']);
  r = await guestAction(mk(kid.session, undefined, 'GET'), 'social-guests', {});
  assert.equal(r.status, 403);
  r = await guestAction(mk(undefined, undefined, 'GET'), 'social-guests', {});
  assert.equal(r.status, 401);
  r = await guestAction(mk(a.session), 'social-thread-start', { to: list[0].id, text: 'ciao Bruno' });
  assert.equal(r.status, 200);
  r = await guestAction(mk(a.session), 'social-coupon-send', { threadId: (r.body as { threadId: string }).threadId, kind: 'coffee' });
  assert.equal(r.status, 403); assert.equal(r.body?.error, 'thread_not_open');
  r = await guestAction(mk(a.session), 'social-thread-start', { to: list[0].id, text: 'x', extra: 1 });
  assert.equal(r.status, 409);
  r = await guestAction(mk(a.session), 'social-report', { messageId: 'x', reason: 'boh' });
  assert.equal(r.status, 400);

  // staff: ospite non autenticato come staff, barista vietato, reception ok
  assert.equal((await staffAction(mk(a.session, undefined, 'GET'), 'social-reports', {})).status, 401);
  const lb = await store.staffLogin('bar@demo.chathel.test', 'demo-bar');
  assert.equal((await staffAction(mk(undefined, lb!.session, 'GET'), 'social-reports', {})).status, 403);
  const lr = await store.staffLogin('reception@demo.chathel.test', 'demo-reception');
  r = await staffAction(mk(undefined, lr!.session, 'GET'), 'social-stats', { period: 'today' });
  assert.equal(r.status, 200);
  assert.equal((r.body as { stats: { publicMessages: number } }).stats.publicMessages, 5);
});

test('onboarding: senza scelta esplicita non si compare (default = no)', async () => {
  const { store, clock } = makeStore();
  const x = await join(store, clock, 'Anna'); // join() non passa socialOptIn
  const s = x.g.social();
  assert.equal((await s.settings()).visible, false);
  const y = await member(store, clock, 'Bruno');
  assert.deepEqual(await y.s.guests(), []);
});

test('T-D3 parità con SQL: profilo rimosso = QR del coupon ricevuto negato (CH004 social_removed)', async () => {
  const { store, clock } = makeStore();
  const { a, b, threadId } = await pair(store, clock, 10);
  const c = await a.s.sendCoupon(threadId, 'coffee');
  await (await reception(store)).social().removeGuest(b.id, true);
  assert.equal(await code(b.s.couponQr(c.id)), 'social_removed');
});
