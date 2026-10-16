// Tipi condivisi (DTO) tra store (demo / Supabase), handler API e UI.
// Nessun tipo contiene camera o cognome: il modello dati non li prevede (regola privacy).

export const LOCALES = ['it', 'en', 'de', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'it';
export const LOCALE_NAMES: Record<Locale, string> = { it: 'Italiano', en: 'English', de: 'Deutsch', ru: 'Русский' };

export function isLocale(x: unknown): x is Locale {
  return typeof x === 'string' && (LOCALES as readonly string[]).includes(x);
}

/** Testo per lingua, come i campi jsonb di events/facilities/notifications. */
export type I18nText = Partial<Record<Locale, string>>;

export type StaffRole = 'hotel_admin' | 'reception' | 'bartender';
export type ConversationStatus = 'ai' | 'handoff_pending' | 'operator' | 'closed';
export type HandoffReason = 'kb_gap' | 'guest_request' | 'complaint' | 'safety' | 'other';
/** 'urgent' = emergenza: in testa alla coda della reception. */
export type HandoffPriority = 'urgent' | 'normal';
export type MessageRole = 'guest' | 'assistant' | 'operator' | 'system';
export type FacilityKind = 'spa' | 'pool' | 'gamesroom' | 'other';
export type Period = 'today' | '7d' | 'season';

// ---------------------------------------------------------------- pubblico / ospite

export interface PublicHotel {
  slug: string;
  name: string;
  logoUrl: string | null;
  defaultLocale: Locale;
  supportedLocales: Locale[];
}

/** Identita' dell'ospite verificata dal server (accesso con Google, o simulata in demo). Mai e-mail ne' foto. */
export interface GuestIdentity {
  provider: 'google' | 'demo';
  /** identificativo stabile del fornitore (per Google il campo `sub`) */
  subject: string;
  /** solo nome di battesimo */
  givenName: string;
}

export interface StartStayInput {
  slug: string;
  qrToken: string;
  /** Identita' verificata dal server: obbligatoria. Il nome mostrato nell'app e' il nome di battesimo dell'identita'. */
  identity: GuestIdentity;
  /** Supabase: credenziale (coppia di token) dell'utente autenticato, che diventa la sessione del soggiorno. */
  identityCredential?: string;
  /** Supabase: id dell'utente autenticato verificato (auth.users.id). */
  authUserId?: string;
  /** Chiave anti-doppione derivata dall'identita' (HMAC con pepper). Calcolata dal server. */
  identityKey?: string;
  /** Nickname scelto dall'ospite (opzionale; di default il nome di battesimo). */
  nickname?: string;
  /** Versione dell'informativa accettata (registro dei consensi). */
  privacyVersion?: string;
  /** Ignorato se presente: il nome viene dall'identita'. Tenuto per compatibilita' con il vecchio modulo. */
  name?: string;
  locale: Locale;
  /** YYYY-MM-DD, dichiarata dall'ospite (non verificabile senza PMS) */
  checkout: string;
  isAdult: boolean;
  /** Opt-in esplicito all'elenco ospiti e alle funzioni sociali (default: no). Conta solo se isAdult. */
  socialOptIn?: boolean;
}

/** 'throttled' = tetto di bonus emessi nell'ora raggiunto: l'ospite entra, il bonus non viene emesso. */
export type StartStayBonus = 'issued' | 'existing' | 'cap_reached' | 'already_claimed' | 'disabled' | 'throttled';

export interface StartStayResult {
  /** valore opaco da mettere nel cookie di sessione ospite */
  session: string;
  bonus: StartStayBonus;
}

export interface GuestView {
  name: string;
  locale: Locale;
  expiresAt: string;
  hotel: {
    slug: string;
    name: string;
    timezone: string;
    bonusLabel: string;
    bonusEnabled: boolean;
    cancelCutoffMinutes: number;
    maxBookingsPerDay: number;
  };
}

export type BonusState = 'issued' | 'redeemed' | 'expired' | 'void' | 'cap_reached' | 'none';
export interface BonusView {
  state: BonusState;
  label: string;
  expiresAt?: string;
  redeemedAt?: string;
}

export interface BonusQr {
  token: string;
  expiresAt: string;
  label: string;
}

export interface EventView {
  id: string;
  title: I18nText;
  description?: I18nText | null;
  location?: string | null;
  startsAt: string;
  endsAt?: string | null;
  capacity?: number | null;
  /** Solo il NUMERO di adesioni, mai chi. null = non disponibile all'ospite (vedi NOTE-SVILUPPO) */
  goingCount: number | null;
  going: boolean;
}

export interface SlotView {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  booked: number;
}
export interface FacilityView {
  id: string;
  kind: FacilityKind;
  name: I18nText;
  description?: I18nText | null;
  slots: SlotView[];
}
export interface BookingView {
  id: string;
  slotId: string;
  facilityName: I18nText;
  startsAt: string;
  endsAt: string;
  partySize: number;
  status: 'confirmed' | 'cancelled' | 'attended' | 'no_show';
  canCancel: boolean;
}

export interface NotificationView {
  id: string;
  kind: string;
  title: I18nText;
  body?: I18nText | null;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}
export interface ChatView {
  conversationId: string | null;
  status: ConversationStatus;
  messages: ChatMessage[];
}

export interface AiKnowledgeEntry {
  id: string;
  category: string;
  title: string;
  content: string;
  locale: Locale;
  active?: boolean;
  sortOrder?: number;
}

export interface AiContext {
  hotelName: string;
  defaultLocale: Locale;
  timezone: string;
  knowledge: AiKnowledgeEntry[];
  /** Numero della reception (impostazione dell'hotel): compare nel messaggio di emergenza. */
  receptionPhone?: string | null;
  /** Eventi pubblicati in arrivo (dati dell'hotel, nessun dato ospite) */
  events: { title: string; startsAt: string; location?: string | null }[];
}

export interface AssistantAppend {
  text: string;
  handoff?: { reason: HandoffReason; topic: string; priority?: HandoffPriority };
  tokensIn?: number;
  tokensOut?: number;
}

// ---------------------------------------------------------------- staff

export interface StaffInfo {
  role: StaffRole;
  displayName: string;
  hotel: {
    id: string;
    slug: string;
    name: string;
    timezone: string;
    defaultLocale: Locale;
    bonusLabel: string;
    bonusValueCents: number;
    bonusSeasonCap: number;
    bonusFunding: 'hotel' | 'chathel_grant';
    seasonYear: number;
  };
}

export type RedeemFailReason =
  | 'invalid'
  | 'already_used'
  | 'expired'
  | 'bonus_not_valid'
  | 'rate_limited';
export type RedeemResult =
  | {
      ok: true;
      guestName: string;
      label: string;
      /** 'bonus' (default) oppure 'coupon' ricevuto da un altro ospite */
      kind?: 'bonus' | 'coupon';
      couponKind?: CouponKind;
      /** solo nickname di chi ha offerto il coupon */
      fromName?: string;
    }
  | { ok: false; reason: RedeemFailReason; redeemedAt?: string };

export interface Kpis {
  period: Period;
  generatedAt: string;
  /** I1 */
  i1: { activated: number; activationRate: number | null };
  /** I2 */
  i2: {
    issued: number;
    redeemed: number;
    redemptionRatePct: number | null;
    cap: number;
    /** emissioni (emessi+riscattati) / tetto, la misura che il database applica */
    capUsagePct: number | null;
    capUsed: number;
    costCents: number;
  };
  /** I3 */
  i3: {
    bookings: number;
    perFacility: {
      facilityId: string;
      name: I18nText;
      bookedSeats: number;
      availableSeats: number;
      saturationPct: number | null;
    }[];
  };
  /** I4 */
  i4: {
    totalRsvps: number;
    events: { id: string; title: I18nText; rsvps: number; attended: number | null }[];
  };
  /** I5 */
  i5: {
    conversations: number;
    resolvedByAi: number;
    handoffs: number;
    wrongMarked: number;
    wrongRatePct: number | null;
    aiAnswers: number;
    minutesPerQuestion: number;
    hoursSavedEstimate: number;
  };
  /** I6 */
  i6: { engagedPct: number | null; engaged24hPct: number | null; engaged72hPct: number | null };
  /** Cosa NON e' calcolato/filtrato in questa modalita' (mostrato nel pannello) */
  limitations: string[];
}

export interface AdminEvent {
  id: string;
  title: I18nText;
  description?: I18nText | null;
  location?: string | null;
  startsAt: string;
  endsAt?: string | null;
  capacity?: number | null;
  published: boolean;
  rsvps: number;
}
export interface SaveEventInput {
  id?: string;
  title: I18nText;
  description?: I18nText | null;
  location?: string | null;
  startsAt: string;
  endsAt?: string | null;
  capacity?: number | null;
  published: boolean;
}

export interface AdminSlot extends SlotView {
  status: 'open' | 'closed';
}
export interface AdminFacility {
  id: string;
  kind: FacilityKind;
  name: I18nText;
  defaultCapacity: number;
  slots: AdminSlot[];
}
export interface GenerateSlotsInput {
  facilityId: string;
  from: string; // YYYY-MM-DD
  to: string;
  start: string; // HH:MM
  end: string;
  minutes: number;
  capacity?: number | null;
}

export interface SaveKnowledgeInput {
  id?: string;
  category: string;
  title: string;
  content: string;
  locale: Locale;
  active: boolean;
}

export interface PublishNotificationInput {
  title: I18nText;
  body?: I18nText | null;
}
export interface AdminNotification {
  id: string;
  title: I18nText;
  body?: I18nText | null;
  createdAt: string;
}

export interface HandoffConversation {
  id: string;
  status: ConversationStatus;
  locale: Locale;
  startedAt: string;
  handoffAt?: string | null;
  handoffReason?: HandoffReason | null;
  handoffTopic?: string | null;
  /** 'urgent' per le emergenze (in testa alla coda) */
  priority: HandoffPriority;
  messages: (ChatMessage & { markedWrong?: boolean })[];
}

// ---------------------------------------------------------------- livello sociale (P0)
// Regola di privacy: nessun DTO contiene camera, cognome, date di soggiorno o contatti.
// Gli id sono "socialId" casuali, distinti dall'id interno dell'ospite.

export type CouponKind = 'coffee' | 'aperitif' | 'dinner';
export const COUPON_KINDS: readonly CouponKind[] = ['coffee', 'aperitif', 'dinner'];
export type CouponStatus = 'issued' | 'redeemed' | 'expired' | 'void';
export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'other';
export const REPORT_REASONS: readonly ReportReason[] = ['spam', 'harassment', 'inappropriate', 'other'];

export interface SocialSettings {
  id: string;
  nickname: string;
  visible: boolean;
  acceptsPrivate: boolean;
  isAdult: boolean;
  rulesAccepted: boolean;
  muted: boolean;
  mutedUntil?: string;
  removed: boolean;
  limits: { messageMax: number; newContactsPerDay: number; newContactsLeftToday: number; couponsLeftToday: number };
}
export interface GuestListItem { id: string; nickname: string; locale: Locale; canMessage: boolean }
export interface PublicMessageView {
  id: string; authorId: string; nickname: string; text: string; createdAt: string; mine: boolean; reportedByMe: boolean;
}
export interface CouponView {
  id: string; kind: CouponKind; status: CouponStatus; expiresAt: string; redeemedAt?: string; direction: 'sent' | 'received';
}
export type ThreadStatus = 'pending' | 'accepted' | 'declined';
export interface ThreadSummary {
  id: string; peer: { id: string; nickname: string }; status: ThreadStatus;
  /** true se sono il destinatario della richiesta */
  incoming: boolean; lastAt: string; preview: string;
}
export interface PrivateMessageView {
  id: string; mine: boolean; kind: 'text' | 'coupon'; text?: string; coupon?: CouponView; createdAt: string;
}
export interface ThreadDetail extends ThreadSummary {
  messages: PrivateMessageView[];
  canSend: boolean;
  canRespond: boolean;
  canSendCoupon: boolean;
}
export interface CouponQrView { token: string; expiresAt: string; kind: CouponKind }

export type ReportStatus = 'open' | 'actioned' | 'dismissed' | 'subject_left';
export interface SocialReportView {
  id: string;
  kind: 'public' | 'private';
  reason: ReportReason;
  status: ReportStatus;
  createdAt: string;
  reporter: string;
  reported: { id: string | null; nickname: string | null; muted: boolean; removed: boolean };
  messageId: string | null;
  messageHidden: boolean;
  /** Per i privati: SOLO il messaggio segnalato e fino a 4 precedenti, condivisi volontariamente da chi segnala. */
  excerpt: { nickname: string; text: string; at: string }[];
  reportsAgainst: number;
}
export interface PublicModerationMessage {
  id: string; authorId: string; nickname: string; text: string; createdAt: string; hidden: boolean;
  authorMuted: boolean; authorRemoved: boolean;
}
export interface SocialStats {
  period: Period;
  generatedAt: string;
  visibleGuests: number;
  publicMessages: number;
  privateRequests: number;
  privateAccepted: number;
  privateDeclined: number;
  privateMessages: number;
  couponsSent: number;
  couponsRedeemed: number;
  couponsExpired: number;
  hiddenMessages: number;
  openReports: number;
}
