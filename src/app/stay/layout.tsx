import Link from 'next/link';
import { requireGuest, messagesFor } from '@/lib/server';
import { I18nProvider } from '@/components/I18n';
import { HtmlLang } from '@/components/HtmlLang';
import { LangSwitch } from '@/components/LangSwitch';
import { LogoMark } from '@/components/LogoMark';
import { SocialBadgeProvider } from '@/components/SocialBadge';
import { TabBar } from '@/components/TabBar';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';

export default async function StayLayout({ children }: { children: React.ReactNode }) {
  const { view, locale, t } = await requireGuest();
  return (
    <I18nProvider locale={locale} messages={messagesFor(locale)}>
      <SocialBadgeProvider>
        <HtmlLang locale={locale} />
        <header className="app-head">
          <div className="app-head-in">
            <LogoMark />
            <Link href="/stay" className="app-head-title">
              <span className="app-head-name">{view.hotel.name}</span>
              <span className="app-head-sub">{t('head.greeting', { name: view.name })}</span>
            </Link>
            <div className="app-head-actions">
              <Link className="icon-btn" href="/stay/inbox" aria-label={t('nav.inbox')}><Icon name="bell" /></Link>
              <Link className="icon-btn" href="/stay/profile" aria-label={t('nav.profile')}><Icon name="user" /></Link>
              <LangSwitch variant="compact" saveToProfile />
            </div>
          </div>
        </header>
        <main id="main" className="shell">{children}</main>
        <TabBar />
      </SocialBadgeProvider>
    </I18nProvider>
  );
}
