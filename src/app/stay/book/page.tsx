import { requireGuest } from '@/lib/server';
import { formatDateTime, formatTime, pick } from '@/lib/format';
import { addDaysKey, localDayKey, zonedTime } from '@/lib/time';
import { BookClient, type BookDay } from '@/components/BookClient';
import { titleFor } from '@/components/page-meta';

export const dynamic = 'force-dynamic';
export const generateMetadata = titleFor('book.title');

export default async function BookPage() {
  const { api, view, locale, t } = await requireGuest();
  const tz = view.hotel.timezone;
  const [facilities, bookings] = await Promise.all([api.facilities(), api.myBookings()]);
  const today = localDayKey(new Date(), tz);
  const days: BookDay[] = Array.from({ length: 7 }, (_, i) => {
    const key = addDaysKey(today, i);
    const label = i === 0 ? t('common.today') : i === 1 ? t('common.tomorrow')
      : new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short', day: 'numeric' }).format(zonedTime(key, '12:00', tz));
    return { key, label };
  });
  return (
    <BookClient
      days={days}
      cutoff={view.hotel.cancelCutoffMinutes}
      facilities={facilities.map((f) => ({
        id: f.id,
        name: pick(f.name, locale, 'it'),
        description: pick(f.description, locale, 'it'),
        slots: f.slots.map((s) => ({ id: s.id, day: localDayKey(new Date(s.startsAt), tz), time: formatTime(s.startsAt, locale, tz), remaining: s.capacity - s.booked, capacity: s.capacity })),
      }))}
      bookings={bookings.map((b) => ({
        id: b.id,
        facility: pick(b.facilityName, locale, 'it'),
        when: formatDateTime(b.startsAt, locale, tz),
        party: b.partySize,
        canCancel: b.canCancel,
      }))}
    />
  );
}
