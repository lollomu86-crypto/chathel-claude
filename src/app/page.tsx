import Link from 'next/link';
import { getStore } from '@/lib/store';
import { getGuest, getLocale, messagesFor } from '@/lib/server';
import { makeT } from '@/lib/i18n';
import { I18nProvider } from '@/components/I18n';
import { LangSwitch } from '@/components/LangSwitch';
import { LogoMark } from '@/components/LogoMark';
import { Icon } from '@/components/ui/Icon';
import type { DemoStore } from '@/lib/store/demo';

export const dynamic = 'force-dynamic';

export default async function Landing({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const sp = await searchParams;
  const locale = await getLocale();
  const t = makeT(locale);
  const store = await getStore();
  const demoLink = store.mode === 'demo' ? (store as unknown as DemoStore).qrLink() : null;
  const hasSession = (await getGuest()) !== null;
  return (
    <I18nProvider locale={locale} messages={messagesFor(locale)}>
      <header className="entry-head">
        <LogoMark size="xl" />
        <h1>{t('landing.tagline')}</h1>
        <p>{t('landing.subtitle')}</p>
      </header>
      <main id="main" className="shell shell-bare">
        {sp.expired && (
          <div className="notice notice-warn" role="alert">
            <Icon name="alert" />
            <span><strong>{t('errors.unauthorized')}</strong> {t('landing.expiredHelp')}</span>
          </div>
        )}
        {hasSession && <Link className="btn btn-primary btn-lg btn-block" href="/stay">{t('landing.resume')}</Link>}
        <section aria-labelledby="lg" className="stack-sm">
          <h2 id="lg" className="t-sub">{t('common.language')}</h2>
          <LangSwitch />
        </section>
        {demoLink && (
          <section className="card card-muted stack" aria-labelledby="demo">
            <h2 id="demo" className="t-sub">{t('landing.demoTitle')}</h2>
            <Link className="btn btn-primary" href={demoLink}>{t('landing.demoGuest')}</Link>
            <Link className="btn btn-secondary" href="/admin">{t('landing.demoAdmin')}</Link>
            <Link className="btn btn-secondary" href="/bar">{t('landing.demoBar')}</Link>
            <p className="muted small">{t('landing.demoNote')}</p>
          </section>
        )}
        <p className="small"><Link className="link-tap" href="/privacy">{t('landing.privacy')}</Link></p>
      </main>
    </I18nProvider>
  );
}
