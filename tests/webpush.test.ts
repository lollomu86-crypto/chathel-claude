import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { encryptPayload, generateVapidKeys, isPushEndpoint, sendPush, vapidAuthHeader, vapidFromEnv } from '../src/lib/push/webpush';
import { activeOnly, pushAnnouncement, pushTag } from '../src/lib/push/notify';

test('cifratura aes128gcm: il browser riesce a decifrare', () => {
  const ua = createECDH('prime256v1'); ua.generateKeys();
  const auth = randomBytes(16);
  const sub = { endpoint: 'https://push.example/x', p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
  const msg = Buffer.from(JSON.stringify({ title: 'Ciao', body: 'prova àè' }));
  const rec = encryptPayload(sub, msg);
  const salt = rec.subarray(0, 16), idlen = rec[20], asPub = rec.subarray(21, 21 + idlen), data = rec.subarray(21 + idlen);
  const shared = ua.computeSecret(asPub);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2);
  assert.deepEqual(plain.subarray(0, plain.length - 1), msg);
});

test('VAPID: firma valida e chiavi dall\'ambiente', () => {
  const k = generateVapidKeys();
  const v = vapidFromEnv({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: 'mailto:a@b.it' })!;
  assert.ok(v);
  const h = vapidAuthHeader('https://fcm.googleapis.com/fcm/send/abc', v, 1000);
  const jwt = /t=([^,]+),/.exec(h)![1];
  const [hd, cl, sg] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(cl, 'base64url').toString()).aud, 'https://fcm.googleapis.com');
  const pub = Buffer.from(k.publicKey, 'base64url');
  const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } });
  assert.ok(verify('sha256', Buffer.from(`${hd}.${cl}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sg, 'base64url')));
  assert.equal(vapidFromEnv({}), null);
});

test('endpoint: solo i servizi push dei browser', () => {
  for (const u of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://web.push.apple.com/QK1', 'https://wns2-par02p.notify.windows.com/w/?token=x']) assert.equal(isPushEndpoint(u), true, u);
  for (const u of ['http://fcm.googleapis.com/fcm/send/abc', 'https://fcm.googleapis.com:8443/x', 'https://fcm.googleapis.com.evil.it/x',
    'https://evilpush.apple.com/x', 'https://user:pw@fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'https://localhost/x', 'non un url'])
    assert.equal(isPushEndpoint(u), false, u);
});

test('sendPush: verso un host non riconosciuto non chiama la rete e chiede di cancellare l\'iscrizione', async () => {
  const k = generateVapidKeys();
  const v = vapidFromEnv({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: 'mailto:a@b.it' })!;
  const ua = createECDH('prime256v1'); ua.generateKeys();
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response('ok'); }) as typeof fetch;
  try {
    const r = await sendPush({ endpoint: 'https://push.example/x', p256dh: ua.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') }, {}, v);
    assert.equal(r, 'gone');
    assert.equal(called, false);
  } finally { globalThis.fetch = orig; }
});

test('tag: unico per avviso, tranne la chat pubblica che sostituisce il precedente', () => {
  assert.notEqual(pushTag('announcements'), pushTag('announcements'));
  assert.match(pushTag('private'), /^private-[0-9a-f]{12}$/);
  assert.equal(pushTag('public'), 'public');
});

// ---- database simulato minimo: tabelle in memoria, filtri eq / gt / in / filter(prefs) / limit, delete
type Row = Record<string, any>;
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const preds: ((r: Row) => boolean)[] = [];
      let max = Infinity, del = false;
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
        gt: (c: string, v: string) => (preds.push((r) => r[c] > v), q),
        in: (c: string, v: unknown[]) => (preds.push((r) => v.includes(r[c])), q),
        filter: (c: string, _op: string, v: string) => (preds.push((r) => String(r.prefs?.[c.replace('prefs->>', '')]) === v), q),
        limit: (n: number) => ((max = n), q),
        delete: () => ((del = true), q),
        then(ok: (x: unknown) => void) {
          const hit = tables[table].filter((r) => preds.every((p) => p(r)));
          if (del) tables[table] = tables[table].filter((r) => !hit.includes(r));
          ok({ data: hit.slice(0, max), error: null });
        },
      };
      return q;
    },
  };
}

test('activeOnly: solo ospiti con soggiorno attivo e non scaduto', async () => {
  const future = new Date(Date.now() + 86_400_000).toISOString(), past = new Date(Date.now() - 60_000).toISOString();
  const db = fakeDb({ stays: [
    { guest_id: 'g1', hotel_id: 'h1', status: 'active', expires_at: future },
    { guest_id: 'g2', hotel_id: 'h1', status: 'active', expires_at: past },
    { guest_id: 'g3', hotel_id: 'h1', status: 'ended', expires_at: future },
    { guest_id: 'g4', hotel_id: 'h2', status: 'active', expires_at: future },
  ] });
  const rows = ['g1', 'g2', 'g3', 'g4', 'g5'].map((g) => ({ id: `s-${g}`, guest_id: g }));
  assert.deepEqual((await activeOnly(db, 'h1', rows)).map((r) => r.guest_id), ['g1']);
  assert.deepEqual(await activeOnly(db, 'h1', []), []);
});

test('avviso hotel: urgenza alta, tag unico, niente invio agli ospiti con soggiorno scaduto', async () => {
  const k = generateVapidKeys();
  const env = { VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: 'mailto:a@b.it' };
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const ua = createECDH('prime256v1'); ua.generateKeys();
  const key = { p256dh: ua.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
  const future = new Date(Date.now() + 86_400_000).toISOString(), past = new Date(Date.now() - 60_000).toISOString();
  const prefs = { announcements: true };
  const db = fakeDb({
    push_subscriptions: [
      { id: 's1', hotel_id: 'h1', guest_id: 'g1', endpoint: 'https://fcm.googleapis.com/fcm/send/a', locale: 'it', prefs, ...key },
      { id: 's2', hotel_id: 'h1', guest_id: 'g2', endpoint: 'https://fcm.googleapis.com/fcm/send/b', locale: 'it', prefs, ...key },
    ],
    stays: [
      { guest_id: 'g1', hotel_id: 'h1', status: 'active', expires_at: future },
      { guest_id: 'g2', hotel_id: 'h1', status: 'active', expires_at: past },
    ],
  });
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: { headers: Record<string, string> }) => { calls.push({ url, headers: init.headers }); return new Response('', { status: 201 }); }) as unknown as typeof fetch;
  try {
    await pushAnnouncement(db, 'h1', { it: 'Aperitivo' }, { it: 'Alle 19 in piscina' }, 'Hotel Prova');
    assert.deepEqual(calls.map((c) => c.url), ['https://fcm.googleapis.com/fcm/send/a']);
    assert.equal(calls[0].headers.Urgency, 'high');
  } finally {
    globalThis.fetch = orig;
    for (const n of Object.keys(env)) if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n];
  }
});
