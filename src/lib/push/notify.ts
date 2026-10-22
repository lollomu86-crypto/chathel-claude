// Invio delle notifiche push agli ospiti. Il testo e' SEMPRE generico (mai contenuto dei messaggi ne' nickname),
// tranne gli avvisi dell'hotel, che sono testo pubblico scritto dall'hotel. Errori e mancanza di configurazione: silenzio.
import { randomBytes } from 'node:crypto';
import { vapidFromEnv, sendPush, type PushSub } from './webpush';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Locale4 = 'it' | 'en' | 'de' | 'ru';
export interface PushPrefs { announcements: boolean; reception: boolean; private: boolean; public: boolean }
export const DEFAULT_PREFS: PushPrefs = { announcements: true, reception: true, private: true, public: false };
export const MAX_RECIPIENTS = 300;
const PUBLIC_THROTTLE_MS = 10 * 60_000;

const TEXT: Record<'reception' | 'private' | 'public', Record<Locale4, { title: string; body: string }>> = {
  reception: {
    it: { title: 'Reception', body: 'La reception ti ha risposto.' },
    en: { title: 'Reception', body: 'The front desk has replied to you.' },
    de: { title: 'Rezeption', body: 'Die Rezeption hat dir geantwortet.' },
    ru: { title: 'Ресепшн', body: 'Ресепшн ответил вам.' },
  },
  private: {
    it: { title: 'Messaggio privato', body: 'Hai un nuovo messaggio privato.' },
    en: { title: 'Private message', body: 'You have a new private message.' },
    de: { title: 'Private Nachricht', body: 'Du hast eine neue private Nachricht.' },
    ru: { title: 'Личное сообщение', body: 'У вас новое личное сообщение.' },
  },
  public: {
    it: { title: 'Chat dell\'hotel', body: 'Ci sono nuovi messaggi nella chat pubblica.' },
    en: { title: 'Hotel chat', body: 'There are new messages in the public chat.' },
    de: { title: 'Hotel-Chat', body: 'Es gibt neue Nachrichten im öffentlichen Chat.' },
    ru: { title: 'Чат отеля', body: 'В общем чате есть новые сообщения.' },
  },
};
const URLS = { reception: '/stay/reception', private: '/stay/social?tab=private', public: '/stay/social', announcements: '/stay/inbox' } as const;

const loc = (v: unknown): Locale4 => (v === 'en' || v === 'de' || v === 'ru' ? v : 'it');
const pick = (o: any, l: Locale4): string => (o && typeof o === 'object' ? String(o[l] ?? o.it ?? o.en ?? Object.values(o)[0] ?? '') : '');

export function cleanPrefs(v: unknown, base: PushPrefs = DEFAULT_PREFS): PushPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const b = (k: keyof PushPrefs) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : base[k]);
  return { announcements: b('announcements'), reception: b('reception'), private: b('private'), public: b('public') };
}

/** Esegue il lavoro dopo la risposta HTTP quando possibile (Next `after`), altrimenti lo attende. Non lancia mai. */
export async function defer(task: () => Promise<unknown>): Promise<void> {
  const run = () => task().catch(() => undefined);
  try {
    const mod: any = await import('next/server');
    if (typeof mod.after !== 'function') throw new Error('no_after');
    mod.after(run);
  } catch { await run(); }
}

type Kind = keyof PushPrefs;

/**
 * Tag della notifica sul telefono: uguale = sostituisce la precedente. Ogni avviso, risposta o messaggio privato ha un tag
 * proprio (restano tutti visibili); la chat pubblica no: "ci sono nuovi messaggi" sostituisce il precedente.
 */
export function pushTag(kind: Kind): string {
  return kind === 'public' ? 'public' : `${kind}-${randomBytes(6).toString('hex')}`;
}

/**
 * Solo le iscrizioni di ospiti con un soggiorno attivo e non scaduto: se la cancellazione al check-out non e' ancora
 * passata, l'ospite uscito non riceve piu' nulla. A blocchi, per non superare la lunghezza massima dell'URL di PostgREST.
 */
export async function activeOnly(db: any, hotelId: string, rows: any[]): Promise<any[]> {
  const ids = [...new Set(rows.map((r) => r.guest_id).filter(Boolean))] as string[];
  if (!ids.length) return [];
  const now = new Date().toISOString();
  const active = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from('stays').select('guest_id').eq('hotel_id', hotelId).eq('status', 'active')
      .gt('expires_at', now).in('guest_id', ids.slice(i, i + 100));
    if (error) return []; // nel dubbio non si avvisa nessuno
    for (const s of data ?? []) active.add(s.guest_id);
  }
  return rows.filter((r) => active.has(r.guest_id));
}

async function deliver(db: any, rows: any[], kind: Kind, build: (l: Locale4) => { title: string; body: string }): Promise<void> {
  const v = vapidFromEnv();
  if (!v || !rows.length) return;
  const gone: string[] = [];
  const tag = pushTag(kind);
  // urgenza alta: senza, Android in risparmio energetico puo' consegnare con minuti di ritardo. La chat pubblica resta normale.
  const urgency = kind === 'public' ? 'normal' : 'high';
  await Promise.allSettled(rows.slice(0, MAX_RECIPIENTS).map(async (r) => {
    const l = loc(r.locale);
    const m = build(l);
    const sub: PushSub = { endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth };
    const res = await sendPush(sub, { title: m.title, body: m.body, url: URLS[kind], tag }, v, { ttl: kind === 'public' ? 600 : 3600, urgency });
    if (res === 'gone') gone.push(r.id);
  }));
  if (gone.length) await db.from('push_subscriptions').delete().in('id', gone);
}

const cols = 'id, guest_id, endpoint, p256dh, auth, locale';
const wants = (kind: Kind) => `prefs->>${kind}`;

/** Avviso dell'hotel a tutti gli ospiti iscritti (testo e titolo scritti dall'hotel). */
export async function pushAnnouncement(db: any, hotelId: string, title: any, body: any, hotelName = ''): Promise<void> {
  if (!vapidFromEnv()) return;
  const { data } = await db.from('push_subscriptions').select(cols).eq('hotel_id', hotelId).filter(wants('announcements'), 'eq', 'true').limit(MAX_RECIPIENTS);
  await deliver(db, await activeOnly(db, hotelId, data ?? []), 'announcements', (l) => ({ title: hotelName || 'ChatHel', body: [pick(title, l), pick(body, l)].filter(Boolean).join(' — ') }));
}

/** Risposta della reception in una conversazione: avvisa l'ospite della conversazione. */
export async function pushReceptionReply(db: any, hotelId: string, conversationId: string): Promise<void> {
  if (!vapidFromEnv()) return;
  const { data: c } = await db.from('ai_conversations').select('guest_id').eq('id', conversationId).eq('hotel_id', hotelId).maybeSingle();
  if (!c?.guest_id) return;
  const { data } = await db.from('push_subscriptions').select(cols).eq('hotel_id', hotelId).eq('guest_id', c.guest_id).filter(wants('reception'), 'eq', 'true');
  await deliver(db, await activeOnly(db, hotelId, data ?? []), 'reception', (l) => TEXT.reception[l]);
}

async function pushGuests(db: any, hotelId: string, guestIds: string[]): Promise<void> {
  if (!guestIds.length) return;
  const { data } = await db.from('push_subscriptions').select(cols).eq('hotel_id', hotelId).in('guest_id', guestIds).filter(wants('private'), 'eq', 'true');
  await deliver(db, await activeOnly(db, hotelId, data ?? []), 'private', (l) => TEXT.private[l]);
}

/** Messaggio privato: avvisa l'altra parte del thread (non chi scrive). `threadId` oppure `toProfileId` (inizio conversazione). */
export async function pushPrivate(db: any, hotelId: string, fromGuestId: string, target: { threadId?: string; toProfileId?: string }): Promise<void> {
  if (!vapidFromEnv()) return;
  let profileIds: string[] = [];
  if (target.threadId) {
    const { data: t } = await db.from('social_threads').select('initiator_id, recipient_id').eq('id', target.threadId).eq('hotel_id', hotelId).maybeSingle();
    if (t) profileIds = [t.initiator_id, t.recipient_id];
  } else if (target.toProfileId) profileIds = [target.toProfileId];
  if (!profileIds.length) return;
  const { data: ps } = await db.from('social_profiles').select('guest_id').eq('hotel_id', hotelId).in('id', profileIds);
  await pushGuests(db, hotelId, (ps ?? []).map((p: any) => p.guest_id).filter((g: string) => g && g !== fromGuestId));
}

const CHALLENGE_TEXT: Record<'received' | 'accepted', Record<Locale4, { title: string; body: string }>> = {
  received: {
    it: { title: 'Nuova sfida', body: 'Qualcuno ti ha sfidato. Apri la chat per rispondere.' },
    en: { title: 'New challenge', body: 'Someone has challenged you. Open the chat to reply.' },
    de: { title: 'Neue Herausforderung', body: 'Jemand hat dich herausgefordert. Öffne den Chat, um zu antworten.' },
    ru: { title: 'Новый вызов', body: 'Вас вызвали на игру. Откройте чат, чтобы ответить.' },
  },
  accepted: {
    it: { title: 'Sfida accettata', body: 'La tua sfida è stata accettata.' },
    en: { title: 'Challenge accepted', body: 'Your challenge has been accepted.' },
    de: { title: 'Herausforderung angenommen', body: 'Deine Herausforderung wurde angenommen.' },
    ru: { title: 'Вызов принят', body: 'Ваш вызов приняли.' },
  },
};

/**
 * Sfida: avvisa l'altra persona (sfida privata ricevuta, oppure sfida accettata per chi l'ha lanciata).
 * Testo generico (mai gioco, posta o nickname); segue la preferenza dei messaggi privati.
 */
export async function pushChallenge(db: any, hotelId: string, fromGuestId: string, toProfileId: string, what: 'received' | 'accepted', url: string): Promise<void> {
  if (!vapidFromEnv()) return;
  const { data: p } = await db.from('social_profiles').select('guest_id').eq('hotel_id', hotelId).eq('id', toProfileId).maybeSingle();
  if (!p?.guest_id || p.guest_id === fromGuestId) return;
  const { data } = await db.from('push_subscriptions').select(cols).eq('hotel_id', hotelId).eq('guest_id', p.guest_id).filter(wants('private'), 'eq', 'true');
  const rows = await activeOnly(db, hotelId, data ?? []);
  const v = vapidFromEnv();
  if (!v || !rows.length) return;
  const gone: string[] = [];
  await Promise.allSettled(rows.map(async (r) => {
    const m = CHALLENGE_TEXT[what][loc(r.locale)];
    const res = await sendPush({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }, { title: m.title, body: m.body, url: /^\/[^/]/.test(url) ? url : '/stay/social', tag: pushTag('private') }, v, { ttl: 3600, urgency: 'high' });
    if (res === 'gone') gone.push(r.id);
  }));
  if (gone.length) await db.from('push_subscriptions').delete().in('id', gone);
}

/** Messaggio nella chat pubblica: solo a chi l'ha scelto, al massimo uno ogni 10 minuti, mai a chi scrive. */
export async function pushPublic(db: any, hotelId: string, fromGuestId: string): Promise<void> {
  if (!vapidFromEnv()) return;
  const since = new Date(Date.now() - PUBLIC_THROTTLE_MS).toISOString();
  const { data } = await db.from('push_subscriptions').select(`${cols}, last_public_push_at`).eq('hotel_id', hotelId).neq('guest_id', fromGuestId)
    .filter(wants('public'), 'eq', 'true').or(`last_public_push_at.is.null,last_public_push_at.lt.${since}`).limit(MAX_RECIPIENTS);
  const rows = await activeOnly(db, hotelId, data ?? []);
  if (!rows.length) return;
  await db.from('push_subscriptions').update({ last_public_push_at: new Date().toISOString() }).in('id', rows.map((r: any) => r.id));
  await deliver(db, rows, 'public', (l) => TEXT.public[l]);
}

// ---- gestione iscrizioni (solo dell'ospite autenticato)
export interface SubscribeInput { endpoint: string; p256dh: string; auth: string; locale: string; prefs?: unknown }
export async function saveSubscription(db: any, hotelId: string, guestId: string, i: SubscribeInput): Promise<PushPrefs> {
  const { data: old } = await db.from('push_subscriptions').select('prefs').eq('endpoint', i.endpoint).eq('guest_id', guestId).maybeSingle();
  const prefs = cleanPrefs(i.prefs, old ? cleanPrefs(old.prefs) : DEFAULT_PREFS);
  const r = await db.from('push_subscriptions').upsert({ hotel_id: hotelId, guest_id: guestId, endpoint: i.endpoint, p256dh: i.p256dh, auth: i.auth, locale: loc(i.locale), prefs }, { onConflict: 'endpoint' });
  if (r.error) throw r.error;
  return prefs;
}
export async function subscriptionPrefs(db: any, guestId: string, endpoint: string): Promise<PushPrefs | null> {
  const { data } = await db.from('push_subscriptions').select('prefs').eq('endpoint', endpoint).eq('guest_id', guestId).maybeSingle();
  return data ? cleanPrefs(data.prefs) : null;
}
export async function removeSubscription(db: any, guestId: string, endpoint: string): Promise<void> {
  await db.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('guest_id', guestId);
}
