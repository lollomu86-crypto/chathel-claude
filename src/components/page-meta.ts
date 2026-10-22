import { getGuest, getLocale } from '@/lib/server';
import { makeT } from '@/lib/i18n';

/** `export const generateMetadata = titleFor('nav.events')`: titolo di pagina nella lingua mostrata (WCAG 2.4.2).
 *  Stessa regola di requireGuest: cookie ch_lang, poi lingua del profilo dell'ospite, poi browser. */
export function titleFor(key: string) {
  return async () => {
    const guest = await getGuest();
    const locale = await getLocale(guest ? (await guest.view()).locale : undefined);
    return { title: makeT(locale)(key) };
  };
}
