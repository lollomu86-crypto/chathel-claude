// Livello sociale (P0, decisione dei soci del 13 ottobre 2026): elenco ospiti, chat pubblica per struttura,
// chat privata con richiesta iniziale, coupon, segnalazioni e moderazione.
//
// Modulo di DOMINIO puro: nessun accesso a rete o database, il tempo arriva come parametro `now`.
// Lo usa lo store demo; con Supabase la fonte di verita' e' supabase/migrations/0002_social.sql, che replica
// queste stesse regole (lo store Supabase per il sociale NON e' ancora collegato: vedi NOTE-SVILUPPO).
//
// Regole di privacy (CONTESTO.md, "Regole sociali e privacy"):
//  - compare e usa le funzioni sociali SOLO chi e' maggiorenne e ha scelto di comparire (opt-in, modificabile);
//  - si vede solo nickname (o nome di battesimo) e lingua: mai camera, cognome, date di soggiorno, contatti;
//  - al check-out profilo, messaggi, richieste, blocchi e coupon non usati spariscono (purgeProfile).

import { randomUUID } from 'node:crypto';
import { ChError } from '../errors';
import { addDaysKey, localDayKey, zonedTime } from '../time';
import {
  COUPON_KINDS, REPORT_REASONS,
  type CouponKind, type CouponView, type GuestListItem, type Locale, type Period, type PrivateMessageView,
  type PublicMessageView, type ReportReason, type ReportStatus, type SocialReportView, type SocialStats,
  type SocialSettings, type ThreadDetail, type ThreadStatus, type ThreadSummary, type PublicModerationMessage,
} from '../types';
import { CouponLedger, COUPON_TTL_HOURS, type Coupon } from './coupons';

export const SOCIAL_LIMITS = {
  messageMax: 280,
  publicPerWindow: 5,
  publicWindowMs: 60_000,
  publicPerDay: 100,
  privatePerWindow: 10,
  privateWindowMs: 60_000,
  newContactsPerDay: 5,
  reportsPerDay: 10,
  couponsPerDay: 3,
  couponsActivePerSender: 5,
  nicknameMin: 2,
  nicknameMax: 20,
  publicFeedSize: 100,
  excerptContext: 4,
} as const;

// ----------------------------------------------------------------------------- funzioni pure di supporto

/** Toglie caratteri di controllo e spazi doppi. Non altera il contenuto del messaggio. */
export function normalizeText(raw: unknown): string {
  return String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Messaggio valido: non vuoto, al massimo 280 caratteri (conteggio per punti di codice, non per unita' UTF-16). */
export function checkMessage(raw: unknown): string {
  const t = normalizeText(raw);
  if (!t) throw new ChError('CH003', 'invalid_message');
  if ([...t].length > SOCIAL_LIMITS.messageMax) throw new ChError('CH003', 'too_long');
  return t;
}

/**
 * Nickname pubblico: 2-20 caratteri, lettere/numeri/spazio/apostrofo/trattino/punto.
 * Rifiuta cio' che sembra un contatto o un dato personale (e-mail, link, sequenze di 5+ cifre come numeri di
 * telefono o di camera). Ritorna il nickname pulito oppure null.
 */
export function sanitizeNickname(raw: unknown): string | null {
  const t = normalizeText(raw).replace(/\s+/g, ' ');
  const n = [...t].length;
  if (n < SOCIAL_LIMITS.nicknameMin || n > SOCIAL_LIMITS.nicknameMax) return null;
  if (!/^[\p{L}\p{N} .'_-]+$/u.test(t)) return null;
  if (/\d{5,}/.test(t.replace(/[ .-]/g, ''))) return null;
  if (/(https?|www|\.com|\.it|\.de)/i.test(t)) return null;
  if (!/\p{L}/u.test(t)) return null;
  return t;
}

/** Nome di battesimo derivato dal nome inserito all'ingresso: solo la prima parola, mai il cognome. */
export function defaultNickname(name: string): string {
  const first = normalizeText(name).split(' ')[0] ?? '';
  return sanitizeNickname(first) ?? 'Ospite';
}

// ----------------------------------------------------------------------------- modello

export interface Profile {
  /** socialId: l'unico identificativo esposto agli altri ospiti */
  id: string;
  guestId: string;
  hotelId: string;
  nickname: string;
  locale: Locale;
  isAdult: boolean;
  visible: boolean;
  acceptsPrivate: boolean;
  rulesAcceptedAt: Date | null;
  mutedUntil: Date | null;
  removed: boolean;
  /** fine del soggiorno: limita la validita' dei coupon ricevuti */
  stayExpiresAt: Date;
}
interface PublicMsg { id: string; hotelId: string; authorId: string; text: string; createdAt: Date; hidden: boolean; hiddenAt?: Date }
interface Thread {
  id: string; hotelId: string; initiatorId: string; recipientId: string; status: ThreadStatus;
  createdAt: Date; respondedAt?: Date; lastAt: Date;
  /** chi ha bloccato (non visibile all'altra parte) */
  blockedBy: string | null;
}
interface PrivMsg { id: string; threadId: string; authorId: string; kind: 'text' | 'coupon'; text: string | null; couponId: string | null; createdAt: Date }
interface Report {
  id: string; hotelId: string; kind: 'public' | 'private'; reason: ReportReason; status: ReportStatus; createdAt: Date;
  reporterId: string | null; reportedId: string | null; messageId: string | null; threadId: string | null;
  snapshot: { nickname: string; text: string; at: Date }[];
  closedAt?: Date;
}
type TallyType = 'public_message' | 'private_request' | 'private_accepted' | 'private_declined' | 'private_message';

export interface SocialConfig {
  timezone: string;
  /** tetto di coupon per hotel al giorno e contemporaneamente validi (controllo del costo, oltre ai limiti per mittente) */
  hotelCouponDailyCap?: number;
  hotelCouponActiveCap?: number;
}

const sortByTime = <T extends { createdAt: Date }>(a: T, b: T) => a.createdAt.getTime() - b.createdAt.getTime();

export class SocialHub {
  profiles: Profile[] = [];
  publicMsgs: PublicMsg[] = [];
  threads: Thread[] = [];
  privMsgs: PrivMsg[] = [];
  /** coppie (blocca -> bloccato) per socialId */
  blocks: { by: string; target: string }[] = [];
  reports: Report[] = [];
  readonly coupons: CouponLedger;
  /** Contatori anonimi (nessun id di persona): sopravvivono al check-out e alimentano il pannello hotel. */
  private tally: { type: TallyType; at: Date }[] = [];
  private pubTimes = new Map<string, number[]>();
  private privTimes = new Map<string, number[]>();

  constructor(private readonly cfg: SocialConfig, private readonly newId: () => string = randomUUID) {
    this.coupons = new CouponLedger(newId);
  }

  // ------------------------------------------------------------------------- profili

  /** Chiamato all'ingresso. `optIn` e' la scelta esplicita dell'ospite; senza maggiore eta' non si compare mai. */
  createProfile(p: { guestId: string; hotelId: string; name: string; nickname?: string; locale: Locale; isAdult: boolean; optIn: boolean; stayExpiresAt: Date }): Profile {
    const profile: Profile = {
      id: this.newId(), guestId: p.guestId, hotelId: p.hotelId, nickname: '', locale: p.locale, isAdult: p.isAdult,
      visible: p.isAdult && p.optIn, acceptsPrivate: true, rulesAcceptedAt: null, mutedUntil: null, removed: false,
      stayExpiresAt: p.stayExpiresAt,
    };
    profile.nickname = p.nickname ?? this.uniqueNickname(p.hotelId, defaultNickname(p.name), null);
    this.profiles.push(profile);
    return profile;
  }

  /** nickname gia' in uso in questo hotel (senza distinguere maiuscole)? */
  nicknameTaken(hotelId: string, nick: string): boolean { return this.nickTaken(hotelId, nick, null); }
  private nickTaken(hotelId: string, nick: string, exceptId: string | null) {
    const k = nick.toLocaleLowerCase();
    return this.profiles.some((x) => x.hotelId === hotelId && x.id !== exceptId && x.nickname.toLocaleLowerCase() === k);
  }
  private uniqueNickname(hotelId: string, base: string, exceptId: string | null): string {
    let nick = base;
    for (let i = 2; this.nickTaken(hotelId, nick, exceptId); i++) nick = `${base.slice(0, SOCIAL_LIMITS.nicknameMax - 3)} ${i}`;
    return nick;
  }

  byGuest(guestId: string): Profile | undefined {
    return this.profiles.find((x) => x.guestId === guestId);
  }
  byId(id: string): Profile | undefined {
    return this.profiles.find((x) => x.id === id);
  }
  private me(guestId: string): Profile {
    const p = this.byGuest(guestId);
    if (!p) throw new ChError('CH004', 'forbidden');
    return p;
  }

  /** Puo' vedere e usare le funzioni sociali: maggiorenne, ha scelto di comparire, non rimosso dall'hotel. */
  isEligible(p: Profile | undefined): p is Profile {
    return !!p && p.isAdult && p.visible && !p.removed;
  }
  isMuted(p: Profile, now: Date): boolean {
    return !!p.mutedUntil && p.mutedUntil > now;
  }
  private requireMember(guestId: string): Profile {
    const p = this.me(guestId);
    if (p.removed) throw new ChError('CH004', 'social_removed');
    if (!p.isAdult) throw new ChError('CH004', 'adult_required');
    if (!p.visible) throw new ChError('CH004', 'social_opt_in_required');
    return p;
  }
  /** Come requireMember, piu' regole d'uso accettate e ospite non silenziato (serve per scrivere). */
  private requireWriter(guestId: string, now: Date): Profile {
    const p = this.requireMember(guestId);
    if (!p.rulesAcceptedAt) throw new ChError('CH004', 'rules_required');
    if (this.isMuted(p, now)) throw new ChError('CH004', 'muted');
    return p;
  }

  private dayStart(now: Date): Date {
    return zonedTime(localDayKey(now, this.cfg.timezone), '00:00', this.cfg.timezone);
  }
  private dayEnd(now: Date): Date {
    return zonedTime(addDaysKey(localDayKey(now, this.cfg.timezone), 1), '00:00', this.cfg.timezone);
  }

  private contactsLeft(p: Profile, now: Date): number {
    const start = this.dayStart(now);
    const used = this.threads.filter((t) => t.initiatorId === p.id && t.createdAt >= start).length;
    return Math.max(0, SOCIAL_LIMITS.newContactsPerDay - used);
  }
  private couponsLeft(p: Profile, now: Date): number {
    return Math.max(0, SOCIAL_LIMITS.couponsPerDay - this.coupons.sentSince(p.id, this.dayStart(now)));
  }

  settings(guestId: string, now: Date): SocialSettings {
    const p = this.me(guestId);
    return {
      id: p.id, nickname: p.nickname, visible: p.visible && !p.removed, acceptsPrivate: p.acceptsPrivate, isAdult: p.isAdult,
      rulesAccepted: !!p.rulesAcceptedAt, muted: this.isMuted(p, now), mutedUntil: this.isMuted(p, now) ? p.mutedUntil!.toISOString() : undefined,
      removed: p.removed,
      limits: { messageMax: SOCIAL_LIMITS.messageMax, newContactsPerDay: SOCIAL_LIMITS.newContactsPerDay,
        newContactsLeftToday: this.contactsLeft(p, now), couponsLeftToday: this.couponsLeft(p, now) },
    };
  }

  /** Scelte modificabili in ogni momento. Uscire dall'elenco non cancella i messaggi gia' inviati. */
  updateSettings(guestId: string, input: { visible?: boolean; acceptsPrivate?: boolean; nickname?: string }, now: Date): SocialSettings {
    const p = this.me(guestId);
    if (input.nickname !== undefined) {
      const nick = sanitizeNickname(input.nickname);
      if (!nick) throw new ChError('CH003', 'invalid_nickname');
      if (this.nickTaken(p.hotelId, nick, p.id)) throw new ChError('CH005', 'nickname_taken');
      p.nickname = nick;
    }
    if (input.visible !== undefined) {
      if (input.visible) {
        if (!p.isAdult) throw new ChError('CH004', 'adult_required');
        if (p.removed) throw new ChError('CH004', 'social_removed');
      }
      p.visible = input.visible;
    }
    if (input.acceptsPrivate !== undefined) p.acceptsPrivate = !!input.acceptsPrivate;
    return this.settings(guestId, now);
  }

  acceptRules(guestId: string, now: Date) {
    const p = this.requireMember(guestId);
    p.rulesAcceptedAt ??= now;
  }

  // ------------------------------------------------------------------------- blocchi

  isBlockedEitherWay(a: string, b: string): boolean {
    return this.blocks.some((x) => (x.by === a && x.target === b) || (x.by === b && x.target === a));
  }

  block(guestId: string, targetId: string) {
    const me = this.me(guestId);
    const t = this.byId(targetId);
    if (!t || t.hotelId !== me.hotelId || t.id === me.id) throw new ChError('CH003', 'invalid_guest');
    if (!this.blocks.some((x) => x.by === me.id && x.target === t.id)) this.blocks.push({ by: me.id, target: t.id });
    // chiude i contatti aperti con quella persona e annulla i coupon non usati tra le due parti
    for (const th of this.threads) {
      if ((th.initiatorId === me.id && th.recipientId === t.id) || (th.initiatorId === t.id && th.recipientId === me.id)) th.blockedBy ??= me.id;
    }
    this.coupons.voidBetween(me.id, t.id);
  }
  unblock(guestId: string, targetId: string) {
    const me = this.me(guestId);
    this.blocks = this.blocks.filter((x) => !(x.by === me.id && x.target === targetId));
    for (const th of this.threads) if (th.blockedBy === me.id && (th.initiatorId === targetId || th.recipientId === targetId)) th.blockedBy = null;
  }
  blocked(guestId: string): { id: string; nickname: string }[] {
    const me = this.me(guestId);
    return this.blocks.filter((x) => x.by === me.id).flatMap((x) => {
      const p = this.byId(x.target);
      return p ? [{ id: p.id, nickname: p.nickname }] : [];
    });
  }

  // ------------------------------------------------------------------------- elenco ospiti

  /**
   * Elenco degli altri ospiti visibili della struttura. Solo chi e' a sua volta visibile puo' vederlo (reciprocita'):
   * chi non ha scelto di comparire non puo' neppure guardare chi c'e'. Esclusi: se stessi, rimossi, bloccati (in entrambi i sensi).
   * Campi esposti: id casuale, nickname, lingua, e se accetta messaggi privati. Nient'altro.
   */
  listGuests(guestId: string): GuestListItem[] {
    const me = this.requireMember(guestId);
    return this.profiles
      .filter((x) => x.id !== me.id && x.hotelId === me.hotelId && this.isEligible(x) && !this.isBlockedEitherWay(me.id, x.id))
      .sort((a, b) => a.nickname.localeCompare(b.nickname))
      .map((x) => ({ id: x.id, nickname: x.nickname, locale: x.locale, canMessage: x.acceptsPrivate }));
  }

  // ------------------------------------------------------------------------- chat pubblica

  private hit(map: Map<string, number[]>, key: string, limit: number, windowMs: number, now: Date) {
    const list = (map.get(key) ?? []).filter((t) => now.getTime() - t < windowMs);
    if (list.length >= limit) {
      map.set(key, list);
      throw new ChError('CH007', 'rate_limited');
    }
    list.push(now.getTime());
    map.set(key, list);
  }

  postPublic(guestId: string, rawText: string, now: Date): PublicMessageView {
    const p = this.requireWriter(guestId, now);
    const text = checkMessage(rawText);
    const dayCount = this.publicMsgs.filter((m) => m.authorId === p.id && m.createdAt >= this.dayStart(now)).length;
    if (dayCount >= SOCIAL_LIMITS.publicPerDay) throw new ChError('CH007', 'daily_limit');
    this.hit(this.pubTimes, p.id, SOCIAL_LIMITS.publicPerWindow, SOCIAL_LIMITS.publicWindowMs, now);
    const m: PublicMsg = { id: this.newId(), hotelId: p.hotelId, authorId: p.id, text, createdAt: now, hidden: false };
    this.publicMsgs.push(m);
    this.tally.push({ type: 'public_message', at: now });
    return this.publicView(m, p);
  }

  private publicView(m: PublicMsg, viewer: Profile): PublicMessageView {
    const a = this.byId(m.authorId);
    return {
      id: m.id, authorId: m.authorId, nickname: a?.nickname ?? '', text: m.text, createdAt: m.createdAt.toISOString(),
      mine: m.authorId === viewer.id,
      reportedByMe: this.reports.some((r) => r.kind === 'public' && r.messageId === m.id && r.reporterId === viewer.id),
    };
  }

  /** Ultimi messaggi non nascosti. Nascosti anche quelli di chi ho bloccato (o mi ha bloccato). */
  publicFeed(guestId: string): PublicMessageView[] {
    const me = this.requireMember(guestId);
    return this.publicMsgs
      .filter((m) => m.hotelId === me.hotelId && !m.hidden && this.byId(m.authorId) && !this.isBlockedEitherWay(me.id, m.authorId))
      .sort(sortByTime)
      .slice(-SOCIAL_LIMITS.publicFeedSize)
      .map((m) => this.publicView(m, me));
  }

  // ------------------------------------------------------------------------- segnalazioni

  private reportsToday(reporterId: string, now: Date) {
    return this.reports.filter((r) => r.reporterId === reporterId && r.createdAt >= this.dayStart(now)).length;
  }

  reportPublic(guestId: string, messageId: string, reason: ReportReason, now: Date): void {
    const me = this.requireMember(guestId);
    if (!REPORT_REASONS.includes(reason)) throw new ChError('CH003', 'invalid_input');
    const m = this.publicMsgs.find((x) => x.id === messageId && x.hotelId === me.hotelId);
    if (!m) throw new ChError('CH003', 'invalid_message');
    if (m.authorId === me.id) throw new ChError('CH003', 'invalid_message');
    // una sola segnalazione per messaggio e persona (idempotente)
    if (this.reports.some((r) => r.kind === 'public' && r.messageId === m.id && r.reporterId === me.id)) return;
    if (this.reportsToday(me.id, now) >= SOCIAL_LIMITS.reportsPerDay) throw new ChError('CH007', 'rate_limited');
    const a = this.byId(m.authorId);
    this.reports.push({
      id: this.newId(), hotelId: me.hotelId, kind: 'public', reason, status: 'open', createdAt: now, reporterId: me.id, reportedId: m.authorId,
      messageId: m.id, threadId: null, snapshot: [{ nickname: a?.nickname ?? '', text: m.text, at: m.createdAt }],
    });
  }

  /**
   * Segnalazione di un messaggio privato. Chi segnala condivide con l'hotel SOLO quel messaggio e al massimo 4
   * precedenti della stessa conversazione: l'hotel non legge mai le chat private in altro modo.
   */
  reportPrivate(guestId: string, threadId: string, messageId: string, reason: ReportReason, now: Date): void {
    const me = this.requireMember(guestId);
    if (!REPORT_REASONS.includes(reason)) throw new ChError('CH003', 'invalid_input');
    const th = this.threadOf(me, threadId);
    const msgs = this.privMsgs.filter((x) => x.threadId === th.id && x.kind === 'text').sort(sortByTime);
    const idx = msgs.findIndex((x) => x.id === messageId);
    if (idx < 0 || msgs[idx].authorId === me.id) throw new ChError('CH003', 'invalid_message');
    if (this.reports.some((r) => r.kind === 'private' && r.messageId === messageId && r.reporterId === me.id)) return;
    if (this.reportsToday(me.id, now) >= SOCIAL_LIMITS.reportsPerDay) throw new ChError('CH007', 'rate_limited');
    const slice = msgs.slice(Math.max(0, idx - SOCIAL_LIMITS.excerptContext), idx + 1);
    this.reports.push({
      id: this.newId(), hotelId: me.hotelId, kind: 'private', reason, status: 'open', createdAt: now, reporterId: me.id,
      reportedId: msgs[idx].authorId, messageId, threadId: th.id,
      snapshot: slice.map((x) => ({ nickname: this.byId(x.authorId)?.nickname ?? '', text: x.text ?? '', at: x.createdAt })),
    });
  }

  // ------------------------------------------------------------------------- chat privata

  private threadOf(me: Profile, threadId: string): Thread {
    const th = this.threads.find((x) => x.id === threadId);
    if (!th || (th.initiatorId !== me.id && th.recipientId !== me.id)) throw new ChError('CH003', 'invalid_thread');
    return th;
  }
  private peerOf(me: Profile, th: Thread): Profile | undefined {
    return this.byId(th.initiatorId === me.id ? th.recipientId : th.initiatorId);
  }

  /**
   * Primo contatto = RICHIESTA con un solo messaggio. Il destinatario accetta o rifiuta; finche' non accetta,
   * chi ha scritto non puo' aggiungere altro. Limite di nuovi contatti al giorno. Una richiesta rifiutata non si ripete.
   * Se il destinatario non accetta privati, ha bloccato chi scrive o e' fuori dall'elenco, la risposta e' sempre la
   * stessa ('recipient_unavailable'): chi scrive non puo' capire quale delle cause sia.
   */
  startThread(guestId: string, toId: string, rawText: string, now: Date): { threadId: string } {
    const me = this.requireWriter(guestId, now);
    const text = checkMessage(rawText);
    const to = this.byId(toId);
    if (!to || to.id === me.id || to.hotelId !== me.hotelId) throw new ChError('CH003', 'invalid_guest');
    if (!this.isEligible(to) || !to.acceptsPrivate || this.isBlockedEitherWay(me.id, to.id)) throw new ChError('CH004', 'recipient_unavailable');
    const existing = this.threads.find((t) => (t.initiatorId === me.id && t.recipientId === to.id) || (t.initiatorId === to.id && t.recipientId === me.id));
    if (existing) {
      if (existing.status === 'declined') throw new ChError('CH004', 'recipient_unavailable');
      throw new ChError('CH005', 'thread_exists');
    }
    if (this.contactsLeft(me, now) <= 0) throw new ChError('CH007', 'daily_contact_limit');
    this.hit(this.privTimes, me.id, SOCIAL_LIMITS.privatePerWindow, SOCIAL_LIMITS.privateWindowMs, now);
    const th: Thread = { id: this.newId(), hotelId: me.hotelId, initiatorId: me.id, recipientId: to.id, status: 'pending', createdAt: now, lastAt: now, blockedBy: null };
    this.threads.push(th);
    this.privMsgs.push({ id: this.newId(), threadId: th.id, authorId: me.id, kind: 'text', text, couponId: null, createdAt: now });
    this.tally.push({ type: 'private_request', at: now }, { type: 'private_message', at: now });
    return { threadId: th.id };
  }

  /** Solo il destinatario di una richiesta in attesa. Rifiutare non avvisa con dettagli: l'altra parte vede "non accettata". */
  respond(guestId: string, threadId: string, accept: boolean, now: Date) {
    const me = this.requireMember(guestId);
    const th = this.threadOf(me, threadId);
    if (th.recipientId !== me.id) throw new ChError('CH004', 'forbidden');
    if (th.status !== 'pending') throw new ChError('CH005', 'thread_not_pending');
    th.status = accept ? 'accepted' : 'declined';
    th.respondedAt = now;
    th.lastAt = now;
    this.tally.push({ type: accept ? 'private_accepted' : 'private_declined', at: now });
  }

  private assertOpenBetween(me: Profile, th: Thread) {
    const peer = this.peerOf(me, th);
    if (th.status !== 'accepted') throw new ChError('CH004', 'thread_not_open');
    // blocco (in qualunque direzione), uscita dall'elenco o rimozione dell'altro: nessun dettaglio sul perche'
    if (!peer || th.blockedBy || this.isBlockedEitherWay(me.id, peer.id) || !this.isEligible(peer)) throw new ChError('CH004', 'recipient_unavailable');
    return peer;
  }

  sendPrivate(guestId: string, threadId: string, rawText: string, now: Date): PrivateMessageView {
    const me = this.requireWriter(guestId, now);
    const th = this.threadOf(me, threadId);
    const text = checkMessage(rawText);
    this.assertOpenBetween(me, th);
    this.hit(this.privTimes, me.id, SOCIAL_LIMITS.privatePerWindow, SOCIAL_LIMITS.privateWindowMs, now);
    const m: PrivMsg = { id: this.newId(), threadId: th.id, authorId: me.id, kind: 'text', text, couponId: null, createdAt: now };
    this.privMsgs.push(m);
    th.lastAt = now;
    this.tally.push({ type: 'private_message', at: now });
    return this.privView(m, me, now);
  }

  private couponView(c: Coupon, me: Profile, now: Date): CouponView {
    return { id: c.id, kind: c.kind, status: this.coupons.effective(c, now), expiresAt: c.expiresAt.toISOString(),
      redeemedAt: c.redeemedAt?.toISOString(), direction: c.senderId === me.id ? 'sent' : 'received' };
  }
  private privView(m: PrivMsg, me: Profile, now: Date): PrivateMessageView {
    const c = m.couponId ? this.coupons.get(m.couponId) : undefined;
    return { id: m.id, mine: m.authorId === me.id, kind: m.kind, text: m.text ?? undefined,
      coupon: c ? this.couponView(c, me, now) : undefined, createdAt: m.createdAt.toISOString() };
  }

  private summary(me: Profile, th: Thread): ThreadSummary {
    const peer = this.peerOf(me, th);
    const last = this.privMsgs.filter((x) => x.threadId === th.id).sort(sortByTime).at(-1);
    return {
      id: th.id, peer: { id: peer?.id ?? '', nickname: peer?.nickname ?? '' }, status: th.status, incoming: th.recipientId === me.id,
      lastAt: th.lastAt.toISOString(), preview: last ? (last.kind === 'coupon' ? '' : (last.text ?? '').slice(0, 80)) : '',
    };
  }

  /** Conversazioni (e richieste) dell'ospite. Quelle che ho chiuso con un blocco non compaiono. */
  threadsFor(guestId: string): ThreadSummary[] {
    const me = this.requireMember(guestId);
    return this.threads
      .filter((t) => (t.initiatorId === me.id || t.recipientId === me.id) && t.blockedBy !== me.id && this.peerOf(me, t))
      .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
      .map((t) => this.summary(me, t));
  }

  threadDetail(guestId: string, threadId: string, now: Date): ThreadDetail {
    const me = this.requireMember(guestId);
    const th = this.threadOf(me, threadId);
    if (th.blockedBy === me.id) throw new ChError('CH003', 'invalid_thread');
    let open = false;
    try { this.assertOpenBetween(me, th); open = true; } catch { open = false; }
    const writer = open && !this.isMuted(me, now) && !!me.rulesAcceptedAt;
    return {
      ...this.summary(me, th),
      messages: this.privMsgs.filter((x) => x.threadId === th.id).sort(sortByTime).map((m) => this.privView(m, me, now)),
      canSend: writer,
      canRespond: th.status === 'pending' && th.recipientId === me.id,
      canSendCoupon: writer,
    };
  }

  // ------------------------------------------------------------------------- coupon

  /** Il coupon arriva come messaggio nella chat privata (accettata) tra i due. Valido solo nei locali dell'hotel. */
  sendCoupon(guestId: string, threadId: string, kind: CouponKind, now: Date): CouponView {
    const me = this.requireWriter(guestId, now);
    if (!COUPON_KINDS.includes(kind)) throw new ChError('CH003', 'invalid_coupon');
    const th = this.threadOf(me, threadId);
    const peer = this.assertOpenBetween(me, th);
    if (this.couponsLeft(me, now) <= 0) throw new ChError('CH007', 'coupon_daily_limit');
    if (this.coupons.activeSent(me.id, now) >= SOCIAL_LIMITS.couponsActivePerSender) throw new ChError('CH007', 'coupon_active_limit');
    const dc = this.cfg.hotelCouponDailyCap;
    const ac = this.cfg.hotelCouponActiveCap;
    if (dc !== undefined && this.coupons.hotelSentSince(me.hotelId, this.dayStart(now)) >= dc) throw new ChError('CH007', 'hotel_coupon_limit');
    if (ac !== undefined && this.coupons.hotelActive(me.hotelId, now) >= ac) throw new ChError('CH007', 'hotel_coupon_limit');
    this.hit(this.privTimes, me.id, SOCIAL_LIMITS.privatePerWindow, SOCIAL_LIMITS.privateWindowMs, now);
    const expiresAt = new Date(Math.min(now.getTime() + COUPON_TTL_HOURS * 3_600_000, peer.stayExpiresAt.getTime()));
    const c = this.coupons.issue({ hotelId: me.hotelId, kind, senderId: me.id, recipientId: peer.id, threadId: th.id, now, expiresAt });
    this.privMsgs.push({ id: this.newId(), threadId: th.id, authorId: me.id, kind: 'coupon', text: null, couponId: c.id, createdAt: now });
    th.lastAt = now;
    return this.couponView(c, me, now);
  }

  /** QR del coupon: solo il destinatario, e solo se ha ancora accesso al sociale (come social_coupon_qr in SQL). */
  couponQr(guestId: string, couponId: string, now: Date) {
    const me = this.requireMember(guestId);
    return this.coupons.requestQr(me.id, couponId, now);
  }
  /** Annulla un coupon non usato: solo il mittente, e solo se ha ancora accesso al sociale (come social_cancel_coupon in SQL). */
  cancelCoupon(guestId: string, couponId: string, now: Date) {
    const me = this.requireMember(guestId);
    return this.coupons.cancel(me.id, couponId, now);
  }

  // ------------------------------------------------------------------------- moderazione hotel

  /** Tutti i messaggi pubblici dell'hotel, compresi quelli nascosti, per il pannello. */
  moderationFeed(hotelId: string, now: Date): PublicModerationMessage[] {
    return this.publicMsgs
      .filter((m) => m.hotelId === hotelId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 200)
      .map((m) => {
        const a = this.byId(m.authorId);
        return { id: m.id, authorId: m.authorId, nickname: a?.nickname ?? '', text: m.text, createdAt: m.createdAt.toISOString(), hidden: m.hidden,
          authorMuted: !!a && this.isMuted(a, now), authorRemoved: !!a?.removed };
      });
  }

  hideMessage(hotelId: string, messageId: string, hidden: boolean, now: Date) {
    const m = this.publicMsgs.find((x) => x.id === messageId && x.hotelId === hotelId);
    if (!m) throw new ChError('CH003', 'invalid_message');
    m.hidden = hidden;
    m.hiddenAt = hidden ? now : undefined;
    if (hidden) {
      for (const r of this.reports) if (r.status === 'open' && r.kind === 'public' && r.messageId === m.id) { r.status = 'actioned'; r.closedAt = now; }
    }
  }

  /** Silenzia fino a `until` (es. fino al check-out). Chi e' silenziato non scrive ne' in pubblico ne' in privato. */
  mute(hotelId: string, profileId: string, until: Date | null) {
    const p = this.byId(profileId);
    if (!p || p.hotelId !== hotelId) throw new ChError('CH003', 'invalid_guest');
    p.mutedUntil = until;
  }

  /** Rimuove l'ospite dalle funzioni sociali (esce dall'elenco, non puo' rientrare). Reversibile dall'hotel. */
  setRemoved(hotelId: string, profileId: string, removed: boolean) {
    const p = this.byId(profileId);
    if (!p || p.hotelId !== hotelId) throw new ChError('CH003', 'invalid_guest');
    p.removed = removed;
    if (removed) p.visible = false;
  }

  closeReport(hotelId: string, reportId: string, outcome: 'actioned' | 'dismissed', now: Date) {
    const r = this.reports.find((x) => x.id === reportId && x.hotelId === hotelId);
    if (!r) throw new ChError('CH003', 'invalid_report');
    if (r.status !== 'open') throw new ChError('CH005', 'report_closed');
    r.status = outcome;
    r.closedAt = now;
  }

  reportQueue(hotelId: string, includeClosed: boolean, now: Date): SocialReportView[] {
    return this.reports
      .filter((r) => r.hotelId === hotelId && (includeClosed || r.status === 'open'))
      .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => {
        const reported = r.reportedId ? this.byId(r.reportedId) : undefined;
        const pub = r.kind === 'public' ? this.publicMsgs.find((m) => m.id === r.messageId) : undefined;
        return {
          id: r.id, kind: r.kind, reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString(),
          reporter: (r.reporterId && this.byId(r.reporterId)?.nickname) || '',
          reported: { id: reported?.id ?? null, nickname: reported?.nickname ?? null, muted: !!reported && this.isMuted(reported, now), removed: !!reported?.removed },
          messageId: r.messageId, messageHidden: !!pub?.hidden,
          excerpt: r.snapshot.map((s) => ({ nickname: s.nickname, text: s.text, at: s.at.toISOString() })),
          reportsAgainst: r.reportedId ? this.reports.filter((x) => x.reportedId === r.reportedId).length : 0,
        };
      });
  }

  // ------------------------------------------------------------------------- numeri aggregati

  stats(hotelId: string, period: Period, now: Date): SocialStats {
    const from = period === 'today' ? this.dayStart(now) : period === '7d' ? new Date(now.getTime() - 7 * 86_400_000) : null;
    const inP = (d: Date | undefined) => !!d && (!from || d >= from);
    const n = (t: TallyType) => this.tally.filter((x) => x.type === t && inP(x.at)).length;
    const cs = this.coupons.coupons.filter((c) => c.hotelId === hotelId);
    return {
      period, generatedAt: now.toISOString(),
      visibleGuests: this.profiles.filter((p) => p.hotelId === hotelId && this.isEligible(p)).length,
      publicMessages: n('public_message'),
      privateRequests: n('private_request'), privateAccepted: n('private_accepted'), privateDeclined: n('private_declined'),
      privateMessages: n('private_message'),
      couponsSent: cs.filter((c) => inP(c.createdAt)).length,
      couponsRedeemed: cs.filter((c) => c.status === 'redeemed' && inP(c.redeemedAt)).length,
      couponsExpired: cs.filter((c) => this.coupons.effective(c, now) === 'expired' && inP(c.expiresAt)).length,
      hiddenMessages: this.publicMsgs.filter((m) => m.hotelId === hotelId && m.hidden).length,
      openReports: this.reports.filter((r) => r.hotelId === hotelId && r.status === 'open').length,
    };
  }

  // ------------------------------------------------------------------------- check-out

  /**
   * Cancellazione al check-out / "esci e cancella": profilo, messaggi pubblici, conversazioni e messaggi privati,
   * blocchi, coupon non usati (annullati; resta una riga anonima per i numeri). Le segnalazioni che riguardano la persona
   * vengono chiuse ('subject_left') e il testo condiviso viene cancellato.
   */
  purgeProfile(guestId: string) {
    const p = this.byGuest(guestId);
    if (!p) return;
    this.coupons.purgeProfile(p.id);
    const myThreads = new Set(this.threads.filter((t) => t.initiatorId === p.id || t.recipientId === p.id).map((t) => t.id));
    this.privMsgs = this.privMsgs.filter((m) => !myThreads.has(m.threadId));
    this.threads = this.threads.filter((t) => !myThreads.has(t.id));
    this.publicMsgs = this.publicMsgs.filter((m) => m.authorId !== p.id);
    this.blocks = this.blocks.filter((b) => b.by !== p.id && b.target !== p.id);
    for (const r of this.reports) {
      if (r.reporterId === p.id || r.reportedId === p.id) {
        if (r.reporterId === p.id) r.reporterId = null;
        if (r.reportedId === p.id) r.reportedId = null;
        r.snapshot = [];
        r.messageId = null;
        r.threadId = null;
        if (r.status === 'open') { r.status = 'subject_left'; r.closedAt = new Date(); }
      }
    }
    this.pubTimes.delete(p.id);
    this.privTimes.delete(p.id);
    this.profiles = this.profiles.filter((x) => x.id !== p.id);
  }
}
