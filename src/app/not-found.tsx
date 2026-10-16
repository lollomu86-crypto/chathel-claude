import Link from 'next/link';
import { getLocale } from '@/lib/server';
import { makeT } from '@/lib/i18n';
import { Icon } from '@/components/ui/Icon';

export default async function NotFound() {
  const t = makeT(await getLocale());
  return (
    <main id="main" className="shell shell-bare">
      <div className="card empty">
        <Icon name="info" />
        <h1 className="empty-title">{t('notFound.title')}</h1>
        <p>{t('notFound.body')}</p>
        <Link className="btn btn-primary" href="/">{t('errorPage.home')}</Link>
      </div>
    </main>
  );
}
