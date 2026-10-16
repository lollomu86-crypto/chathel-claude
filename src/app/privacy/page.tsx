import Link from 'next/link';
import { getLocale } from '@/lib/server';
import { makeT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function Privacy() {
  const t = makeT(await getLocale());
  const sections = ['what', 'ai', 'retention', 'people', 'rights'] as const;
  return (
    <main className="shell shell-bare">
      <h1>{t('privacy.title')}</h1>
      <p className="notice notice-warn">{t('privacy.draft')}</p>
      {sections.map((k) => (
        <section key={k}>
          <h2 className="h3">{t(`privacy.${k}Title`)}</h2>
          <p>{t(`privacy.${k}`)}</p>
        </section>
      ))}
      <p><Link href="/">{t('common.back')}</Link></p>
    </main>
  );
}
