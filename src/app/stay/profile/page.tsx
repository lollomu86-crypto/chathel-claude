import { requireGuest } from '@/lib/server';
import { formatDateTime } from '@/lib/format';
import { ProfileClient } from '@/components/ProfileClient';
import { titleFor } from '@/components/page-meta';

export const dynamic = 'force-dynamic';
export const generateMetadata = titleFor('profile.title');

export default async function ProfilePage() {
  const { view, locale } = await requireGuest();
  return <ProfileClient expires={formatDateTime(view.expiresAt, locale, view.hotel.timezone, { weekday: undefined })} />;
}
