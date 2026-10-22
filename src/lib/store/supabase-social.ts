// Livello sociale sullo store Supabase: ogni metodo richiama una RPC di 0002_social.sql / 0004_hardening.sql
// (SECURITY DEFINER, con le regole e i limiti applicati dal database) e ne mappa il risultato sui DTO di types.ts.
//
// NON VERIFICATO contro PostgREST reale. Provato con il client simulato (tests/fake-supabase.ts: mappatura dei campi,
// degli errori CHxxx e dei parametri) e, per le RPC in se', con supabase/tests/0002_social_test.sql e 0004_hardening_test.sql.
// Le regole di dominio NON sono duplicate qui: stanno nelle RPC (parita' con rules/social.ts provata dai test).

import { ChError } from '../errors';
import { SOCIAL_LIMITS } from '../rules/social';
import type {
  ChallengeView, CreateChallengeInput,
  CouponKind, CouponQrView, CouponView, GuestListItem, Locale, Period, PrivateMessageView, PublicMessageView,
  PublicModerationMessage, ReportReason, SocialReportView, SocialSettings, SocialStats, StaffRole, ThreadDetail, ThreadSummary,
} from '../types';
import type { SocialGuestApi, SocialStaffApi } from './types';
import { iso, ok, raise, type Db } from './supabase';

/* eslint-disable @typescript-eslint/no-explicit-any */
async function rpc<T = any>(db: Db, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args ?? {});
  if (error) raise(error);
  return data as T;
}
const rows = (d: unknown): any[] => (Array.isArray(d) ? d : d ? [d] : []);

function settingsFrom(d: any): SocialSettings {
  return {
    id: d.id, nickname: d.nickname, visible: !!d.visible, acceptsPrivate: !!d.accepts_private, isAdult: !!d.is_adult,
    rulesAccepted: !!d.rules_accepted, muted: !!d.muted, mutedUntil: d.muted && d.muted_until ? iso(d.muted_until)! : undefined,
    removed: !!d.removed,
    limits: { messageMax: SOCIAL_LIMITS.messageMax, newContactsPerDay: SOCIAL_LIMITS.newContactsPerDay,
      newContactsLeftToday: d.new_contacts_left_today ?? 0, couponsLeftToday: d.coupons_left_today ?? 0 },
  };
}
function couponFrom(m: any): CouponView | undefined {
  if (!m.coupon_id) return undefined;
  return { id: m.coupon_id, kind: m.coupon_kind, status: m.coupon_status, expiresAt: iso(m.coupon_expires_at)!,
    redeemedAt: iso(m.coupon_redeemed_at) ?? undefined, direction: m.coupon_direction === 'sent' ? 'sent' : 'received' };
}
function messageFrom(m: any): PrivateMessageView {
  return { id: m.id, mine: !!m.mine, kind: m.kind === 'coupon' ? 'coupon' : 'text', text: m.body ?? undefined, coupon: couponFrom(m), createdAt: iso(m.created_at)! };
}
function threadFrom(t: any): ThreadSummary {
  return { id: t.id, peer: { id: t.peer_id, nickname: t.peer_nickname }, status: t.status, incoming: !!t.incoming, lastAt: iso(t.last_at)!, preview: t.preview ?? '' };
}

export class SbSocialGuest implements SocialGuestApi {
  constructor(private db: Db, _tz: string) {}

  async settings() { return settingsFrom(await rpc(this.db, 'social_settings')); }
  async updateSettings(i: { visible?: boolean; acceptsPrivate?: boolean; nickname?: string }) {
    return settingsFrom(await rpc(this.db, 'social_update_settings', {
      p_visible: i.visible ?? null, p_accepts_private: i.acceptsPrivate ?? null, p_nickname: i.nickname ?? null,
    }));
  }
  async acceptRules() { await rpc(this.db, 'social_accept_rules'); }
  async guests(): Promise<GuestListItem[]> {
    return rows(await rpc(this.db, 'social_guests')).map((r) => ({ id: r.id, nickname: r.nickname, locale: r.locale as Locale, canMessage: !!r.can_message }));
  }
  private async feedRows(): Promise<PublicMessageView[]> {
    return rows(await rpc(this.db, 'social_feed')).map((r) => ({
      id: r.id, authorId: r.author_id, nickname: r.nickname, text: r.body, createdAt: iso(r.created_at)!, mine: !!r.mine, reportedByMe: !!r.reported_by_me,
    }));
  }
  async publicFeed() { return this.feedRows(); }
  async postPublic(text: string): Promise<PublicMessageView> {
    const id = await rpc<string>(this.db, 'social_post_public', { p_body: text });
    const m = (await this.feedRows()).find((x) => x.id === id);
    if (!m) throw new ChError('CH003', 'invalid_message');
    return m;
  }
  async reportPublic(messageId: string, reason: ReportReason) { await rpc(this.db, 'social_report_public', { p_message: messageId, p_reason: reason }); }

  async threads(): Promise<ThreadSummary[]> { return rows(await rpc(this.db, 'social_threads_list')).map(threadFrom); }
  private async messages(id: string): Promise<PrivateMessageView[]> {
    return rows(await rpc(this.db, 'social_thread_messages', { p_thread: id })).map(messageFrom);
  }
  async thread(id: string): Promise<ThreadDetail> {
    const messages = await this.messages(id); // lancia invalid_thread se non e' una mia conversazione
    const summary = (await this.threads()).find((t) => t.id === id);
    if (!summary) throw new ChError('CH003', 'invalid_thread');
    const s = await this.settings();
    const writer = summary.status === 'accepted' && s.rulesAccepted && !s.muted && !s.removed;
    return { ...summary, messages, canSend: writer, canRespond: summary.status === 'pending' && summary.incoming, canSendCoupon: writer };
  }
  async startThread(toId: string, text: string) {
    return { threadId: await rpc<string>(this.db, 'social_start_thread', { p_to: toId, p_body: text }) };
  }
  async respond(threadId: string, accept: boolean) { await rpc(this.db, 'social_respond', { p_thread: threadId, p_accept: accept }); }
  async sendPrivate(threadId: string, text: string): Promise<PrivateMessageView> {
    const id = await rpc<string>(this.db, 'social_send_private', { p_thread: threadId, p_body: text });
    const m = (await this.messages(threadId)).find((x) => x.id === id);
    if (!m) throw new ChError('CH003', 'invalid_message');
    return m;
  }
  async block(targetId: string) { await rpc(this.db, 'social_block', { p_target: targetId }); }
  async unblock(targetId: string) { await rpc(this.db, 'social_unblock', { p_target: targetId }); }
  async blocked() { return rows(await rpc(this.db, 'social_blocked')).map((r) => ({ id: r.id as string, nickname: r.nickname as string })); }
  async reportPrivate(threadId: string, messageId: string, reason: ReportReason) {
    await rpc(this.db, 'social_report_private', { p_thread: threadId, p_message: messageId, p_reason: reason });
  }
  async sendCoupon(threadId: string, kind: CouponKind): Promise<CouponView> {
    const id = await rpc<string>(this.db, 'social_send_coupon', { p_thread: threadId, p_kind: kind });
    const c = (await this.messages(threadId)).find((x) => x.coupon?.id === id)?.coupon;
    if (!c) throw new ChError('CH003', 'invalid_coupon');
    return c;
  }
  async couponQr(couponId: string): Promise<CouponQrView> {
    const d = await rpc(this.db, 'social_coupon_qr', { p_coupon: couponId });
    return { token: d.token, expiresAt: iso(d.expires_at)!, kind: d.kind };
  }
  async cancelCoupon(couponId: string) { await rpc(this.db, 'social_cancel_coupon', { p_coupon: couponId }); }

  // ---- sfide (0008)
  async challenges(threadId?: string | null): Promise<ChallengeView[]> {
    return rows(await rpc(this.db, 'social_challenges', { p_thread: threadId ?? null })).map(challengeFrom);
  }
  async createChallenge(i: CreateChallengeInput): Promise<ChallengeView> {
    const id = await rpc<string>(this.db, 'social_challenge_create', { p_game: i.gameId, p_starts_at: i.startsAt, p_stake: i.stake, p_thread: i.threadId ?? null });
    const c = (await this.challenges(i.threadId ?? null)).find((x) => x.id === id);
    if (!c) throw new ChError('CH003', 'invalid_challenge');
    return c;
  }
  async respondChallenge(id: string, accept: boolean) { await rpc(this.db, 'social_challenge_respond', { p_challenge: id, p_accept: accept }); }
  async cancelChallenge(id: string) { await rpc(this.db, 'social_challenge_cancel', { p_challenge: id }); }
}

function challengeFrom(c: any): ChallengeView {
  return {
    id: c.id, game: c.game ?? {}, startsAt: iso(c.starts_at)!, stake: c.stake, status: c.status, scope: c.thread_id ? 'private' : 'public',
    threadId: c.thread_id ?? null, challenger: { id: c.challenger_id, nickname: c.challenger_nickname ?? '' },
    opponent: c.opponent_id ? { id: c.opponent_id, nickname: c.opponent_nickname ?? '' } : null, mine: !!c.mine, meOpponent: !!c.me_opponent,
    canAccept: !!c.can_accept, canDecline: !!c.can_decline, canCancel: !!c.can_cancel, createdAt: iso(c.created_at)!,
  };
}

const MODERATORS: StaffRole[] = ['hotel_admin', 'reception'];

/** Moderazione: letture dirette (solo colonne di moderazione concesse alla RLS dello staff) + RPC per le scritture. */
export class SbSocialStaff implements SocialStaffApi {
  constructor(private db: Db, private role: StaffRole, private hid: string, _tz: string) {}
  private need() { if (!MODERATORS.includes(this.role)) throw new ChError('CH004', 'forbidden'); }

  private async profiles(ids: string[]): Promise<Map<string, any>> {
    const m = new Map<string, any>();
    if (!ids.length) return m;
    for (const p of ok(await this.db.from('social_profiles').select('id, nickname, muted_until, removed').in('id', [...new Set(ids)])) as any[]) m.set(p.id, p);
    return m;
  }
  private muted(p: any) { return !!p?.muted_until && new Date(p.muted_until).getTime() > Date.now(); }

  async reports(includeClosed: boolean): Promise<SocialReportView[]> {
    this.need();
    let q = this.db.from('social_reports').select('id, kind, reason, status, created_at, reporter_id, reported_id, message_id, snapshot')
      .eq('hotel_id', this.hid).order('created_at', { ascending: false }).limit(200);
    if (!includeClosed) q = q.eq('status', 'open');
    const reps = ok(await q) as any[];
    const profs = await this.profiles(reps.flatMap((r) => [r.reporter_id, r.reported_id]).filter(Boolean));
    const msgIds = reps.filter((r) => r.kind === 'public' && r.message_id).map((r) => r.message_id);
    const hidden = new Set<string>();
    if (msgIds.length) for (const m of ok(await this.db.from('social_public_messages').select('id, hidden').in('id', msgIds)) as any[]) if (m.hidden) hidden.add(m.id);
    const against = new Map<string, number>();
    for (const r of reps) if (r.reported_id) against.set(r.reported_id, (against.get(r.reported_id) ?? 0) + 1);
    return reps
      .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.created_at.localeCompare(a.created_at))
      .map((r) => {
        const rp = r.reported_id ? profs.get(r.reported_id) : undefined;
        return {
          id: r.id, kind: r.kind, reason: r.reason, status: r.status, createdAt: iso(r.created_at)!,
          reporter: (r.reporter_id && profs.get(r.reporter_id)?.nickname) || '',
          reported: { id: rp?.id ?? null, nickname: rp?.nickname ?? null, muted: this.muted(rp), removed: !!rp?.removed },
          messageId: r.message_id ?? null, messageHidden: hidden.has(r.message_id),
          excerpt: ((r.snapshot ?? []) as any[]).map((s) => ({ nickname: s.nickname, text: s.text, at: iso(s.at)! })),
          reportsAgainst: r.reported_id ? against.get(r.reported_id) ?? 0 : 0,
        };
      });
  }
  async publicFeed(): Promise<PublicModerationMessage[]> {
    this.need();
    const ms = ok(await this.db.from('social_public_messages').select('id, author_id, body, created_at, hidden').eq('hotel_id', this.hid)
      .order('created_at', { ascending: false }).limit(100)) as any[];
    const profs = await this.profiles(ms.map((m) => m.author_id));
    return ms.reverse().map((m) => {
      const a = profs.get(m.author_id);
      return { id: m.id, authorId: m.author_id, nickname: a?.nickname ?? '', text: m.body, createdAt: iso(m.created_at)!, hidden: !!m.hidden,
        authorMuted: this.muted(a), authorRemoved: !!a?.removed };
    });
  }
  async hideMessage(messageId: string, hidden: boolean) { this.need(); await rpc(this.db, 'social_hide_message', { p_message: messageId, p_hidden: hidden }); }
  async muteGuest(socialId: string, muted: boolean, minutes?: number | null) {
    this.need();
    // senza durata = fino al check-out: il profilo sparisce al check-out, quindi basta una data oltre il massimo soggiorno (61 giorni)
    const until = !muted ? null : new Date(Date.now() + (minutes ? minutes * 60_000 : 62 * 86_400_000)).toISOString();
    await rpc(this.db, 'social_mute', { p_profile: socialId, p_until: until });
  }
  async removeGuest(socialId: string, removed: boolean) { this.need(); await rpc(this.db, 'social_set_removed', { p_profile: socialId, p_removed: removed }); }
  async closeReport(reportId: string, outcome: 'actioned' | 'dismissed') { this.need(); await rpc(this.db, 'social_close_report', { p_report: reportId, p_outcome: outcome }); }
  async stats(period: Period): Promise<SocialStats> {
    this.need();
    const d = await rpc(this.db, 'social_stats', { p_period: period, p_hotel: this.hid });
    return {
      period, generatedAt: new Date().toISOString(), visibleGuests: d.visible_guests, publicMessages: d.public_messages,
      privateRequests: d.private_requests, privateAccepted: d.private_accepted, privateDeclined: d.private_declined, privateMessages: d.private_messages,
      couponsSent: d.coupons_sent, couponsRedeemed: d.coupons_redeemed, couponsExpired: d.coupons_expired, hiddenMessages: d.hidden_messages, openReports: d.open_reports,
    };
  }
}
