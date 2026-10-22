// Azioni API del livello sociale. Sono instradate da guestAction / staffAction (handlers.ts) con prefisso "social-".
// Qui solo validazione dell'input, limite per sessione e traduzione dei risultati: le regole stanno in rules/social.ts.
// Nessun testo di messaggio, nickname o id ospite finisce nei log.

import { z } from 'zod';
import { allow, hashKey, hit } from '../ratelimit';
import { logEvent } from '../log';
import type { GuestApi, StaffApi } from '../store/types';
import { CHALLENGE_STAKES, COUPON_KINDS, REPORT_REASONS, type ChallengeStake, type CouponKind, type ReportReason } from '../types';
import type { Ctx, Res } from './handlers';
import { defer, pushChallenge, pushPrivate, pushPublic } from '../push/notify';

const ok = (body: Record<string, unknown> = {}): Res => ({ status: 200, body: { ok: true, ...body } });
const fail = (status: number, error: string): Res => ({ status, body: { ok: false, error } });

const id = z.string().min(1).max(80);
const text = z.string().max(2000); // il limite vero (280 caratteri) lo applica il dominio
const reason = z.enum(REPORT_REASONS as unknown as [ReportReason, ...ReportReason[]]);
const kind = z.enum(COUPON_KINDS as unknown as [CouponKind, ...CouponKind[]]);
const stake = z.enum(CHALLENGE_STAKES as unknown as [ChallengeStake, ...ChallengeStake[]]);

export async function socialGuestAction(ctx: Ctx, g: GuestApi, action: string, raw: unknown): Promise<Res | null> {
  if (!action.startsWith('social-')) return null;
  const s = g.social();
  const get = ctx.method === 'GET';
  const post = !get;
  const q = (raw ?? {}) as Record<string, unknown>;
  // freno generico per sessione (oltre ai limiti di dominio): protegge dal polling eccessivo e dagli script
  if (!allow(`soc:${hashKey(ctx.guest ?? '')}`, 240, 60_000)) return fail(429, 'rate_limited');

  switch (action) {
    case 'social-settings':
      return ok({ settings: await s.settings() });
    case 'social-settings-update': {
      if (!post) return fail(405, 'method_not_allowed');
      const b = z.object({ visible: z.boolean().optional(), acceptsPrivate: z.boolean().optional(), nickname: z.string().max(60).optional() }).parse(raw);
      const r = await s.updateSettings(b);
      logEvent('social.settings', { status: r.visible ? 'visible' : 'hidden' });
      return ok({ settings: r });
    }
    case 'social-rules':
      if (!post) return fail(405, 'method_not_allowed');
      await s.acceptRules();
      return ok({ settings: await s.settings() });
    case 'social-guests':
      return ok({ guests: await s.guests() });
    case 'social-feed':
      return ok({ messages: await s.publicFeed() });
    case 'social-post': {
      if (!post) return fail(405, 'method_not_allowed');
      const b = z.object({ text }).parse(raw);
      const m = await s.postPublic(b.text);
      notifySocial(ctx, g, (db, ids) => pushPublic(db, ids.hotelId, ids.guestId));
      logEvent('social.public_post', { status: 'ok' });
      return ok({ message: m, messages: await s.publicFeed() });
    }
    case 'social-report': {
      if (!post) return fail(405, 'method_not_allowed');
      const b = z.object({ messageId: id, reason }).parse(raw);
      await s.reportPublic(b.messageId, b.reason);
      logEvent('social.report', { status: 'public' });
      return ok();
    }
    case 'social-report-private': {
      if (!post) return fail(405, 'method_not_allowed');
      const b = z.object({ threadId: id, messageId: id, reason }).parse(raw);
      await s.reportPrivate(b.threadId, b.messageId, b.reason);
      logEvent('social.report', { status: 'private' });
      return ok();
    }
    case 'social-threads':
      return ok({ threads: await s.threads(), settings: await s.settings() });
    case 'social-thread':
      return ok({ thread: await s.thread(z.string().min(1).max(80).parse(q.id)) });
    case 'social-thread-start': {
      if (!post) return fail(405, 'method_not_allowed');
      const b = z.object({ to: id, text }).parse(raw);
      const r = await s.startThread(b.to, b.text);
      notifySocial(ctx, g, (db, ids) => pushPrivate(db, ids.hotelId, ids.guestId, { toProfileId: b.to }));
      logEvent('social.thread_start', { status: 'ok' });
      return ok(r);
    }
    case 'social-thread-respond': {
      if (!post) return fail(405, 'method_not_allowed');
      const b = z.object({ threadId: id, accept: z.boolean() }).parse(raw);
      await s.respond(b.threadId, b.accept);
      return ok();
    }
    case 'social-thread-send': {
      if (!post) return fail(405, 'method_not_allowed');
      const b = z.object({ threadId: id, text }).parse(raw);
      const m = await s.sendPrivate(b.threadId, b.text);
      notifySocial(ctx, g, (db, ids) => pushPrivate(db, ids.hotelId, ids.guestId, { threadId: b.threadId }));
      return ok({ message: m });
    }
    case 'social-block': {
      if (!post) return fail(405, 'method_not_allowed');
      await s.block(z.object({ target: id }).parse(raw).target);
      return ok();
    }
    case 'social-unblock': {
      if (!post) return fail(405, 'method_not_allowed');
      await s.unblock(z.object({ target: id }).parse(raw).target);
      return ok();
    }
    case 'social-blocked':
      return ok({ blocked: await s.blocked() });
    case 'social-coupon-send': {
      if (!post) return fail(405, 'method_not_allowed');
      const b = z.object({ threadId: id, kind }).parse(raw);
      const c = await s.sendCoupon(b.threadId, b.kind);
      logEvent('social.coupon_send', { status: b.kind });
      return ok({ coupon: c });
    }
    case 'social-coupon-qr': {
      if (!post) return fail(405, 'method_not_allowed');
      if (!(await hit(`cqr:${hashKey(ctx.guest ?? '')}`, 30, 10 * 60_000))) return fail(429, 'rate_limited');
      return ok({ qr: await s.couponQr(z.object({ couponId: id }).parse(raw).couponId) });
    }
    case 'social-coupon-cancel': {
      if (!post) return fail(405, 'method_not_allowed');
      await s.cancelCoupon(z.object({ couponId: id }).parse(raw).couponId);
      return ok();
    }
    // ---- sfide
    case 'social-challenges': {
      const thread = q.thread === undefined || q.thread === '' ? null : id.parse(q.thread);
      return ok({ challenges: await s.challenges(thread) });
    }
    case 'social-challenge-create': {
      if (!post) return fail(405, 'method_not_allowed');
      const b = z.object({ gameId: id, startsAt: z.string().datetime({ offset: true }), stake, threadId: id.nullish() }).parse(raw);
      const c = await s.createChallenge({ gameId: b.gameId, startsAt: b.startsAt, stake: b.stake, threadId: b.threadId ?? null });
      if (c.threadId && c.opponent) {
        const to = c.opponent.id, url = `/stay/social/${encodeURIComponent(c.threadId)}`;
        notifySocial(ctx, g, (db, ids) => pushChallenge(db, ids.hotelId, ids.guestId, to, 'received', url));
      } else notifySocial(ctx, g, (db, ids) => pushPublic(db, ids.hotelId, ids.guestId));
      logEvent('social.challenge', { status: c.scope });
      return ok({ challenge: c });
    }
    case 'social-challenge-respond': {
      if (!post) return fail(405, 'method_not_allowed');
      const b = z.object({ challengeId: id, accept: z.boolean(), threadId: id.nullish() }).parse(raw);
      await s.respondChallenge(b.challengeId, b.accept);
      if (b.accept) {
        const c = (await s.challenges(b.threadId ?? null)).find((x) => x.id === b.challengeId);
        if (c) {
          const to = c.challenger.id, url = c.threadId ? `/stay/social/${encodeURIComponent(c.threadId)}` : '/stay/social?tab=chat';
          notifySocial(ctx, g, (db, ids) => pushChallenge(db, ids.hotelId, ids.guestId, to, 'accepted', url));
        }
      }
      logEvent('social.challenge_respond', { status: b.accept ? 'accepted' : 'declined' });
      return ok();
    }
    case 'social-challenge-cancel': {
      if (!post) return fail(405, 'method_not_allowed');
      await s.cancelChallenge(z.object({ challengeId: id }).parse(raw).challengeId);
      return ok();
    }
    default:
      return fail(404, 'not_found');
  }
}

const period = z.enum(['today', '7d', 'season']).default('7d');

export async function socialStaffAction(ctx: Ctx, st: StaffApi, action: string, raw: unknown): Promise<Res | null> {
  if (!action.startsWith('social-')) return null;
  const s = st.social();
  const post = ctx.method !== 'GET';
  const q = (raw ?? {}) as Record<string, unknown>;
  switch (action) {
    case 'social-reports':
      return ok({ reports: await s.reports(q.closed === '1') });
    case 'social-feed':
      return ok({ messages: await s.publicFeed() });
    case 'social-hide': {
      if (!post) return fail(405, 'method_not_allowed');
      const b = z.object({ messageId: id, hidden: z.boolean() }).parse(raw);
      await s.hideMessage(b.messageId, b.hidden);
      logEvent('social.moderate', { status: b.hidden ? 'hide' : 'unhide' });
      return ok();
    }
    case 'social-mute': {
      if (!post) return fail(405, 'method_not_allowed');
      const b = z.object({ socialId: id, muted: z.boolean(), minutes: z.number().int().min(1).max(60 * 24 * 30).nullish() }).parse(raw);
      await s.muteGuest(b.socialId, b.muted, b.minutes ?? null);
      logEvent('social.moderate', { status: b.muted ? 'mute' : 'unmute' });
      return ok();
    }
    case 'social-remove': {
      if (!post) return fail(405, 'method_not_allowed');
      const b = z.object({ socialId: id, removed: z.boolean() }).parse(raw);
      await s.removeGuest(b.socialId, b.removed);
      logEvent('social.moderate', { status: b.removed ? 'remove' : 'restore' });
      return ok();
    }
    case 'social-report-close': {
      if (!post) return fail(405, 'method_not_allowed');
      const b = z.object({ reportId: id, outcome: z.enum(['actioned', 'dismissed']) }).parse(raw);
      await s.closeReport(b.reportId, b.outcome);
      return ok();
    }
    case 'social-stats':
      return ok({ stats: await s.stats(period.parse(q.period)) });
    default:
      return fail(404, 'not_found');
  }
}

/** Avvia l'invio push dopo l'azione riuscita (mai bloccante, mai con errori verso l'ospite). */
function notifySocial(ctx: Ctx, g: GuestApi, job: (db: any, ids: { hotelId: string; guestId: string }) => Promise<unknown>): void {
  const ids = g.pushIds?.();
  let db: any = null;
  try { db = ctx.store.pushDb?.() ?? null; } catch { db = null; }
  if (!ids || !db) return;
  void defer(() => job(db, ids));
}
