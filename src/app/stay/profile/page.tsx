import { requireGuest } from '@/lib/server';
import { formatDateTime } from '@/lib/format';
import { ProfileClient } from '@/components/ProfileClient';
import { PoweredBy } from '@/components/LogoMark';
import { titleFor } from '@/components/page-meta';

export const dynamic = 'force-dynamic';
export const generateMetadata = titleFor('profile.title');

export default async function ProfilePage() {
  const { view, locale, t } = await requireGuest();
  return (
    <>
      <ProfileClient expires={formatDateTime(view.expiresAt, locale, view.hotel.timezone, { weekday: undefined })} />
      <PoweredBy label={t('common.poweredBy')} />
    </>
  );
}
