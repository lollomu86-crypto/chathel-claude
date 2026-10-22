import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, makeClock, demoIdentity, admin, dayPlus, HOUR, MIN } from './helpers';
import type { DemoStore } from '../src/lib/store/demo';
import { SOCIAL_LIMITS } from '../src/lib/rules/social';
import { cleanGameInput } from '../src/lib/rules/games';

/** Ospite visibile con regole accettate. */
async function member(store: DemoStore, clock: ReturnType<typeof makeClock>, name: string, days = 5) {
  const r = await store.startStay({ slug: 'demo', qrToken: 'demo-qr-token', identity: demoIdentity(name), locale: 'it', checkout: dayPlus(clock, days), isAdult: true, socialOptIn: true });
  const g = (await store.guest(r.session))!;
  const s = g.social();
  await s.acceptRules();
  return { g, s, id: (await s.settings()).id };
}
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { reason?: string }) => e?.reason ?? 'error');
const inMin = (clock: ReturnType<typeof makeClock>, m: number) => new Date(clock.now().getTime() + m * MIN).toISOString();

test('giochi: la sala giochi non si prenota, i suoi giochi sono separati', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const facs = await a.g.facilities();
  assert.ok(!facs.some((f) => f.kind === 'gamesroom'), 'nessuna sala giochi tra i servizi');
  const games = await a.g.games();
  assert.deepEqual(games.map((x) => x.name.it), ['Ping pong', 'Calcio balilla', 'Biliardo']);
});

test('giochi: il pannello aggiunge, nasconde ed elimina; l\'ospite vede solo quelli visibili', async () => {
  const { store, clock } = makeStore();
  const ad = await admin(store);
  const a = await member(store, clock, 'Anna');
  await ad.saveGame({ name: { it: 'Freccette', ru: 'Дартс' }, location: 'Bar', active: true });
  const all = await ad.games();
  assert.equal(all.at(-1)?.name.ru, 'Дартс');
  const ping = all.find((x) => x.name.it === 'Ping pong')!;
  await ad.saveGame({ id: ping.id, name: ping.name, active: false });
  assert.deepEqual((await a.g.games()).map((x) => x.name.it), ['Calcio balilla', 'Biliardo', 'Freccette']);
  await ad.deleteGame(all.at(-1)!.id);
  assert.equal((await ad.games()).length, 3);
  assert.throws(() => cleanGameInput({ name: { it: '  ' }, active: true }), { reason: 'invalid_game' });
  assert.throws(() => cleanGameInput({ name: { it: 'x'.repeat(61) }, active: true }), { reason: 'invalid_game' });
});

test('sfida pubblica: la accetta il primo, gli altri arrivano tardi; chi sfida non accetta da solo', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const c = await member(store, clock, 'Carla');
  const game = (await a.g.games())[0];
  const ch = await a.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 15), stake: 'coffee' });
  assert.equal(ch.scope, 'public');
  assert.equal(ch.canCancel, true);
  assert.equal(await code(a.s.respondChallenge(ch.id, true)), 'forbidden');
  const seenByB = (await b.s.challenges()).find((x) => x.id === ch.id)!;
  assert.equal(seenByB.canAccept, true);
  assert.equal(seenByB.canDecline, false);
  assert.equal(await code(b.s.respondChallenge(ch.id, false)), 'forbidden'); // in pubblico non si rifiuta
  await b.s.respondChallenge(ch.id, true);
  assert.equal(await code(c.s.respondChallenge(ch.id, true)), 'challenge_closed');
  const seenByC = (await c.s.challenges()).find((x) => x.id === ch.id)!;
  assert.equal(seenByC.status, 'accepted');
  assert.equal(seenByC.opponent?.nickname, 'Bruno');
  assert.equal(seenByC.meOpponent, false);
  assert.equal((await b.s.challenges()).find((x) => x.id === ch.id)!.meOpponent, true);
});

test('sfida: orario tra 5 minuti e 12 ore, posta solo tra quelle fisse, gioco attivo', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const game = (await a.g.games())[0];
  assert.equal(await code(a.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 2), stake: 'coffee' })), 'invalid_time');
  assert.equal(await code(a.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 13 * 60), stake: 'coffee' })), 'invalid_time');
  assert.equal(await code(a.s.createChallenge({ gameId: game.id, startsAt: 'non una data', stake: 'coffee' })), 'invalid_time');
  assert.equal(await code(a.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 15), stake: 'soldi' as never })), 'invalid_stake');
  assert.equal(await code(a.s.createChallenge({ gameId: 'inesistente', startsAt: inMin(clock, 15), stake: 'coffee' })), 'invalid_game');
});

test('sfida: scade da sola all\'orario se nessuno accetta; dopo 2 ore sparisce dalla chat pubblica', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const game = (await a.g.games())[0];
  const ch = await a.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 15), stake: 'fun' });
  clock.advance(16 * MIN);
  const v = (await b.s.challenges()).find((x) => x.id === ch.id)!;
  assert.equal(v.status, 'expired');
  assert.equal(v.canAccept, false);
  assert.equal(await code(b.s.respondChallenge(ch.id, true)), 'challenge_closed');
  clock.advance(2 * HOUR);
  assert.equal((await b.s.challenges()).length, 0);
});

test('sfida privata: solo dentro una conversazione accettata; solo l\'altra parte accetta o rifiuta', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const c = await member(store, clock, 'Carla');
  const game = (await a.g.games())[1];
  const { threadId } = await a.s.startThread(b.id, 'ciao');
  assert.equal(await code(a.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 30), stake: 'aperitif', threadId })), 'thread_not_open');
  await b.s.respond(threadId, true);
  const ch = await a.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 30), stake: 'aperitif', threadId });
  assert.equal(ch.scope, 'private');
  assert.equal(ch.opponent?.nickname, 'Bruno');
  assert.equal((await a.s.challenges()).some((x) => x.id === ch.id), false, 'non compare nella chat pubblica');
  assert.equal(await code(c.s.challenges(threadId)), 'invalid_thread');
  assert.equal(await code(c.s.respondChallenge(ch.id, true)), 'invalid_challenge');
  const seen = (await b.s.challenges(threadId))[0];
  assert.equal(seen.canAccept && seen.canDecline && seen.meOpponent, true);
  await b.s.respondChallenge(ch.id, false);
  assert.equal((await a.s.challenges(threadId))[0].status, 'declined');
  assert.equal(await code(a.s.cancelChallenge(ch.id)), 'challenge_closed');
});

test('sfida: blocco annulla le sfide tra le due parti e nasconde quelle pubbliche di chi e\' bloccato', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const game = (await a.g.games())[0];
  const pub = await a.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 20), stake: 'coffee' });
  await b.s.respondChallenge(pub.id, true);
  const other = await a.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 40), stake: 'fun' });
  await b.s.block(a.id);
  assert.equal((await b.s.challenges()).length, 0, 'Bruno non vede piu\' le sfide di Anna');
  assert.equal(await code(b.s.respondChallenge(other.id, true)), 'invalid_challenge');
  assert.equal((await a.s.challenges()).some((x) => x.id === pub.id), false, 'la sfida accettata tra i due e\' annullata');
});

test('sfida: limiti giornalieri e di sfide aperte; annullare libera un posto', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const game = (await a.g.games())[0];
  const ids: string[] = [];
  for (let i = 0; i < SOCIAL_LIMITS.challengesOpenPerChallenger; i++) {
    ids.push((await a.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 15 + i), stake: 'fun' })).id);
    clock.advance(SOCIAL_LIMITS.publicWindowMs);
  }
  assert.equal(await code(a.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 30), stake: 'fun' })), 'challenge_active_limit');
  await a.s.cancelChallenge(ids[0]);
  await a.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 30), stake: 'fun' });
  clock.advance(SOCIAL_LIMITS.publicWindowMs);
  await a.s.cancelChallenge(ids[1]);
  await a.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 30), stake: 'fun' });
  clock.advance(SOCIAL_LIMITS.publicWindowMs);
  await a.s.cancelChallenge(ids[2]);
  assert.equal(await code(a.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 30), stake: 'fun' })), 'challenge_daily_limit');
});

test('sfida: chi e\' silenziato non sfida e non accetta; al check-out le sue sfide spariscono', async () => {
  const { store, clock } = makeStore();
  const a = await member(store, clock, 'Anna');
  const b = await member(store, clock, 'Bruno');
  const game = (await a.g.games())[0];
  const ch = await a.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 20), stake: 'coffee' });
  const ad = await admin(store);
  await ad.social().muteGuest(b.id, true, 60);
  assert.equal(await code(b.s.respondChallenge(ch.id, true)), 'muted');
  assert.equal(await code(b.s.createChallenge({ gameId: game.id, startsAt: inMin(clock, 20), stake: 'coffee' })), 'muted');
  await a.g.endMyStay();
  assert.equal((await b.s.challenges()).length, 0);
});
