import { redirect } from 'next/navigation';
import { getLocale, getStaff } from '@/lib/server';
import { makeT } from '@/lib/i18n';
import { LangSwitch } from '@/components/LangSwitch';
import { LogoMark } from '@/components/LogoMark';
import { StaffLogin } from '@/components/StaffLogin';

export const dynamic = 'force-dynamic';

export default async function AdminLogin() {
  const staff = await getStaff();
  if (staff) redirect(staff.info.role === 'bartender' ? '/bar' : '/admin');
  const t = makeT(await getLocale());
  return (
    <>
      <header className="entry-head">
        <LogoMark size="lg" />
        <h1>{t('staff.loginHeading')}</h1>
      </header>
      <main id="main" className="shell shell-bare">
        <StaffLogin next="/admin" />
        <section className="stack-sm" aria-labelledby="lg"><h2 id="lg" className="t-sub">{t('common.language')}</h2><LangSwitch /></section>
      </main>
    </>
  );
}
