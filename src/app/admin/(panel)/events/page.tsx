import { redirect } from 'next/navigation';
import { getLocale, getStaff } from '@/lib/server';
import { formatDateTime } from '@/lib/format';
import { AdminEvents } from '@/components/AdminEvents';

export const dynamic = 'force-dynamic';

export default async function EventsAdmin() {
  const staff = await getStaff();
  if (!staff) redirect('/admin/login');
  const locale = await getLocale(staff.info.hotel.defaultLocale);
  const tz = staff.info.hotel.timezone;
  const events = await staff.events();
  return <AdminEvents tz={tz} events={events.map((e) => ({ ...e, whenLabel: formatDateTime(e.startsAt, locale, tz) }))} />;
}
