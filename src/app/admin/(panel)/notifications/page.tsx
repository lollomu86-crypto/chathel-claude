import { redirect } from 'next/navigation';
import { getLocale, getStaff } from '@/lib/server';
import { formatDateTime, pick } from '@/lib/format';
import { AdminNotify } from '@/components/AdminNotify';

export const dynamic = 'force-dynamic';

export default async function NotificationsAdmin() {
  const staff = await getStaff();
  if (!staff) redirect('/admin/login');
  const locale = await getLocale(staff.info.hotel.defaultLocale);
  const tz = staff.info.hotel.timezone;
  const [list, left] = await Promise.all([staff.notifications(), staff.notificationsLeftToday()]);
  return <AdminNotify left={left} history={list.map((n) => ({ id: n.id, when: formatDateTime(n.createdAt, locale, tz), title: pick(n.title, locale, 'it'), body: pick(n.body, locale, 'it') }))} />;
}
