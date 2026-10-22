import { redirect } from 'next/navigation';
import { getLocale, getStaff } from '@/lib/server';
import { makeT } from '@/lib/i18n';
import { formatMoney } from '@/lib/format';
import { AdminSettings } from '@/components/AdminSettings';
import { AdminCustomization } from '@/components/AdminCustomization';

export const dynamic = 'force-dynamic';

export default async function SettingsAdmin() {
  const staff = await getStaff();
  if (!staff) redirect('/admin/login');
  if (staff.info.role !== 'hotel_admin') redirect('/admin/events');
  const locale = await getLocale(staff.info.hotel.defaultLocale);
  const t = makeT(locale);
  const h = staff.info.hotel;
  const token = await staff.currentQrToken();
  const code = await staff.currentAccessCode();
  return (
    <>
      <h1>{t('admin.settings.title')}</h1>
      <AdminCustomization logoUrl={h.logoUrl} coverUrl={h.coverUrl} welcome={h.welcome} features={h.features} bonusEnabled={h.bonusEnabled} />
      <section className="card" aria-labelledby="bn">
        <h2 id="bn" className="h3">{t('admin.settings.bonusTitle')}</h2>
        <p className="muted">{t('admin.settings.bonusNote')}</p>
        <div className="kpi"><dl>
          <dt>{t('admin.settings.bonusState')}</dt><dd>{h.bonusEnabled ? t('admin.settings.bonusOn') : t('admin.settings.bonusOff')}</dd>
          <dt>{t('admin.settings.label')}</dt><dd>{h.bonusLabel}</dd>
          <dt>{t('admin.settings.value')}</dt><dd>{formatMoney(h.bonusValueCents, locale)}</dd>
          <dt>{t('admin.settings.cap')}</dt><dd>{h.bonusSeasonCap}</dd>
          <dt>{t('admin.settings.funding')}</dt><dd>{h.bonusFunding === 'hotel' ? t('admin.settings.fundingHotel') : t('admin.settings.fundingGrant')}</dd>
        </dl></div>
      </section>
      <AdminSettings slug={h.slug} initialToken={token} initialCode={code} />
      <section className="card card-muted"><h2 className="h3">{t('admin.settings.staffTitle')}</h2><p>{t('admin.settings.staffHelp')}</p></section>
    </>
  );
}
