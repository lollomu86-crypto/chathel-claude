import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, CONTENT_LOCALES } from '../src/lib/types';
import { makeT, messages } from '../src/lib/i18n';
import { emergencyMessage } from '../src/lib/ai/emergency';
import { isEmergency, preCheck } from '../src/lib/ai/guardrails';
import { pick } from '../src/lib/format';
import { welcomeFor } from '../src/lib/rules/features';
import { onboarding, type Ctx } from '../src/lib/api/handlers';
import type { GuestIdentityProvider } from '../src/lib/auth/guest-identity';
import type { Store } from '../src/lib/store/types';
import { makeStore, demoIdentity, dayPlus } from './helpers';

const NEW = ['fr', 'es', 'nl', 'pl', 'sv', 'pt', 'cs', 'zh'] as const;

test('12 lingue: le nuove traducono l\'app ospite, le sezioni del personale ripiegano sull\'inglese', () => {
  assert.equal(LOCALES.length, 12);
  for (const l of NEW) assert.ok(messages[l], l);
  assert.equal(makeT('fr')('nav.home'), 'Accueil');
  assert.equal(makeT('zh')('onboarding.hello', { name: 'Li' }), '您好，Li');
  assert.equal(makeT('es')('admin.settings.title'), makeT('en')('admin.settings.title'), 'pannello in inglese');
  assert.equal(makeT('pl')('errors.identity_required'), 'Zaloguj się ponownie przez Google, aby kontynuować.');
});

test('emergenza: messaggio fisso con il 112 in tutte le lingue, con il numero della reception se c\'e\'', () => {
  for (const l of LOCALES) {
    assert.match(emergencyMessage(l), /112/, l);
    assert.ok(emergencyMessage(l, 'interno 9').includes('interno 9'), l);
  }
  assert.notEqual(emergencyMessage('fr'), emergencyMessage('it'));
});

test('emergenza riconosciuta anche nelle 8 lingue nuove (cinese senza spazi compreso)', () => {
  const yes = ['Au secours, il y a un incendie', 'Necesito un médico ahora', 'Bel een dokter!', 'Pożar w pokoju', 'Det brinner!',
    'Não consigo respirar', 'Zavolejte záchranku', '救命！着火了', '我朋友晕倒了'];
  for (const t of yes) assert.equal(isEmergency(t), true, t);
  const no = ['À quelle heure est le petit déjeuner ?', '¿A qué hora abre la piscina?', 'Hoe laat is het ontbijt?',
    'O której jest śniadanie?', 'Hur dags öppnar poolen?', 'A que horas é o pequeno-almoço?', 'Kdy je snídaně?', '早餐几点开始？'];
  for (const t of no) assert.equal(isEmergency(t), false, t);
  assert.equal(preCheck('Je suis allergique aux noix')?.kind, 'allergy');
  assert.equal(preCheck('我对坚果过敏')?.kind, 'allergy');
});

test('testi scritti dall\'hotel (it/en/de/ru): chi usa una lingua nuova legge l\'inglese prima della lingua dell\'hotel', () => {
  assert.deepEqual([...CONTENT_LOCALES], ['it', 'en', 'de', 'ru']);
  assert.equal(pick({ it: 'Aperitivo', en: 'Aperitivo (EN)' }, 'fr', 'it'), 'Aperitivo (EN)');
  assert.equal(pick({ it: 'Aperitivo' }, 'zh', 'it'), 'Aperitivo');
  assert.equal(pick({ it: 'Aperitivo', en: 'Drinks', de: 'Aperitif' }, 'de', 'it'), 'Aperitif');
  assert.equal(pick({ it: 'Aperitivo', en: 'Drinks' }, 'it', 'it'), 'Aperitivo');
  assert.equal(welcomeFor({ it: 'Benvenuti', en: 'Welcome' }, 'es', 'it'), 'Welcome');
  assert.equal(welcomeFor({ it: 'Benvenuti' }, 'sv', 'it'), 'Benvenuti');
});

test('demo: si entra direttamente in una lingua nuova', async () => {
  const { store, clock } = makeStore();
  const r = await store.startStay({ slug: 'demo', qrToken: 'demo-qr-token', identity: demoIdentity('Pierre'), locale: 'fr', checkout: dayPlus(clock, 3), isAdult: true });
  assert.equal((await (await store.guest(r.session))!.view()).locale, 'fr');
});

test('Supabase: start_stay conosce solo it/en/de/ru, quindi dopo l\'ingresso si salva la lingua scelta', async (t) => {
  const prev = process.env.IDENTITY_PEPPER;
  process.env.IDENTITY_PEPPER = 'pepe-di-prova-abbastanza-lungo';
  t.after(() => { if (prev === undefined) delete process.env.IDENTITY_PEPPER; else process.env.IDENTITY_PEPPER = prev; });
  const saved: string[] = [];
  const idp: GuestIdentityProvider = { mode: 'supabase', verify: async () => ({ identity: { provider: 'google', subject: 'g', givenName: 'Ana' }, authUserId: 'u' }), register: async () => true };
  let entered = false;
  const store = {
    mode: 'supabase',
    guest: async () => (entered ? { setLocale: async (l: string) => { saved.push(l); } } : null),
    startStay: async () => { entered = true; return { session: 's', bonus: 'issued' }; },
  } as unknown as Store;
  const ctx: Ctx = { store, identityProvider: idp, identityCookie: 'c', ip: 'unknown', method: 'POST' };
  const body = { slug: 'hotel-prova', k: '967991', checkout: '2026-11-20', isAdult: true, consent: true };
  assert.equal((await onboarding(ctx, { ...body, locale: 'pt' })).status, 200);
  assert.deepEqual(saved, ['pt']);
  entered = false;
  await onboarding({ ...ctx }, { ...body, locale: 'de' });
  assert.deepEqual(saved, ['pt'], 'le lingue gia\' note al database non richiedono il passo in piu\'');
});
