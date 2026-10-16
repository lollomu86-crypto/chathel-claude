import { getLocale, getStaff, messagesFor } from '@/lib/server';
import { I18nProvider } from '@/components/I18n';

export const dynamic = 'force-dynamic';

export default async function AdminRoot({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();
  const locale = await getLocale(staff?.info.hotel.defaultLocale);
  return <I18nProvider locale={locale} messages={messagesFor(locale)}>{children}</I18nProvider>;
}
