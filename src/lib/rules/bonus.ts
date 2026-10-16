// Regole del bonus di benvenuto, applicate in memoria dalla modalita' DEMO.
// Replicano la logica di supabase/migrations/0001_init.sql (trigger enforce_bonus_cap,
// request_bonus_qr, redeem_bonus). Con Supabase reale la fonte di verita' e' il database:
// questo modulo NON viene usato in quel caso, serve a provare le regole senza backend.
//
// Solo server (usa node:crypto). Il token in chiaro non viene mai salvato: solo l'hash.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ChError } from '../errors';

export type BonusStatus = 'issued' | 'redeemed' | 'expired' | 'void';
export type RedemptionStatus = 'pending' | 'redeemed' | 'expired' | 'cancelled';

export interface Bonus {
  id: string;
  hotelId: string;
  guestId: string | null;
  seasonYear: number;
  status: BonusStatus;
  issuedAt: Date;
  expiresAt: Date;
  redeemedAt?: Date;
  dedupeKey?: string | null;
}

export interface Redemption {
  id: string;
  hotelId: string;
  bonusId: string;
  tokenHash: string;
  status: RedemptionStatus;
  createdAt: Date;
  expiresAt: Date;
  redeemedAt?: Date;
  redeemedBy?: string;
}

export interface HotelBonusConfig {
  id: string;
  seasonYear: number;
  /** 0 = nessun bonus */
  cap: number;
  qrTtlSeconds: number;
  enabled: boolean;
  /** tetto di bonus emessi nell'ora (anche poi annullati: contrasta il ciclo entra-esci-rientra). undefined = nessun tetto orario */
  maxPerHour?: number;
}

export type RedeemOutcome =
  | { ok: true; bonus: Bonus; redemption: Redemption }
  | { ok: false; reason: 'invalid' | 'already_used' | 'expired' | 'bonus_not_valid' | 'rate_limited'; redeemedAt?: Date };

export interface RedeemActor {
  /** id dell'utente staff che scansiona (per il limite di tentativi falliti) */
  actorKey: string;
  /** id hotel_staff, se l'utente e' staff attivo con ruolo bartender/hotel_admin */
  staffId: string | null;
  /** hotel dello staff */
  staffHotelId: string | null;
}

export const MAX_FAILS = 10;
export const FAIL_WINDOW_MS = 10 * 60_000;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
/**
 * Prefissi dei token: 'b.' bonus, 'c.' coupon (coupons.ts). Il punto NON fa parte dell'alfabeto base64url, quindi un
 * token bonus non puo' mai essere scambiato per un coupon (con il vecchio prefisso 'c_' accadeva 1 volta su 4096).
 */
export const BONUS_TOKEN_PREFIX = 'b.';
/** 144 bit di casualita', come request_bonus_qr() */
export const newBonusToken = () => BONUS_TOKEN_PREFIX + randomBytes(18).toString('base64url');

export class BonusLedger {
  bonuses: Bonus[] = [];
  redemptions: Redemption[] = [];
  private fails = new Map<string, number[]>();

  constructor(private readonly newId: () => string = randomUUID) {}

  /** Emessi + riscattati della stagione (scaduti/annullati liberano posto). */
  used(hotelId: string, seasonYear: number): number {
    return this.bonuses.filter(
      (b) => b.hotelId === hotelId && b.seasonYear === seasonYear && (b.status === 'issued' || b.status === 'redeemed'),
    ).length;
  }

  /**
   * Emissione. L'ordine dei controlli segue il database: prima il tetto (trigger BEFORE INSERT),
   * poi i vincoli di unicita' (un bonus per ospite, dedupe).
   */
  issue(hotel: HotelBonusConfig, guestId: string, expiresAt: Date, now: Date, dedupeKey: string | null = null): Bonus {
    if (this.used(hotel.id, hotel.seasonYear) >= (hotel.cap || 0)) {
      throw new ChError('CH001', 'bonus_cap_reached');
    }
    if (hotel.maxPerHour !== undefined) {
      const since = now.getTime() - 3_600_000;
      const lastHour = this.bonuses.filter((b) => b.hotelId === hotel.id && b.issuedAt.getTime() > since).length;
      if (lastHour >= hotel.maxPerHour) throw new ChError('CH007', 'bonus_hour_cap');
    }
    if (this.bonuses.some((b) => b.guestId === guestId)) {
      throw new ChError('CH005', 'already_claimed');
    }
    if (
      dedupeKey &&
      this.bonuses.some(
        (b) =>
          b.hotelId === hotel.id &&
          b.seasonYear === hotel.seasonYear &&
          b.dedupeKey === dedupeKey &&
          (b.status === 'issued' || b.status === 'redeemed'),
      )
    ) {
      throw new ChError('CH005', 'already_claimed');
    }
    const bonus: Bonus = {
      id: this.newId(),
      hotelId: hotel.id,
      guestId,
      seasonYear: hotel.seasonYear,
      status: 'issued',
      issuedAt: now,
      expiresAt,
      dedupeKey,
    };
    this.bonuses.push(bonus);
    return bonus;
  }

  bonusOf(guestId: string): Bonus | undefined {
    return this.bonuses.find((b) => b.guestId === guestId);
  }

  /** Genera il QR monouso a vita breve; invalida i QR precedenti dello stesso bonus. */
  requestQr(guestId: string, hotel: HotelBonusConfig, now: Date): { token: string; expiresAt: Date } {
    const bonus = this.bonusOf(guestId);
    if (!bonus || bonus.status !== 'issued' || bonus.expiresAt <= now) {
      throw new ChError('CH003', 'invalid_bonus');
    }
    for (const r of this.redemptions) {
      if (r.bonusId === bonus.id && r.status === 'pending') r.status = 'cancelled';
    }
    const token = newBonusToken();
    const expiresAt = new Date(Math.min(now.getTime() + hotel.qrTtlSeconds * 1000, bonus.expiresAt.getTime()));
    this.redemptions.push({
      id: this.newId(),
      hotelId: bonus.hotelId,
      bonusId: bonus.id,
      tokenHash: hashToken(token),
      status: 'pending',
      createdAt: now,
      expiresAt,
    });
    return { token, expiresAt };
  }

  private recentFails(actorKey: string, now: Date): number {
    const list = (this.fails.get(actorKey) ?? []).filter((t) => now.getTime() - t < FAIL_WINDOW_MS);
    this.fails.set(actorKey, list);
    return list.length;
  }
  private fail(actorKey: string, now: Date) {
    const list = this.fails.get(actorKey) ?? [];
    list.push(now.getTime());
    this.fails.set(actorKey, list);
  }

  /**
   * Validazione del barista, atomica (in Node il blocco e' sincrono: nessuna interruzione tra
   * controllo e scrittura; nel database lo garantiscono SELECT ... FOR UPDATE e l'indice unico).
   * `stayActive(guestId)` dice se l'ospite ha un soggiorno attivo e non scaduto.
   */
  redeem(token: string, actor: RedeemActor, now: Date, stayActive: (guestId: string) => boolean): RedeemOutcome {
    if (this.recentFails(actor.actorKey, now) >= MAX_FAILS) return { ok: false, reason: 'rate_limited' };

    const r = this.redemptions.find((x) => x.tokenHash === hashToken(token || ''));
    if (!r) {
      this.fail(actor.actorKey, now);
      return { ok: false, reason: 'invalid' };
    }
    // staff dello STESSO hotel del riscatto; altrimenti risposta generica (non rivela il token)
    if (!actor.staffId || actor.staffHotelId !== r.hotelId) {
      this.fail(actor.actorKey, now);
      return { ok: false, reason: 'invalid' };
    }
    if (r.status === 'redeemed') {
      this.fail(actor.actorKey, now);
      return { ok: false, reason: 'already_used', redeemedAt: r.redeemedAt };
    }
    if (r.status !== 'pending' || r.expiresAt <= now) {
      if (r.status === 'pending') r.status = 'expired';
      this.fail(actor.actorKey, now);
      return { ok: false, reason: 'expired' };
    }
    const bonus = this.bonuses.find((b) => b.id === r.bonusId)!;
    if (bonus.status !== 'issued' || bonus.expiresAt <= now || !bonus.guestId || !stayActive(bonus.guestId)) {
      this.fail(actor.actorKey, now);
      return { ok: false, reason: 'bonus_not_valid' };
    }
    r.status = 'redeemed';
    r.redeemedAt = now;
    r.redeemedBy = actor.staffId;
    bonus.status = 'redeemed';
    bonus.redeemedAt = now;
    return { ok: true, bonus, redemption: r };
  }

  /** Check-out/cancellazione ospite: il bonus non usato viene annullato (libera il tetto), il legame all'ospite cade. */
  purgeGuest(guestId: string) {
    const mine = this.bonuses.filter((b) => b.guestId === guestId);
    for (const b of mine) {
      for (const r of this.redemptions) {
        if (r.bonusId === b.id && r.status === 'pending') r.status = 'cancelled';
      }
      if (b.status === 'issued') b.status = 'void';
      b.guestId = null;
    }
  }

  /** Equivalente del job periodico purge_expired_stays() per i bonus. */
  expireDue(now: Date) {
    for (const b of this.bonuses) if (b.status === 'issued' && b.expiresAt <= now) b.status = 'expired';
    for (const r of this.redemptions) if (r.status === 'pending' && r.expiresAt <= now) r.status = 'expired';
  }
}
