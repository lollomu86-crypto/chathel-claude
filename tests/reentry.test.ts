import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, demoIdentity, dayPlus } from './helpers';

// Stesso account Google su un altro telefono/browser con il soggiorno ancora aperto: si ritrova lo stesso ospite
// ("existing") e le spunte nuove NON vengono applicate dall'ingresso. EntryFlow le salva subito dopo con queste chiamate.
test('rientro con lo stesso account: soggiorno ritrovato, scelte social salvate dopo l\'ingresso', async () => {
  const { store, clock } = makeStore();
  const base = { slug: 'demo', qrToken: 'demo-qr-token', identity: demoIdentity('Lorenzo'), locale: 'it' as const, checkout: dayPlus(clock, 3), isAdult: true };
  const first = await store.startStay({ ...base, socialOptIn: false });
  assert.equal(first.bonus, 'issued');

  const again = await store.startStay({ ...base, socialOptIn: true });
  assert.equal(again.bonus, 'existing', 'nessun secondo ospite e nessun secondo bonus');
  const s = (await store.guest(again.session))!.social();
  assert.equal((await s.settings()).visible, false, 'l\'ingresso non riapplica la scelta: serve il passo successivo');
  await assert.rejects(s.acceptRules(), { reason: 'social_opt_in_required' }, 'era il caso dell\'avviso "scelte non salvate"');

  await s.updateSettings({ acceptsPrivate: true });
  await s.updateSettings({ visible: true });
  await s.acceptRules();
  const st = await s.settings();
  assert.deepEqual([st.visible, st.acceptsPrivate, st.rulesAccepted], [true, true, true]);
  assert.equal((await store.guest(first.session))!.social() !== null, true, 'la sessione di prima resta valida');
});
