import { requireGuest } from '@/lib/server';
import { formatDateTime, pick } from '@/lib/format';
import { localDayKey } from '@/lib/time';
import { dateChip } from '@/components/format-ui';
import { EventCard } from '@/components/EventCard';
import { titleFor } from '@/components/page-meta';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';
export const generateMetadata = titleFor('events.title');

export default async function EventsPage() {
  const { api, view, locale, t } = await requireGuest();
  const tz = view.hotel.timezone;
  const events = await api.events();
  const today = localDayKey(new Date(), tz);
  return (
    <>
      <h1>{t('events.title')}</h1>
      {events.length === 0 && (
        <div className="card empty">
          <Icon name="calendar" />
          <p className="empty-title">{t('events.emptyTitle')}</p>
          <p>{t('events.empty')}</p>
        </div>
      )}
      {events.map((e) => (
        <EventCard
          key={e.id}
          id={e.id}
          title={pick(e.title, locale, 'it')}
          description={pick(e.description, locale, 'it')}
          location={e.location ?? ''}
          when={formatDateTime(e.startsAt, locale, tz)}
          chip={dateChip(e.startsAt, locale, tz)}
          going={e.going}
          goingCount={e.goingCount}
          capacity={e.capacity ?? null}
          today={localDayKey(new Date(e.startsAt), tz) === today}
          imageUrl={e.imageUrl ?? null}
        />
      ))}
    </>
  );
}
