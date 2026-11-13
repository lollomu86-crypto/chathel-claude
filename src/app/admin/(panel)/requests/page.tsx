import { redirect } from 'next/navigation';
import { getLocale, getStaff } from '@/lib/server';
import { makeT } from '@/lib/i18n';
import { StaffRequests } from '@/components/StaffRequests';
import { FeatureOff } from '@/components/FeatureOff';

export const dynamic = 'force-dynamic';

export default async function RequestsAdmin() {
  const staff = await getStaff();
  if (!staff) redirect('/admin/login');
  const t = makeT(await getLocale(staff.info.hotel.defaultLocale));
  const list = await staff.requests(false);
  return (
    <>
      <h1>{t('admin.requests.title')}</h1>
      <p className="muted">{t('admin.requests.intro')}</p>
      {!staff.info.hotel.features.requests && list.length === 0
        ? <FeatureOff title={t('admin.requests.offTitle')} t={t} />
        : <StaffRequests initial={list} mode="full" timezone={staff.info.hotel.timezone} />}
    </>
  );
}
