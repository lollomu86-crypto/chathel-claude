import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStore } from '@/lib/store';
import { getGuest, getLocale, messagesFor } from '@/lib/server';
import { makeT } from '@/lib/i18n';
import { I18nProvider } from '@/components/I18n';
import { EntryFlow } from '@/components/EntryFlow';
import { LangSwitch } from '@/components/LangSwitch';
import { LogoMark } from '@/components/LogoMark';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';

export default async function HotelEntry({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ k?: string }> }) {
  const { slug } = await params;
  const { k } = await searchParams;
  const store = await getStore();
  const hotel = await store.publicHotel(slug);

  // chi ha gia' una sessione per questo hotel entra direttamente (US-02 CA3: nessun secondo bonus)
  const g = await getGuest();
  if (g && hotel && (await g.view()).hotel.slug === slug) redirect('/stay');

  const locale = await getLocale(); // cookie, poi lingua del browser (QR-04): la lingua predefinita dell hotel non la scavalca
  const t = makeT(locale);
  const logo = hotel?.logoUrl && /^https:\/\//.test(hotel.logoUrl) ? hotel.logoUrl : null;
  return (
    <I18nProvider locale={locale} messages={messagesFor(locale)}>
      <header className="entry-head">
        <LogoMark size="lg" />
        {hotel ? (
          <>
            {logo && <img className="hotel-logo" src={logo} alt="" width={56} height={56} />}
            <h1>{t('onboarding.title', { hotel: hotel.name })}</h1>
            <p>{t('onboarding.subtitle')}</p>
          </>
        ) : <h1>{t('onboarding.hotelNotFound')}</h1>}
      </header>
      <main id="main" className="shell shell-bare">
        {!hotel ? (
          <div className="notice notice-err" role="alert">
            <Icon name="alert" />
            <span>{t('onboarding.hotelNotFoundHelp')}</span>
          </div>
        ) : (
          <>
            <section aria-labelledby="lang" className="stack-sm">
              <h2 id="lang" className="t-sub">{t('onboarding.chooseLanguage')}</h2>
              <LangSwitch />
            </section>
            <EntryFlow slug={slug} token={k ?? ''} hotelName={hotel.name} />
          </>
        )}
        <p className="small"><Link className="link-tap" href="/privacy">{t('landing.privacy')}</Link></p>
      </main>
    </I18nProvider>
  );
}
