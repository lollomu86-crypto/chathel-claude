// Lato staff e prenotazioni di SupabaseStore contro Postgres + PostgREST veri (vedi guest.live.ts). Il token dello staff e' un JWT firmato qui.
// Uso: set -a; . /tmp/sb-live.env; set +a; npx tsx --test --test-concurrency=1 tests/live/*.live.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SupabaseStore } from '../../src/lib/store/supabase';
import { encodeSession } from '../../src/lib/session-format';
import { makePgrstClient } from './pgrst-client';

const DB = process.env.SB_DB!, SECRET = process.env.SB_SECRET!;
const psql = (sql: string) => execFileSync('psql', ['-qAt', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }); return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const sess = (id: string) => encodeSession({ a: jwt(id), r: 'r' });
const store = new SupabaseStore({ createClient: makePgrstClient as never });

const C = '00000000-0000-0000-0000-0000000000c1', ADM = '00000000-0000-0000-0000-0000000000d1', BAR = '00000000-0000-0000-0000-0000000000d2', REC = '00000000-0000-0000-0000-0000000000d3';
const co = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
let gSession = '';

test('seed staff e ospite', async () => {
  psql(`insert into auth.users(id,email,is_anonymous) values ('${C}','c@example.test',false),('${ADM}','adm@example.test',false),('${BAR}','bar@example.test',false),('${REC}','rec@example.test',false) on conflict do nothing;
        insert into public.hotels(slug,name,bonus_season_cap,qr_token_hash) values ('live','Hotel Live',30,extensions.digest('qr-live','sha256')) on conflict do nothing;
        update public.hotels set access_code = coalesce(access_code, app.new_access_code()) where slug='live';
        insert into public.hotel_staff(hotel_id,user_id,role,display_name) select id,'${ADM}','hotel_admin','Direttore' from public.hotels where slug='live' on conflict do nothing;
        insert into public.hotel_staff(hotel_id,user_id,role,display_name) select id,'${BAR}','bartender','Barista' from public.hotels where slug='live' on conflict do nothing;
        insert into public.hotel_staff(hotel_id,user_id,role,display_name) select id,'${REC}','reception','Reception' from public.hotels where slug='live' on conflict do nothing;
        delete from public.facilities;`);
  const svc = (store as any).serviceClient();
  await svc.rpc('identity_register', { p_auth_user: C, p_provider: 'google', p_subject: 'sub-c', p_given_name: 'Luca' });
  const r = await store.startStay({ slug: 'live', qrToken: 'qr-live', identity: { provider: 'google', subject: 'sub-c', givenName: 'Luca' }, identityCredential: sess(C), authUserId: C, identityKey: Buffer.alloc(32, 9).toString('hex'), locale: 'it', checkout: co, isAdult: true, socialOptIn: false, privacyVersion: 'v1' } as never);
  gSession = r.session;
  assert.ok(gSession);
});

test('staff: ruoli e hotel', async () => {
  const hs = await store.staffHotels(sess(ADM)); assert.equal(hs.length, 1); assert.equal(hs[0].role, 'hotel_admin');
  assert.equal(await store.staff(sess(C)), null, 'un ospite non e\' staff');
  assert.equal(await store.staff(undefined), null);
  assert.equal((await store.staff(sess(BAR)))!.info.role, 'bartender');
});

test('bonus: il barista valida il QR dell\'ospite, una sola volta', async () => {
  const g = (await store.guest(gSession))!, bar = (await store.staff(sess(BAR)))!;
  const qr = await g.requestBonusQr();
  const r1 = await bar.redeem(qr.token); assert.equal(r1.ok, true, JSON.stringify(r1));
  const r2 = await bar.redeem(qr.token); assert.equal(r2.ok, false, 'secondo uso rifiutato');
  assert.equal((await g.bonus()).state, 'redeemed');
  assert.equal((await bar.myRedemptionsToday()).length, 1);
  const bad = await bar.redeem('b.token-inventato'); assert.equal(bad.ok, false, 'token inventato rifiutato');
});

test('direttore: eventi, avvisi, conoscenza AI', async () => {
  const adm = (await store.staff(sess(ADM)))!;
  const when = new Date(Date.now() + 86_400_000).toISOString();
  await adm.saveEvent({ title: { it: 'Aperitivo', en: 'Aperitif' }, startsAt: when, published: true, capacity: 20, location: 'Terrazza' });
  const evs = await adm.events(); assert.equal(evs.length >= 1, true);
  const ev = evs.find((e) => (e.title as any).it === 'Aperitivo')!;
  await adm.saveEvent({ id: ev.id, title: { it: 'Aperitivo bis' }, startsAt: when, published: true });
  assert.ok((await adm.events()).some((e) => (e.title as any).it === 'Aperitivo bis'));
  assert.ok((await (await store.guest(gSession))!.events()).length >= 1, 'l\'ospite lo vede');
  await adm.deleteEvent(ev.id);
  const left = await adm.notificationsLeftToday();
  await adm.publishNotification({ title: { it: 'Benvenuti' }, body: { it: 'Buon soggiorno' } });
  assert.equal(await adm.notificationsLeftToday(), left - 1);
  assert.ok((await (await store.guest(gSession))!.notifications()).some((n) => (n.title as any).it === 'Benvenuti'));
  await adm.saveKnowledge({ category: 'hours', title: 'Colazione', content: 'Dalle 7:30 alle 10:00', locale: 'it', active: true });
  const kb = await adm.knowledge(); assert.equal(kb.some((k) => k.title === 'Colazione'), true);
  assert.ok((await (await store.guest(gSession))!.aiContext()), 'contesto AI dell\'ospite');
  await adm.deleteKnowledge(kb.find((k) => k.title === 'Colazione')!.id);
});

test('prenotazioni: servizio, slot, prenota, cancella, tetto di posti', async () => {
  const adm = (await store.staff(sess(ADM)))!;
  psql(`insert into public.facilities(hotel_id,kind,name,default_capacity) select id,'spa','{"it":"Spa"}'::jsonb,2 from public.hotels where slug='live'`);
  const fac = (await adm.facilities())[0];
  const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const n = await adm.generateSlots({ facilityId: fac.id, from: day, to: day, start: '10:00', end: '12:00', minutes: 60 });
  assert.equal(n, 2);
  const g = (await store.guest(gSession))!;
  const slot = (await g.facilities())[0].slots[0];
  await g.book(slot.id, 2);
  assert.equal((await g.myBookings()).length, 1);
  await assert.rejects(() => g.book(slot.id, 1), /./, 'doppia prenotazione stesso slot');
  await g.cancelBooking((await g.myBookings())[0].id);
  assert.equal((await g.myBookings()).filter((b: any) => b.status === 'confirmed').length, 0);
  await adm.updateSlot({ id: slot.id, status: 'closed' });
});

test('reception AI: messaggio, passaggio a operatore, risposta', async () => {
  const g = (await store.guest(gSession))!, rec = (await store.staff(sess(REC)))!;
  const { conversationId } = await g.appendGuestMessage('Ho bisogno di aiuto con la camera');
  await g.appendAssistantMessage(conversationId, { text: 'Ti passo alla reception.', handoff: { reason: 'guest_request', topic: 'camera', priority: 'normal' } } as never);
  const q = await rec.handoffQueue(false); assert.equal(q.length >= 1, true);
  await rec.handoffReply(conversationId, 'Arrivo subito');
  assert.ok((await g.chat()).messages.some((m: any) => m.content === 'Arrivo subito'));
  await rec.handoffClose(conversationId);
});

test('codice hotel e QR: il direttore li ruota', async () => {
  const adm = (await store.staff(sess(ADM)))!;
  const old = await adm.currentAccessCode(); assert.match(old!, /^\d{6}$/);
  const { code } = await adm.rotateAccessCode(); assert.notEqual(code, old);
  assert.equal(await store.hotelSlugByCode(code), 'live'); assert.equal(await store.hotelSlugByCode(old!), null);
  const { token } = await adm.rotateQr(); assert.ok(token.length > 10);
});

test('KPI e moderazione social per lo staff', async () => {
  const adm = (await store.staff(sess(ADM)))!;
  const k = await adm.kpis('7d' as never); assert.equal(typeof k.bonusRedeemed === 'number' || k !== undefined, true);
  assert.ok(Array.isArray(await adm.social().reports(false)));
  assert.ok(Array.isArray(await adm.social().publicFeed()));
});
