// Adattatori del livello sociale per lo store demo: collegano SocialHub (rules/social.ts) alle sessioni
// ospite / staff. Nessuna logica di dominio qui, solo ruoli, orologio e mappatura id.
// Solo server.

import { ChError } from '../errors';
import type { SocialHub } from '../rules/social';
import { isCouponToken } from '../rules/coupons';
import type { ChallengeView, CouponKind, CouponQrView, CouponView, CreateChallengeInput, Period, PrivateMessageView, PublicMessageView, ReportReason, SocialSettings, StaffRole } from '../types';
import type { SocialGuestApi, SocialStaffApi } from './types';
import type { DemoStore } from './demo';

export class DemoSocialGuest implements SocialGuestApi {
  constructor(private s: DemoStore, private gid: string) {}
  /** Come app.social_profile in 0010: con il livello sociale spento niente letture ne' scritture. */
  private get hub(): SocialHub { this.s.requireFeature('social'); return this.s.social; }
  private now() { return this.s.now(); }

  async settings(): Promise<SocialSettings> { return this.hub.settings(this.gid, this.now()); }
  async updateSettings(i: { visible?: boolean; acceptsPrivate?: boolean; nickname?: string }) {
    const r = this.hub.updateSettings(this.gid, i, this.now());
    if (i.visible) this.s.markAction(this.gid);
    return r;
  }
  async acceptRules() { this.hub.acceptRules(this.gid, this.now()); }
  async guests() { return this.hub.listGuests(this.gid); }
  async publicFeed() { this.s.requireFeature('publicChat'); return this.hub.publicFeed(this.gid); }
  async postPublic(text: string): Promise<PublicMessageView> {
    this.s.requireFeature('publicChat');
    const m = this.hub.postPublic(this.gid, text, this.now());
    this.s.markAction(this.gid);
    return m;
  }
  async reportPublic(messageId: string, reason: ReportReason) { this.hub.reportPublic(this.gid, messageId, reason, this.now()); }
  async threads() { return this.hub.threadsFor(this.gid); }
  async thread(id: string) { return this.hub.threadDetail(this.gid, id, this.now()); }
  async startThread(toId: string, text: string) {
    const r = this.hub.startThread(this.gid, toId, text, this.now());
    this.s.markAction(this.gid);
    return r;
  }
  async respond(threadId: string, accept: boolean) { this.hub.respond(this.gid, threadId, accept, this.now()); }
  async sendPrivate(threadId: string, text: string): Promise<PrivateMessageView> { return this.hub.sendPrivate(this.gid, threadId, text, this.now()); }
  async block(targetId: string) { this.hub.block(this.gid, targetId); }
  async unblock(targetId: string) { this.hub.unblock(this.gid, targetId); }
  async blocked() { return this.hub.blocked(this.gid); }
  async reportPrivate(threadId: string, messageId: string, reason: ReportReason) { this.hub.reportPrivate(this.gid, threadId, messageId, reason, this.now()); }
  async sendCoupon(threadId: string, kind: CouponKind): Promise<CouponView> {
    this.s.requireFeature('coupons');
    return this.hub.sendCoupon(this.gid, threadId, kind, this.now());
  }
  async couponQr(couponId: string): Promise<CouponQrView> {
    const r = this.hub.couponQr(this.gid, couponId, this.now());
    return { token: r.token, expiresAt: r.expiresAt.toISOString(), kind: r.coupon.kind };
  }
  async cancelCoupon(couponId: string) {
    this.hub.cancelCoupon(this.gid, couponId, this.now());
  }
  async challenges(threadId?: string | null) { return this.hub.challengesFor(this.gid, threadId ?? null, this.now()); }
  async createChallenge(i: CreateChallengeInput): Promise<ChallengeView> {
    // come il trigger di 0010: le sfide nella chat pubblica richiedono anche la chat pubblica
    this.s.requireFeature('challenges', ...(i.threadId ? [] : (['publicChat'] as const)));
    const game = this.s.activeGame(i.gameId);
    const r = this.hub.createChallenge(this.gid, { game, startsAt: new Date(i.startsAt), stake: i.stake, threadId: i.threadId ?? null }, this.now());
    this.s.markAction(this.gid);
    return r;
  }
  async respondChallenge(id: string, accept: boolean) {
    this.hub.respondChallenge(this.gid, id, accept, this.now());
    this.s.markAction(this.gid);
  }
  async cancelChallenge(id: string) { this.hub.cancelChallenge(this.gid, id, this.now()); }
}

const MODERATORS: StaffRole[] = ['hotel_admin', 'reception'];

/** Moderazione: direttore e reception (come la coda "Da gestire"). Il barista non ha accesso. */
export class DemoSocialStaff implements SocialStaffApi {
  constructor(private s: DemoStore, private role: StaffRole) {}
  private get hub(): SocialHub { return this.s.social; }
  private need() { if (!MODERATORS.includes(this.role)) throw new ChError('CH004', 'forbidden'); }
  private hid() { return this.s.hotel.id; }

  async reports(includeClosed: boolean) { this.need(); return this.hub.reportQueue(this.hid(), includeClosed, this.s.now()); }
  async publicFeed() { this.need(); return this.hub.moderationFeed(this.hid(), this.s.now()); }
  async hideMessage(messageId: string, hidden: boolean) { this.need(); this.hub.hideMessage(this.hid(), messageId, hidden, this.s.now()); }
  async muteGuest(socialId: string, muted: boolean, minutes?: number | null) {
    this.need();
    const p = this.hub.byId(socialId);
    if (!p) throw new ChError('CH003', 'invalid_guest');
    const now = this.s.now();
    // senza durata = fino al check-out dell'ospite
    const until = !muted ? null : minutes ? new Date(now.getTime() + minutes * 60_000) : p.stayExpiresAt;
    this.hub.mute(this.hid(), socialId, until);
  }
  async removeGuest(socialId: string, removed: boolean) { this.need(); this.hub.setRemoved(this.hid(), socialId, removed); }
  async closeReport(reportId: string, outcome: 'actioned' | 'dismissed') { this.need(); this.hub.closeReport(this.hid(), reportId, outcome, this.s.now()); }
  async stats(period: Period) { this.need(); return this.hub.stats(this.hid(), period, this.s.now()); }
}

export { isCouponToken };
