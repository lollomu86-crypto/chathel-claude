// Contratto di accesso ai dati. Due implementazioni:
//  - DemoStore (src/lib/store/demo.ts): in memoria, per provare l'app senza backend;
//  - SupabaseStore (src/lib/store/supabase.ts): secondo l'architettura (RPC + RLS).
// UI e handler API parlano solo con queste interfacce.

import type {
  AdminEvent,
  AdminFacility,
  AdminNotification,
  AiContext,
  CouponKind,
  CouponQrView,
  CouponView,
  GuestListItem,
  PrivateMessageView,
  PublicMessageView,
  PublicModerationMessage,
  ReportReason,
  SocialReportView,
  SocialSettings,
  SocialStats,
  ThreadDetail,
  ThreadSummary,
  AssistantAppend,
  BonusQr,
  BonusView,
  BookingView,
  ChatView,
  EventView,
  FacilityView,
  GenerateSlotsInput,
  GuestView,
  HandoffConversation,
  Kpis,
  Locale,
  NotificationView,
  Period,
  PublicHotel,
  PublishNotificationInput,
  RedeemResult,
  SaveEventInput,
  SaveKnowledgeInput,
  AiKnowledgeEntry,
  StaffInfo,
  StaffRole,
  StartStayInput,
  StartStayResult,
} from '../types';

/** Livello sociale lato ospite (elenco, chat pubblica, chat privata, coupon). Ogni metodo applica le regole di rules/social.ts. */
export interface SocialGuestApi {
  settings(): Promise<SocialSettings>;
  updateSettings(input: { visible?: boolean; acceptsPrivate?: boolean; nickname?: string }): Promise<SocialSettings>;
  acceptRules(): Promise<void>;
  guests(): Promise<GuestListItem[]>;
  publicFeed(): Promise<PublicMessageView[]>;
  postPublic(text: string): Promise<PublicMessageView>;
  reportPublic(messageId: string, reason: ReportReason): Promise<void>;
  threads(): Promise<ThreadSummary[]>;
  thread(id: string): Promise<ThreadDetail>;
  startThread(toId: string, text: string): Promise<{ threadId: string }>;
  respond(threadId: string, accept: boolean): Promise<void>;
  sendPrivate(threadId: string, text: string): Promise<PrivateMessageView>;
  block(targetId: string): Promise<void>;
  unblock(targetId: string): Promise<void>;
  blocked(): Promise<{ id: string; nickname: string }[]>;
  reportPrivate(threadId: string, messageId: string, reason: ReportReason): Promise<void>;
  sendCoupon(threadId: string, kind: CouponKind): Promise<CouponView>;
  couponQr(couponId: string): Promise<CouponQrView>;
  cancelCoupon(couponId: string): Promise<void>;
}

/** Moderazione e numeri aggregati per il pannello hotel (reception e direttore). Nessun accesso alle chat private. */
export interface SocialStaffApi {
  reports(includeClosed: boolean): Promise<SocialReportView[]>;
  publicFeed(): Promise<PublicModerationMessage[]>;
  hideMessage(messageId: string, hidden: boolean): Promise<void>;
  /** minutes null = fino al check-out */
  muteGuest(socialId: string, muted: boolean, minutes?: number | null): Promise<void>;
  removeGuest(socialId: string, removed: boolean): Promise<void>;
  closeReport(reportId: string, outcome: 'actioned' | 'dismissed'): Promise<void>;
  stats(period: Period): Promise<SocialStats>;
}

export interface GuestApi {
  /** Funzioni sociali (elenco, chat pubblica e privata, coupon). */
  social(): SocialGuestApi;
  /** Se valorizzato, il cookie di sessione va riscritto con questo valore (token rinnovato). */
  refreshedSession?: string;
  view(): Promise<GuestView>;
  setLocale(locale: Locale): Promise<void>;
  bonus(): Promise<BonusView>;
  requestBonusQr(): Promise<BonusQr>;
  events(): Promise<EventView[]>;
  rsvp(eventId: string, going: boolean): Promise<void>;
  facilities(): Promise<FacilityView[]>;
  myBookings(): Promise<BookingView[]>;
  book(slotId: string, partySize: number): Promise<void>;
  cancelBooking(bookingId: string): Promise<void>;
  notifications(): Promise<NotificationView[]>;
  chat(): Promise<ChatView>;
  /** Conta i messaggi dell'ospite oggi (limite giornaliero della chat) */
  guestMessagesToday(): Promise<number>;
  /** Aggiunge un messaggio dell'ospite; apre una nuova conversazione se manca o se l'ultima e' chiusa. */
  appendGuestMessage(text: string): Promise<{ conversationId: string; status: ChatView['status'] }>;
  aiContext(): Promise<AiContext>;
  /** Solo server: aggiunge il messaggio dell'assistente e, se richiesto, passa la conversazione all'operatore. */
  appendAssistantMessage(conversationId: string, a: AssistantAppend): Promise<void>;
  /** "Esci e cancella i miei dati" */
  endMyStay(): Promise<void>;
}

export interface StaffApi {
  readonly info: StaffInfo;
  social(): SocialStaffApi;
  redeem(token: string): Promise<RedeemResult>;
  /** Orari (ISO) delle validazioni di oggi di questo barista: nessun dato personale */
  myRedemptionsToday(): Promise<string[]>;
  kpis(period: Period): Promise<Kpis>;
  events(): Promise<AdminEvent[]>;
  saveEvent(input: SaveEventInput): Promise<void>;
  deleteEvent(id: string): Promise<void>;
  facilities(): Promise<AdminFacility[]>;
  generateSlots(input: GenerateSlotsInput): Promise<number>;
  updateSlot(input: { id: string; capacity?: number; status?: 'open' | 'closed' }): Promise<void>;
  knowledge(): Promise<(AiKnowledgeEntry & { active: boolean })[]>;
  saveKnowledge(input: SaveKnowledgeInput): Promise<void>;
  deleteKnowledge(id: string): Promise<void>;
  /** Contesto per la chat di prova (stessi dati che vedrebbe l'AI per un ospite) */
  aiTestContext(): Promise<AiContext>;
  notifications(): Promise<AdminNotification[]>;
  /** Avvisi ancora inviabili oggi (limite 2 al giorno) */
  notificationsLeftToday(): Promise<number>;
  publishNotification(input: PublishNotificationInput): Promise<void>;
  /** In testa alla coda: prima le emergenze (priority 'urgent'), poi i temi di sicurezza, poi per data. */
  handoffQueue(includeClosed: boolean): Promise<HandoffConversation[]>;
  /** Emergenze aperte (conversazioni 'urgent' non chiuse), per l'avviso in reception. Nessun testo dell'ospite. */
  urgentAlerts(): Promise<{ conversationId: string; at: string; topic: string }[]>;
  unansweredTopics(): Promise<{ topic: string; count: number }[]>;
  handoffReply(conversationId: string, text: string): Promise<void>;
  handoffClose(conversationId: string): Promise<void>;
  markWrong(messageId: string): Promise<void>;
  /** Genera un nuovo token per il QR dell'hotel. In chiaro solo qui. */
  rotateQr(): Promise<{ token: string }>;
  /** Token corrente del QR, se disponibile (solo demo: con Supabase esiste solo l'hash) */
  currentQrToken(): Promise<string | null>;
  /** Codice numerico (6 cifre) con cui l'ospite entra senza QR */
  currentAccessCode(): Promise<string | null>;
  rotateAccessCode(): Promise<{ code: string }>;
}

export interface Store {
  readonly mode: 'demo' | 'supabase';
  publicHotel(slug: string): Promise<PublicHotel | null>;
  /** Hotel (slug) a cui appartiene un codice numerico di ingresso, o null */
  hotelSlugByCode(code: string): Promise<string | null>;
  startStay(input: StartStayInput): Promise<StartStayResult>;
  guest(session: string | undefined): Promise<GuestApi | null>;
  staffLogin(email: string, password: string): Promise<{ session: string; role: StaffRole } | null>;
  /** `opts.hotelId`: hotel scelto dallo staff che appartiene a piu' hotel (verificato: deve essere un suo hotel attivo). */
  staff(session: string | undefined, opts?: { hotelId?: string }): Promise<StaffApi | null>;
  /** Hotel dove l'utente e' staff attivo (per la scelta quando sono piu' di uno). */
  staffHotels(session: string | undefined): Promise<{ id: string; slug: string; name: string; role: StaffRole }[]>;
}
