import { requireGuest } from '@/lib/server';
import { formatDateTime, pick } from '@/lib/format';
import { titleFor } from '@/components/page-meta';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';
export const generateMetadata = titleFor('inbox.title');

export default async function InboxPage() {
  const { api, view, locale, t } = await requireGuest();
  const items = await api.notifications();
  return (
    <>
      <h1>{t('inbox.title')}</h1>
      {items.length === 0 && (
        <div className="card empty"><Icon name="bell" /><p className="empty-title">{t('inbox.emptyTitle')}</p><p>{t('inbox.empty')}</p></div>
      )}
      {items.map((n) => (
        <article key={n.id} className="card stack-sm">
          <p className="muted small">{formatDateTime(n.createdAt, locale, view.hotel.timezone)}</p>
          <h2 className="t-sub">{pick(n.title, locale, 'it')}</h2>
          {n.body && <p>{pick(n.body, locale, 'it')}</p>}
        </article>
      ))}
    </>
  );
}
