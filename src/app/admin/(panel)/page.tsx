import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getStaff } from '@/lib/server';
import { makeT } from '@/lib/i18n';
import { formatTime, pick } from '@/lib/format';
import { addDaysKey, localDayKey } from '@/lib/time';
import { dateChip } from '@/components/format-ui';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';

/**
 * Pagina iniziale del pannello: cosa serve adesso a direttore e reception. Emergenze e richieste in cima, poi le
 * prenotazioni e gli eventi di oggi, qualche numero del giorno e le azioni rapide. Le statistiche stanno in /admin/stats.
 */
export default async function Today() {
  const staff = await getStaff();
  if (!staff) redirect('/admin/login');
  const locale = await getLocale(staff.info.hotel.defaultLocale);
  const t = makeT(locale);
  const tz = staff.info.hotel.timezone;
  const admin = staff.info.role === 'hotel_admin';
  const today = localDayKey(new Date(), tz);
  const tomorrow = addDaysKey(today, 1);

  const [urgent, queue, reports, facilities, events, kpis] = await Promise.all([
    staff.urgentAlerts().catch(() => []),
    staff.handoffQueue(false).catch(() => []),
    staff.social().reports(false).catch(() => []),
    staff.facilities().catch(() => []),
    staff.events().catch(() => []),
    admin ? staff.kpis('today').catch(() => null) : Promise.resolve(null),
  ]);
  const pending = queue.filter((c) => c.status === 'handoff_pending').length;
  const bookings = facilities
    .flatMap((f) => f.slots.filter((s) => s.booked > 0 && localDayKey(new Date(s.startsAt), tz) === today).map((s) => ({ f, s })))
    .sort((a, b) => a.s.startsAt.localeCompare(b.s.startsAt));
  const soon = events
    .filter((e) => e.published && [today, tomorrow].includes(localDayKey(new Date(e.startsAt), tz)))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const dateLabel = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <>
      <div className="today-head">
        <h1>{t('admin.today.title')}</h1>
        <p className="muted">{dateLabel}</p>
      </div>

      {urgent.length > 0 && (
        <section className="stack-sm" aria-labelledby="t-urg">
          <h2 id="t-urg" className="t-sub">{t('admin.today.urgent')}</h2>
          {urgent.map((u) => (
            <Link key={u.conversationId} href="/admin/inbox" className="card card-link card-urgent today-row">
              <Icon name="alert" />
              <span className="grow"><strong>{u.topic}</strong><span className="muted small block">{formatTime(u.at, locale, tz)}</span></span>
              <span className="btn btn-primary btn-small">{t('admin.today.open')}</span>
            </Link>
          ))}
        </section>
      )}

      <div className="today-tiles">
        <Link href="/admin/inbox" className={`card card-link today-tile${pending > 0 ? ' today-tile-on' : ''}`}>
          <Icon name="chat" />
          <span className="num">{pending}</span>
          <span className="stat-label">{t('admin.today.toHandle')}</span>
        </Link>
        <Link href="/admin/social" className={`card card-link today-tile${reports.length > 0 ? ' today-tile-on' : ''}`}>
          <Icon name="flag" />
          <span className="num">{reports.length}</span>
          <span className="stat-label">{t('admin.today.reports')}</span>
        </Link>
        <Link href="/admin/services" className="card card-link today-tile">
          <Icon name="clock" />
          <span className="num">{bookings.reduce((n, b) => n + b.s.booked, 0)}</span>
          <span className="stat-label">{t('admin.today.bookedSeats')}</span>
        </Link>
        {kpis && (
          <Link href="/admin/stats" className="card card-link today-tile">
            <Icon name="users" />
            <span className="num">{kpis.i1.activated}</span>
            <span className="stat-label">{t('admin.today.activated')}</span>
          </Link>
        )}
      </div>

      <section className="stack-sm" aria-labelledby="t-bk">
        <div className="row-between"><h2 id="t-bk" className="t-sub">{t('admin.today.bookings')}</h2><Link className="link-tap" href="/admin/services">{t('admin.today.seeAll')}</Link></div>
        {bookings.length === 0
          ? <p className="card muted">{t('admin.today.bookingsNone')}</p>
          : (
            <ul className="card today-list">
              {bookings.map(({ f, s }) => (
                <li key={s.id} className="today-item">
                  <span className="today-time">{formatTime(s.startsAt, locale, tz)}</span>
                  <span className="grow">{pick(f.name, locale, 'it')}</span>
                  <span className={`badge ${s.booked >= s.capacity ? 'badge-warn' : 'badge-info'}`}>{t('admin.today.seats', { booked: s.booked, capacity: s.capacity })}</span>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className="stack-sm" aria-labelledby="t-ev">
        <div className="row-between"><h2 id="t-ev" className="t-sub">{t('admin.today.events')}</h2><Link className="link-tap" href="/admin/events">{t('admin.today.seeAll')}</Link></div>
        {soon.length === 0 && <p className="card muted">{t('admin.today.eventsNone')}</p>}
        {soon.map((e) => {
          const chip = dateChip(e.startsAt, locale, tz);
          return (
            <article key={e.id} className="card row row-nowrap">
              <span className="date-chip" aria-hidden="true"><small>{chip.weekday}</small><strong>{chip.day}</strong></span>
              <div className="grow">
                <h3 className="t-sub">{pick(e.title, locale, 'it')}</h3>
                <div className="event-meta">{formatTime(e.startsAt, locale, tz)}{e.location ? ` · ${e.location}` : ''}</div>
              </div>
              <span className="badge badge-info">{e.capacity ? t('admin.today.rsvpsOf', { n: e.rsvps, capacity: e.capacity }) : t('admin.today.rsvps', { n: e.rsvps })}</span>
            </article>
          );
        })}
      </section>

      <section className="stack-sm" aria-labelledby="t-q">
        <h2 id="t-q" className="t-sub">{t('admin.today.quick')}</h2>
        <div className="btn-group">
          <Link className="btn btn-primary" href="/admin/notifications"><Icon name="bell" />{t('admin.today.sendNotice')}</Link>
          <Link className="btn btn-secondary" href="/admin/events"><Icon name="calendar" />{t('admin.today.newEvent')}</Link>
        </div>
      </section>
    </>
  );
}
