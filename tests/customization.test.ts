import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, makeClock, demoIdentity, admin, reception, bar, dayPlus, MIN } from './helpers';
import type { DemoStore } from '../src/lib/store/demo';
import { aiChat, featuresFor, guestAction, staffAction, staffMedia, type Ctx } from '../src/lib/api/handlers';
import { checkImage, effectiveFeatures, featuresFromDb, featuresToDb, sniffImage, welcomeFor, ALL_FEATURES_ON, MEDIA_MAX_BYTES } from '../src/lib/rules/features';
import { runUpload } from '../src/lib/api/http';

async function member(store: DemoStore, clock: ReturnType<typeof makeClock>, name: string) {
  const r = await store.startStay({ slug: 'demo', qrToken: 'demo-qr-token', identity: demoIdentity(name), locale: 'en', checkout: dayPlus(clock, 5), isAdult: true, socialOptIn: true });
  const g = (await store.guest(r.session))!;
  const s = g.social();
  await s.acceptRules();
  return { session: r.session, g, s, id: (await s.settings()).id };
}
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { reason?: string }) => e?.reason ?? 'error');
const ctxOf = (store: DemoStore, o: Partial<Ctx> = {}): Ctx => ({ store, ip: '10.0.0.1', method: 'POST', ...o });
const staffSession = async (store: DemoStore, email: string, pw: string) => (await store.staffLogin(email, pw))!.session;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

test('interruttori: chiave mancante = accesa, "social" spento spegne chat pubblica, sfide e coupon', () => {
  assert.deepEqual(featuresFromDb({}), ALL_FEATURES_ON);
  assert.deepEqual(featuresFromDb(null), ALL_FEATURES_ON);
  const f = featuresFromDb({ social: false, public_chat: true, bookings: false });
  assert.equal(f.publicChat, true, 'la scelta salvata resta');
  const e = effectiveFeatures(f);
  assert.deepEqual([e.social, e.publicChat, e.challenges, e.coupons, e.bookings, e.reception], [false, false, false, false, false, true]);
  assert.deepEqual(featuresToDb({ ...ALL_FEATURES_ON, publicChat: false }), { social: true, public_chat: false, challenges: true, coupons: true, bookings: true, reception: true });
});

test('benvenuto: lingua dell\'ospite, poi quella dell\'hotel; il direttore lo salva, reception e bar no', async () => {
  const { store, clock } = makeStore();
  assert.equal(welcomeFor({ it: 'Ciao', de: 'Hallo' }, 'de', 'it'), 'Hallo');
  assert.equal(welcomeFor({ it: 'Ciao' }, 'ru', 'it'), 'Ciao');
  assert.equal(welcomeFor({ en: 'Hi' }, 'ru', 'it'), '', 'nessun ripiego oltre la lingua dell\'hotel');
  const ad = await admin(store);
  await ad.saveCustomization({ welcome: { it: '  Benvenuti!  ', en: '', ru: 'Добро пожаловать' } });
  const a = await member(store, clock, 'Anna');
  assert.deepEqual((await a.g.view()).hotel.welcome, { it: 'Benvenuti!', ru: 'Добро пожаловать' }, 'spazi tolti, lingue vuote eliminate');
  await assert.rejects(ad.saveCustomization({ welcome: { it: 'x'.repeat(501) } }), { reason: 'welcome_too_long' });
  await assert.rejects((await reception(store)).saveCustomization({ features: { social: false } }), { reason: 'forbidden' });
  await assert.rejects((await bar(store)).saveCustomization({ bonusEnabled: false }), { reason: 'forbidden' });
  assert.equal((await a.g.view()).hotel.features.social, true);
});

test('funzioni spente: lo store rifiuta le scritture; riaccendendo si ritrova tutto (spegnere non cancella)', async () => {
  const { store, clock } = makeStore();
  const ad = await admin(store);
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  await a.s.postPublic('Ciao a tutti');
  const slot = (await a.g.facilities())[0].slots[0];
  await a.g.book(slot.id, 1);

  await ad.saveCustomization({ features: { bookings: false, publicChat: false, reception: false } });
  assert.equal(await code(a.g.book((await a.g.facilities())[0].slots[1].id, 1)), 'feature_disabled');
  assert.equal(await code(a.s.postPublic('ancora')), 'feature_disabled');
  assert.equal(await code(a.s.publicFeed()), 'feature_disabled');
  const game = (await a.g.games())[0];
  const startsAt = new Date(clock.now().getTime() + 30 * MIN).toISOString();
  assert.equal(await code(a.s.createChallenge({ gameId: game.id, startsAt, stake: 'coffee', threadId: null })), 'feature_disabled', 'sfida pubblica senza chat pubblica');
  assert.equal(await code(a.g.appendGuestMessage('wifi?')), 'feature_disabled');
  assert.equal((await a.g.myBookings()).length, 1, 'la prenotazione fatta resta e si puo\' disdire');
  // in privato le sfide restano possibili
  const { threadId } = await a.s.startThread(b.id, 'Ciao Bruno');
  await b.s.respond(threadId, true);
  assert.equal(await code(a.s.createChallenge({ gameId: game.id, startsAt, stake: 'coffee', threadId })), 'ok');

  await ad.saveCustomization({ features: { coupons: false } });
  assert.equal(await code(a.s.sendCoupon(threadId, (await import('../src/lib/types')).COUPON_KINDS[0])), 'feature_disabled');

  await ad.saveCustomization({ features: { social: false } });
  assert.equal(await code(a.s.settings()), 'feature_disabled');
  assert.equal(await code(a.s.threads()), 'feature_disabled');
  const v = (await a.g.view()).hotel.features;
  assert.deepEqual([v.social, v.publicChat, v.challenges, v.coupons], [false, false, false, false]);

  await ad.saveCustomization({ features: { social: true, publicChat: true, bookings: true, reception: true, coupons: true } });
  assert.equal((await a.s.publicFeed()).length, 1, 'il messaggio di prima c\'e\' ancora');
  assert.equal((await a.s.threads()).length, 1);
  assert.equal(await code(a.g.book((await a.g.facilities())[0].slots[1].id, 1)), 'ok');
});

test('API: funzione spenta = 403 feature_disabled; disdire resta possibile', async () => {
  const { store, clock } = makeStore();
  const ad = await admin(store);
  const a = await member(store, clock, 'Anna');
  // uno slot lontano: si puo' ancora disdire (limite di 60 minuti)
  const slot = (await a.g.facilities())[0].slots.find((s) => new Date(s.startsAt).getTime() > clock.now().getTime() + 3 * 60 * MIN)!;
  await a.g.book(slot.id, 1);
  const booking = (await a.g.myBookings())[0];
  await ad.saveCustomization({ features: { bookings: false, reception: false, social: false } });
  const g = ctxOf(store, { guest: a.session });
  const r = await guestAction(g, 'book', { slotId: slot.id, partySize: 1 });
  assert.equal(r.status, 403); assert.equal(r.body?.error, 'feature_disabled');
  assert.equal((await guestAction(g, 'social-threads', {})).status, 403);
  assert.equal((await guestAction({ ...g, method: 'GET' }, 'games', {})).status, 403, 'senza sfide niente elenco giochi');
  assert.equal((await aiChat(g, { text: 'wifi?' })).body?.error, 'feature_disabled');
  assert.equal((await guestAction(g, 'cancel-booking', { bookingId: booking.id })).status, 200);
  // mappa delle azioni
  assert.deepEqual(featuresFor('social-post', {}), ['social', 'publicChat']);
  assert.deepEqual(featuresFor('social-challenge-create', { threadId: 't1' }), ['social', 'challenges']);
  assert.deepEqual(featuresFor('social-challenge-create', {}), ['social', 'challenges', 'publicChat']);
  assert.deepEqual(featuresFor('social-coupon-cancel', {}), ['social']);
  assert.deepEqual(featuresFor('bonus', {}), []);
});

test('API pannello: salvataggio solo dal direttore, campi sconosciuti rifiutati, bonus spento = niente bonus ai nuovi', async () => {
  const { store, clock } = makeStore();
  const adm = ctxOf(store, { staff: await staffSession(store, 'admin@demo.chathel.test', 'demo-admin') });
  const rec = ctxOf(store, { staff: await staffSession(store, 'reception@demo.chathel.test', 'demo-reception') });
  assert.equal((await staffAction(rec, 'customization-save', { features: { social: false } })).status, 403);
  assert.equal((await staffAction(adm, 'customization-save', { features: { foo: true } })).status, 400);
  assert.equal((await staffAction(adm, 'customization-save', { logoUrl: 'https://evil.test/x.png' })).status, 400, 'il logo non si imposta da qui');
  assert.equal((await staffAction(adm, 'customization-save', { welcome: { it: 'x'.repeat(501) } })).body?.error, 'welcome_too_long');
  assert.equal((await staffAction(adm, 'customization-save', { bonusEnabled: false })).status, 200);
  const before = await member(store, clock, 'Anna');
  assert.equal((await before.g.bonus()).state, 'none');
  assert.equal(store.hotel.bonusEnabled, false);
});

test('immagini: tipo reale dai primi byte, niente SVG, massimo 2 MB', () => {
  assert.equal(sniffImage(JPEG), 'image/jpeg');
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImage(new TextEncoder().encode('<svg onload="alert(1)">')), null);
  assert.equal(checkImage(JPEG, 'image/jpeg'), 'image/jpeg');
  assert.throws(() => checkImage(JPEG, 'image/png'), { reason: 'invalid_image' }, 'tipo dichiarato diverso da quello reale');
  assert.throws(() => checkImage(new TextEncoder().encode('<svg/>'), 'image/png'), { reason: 'invalid_image' });
  const big = new Uint8Array(MEDIA_MAX_BYTES + 1); big.set(JPEG);
  assert.throws(() => checkImage(big, 'image/jpeg'), { reason: 'image_too_large' });
});

test('immagini: il direttore carica logo e copertina (demo: in memoria), l\'ospite e la pagina d\'ingresso li vedono', async () => {
  const { store, clock } = makeStore();
  const adm = ctxOf(store, { staff: await staffSession(store, 'admin@demo.chathel.test', 'demo-admin') });
  const r = await staffMedia(adm, 'logo', PNG, 'image/png');
  assert.equal(r.status, 200);
  const url = r.body?.url as string;
  assert.match(url, /^\/api\/media\/logo-[0-9a-f-]{36}$/);
  assert.deepEqual(store.media(url.slice('/api/media/'.length))?.type, 'image/png');
  assert.equal((await store.publicHotel('demo'))?.logoUrl, url);
  await staffMedia(adm, 'cover', JPEG, 'image/jpeg');
  const a = await member(store, clock, 'Anna');
  const v = (await a.g.view()).hotel;
  assert.equal(v.logoUrl, url);
  assert.match(v.coverUrl ?? '', /^\/api\/media\/cover-/);
  // sostituendo il logo il file vecchio sparisce
  const r2 = await staffMedia(adm, 'logo', JPEG, 'image/jpeg');
  assert.equal(store.media(url.slice('/api/media/'.length)), null);
  assert.equal((await staffAction(adm, 'media-remove', { kind: 'logo' })).status, 200);
  assert.equal(store.hotel.logoUrl, null);
  assert.equal(store.media((r2.body?.url as string).slice('/api/media/'.length)), null);
  // reception, bar, tipo sbagliato, tipo di immagine sconosciuto
  const rec = ctxOf(store, { staff: await staffSession(store, 'reception@demo.chathel.test', 'demo-reception') });
  assert.equal((await staffMedia(rec, 'logo', PNG, 'image/png')).status, 403);
  assert.equal((await staffMedia(adm, 'logo', new TextEncoder().encode('<svg/>'), 'image/png')).body?.error, 'invalid_image');
  assert.equal((await staffMedia(adm, 'banner', PNG, 'image/png')).status, 400);
  assert.equal((await staffMedia(ctxOf(store), 'logo', PNG, 'image/png')).status, 401);
});

test('caricamento HTTP: solo POST con tipo immagine (un form di un altro sito non passa), massimo 2 MB', async (t) => {
  // runUpload apre lo store: qui serve la demo, qualunque sia l'ambiente della suite
  const prev = process.env.CHATHEL_DEMO;
  process.env.CHATHEL_DEMO = '1';
  t.after(() => { if (prev === undefined) delete process.env.CHATHEL_DEMO; else process.env.CHATHEL_DEMO = prev; });
  const seen: string[] = [];
  const fn = async (_c: Ctx, b: Uint8Array, t: string) => { seen.push(`${t}:${b.length}`); return { status: 200, body: { ok: true } }; };
  const req = (type: string, body: BodyInit, method = 'POST') => new Request('http://x/api/staff/media?kind=logo', { method, headers: { 'content-type': type }, body: method === 'POST' ? body : undefined });
  assert.equal((await runUpload(req('multipart/form-data; boundary=x', 'a'), fn)).status, 415);
  assert.equal((await runUpload(req('text/plain', 'a'), fn)).status, 415);
  assert.equal((await runUpload(req('image/png', 'a', 'GET'), fn)).status, 405);
  assert.equal((await runUpload(req('image/png', new Uint8Array(MEDIA_MAX_BYTES + 10)), fn)).status, 413);
  assert.equal((await runUpload(req('image/png', PNG), fn)).status, 200);
  assert.deepEqual(seen, [`image/png:${PNG.length}`]);
});
