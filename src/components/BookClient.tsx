'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { call } from './client-api';
import { useConfirm, useErrorText, useI18n } from './I18n';
import { Icon } from './ui/Icon';

export interface BookSlot { id: string; day: string; time: string; remaining: number; capacity: number }
export interface BookFacility { id: string; name: string; description: string; slots: BookSlot[] }
export interface BookDay { key: string; label: string }
export interface BookBooking { id: string; facility: string; when: string; party: number; canCancel: boolean }

/** Selettore slot: servizio -> giorno -> persone -> orario -> conferma. La capienza e' decisa dal database. */
export function BookClient({ facilities, days, bookings, cutoff }: { facilities: BookFacility[]; days: BookDay[]; bookings: BookBooking[]; cutoff: number }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const ask = useConfirm();
  const router = useRouter();
  const [fac, setFac] = useState(facilities[0]?.id ?? '');
  const [day, setDay] = useState(days[0]?.key ?? '');
  const [party, setParty] = useState(1);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const f = facilities.find((x) => x.id === fac);
  const slots = useMemo(() => (f?.slots ?? []).filter((s) => s.day === day), [f, day]);
  const chosen = slots.find((s) => s.id === slotId) ?? null;
  const dayLabel = days.find((d) => d.key === day)?.label ?? '';

  const confirm = async () => {
    if (!chosen) return;
    setBusy(true); setError(null); setDone(false);
    const r = await call('/api/guest/book', { slotId: chosen.id, partySize: party });
    setBusy(false);
    if (r.ok) { setDone(true); setSlotId(null); } else setError(errText(r.error, 'book'));
    router.refresh(); // aggiorna i posti rimasti senza perdere la selezione del servizio e del giorno
  };
  const cancel = async (id: string) => {
    if (!(await ask({ title: t('book.cancelConfirm'), confirmLabel: t('book.cancel'), danger: true }))) return;
    setBusy(true); setError(null);
    const r = await call('/api/guest/cancel-booking', { bookingId: id });
    setBusy(false);
    if (!r.ok) setError(errText(r.error, 'book'));
    router.refresh();
  };

  const word = (remaining: number) => (remaining <= 0 ? t('book.slotFull') : remaining <= 2 ? t('book.slotFew') : t('book.slotFree'));

  return (
    <>
      <h1>{t('book.title')}</h1>
      {facilities.length === 0 && (
        <div className="card empty"><Icon name="clock" /><p className="empty-title">{t('book.emptyTitle')}</p><p>{t('book.emptyBody')}</p></div>
      )}
      {facilities.length > 0 && (
        <>
          <fieldset className="fieldset">
            <legend>{t('book.chooseService')}</legend>
            <div className="chips">
              {facilities.map((x) => (
                <button key={x.id} type="button" className="chip" aria-pressed={x.id === fac} onClick={() => { setFac(x.id); setSlotId(null); }}>{x.name}</button>
              ))}
            </div>
          </fieldset>
          {f?.description && <p className="muted small">{f.description}</p>}

          <fieldset className="fieldset">
            <legend>{t('book.chooseDay')}</legend>
            <div className="days">
              {days.map((d) => (
                <button key={d.key} type="button" className="day" aria-pressed={d.key === day} onClick={() => { setDay(d.key); setSlotId(null); }}>{d.label}</button>
              ))}
            </div>
          </fieldset>

          <fieldset className="fieldset">
            <legend id="party-l">{t('book.party')}</legend>
            <div className="stepper" role="group" aria-labelledby="party-l">
              <button type="button" aria-label={t('book.partyLess')} disabled={party <= 1} onClick={() => { setParty(Math.max(1, party - 1)); setSlotId(null); }}>−</button>
              <output id="party" aria-live="polite">{party}</output>
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
        </>
      )}

      {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
      {done && <p className="notice notice-ok" role="status"><Icon name="check" />{t('book.booked')}</p>}
      {chosen && (
        <div className="confirm-bar stack-sm">
          <p><strong>{t('book.confirm', { facility: f?.name ?? '', when: `${dayLabel} ${chosen.time}`, n: t('book.persons', { n: party }) })}</strong></p>
          <button type="button" className="btn btn-cta btn-block" disabled={busy} aria-busy={busy} onClick={confirm}>{busy ? t('common.loading') : t('book.confirmButton')}</button>
        </div>
      )}

      <h2 className="section">{t('book.myBookings')}</h2>
      {bookings.length === 0 && (
        <div className="card empty"><Icon name="calendar" /><p className="empty-title">{t('book.noBookings')}</p><p>{t('book.noBookingsHint')}</p></div>
      )}
      {bookings.map((b) => (
        <div key={b.id} className="card stack-sm">
          <p className="row-between"><strong>{b.facility}</strong><span className="badge badge-ok"><Icon name="check" />{t('common.confirmed')}</span></p>
          <p>{b.when} · {t('book.persons', { n: b.party })}</p>
          {b.canCancel
            ? <button type="button" className="btn btn-danger btn-small" disabled={busy} onClick={() => cancel(b.id)}>{t('book.cancel')}</button>
            : <p className="hint">{t('book.cancelUntil', { m: cutoff })}</p>}
        </div>
      ))}
    </>
  );
}
