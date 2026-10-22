import { redirect } from 'next/navigation';
import { getStaff } from '@/lib/server';
import { AdminGames } from '@/components/AdminGames';

export const dynamic = 'force-dynamic';

export default async function GamesAdmin() {
  const staff = await getStaff();
  if (!staff) redirect('/admin/login');
  return <AdminGames games={await staff.games()} />;
}
