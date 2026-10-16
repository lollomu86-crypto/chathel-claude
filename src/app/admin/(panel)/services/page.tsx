import { redirect } from 'next/navigation';
import { getLocale, getStaff } from '@/lib/server';
import { formatTime, pick } from '@/lib/format';
import { addDaysKey, localDayKey, zonedTime } from '@/lib/time';
import { AdminServices } from '@/components/AdminServices';

export const dynamic = 'force-dynamic';

export default async function ServicesAdmin() {
  const staff = await getStaff();
  if (!staff) redirect('/admin/login');
  const locale = await getLocale(staff.info.hotel.defaultLocale);
  const tz = staff.info.hotel.timezone;
  const facilities = await staff.facilities();
  const today = localDayKey(new Date(), tz);
  return (
    <AdminServices
      today={today}
      defaultTo={addDaysKey(today, 7)}
      services={facilities.map((f) => ({
        id: f.id, name: pick(f.name, locale, 'it'), defaultCapacity: f.defaultCapacity,
        slots: f.slots.map((s) => ({
          id: s.id, time: formatTime(s.startsAt, locale, tz), day: localDayKey(new Date(s.startsAt), tz),
          dayLabel: new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(zonedTime(localDayKey(new Date(s.startsAt), tz), '12:00', tz)),
          capacity: s.capacity, booked: s.booked, status: s.status,
        })),
      }))}
    />
  );
}
