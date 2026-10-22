'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { call } from './client-api';
import { ChallengeDialog } from './Challenge';
import { useConfirm, useErrorText, useI18n } from './I18n';
import { safeImage } from '@/lib/safe-image';
import type { ChallengeView } from '@/lib/types';
import { Icon } from './ui/Icon';

export interface BookSlot { id: string; day: string; time: string; remaining: number; capacity: number }
export interface BookFacility { id: string; name: string; description: string; imageUrl?: string | null; slots: BookSlot[] }
export interface BookDay { key: string; label: string }
export interface BookBooking { id: string; facility: string; when: string; chip: { weekday: string; day: string }; party: number; canCancel: boolean }
export interface BookGame { id: string; name: string; description: string; location: string }

/**
 * Prenota, nello stile degli Eventi: le mie prenotazioni in alto, poi una card per servizio (foto, nome, descrizione);
 * "Prenota" apre dentro la card giorno -> persone -> orario -> conferma. In fondo i giochi: non si prenotano, si sfida.
 */
export function BookClient({ facilities, days, bookings, cutoff, games }: { facilities: BookFacility[]; days: BookDay[]; bookings: BookBooking[]; cutoff: number; games: BookGame[] }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const ask = useConfirm();
  const router = useRouter();
  const [openFac, setOpenFac] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challengeGame, setChallengeGame] = useState<string | null>(null);
  const [sent, setSent] = useState<ChallengeView | null>(null);

  const cancel = async (id: string) => {
    if (!(await ask({ title: t('book.cancelConfirm'), confirmLabel: t('book.cancel'), danger: true }))) return;
    setBusy(true); setError(null);
    const r = await call('/api/guest/cancel-booking', { bookingId: id });
    setBusy(false);
    if (!r.ok) setError(errText(r.error, 'book'));
    router.refresh();
  };

  return (
    <>
      <h1>{t('book.title')}</h1>
      {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}

      {bookings.length > 0 && (
        <section className="stack-sm" aria-labelledby="mybk">
          <h2 id="mybk" className="t-sub">{t('book.myBookings')}</h2>
          {bookings.map((b) => (
            <article key={b.id} className="card stack-sm">
              <div className="row row-nowrap">
                <span className="date-chip" aria-hidden="true"><small>{b.chip.weekday}</small><strong>{b.chip.day}</strong></span>
                <div className="grow">
                  <h3 className="t-sub">{b.facility}</h3>
                  <div className="event-meta">{b.when} · {t('book.persons', { n: b.party })}</div>
                </div>
                <span className="badge badge-ok"><Icon name="check" />{t('common.confirmed')}</span>
              </div>
              {b.canCancel
                ? <button type="button" className="btn btn-danger btn-small" disabled={busy} onClick={() => cancel(b.id)}>{t('book.cancel')}</button>
                : <p className="hint">{t('book.cancelUntil', { m: cutoff })}</p>}
            </article>
          ))}
        </section>
      )}

      <section className="stack-sm" aria-labelledby="svc">
        <h2 id="svc" className="t-sub section">{t('book.services')}</h2>
        {facilities.length === 0 && (
          <div className="card empty"><Icon name="clock" /><p className="empty-title">{t('book.emptyTitle')}</p><p>{t('book.emptyBody')}</p></div>
        )}
        {facilities.map((f) => (
          <FacilityCard key={f.id} f={f} days={days} open={openFac === f.id} onToggle={() => setOpenFac(openFac === f.id ? null : f.id)} />
        ))}
      </section>

      {games.length > 0 && (
        <section className="stack-sm" aria-labelledby="gms">
          <h2 id="gms" className="t-sub section">{t('games.title')}</h2>
          <p className="muted small">{t('games.hint')}</p>
          {sent && <p className="notice notice-ok" role="status"><Icon name="check" />{t(sent.scope === 'public' ? 'challenge.sentPublic' : 'challenge.sentPrivate')}</p>}
          <div className="games">
            {games.map((g) => (
              <article key={g.id} className="card game-card stack-sm">
                <div className="row row-nowrap">
                  <span className="game-icon" aria-hidden="true"><Icon name="trophy" /></span>
                  <div className="grow">
                    <h3 className="t-sub">{g.name}</h3>
                    {g.location && <div className="event-meta">{g.location}</div>}
                  </div>
                </div>
                {g.description && <p className="small">{g.description}</p>}
                <button type="button" className="btn btn-secondary btn-small" onClick={() => { setSent(null); setChallengeGame(g.id); }}>
                  <Icon name="trophy" />{t('games.challenge')}
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
      <ChallengeDialog open={challengeGame !== null} gameId={challengeGame ?? undefined} onClose={() => setChallengeGame(null)}
        onSent={(c) => { setChallengeGame(null); setSent(c); }} />
    </>
  );
}

/** Card di un servizio: chiusa mostra foto e descrizione; aperta il selettore giorno, persone, orario e la conferma. */
function FacilityCard({ f, days, open, onToggle }: { f: BookFacility; days: BookDay[]; open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const router = useRouter();
  const [day, setDay] = useState(days[0]?.key ?? '');
  const [party, setParty] = useState(1);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const slots = useMemo(() => f.slots.filter((s) => s.day === day), [f, day]);
  const chosen = slots.find((s) => s.id === slotId) ?? null;
  const dayLabel = days.find((d) => d.key === day)?.label ?? '';
  const free = f.slots.some((s) => s.remaining > 0);
  const word = (remaining: number) => (remaining <= 0 ? t('book.slotFull') : remaining <= 2 ? t('book.slotFew') : t('book.slotFree'));

  const confirm = async () => {
    if (!chosen) return;
    setBusy(true); setError(null); setDone(false);
    const r = await call('/api/guest/book', { slotId: chosen.id, partySize: party });
    setBusy(false);
    if (r.ok) { setDone(true); setSlotId(null); } else setError(errText(r.error, 'book'));
    router.refresh(); // aggiorna i posti rimasti e "Le mie prenotazioni"
  };
  const panel = `fac-${f.id}`;

  return (
    <article className={`card event stack-sm${safeImage(f.imageUrl) ? ' has-photo' : ''}`} aria-labelledby={`${panel}-h`}>
      {safeImage(f.imageUrl) && <img className="card-photo" src={safeImage(f.imageUrl)!} alt="" width={800} height={450} loading="lazy" decoding="async" />}
      <h3 id={`${panel}-h`} className="t-sub">{f.name}</h3>
      {f.description && <p>{f.description}</p>}
      {!free && <span className="badge badge-warn">{t('book.noFreeSlots')}</span>}
      <button type="button" className={`btn ${open ? 'btn-secondary' : 'btn-primary'}`} aria-expanded={open} aria-controls={panel} onClick={onToggle}>
        {open ? t('book.close') : t('book.open')}
      </button>
      {open && (
        <div id={panel} className="stack">
          <fieldset className="fieldset">
            <legend>{t('book.chooseDay')}</legend>
            <div className="days">
              {days.map((d) => (
                <button key={d.key} type="button" className="day" aria-pressed={d.key === day} onClick={() => { setDay(d.key); setSlotId(null); }}>{d.label}</button>
              ))}
            </div>
          </fieldset>
          <fieldset className="fieldset">
            <legend id={`${panel}-p`}>{t('book.party')}</legend>
            <div className="stepper" role="group" aria-labelledby={`${panel}-p`}>
              <button type="button" aria-label={t('book.partyLess')} disabled={party <= 1} onClick={() => { setParty(Math.max(1, party - 1)); setSlotId(null); }}>−</button>
              <output aria-live="polite">{party}</output>
              <button type="button" aria-label={t('book.partyMore')} disabled={party >= 10} onClick={() => { setParty(Math.min(10, party + 1)); setSlotId(null); }}>+</button>
            </div>
          </fieldset>
          <fieldset className="fieldset">
            <legend>{t('book.pick')}</legend>
            {slots.length === 0 && <p className="muted">{t('book.noSlots')}</p>}
            <div className="slots">
              {slots.map((s) => {
                const fits = s.remaining >= party;
                const w = fits ? word(s.remaining) : s.remaining <= 0 ? t('book.slotFull') : t('book.slotNotEnough');
                return (
                  <button key={s.id} type="button" disabled={!fits} aria-pressed={s.id === slotId}
                    aria-label={`${s.time}, ${w}, ${t('common.seats', { n: s.remaining })}`}
                    className={`slot ${fits && s.remaining <= 2 ? 'slot-low' : ''}`} onClick={() => setSlotId(s.id)}>
                    <strong>{s.time}</strong>
                    <span>{w}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
          {done && <p className="notice notice-ok" role="status"><Icon name="check" />{t('book.booked')}</p>}
          {chosen && (
            <div className="stack-sm">
              <p><strong>{t('book.confirm', { facility: f.name, when: `${dayLabel} ${chosen.time}`, n: t('book.persons', { n: party }) })}</strong></p>
              <button type="button" className="btn btn-cta btn-block" disabled={busy} aria-busy={busy} onClick={confirm}>{busy ? t('common.loading') : t('book.confirmButton')}</button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
