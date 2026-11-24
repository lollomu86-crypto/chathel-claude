import Link from 'next/link';
import { requireGuest } from '@/lib/server';
import { formatDate, formatDateTime, formatTime, pick } from '@/lib/format';
import { dateChip } from '@/components/format-ui';
import { HomeSocial } from '@/components/HomeSocial';
import { InstallHint } from '@/components/InstallHint';
import { Icon } from '@/components/ui/Icon';
import { titleFor } from '@/components/page-meta';
import { safeImage } from '@/lib/safe-image';
import { welcomeFor } from '@/lib/rules/features';
import { greetingGender, greetingKey } from '@/lib/rules/greeting';
import type { FacilityView } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const generateMetadata = titleFor('nav.home');

export default async function Home({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const sp = await searchParams;
  const { api, view, locale, t } = await requireGuest();
  const tz = view.hotel.timezone;
  const f = view.hotel.features;
  // un guasto in una sezione non butta giu' tutta la home: ogni parte si carica da sola e mostra il proprio errore
  const [bonusR, eventsR, notifsR, facR] = await Promise.allSettled([
    api.bonus(), api.events(), api.notifications(), f.bookings ? api.facilities() : Promise.resolve([] as FacilityView[]),
  ]);
  const bonus = bonusR.status === 'fulfilled' ? bonusR.value : null;
  const events = eventsR.status === 'fulfilled' ? eventsR.value : null;
  const notifs = notifsR.status === 'fulfilled' ? notifsR.value : [];
  const facilities = facR.status === 'fulfilled' ? facR.value : [];
  const label = view.hotel.bonusLabel;
  const cover = safeImage(view.hotel.coverUrl);
  const welcome = welcomeFor(view.hotel.welcome, locale, view.hotel.defaultLocale);
  // "Benvenuta" / "Benvenuto" dal nome di battesimo; nome ambiguo o sconosciuto: forma neutra (vedi rules/greeting.ts)
  const gender = greetingGender(view.name, locale);
  const greeting = t(greetingKey('home.welcome', gender), { name: view.name });
  const stay = t('home.stayUntil', { date: formatDate(view.expiresAt, locale, tz) });
  // il primo evento in grande, gli altri nella fila che scorre di lato
  const [featured, ...nextEvents] = events ?? [];
  // solo le funzioni accese dall'hotel; al massimo 5, stanno in una riga anche sui telefoni piccoli
  const quick = [
    { href: '/stay/events', icon: 'calendar' as const, label: t('nav.events'), on: true },
    { href: '/stay/book', icon: 'clock' as const, label: t('nav.book'), on: f.bookings || f.challenges },
    { href: '/stay/requests', icon: 'ticket' as const, label: t('requests.short'), on: f.requests },
    { href: '/stay/reception', icon: 'chat' as const, label: t('nav.reception'), on: f.reception },
    { href: '/stay/social', icon: 'users' as const, label: t('nav.social'), on: f.social },
  ].filter((x) => x.on);
  const sectionError = (
    <div className="notice notice-err" role="alert">
      <Icon name="alert" />
      <span className="grow">{t('common.sectionError')}</span>
      <Link className="btn btn-secondary btn-small" href="/stay">{t('common.retry')}</Link>
    </div>
  );
  return (
    <>
      {/* saluto: sulla copertina dell'hotel se c'e', altrimenti titolo grande semplice (come le app di viaggio) */}
      {cover ? (
        <section className="photo-hero rise" aria-labelledby="home-h">
          <img className="photo-hero-img" src={cover} alt="" />
          <div className="photo-hero-text">
            <h1 id="home-h">{greeting}</h1>
            <p className="home-sub">{stay}</p>
          </div>
        </section>
      ) : (
        <section className="home-greet rise" aria-labelledby="home-h">
          <h1 id="home-h">{greeting}</h1>
          <p className="home-sub">{stay}</p>
        </section>
      )}
      {sp.welcome === '1' && <p className="notice notice-ok" role="status"><Icon name="check" />{t(greetingKey('home.welcomeNew', gender), { hotel: view.hotel.name })}</p>}

      {/* azioni rapide in cerchio, in alto (come le app di banca, viaggi e trasporti) */}
      <nav className="quick rise" aria-label={t('home.shortcuts')}>
        {quick.map((x) => (
          <Link key={x.href} className="quick-btn" href={x.href}>
            <span className="quick-ico" aria-hidden="true"><Icon name={x.icon} /></span>
            <span className="quick-label">{x.label}</span>
          </Link>
        ))}
      </nav>

      {!bonus && sectionError}
      {/* bonus come una tessera del portafoglio: una riga, un pulsante */}
      {bonus?.state === 'issued' && (
        <Link href="/stay/bonus" className="pass rise" aria-labelledby="bonus-h">
          <span className="pass-ico" aria-hidden="true"><Icon name="ticket" /></span>
          <span className="pass-text">
            <small>{t('home.bonusBadge')}</small>
            <strong id="bonus-h">{label}</strong>
          </span>
          <span className="pass-cta">{t('home.useBonus')}</span>
        </Link>
      )}
      {welcome && <p className="home-welcome welcome-note rise"><strong>{t('home.hotelWelcome', { hotel: view.hotel.name })}</strong>{welcome}</p>}
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

      {/* eventi: il prossimo in grande con la sua foto, poi gli altri in fila */}
      <section aria-labelledby="up" className="stack-sm section rise">
        <div className="sec-head">
          <h2 id="up" className="sec-title">{t('home.upcoming')}</h2>
          {events && events.length > 1 && <Link className="link-tap" href="/stay/events">{t('home.seeAll')}</Link>}
        </div>
        {!events && sectionError}
        {events && events.length === 0 && <p className="muted">{t('home.noEvents')}</p>}
        {featured && (() => {
          const d = dateChip(featured.startsAt, locale, tz);
          const img = safeImage(featured.imageUrl);
          return (
            <Link href="/stay/events" className="feature-card">
              <span className="feature-media">
                {img ? <img src={img} alt="" /> : <span className="media-empty"><Icon name="calendar" /></span>}
              </span>
              <span className="date-pill" aria-hidden="true"><small>{d.weekday}</small><strong>{d.day}</strong></span>
              <span className="feature-text">
                <strong>{pick(featured.title, locale)}</strong>
                <span>{formatDateTime(featured.startsAt, locale, tz)}{featured.location ? ` · ${featured.location}` : ''}</span>
              </span>
            </Link>
          );
        })()}
        {nextEvents.length > 0 && (
          <ul className="rail" aria-label={t('home.upcoming')}>
            {nextEvents.slice(0, 6).map((e, i) => {
              const d = dateChip(e.startsAt, locale, tz);
              const img = safeImage(e.imageUrl);
              return (
                <li key={e.id} style={{ '--i': i } as React.CSSProperties}>
                  <Link href="/stay/events" className="photo-card">
                    <span className="photo-card-media">
                      {img ? <img src={img} alt="" loading="lazy" /> : <span className="media-empty"><Icon name="calendar" /></span>}
                      <span className="date-pill date-pill-sm" aria-hidden="true"><small>{d.weekday}</small><strong>{d.day}</strong></span>
                    </span>
                    <span className="photo-card-body">
                      <strong>{pick(e.title, locale)}</strong>
                      <span className="event-meta">{formatTime(e.startsAt, locale, tz)}{e.location ? ` · ${e.location}` : ''}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* servizi da prenotare con la loro foto e il prossimo turno libero */}
      {facilities.length > 0 && (
        <section aria-labelledby="bk" className="stack-sm section rise">
          <div className="sec-head">
            <h2 id="bk" className="sec-title">{t('home.bookTitle')}</h2>
            <Link className="link-tap" href="/stay/book">{t('home.seeAll')}</Link>
          </div>
          <ul className="rail" aria-label={t('home.bookTitle')}>
            {facilities.map((x, i) => {
              const img = safeImage(x.imageUrl);
              const free = x.slots.find((s) => s.booked < s.capacity);
              return (
                <li key={x.id} style={{ '--i': i } as React.CSSProperties}>
                  <Link href="/stay/book" className="photo-card">
                    <span className="photo-card-media">
                      {img ? <img src={img} alt="" loading="lazy" /> : <span className="media-empty"><Icon name="clock" /></span>}
                    </span>
                    <span className="photo-card-body">
                      <strong>{pick(x.name, locale)}</strong>
                      {free && <span className="event-meta">{t('home.nextSlot', { when: formatDateTime(free.startsAt, locale, tz, { day: undefined, month: undefined }) })}</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {f.social && <HomeSocial />}

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

      <InstallHint />
    </>
  );
}
