import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onboarding, type Ctx } from '../src/lib/api/handlers';
import type { GuestIdentityProvider, VerifiedIdentity } from '../src/lib/auth/guest-identity';
import type { Store } from '../src/lib/store/types';

// Al check-out il registro delle identita' si cancella, ma l'utente auth di chi e' anche staff resta (e il suo accesso
// Google resta valido): l'ingresso deve ri-registrare l'identita' PRIMA di start_stay, altrimenti identity_required e
// l'ospite torna al login Google in un giro senza uscita.
test('ingresso con Supabase: l\'identita\' si ri-registra prima di creare il soggiorno', async (t) => {
  const prev = process.env.IDENTITY_PEPPER;
  process.env.IDENTITY_PEPPER = 'pepe-di-prova-abbastanza-lungo';
  t.after(() => { if (prev === undefined) delete process.env.IDENTITY_PEPPER; else process.env.IDENTITY_PEPPER = prev; });
  const order: string[] = [];
  const v: VerifiedIdentity = { identity: { provider: 'google', subject: 'g-1', givenName: 'Lorenzo' }, authUserId: 'u-staff' };
  const idp: GuestIdentityProvider = {
    mode: 'supabase',
    verify: async () => v,
    register: async (x) => { order.push(`register:${x.authUserId}`); return true; },
  };
  const store = {
    mode: 'supabase',
    guest: async () => null,
    startStay: async (i: { authUserId?: string }) => { order.push(`start_stay:${i.authUserId}`); return { session: 'cred', bonus: 'issued' }; },
  } as unknown as Store;
  const ctx: Ctx = { store, identityProvider: idp, identityCookie: 'cred', ip: 'unknown', method: 'POST' };
  const r = await onboarding(ctx, { slug: 'hotel-prova', k: '967991', locale: 'it', checkout: '2026-11-12', isAdult: true, consent: true });
  assert.equal(r.status, 200);
  assert.deepEqual(order, ['register:u-staff', 'start_stay:u-staff']);
});
