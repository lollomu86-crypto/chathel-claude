import { redirect } from 'next/navigation';
import { getLocale, getStaff } from '@/lib/server';
import { formatDateTime, pick } from '@/lib/format';
import { localDayKey } from '@/lib/time';
import { AdminGuests, type GuestRow } from '@/components/AdminGuests';

export const dynamic = 'force-dynamic';

/** Ospiti con soggiorno in corso: nome, lingua, soggiorno, ultimo accesso, prenotazioni, eventi, bonus. Mai chat. */
export default async function GuestsAdmin() {
  const staff = await getStaff();
  if (!staff) redirect('/admin/login');
  const locale = await getLocale(staff.info.hotel.defaultLocale);
  const tz = staff.info.hotel.timezone;
  const guests = await staff.guests();
  const today = localDayKey(new Date(), tz);
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
  const now = Date.now();
  const rows: GuestRow[] = guests.map((g) => ({
    id: g.id, name: g.name, locale: g.locale,
    arrived: day(g.arrivedAt), leaves: day(g.expiresAt), leavesToday: localDayKey(new Date(g.expiresAt), tz) === today,
    lastSeen: g.lastSeenAt, active: !!g.lastSeenAt && now - new Date(g.lastSeenAt).getTime() < 24 * 3_600_000,
    bookings: g.bookings.map((b) => ({ id: b.id, label: pick(b.facility, locale, 'it'), when: formatDateTime(b.startsAt, locale, tz), party: b.party, past: new Date(b.startsAt).getTime() < now })),
    events: g.events.map((e) => ({ id: e.id, label: pick(e.title, locale, 'it'), when: formatDateTime(e.startsAt, locale, tz), past: new Date(e.startsAt).getTime() < now })),
    bonus: g.bonus ? { status: g.bonus.status, when: g.bonus.redeemedAt ? formatDateTime(g.bonus.redeemedAt, locale, tz) : null } : null,
  }));
  return <AdminGuests rows={rows} />;
}
