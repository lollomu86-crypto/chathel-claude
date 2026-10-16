// Calcolo degli indicatori I1-I6 del pannello (docs/01-scope-mvp.md, sezione 4).
// Funzione PURA: la usano sia lo store demo (dati in memoria) sia lo store Supabase (dati letti
// con query). Cosi' i numeri hanno una sola definizione e sono testabili con un conteggio manuale.
// Principio: nessuna stima mascherata da dato. Cio' che non si puo' calcolare e' null e finisce in `limitations`.

import { localDayKey, zonedTime } from './time';
import type { I18nText, Kpis, Period } from './types';

export interface KpiInput {
  now: Date;
  tz: string;
  seasonYear: number;
  bonusCap: number;
  bonusValueCents: number;
  minutesPerQuestion: number;
  /** soggiorni (anche gia' anonimi). `linked` = ospite ancora presente (serve a I6) */
  stays: { startedAt: Date; linked: boolean; firstActionAt: Date | null }[];
  bonuses: { issuedAt: Date; status: 'issued' | 'redeemed' | 'expired' | 'void'; seasonYear: number }[];
  /** solo riscatti effettivamente validati */
  redemptions: { redeemedAt: Date }[];
  facilities: { id: string; name: I18nText }[];
  /** `booked` = posti occupati (confermati + presenti) */
  slots: { facilityId: string; startsAt: Date; capacity: number; booked: number }[];
  bookings: { createdAt: Date; status: 'confirmed' | 'cancelled' | 'attended' | 'no_show' }[];
  events: { id: string; title: I18nText; hasCheckin: boolean }[];
  attendance: { eventId: string; status: 'going' | 'attended' | 'cancelled'; createdAt: Date }[];
  conversations: { startedAt: Date; handoff: boolean; aiAnswerCount: number }[];
  wrongMarks: { at: Date }[];
}

export function periodStart(period: Period, now: Date, tz: string): Date | null {
  if (period === 'today') return zonedTime(localDayKey(now, tz), '00:00', tz);
  if (period === '7d') return new Date(now.getTime() - 7 * 86_400_000);
  return null; // stagione: tutto
}

const pct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

export function computeKpis(inp: KpiInput, period: Period): Kpis {
  const from = periodStart(period, inp.now, inp.tz);
  const inP = (d: Date) => d <= inp.now && (from === null || d >= from);

  // I1
  const stays = inp.stays.filter((s) => inP(s.startedAt));

  // I2
  const issued = inp.bonuses.filter((b) => b.seasonYear === inp.seasonYear && inP(b.issuedAt)).length;
  const redeemed = inp.redemptions.filter((r) => inP(r.redeemedAt)).length;
  const capUsed = inp.bonuses.filter(
    (b) => b.seasonYear === inp.seasonYear && (b.status === 'issued' || b.status === 'redeemed'),
  ).length;

  // I3
  const bookings = inp.bookings.filter((b) => (b.status === 'confirmed' || b.status === 'attended') && inP(b.createdAt)).length;
  const perFacility = inp.facilities.map((f) => {
    const past = inp.slots.filter((s) => s.facilityId === f.id && s.startsAt < inp.now && (from === null || s.startsAt >= from));
    const bookedSeats = past.reduce((a, s) => a + s.booked, 0);
    const availableSeats = past.reduce((a, s) => a + s.capacity, 0);
    return { facilityId: f.id, name: f.name, bookedSeats, availableSeats, saturationPct: pct(bookedSeats, availableSeats) };
  });

  // I4: adesioni attive (going + attended) create nel periodo
  const rsvpsByEvent = new Map<string, number>();
  const attendedByEvent = new Map<string, number>();
  for (const a of inp.attendance) {
    if (!inP(a.createdAt)) continue;
    if (a.status === 'going' || a.status === 'attended') rsvpsByEvent.set(a.eventId, (rsvpsByEvent.get(a.eventId) ?? 0) + 1);
    if (a.status === 'attended') attendedByEvent.set(a.eventId, (attendedByEvent.get(a.eventId) ?? 0) + 1);
  }
  const events = inp.events
    .filter((e) => rsvpsByEvent.has(e.id))
    .map((e) => ({
      id: e.id,
      title: e.title,
      rsvps: rsvpsByEvent.get(e.id) ?? 0,
      attended: e.hasCheckin ? attendedByEvent.get(e.id) ?? 0 : null,
    }));
  const totalRsvps = [...rsvpsByEvent.values()].reduce((a, b) => a + b, 0);

  // I5
  const convs = inp.conversations.filter((c) => inP(c.startedAt));
  const resolvedByAi = convs.filter((c) => !c.handoff && c.aiAnswerCount > 0).length;
  const handoffs = convs.filter((c) => c.handoff).length;
  const aiAnswers = convs.reduce((a, c) => a + c.aiAnswerCount, 0);
  const wrongMarked = inp.wrongMarks.filter((w) => inP(w.at)).length;

  // I6: solo ospiti ancora collegati (dopo il check-out il legame con la persona non esiste piu')
  const base = stays.filter((s) => s.linked);
  const engaged = base.filter((s) => s.firstActionAt !== null);
  const within = (s: { startedAt: Date; firstActionAt: Date | null }, h: number) =>
    s.firstActionAt !== null && s.firstActionAt.getTime() - s.startedAt.getTime() <= h * 3_600_000;

  const limitations = [
    'admin.dashboard.lim.euro',
    'admin.dashboard.lim.activation',
    'admin.dashboard.lim.checkin',
    'admin.dashboard.lim.i6',
    'admin.dashboard.lim.minutes',
  ];

  return {
    period,
    generatedAt: inp.now.toISOString(),
    i1: { activated: stays.length, activationRate: null },
    i2: {
      issued,
      redeemed,
      redemptionRatePct: pct(redeemed, issued),
      cap: inp.bonusCap,
      capUsagePct: pct(capUsed, inp.bonusCap),
      capUsed,
      costCents: redeemed * inp.bonusValueCents,
    },
    i3: { bookings, perFacility },
    i4: { totalRsvps, events },
    i5: {
      conversations: convs.length,
      resolvedByAi,
      handoffs,
      wrongMarked,
      wrongRatePct: pct(wrongMarked, aiAnswers),
      aiAnswers,
      minutesPerQuestion: inp.minutesPerQuestion,
      hoursSavedEstimate: Math.round(((aiAnswers * inp.minutesPerQuestion) / 60) * 10) / 10,
    },
    i6: {
      engagedPct: pct(engaged.length, base.length),
      engaged24hPct: pct(base.filter((s) => within(s, 24)).length, base.length),
      engaged72hPct: pct(base.filter((s) => within(s, 72)).length, base.length),
    },
    limitations,
  };
}

// ----------------------------------------------------------------------------- da conteggi SQL
// Con Supabase i numeri NON si calcolano leggendo le tabelle (PostgREST taglia a 1000 righe): li calcola il database
// con count(*) (funzione hotel_kpi_counts, migrazione 0004). Qui si assembla solo la risposta, con le stesse definizioni
// di computeKpis (provate dal confronto tra le due strade nei test).

export interface KpiCounts {
  stays_started: number;
  bonuses_issued: number;
  bonuses_redeemed: number;
  cap_used: number;
  bookings: number;
  per_facility: { facility_id: string; name: I18nText; booked_seats: number; available_seats: number }[];
  events: { id: string; title: I18nText; rsvps: number }[];
  conversations: number;
  resolved_by_ai: number;
  handoffs: number;
  ai_answers: number;
  wrong_marked: number;
  i6_base: number;
  i6_engaged: number;
  i6_24h: number;
  i6_72h: number;
}

export function kpisFromCounts(c: KpiCounts, p: { period: Period; now: Date; bonusCap: number; bonusValueCents: number; minutesPerQuestion: number }): Kpis {
  const n = (v: unknown) => Number(v ?? 0);
  const issued = n(c.bonuses_issued);
  const redeemed = n(c.bonuses_redeemed);
  const capUsed = n(c.cap_used);
  const aiAnswers = n(c.ai_answers);
  const wrong = n(c.wrong_marked);
  const events = (c.events ?? []).map((e) => ({ id: e.id, title: e.title, rsvps: n(e.rsvps), attended: null }));
  return {
    period: p.period,
    generatedAt: p.now.toISOString(),
    i1: { activated: n(c.stays_started), activationRate: null },
    i2: {
      issued, redeemed, redemptionRatePct: pct(redeemed, issued), cap: p.bonusCap, capUsagePct: pct(capUsed, p.bonusCap), capUsed,
      costCents: redeemed * p.bonusValueCents,
    },
    i3: {
      bookings: n(c.bookings),
      perFacility: (c.per_facility ?? []).map((f) => ({
        facilityId: f.facility_id, name: f.name, bookedSeats: n(f.booked_seats), availableSeats: n(f.available_seats),
        saturationPct: pct(n(f.booked_seats), n(f.available_seats)),
      })),
    },
    i4: { totalRsvps: events.reduce((a, e) => a + e.rsvps, 0), events },
    i5: {
      conversations: n(c.conversations), resolvedByAi: n(c.resolved_by_ai), handoffs: n(c.handoffs), wrongMarked: wrong,
      wrongRatePct: pct(wrong, aiAnswers), aiAnswers, minutesPerQuestion: p.minutesPerQuestion,
      hoursSavedEstimate: Math.round(((aiAnswers * p.minutesPerQuestion) / 60) * 10) / 10,
    },
    i6: { engagedPct: pct(n(c.i6_engaged), n(c.i6_base)), engaged24hPct: pct(n(c.i6_24h), n(c.i6_base)), engaged72hPct: pct(n(c.i6_72h), n(c.i6_base)) },
    limitations: ['admin.dashboard.lim.euro', 'admin.dashboard.lim.activation', 'admin.dashboard.lim.checkin', 'admin.dashboard.lim.i6', 'admin.dashboard.lim.minutes'],
  };
}
