// Store con Supabase REALE, secondo docs/02-architettura.md: RLS + RPC SECURITY DEFINER.
//
// ATTENZIONE - NON VERIFICATO contro un progetto Supabase vero (nessun backend disponibile quando e'
// stato scritto). Si prova con un client SIMULATO (tests/fake-supabase.ts: PostgREST finto con tetto di 1000 righe,
// RPC e errori CHxxx) e con le funzioni SQL provate su Postgres 16 (supabase/tests). Mai eseguito contro PostgREST/GoTrue.
// Il client e' senza tipi generati (`any`): prima del pilota generare i tipi con `supabase gen types`.
//
// Solo server. La service_role key serve a: start_stay e identity_register (solo service_role), messaggi 'assistant',
// segnalazione "risposta AI sbagliata" (audit_log), contatori di frequenza condivisi. Non compare mai in codice client.
// `createClient` e' iniettato (src/lib/store/index.ts lo importa dinamicamente): niente dipendenza statica da supabase-js.

import { ChError, fromPgError } from '../errors';
import { kpisFromCounts } from '../kpi';
import { pick } from '../i18n';
import { ConfigError, supabaseConfig } from '../env';
import { GUEST_MESSAGES_PER_DAY, KB_MAX_TOTAL, NOTIFICATIONS_PER_DAY } from '../limits';
import { allow } from '../ratelimit';
import { decodeSession, encodeSession, jwtSub } from '../session-format';
import { localDayKey, zonedTime } from '../time';
import { logEvent } from '../log';
import { isLocale, type AdminEvent, type AdminFacility, type AdminNotification, type AiContext, type AiKnowledgeEntry,
  type AssistantAppend, type BonusQr, type BonusView, type BookingView, type ChatView, type EventView, type FacilityView,
  type GenerateSlotsInput, type GuestView, type HandoffConversation, type Kpis, type Locale, type NotificationView,
  type Period, type PublicHotel, type PublishNotificationInput, type RedeemResult, type SaveEventInput,
  type SaveKnowledgeInput, type StaffInfo, type StaffRole, type StartStayInput, type StartStayResult, type StartStayBonus,
  type I18nText } from '../types';
import type { GuestApi, StaffApi, Store } from './types';
import { SbSocialGuest, SbSocialStaff } from './supabase-social';
import type { RateBackend } from '../ratelimit';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = any;
export type CreateClient = (url: string, key: string, options?: Record<string, unknown>) => Db;
export interface SupabaseDeps { createClient: CreateClient }

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

/** Converte un errore PostgREST in ChError (SQLSTATE CHxxx) oppure in errore generico. */
export function raise(error: { code?: string; message?: string } | null): never {
  if (error) {
    const ch = fromPgError(error);
    if (ch) throw ch;
    // 42501 = privilegio negato (RLS o GRANT): per il client e' un divieto
    if (error.code === '42501') throw new ChError('CH004', 'forbidden');
    // CHECK (booked_count <= capacity) violato aggiornando la capienza di uno slot
    if (error.code === '23514') throw new ChError('CH002', 'capacity_below_booked');
    if (error.code === '23505') throw new ChError('CH005', 'conflict');
    throw new Error(`db_error:${error.code ?? 'unknown'}`);
  }
  throw new Error('db_error');
}
export function ok<T>(r: { data: T | null; error: any }): T {
  if (r.error) raise(r.error);
  return r.data as T;
}
/** Righe toccate da un update/delete con `.select('id')`: 0 righe = oggetto inesistente o di un altro hotel. */
function touched(r: { data: unknown[] | null; error: any }, reason = 'not_found'): void {
  if (r.error) raise(r.error);
  if (!r.data || r.data.length === 0) throw new ChError('CH003', reason);
}
export const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null);
const hex = (h: string) => `\\x${h}`;

export class SupabaseStore implements Store {
  readonly mode = 'supabase' as const;
  constructor(private readonly deps: SupabaseDeps) {}

  private cfg() {
    const c = supabaseConfig();
    if (!c) throw new ConfigError('no_config', 'Supabase non configurato');
    return c;
  }
  private anonClient(): Db { return this.deps.createClient(this.cfg().url, this.cfg().anonKey, opts); }
  private userClient(accessToken: string): Db {
    return this.deps.createClient(this.cfg().url, this.cfg().anonKey, { ...opts, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
  }
  /** Client con la chiave di servizio (bypassa RLS): usare solo per le operazioni elencate in testa al file. */
  serviceClient(): Db {
    const k = this.cfg().serviceKey;
    if (!k) throw new ConfigError('no_config', 'SUPABASE_SERVICE_ROLE_KEY mancante');
    return this.deps.createClient(this.cfg().url, k, opts);
  }
  /** Client del solo server per il provider d'identita' (stessa configurazione). */
  clients() { return { anon: () => this.anonClient(), service: () => this.serviceClient() }; }

  /** Limite di frequenza condiviso tra le istanze (RPC rate_limit_hit, migrazione 0004). Se il database non risponde ripiega sul contatore locale. */
  async rateHit(key: string, limit: number, windowMs: number): Promise<boolean> {
    try {
      const { data, error } = await this.serviceClient().rpc('rate_limit_hit', {
        p_key: key.slice(0, 200), p_limit: limit, p_window_seconds: Math.min(86_400, Math.max(1, Math.ceil(windowMs / 1000))),
      });
      if (error || typeof data !== 'boolean') throw new Error('rate_rpc');
      return data;
    } catch {
      logEvent('ratelimit.backend_fallback', {});
      return allow(key, limit, windowMs);
    }
  }

  async hotelSlugByCode(code: string): Promise<string | null> {
    if (!/^\d{6}$/.test(code)) return null;
    const { data, error } = await this.serviceClient().rpc('hotel_by_code', { p_code: code });
    if (error) raise(error);
    return typeof data === 'string' && data ? data : null;
  }

  async publicHotel(slug: string): Promise<PublicHotel | null> {
    const { data, error } = await this.anonClient().rpc('public_hotel', { p_slug: slug });
    if (error) raise(error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return { slug, name: row.name, logoUrl: row.logo_url ?? null, defaultLocale: row.default_locale,
      supportedLocales: (row.supported_locales ?? ['it', 'en', 'de']).filter(isLocale) };
  }

  async startStay(input: StartStayInput): Promise<StartStayResult> {
    // L'identita' (login Google) e' gia' stata verificata dal server: l'utente autenticato esiste ed e' registrato (identity_register).
    if (!input.authUserId || !input.identityCredential || !input.identityKey) throw new ChError('CH004', 'identity_required');
    // start_stay e' eseguibile solo da service_role (il client non puo' omettere o falsificare i controlli)
    const { data, error } = await this.serviceClient().rpc('start_stay', {
      p_auth_user: input.authUserId, p_slug: input.slug, p_qr_token: input.qrToken, p_nickname: input.nickname ?? null,
      p_locale: input.locale, p_checkout: input.checkout, p_is_adult: input.isAdult, p_social_opt_in: !!(input.socialOptIn && input.isAdult),
      p_identity_key: hex(input.identityKey), p_privacy_version: input.privacyVersion ?? 'v1',
    });
    if (error) raise(error);
    // La sessione di soggiorno e' la stessa coppia di token dell'utente autenticato: il database lega il soggiorno all'utente.
    return { session: input.identityCredential, bonus: ((data as any)?.bonus ?? 'disabled') as StartStayBonus };
  }

  async guest(session: string | undefined): Promise<GuestApi | null> {
    const tok = decodeSession(session);
    if (!tok) return null;
    const db = this.userClient(tok.a);
    // id dell'ospite dell'utente (null se il soggiorno e' scaduto): il filtro per auth_user_id non e' possibile, la colonna non e' leggibile (0004)
    const who = await db.rpc('current_guest_id');
    if (who.error || !who.data) return null; // token scaduto/non valido (il middleware prova il refresh prima) o soggiorno scaduto
    const { data: g, error } = await db.from('guests')
      .select('id, hotel_id, display_name, locale, is_adult, hotels(slug, name, timezone, default_locale, bonus_label, bonus_enabled, bonus_season_cap, booking_cancel_cutoff_minutes, max_bookings_per_guest_day, reception_phone)')
      .eq('id', who.data).maybeSingle();
    if (error || !g) return null;
    const { data: stay } = await db.from('stays').select('expires_at, status').eq('guest_id', g.id).eq('status', 'active')
      .gt('expires_at', new Date().toISOString()).limit(1).maybeSingle();
    if (!stay) return null; // soggiorno scaduto: l'accesso e' gia' chiuso anche dalle policy
    return new SbGuestApi(this, db, g, stay.expires_at);
  }

  async staffLogin(email: string, password: string) {
    const { data, error } = await this.anonClient().auth.signInWithPassword({ email: (email || '').trim().toLowerCase(), password });
    if (error || !data?.session) return null;
    const db = this.userClient(data.session.access_token);
    const { data: st } = await db.from('hotel_staff').select('role').eq('active', true).eq('user_id', data.user.id).order('hotel_id').limit(1).maybeSingle();
    if (!st) return null; // utente valido ma non staff di nessun hotel
    return { session: encodeSession({ a: data.session.access_token, r: data.session.refresh_token }), role: st.role as StaffRole };
  }

  private async memberships(db: Db, uid: string): Promise<any[]> {
    const rows = ok(await db.from('hotel_staff')
      .select('id, role, display_name, hotels(id, slug, name, timezone, default_locale, bonus_label, bonus_value_cents, bonus_season_cap, bonus_funding, season_year)')
      .eq('active', true).eq('user_id', uid).order('hotel_id')) as any[];
    return rows.filter((r) => r.hotels);
  }

  async staffHotels(session: string | undefined) {
    const tok = decodeSession(session);
    if (!tok) return [];
    const db = this.userClient(tok.a);
    const { data: user } = await db.auth.getUser(tok.a);
    if (!user?.user) return [];
    const rows = await this.memberships(db, user.user.id).catch(() => []);
    return rows.map((r) => ({ id: r.hotels.id as string, slug: r.hotels.slug as string, name: r.hotels.name as string, role: r.role as StaffRole }));
  }

  async staff(session: string | undefined, o?: { hotelId?: string }): Promise<StaffApi | null> {
    const tok = decodeSession(session);
    if (!tok) return null;
    const db = this.userClient(tok.a);
    const { data: user } = await db.auth.getUser(tok.a);
    if (!user?.user) return null;
    // Staff di piu' hotel: l'hotel e' quello scelto (verificato tra i SUOI hotel attivi), altrimenti il primo.
    const rows = await this.memberships(db, user.user.id);
    const st = o?.hotelId ? rows.find((r) => r.hotels.id === o.hotelId) : rows[0];
    if (!st) return null;
    const h: any = st.hotels;
    const info: StaffInfo = { role: st.role, displayName: st.display_name, hotel: { id: h.id, slug: h.slug, name: h.name, timezone: h.timezone,
      defaultLocale: h.default_locale, bonusLabel: h.bonus_label, bonusValueCents: h.bonus_value_cents, bonusSeasonCap: h.bonus_season_cap,
      bonusFunding: h.bonus_funding, seasonYear: h.season_year } };
    return new SbStaffApi(this, db, info, st.id, user.user.id);
  }
}

/** Backend dei limiti di frequenza su Postgres (tabella rate_limits): condiviso tra tutte le istanze dell'applicazione. */
export function supabaseRateBackend(store: SupabaseStore): RateBackend {
  return { hit: (key, limit, windowMs) => store.rateHit(key, limit, windowMs) };
}

// ==================================================================== ospite
class SbGuestApi implements GuestApi {
  social() { return new SbSocialGuest(this.db, this.g.hotels?.timezone ?? 'Europe/Rome'); }
  private hotel: any;
  constructor(private store: SupabaseStore, private db: Db, private g: any, private expiresAt: string) { this.hotel = g.hotels; }

  async view(): Promise<GuestView> {
    const h = this.hotel;
    return { name: this.g.display_name, locale: this.g.locale, expiresAt: iso(this.expiresAt)!,
      hotel: { slug: h.slug, name: h.name, timezone: h.timezone, bonusLabel: h.bonus_label, bonusEnabled: h.bonus_enabled,
        cancelCutoffMinutes: h.booking_cancel_cutoff_minutes, maxBookingsPerDay: h.max_bookings_per_guest_day } };
  }
  async setLocale(locale: Locale) {
    if (!isLocale(locale)) return;
    const { error } = await this.db.from('guests').update({ locale }).eq('id', this.g.id);
    if (error) raise(error);
  }

  async bonus(): Promise<BonusView> {
    const label = this.hotel.bonus_label;
    const { data } = await this.db.from('welcome_bonuses').select('status, expires_at, redeemed_at').eq('guest_id', this.g.id).maybeSingle();
    if (!data) {
      // l'ospite non puo' leggere i bonus degli altri: senza riga e con bonus attivo l'unica causa e' il tetto (o un doppione dedupe)
      return { state: this.hotel.bonus_enabled && this.hotel.bonus_season_cap > 0 ? 'cap_reached' : 'none', label };
    }
    return { state: data.status, label, expiresAt: iso(data.expires_at)!, redeemedAt: iso(data.redeemed_at) ?? undefined };
  }
  async requestBonusQr(): Promise<BonusQr> {
    const { data, error } = await this.db.rpc('request_bonus_qr');
    if (error) raise(error);
    return { token: data.token, expiresAt: iso(data.expires_at)!, label: data.label };
  }

  async events(): Promise<EventView[]> {
    const since = new Date(Date.now() - 12 * 3_600_000).toISOString();
    const evs = ok(await this.db.from('events').select('id, title, description, location, starts_at, ends_at, capacity')
      .eq('published', true).gte('starts_at', since).order('starts_at')) as any[];
    const mine = ok(await this.db.from('event_attendance').select('event_id, status').eq('guest_id', this.g.id)) as any[];
    const going = new Set(mine.filter((a) => a.status === 'going' || a.status === 'attended').map((a) => a.event_id));
    const now = Date.now();
    return evs
      .filter((e) => new Date(e.ends_at ?? new Date(e.starts_at).getTime() + 3 * 3_600_000).getTime() > now)
      .map((e) => ({ id: e.id, title: e.title, description: e.description, location: e.location, startsAt: iso(e.starts_at)!,
        endsAt: iso(e.ends_at), capacity: e.capacity,
        // schema.sql: l'ospite non puo' leggere le adesioni altrui, quindi il conteggio non e' disponibile (US-04 CA4 vs RLS)
        goingCount: null, going: going.has(e.id) }));
  }
  async rsvp(eventId: string, going: boolean) {
    const { error } = await this.db.rpc('rsvp_event', { p_event: eventId, p_going: going });
    if (error) raise(error);
  }

  async facilities(): Promise<FacilityView[]> {
    const facs = ok(await this.db.from('facilities').select('id, kind, name, description').eq('active', true)) as any[];
    const slots = ok(await this.db.from('slots').select('id, facility_id, starts_at, ends_at, capacity, booked_count')
      .eq('status', 'open').gt('starts_at', new Date().toISOString()).order('starts_at').limit(1000)) as any[];
    return facs.map((f) => ({ id: f.id, kind: f.kind, name: f.name, description: f.description,
      slots: slots.filter((s) => s.facility_id === f.id).map((s) => ({ id: s.id, startsAt: iso(s.starts_at)!, endsAt: iso(s.ends_at)!, capacity: s.capacity, booked: s.booked_count })) }));
  }
  async myBookings(): Promise<BookingView[]> {
    const rows = ok(await this.db.from('bookings').select('id, slot_id, party_size, status, slots(starts_at, ends_at, facility_id)')
      .in('status', ['confirmed', 'attended'])) as any[];
    const facs = ok(await this.db.from('facilities').select('id, name')) as any[];
    const cutoff = this.hotel.booking_cancel_cutoff_minutes * 60_000;
    const now = Date.now();
    return rows.filter((r) => new Date(r.slots.ends_at).getTime() > now)
      .sort((a, b) => a.slots.starts_at.localeCompare(b.slots.starts_at))
      .map((r) => ({ id: r.id, slotId: r.slot_id, facilityName: facs.find((f) => f.id === r.slots.facility_id)?.name ?? {},
        startsAt: iso(r.slots.starts_at)!, endsAt: iso(r.slots.ends_at)!, partySize: r.party_size, status: r.status,
        canCancel: r.status === 'confirmed' && new Date(r.slots.starts_at).getTime() - cutoff > now }));
  }
  async book(slotId: string, partySize: number) {
    const { error } = await this.db.rpc('book_slot', { p_slot: slotId, p_party_size: partySize });
    if (error) raise(error);
  }
  async cancelBooking(bookingId: string) {
    const { error } = await this.db.rpc('cancel_booking', { p_booking: bookingId });
    if (error) raise(error);
  }

  async notifications(): Promise<NotificationView[]> {
    const rows = ok(await this.db.from('notifications').select('id, kind, title, body, created_at').order('created_at', { ascending: false }).limit(50)) as any[];
    return rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, createdAt: iso(n.created_at)! }));
  }

  private async myConv(): Promise<any | null> {
    const { data } = await this.db.from('ai_conversations').select('id, status').eq('guest_id', this.g.id)
      .order('started_at', { ascending: false }).limit(1).maybeSingle();
    return data ?? null;
  }
  async chat(): Promise<ChatView> {
    const c = await this.myConv();
    if (!c) return { conversationId: null, status: 'ai', messages: [] };
    const msgs = ok(await this.db.from('ai_messages').select('id, role, content, created_at').eq('conversation_id', c.id).order('id')) as any[];
    return { conversationId: c.id, status: c.status, messages: msgs.map((m) => ({ id: String(m.id), role: m.role, content: m.content, createdAt: iso(m.created_at)! })) };
  }
  async guestMessagesToday(): Promise<number> {
    const tz = this.hotel.timezone;
    const start = zonedTime(localDayKey(new Date(), tz), '00:00', tz).toISOString();
    const { count } = await this.db.from('ai_messages').select('id', { count: 'exact', head: true }).eq('role', 'guest').gte('created_at', start);
    return count ?? 0;
  }
  async appendGuestMessage(text: string) {
    let c = await this.myConv();
    if (!c || c.status === 'closed') {
      c = ok(await this.db.from('ai_conversations').insert({ hotel_id: this.g.hotel_id, guest_id: this.g.id, locale: this.g.locale }).select('id, status').single());
    }
    const { error } = await this.db.from('ai_messages').insert({ hotel_id: this.g.hotel_id, conversation_id: c.id, role: 'guest', content: text });
    if (error) raise(error);
    return { conversationId: c.id as string, status: c.status as ChatView['status'] };
  }
  async aiContext(): Promise<AiContext> {
    const { data, error } = await this.db.rpc('ai_context');
    if (error) raise(error);
    const evs = ok(await this.db.from('events').select('title, starts_at, location').eq('published', true)
      .gte('starts_at', new Date().toISOString()).order('starts_at').limit(10)) as any[];
    return { hotelName: data.hotel.name, defaultLocale: data.hotel.default_locale, timezone: data.hotel.timezone,
      receptionPhone: data.hotel.reception_phone ?? undefined,
      knowledge: (data.knowledge ?? []) as AiKnowledgeEntry[],
      events: evs.map((e) => ({ title: pick(e.title, data.hotel.default_locale), startsAt: iso(e.starts_at)!, location: e.location })) };
  }
  async appendAssistantMessage(conversationId: string, a: AssistantAppend) {
    // il messaggio 'assistant' puo' inserirlo solo il server con service_role: prima si verifica che la conversazione
    // sia dell'ospite autenticato (la select passa dalla RLS), poi una sola RPC atomica scrive, conta e passa all'operatore
    const { data: own } = await this.db.from('ai_conversations').select('id').eq('id', conversationId).eq('guest_id', this.g.id).maybeSingle();
    if (!own) throw new ChError('CH004', 'forbidden');
    const { error } = await this.store.serviceClient().rpc('append_assistant_message', {
      p_conversation: conversationId, p_content: a.text, p_tokens_in: a.tokensIn ?? null, p_tokens_out: a.tokensOut ?? null,
      p_handoff_reason: a.handoff?.reason ?? null, p_handoff_topic: a.handoff ? a.handoff.topic.slice(0, 120) : null,
      p_priority: a.handoff?.priority ?? 'normal',
    });
    if (error) raise(error);
  }
  async endMyStay() {
    const { error } = await this.db.rpc('end_my_stay');
    if (error) raise(error);
  }
}

// ==================================================================== staff
class SbStaffApi implements StaffApi {
  social() { return new SbSocialStaff(this.db, this.info.role, this.hid, this.tz); }
  constructor(private store: SupabaseStore, private db: Db, readonly info: StaffInfo, private staffId: string, private userId: string) {}
  private get hid() { return this.info.hotel.id; }
  private get tz() { return this.info.hotel.timezone; }
  private need(roles: StaffRole[]) { if (!roles.includes(this.info.role)) throw new ChError('CH004', 'forbidden'); }
  private todayStart() { return zonedTime(localDayKey(new Date(), this.tz), '00:00', this.tz).toISOString(); }

  async redeem(token: string): Promise<RedeemResult> {
    // prefisso "c." = coupon tra ospiti, "b." (o altro) = bonus di benvenuto
    if (token.startsWith('c.')) {
      const { data, error } = await this.db.rpc('redeem_coupon', { p_token: token });
      if (error) raise(error);
      if (data.ok) return { ok: true, kind: 'coupon', couponKind: data.coupon_kind, guestName: data.guest_name, fromName: data.from_name, label: data.coupon_kind };
      return { ok: false, reason: data.reason, redeemedAt: iso(data.redeemed_at) ?? undefined };
    }
    const { data, error } = await this.db.rpc('redeem_bonus', { p_token: token });
    if (error) raise(error);
    if (data.ok) return { ok: true, guestName: data.guest_name, label: data.label };
    return { ok: false, reason: data.reason, redeemedAt: iso(data.redeemed_at) ?? undefined };
  }
  async myRedemptionsToday(): Promise<string[]> {
    const rows = ok(await this.db.from('bonus_redemptions').select('redeemed_at').eq('redeemed_by', this.staffId).eq('hotel_id', this.hid)
      .eq('status', 'redeemed').gte('redeemed_at', this.todayStart()).order('redeemed_at', { ascending: false })) as any[];
    return rows.map((r) => iso(r.redeemed_at)!);
  }

  async kpis(period: Period): Promise<Kpis> {
    this.need(['hotel_admin']);
    // conteggi calcolati dal database (count(*)): nessuna lettura di tabelle intere, nessun taglio a 1000 righe
    const { data, error } = await this.db.rpc('hotel_kpi_counts', { p_hotel: this.hid, p_period: period });
    if (error) raise(error);
    return kpisFromCounts(data, { period, now: new Date(), bonusCap: this.info.hotel.bonusSeasonCap,
      bonusValueCents: this.info.hotel.bonusValueCents, minutesPerQuestion: 3 });
  }

  // ---- eventi
  async events(): Promise<AdminEvent[]> {
    this.need(['hotel_admin', 'reception']);
    const evs = ok(await this.db.from('events').select('*').eq('hotel_id', this.hid).order('starts_at', { ascending: false })) as any[];
    const att = ok(await this.db.from('event_attendance').select('event_id, status').eq('hotel_id', this.hid)) as any[];
    return evs.map((e) => ({ id: e.id, title: e.title, description: e.description, location: e.location, startsAt: iso(e.starts_at)!,
      endsAt: iso(e.ends_at), capacity: e.capacity, published: e.published,
      rsvps: att.filter((a) => a.event_id === e.id && (a.status === 'going' || a.status === 'attended')).length }));
  }
  async saveEvent(i: SaveEventInput) {
    this.need(['hotel_admin', 'reception']);
    const row = { title: i.title, description: i.description ?? null, location: i.location ?? null, starts_at: i.startsAt,
      ends_at: i.endsAt ?? null, capacity: i.capacity ?? null, published: i.published };
    if (i.id) touched(await this.db.from('events').update(row).eq('id', i.id).eq('hotel_id', this.hid).select('id'));
    else { const r = await this.db.from('events').insert({ ...row, hotel_id: this.hid, created_by: this.userId }); if (r.error) raise(r.error); }
  }
  async deleteEvent(id: string) { this.need(['hotel_admin', 'reception']); touched(await this.db.from('events').delete().eq('id', id).eq('hotel_id', this.hid).select('id')); }

  // ---- servizi
  async facilities(): Promise<AdminFacility[]> {
    this.need(['hotel_admin', 'reception']);
    const facs = ok(await this.db.from('facilities').select('id, kind, name, default_capacity').eq('hotel_id', this.hid)) as any[];
    const now = new Date();
    const slots = ok(await this.db.from('slots').select('id, facility_id, starts_at, ends_at, capacity, booked_count, status')
      .eq('hotel_id', this.hid).gt('ends_at', now.toISOString()).lt('starts_at', new Date(now.getTime() + 14 * 86_400_000).toISOString()).order('starts_at').limit(2000)) as any[];
    return facs.map((f) => ({ id: f.id, kind: f.kind, name: f.name, defaultCapacity: f.default_capacity,
      slots: slots.filter((s) => s.facility_id === f.id).map((s) => ({ id: s.id, startsAt: iso(s.starts_at)!, endsAt: iso(s.ends_at)!, capacity: s.capacity, booked: s.booked_count, status: s.status })) }));
  }
  async generateSlots(i: GenerateSlotsInput): Promise<number> {
    const { data, error } = await this.db.rpc('generate_slots', { p_facility: i.facilityId, p_from: i.from, p_to: i.to,
      p_start: i.start, p_end: i.end, p_minutes: i.minutes, p_capacity: i.capacity ?? null });
    if (error) raise(error);
    return data as number;
  }
  async updateSlot(i: { id: string; capacity?: number; status?: 'open' | 'closed' }) {
    const patch: Record<string, unknown> = {};
    if (i.capacity !== undefined) patch.capacity = i.capacity;
    if (i.status) patch.status = i.status;
    this.need(['hotel_admin', 'reception']);
    touched(await this.db.from('slots').update(patch).eq('id', i.id).eq('hotel_id', this.hid).select('id'));
  }

  // ---- base di conoscenza
  async knowledge() {
    this.need(['hotel_admin', 'reception']);
    const rows = ok(await this.db.from('ai_knowledge').select('id, category, title, content, locale, active, sort_order').eq('hotel_id', this.hid).order('sort_order')) as any[];
    return rows.map((k) => ({ id: k.id, category: k.category, title: k.title, content: k.content, locale: k.locale as Locale, active: k.active, sortOrder: k.sort_order }));
  }
  async saveKnowledge(i: SaveKnowledgeInput) {
    this.need(['hotel_admin', 'reception']);
    const all = await this.knowledge();
    const others = all.filter((k) => k.id !== i.id && k.active).reduce((a, k) => a + k.content.length, 0);
    if (i.active && others + i.content.length > KB_MAX_TOTAL) throw new ChError('CH003', 'kb_too_large');
    const row = { category: i.category, title: i.title.trim(), content: i.content.trim(), locale: i.locale, active: i.active, updated_by: this.userId };
    if (i.id) touched(await this.db.from('ai_knowledge').update(row).eq('id', i.id).eq('hotel_id', this.hid).select('id'));
    else { const r = await this.db.from('ai_knowledge').insert({ ...row, hotel_id: this.hid, sort_order: all.length }); if (r.error) raise(r.error); }
  }
  async deleteKnowledge(id: string) { this.need(['hotel_admin', 'reception']); touched(await this.db.from('ai_knowledge').delete().eq('id', id).eq('hotel_id', this.hid).select('id')); }
  async aiTestContext(): Promise<AiContext> {
    // ai_context() e' per l'ospite (usa my_guest_id): per lo staff si legge la stessa base direttamente (RLS staff)
    const kb = (await this.knowledge()).filter((k) => k.active);
    const evs = ok(await this.db.from('events').select('title, starts_at, location').eq('hotel_id', this.hid).eq('published', true)
      .gte('starts_at', new Date().toISOString()).order('starts_at').limit(10)) as any[];
    return { hotelName: this.info.hotel.name, defaultLocale: this.info.hotel.defaultLocale, timezone: this.tz,
      receptionPhone: await this.receptionPhone(),
      knowledge: kb.map((k) => ({ id: k.id, category: k.category, title: k.title, content: k.content, locale: k.locale })),
      events: evs.map((e) => ({ title: pick(e.title, this.info.hotel.defaultLocale), startsAt: iso(e.starts_at)!, location: e.location })) };
  }

  private async receptionPhone(): Promise<string | undefined> {
    const { data } = await this.db.from('hotels').select('reception_phone').eq('id', this.hid).maybeSingle();
    return data?.reception_phone ?? undefined;
  }

  // ---- notifiche
  async notifications(): Promise<AdminNotification[]> {
    this.need(['hotel_admin', 'reception']);
    const rows = ok(await this.db.from('notifications').select('id, title, body, created_at').eq('hotel_id', this.hid).is('guest_id', null).order('created_at', { ascending: false }).limit(50)) as any[];
    return rows.map((n) => ({ id: n.id, title: n.title, body: n.body, createdAt: iso(n.created_at)! }));
  }
  async notificationsLeftToday(): Promise<number> {
    // il limite di 2 al giorno e' applicato dall'APPLICAZIONE (schema.sql non ha un vincolo): vedi NOTE-SVILUPPO
    const { count } = await this.db.from('notifications').select('id', { count: 'exact', head: true }).eq('hotel_id', this.hid).is('guest_id', null).gte('created_at', this.todayStart());
    return Math.max(0, NOTIFICATIONS_PER_DAY - (count ?? 0));
  }
  async publishNotification(i: PublishNotificationInput) {
    this.need(['hotel_admin', 'reception']);
    if ((await this.notificationsLeftToday()) <= 0) throw new ChError('CH005', 'daily_notification_limit');
    const r = await this.db.from('notifications').insert({ hotel_id: this.hid, kind: 'announcement', title: i.title, body: i.body ?? null, created_by: this.userId });
    if (r.error) raise(r.error);
  }

  // ---- coda operatore
  async handoffQueue(includeClosed: boolean): Promise<HandoffConversation[]> {
    this.need(['hotel_admin', 'reception']);
    // la RLS (0004) mostra alla reception SOLO le conversazioni passate all'operatore (handoff_at non nullo)
    let q = this.db.from('ai_conversations').select('id, status, locale, started_at, handoff_at, handoff_reason, handoff_topic, handoff_priority')
      .eq('hotel_id', this.hid).not('handoff_at', 'is', null).order('handoff_at', { ascending: false }).limit(100);
    if (!includeClosed) q = q.neq('status', 'closed');
    const convs = ok(await q) as any[];
    if (!convs.length) return [];
    const msgs = ok(await this.db.from('ai_messages').select('id, conversation_id, role, content, created_at').in('conversation_id', convs.map((c) => c.id)).order('id')) as any[];
    const wrong = ok(await this.store.serviceClient().from('audit_log').select('meta').eq('hotel_id', this.hid).eq('action', 'ai.marked_wrong').limit(1000)) as any[];
    const wrongIds = new Set(wrong.map((w) => String(w.meta?.message_id)));
    const rank = (c: any) => (c.handoff_priority === 'urgent' ? 0 : c.handoff_reason === 'safety' ? 1 : 2);
    return convs
      .map((c) => ({ id: c.id, status: c.status, locale: c.locale, startedAt: iso(c.started_at)!, handoffAt: iso(c.handoff_at),
        handoffReason: c.handoff_reason, handoffTopic: c.handoff_topic, priority: (c.handoff_priority === 'urgent' ? 'urgent' : 'normal') as 'urgent' | 'normal',
        messages: msgs.filter((m) => m.conversation_id === c.id).map((m) => ({ id: String(m.id), role: m.role, content: m.content, createdAt: iso(m.created_at)!, markedWrong: wrongIds.has(String(m.id)) })),
        _r: rank(c) }))
      .sort((a, b) => a._r - b._r || (b.handoffAt ?? '').localeCompare(a.handoffAt ?? ''))
      .map(({ _r, ...rest }) => rest);
  }
  async urgentAlerts() {
    this.need(['hotel_admin', 'reception']);
    const rows = ok(await this.db.from('ai_conversations').select('id, handoff_at, handoff_topic').eq('hotel_id', this.hid)
      .eq('handoff_priority', 'urgent').neq('status', 'closed').not('handoff_at', 'is', null).order('handoff_at')) as any[];
    return rows.map((r) => ({ conversationId: r.id as string, at: iso(r.handoff_at)!, topic: (r.handoff_topic as string) ?? 'emergenza' }));
  }
  async unansweredTopics() {
    this.need(['hotel_admin', 'reception']);
    const rows = ok(await this.db.from('ai_conversations').select('handoff_topic').eq('hotel_id', this.hid).not('handoff_topic', 'is', null).limit(5000)) as any[];
    const count = new Map<string, number>();
    for (const r of rows) count.set(r.handoff_topic, (count.get(r.handoff_topic) ?? 0) + 1);
    return [...count].map(([topic, n]) => ({ topic, count: n })).sort((a, b) => b.count - a.count);
  }
  async handoffReply(conversationId: string, text: string) {
    this.need(['hotel_admin', 'reception']);
    const m = await this.db.from('ai_messages').insert({ hotel_id: this.hid, conversation_id: conversationId, role: 'operator', staff_id: this.staffId, content: text.trim() });
    if (m.error) raise(m.error);
    touched(await this.db.from('ai_conversations').update({ status: 'operator', assigned_to: this.staffId }).eq('id', conversationId).eq('hotel_id', this.hid).select('id'));
  }
  async handoffClose(conversationId: string) {
    this.need(['hotel_admin', 'reception']);
    touched(await this.db.from('ai_conversations').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', conversationId).eq('hotel_id', this.hid).select('id'));
  }
  async markWrong(messageId: string) {
    this.need(['hotel_admin', 'reception']);
    // nessuna colonna "risposta sbagliata": si registra in audit_log (scrivibile solo da service_role) dopo aver verificato che il messaggio
    // sia un messaggio 'assistant' di una conversazione passata all'operatore (RLS). Un indice unico (0004) rende la segnalazione idempotente.
    const { data: m } = await this.db.from('ai_messages').select('id, role').eq('id', messageId).eq('hotel_id', this.hid).maybeSingle();
    if (!m || m.role !== 'assistant') throw new ChError('CH003', 'invalid_message');
    const r = await this.store.serviceClient().from('audit_log').insert({ hotel_id: this.hid, actor_user_id: this.userId, action: 'ai.marked_wrong', entity: 'ai_message', meta: { message_id: m.id } });
    if (r.error && r.error.code !== '23505') raise(r.error);
  }

  async rotateQr() {
    this.need(['hotel_admin']);
    this.need(['hotel_admin']);
    const { data, error } = await this.db.rpc('rotate_hotel_qr', { p_hotel: this.hid, p_grace_days: 7 });
    if (error) raise(error);
    return { token: data as string };
  }
  async currentQrToken(): Promise<string | null> { return null; } // nel database c'e' solo l'hash
  async currentAccessCode(): Promise<string | null> {
    this.need(['hotel_admin']);
    const { data, error } = await this.db.rpc('get_hotel_access_code', { p_hotel: this.hid });
    if (error) raise(error);
    return typeof data === 'string' ? data : null;
  }
  async rotateAccessCode() {
    this.need(['hotel_admin']);
    const { data, error } = await this.db.rpc('rotate_hotel_access_code', { p_hotel: this.hid });
    if (error) raise(error);
    return { code: data as string };
  }
}

export { GUEST_MESSAGES_PER_DAY };
export type { I18nText };
