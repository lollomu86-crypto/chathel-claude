// Web Push (RFC 8030) con cifratura aes128gcm (RFC 8291) e autenticazione VAPID (RFC 8292), solo con node:crypto + fetch.
// Senza le variabili VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT tutto e' disattivato (nessun errore).
import { createECDH, createCipheriv, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';

export interface PushSub { endpoint: string; p256dh: string; auth: string }
export interface VapidConfig { publicKey: string; privateKey: string; subject: string }
export type SendResult = 'ok' | 'gone' | 'error';

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

// Servizi push dei browser: Chrome/Android/Opera/Samsung (FCM), Firefox (Mozilla), Safari (Apple), Edge (WNS).
// Il server manda richieste solo a questi host: un indirizzo scelto dal client non puo' far chiamare altro (SSRF).
const PUSH_HOSTS = ['fcm.googleapis.com'];
const PUSH_HOST_SUFFIXES = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s));
  } catch {
    return false;
  }
}

export function vapidFromEnv(env: Record<string, string | undefined> = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim(), privateKey = env.VAPID_PRIVATE_KEY?.trim(), subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (fromB64u(publicKey).length !== 65 || fromB64u(privateKey).length !== 32) return null;
  return { publicKey, privateKey, subject };
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const e = createECDH('prime256v1');
  e.generateKeys();
  return { publicKey: b64u(e.getPublicKey()), privateKey: b64u(e.getPrivateKey()) };
}

/** Cifra il contenuto per un browser (RFC 8291, un solo record). */
export function encryptPayload(sub: PushSub, plaintext: Buffer): Buffer {
  const uaPublic = fromB64u(sub.p256dh), authSecret = fromB64u(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('bad_subscription');
  const as = createECDH('prime256v1');
  as.generateKeys();
  const asPublic = as.getPublicKey();
  const shared = as.computeSecret(uaPublic);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([plaintext, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

export function vapidAuthHeader(endpoint: string, v: VapidConfig, nowSec = Math.floor(Date.now() / 1000)): string {
  const aud = new URL(endpoint).origin;
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: v.subject })));
  const pub = fromB64u(v.publicKey);
  const key = createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: v.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  const sig = sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${v.publicKey}`;
}

export async function sendPush(sub: PushSub, payload: object, v: VapidConfig, opts: { ttl?: number; urgency?: 'normal' | 'high' } = {}): Promise<SendResult> {
  // iscrizione verso un host non riconosciuto (salvata prima del controllo): non si chiama, e si cancella
  if (!isPushEndpoint(sub.endpoint)) return 'gone';
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(opts.ttl ?? 3600),
        Urgency: opts.urgency ?? 'normal', Authorization: vapidAuthHeader(sub.endpoint, v),
      },
      body: new Uint8Array(encryptPayload(sub, Buffer.from(JSON.stringify(payload)))),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'error';
  } catch { return 'error'; }
}
