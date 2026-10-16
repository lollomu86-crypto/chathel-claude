import { getLocale } from '@/lib/server';
import { makeT } from '@/lib/i18n';

/** `export const generateMetadata = titleFor('nav.events')`: titolo di pagina nella lingua dell'app (WCAG 2.4.2). */
export function titleFor(key: string) {
  return async () => ({ title: makeT(await getLocale())(key) });
}
