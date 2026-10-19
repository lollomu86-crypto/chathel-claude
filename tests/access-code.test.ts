import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, join, admin, reception, demoIdentity, dayPlus } from './helpers';
import { hotelByCode } from '../src/lib/api/handlers';
import type { Ctx } from '../src/lib/api/handlers';

const ctxFor = (store: Ctx['store'], ip = '10.0.0.1'): Ctx => ({ store, method: 'POST', ip } as Ctx);

test('codice hotel: il codice a 6 cifre apre lo stesso ingresso del QR', async () => {
  const { store, clock } = makeStore();
  assert.equal(await store.hotelSlugByCode('482915'), 'demo');
  assert.equal(await store.hotelSlugByCode('000000'), null);
  assert.equal(await store.hotelSlugByCode('48291'), null);
  assert.equal(await store.hotelSlugByCode('abcdef'), null);
  const r = await store.startStay({ slug: 'demo', qrToken: '482915', identity: demoIdentity('Carla'), locale: 'it', checkout: dayPlus(clock, 3), isAdult: true });
  assert.ok(await store.guest(r.session));
  await assert.rejects(store.startStay({ slug: 'demo', qrToken: '111111', identity: demoIdentity('Dino'), locale: 'it', checkout: dayPlus(clock, 3), isAdult: true }), /invalid_qr/);
});

test('codice hotel: solo l\'amministratore lo vede e lo cambia; il vecchio smette subito', async () => {
  const { store, clock } = makeStore({ accessCode: '135790' });
  await join(store, clock, 'Elena');
  const a = await admin(store);
  assert.equal(await a.currentAccessCode(), '135790');
  const { code } = await a.rotateAccessCode();
  assert.match(code, /^\d{6}$/);
  assert.notEqual(code, '135790');
  assert.equal(await store.hotelSlugByCode('135790'), null);
  assert.equal(await store.hotelSlugByCode(code), 'demo');
  const rec = await reception(store);
  await assert.rejects(Promise.resolve().then(() => rec.currentAccessCode()));
  await assert.rejects(Promise.resolve().then(() => rec.rotateAccessCode()));
});

test('codice hotel: API pubblica con limiti anti-ricerca', async () => {
  const { store } = makeStore();
  const ok = await hotelByCode(ctxFor(store, '10.1.1.1'), { code: '482915' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body?.slug, 'demo');
  const bad = await hotelByCode(ctxFor(store, '10.1.1.2'), { code: '999999' });
  assert.equal(bad.status, 404);
  const wrongFormat = await hotelByCode(ctxFor(store, '10.1.1.3'), { code: '12' });
  assert.equal(wrongFormat.status, 400);
  let last = 200;
  for (let i = 0; i < 20; i++) last = (await hotelByCode(ctxFor(store, '10.1.1.9'), { code: '482915' })).status;
  assert.equal(last, 429, 'dopo 12 richieste in 10 minuti dallo stesso IP si viene rallentati');
});
