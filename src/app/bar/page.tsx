import Link from 'next/link';
import { getLocale, getStaff, messagesFor } from '@/lib/server';
import { makeT } from '@/lib/i18n';
import { I18nProvider } from '@/components/I18n';
import { BarClient } from '@/components/BarClient';
import { StaffLogin } from '@/components/StaffLogin';
import { LogoMark } from '@/components/LogoMark';
import { LogoutButton } from '@/components/LogoutButton';

export const dynamic = 'force-dynamic';

export default async function BarPage() {
  const staff = await getStaff();
  const locale = await getLocale(staff?.info.hotel.defaultLocale);
  const t = makeT(locale);
  return (
    <I18nProvider locale={locale} messages={messagesFor(locale)}>
      {staff && staff.info.role !== 'reception' && (
<header className="app-head"><div className="app-head-in"><LogoMark /><p className="app-head-title"><span className="app-head-name">{staff.info.hotel.name}</span></p><LogoutButton to="/bar" /></div></header>
      )}
      <main id="main" className="shell shell-bare">
        {!staff ? (
          <StaffLogin next="/bar" />
        ) : staff.info.role === 'reception' ? (
          <>
            <p className="notice notice-err" role="alert">{t('errors.forbidden')}</p>
            <Link href="/admin">{t('admin.nav.dashboard')}</Link>
          </>
        ) : (
          <>
            <BarClient staffName={staff.info.displayName} hotelId={staff.info.hotel.id} />
          </>
        )}
      </main>
    </I18nProvider>
  );
}
