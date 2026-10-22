import Link from 'next/link';
import { requireGuest, messagesFor } from '@/lib/server';
import { safeImage } from '@/lib/safe-image';
import { I18nProvider } from '@/components/I18n';
import { FeaturesProvider } from '@/components/Features';
import { HtmlLang } from '@/components/HtmlLang';
import { LangSwitch } from '@/components/LangSwitch';
import { LogoMark } from '@/components/LogoMark';
import { SocialBadgeProvider } from '@/components/SocialBadge';
import { TabBar } from '@/components/TabBar';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';

export default async function StayLayout({ children }: { children: React.ReactNode }) {
  const { view, locale, t } = await requireGuest();
  // il logo dell'hotel, se c'e', prende il posto della tessera ChatHel ("Powered by ChatHel" resta nel profilo)
  const logo = safeImage(view.hotel.logoUrl);
  return (
    <I18nProvider locale={locale} messages={messagesFor(locale)}>
      <FeaturesProvider features={view.hotel.features}>
        <SocialBadgeProvider>
          <HtmlLang locale={locale} />
          <header className="app-head">
            <div className="app-head-in">
              {logo ? <img className="hotel-logo app-head-logo" src={logo} alt="" /> : <LogoMark />}
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
      </FeaturesProvider>
    </I18nProvider>
  );
}
