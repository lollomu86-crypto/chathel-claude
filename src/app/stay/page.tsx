import Link from 'next/link';
import { requireGuest } from '@/lib/server';
import { formatDate, formatDateTime, pick } from '@/lib/format';
import { dateChip } from '@/components/format-ui';
import { HomeSocial } from '@/components/HomeSocial';
import { InstallHint } from '@/components/InstallHint';
import { Icon } from '@/components/ui/Icon';
import { titleFor } from '@/components/page-meta';
import { safeImage } from '@/lib/safe-image';
import { welcomeFor } from '@/lib/rules/features';

export const dynamic = 'force-dynamic';
export const generateMetadata = titleFor('nav.home');

export default async function Home({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const sp = await searchParams;
  const { api, view, locale, t } = await requireGuest();
  const tz = view.hotel.timezone;
  // un guasto in una sezione non butta giu' tutta la home: ogni parte si carica da sola e mostra il proprio errore
  const [bonusR, eventsR, notifsR] = await Promise.allSettled([api.bonus(), api.events(), api.notifications()]);
  const bonus = bonusR.status === 'fulfilled' ? bonusR.value : null;
  const events = eventsR.status === 'fulfilled' ? eventsR.value : null;
  const notifs = notifsR.status === 'fulfilled' ? notifsR.value : [];
  const label = view.hotel.bonusLabel;
  const f = view.hotel.features;
  const cover = safeImage(view.hotel.coverUrl);
  const welcome = welcomeFor(view.hotel.welcome, locale, view.hotel.defaultLocale);
  const sectionError = (
    <div className="notice notice-err" role="alert">
      <Icon name="alert" />
      <span className="grow">{t('common.sectionError')}</span>
      <Link className="btn btn-secondary btn-small" href="/stay">{t('common.retry')}</Link>
    </div>
  );
  return (
    <>
      {cover && <img className="cover" src={cover} alt="" />}
      <h1>{t('home.welcome', { name: view.name })}</h1>
      {sp.welcome === '1' && <p className="notice notice-ok" role="status"><Icon name="check" />{t('home.welcomeNew', { hotel: view.hotel.name })}</p>}
      {welcome && (
        <section className="card stack-sm" aria-labelledby="hw">
          <h2 id="hw" className="t-sub">{t('home.hotelWelcome', { hotel: view.hotel.name })}</h2>
          <p className="welcome-note">{welcome}</p>
        </section>
      )}

      {!bonus && sectionError}
      {bonus?.state === 'issued' && (
        <section className="ticket ticket-accent" aria-labelledby="bonus-h">
          <div className="ticket-head">
            <span className="badge badge-bonus">{t('home.bonusBadge')}</span>
            <span className="ticket-meta">{t('home.validUntil', { date: formatDate(bonus.expiresAt!, locale, tz) })}</span>
          </div>
          <h2 id="bonus-h" className="ticket-title">{label}</h2>
          <div className="ticket-foot">
            <Link className="btn btn-cta btn-lg btn-block" href="/stay/bonus">{t('home.useBonus')}</Link>
            <p className="hint">{t('bonus.oneOnly')}</p>
          </div>
        </section>
      )}
      {bonus?.state === 'redeemed' && (
        <section className="card card-muted stack" aria-labelledby="bonus-h">
          <span className="badge badge-ok"><Icon name="check" />{t('bonus.usedBadge')}</span>
          <h2 id="bonus-h" className="t-sub">{label}</h2>
          <p>{t('home.bonusRedeemed', { date: formatDateTime(bonus.redeemedAt!, locale, tz) })}</p>
          <div className="btn-group">
            <Link className="btn btn-secondary" href="/stay/events">{t('bonus.nextEvents')}</Link>
            {f.bookings && <Link className="btn btn-secondary" href="/stay/book">{t('bonus.nextBook')}</Link>}
          </div>
        </section>
      )}
      {/* bonus spento dal direttore: chi l'ha gia' ricevuto lo vede ancora, agli altri non si dice nulla */}
      {bonus && (view.hotel.bonusEnabled || bonus.state !== 'none') && (['expired', 'void', 'cap_reached', 'none'] as const).includes(bonus.state as never) && (
        <section className="card card-muted stack">
          <p>{t(bonus.state === 'expired' ? 'home.bonusExpired' : bonus.state === 'void' ? 'home.bonusVoid' : bonus.state === 'cap_reached' ? 'home.bonusCap' : 'home.bonusNone')}</p>
          {bonus.state === 'cap_reached' && <Link className="btn btn-secondary btn-small" href="/stay/events">{t('bonus.nextEvents')}</Link>}
        </section>
      )}

      {f.social && <HomeSocial />}

      <h2 className="t-sub section">{t('home.shortcuts')}</h2>
      <div className="shortcuts">
        <Link className="shortcut" href="/stay/events"><Icon name="calendar" />{t('nav.events')}</Link>
        {(f.bookings || f.challenges) && <Link className="shortcut" href="/stay/book"><Icon name="clock" />{t('nav.book')}</Link>}
        {f.reception && <Link className="shortcut" href="/stay/reception"><Icon name="chat" />{t('nav.reception')}</Link>}
      </div>

      {notifs.length > 0 && (
        <section aria-labelledby="ann" className="stack section">
          <h2 id="ann" className="t-sub">{t('home.announcements')}</h2>
          {notifs.slice(0, 2).map((n) => (
            <div key={n.id} className="notice notice-info">
              <Icon name="bell" />
              <span><strong>{pick(n.title, locale)}</strong>{n.body && <span className="block">{pick(n.body, locale)}</span>}</span>
            </div>
          ))}
        </section>
      )}

      <section aria-labelledby="up" className="stack section">
        <h2 id="up" className="t-sub">{t('home.upcoming')}</h2>
        {!events && sectionError}
        {events && events.length === 0 && <p className="muted">{t('home.noEvents')}</p>}
        {events?.slice(0, 3).map((e) => {
          const d = dateChip(e.startsAt, locale, tz);
          return (
            <Link key={e.id} href="/stay/events" className="card card-link">
              <span className="row row-nowrap">
                <span className="date-chip" aria-hidden="true"><small>{d.weekday}</small><strong>{d.day}</strong></span>
                <span className="grow">
                  <strong>{pick(e.title, locale)}</strong>
                  <span className="event-meta block">{formatDateTime(e.startsAt, locale, tz)}{e.location ? ` · ${e.location}` : ''}</span>
                </span>
              </span>
            </Link>
          );
        })}
      </section>

      <InstallHint />
    </>
  );
}
