// Helper per i server component di Next.js (usano next/headers e next/navigation).
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getStore } from './store';
import { isDemoMode } from './env';
import { detectLocale } from './format';
import { makeT, messages, type TFn } from './i18n';
import { GUEST_COOKIE, LANG_COOKIE, STAFF_COOKIE } from './session-format';
import { isLocale, type GuestView, type Locale } from './types';
import type { GuestApi, StaffApi } from './store/types';

export { isDemoMode };

/** Lingua: cookie ch_lang (scelta esplicita) -> lingua del profilo ospite -> Accept-Language -> en (QR-04). */
export async function getLocale(profileLocale?: Locale): Promise<Locale> {
  const jar = await cookies();
  const c = jar.get(LANG_COOKIE)?.value;
  if (isLocale(c)) return c;
  if (profileLocale) return profileLocale;
  return detectLocale((await headers()).get('accept-language'), 'en');
}

/** Una sola lettura dell'ospite per richiesta (cache di React): layout, pagina e titolo la condividono. */
export const getGuest = cache(async (): Promise<GuestApi | null> => {
  const jar = await cookies();
  return (await getStore()).guest(jar.get(GUEST_COOKIE)?.value);
});
export async function getStaff(): Promise<StaffApi | null> {
  const jar = await cookies();
  return (await getStore()).staff(jar.get(STAFF_COOKIE)?.value);
}

export interface GuestPage {
  api: GuestApi;
  view: GuestView;
  locale: Locale;
  t: TFn;
}
/** Per le pagine ospite: senza sessione valida si torna alla pagina iniziale. */
export async function requireGuest(): Promise<GuestPage> {
  const api = await getGuest();
  if (!api) redirect('/?expired=1');
  const view = await api.view();
  const locale = await getLocale(view.locale);
  return { api, view, locale, t: makeT(locale) };
}

export function messagesFor(locale: Locale) {
  return messages[locale];
}
