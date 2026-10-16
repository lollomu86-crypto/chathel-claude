import { redirect } from 'next/navigation';
import { getLocale, getStaff } from '@/lib/server';
import { formatDateTime } from '@/lib/format';
import { AdminSocial } from '@/components/AdminSocial';
import type { Period } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SocialAdmin({ searchParams }: { searchParams: Promise<{ closed?: string; period?: string }> }) {
  const sp = await searchParams;
  const staff = await getStaff();
  if (!staff) redirect('/admin/login');
  const locale = await getLocale(staff.info.hotel.defaultLocale);
  const tz = staff.info.hotel.timezone;
  const period: Period = sp.period === 'today' || sp.period === 'season' ? sp.period : '7d';
  const showClosed = sp.closed === '1';
  const soc = staff.social();
  const [stats, reports, feed] = await Promise.all([soc.stats(period), soc.reports(showClosed), soc.publicFeed()]);
  return (
    <AdminSocial
      stats={stats}
      period={period}
      showClosed={showClosed}
      reports={reports.map((r) => ({ ...r, when: formatDateTime(r.createdAt, locale, tz), excerpt: r.excerpt.map((e) => ({ ...e, when: formatDateTime(e.at, locale, tz) })) }))}
      feed={feed.map((m) => ({ ...m, when: formatDateTime(m.createdAt, locale, tz) }))}
    />
  );
}
