// Coupon inviati in privato tra ospiti (aperitivo, caffe', cena condivisa).
// Regole: validi SOLO nei locali dell'hotel (li valida lo staff bar dello stesso hotel), uso singolo,
// scadenza. Nessun pagamento nell'app: chi paga e come si regola il conto e' [DA DECIDERE] (vedi NOTE-SVILUPPO).
// Replica in memoria la logica di supabase/migrations/0002_social.sql (send_coupon, coupon_qr, redeem_coupon).
// Il QR del coupon e' monouso a vita breve come quello del bonus; nel database resta solo l'hash.
//
// Solo server (node:crypto).

import { randomBytes, randomUUID } from 'node:crypto';
import { ChError } from '../errors';
import type { CouponKind, CouponStatus } from '../types';
import { hashToken, FAIL_WINDOW_MS, MAX_FAILS, type RedeemActor } from './bonus';

/** Il punto non e' nell'alfabeto base64url: nessuna collisione con i token del bonus ('b.'). */
export const COUPON_TOKEN_PREFIX = 'c.';
export const COUPON_QR_TTL_SECONDS = 90;
export const COUPON_TTL_HOURS = 48;

export interface Coupon {
  id: string;
  hotelId: string;
  kind: CouponKind;
  /** null dopo il check-out di chi ha inviato / ricevuto */
  senderId: string | null;
  recipientId: string | null;
  threadId: string | null;
  status: CouponStatus;
  createdAt: Date;
  expiresAt: Date;
  redeemedAt?: Date;
  redeemedBy?: string;
}
export interface CouponQr {
  id: string;
  couponId: string;
  tokenHash: string;
  status: 'pending' | 'redeemed' | 'expired' | 'cancelled';
  createdAt: Date;
  expiresAt: Date;
}

export type CouponRedeemOutcome =
  | { ok: true; coupon: Coupon }
  | { ok: false; reason: 'invalid' | 'already_used' | 'expired' | 'bonus_not_valid' | 'rate_limited'; redeemedAt?: Date };

export const newCouponToken = () => COUPON_TOKEN_PREFIX + randomBytes(18).toString('base64url');
export const isCouponToken = (t: string) => typeof t === 'string' && t.startsWith(COUPON_TOKEN_PREFIX);

export class CouponLedger {
  coupons: Coupon[] = [];
  qrs: CouponQr[] = [];
  private fails = new Map<string, number[]>();
  constructor(private readonly newId: () => string = randomUUID) {}

  get(id: string): Coupon | undefined {
    return this.coupons.find((c) => c.id === id);
  }

  /** Stato effettivo: un coupon scaduto risulta tale anche se il job periodico non e' ancora passato. */
  effective(c: Coupon, now: Date): CouponStatus {
    return c.status === 'issued' && c.expiresAt <= now ? 'expired' : c.status;
  }

  issue(p: { hotelId: string; kind: CouponKind; senderId: string; recipientId: string; threadId: string; now: Date; expiresAt: Date }): Coupon {
    if (p.expiresAt <= p.now) throw new ChError('CH006', 'coupon_expired');
    const c: Coupon = {
      id: this.newId(), hotelId: p.hotelId, kind: p.kind, senderId: p.senderId, recipientId: p.recipientId,
      threadId: p.threadId, status: 'issued', createdAt: p.now, expiresAt: p.expiresAt,
    };
    this.coupons.push(c);
    return c;
  }

  sentSince(senderId: string, since: Date): number {
    return this.coupons.filter((c) => c.senderId === senderId && c.createdAt >= since).length;
  }
  activeSent(senderId: string, now: Date): number {
    return this.coupons.filter((c) => c.senderId === senderId && this.effective(c, now) === 'issued').length;
  }
  /** Tetto per hotel: coupon creati dall'inizio del giorno (anche se poi annullati o scaduti) e coupon ancora validi. */
  hotelSentSince(hotelId: string, since: Date): number {
    return this.coupons.filter((c) => c.hotelId === hotelId && c.createdAt >= since).length;
  }
  hotelActive(hotelId: string, now: Date): number {
    return this.coupons.filter((c) => c.hotelId === hotelId && this.effective(c, now) === 'issued').length;
  }

  /** Solo il destinatario genera il QR; i QR precedenti dello stesso coupon vengono invalidati. */
  requestQr(recipientId: string, couponId: string, now: Date, ttlSeconds = COUPON_QR_TTL_SECONDS): { token: string; expiresAt: Date; coupon: Coupon } {
    const c = this.get(couponId);
    if (!c || c.recipientId !== recipientId) throw new ChError('CH003', 'invalid_coupon');
    if (this.effective(c, now) !== 'issued') throw new ChError('CH003', 'invalid_coupon');
    for (const q of this.qrs) if (q.couponId === c.id && q.status === 'pending') q.status = 'cancelled';
    const token = newCouponToken();
    const expiresAt = new Date(Math.min(now.getTime() + ttlSeconds * 1000, c.expiresAt.getTime()));
    this.qrs.push({ id: this.newId(), couponId: c.id, tokenHash: hashToken(token), status: 'pending', createdAt: now, expiresAt });
    return { token, expiresAt, coupon: c };
  }

  private recentFails(key: string, now: Date) {
    const l = (this.fails.get(key) ?? []).filter((t) => now.getTime() - t < FAIL_WINDOW_MS);
    this.fails.set(key, l);
    return l.length;
  }
  private fail(key: string, now: Date) {
    const l = this.fails.get(key) ?? [];
    l.push(now.getTime());
    this.fails.set(key, l);
  }

  /** Validazione al bar. Stesse garanzie del bonus: un solo esito "ok" per coupon, staff dello stesso hotel. */
  redeem(token: string, actor: RedeemActor, now: Date, recipientStayActive: (recipientId: string) => boolean): CouponRedeemOutcome {
    if (this.recentFails(actor.actorKey, now) >= MAX_FAILS) return { ok: false, reason: 'rate_limited' };
    const bad = (reason: 'invalid' | 'already_used' | 'expired' | 'bonus_not_valid', redeemedAt?: Date): CouponRedeemOutcome => {
      this.fail(actor.actorKey, now);
      return { ok: false, reason, redeemedAt };
    };
    const q = this.qrs.find((x) => x.tokenHash === hashToken(token || ''));
    if (!q) return bad('invalid');
    const c = this.get(q.couponId);
    if (!c || !actor.staffId || actor.staffHotelId !== c.hotelId) return bad('invalid');
    if (c.status === 'redeemed' || q.status === 'redeemed') return bad('already_used', c.redeemedAt);
    if (q.status !== 'pending' || q.expiresAt <= now) {
      if (q.status === 'pending') q.status = 'expired';
      return bad('expired');
    }
    if (c.status !== 'issued' || c.expiresAt <= now || !c.recipientId || !recipientStayActive(c.recipientId)) return bad('bonus_not_valid');
    q.status = 'redeemed';
    c.status = 'redeemed';
    c.redeemedAt = now;
    c.redeemedBy = actor.staffId;
    return { ok: true, coupon: c };
  }

  private voidCoupon(c: Coupon) {
    if (c.status === 'issued') c.status = 'void';
    for (const q of this.qrs) if (q.couponId === c.id && q.status === 'pending') q.status = 'cancelled';
  }

  /** Il mittente annulla un coupon non ancora usato. */
  cancel(senderId: string, couponId: string, now: Date): Coupon {
    const c = this.get(couponId);
    if (!c || c.senderId !== senderId) throw new ChError('CH003', 'invalid_coupon');
    if (this.effective(c, now) !== 'issued') throw new ChError('CH005', 'coupon_not_active');
    this.voidCoupon(c);
    return c;
  }

  /** Blocco tra due ospiti: i coupon non usati tra loro non sono piu' utilizzabili. */
  voidBetween(a: string, b: string) {
    for (const c of this.coupons) {
      if ((c.senderId === a && c.recipientId === b) || (c.senderId === b && c.recipientId === a)) this.voidCoupon(c);
    }
  }

  /** Check-out di un ospite: coupon non usati annullati, il legame alla persona cade (restano righe anonime). */
  purgeProfile(profileId: string) {
    for (const c of this.coupons) {
      if (c.senderId !== profileId && c.recipientId !== profileId) continue;
      this.voidCoupon(c);
      if (c.senderId === profileId) c.senderId = null;
      if (c.recipientId === profileId) c.recipientId = null;
      c.threadId = null;
    }
  }

  /** Equivalente del job periodico. */
  expireDue(now: Date) {
    for (const c of this.coupons) if (c.status === 'issued' && c.expiresAt <= now) c.status = 'expired';
    for (const q of this.qrs) if (q.status === 'pending' && q.expiresAt <= now) q.status = 'expired';
  }
}
