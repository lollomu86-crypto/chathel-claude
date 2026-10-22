import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { encryptPayload, generateVapidKeys, vapidAuthHeader, vapidFromEnv } from '../src/lib/push/webpush';

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
