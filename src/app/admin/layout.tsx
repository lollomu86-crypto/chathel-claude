import type { Metadata } from 'next';
import { getLocale, getStaff, messagesFor } from '@/lib/server';
import { I18nProvider } from '@/components/I18n';

export const dynamic = 'force-dynamic';

// Installato dal computer, il pannello si apre sul pannello (non sulla pagina degli ospiti).
export const metadata: Metadata = {
  manifest: '/admin.webmanifest',
  applicationName: 'ChatHel Pannello',
  appleWebApp: { capable: true, title: 'ChatHel Pannello', statusBarStyle: 'default' },
};

export default async function AdminRoot({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();
  const locale = await getLocale(staff?.info.hotel.defaultLocale);
  return <I18nProvider locale={locale} messages={messagesFor(locale)}>{children}</I18nProvider>;
}
