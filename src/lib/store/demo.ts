// Store in memoria per la modalita' DEMO. Replica le regole di schema.sql (accesso a tempo,
// bonus, slot, eventi, cancellazione al check-out) ma NON e' un database: si azzera al riavvio e
// non garantisce concorrenza reale (Node e' a thread singolo; nel database la garanzia sta nei vincoli).
// Solo server.

import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { ChError } from '../errors';
import { identityKey } from '../auth/guest-identity';
import { BONUS_MAX_PER_HOUR_DEFAULT, HOTEL_COUPON_ACTIVE_CAP_DEFAULT, HOTEL_COUPON_DAILY_CAP_DEFAULT } from '../limits';
import { computeKpis, type KpiInput } from '../kpi';
import { pick } from '../i18n';
import { BonusLedger, type HotelBonusConfig } from '../rules/bonus';
import { SlotBook, type BookingPolicy } from '../rules/slots';
import { SocialHub, sanitizeNickname } from '../rules/social';
import { isCouponToken } from '../rules/coupons';
import { cleanGameInput, GAME_LIMITS } from '../rules/games';
import { ALL_FEATURES_ON, cleanWelcome, effectiveFeatures, requireFeature, type MediaType } from '../rules/features';
import { DemoSocialGuest, DemoSocialStaff } from './demo-social';
import { addDaysKey, isDayKey, localDayKey, zonedTime } from '../time';
import { DEFAULT_LOCALE, isLocale, type AdminEvent, type AdminFacility, type AdminNotification, type AiContext,
  type AiKnowledgeEntry, type AssistantAppend, type BonusQr, type BonusView, type BookingView, type ChatMessage,
  type ChatView, type ConversationStatus, type EventView, type FacilityView, type GenerateSlotsInput, type GuestView,
  type HandoffConversation, type HandoffPriority, type HandoffReason, type I18nText, type Kpis, type Locale, type NotificationView,
  type Period, type PublicHotel, type PublishNotificationInput, type RedeemResult, type SaveEventInput,
  type SaveKnowledgeInput, type StaffInfo, type StaffRole, type StartStayInput, type StartStayResult,
  type StartStayBonus, type AdminGame, type GameView, type SaveGameInput, type StaffGuest,
  type FeatureKey, type HotelFeatures, type HotelMediaKind, type SaveCustomizationInput } from '../types';
import type { GuestApi, StaffApi, Store } from './types';
import { DEMO_EVENTS, DEMO_FACILITIES, DEMO_GAMES, DEMO_KB, DEMO_STAFF } from './demo-data';

const HOTEL_ID = 'hotel-demo';
// costanti condivise: definite in ../limits (modulo neutro); riesportate qui per compatibilita'
export { KB_MAX_TOTAL, NOTIFICATIONS_PER_DAY, GUEST_MESSAGES_PER_DAY } from '../limits';
import { KB_MAX_TOTAL, NOTIFICATIONS_PER_DAY } from '../limits';
const DEMO_PEPPER = 'demo-store-pepper';

export interface DemoOptions {
  now?: () => Date;
  bonusCap?: number;
  qrToken?: string;
  accessCode?: string;
  /** se false, parte senza eventi/servizi/base di conoscenza di esempio (test) */
  seed?: boolean;
  /** tetto di bonus emessi nell'ora (default 60) */
  bonusMaxPerHour?: number;
  /** tetti coupon per hotel (default 60 al giorno, 40 validi insieme) */
  hotelCouponDailyCap?: number;
  hotelCouponActiveCap?: number;
  receptionPhone?: string | null;
}

const sha = (s: string) => createHash('sha256').update(s).digest();
const sameHash = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));
const newSession = (prefix: string) => `${prefix}_${randomBytes(24).toString('base64url')}`;

interface Hotel {
  id: string; slug: string; name: string; timezone: string; defaultLocale: Locale; checkoutTime: string;
  maxStayDays: number; bonusEnabled: boolean; bonusLabel: string; bonusValueCents: number; bonusCap: number;
  bonusFunding: 'hotel' | 'chathel_grant'; seasonYear: number; qrTtlSeconds: number;
  maxPerGuestDay: number; cancelCutoffMinutes: number; qrToken: string; accessCode: string; qrPrevToken: string | null; qrPrevUntil: Date | null;
  bonusMaxPerHour: number; receptionPhone: string | null;
  logoUrl: string | null; coverUrl: string | null; welcome: I18nText; features: HotelFeatures;
}
interface G { id: string; name: string; locale: Locale; isAdult: boolean; createdAt: Date; expiresAt: Date; stayId: string; startBonus: StartStayBonus; identityKey: string; lastSeenAt?: Date | null }
interface Stay { id: string; guestId: string | null; startedAt: Date; expiresAt: Date; status: 'active' | 'ended'; firstActionAt: Date | null }
interface Ev { id: string; title: I18nText; description: I18nText | null; location: string | null; startsAt: Date; endsAt: Date | null; capacity: number | null; published: boolean }
interface Att { eventId: string; guestId: string | null; status: 'going' | 'attended' | 'cancelled'; createdAt: Date }
interface Fac { id: string; kind: AdminFacility['kind']; name: I18nText; description: I18nText | null; defaultCapacity: number; active: boolean }
interface Conv { id: string; guestId: string | null; status: ConversationStatus; locale: Locale; startedAt: Date; lastMessageAt: Date; closedAt: Date | null;
  aiAnswerCount: number; handoffAt: Date | null; reason: HandoffReason | null; topic: string | null; assignedTo: string | null; priority: HandoffPriority }
interface Msg { id: string; convId: string; role: ChatMessage['role']; content: string; createdAt: Date; wrong: boolean }
interface Notif { id: string; title: I18nText; body: I18nText | null; createdAt: Date }
interface Know extends AiKnowledgeEntry { active: boolean; sortOrder: number }

export class DemoStore implements Store {
  readonly mode = 'demo' as const;
  readonly clock: () => Date;
  hotel: Hotel;
  guests = new Map<string, G>();
  sessions = new Map<string, string>();
  /** chiave dell'identita' -> ospite con soggiorno attivo (un'identita' = un soggiorno attivo per hotel) */
  identityIndex = new Map<string, string>();
  staffSessions = new Map<string, string>();
  stays: Stay[] = [];
  events: Ev[] = [];
  attendance: Att[] = [];
  facilities: Fac[] = [];
  games: AdminGame[] = [];
  notifs: Notif[] = [];
  convs: Conv[] = [];
  msgs: Msg[] = [];
  wrongMarks: Date[] = [];
  knowledge: Know[] = [];
  ledger = new BonusLedger();
  book = new SlotBook();
  social: SocialHub;
  private seq = 0;

  constructor(opts: DemoOptions = {}) {
    this.clock = opts.now ?? (() => new Date());
    const now = this.clock();
    this.hotel = {
      id: HOTEL_ID, slug: 'demo', name: 'Hotel Demo Alba', timezone: 'Europe/Rome', defaultLocale: 'it',
      checkoutTime: '11:00', maxStayDays: 21, bonusEnabled: true, bonusLabel: "Caffè di benvenuto",
      bonusValueCents: 120, bonusCap: opts.bonusCap ?? 30, bonusFunding: 'hotel', seasonYear: now.getUTCFullYear(),
      qrTtlSeconds: 90, maxPerGuestDay: 2, cancelCutoffMinutes: 60,
      qrToken: opts.qrToken ?? 'demo-qr-token', accessCode: /^\d{6}$/.test(opts.accessCode ?? '') ? (opts.accessCode as string) : '482915', qrPrevToken: null, qrPrevUntil: null,
      bonusMaxPerHour: opts.bonusMaxPerHour ?? BONUS_MAX_PER_HOUR_DEFAULT, receptionPhone: opts.receptionPhone === undefined ? 'interno 9' : opts.receptionPhone,
      logoUrl: null, coverUrl: null, welcome: {}, features: { ...ALL_FEATURES_ON },
    };
    this.social = new SocialHub({
      timezone: this.hotel.timezone,
      hotelCouponDailyCap: opts.hotelCouponDailyCap ?? HOTEL_COUPON_DAILY_CAP_DEFAULT,
      hotelCouponActiveCap: opts.hotelCouponActiveCap ?? HOTEL_COUPON_ACTIVE_CAP_DEFAULT,
    });
    if (opts.seed !== false) this.seed(now);
  }

  id(prefix: string) { return `${prefix}${++this.seq}`; }

  /** Immagini caricate dal pannello (solo in memoria, come il resto della demo). */
  mediaFiles = new Map<string, { type: MediaType; bytes: Uint8Array }>();
  media(id: string) { return this.mediaFiles.get(id) ?? null; }
  /** Interruttori effettivi; come i trigger di 0010, una funzione spenta rifiuta le scritture. */
  features(): HotelFeatures { return effectiveFeatures(this.hotel.features); }
  requireFeature(...keys: FeatureKey[]) { requireFeature(this.features(), ...keys); }

  /** Gioco attivo dell'hotel, per le sfide (come social_challenge_create in SQL). */
  activeGame(id: string): GameView {
    const g = this.games.find((x) => x.id === id && x.active);
    if (!g) throw new ChError('CH003', 'invalid_game');
    return { id: g.id, name: g.name, description: g.description, location: g.location };
  }
  private seed(now: Date) {
    const tz = this.hotel.timezone;
    const today = localDayKey(now, tz);
    for (const e of DEMO_EVENTS) {
      let startsAt = zonedTime(addDaysKey(today, e.day), e.time, tz);
      if (e.day === 0 && startsAt.getTime() < now.getTime() + 3_600_000) startsAt = zonedTime(addDaysKey(today, 1), e.time, tz);
      this.events.push({ id: this.id('ev'), title: e.title, description: e.description, location: e.location, startsAt,
        endsAt: new Date(startsAt.getTime() + e.durationMin * 60_000), capacity: e.capacity, published: e.published });
    }
    // un evento passato (non deve comparire agli ospiti)
    const past = zonedTime(addDaysKey(today, -1), '21:00', tz);
    this.events.push({ id: this.id('ev'), title: { it: 'Serata di ieri', en: 'Last night', de: 'Gestern Abend' }, description: null, location: 'Bar Terrazza',
      startsAt: past, endsAt: new Date(past.getTime() + 2 * 3_600_000), capacity: null, published: true });
    for (const f of DEMO_FACILITIES) {
      const fac: Fac = { id: this.id('fac'), kind: f.kind, name: f.name, description: f.description, defaultCapacity: f.capacity, active: true };
      this.facilities.push(fac);
      this.makeSlots(fac, today, addDaysKey(today, 7), f.start, f.end, f.minutes, f.capacity);
    }
    DEMO_GAMES.forEach((g, i) => this.games.push({ id: this.id('game'), name: g.name, description: g.description, location: g.location, active: true, sortOrder: i }));
    DEMO_KB.forEach((k, i) => this.knowledge.push({ ...k, id: this.id('kb'), active: true, sortOrder: i }));
  }

  makeSlots(f: Fac, from: string, to: string, start: string, end: string, minutes: number, capacity: number): number {
    const tz = this.hotel.timezone;
    let n = 0;
    for (let d = from; d <= to; d = addDaysKey(d, 1)) {
      const dayEnd = zonedTime(d, end, tz).getTime();
      for (let t = zonedTime(d, start, tz).getTime(); t + minutes * 60_000 <= dayEnd; t += minutes * 60_000) {
        if (this.book.addSlot({ hotelId: HOTEL_ID, facilityId: f.id, startsAt: new Date(t), endsAt: new Date(t + minutes * 60_000), capacity })) n++;
      }
    }
    return n;
  }

  // ---------------------------------------------------------------- tempo e ciclo di vita
  now() { return this.clock(); }
  bonusCfg(): HotelBonusConfig {
    const h = this.hotel;
    return { id: h.id, seasonYear: h.seasonYear, cap: h.bonusCap, qrTtlSeconds: h.qrTtlSeconds, enabled: h.bonusEnabled, maxPerHour: h.bonusMaxPerHour };
  }
  policy(): BookingPolicy {
    return { maxPerGuestDay: this.hotel.maxPerGuestDay, cancelCutoffMinutes: this.hotel.cancelCutoffMinutes, timezone: this.hotel.timezone };
  }
  /** Equivalente di purge_expired_stays(): scade e cancella. Chiamato a ogni accesso. */
  tick() {
    const now = this.now();
    this.ledger.expireDue(now);
    this.social.coupons.expireDue(now);
    for (const g of [...this.guests.values()]) if (g.expiresAt <= now) this.purge(g.id, 'expired');
  }
  purge(guestId: string, _why: 'expired' | 'guest_request') {
    const g = this.guests.get(guestId);
    if (!g) return;
    const now = this.now();
    this.ledger.purgeGuest(guestId);
    this.social.purgeProfile(guestId);
    this.book.purgeGuest(guestId, now);
    for (const a of this.attendance) {
      if (a.guestId !== guestId) continue;
      const ev = this.events.find((e) => e.id === a.eventId);
      if (a.status === 'going' && ev && ev.startsAt > now) a.status = 'cancelled';
      a.guestId = null;
    }
    // i messaggi personali si cancellano; restano i contatori e le etichette anonime della conversazione
    const mine = this.convs.filter((c) => c.guestId === guestId);
    const mineIds = new Set(mine.map((c) => c.id));
    this.msgs = this.msgs.filter((m) => !mineIds.has(m.convId));
    for (const c of mine) { c.guestId = null; c.status = 'closed'; c.closedAt ??= now; }
    const stay = this.stays.find((s) => s.id === g.stayId);
    if (stay) { stay.guestId = null; stay.status = 'ended'; }
    for (const [tok, gid] of this.sessions) if (gid === guestId) this.sessions.delete(tok);
    this.identityIndex.delete(g.identityKey);
    this.guests.delete(guestId);
  }

  markAction(guestId: string) {
    const g = this.guests.get(guestId);
    const stay = g && this.stays.find((s) => s.id === g.stayId);
    if (stay && !stay.firstActionAt) stay.firstActionAt = this.now();
  }

  qrValid(token: string): boolean {
    const h = this.hotel;
    if (sameHash(token, h.qrToken)) return true;
    if (/^\d{6}$/.test(token) && sameHash(token, h.accessCode)) return true;
    return !!(h.qrPrevToken && h.qrPrevUntil && h.qrPrevUntil > this.now() && sameHash(token, h.qrPrevToken));
  }

  /** Solo demo: indirizzo del QR dell'hotel con il codice corrente. */
  qrLink(): string { return `/h/${this.hotel.slug}?k=${encodeURIComponent(this.hotel.qrToken)}`; }

  // ---------------------------------------------------------------- Store
  async hotelSlugByCode(code: string): Promise<string | null> {
    return /^\d{6}$/.test(code) && sameHash(code, this.hotel.accessCode) ? this.hotel.slug : null;
  }

  async publicHotel(slug: string): Promise<PublicHotel | null> {
    const h = this.hotel;
    if (slug !== h.slug) return null;
    return { slug: h.slug, name: h.name, logoUrl: h.logoUrl, coverUrl: h.coverUrl, defaultLocale: h.defaultLocale, supportedLocales: ['it', 'en', 'de'] };
  }

  async startStay(input: StartStayInput): Promise<StartStayResult> {
    this.tick();
    const h = this.hotel;
    const now = this.now();
    // l'ingresso richiede SEMPRE un'identita' verificata dal server (login Google, o simulata in demo)
    const ident = input.identity;
    if (!ident || !ident.subject || !ident.provider) throw new ChError('CH004', 'identity_required');
    if (input.slug !== h.slug || !this.qrValid(input.qrToken || '')) throw new ChError('CH003', 'invalid_qr');
    const key = input.identityKey ?? identityKey(ident, DEMO_PEPPER);
    // un'identita' = un solo soggiorno attivo per hotel: chi rientra ritrova il proprio (nessun secondo ospite, nessun secondo bonus)
    const already = this.identityIndex.get(key);
    if (already && this.guests.has(already)) {
      const session = newSession('g');
      this.sessions.set(session, already);
      return { session, bonus: 'existing' };
    }
    const given = (ident.givenName ?? '').trim().slice(0, 24);
    const name = given.length >= 2 ? given : 'Ospite';
    let nickname: string | undefined;
    if (input.nickname !== undefined && input.nickname.trim() !== '') {
      const nick = sanitizeNickname(input.nickname);
      if (!nick) throw new ChError('CH003', 'invalid_nickname');
      if (this.social.nicknameTaken(h.id, nick)) throw new ChError('CH005', 'nickname_taken');
      nickname = nick;
    }
    const locale = isLocale(input.locale) ? input.locale : h.defaultLocale;
    const today = localDayKey(now, h.timezone);
    if (!isDayKey(input.checkout) || input.checkout < today || input.checkout > addDaysKey(today, h.maxStayDays)) {
      throw new ChError('CH003', 'invalid_checkout');
    }
    const expiresAt = new Date(Math.max(zonedTime(input.checkout, h.checkoutTime, h.timezone).getTime(), now.getTime() + 3 * 3_600_000));
    const guestId = randomUUID();
    const stay: Stay = { id: randomUUID(), guestId, startedAt: now, expiresAt, status: 'active', firstActionAt: null };
    let bonus: StartStayBonus = 'disabled';
    this.stays.push(stay);
    const g: G = { id: guestId, name, locale, isAdult: !!input.isAdult, createdAt: now, expiresAt, stayId: stay.id, startBonus: 'disabled', identityKey: key };
    if (h.bonusEnabled && h.bonusCap > 0) {
      try { this.ledger.issue(this.bonusCfg(), guestId, expiresAt, now, key); bonus = 'issued'; }
      catch (e) {
        if (e instanceof ChError && e.code === 'CH001') bonus = 'cap_reached';
        else if (e instanceof ChError && e.code === 'CH007') bonus = 'throttled';
        else if (e instanceof ChError && e.code === 'CH005') bonus = 'already_claimed';
        else throw e;
      }
    }
    g.startBonus = bonus;
    this.guests.set(guestId, g);
    this.identityIndex.set(key, guestId);
    // livello sociale: si compare nell'elenco solo con scelta esplicita E maggiore eta' dichiarata
    this.social.createProfile({ guestId, hotelId: h.id, name, nickname, locale, isAdult: !!input.isAdult, optIn: input.socialOptIn === true, stayExpiresAt: expiresAt });
    const session = newSession('g');
    this.sessions.set(session, guestId);
    return { session, bonus };
  }

  async guest(session: string | undefined): Promise<GuestApi | null> {
    this.tick();
    const gid = session ? this.sessions.get(session) : undefined;
    const g = gid ? this.guests.get(gid) : undefined;
    if (!g) return null;
    // ultimo accesso, al massimo ogni 10 minuti (come touch_guest in 0009)
    const now = this.now();
    if (!g.lastSeenAt || now.getTime() - g.lastSeenAt.getTime() >= 10 * 60_000) g.lastSeenAt = now;
    return new DemoGuestApi(this, g.id);
  }

  async staffLogin(email: string, password: string): Promise<{ session: string; role: StaffRole } | null> {
    const u = DEMO_STAFF.find((x) => x.email === (email || '').trim().toLowerCase());
    // confronto sempre eseguito, anche se l'utente non esiste (tempo costante)
    const ok = sameHash(password || '', u?.password ?? randomUUID());
    if (!u || !ok) return null;
    const session = newSession('s');
    this.staffSessions.set(session, u.id);
    return { session, role: u.role };
  }

  async staff(session: string | undefined, opts?: { hotelId?: string }): Promise<StaffApi | null> {
    this.tick();
    const uid = session ? this.staffSessions.get(session) : undefined;
    const u = DEMO_STAFF.find((x) => x.id === uid);
    if (!u) return null;
    if (opts?.hotelId && opts.hotelId !== HOTEL_ID) return null; // la demo ha un solo hotel
    return new DemoStaffApi(this, u);
  }

  async staffHotels(session: string | undefined) {
    const uid = session ? this.staffSessions.get(session) : undefined;
    const u = DEMO_STAFF.find((x) => x.id === uid);
    return u ? [{ id: HOTEL_ID, slug: this.hotel.slug, name: this.hotel.name, role: u.role }] : [];
  }
}

// ==================================================================== ospite
class DemoGuestApi implements GuestApi {
  constructor(private s: DemoStore, private gid: string) {}
  private get g() { return this.s.guests.get(this.gid)!; }
  private get h() { return this.s.hotel; }

  social() { return new DemoSocialGuest(this.s, this.gid); }

  async view(): Promise<GuestView> {
    const h = this.h;
    return { name: this.g.name, locale: this.g.locale, expiresAt: this.g.expiresAt.toISOString(),
      hotel: { slug: h.slug, name: h.name, timezone: h.timezone, bonusLabel: h.bonusLabel, bonusEnabled: h.bonusEnabled,
        cancelCutoffMinutes: h.cancelCutoffMinutes, maxBookingsPerDay: h.maxPerGuestDay,
        defaultLocale: h.defaultLocale, logoUrl: h.logoUrl, coverUrl: h.coverUrl, welcome: { ...h.welcome }, features: this.s.features() } };
  }
  async setLocale(locale: Locale) { if (isLocale(locale)) this.g.locale = locale; }

  async bonus(): Promise<BonusView> {
    const b = this.s.ledger.bonusOf(this.gid);
    const label = this.h.bonusLabel;
    if (!b) return { state: this.h.bonusEnabled && this.h.bonusCap > 0 ? 'cap_reached' : 'none', label };
    return { state: b.status, label, expiresAt: b.expiresAt.toISOString(), redeemedAt: b.redeemedAt?.toISOString() };
  }
  async requestBonusQr(): Promise<BonusQr> {
    const r = this.s.ledger.requestQr(this.gid, this.s.bonusCfg(), this.s.now());
    return { token: r.token, expiresAt: r.expiresAt.toISOString(), label: this.h.bonusLabel };
  }

  async events(): Promise<EventView[]> {
    const now = this.s.now();
    return this.s.events
      .filter((e) => e.published && (e.endsAt ?? new Date(e.startsAt.getTime() + 3 * 3_600_000)) > now)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((e) => {
        const act = this.s.attendance.filter((a) => a.eventId === e.id && (a.status === 'going' || a.status === 'attended'));
        return { id: e.id, title: e.title, description: e.description, location: e.location, startsAt: e.startsAt.toISOString(),
          endsAt: e.endsAt?.toISOString() ?? null, capacity: e.capacity,
          // solo il NUMERO (mai chi). Con Supabase reale e' null: vedi NOTE-SVILUPPO.
          goingCount: act.length, going: act.some((a) => a.guestId === this.gid) };
      });
  }
  async rsvp(eventId: string, going: boolean) {
    const now = this.s.now();
    const e = this.s.events.find((x) => x.id === eventId && x.published);
    if (!e || (e.endsAt ?? new Date(e.startsAt.getTime() + 3 * 3_600_000)) <= now) throw new ChError('CH003', 'event_unavailable');
    const mine = this.s.attendance.find((a) => a.eventId === eventId && a.guestId === this.gid);
    if (going) {
      if (e.capacity !== null) {
        const taken = this.s.attendance.filter((a) => a.eventId === eventId && (a.status === 'going' || a.status === 'attended') && a.guestId !== this.gid).length;
        if (taken >= e.capacity) throw new ChError('CH002', 'event_full');
      }
      if (mine) { if (mine.status === 'cancelled') mine.status = 'going'; }
      else this.s.attendance.push({ eventId, guestId: this.gid, status: 'going', createdAt: now });
      this.s.markAction(this.gid);
    } else if (mine && mine.status === 'going') mine.status = 'cancelled';
  }

  async facilities(): Promise<FacilityView[]> {
    const now = this.s.now();
    return this.s.facilities.filter((f) => f.active).map((f) => ({
      id: f.id, kind: f.kind, name: f.name, description: f.description,
      slots: [...this.s.book.slots.values()]
        .filter((x) => x.facilityId === f.id && x.status === 'open' && x.startsAt > now)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .map((x) => ({ id: x.id, startsAt: x.startsAt.toISOString(), endsAt: x.endsAt.toISOString(), capacity: x.capacity, booked: x.booked })),
    }));
  }
  async games(): Promise<GameView[]> {
    return this.s.games.filter((g) => g.active).sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => ({ id: g.id, name: g.name, description: g.description, location: g.location }));
  }
  async myBookings(): Promise<BookingView[]> {
    const now = this.s.now();
    return this.s.book.bookings
      .filter((b) => b.guestId === this.gid && (b.status === 'confirmed' || b.status === 'attended'))
      .map((b) => ({ b, slot: this.s.book.slots.get(b.slotId)! }))
      .filter(({ slot }) => slot.endsAt > now)
      .sort((x, y) => x.slot.startsAt.getTime() - y.slot.startsAt.getTime())
      .map(({ b, slot }) => ({ id: b.id, slotId: b.slotId, facilityName: this.s.facilities.find((f) => f.id === slot.facilityId)!.name,
        startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), partySize: b.partySize, status: b.status,
        canCancel: this.s.book.canCancel(b, this.s.policy(), now) }));
  }
  async book(slotId: string, partySize: number) {
    this.s.requireFeature('bookings');
    this.s.book.book(HOTEL_ID, this.gid, slotId, partySize, this.s.policy(), this.s.now());
    this.s.markAction(this.gid);
  }
  async cancelBooking(bookingId: string) { this.s.book.cancel(this.gid, bookingId, this.s.policy(), this.s.now()); }

  async notifications(): Promise<NotificationView[]> {
    return [...this.s.notifs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((n) => ({ id: n.id, kind: 'announcement', title: n.title, body: n.body, createdAt: n.createdAt.toISOString() }));
  }

  private myConv(): Conv | undefined {
    return this.s.convs.filter((c) => c.guestId === this.gid).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  }
  async chat(): Promise<ChatView> {
    const c = this.myConv();
    if (!c) return { conversationId: null, status: 'ai', messages: [] };
    return { conversationId: c.id, status: c.status,
      messages: this.s.msgs.filter((m) => m.convId === c.id).map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })) };
  }
  async guestMessagesToday(): Promise<number> {
    const tz = this.h.timezone;
    const start = zonedTime(localDayKey(this.s.now(), tz), '00:00', tz);
    const mine = new Set(this.s.convs.filter((c) => c.guestId === this.gid).map((c) => c.id));
    return this.s.msgs.filter((m) => mine.has(m.convId) && m.role === 'guest' && m.createdAt >= start).length;
  }
  async appendGuestMessage(text: string) {
    this.s.requireFeature('reception');
    const now = this.s.now();
    let c = this.myConv();
    if (!c || c.status === 'closed') {
      c = { id: randomUUID(), guestId: this.gid, status: 'ai', locale: this.g.locale, startedAt: now, lastMessageAt: now, closedAt: null,
        aiAnswerCount: 0, handoffAt: null, reason: null, topic: null, assignedTo: null, priority: 'normal' };
      this.s.convs.push(c);
    }
    this.s.msgs.push({ id: `m${randomUUID()}`, convId: c.id, role: 'guest', content: text, createdAt: now, wrong: false });
    c.lastMessageAt = now;
    this.s.markAction(this.gid);
    return { conversationId: c.id, status: c.status };
  }
  async aiContext(): Promise<AiContext> {
    return demoAiContext(this.s);
  }
  async appendAssistantMessage(conversationId: string, a: AssistantAppend) {
    const c = this.s.convs.find((x) => x.id === conversationId && x.guestId === this.gid);
    if (!c) throw new ChError('CH004', 'forbidden');
    const now = this.s.now();
    this.s.msgs.push({ id: `m${randomUUID()}`, convId: c.id, role: 'assistant', content: a.text, createdAt: now, wrong: false });
    c.lastMessageAt = now;
    if (a.handoff) {
      c.status = 'handoff_pending'; c.handoffAt = now; c.reason = a.handoff.reason; c.topic = a.handoff.topic.slice(0, 120);
      // un'emergenza non viene mai declassata da un passaggio successivo
      c.priority = a.handoff.priority === 'urgent' || c.priority === 'urgent' ? 'urgent' : 'normal';
    } else {
      c.aiAnswerCount += 1;
    }
  }
  async endMyStay() { this.s.purge(this.gid, 'guest_request'); }
}

function demoAiContext(s: DemoStore): AiContext {
  const now = s.now();
  return {
    hotelName: s.hotel.name, defaultLocale: s.hotel.defaultLocale, timezone: s.hotel.timezone, receptionPhone: s.hotel.receptionPhone,
    knowledge: s.knowledge.filter((k) => k.active).sort((a, b) => a.sortOrder - b.sortOrder)
      .map((k) => ({ id: k.id, category: k.category, title: k.title, content: k.content, locale: k.locale })),
    events: s.events.filter((e) => e.published && (e.endsAt ?? e.startsAt) > now).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, 10)
      .map((e) => ({ title: pick(e.title, s.hotel.defaultLocale), startsAt: e.startsAt.toISOString(), location: e.location })),
  };
}

// ==================================================================== staff
const ADMIN: StaffRole[] = ['hotel_admin'];
const FLOOR: StaffRole[] = ['hotel_admin', 'reception'];
const BAR: StaffRole[] = ['hotel_admin', 'bartender'];

class DemoStaffApi implements StaffApi {
  readonly info: StaffInfo;
  constructor(private s: DemoStore, private u: (typeof DEMO_STAFF)[number]) {
    const h = s.hotel;
    this.info = { role: u.role, displayName: u.name, hotel: { id: h.id, slug: h.slug, name: h.name, timezone: h.timezone,
      defaultLocale: h.defaultLocale, bonusLabel: h.bonusLabel, bonusValueCents: h.bonusValueCents, bonusSeasonCap: h.bonusCap,
      bonusFunding: h.bonusFunding, seasonYear: h.seasonYear, bonusEnabled: h.bonusEnabled,
      logoUrl: h.logoUrl, coverUrl: h.coverUrl, welcome: { ...h.welcome }, features: { ...h.features } } };
  }

  // ---- personalizzazione (come 0010: solo il direttore; spegnere non cancella nulla)
  async saveCustomization(input: SaveCustomizationInput) {
    this.need(ADMIN);
    const h = this.s.hotel;
    if (input.welcome) h.welcome = cleanWelcome(input.welcome);
    if (input.features) h.features = { ...h.features, ...input.features };
    if (input.bonusEnabled !== undefined) h.bonusEnabled = input.bonusEnabled;
  }
  async uploadMedia(kind: HotelMediaKind, bytes: Uint8Array, type: MediaType) {
    this.need(ADMIN);
    const id = `${kind}-${randomUUID()}`;
    this.s.mediaFiles.set(id, { type, bytes: new Uint8Array(bytes) });
    const url = `/api/media/${id}`;
    this.setMedia(kind, url);
    return { url };
  }
  async removeMedia(kind: HotelMediaKind) { this.need(ADMIN); this.setMedia(kind, null); }
  private setMedia(kind: HotelMediaKind, url: string | null) {
    const h = this.s.hotel;
    const prev = kind === 'logo' ? h.logoUrl : h.coverUrl;
    if (prev?.startsWith('/api/media/')) this.s.mediaFiles.delete(prev.slice('/api/media/'.length));
    if (kind === 'logo') h.logoUrl = url; else h.coverUrl = url;
  }
  /** Rispecchia le policy RLS: ruolo non ammesso = 403. */
  private need(roles: StaffRole[]) { if (!roles.includes(this.u.role)) throw new ChError('CH004', 'forbidden'); }
  social() { return new DemoSocialStaff(this.s, this.u.role); }

  /** Come staff_guests() in 0009: solo ospiti con soggiorno in corso, mai chat o contatti. */
  async guests(): Promise<StaffGuest[]> {
    this.need(FLOOR);
    const now = this.s.now();
    return [...this.s.guests.values()]
      .filter((g) => this.s.stays.some((st) => st.id === g.stayId && st.status === 'active' && st.expiresAt > now))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => {
        const stay = this.s.stays.find((st) => st.id === g.stayId)!;
        const b = this.s.ledger.bonusOf(g.id);
        return {
          id: g.id, name: g.name, locale: g.locale, arrivedAt: stay.startedAt.toISOString(), expiresAt: g.expiresAt.toISOString(),
          lastSeenAt: g.lastSeenAt?.toISOString() ?? null,
          bookings: this.s.book.bookings.filter((x) => x.guestId === g.id && (x.status === 'confirmed' || x.status === 'attended'))
            .map((x) => ({ x, slot: this.s.book.slots.get(x.slotId)! }))
            .sort((p, q) => p.slot.startsAt.getTime() - q.slot.startsAt.getTime())
            .map(({ x, slot }) => ({ id: x.id, slotId: x.slotId, facility: this.s.facilities.find((f) => f.id === slot.facilityId)?.name ?? {},
              startsAt: slot.startsAt.toISOString(), party: x.partySize, status: x.status as 'confirmed' | 'attended' })),
          events: this.s.attendance.filter((a) => a.guestId === g.id && (a.status === 'going' || a.status === 'attended'))
            .map((a) => this.s.events.find((e) => e.id === a.eventId)!).filter(Boolean)
            .sort((p, q) => p.startsAt.getTime() - q.startsAt.getTime())
            .map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt.toISOString() })),
          bonus: b ? { status: b.status, redeemedAt: b.redeemedAt?.toISOString() ?? null } : null,
        };
      });
  }

  async redeem(token: string): Promise<RedeemResult> {
    const canRedeem = BAR.includes(this.u.role);
    // QR di un coupon tra ospiti (prefisso "c_"): stesse garanzie del bonus, solo nei locali dell'hotel
    if (isCouponToken(token)) {
      const hub = this.s.social;
      const out = hub.coupons.redeem(token, { actorKey: this.u.id, staffId: canRedeem ? this.u.id : null, staffHotelId: HOTEL_ID },
        this.s.now(), (pid) => { const p = hub.byId(pid); return !!p && this.s.guests.has(p.guestId); });
      if (!out.ok) return { ok: false, reason: out.reason, redeemedAt: out.redeemedAt?.toISOString() };
      const to = out.coupon.recipientId ? hub.byId(out.coupon.recipientId) : undefined;
      const from = out.coupon.senderId ? hub.byId(out.coupon.senderId) : undefined;
      if (to) this.s.markAction(to.guestId);
      return { ok: true, kind: 'coupon', couponKind: out.coupon.kind, guestName: to?.nickname ?? '', fromName: from?.nickname, label: out.coupon.kind };
    }
    const out = this.s.ledger.redeem(token, { actorKey: this.u.id, staffId: canRedeem ? this.u.id : null, staffHotelId: HOTEL_ID },
      this.s.now(), (gid) => this.s.guests.has(gid));
    if (!out.ok) return { ok: false, reason: out.reason, redeemedAt: out.redeemedAt?.toISOString() };
    const g = out.bonus.guestId ? this.s.guests.get(out.bonus.guestId) : undefined;
    if (g) this.s.markAction(g.id);
    return { ok: true, guestName: g?.name ?? '', label: this.s.hotel.bonusLabel };
  }
  async myRedemptionsToday(): Promise<string[]> {
    this.need(BAR);
    const tz = this.s.hotel.timezone;
    const start = zonedTime(localDayKey(this.s.now(), tz), '00:00', tz);
    return this.s.ledger.redemptions
      .filter((r) => r.status === 'redeemed' && r.redeemedBy === this.u.id && r.redeemedAt! >= start)
      .map((r) => r.redeemedAt!.toISOString()).sort().reverse();
  }

  async kpis(period: Period): Promise<Kpis> {
    this.need(ADMIN);
    const s = this.s;
    const input: KpiInput = {
      now: s.now(), tz: s.hotel.timezone, seasonYear: s.hotel.seasonYear, bonusCap: s.hotel.bonusCap,
      bonusValueCents: s.hotel.bonusValueCents, minutesPerQuestion: 3,
      stays: s.stays.map((x) => ({ startedAt: x.startedAt, linked: x.guestId !== null, firstActionAt: x.firstActionAt })),
      bonuses: s.ledger.bonuses.map((b) => ({ issuedAt: b.issuedAt, status: b.status, seasonYear: b.seasonYear })),
      redemptions: s.ledger.redemptions.filter((r) => r.status === 'redeemed').map((r) => ({ redeemedAt: r.redeemedAt! })),
      facilities: s.facilities.map((f) => ({ id: f.id, name: f.name })),
      slots: [...s.book.slots.values()].map((x) => ({ facilityId: x.facilityId, startsAt: x.startsAt, capacity: x.capacity, booked: x.booked })),
      bookings: s.book.bookings.map((b) => ({ createdAt: b.createdAt, status: b.status })),
      events: s.events.map((e) => ({ id: e.id, title: e.title, hasCheckin: false })),
      attendance: s.attendance.map((a) => ({ eventId: a.eventId, status: a.status, createdAt: a.createdAt })),
      conversations: s.convs.map((c) => ({ startedAt: c.startedAt, handoff: c.handoffAt !== null, aiAnswerCount: c.aiAnswerCount })),
      wrongMarks: s.wrongMarks.map((at) => ({ at })),
    };
    return computeKpis(input, period);
  }

  // ---- eventi
  private toAdminEvent(e: Ev): AdminEvent {
    return { id: e.id, title: e.title, description: e.description, location: e.location, startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt?.toISOString() ?? null, capacity: e.capacity, published: e.published,
      rsvps: this.s.attendance.filter((a) => a.eventId === e.id && (a.status === 'going' || a.status === 'attended')).length };
  }
  async events(): Promise<AdminEvent[]> {
    this.need(FLOOR);
    return [...this.s.events].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime()).map((e) => this.toAdminEvent(e));
  }
  async saveEvent(i: SaveEventInput) {
    this.need(FLOOR);
    const title = clean(i.title);
    const startsAt = new Date(i.startsAt);
    const endsAt = i.endsAt ? new Date(i.endsAt) : null;
    if (!title.it || Number.isNaN(startsAt.getTime()) || (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt))
      || (i.capacity != null && i.capacity <= 0)) throw new ChError('CH003', 'invalid_event');
    const data = { title, description: i.description ? clean(i.description) : null, location: i.location?.trim() || null, startsAt, endsAt,
      capacity: i.capacity ?? null, published: !!i.published };
    if (i.id) {
      const e = this.s.events.find((x) => x.id === i.id);
      if (!e) throw new ChError('CH003', 'invalid_event');
      Object.assign(e, data);
    } else this.s.events.push({ id: randomUUID(), ...data });
  }
  async deleteEvent(id: string) {
    this.need(FLOOR);
    this.s.events = this.s.events.filter((e) => e.id !== id);
    this.s.attendance = this.s.attendance.filter((a) => a.eventId !== id);
  }

  // ---- servizi e slot
  async facilities(): Promise<AdminFacility[]> {
    this.need(FLOOR);
    const now = this.s.now();
    const limit = now.getTime() + 14 * 86_400_000;
    return this.s.facilities.map((f) => ({ id: f.id, kind: f.kind, name: f.name, defaultCapacity: f.defaultCapacity,
      slots: [...this.s.book.slots.values()].filter((x) => x.facilityId === f.id && x.endsAt > now && x.startsAt.getTime() < limit)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .map((x) => ({ id: x.id, startsAt: x.startsAt.toISOString(), endsAt: x.endsAt.toISOString(), capacity: x.capacity, booked: x.booked, status: x.status })) }));
  }
  async generateSlots(i: GenerateSlotsInput): Promise<number> {
    this.need(FLOOR);
    const f = this.s.facilities.find((x) => x.id === i.facilityId);
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!f || !isDayKey(i.from) || !isDayKey(i.to) || !hhmm.test(i.start) || !hhmm.test(i.end) || i.end <= i.start
      || i.minutes < 15 || i.minutes > 480 || i.to < i.from || (Date.parse(i.to) - Date.parse(i.from)) / 86_400_000 > 92
      || (i.capacity != null && i.capacity <= 0)) throw new ChError('CH003', 'invalid_range');
    return this.s.makeSlots(f, i.from, i.to, i.start, i.end, i.minutes, i.capacity ?? f.defaultCapacity);
  }
  async updateSlot(i: { id: string; capacity?: number; status?: 'open' | 'closed' }) {
    this.need(FLOOR);
    if (i.capacity !== undefined) this.s.book.setCapacity(i.id, i.capacity);
    if (i.status) this.s.book.setStatus(i.id, i.status);
  }

  // ---- giochi (per le sfide)
  async games(): Promise<AdminGame[]> {
    this.need(FLOOR);
    return [...this.s.games].sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async saveGame(i: SaveGameInput) {
    this.need(FLOOR);
    const v = cleanGameInput(i);
    if (i.id) {
      const g = this.s.games.find((x) => x.id === i.id);
      if (!g) throw new ChError('CH003', 'invalid_game');
      Object.assign(g, v);
    } else {
      if (this.s.games.length >= GAME_LIMITS.perHotel) throw new ChError('CH003', 'invalid_game');
      this.s.games.push({ id: this.s.id('game'), ...v, sortOrder: this.s.games.length });
    }
  }
  async deleteGame(id: string) {
    this.need(FLOOR);
    const n = this.s.games.length;
    this.s.games = this.s.games.filter((g) => g.id !== id);
    if (this.s.games.length === n) throw new ChError('CH003', 'invalid_game');
  }

  // ---- base di conoscenza
  async knowledge() {
    this.need(FLOOR);
    return [...this.s.knowledge].sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async saveKnowledge(i: SaveKnowledgeInput) {
    this.need(FLOOR);
    const title = i.title.trim();
    const content = i.content.trim();
    if (title.length < 1 || title.length > 160 || content.length < 1 || content.length > 4000 || !isLocale(i.locale)) throw new ChError('CH003', 'invalid_entry');
    const others = this.s.knowledge.filter((k) => k.id !== i.id && k.active).reduce((a, k) => a + k.content.length, 0);
    if (i.active && others + content.length > KB_MAX_TOTAL) throw new ChError('CH003', 'kb_too_large');
    if (i.id) {
      const k = this.s.knowledge.find((x) => x.id === i.id);
      if (!k) throw new ChError('CH003', 'invalid_entry');
      Object.assign(k, { category: i.category, title, content, locale: i.locale, active: !!i.active });
    } else {
      this.s.knowledge.push({ id: randomUUID(), category: i.category, title, content, locale: i.locale, active: !!i.active,
        sortOrder: Math.max(-1, ...this.s.knowledge.map((k) => k.sortOrder)) + 1 });
    }
  }
  async deleteKnowledge(id: string) { this.need(FLOOR); this.s.knowledge = this.s.knowledge.filter((k) => k.id !== id); }
  async aiTestContext(): Promise<AiContext> { this.need(FLOOR); return demoAiContext(this.s); }

  // ---- notifiche
  async notifications(): Promise<AdminNotification[]> {
    this.need(FLOOR);
    return [...this.s.notifs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((n) => ({ id: n.id, title: n.title, body: n.body, createdAt: n.createdAt.toISOString() }));
  }
  async notificationsLeftToday(): Promise<number> {
    this.need(FLOOR);
    const tz = this.s.hotel.timezone;
    const start = zonedTime(localDayKey(this.s.now(), tz), '00:00', tz);
    return Math.max(0, NOTIFICATIONS_PER_DAY - this.s.notifs.filter((n) => n.createdAt >= start).length);
  }
  async publishNotification(i: PublishNotificationInput) {
    this.need(FLOOR);
    const title = clean(i.title);
    const body = i.body ? clean(i.body) : null;
    if (!title.it || title.it.length > 120 || Object.values(body ?? {}).some((v) => (v ?? '').length > 500)) throw new ChError('CH003', 'invalid_notification');
    if ((await this.notificationsLeftToday()) <= 0) throw new ChError('CH005', 'daily_notification_limit');
    this.s.notifs.push({ id: randomUUID(), title, body, createdAt: this.s.now() });
  }

  // ---- coda operatore
  async handoffQueue(includeClosed: boolean): Promise<HandoffConversation[]> {
    this.need(FLOOR);
    const rank = (c: Conv) => (c.status !== 'closed' && c.priority === 'urgent' ? 0 : c.status !== 'closed' && c.reason === 'safety' ? 1 : 2);
    return this.s.convs.filter((c) => c.handoffAt && (includeClosed || c.status !== 'closed'))
      .sort((a, b) => rank(a) - rank(b) || b.handoffAt!.getTime() - a.handoffAt!.getTime())
      .map((c) => ({ id: c.id, status: c.status, locale: c.locale, startedAt: c.startedAt.toISOString(), handoffAt: c.handoffAt!.toISOString(),
        handoffReason: c.reason, handoffTopic: c.topic, priority: c.priority,
        messages: this.s.msgs.filter((m) => m.convId === c.id).map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString(), markedWrong: m.wrong })) }));
  }
  async urgentAlerts() {
    this.need(FLOOR);
    return this.s.convs.filter((c) => c.priority === 'urgent' && c.status !== 'closed' && c.handoffAt)
      .sort((a, b) => a.handoffAt!.getTime() - b.handoffAt!.getTime())
      .map((c) => ({ conversationId: c.id, at: c.handoffAt!.toISOString(), topic: c.topic ?? 'emergenza' }));
  }
  async unansweredTopics() {
    this.need(FLOOR);
    const count = new Map<string, number>();
    for (const c of this.s.convs) if (c.topic) count.set(c.topic, (count.get(c.topic) ?? 0) + 1);
    return [...count].map(([topic, n]) => ({ topic, count: n })).sort((a, b) => b.count - a.count);
  }
  async handoffReply(conversationId: string, text: string) {
    this.need(FLOOR);
    const t = text.trim();
    const c = this.s.convs.find((x) => x.id === conversationId);
    if (!c || !t || t.length > 1000 || (c.status !== 'handoff_pending' && c.status !== 'operator')) throw new ChError('CH003', 'invalid_conversation');
    const now = this.s.now();
    this.s.msgs.push({ id: `m${randomUUID()}`, convId: c.id, role: 'operator', content: t, createdAt: now, wrong: false });
    c.status = 'operator'; c.assignedTo = this.u.id; c.lastMessageAt = now;
  }
  async handoffClose(conversationId: string) {
    this.need(FLOOR);
    const c = this.s.convs.find((x) => x.id === conversationId);
    if (!c) throw new ChError('CH003', 'invalid_conversation');
    c.status = 'closed'; c.closedAt = this.s.now();
  }
  async markWrong(messageId: string) {
    this.need(FLOOR);
    const m = this.s.msgs.find((x) => x.id === messageId);
    if (!m || m.role !== 'assistant') throw new ChError('CH003', 'invalid_message');
    if (!m.wrong) { m.wrong = true; this.s.wrongMarks.push(this.s.now()); }
  }

  // ---- QR dell'hotel
  async rotateQr() {
    this.need(ADMIN);
    const h = this.s.hotel;
    h.qrPrevToken = h.qrToken;
    h.qrPrevUntil = new Date(this.s.now().getTime() + 7 * 86_400_000);
    h.qrToken = randomBytes(24).toString('base64url');
    return { token: h.qrToken };
  }
  async currentQrToken() { this.need(ADMIN); return this.s.hotel.qrToken; }
  async currentAccessCode() { this.need(ADMIN); return this.s.hotel.accessCode; }
  async rotateAccessCode() {
    this.need(ADMIN);
    const h = this.s.hotel;
    let c = h.accessCode;
    while (c === h.accessCode) c = String(randomInt(100000, 1000000));
    h.accessCode = c;
    return { code: c };
  }
}

function clean(t: I18nText): I18nText {
  const out: I18nText = {};
  for (const l of ['it', 'en', 'de'] as const) {
    const v = (t?.[l] ?? '').trim();
    if (v) out[l] = v;
  }
  return out;
}

export { DEFAULT_LOCALE };
