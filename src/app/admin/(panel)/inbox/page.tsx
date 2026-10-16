import { redirect } from 'next/navigation';
import { getLocale, getStaff } from '@/lib/server';
import { makeT } from '@/lib/i18n';
import { formatDateTime } from '@/lib/format';
import { AdminInbox } from '@/components/AdminInbox';

export const dynamic = 'force-dynamic';

export default async function InboxAdmin({ searchParams }: { searchParams: Promise<{ closed?: string }> }) {
  const sp = await searchParams;
  const staff = await getStaff();
  if (!staff) redirect('/admin/login');
  const locale = await getLocale(staff.info.hotel.defaultLocale);
  const t = makeT(locale);
  const tz = staff.info.hotel.timezone;
  const showClosed = sp.closed === '1';
  const queue = await staff.handoffQueue(showClosed);
  return (
    <AdminInbox
      showClosed={showClosed}
      convs={queue.map((c) => ({
        id: c.id, priority: c.priority, status: c.status as 'handoff_pending' | 'operator' | 'closed', when: formatDateTime(c.handoffAt ?? c.startedAt, locale, tz), locale: c.locale,
        reason: c.handoffReason ? t(`admin.inbox.reasons.${c.handoffReason}`) : '', topic: c.handoffTopic ?? '',
        messages: c.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, when: formatDateTime(m.createdAt, locale, tz), wrong: !!m.markedWrong })),
      }))}
    />
  );
}
