'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from './client-api';
import { useErrorText, useI18n } from './I18n';
import { Icon } from './ui/Icon';
import { safeImage } from '@/lib/safe-image';

export interface EventCardProps {
  id: string;
  title: string;
  description: string;
  location: string;
  when: string;
  chip: { weekday: string; day: string };
  going: boolean;
  goingCount: number | null;
  capacity: number | null;
  today: boolean;
  imageUrl?: string | null;
}

export function EventCard(p: EventCardProps) {
  const { t } = useI18n();
  const errText = useErrorText();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spotsLeft = p.capacity !== null && p.goingCount !== null ? Math.max(0, p.capacity - p.goingCount) : null;
  const full = spotsLeft === 0 && !p.going;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    const r = await call('/api/guest/rsvp', { eventId: p.id, going: !p.going });
    setBusy(false);
    if (!r.ok) setError(errText(r.error, 'events'));
    router.refresh();
  };
  return (
    <article className={`card event stack-sm${safeImage(p.imageUrl) ? ' has-photo' : ''}`} aria-labelledby={`ev-${p.id}`}>
      {safeImage(p.imageUrl) && <img className="card-photo" src={safeImage(p.imageUrl)!} alt="" width={800} height={450} loading="lazy" decoding="async" />}
      <div className="row row-nowrap">
        <span className="date-chip" aria-hidden="true"><small>{p.chip.weekday}</small><strong>{p.chip.day}</strong></span>
        <div className="grow">
          <h2 id={`ev-${p.id}`} className="t-sub">{p.title}</h2>
          <div className="event-meta">{p.when}{p.location ? ` · ${p.location}` : ''}</div>
        </div>
      </div>
      <div className="row">
        {p.today && <span className="badge badge-info">{t('common.today')}</span>}
        {p.going && <span className="badge badge-ok"><Icon name="check" />{t('events.going')}</span>}
        {full && <span className="badge badge-err">{t('events.soldOut')}</span>}
        {!full && spotsLeft !== null && spotsLeft <= 3 && <span className="badge badge-warn">{t('events.spotsLeft', { n: spotsLeft })}</span>}
      </div>
      {p.description && <p>{p.description}</p>}
      {/* solo il NUMERO di adesioni, mai l'elenco di chi partecipa */}
      {p.goingCount !== null && <p className="muted small">{t('events.count', { n: p.goingCount })}</p>}
      <button type="button" className={`btn ${p.going ? 'btn-secondary' : 'btn-primary'}`} disabled={busy || full} aria-pressed={p.going} aria-busy={busy} onClick={toggle}>
        {p.going ? t('events.cancelRsvp') : full ? t('events.soldOut') : t('events.rsvp')}
      </button>
      {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
    </article>
  );
}
