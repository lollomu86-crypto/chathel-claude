import type { Metadata, Viewport } from 'next';
import { Inter, Montserrat } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { getLocale, isDemoMode, messagesFor } from '@/lib/server';
import { makeT } from '@/lib/i18n';
import { I18nProvider } from '@/components/I18n';
import { SwRegister } from '@/components/SwRegister';

/* Font self-hosted da next/font a build time: nessuna richiesta a Google dal browser dell'ospite (GDPR).
   Entrambi hanno il cirillico (il russo e' una lingua dell'app). Fallback reali: font di sistema con metriche corrette. */
const inter = Inter({
  subsets: ['latin', 'latin-ext', 'cyrillic'], variable: '--font-inter', display: 'swap', adjustFontFallback: true,
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
});
const montserrat = Montserrat({
  subsets: ['latin', 'latin-ext', 'cyrillic'], variable: '--font-montserrat', display: 'swap', adjustFontFallback: true,
  fallback: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
});

// titolo e descrizione nella lingua dell'ospite; ogni pagina aggiunge il proprio titolo (template "%s · ChatHel")
export async function generateMetadata(): Promise<Metadata> {
  const t = makeT(await getLocale());
  return {
    title: { default: 'ChatHel', template: '%s · ChatHel' },
    description: t('meta.description'),
    manifest: '/manifest.webmanifest',
    applicationName: 'ChatHel',
    appleWebApp: { capable: true, title: 'ChatHel', statusBarStyle: 'default' },
    icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
    robots: { index: false, follow: false },
  };
}
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // la testata dell'app e' blu pieno nei due temi: la barra di stato la segue
  themeColor: '#0030B0',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = makeT(locale);
  // tema scelto dal Profilo (cookie ch_theme): forzato gia' dal server, senza lampo al caricamento; assente = segue il dispositivo
  const theme = (await cookies()).get('ch_theme')?.value;
  return (
    <html lang={locale} className={`${inter.variable} ${montserrat.variable}`} data-theme={theme === 'light' || theme === 'dark' ? theme : undefined}>
      <body>
        <I18nProvider locale={locale} messages={messagesFor(locale)}>
          <a className="skip-link" href="#main">{t('common.skipToContent')}</a>
          {isDemoMode() && <div className="demo-banner" role="status">{t('common.demoBanner')}</div>}
          {children}
          <SwRegister />
        </I18nProvider>
      </body>
    </html>
  );
}
