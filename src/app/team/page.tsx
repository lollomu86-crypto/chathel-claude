import Link from 'next/link';
import { getLocale, getStaff, messagesFor } from '@/lib/server';
import { makeT } from '@/lib/i18n';
import { I18nProvider } from '@/components/I18n';
import { StaffLogin } from '@/components/StaffLogin';
import { StaffRequests } from '@/components/StaffRequests';
import { LogoMark } from '@/components/LogoMark';
import { LogoutButton } from '@/components/LogoutButton';

export const dynamic = 'force-dynamic';

/** Schermata del personale di reparto (ruolo team, 0012): le richieste del proprio reparto, dal telefono. */
export default async function TeamPage() {
  const staff = await getStaff();
  const locale = await getLocale(staff?.info.hotel.defaultLocale);
  const t = makeT(locale);
  const team = staff?.info.role === 'team';
  const list = team ? await staff!.requests(false) : [];
  return (
    <I18nProvider locale={locale} messages={messagesFor(locale)}>
      {staff && (
        <header className="app-head"><div className="app-head-in">
          <LogoMark />
          <p className="app-head-title">
            <span className="app-head-name">{staff.info.hotel.name}</span>
            <span className="app-head-sub">{staff.info.displayName}{staff.info.department ? ` · ${t(`admin.requests.departments.${staff.info.department}`)}` : ''}</span>
          </p>
          <LogoutButton to="/team" />
        </div></header>
      )}
      <main id="main" className="shell shell-bare">
        {!staff ? (
          <StaffLogin next="/team" />
        ) : !team ? (
          <>
            <p className="notice notice-err" role="alert">{t('errors.forbidden')}</p>
            <Link href={staff.info.role === 'bartender' ? '/bar' : '/admin/requests'}>{t('team.goBack')}</Link>
          </>
        ) : (
          <>
            <h1>{t('team.title')}</h1>
            <StaffRequests initial={list} mode="team" timezone={staff.info.hotel.timezone} />
          </>
        )}
      </main>
    </I18nProvider>
  );
}
