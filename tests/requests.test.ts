import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, join, admin, reception, bar, login, MIN, DAY } from './helpers';
import { guestAction, staffAction, type Ctx } from '../src/lib/api/handlers';
import { nextStatus, cleanRequestInput, teamPassword } from '../src/lib/rules/requests';
import type { DemoStore } from '../src/lib/store/demo';

const team = (store: DemoStore) => login(store, 'pulizie@demo.chathel.test', 'demo-team');
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { reason?: string }) => e?.reason ?? 'error');
const ctxOf = (store: DemoStore, o: Partial<Ctx> = {}): Ctx => ({ store, ip: '10.0.0.1', method: 'POST', ...o });
const catId = async (g: Awaited<ReturnType<typeof join>>['g'], it: string) => (await g.requestCategories()).find((c) => c.name.it === it)!.id;

test('regole: passaggi di stato e testi ripuliti', () => {
  assert.equal(nextStatus('open', 'taken'), 'taken');
  assert.equal(nextStatus('open', 'done'), 'done');
  assert.equal(nextStatus('taken', 'done'), 'done');
  assert.throws(() => nextStatus('taken', 'taken'), { reason: 'invalid_status' });
  assert.throws(() => nextStatus('done', 'done'), { reason: 'request_closed' });
  assert.deepEqual(cleanRequestInput({ categoryId: 'c', note: '  ', place: ' camera 2 ' }), { categoryId: 'c', note: null, place: 'camera 2' });
  assert.throws(() => cleanRequestInput({ categoryId: 'c', place: 'x'.repeat(41) }), { reason: 'too_long' });
  const pw = teamPassword((n) => Math.floor(Math.random() * n));
  assert.match(pw, /^[a-km-np-zA-HJ-NP-Z2-9]{14}$/, 'niente 0/O/1/l');
});

test('ospite: crea, al massimo 3 aperte e 10 al giorno, annulla, vota una volta', async () => {
  const { store, clock } = makeStore();
  const a = await join(store, clock, 'Anna');
  const pul = await catId(a.g, 'Pulizia e biancheria');
  const r1 = await a.g.createRequest({ categoryId: pul, note: 'Due asciugamani', place: 'camera 214' });
  assert.equal(r1.status, 'open');
  await a.g.createRequest({ categoryId: pul });
  await a.g.createRequest({ categoryId: pul });
  assert.equal(await code(a.g.createRequest({ categoryId: pul })), 'request_open_limit');
  assert.equal(await code(a.g.createRequest({ categoryId: 'inesistente' })), 'invalid_category');
  const mine = await a.g.myRequests();
  assert.equal(mine.length, 3);
  const others = mine.filter((r) => r.id !== r1.id); // stesso orario: l'ordine tra loro non e' garantito
  for (const r of others) await a.g.cancelRequest(r.id);
  assert.equal(await code(a.g.cancelRequest(others[0].id)), 'request_closed', 'gia\' annullata');
  // limite giornaliero: 10 in tutto oggi (annullate comprese)
  for (let i = 0; i < 7; i++) {
    const r = await a.g.createRequest({ categoryId: pul });
    await a.g.cancelRequest(r.id);
  }
  assert.equal(await code(a.g.createRequest({ categoryId: pul })), 'request_daily_limit');
  clock.advance(DAY);
  assert.equal(await code(a.g.createRequest({ categoryId: pul })), 'ok', 'il giorno dopo si riparte');
  // voto: solo a richiesta fatta, una volta
  const st = await reception(store);
  await st.updateRequest({ id: r1.id, status: 'done' });
  await a.g.rateRequest(r1.id, true);
  assert.equal(await code(a.g.rateRequest(r1.id, false)), 'request_closed');
  assert.equal((await a.g.myRequests()).find((r) => r.id === r1.id)?.rating, 1);
});

test('staff: reception vede tutto e sposta; il team solo il suo reparto e solo lo stato; il bar niente', async () => {
  const { store, clock } = makeStore();
  const a = await join(store, clock, 'Anna');
  const pul = await a.g.createRequest({ categoryId: await catId(a.g, 'Pulizia e biancheria'), place: 'camera 3' });
  const gua = await a.g.createRequest({ categoryId: await catId(a.g, 'Guasto o manutenzione'), note: 'La doccia perde' });
  const rec = await reception(store);
  assert.equal((await rec.requests(false)).length, 2);
  const tm = await team(store);
  assert.equal(tm.info.role, 'team');
  assert.equal(tm.info.department, 'housekeeping');
  const mine = await tm.requests(false);
  assert.deepEqual(mine.map((r) => r.id), [pul.id], 'pulizie: solo la sua');
  assert.equal(mine[0].guestName, 'Anna');
  assert.deepEqual(Object.keys(mine[0]).sort(), ['category', 'createdAt', 'department', 'doneAt', 'guestName', 'id', 'note', 'place', 'priority', 'rating', 'status', 'takenAt', 'takenBy'], 'niente altro sull\'ospite');
  assert.equal(await code(tm.updateRequest({ id: gua.id, status: 'taken' })), 'forbidden');
  assert.equal(await code(tm.updateRequest({ id: pul.id, priority: 'high' })), 'forbidden');
  clock.advance(5 * MIN);
  await tm.updateRequest({ id: pul.id, status: 'taken' });
  assert.equal((await tm.requests(false))[0].takenBy, 'Gina (pulizie)');
  clock.advance(10 * MIN);
  await tm.updateRequest({ id: pul.id, status: 'done' });
  assert.equal(await code(tm.updateRequest({ id: pul.id, status: 'taken' })), 'request_closed');
  assert.equal((await tm.requests(false)).length, 0, 'fatta: sparisce dalle aperte');
  assert.equal((await tm.requests(true)).length, 1, 'ma resta tra le chiuse');
  await rec.updateRequest({ id: gua.id, priority: 'high', department: 'housekeeping' });
  assert.equal((await tm.requests(false))[0].id, gua.id, 'spostata al reparto pulizie, e ora la vedono');
  await assert.rejects((await bar(store)).requests(false), { reason: 'forbidden' });
  const s = await rec.requestStats('today');
  assert.deepEqual([s.total, s.done, s.open, s.takeMinutes, s.doneMinutes], [2, 1, 1, 5, 15]);
});

test('partenza: via nota, luogo e ospite; le aperte si annullano; restano categoria, tempi e voto', async () => {
  const { store, clock } = makeStore();
  const a = await join(store, clock, 'Anna');
  const pul = await catId(a.g, 'Pulizia e biancheria');
  const r1 = await a.g.createRequest({ categoryId: pul, note: 'asciugamani', place: 'camera 9' });
  await a.g.createRequest({ categoryId: pul, note: 'cuscino', place: 'camera 9' });
  const rec = await reception(store);
  await rec.updateRequest({ id: r1.id, status: 'done' });
  await a.g.rateRequest(r1.id, true);
  await a.g.endMyStay();
  const all = await rec.requests(true);
  assert.equal(all.length, 2);
  for (const r of all) { assert.equal(r.note, null); assert.equal(r.place, null); assert.equal(r.guestName, null); }
  assert.deepEqual(all.map((r) => r.status).sort(), ['cancelled', 'done']);
  assert.equal((await rec.requestStats('today')).up, 1);
});

test('API: richieste spente = 403; emergenza nella nota = 112 e avviso urgente, nessuna richiesta', async () => {
  const { store, clock } = makeStore();
  const a = await join(store, clock, 'Anna');
  const g = ctxOf(store, { guest: a.session });
  const pul = await catId(a.g, 'Pulizia e biancheria');
  const r = await guestAction(g, 'request-create', { categoryId: pul, note: 'Aiuto, c\'è un incendio in camera!' });
  assert.equal(r.status, 200);
  assert.equal(r.body?.emergency, true);
  assert.match(String(r.body?.emergencyText), /112/);
  assert.equal((await a.g.myRequests()).length, 0, 'nessuna richiesta normale');
  assert.equal((await (await reception(store)).urgentAlerts()).length, 1, 'avviso urgente in reception');
  const ok = await guestAction(g, 'request-create', { categoryId: pul, place: 'camera 2' });
  assert.equal(ok.status, 200);
  await (await admin(store)).saveCustomization({ features: { requests: false } });
  const off = await guestAction(g, 'request-create', { categoryId: pul });
  assert.equal(off.status, 403); assert.equal(off.body?.error, 'feature_disabled');
  assert.equal((await guestAction({ ...g, method: 'GET' }, 'requests', {})).status, 200, 'le proprie richieste si vedono ancora');
});

test('Team: il direttore crea l\'account (password una volta sola), la persona entra; disattivata non entra piu\'', async () => {
  const { store } = makeStore();
  const adm = ctxOf(store, { staff: (await store.staffLogin('admin@demo.chathel.test', 'demo-admin'))!.session });
  const rec = ctxOf(store, { staff: (await store.staffLogin('reception@demo.chathel.test', 'demo-reception'))!.session });
  assert.equal((await staffAction(rec, 'team-create', { name: 'Piero', email: 'piero@x.test', department: 'maintenance' })).status, 403);
  const r = await staffAction(adm, 'team-create', { name: 'Piero', email: 'Piero@X.test', department: 'maintenance' });
  assert.equal(r.status, 200);
  const password = r.body?.password as string;
  assert.equal(password.length, 14);
  assert.equal((await staffAction(adm, 'team-create', { name: 'Altro', email: 'piero@x.test', department: 'maintenance' })).body?.error, 'conflict');
  const l = await store.staffLogin('piero@x.test', password);
  assert.equal(l?.role, 'team');
  const list = (await staffAction({ ...adm, method: 'GET' }, 'team', {})).body?.team as { id: string; name: string; department: string }[];
  const piero = list.find((m) => m.name === 'Piero')!;
  assert.equal(piero.department, 'maintenance');
  assert.ok(!JSON.stringify(list).includes(password), 'la password non torna mai nell\'elenco');
  await staffAction(adm, 'team-active', { id: piero.id, active: false });
  assert.equal(await store.staffLogin('piero@x.test', password), null);
  assert.equal(await store.staff(l!.session), null, 'anche la sessione aperta si chiude');
});

test('categorie: il direttore aggiunge e spegne; l\'ospite vede solo le accese', async () => {
  const { store, clock } = makeStore();
  const ad = await admin(store);
  await ad.saveRequestCategory({ name: { it: 'Lettino in spiaggia', en: 'Beach lounger' }, department: 'roomservice', active: true });
  await assert.rejects(ad.saveRequestCategory({ name: { en: 'No Italian' }, department: 'roomservice', active: true }), { reason: 'invalid_category' });
  await assert.rejects((await reception(store)).saveRequestCategory({ name: { it: 'X' }, department: 'reception', active: true }), { reason: 'forbidden' });
  const all = await ad.requestCategories();
  assert.equal(all.length, 5);
  const altro = all.find((c) => c.name.it === 'Altro')!;
  await ad.saveRequestCategory({ ...altro, active: false });
  const a = await join(store, clock, 'Anna');
  assert.deepEqual((await a.g.requestCategories()).map((c) => c.name.it), ['Pulizia e biancheria', 'Guasto o manutenzione', 'Oggetti per la camera', 'Lettino in spiaggia']);
  assert.equal(await code(a.g.createRequest({ categoryId: altro.id })), 'invalid_category');
});
