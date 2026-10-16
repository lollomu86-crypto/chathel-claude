import { redirect } from 'next/navigation';
import { getStaff } from '@/lib/server';
import { AdminKb } from '@/components/AdminKb';

export const dynamic = 'force-dynamic';

export default async function AiAdmin() {
  const staff = await getStaff();
  if (!staff) redirect('/admin/login');
  const [kb, topics] = await Promise.all([staff.knowledge(), staff.unansweredTopics()]);
  return <AdminKb entries={kb.map((k) => ({ id: k.id, category: k.category, title: k.title, content: k.content, locale: k.locale, active: k.active }))} topics={topics} canDelete />;
}
