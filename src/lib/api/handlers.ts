// Logica delle API, indipendente dal framework: riceve un contesto (store + cookie + IP) e un corpo
// gia' letto, ritorna {status, body, cookie da impostare}. I route file di Next.js e l'harness HTTP
// di scripts/ sono wrapper sottili su queste funzioni.
//
// Regole: nessun testo di messaggi / nickname / token nei log; errori verso il client come codici
// (reason) tradotti dalla UI; l'hotel e' sempre dedotto dalla sessione, mai dal client.

import { defer, pushAnnouncement, pushReceptionReply, removeSubscription, saveSubscription, subscriptionPrefs } from '../push/notify';
import { vapidFromEnv } from '../push/webpush';
import { z } from 'zod';
import { aiMode, answerQuestion, safetyAnswer } from '../ai';
import { raiseUrgent } from '../alerts';
import { checkEntryLimits, noteBadCode } from '../abuse';
import { identityKey, type GuestIdentityProvider } from '../auth/guest-identity';
import { ConfigError, configProblem, readEnv } from '../env';
import { ChError, httpStatusFor } from '../errors';
import { EMERGENCY_MAX_PER_MINUTE, GUEST_MESSAGES_PER_DAY, GUEST_MESSAGES_PER_MINUTE, GUEST_MESSAGE_MAX_CHARS } from '../limits';
import { logEvent } from '../log';
import { hashKey, hit, ipKey, withLock } from '../ratelimit';
import type { Store } from '../store/types';
import { isLocale, type Period } from '../types';
import { preCheck } from '../ai/guardrails';
import { makeT } from '../i18n';
import { socialGuestAction, socialStaffAction } from './social-handlers';

export interface Ctx {
  store: Store;
  guest?: string;
  staff?: string;
  /** cookie di identita' (login Google / demo) */
  identityCookie?: string;
  /** hotel scelto dallo staff con piu' hotel (cookie ch_hotel): verificato dallo store, mai preso per buono */
  hotel?: string;
  identityProvider?: GuestIdentityProvider;
  /** IP letto SOLO da un'intestazione fidata (TRUSTED_IP_HEADER); 'unknown' se non disponibile */
  ip: string;
  method: 'GET' | 'POST';
}
export interface Res {
  status: number;
  body?: Record<string, unknown>;
  /** string = imposta il cookie; null = cancellalo; undefined = non toccare */
  guestCookie?: string | null;
  staffCookie?: string | null;
  identityCookie?: string | null;
  hotelCookie?: string | null;
  csv?: { filename: string; content: string };
}

const ok = (body: Record<string, unknown> = {}): Res => ({ status: 200, body: { ok: true, ...body } });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Res => ({ status, body: { ok: false, error, ...extra } });

export function fromError(e: unknown, route: string): Res {
  if (e instanceof ChError) return fail(httpStatusFor(e.code), e.reason, { code: e.code });
  if (e instanceof ConfigError) {
    logEvent('api.config_error', { route, reason: e.code });
    return fail(503, 'service_unavailable');
  }
  if (e instanceof z.ZodError) return fail(400, 'invalid_input');
  // Si logga solo il tipo di errore: mai messaggi (potrebbero contenere dati)
  logEvent('api.error', { route, name: e instanceof Error ? e.name : 'unknown' });
  return fail(500, 'internal');
}

async function guarded(route: string, fn: () => Promise<Res>): Promise<Res> {
  try {
    return await fn();
  } catch (e) {
    return fromError(e, route);
  }
}

// ----------------------------------------------------------------------------- identita' (login Google / demo)
const noIdentity = () => fail(401, 'identity_required');

export async function identityAction(ctx: Ctx, action: string, raw: unknown): Promise<Res> {
  return guarded(`identity/${action}`, async () => {
    const p = ctx.identityProvider;
    if (!p) return fail(503, 'service_unavailable');
    const post = ctx.method === 'POST';
    switch (action) {
      case 'options':
        return ok({ mode: p.mode, demo: p.listDemo?.() ?? [] });
      case 'me': {
        const v = await p.verify(ctx.identityCookie);
        // si restituisce SOLO il nome di battesimo: mai il subject, mai e-mail o foto
        return v ? ok({ identity: { givenName: v.identity.givenName, provider: v.identity.provider } }) : { ...noIdentity(), identityCookie: null };
      }
      case 'demo-login': {
        if (!post) return fail(405, 'method_not_allowed');
        if (!p.loginDemo) return fail(404, 'not_found');
        if (!(await hit(`idl:${ipKey(ctx.ip)}`, 60, 10 * 60_000))) return fail(429, 'rate_limited');
        const b = z.object({ id: z.string().min(1).max(40) }).parse(raw);
        const r = await p.loginDemo(b.id);
        if (!r) return fail(400, 'invalid_input');
        return { ...ok({ identity: { givenName: r.identity.givenName, provider: r.identity.provider } }), identityCookie: r.credential };
      }
      case 'session': {
        if (!post) return fail(405, 'method_not_allowed');
        if (!p.exchangeSession) return fail(404, 'not_found');
        if (!(await hit(`ids:${ipKey(ctx.ip)}`, 60, 10 * 60_000))) return fail(429, 'rate_limited');
        const b = z.object({ accessToken: z.string().min(10).max(4000), refreshToken: z.string().min(1).max(500) }).parse(raw);
        const r = await p.exchangeSession(b);
        if (!r) return { ...fail(401, 'identity_invalid'), identityCookie: null };
        return { ...ok({ identity: { givenName: r.identity.givenName, provider: r.identity.provider } }), identityCookie: r.credential };
      }
      case 'logout':
        if (!post) return fail(405, 'method_not_allowed');
        return { ...ok(), identityCookie: null };
      default:
        return fail(404, 'not_found');
    }
  });
}

// ----------------------------------------------------------------------------- onboarding
const onboardingSchema = z.object({
  slug: z.string().min(2).max(60),
  k: z.string().max(200).default(''),
  /** ignorato: il nome viene dall'identita' (nome di battesimo dell'account Google) */
  name: z.string().max(60).optional(),
  nickname: z.string().max(40).optional(),
  locale: z.string(),
  checkout: z.string().max(10),
  isAdult: z.boolean().default(false),
  socialOptIn: z.boolean().default(false),
  consent: z.boolean(),
  privacyVersion: z.string().max(20).optional(),
});

export async function onboarding(ctx: Ctx, raw: unknown): Promise<Res> {
  return guarded('onboarding', async () => {
    const b = onboardingSchema.parse(raw);
    // 1. identita' verificata dal server: senza login Google (o simulato in demo) non si entra
    const verified = await ctx.identityProvider?.verify(ctx.identityCookie);
    if (!verified) return noIdentity();
    const idKey = ctx.store.mode === 'supabase' ? identityKey(verified.identity) : undefined;

    // 2. chi ha gia' una sessione valida per questo hotel non ne crea una nuova (US-02 CA3), senza consumare limiti
    const existing = await ctx.store.guest(ctx.guest);
    if (existing && (await existing.view()).hotel.slug === b.slug) return ok({ existing: true, bonus: 'existing' });

    // 3. anti-abuso: identita', codice QR, hotel, globale, (IP fidato). Il limite per IP da solo non basta.
    const scope = await checkEntryLimits({
      identityKey: idKey ?? hashKey(`${verified.identity.provider}|${verified.identity.subject}`),
      slug: b.slug, code: b.k, ip: ctx.ip === 'unknown' ? null : ctx.ip,
    });
    if (scope) {
      logEvent('stay.rate_limited', { hotel: b.slug, reason: scope });
      return fail(429, 'rate_limited');
    }
    if (b.consent !== true) return fail(400, 'consent_required');

    try {
      const r = await ctx.store.startStay({
        slug: b.slug, qrToken: b.k, identity: verified.identity, identityCredential: ctx.identityCookie, identityKey: idKey, authUserId: verified.authUserId,
        nickname: b.nickname, privacyVersion: b.privacyVersion ?? 'v1',
        locale: isLocale(b.locale) ? b.locale : 'it', checkout: b.checkout, isAdult: b.isAdult, socialOptIn: b.socialOptIn,
      });
      logEvent('stay.start', { hotel: b.slug, status: r.bonus });
      return { ...ok({ existing: r.bonus === 'existing', bonus: r.bonus }), guestCookie: r.session };
    } catch (e) {
      // QR-06: nessun dettaglio tecnico al client, evento registrato (senza il token)
      if (e instanceof ChError) {
        logEvent('stay.start_fail', { hotel: b.slug, reason: e.reason });
        if (e.reason === 'invalid_qr' && !(await noteBadCode(b.slug))) return fail(429, 'rate_limited');
      }
      throw e;
    }
  });
}

// ----------------------------------------------------------------------------- ingresso con codice numerico
/** Pubblico: dal codice a 6 cifre dell'hotel ricava l'indirizzo d'ingresso. Il codice vale come il token del QR, quindi limiti stretti. */
export async function hotelByCode(ctx: Ctx, raw: unknown): Promise<Res> {
  return guarded('hotel-by-code', async () => {
    if (ctx.method !== 'POST') return fail(405, 'method_not_allowed');
    const b = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).parse(raw);
    if (!(await hit(`hc:ip:${ipKey(ctx.ip)}`, 12, 10 * 60_000)) || !(await hit('hc:all', 600, 10 * 60_000))) return fail(429, 'rate_limited');
    const slug = await ctx.store.hotelSlugByCode(b.code);
    if (!slug) {
      // tentativi sbagliati: tetto globale contro la ricerca del codice
      if (!(await hit('hc:bad', 120, 10 * 60_000))) return fail(429, 'rate_limited');
      return fail(404, 'invalid_code');
    }
    return ok({ slug });
  });
}

// ----------------------------------------------------------------------------- ospite
const idSchema = z.string().min(1).max(80);

export async function guestAction(ctx: Ctx, action: string, raw: unknown): Promise<Res> {
  return guarded(`guest/${action}`, async () => {
    const g = await ctx.store.guest(ctx.guest);
    if (!g) return { ...fail(401, 'unauthorized'), guestCookie: null };
    const get = ctx.method === 'GET';
    switch (action) {
      case 'ping':
        return ok();
      case 'bonus':
        return ok({ bonus: await g.bonus() });
      case 'chat':
        return ok({ chat: await g.chat() });
      case 'bonus-qr': {
        if (get) return fail(405, 'method_not_allowed');
        if (!(await hit(`qr:${hashKey(ctx.guest ?? '')}`, 30, 10 * 60_000))) return fail(429, 'rate_limited');
        return ok({ qr: await g.requestBonusQr() });
      }
      case 'rsvp': {
        if (get) return fail(405, 'method_not_allowed');
        const b = z.object({ eventId: idSchema, going: z.boolean() }).parse(raw);
        await g.rsvp(b.eventId, b.going);
        return ok();
      }
      case 'book': {
        if (get) return fail(405, 'method_not_allowed');
        const b = z.object({ slotId: idSchema, partySize: z.number().int().min(1).max(10) }).parse(raw);
        await g.book(b.slotId, b.partySize);
        return ok();
      }
      case 'cancel-booking': {
        if (get) return fail(405, 'method_not_allowed');
        await g.cancelBooking(z.object({ bookingId: idSchema }).parse(raw).bookingId);
        return ok();
      }
      case 'locale': {
        if (get) return fail(405, 'method_not_allowed');
        await g.setLocale(z.object({ locale: z.enum(['it', 'en', 'de', 'ru']) }).parse(raw).locale);
        return ok();
      }
      case 'delete-me': {
        if (get) return fail(405, 'method_not_allowed');
        await g.endMyStay();
        return { ...ok(), guestCookie: null };
      }
      case 'push-config':
        return ok({ publicKey: pushDb(ctx) ? vapidFromEnv()?.publicKey ?? null : null });
      case 'push-state': case 'push-subscribe': case 'push-unsubscribe': {
        if (get) return fail(405, 'method_not_allowed');
        const db = pushDb(ctx), ids = g.pushIds?.();
        if (!db || !ids || !vapidFromEnv()) return fail(503, 'push_unavailable');
        if (!(await hit(`push:${hashKey(ctx.guest ?? '')}`, 30, 10 * 60_000))) return fail(429, 'rate_limited');
        const endpoint = z.object({ endpoint: z.string().url().max(1000).startsWith('https://') }).parse(raw).endpoint;
        if (action === 'push-state') return ok({ prefs: await subscriptionPrefs(db, ids.guestId, endpoint) });
        if (action === 'push-unsubscribe') { await removeSubscription(db, ids.guestId, endpoint); return ok(); }
        const b = z.object({ p256dh: z.string().min(80).max(200), auth: z.string().min(16).max(100), locale: z.string().max(5).default('it'), prefs: z.unknown().optional() }).parse(raw);
        return ok({ prefs: await saveSubscription(db, ids.hotelId, ids.guestId, { endpoint, p256dh: b.p256dh, auth: b.auth, locale: b.locale, prefs: b.prefs }) });
      }
      default:
        return (await socialGuestAction(ctx, g, action, raw)) ?? fail(404, 'not_found');
    }
  });
}

// ----------------------------------------------------------------------------- reception AI
const chatSchema = z.object({ text: z.string() });
const aiHotelCap = () => {
  const n = Number(readEnv('AI_HOTEL_DAILY_CAP'));
  return Number.isFinite(n) && n > 0 ? n : 2000;
};

/**
 * Ordine fisso: (1) emergenza -> fuori da OGNI limite e tetto, messaggio con il 112, avviso prioritario alla reception;
 * (2) limiti di frequenza e tetti; (3) modello. Tutto dentro una sezione critica per ospite: due richieste parallele
 * non possono superare il limite giornaliero tra il controllo e la scrittura.
 */
export async function aiChat(ctx: Ctx, raw: unknown): Promise<Res> {
  return guarded('ai/chat', async () => {
    const g = await ctx.store.guest(ctx.guest);
    if (!g) return { ...fail(401, 'unauthorized'), guestCookie: null };
    const text = chatSchema.parse(raw).text.trim();
    if (!text) return fail(400, 'invalid_input');
    if (text.length > GUEST_MESSAGE_MAX_CHARS) return fail(400, 'too_long');
    const gk = hashKey(ctx.guest ?? '');

    return withLock(`aichat:${gk}`, async () => {
      const view = await g.view();
      const t = makeT(view.locale);

      // ---- 1. emergenze
      if (preCheck(text)?.kind === 'emergency') {
        const aiCtx = await g.aiContext();
        const safe = safetyAnswer(text, view.locale, aiCtx)!;
        if (!(await hit(`em:${gk}`, EMERGENCY_MAX_PER_MINUTE, 60_000))) {
          // tetto di sicurezza contro l'allagamento del database: la risposta con il 112 c'e' comunque
          return { ...fail(429, 'rate_limited', { emergencyText: safe.text }) };
        }
        const { conversationId } = await g.appendGuestMessage(text);
        await g.appendAssistantMessage(conversationId, { text: safe.text, handoff: safe.handoff });
        await raiseUrgent({ hotelSlug: view.hotel.slug, conversationId, topic: safe.handoff?.topic ?? 'emergenza', at: new Date().toISOString() });
        logEvent('ai.answer', { mode: 'rules', status: 'emergency' });
        return ok({ chat: await g.chat(), mode: aiMode(), emergency: true });
      }

      // ---- 2. limiti e tetti
      if (!(await hit(`chat:${gk}`, GUEST_MESSAGES_PER_MINUTE, 60_000))) return fail(429, 'rate_limited');
      if ((await g.guestMessagesToday()) >= GUEST_MESSAGES_PER_DAY) return fail(429, 'daily_limit');

      const { conversationId, status } = await g.appendGuestMessage(text);
      // con un operatore gia' coinvolto l'AI non risponde piu': risponde lo staff
      if (status === 'handoff_pending' || status === 'operator') {
        return ok({ chat: await g.chat(), mode: aiMode(), waiting: true });
      }

      let result;
      const day = new Date().toISOString().slice(0, 10);
      if (!(await hit(`ai:${view.hotel.slug}:${day}`, aiHotelCap(), 86_400_000))) {
        // tetto di spesa giornaliero per hotel: cortesia + passaggio all'operatore (docs/02 sez. 7)
        result = { text: t('ai.budget'), handoff: { reason: 'other' as const, topic: 'tetto giornaliero' }, source: 'fallback' as const };
      } else {
        const chat = await g.chat();
        const history = chat.messages.slice(-12).map((m) => ({ role: m.role === 'guest' ? ('user' as const) : ('assistant' as const), content: m.content }));
        result = await answerQuestion({ ctx: await g.aiContext(), history, question: text, locale: view.locale });
      }
      await g.appendAssistantMessage(conversationId, {
        text: result.text,
        handoff: result.handoff,
        tokensIn: 'tokensIn' in result ? result.tokensIn : undefined,
        tokensOut: 'tokensOut' in result ? result.tokensOut : undefined,
      });
      if (result.handoff && 'priority' in result.handoff && result.handoff.priority === 'urgent') {
        // il modello ha riconosciuto una situazione di sicurezza: stesso trattamento di un'emergenza
        await raiseUrgent({ hotelSlug: view.hotel.slug, conversationId, topic: result.handoff.topic, at: new Date().toISOString() });
      }
      // log senza contenuti: solo origine della risposta e se c'e' stato un passaggio
      logEvent('ai.answer', { mode: result.source, status: result.handoff ? 'handoff' : 'answered' });
      return ok({ chat: await g.chat(), mode: aiMode() });
    });
  });
}

// ----------------------------------------------------------------------------- staff
const period = z.enum(['today', '7d', 'season']).default('7d');
const i18nText = z.object({ it: z.string().max(500).optional(), en: z.string().max(500).optional(), de: z.string().max(500).optional() });

export async function staffLogin(ctx: Ctx, raw: unknown): Promise<Res> {
  return guarded('staff/login', async () => {
    const b = z.object({ email: z.string().max(200), password: z.string().max(200) }).parse(raw);
    // limite per IP (se fidato) e, soprattutto, per account: l'IP si falsifica, l'e-mail no
    if (ctx.ip !== 'unknown' && !(await hit(`login:${ipKey(ctx.ip)}`, 20, 10 * 60_000))) return fail(429, 'rate_limited');
    if (!(await hit(`login:acct:${hashKey(b.email.trim().toLowerCase())}`, 10, 10 * 60_000))) return fail(429, 'rate_limited');
    const r = await ctx.store.staffLogin(b.email, b.password);
    if (!r) return fail(401, 'invalid_credentials');
    logEvent('staff.login', { status: r.role });
    return { ...ok({ role: r.role }), staffCookie: r.session };
  });
}

export async function staffAction(ctx: Ctx, action: string, raw: unknown): Promise<Res> {
  return guarded(`staff/${action}`, async () => {
    if (action === 'logout') return { ...ok(), staffCookie: null, hotelCookie: null };
    if (action === 'hotels') {
      const list = await ctx.store.staffHotels(ctx.staff);
      return list.length ? ok({ hotels: list }) : { ...fail(401, 'unauthorized'), staffCookie: null };
    }
    if (action === 'select-hotel') {
      if (ctx.method !== 'POST') return fail(405, 'method_not_allowed');
      const b = z.object({ hotelId: z.string().min(1).max(80) }).parse(raw);
      const list = await ctx.store.staffHotels(ctx.staff);
      if (!list.some((h) => h.id === b.hotelId)) return fail(403, 'forbidden');
      return { ...ok(), hotelCookie: b.hotelId };
    }
    const s = await ctx.store.staff(ctx.staff, { hotelId: ctx.hotel });
    if (!s) return { ...fail(401, 'unauthorized'), staffCookie: null };
    const get = ctx.method === 'GET';
    const post = !get;
    switch (action) {
      case 'redeem': {
        if (!post) return fail(405, 'method_not_allowed');
        const b = z.object({ token: z.string().min(1).max(200) }).parse(raw);
        if (!(await hit(`redeem:${hashKey(ctx.staff ?? '')}`, 60, 60_000))) return fail(429, 'rate_limited');
        const r = await s.redeem(b.token);
        // niente token ne nickname nei log
        logEvent('bonus.redeem', { status: r.ok ? 'ok' : r.reason });
        return ok({ result: r });
      }
      case 'redemptions':
        return ok({ times: await s.myRedemptionsToday() });
      case 'kpis':
        return ok({ kpis: await s.kpis(period.parse((raw as { period?: string } | undefined)?.period)) });
      case 'export': {
        const p = period.parse((raw as { period?: string } | undefined)?.period) as Period;
        const k = await s.kpis(p);
        // solo dati aggregati: nessun dato personale (US-11 CA4)
        const rows: (string | number | null)[][] = [
          ['indicator', 'value'], ['period', p],
          ['I1 guests_activated', k.i1.activated],
          ['I2 bonuses_issued', k.i2.issued], ['I2 bonuses_redeemed', k.i2.redeemed], ['I2 redemption_rate_pct', k.i2.redemptionRatePct],
          ['I2 cap', k.i2.cap], ['I2 cap_used', k.i2.capUsed], ['I2 cost_cents', k.i2.costCents],
          ['I3 bookings', k.i3.bookings],
          ...k.i3.perFacility.map((f): (string | number | null)[] => [`I3 saturation_pct ${f.name.it ?? f.facilityId}`, f.saturationPct]),
          ['I4 event_rsvps', k.i4.totalRsvps],
          ['I5 conversations', k.i5.conversations], ['I5 resolved_by_ai', k.i5.resolvedByAi], ['I5 handoffs', k.i5.handoffs],
          ['I5 wrong_marked', k.i5.wrongMarked], ['I5 hours_saved_ESTIMATE', k.i5.hoursSavedEstimate],
          ['I6 engaged_pct', k.i6.engagedPct], ['I6 engaged_24h_pct', k.i6.engaged24hPct], ['I6 engaged_72h_pct', k.i6.engaged72hPct],
        ];
        // le celle di testo che iniziano con = + - @ sono neutralizzate (iniezione di formule nei fogli di calcolo)
        const cell = (c: string | number | null) => {
          if (c === null) return '';
          const t = String(c).replace(/[",\n\r]/g, ' ');
          return typeof c === 'string' && /^[=+\-@\t]/.test(t) ? `'${t}` : t;
        };
        const csv = rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
        return { status: 200, csv: { filename: `chathel-kpi-${p}.csv`, content: csv } };
      }
      case 'event-save': {
        if (!post) return fail(405, 'method_not_allowed');
        const b = z.object({ id: idSchema.optional(), title: i18nText, description: i18nText.nullish(), location: z.string().max(120).nullish(),
          startsAt: z.string().max(40), endsAt: z.string().max(40).nullish(), capacity: z.number().int().positive().nullish(), published: z.boolean() }).parse(raw);
        await s.saveEvent(b);
        return ok();
      }
      case 'event-delete':
        if (!post) return fail(405, 'method_not_allowed');
        await s.deleteEvent(z.object({ id: idSchema }).parse(raw).id);
        return ok();
      case 'slots-generate': {
        if (!post) return fail(405, 'method_not_allowed');
        const b = z.object({ facilityId: idSchema, from: z.string().max(10), to: z.string().max(10), start: z.string().max(5), end: z.string().max(5),
          minutes: z.number().int(), capacity: z.number().int().positive().nullish() }).parse(raw);
        return ok({ created: await s.generateSlots(b) });
      }
      case 'slot-update': {
        if (!post) return fail(405, 'method_not_allowed');
        const b = z.object({ id: idSchema, capacity: z.number().int().positive().optional(), status: z.enum(['open', 'closed']).optional() }).parse(raw);
        await s.updateSlot(b);
        return ok();
      }
      case 'kb-save': {
        if (!post) return fail(405, 'method_not_allowed');
        const b = z.object({ id: idSchema.optional(), category: z.string().max(20), title: z.string().max(160), content: z.string().max(4000),
          locale: z.enum(['it', 'en', 'de', 'ru']), active: z.boolean() }).parse(raw);
        await s.saveKnowledge(b);
        return ok();
      }
      case 'kb-delete':
        if (!post) return fail(405, 'method_not_allowed');
        await s.deleteKnowledge(z.object({ id: idSchema }).parse(raw).id);
        return ok();
      case 'ai-test': {
        if (!post) return fail(405, 'method_not_allowed');
        const b = z.object({ question: z.string().min(1).max(1000), locale: z.enum(['it', 'en', 'de', 'ru']).default('it') }).parse(raw);
        if (!(await hit(`aitest:${hashKey(ctx.staff ?? '')}`, 20, 60_000))) return fail(429, 'rate_limited');
        const r = await answerQuestion({ ctx: await s.aiTestContext(), history: [{ role: 'user', content: b.question }], question: b.question, locale: b.locale });
        return ok({ text: r.text, handoff: r.handoff ?? null, mode: aiMode(), source: r.source });
      }
      case 'notify': {
        if (!post) return fail(405, 'method_not_allowed');
        const b = z.object({ title: i18nText, body: i18nText.nullish() }).parse(raw);
        await s.publishNotification(b);
        { const db = pushDb(ctx); if (db) { const hid = s.info.hotel.id, hn = s.info.hotel.name; await defer(() => pushAnnouncement(db, hid, b.title, b.body ?? null, hn)); } }
        return ok({ left: await s.notificationsLeftToday() });
      }
      case 'alerts':
        // solo emergenze aperte (nessun testo dell'ospite): la UI della reception puo' interrogarlo ogni pochi secondi
        return ok({ alerts: await s.urgentAlerts() });
      case 'handoff-reply': {
        if (!post) return fail(405, 'method_not_allowed');
        const b = z.object({ conversationId: idSchema, text: z.string().min(1).max(1000) }).parse(raw);
        await s.handoffReply(b.conversationId, b.text);
        { const db = pushDb(ctx); if (db) { const hid = s.info.hotel.id; await defer(() => pushReceptionReply(db, hid, b.conversationId)); } }
        return ok();
      }
      case 'handoff-close':
        if (!post) return fail(405, 'method_not_allowed');
        await s.handoffClose(z.object({ conversationId: idSchema }).parse(raw).conversationId);
        return ok();
      case 'mark-wrong':
        if (!post) return fail(405, 'method_not_allowed');
        await s.markWrong(z.object({ messageId: idSchema }).parse(raw).messageId);
        return ok();
      case 'rotate-qr':
        if (!post) return fail(405, 'method_not_allowed');
        return ok(await s.rotateQr());
      case 'rotate-code':
        if (!post) return fail(405, 'method_not_allowed');
        return ok(await s.rotateAccessCode());
      default:
        return (await socialStaffAction(ctx, s, action, raw)) ?? fail(404, 'not_found');
    }
  });
}

export async function health(): Promise<Res> {
  // 503 se la configurazione manca o e' ambigua: nessun dettaglio, solo il codice
  const problem = configProblem();
  return problem ? fail(503, 'service_unavailable', { config: problem }) : ok({ status: 'up' });
}

/** Client di servizio per le push, o null (store demo o chiavi mancanti). */
function pushDb(ctx: Ctx): any {
  try { return (ctx.store.pushDb?.() as any) ?? null; } catch { return null; }
}
