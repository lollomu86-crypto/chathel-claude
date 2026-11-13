'use client';
import { useCallback, useState } from 'react';
import type { GuestRequestView, RequestCategory, RequestStatus } from '@/lib/types';
import { pick } from '@/lib/format';
import { call } from './client-api';
import { usePolling } from './hooks';
import { useConfirm, useErrorText, useI18n } from './I18n';
import { Icon } from './ui/Icon';

const NOTE_MAX = 300;
const PLACE_MAX = 40;
const BADGE: Record<RequestStatus, string> = { open: 'badge-info', taken: 'badge-warn', done: 'badge-ok', cancelled: 'badge' };

/** Richieste dell'ospite: categoria, "dove" e nota facoltativi; stato aggiornato ogni 30 s; voto quando e' fatta. */
export function RequestsClient({ initialCategories, initialRequests, timezone, hotelDefault }: {
  initialCategories: RequestCategory[]; initialRequests: GuestRequestView[]; timezone: string; hotelDefault: 'it' | 'en' | 'de' | 'ru';
}) {
  const { t, locale } = useI18n();
  const errText = useErrorText();
  const ask = useConfirm();
  const [categories, setCategories] = useState(initialCategories);
  const [requests, setRequests] = useState(initialRequests);
  const [cat, setCat] = useState<string | null>(null);
  const [place, setPlace] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [emergency, setEmergency] = useState<string | null>(null);
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  const reload = useCallback(async () => {
    const r = await call('/api/guest/requests');
    if (r.ok) { setRequests(r.requests as GuestRequestView[]); setCategories(r.categories as RequestCategory[]); }
    return r.ok;
  }, []);
  usePolling(reload, 30_000);

  const send = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!cat) return;
    setBusy(true); setError(null); setSent(false); setEmergency(null);
    const r = await call('/api/guest/request-create', { categoryId: cat, note: note.trim() || null, place: place.trim() || null });
    setBusy(false);
    if (r.ok && r.emergency) { setEmergency(r.emergencyText as string); return; }
    if (!r.ok) { setError(errText(r.error, 'requests')); return; }
    setCat(null); setNote(''); setPlace(''); setSent(true);
    await reload();
  };
  const cancel = async (id: string) => {
    if (!(await ask({ title: t('requests.cancel'), body: t('requests.cancelConfirm'), confirmLabel: t('requests.cancel'), danger: true }))) return;
    const r = await call('/api/guest/request-cancel', { id });
    if (!r.ok) setError(errText(r.error, 'requests'));
    await reload();
  };
  const rate = async (id: string, up: boolean) => {
    const r = await call('/api/guest/request-rate', { id, up });
    if (!r.ok) setError(errText(r.error, 'requests'));
    await reload();
  };

  return (
    <>
      <h1>{t('requests.title')}</h1>
      <p className="muted">{t('requests.intro')}</p>

      <form className="card stack" onSubmit={send} aria-labelledby="rq-new">
        <h2 id="rq-new" className="t-sub">{t('requests.new')}</h2>
        <fieldset className="fieldset">
          <legend>{t('requests.what')}</legend>
          <div className="chips" role="group">
            {categories.map((c) => (
              <button key={c.id} type="button" className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{pick(c.name, locale, hotelDefault)}</button>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="rq-place">{t('requests.where')} <span className="muted small">({t('common.optional')})</span></label>
          <input id="rq-place" type="text" maxLength={PLACE_MAX} value={place} placeholder={t('requests.wherePlaceholder')} onChange={(e) => setPlace(e.target.value)} autoComplete="off" />
          <span className="hint">{t('requests.whereHint')}</span>
        </div>
        <div className="field">
          <label htmlFor="rq-note">{t('requests.note')} <span className="muted small">({t('common.optional')})</span></label>
          <textarea id="rq-note" rows={3} maxLength={NOTE_MAX} value={note} placeholder={t('requests.notePlaceholder')} onChange={(e) => setNote(e.target.value)} />
          <span className="hint">{t('requests.noteHint')}</span>
        </div>
        {emergency && (
          <div className="notice notice-err emergency" role="alert">
            <Icon name="alert" /><span className="grow">{emergency}</span>
            <a className="btn btn-danger btn-small" href="tel:112">{t('reception.call112')}</a>
          </div>
        )}
        {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
        {sent && <p className="notice notice-ok" role="status"><Icon name="check" />{t('requests.sent')}</p>}
        <div><button type="submit" className="btn btn-primary" disabled={busy || !cat} aria-busy={busy}>{t('requests.send')}</button></div>
      </form>

      <section className="stack section" aria-labelledby="rq-mine">
        <h2 id="rq-mine" className="t-sub">{t('requests.mine')}</h2>
        {requests.length === 0 && <p className="muted">{t('requests.empty')}</p>}
        {requests.map((r) => (
          <article key={r.id} className="card stack-sm">
            <div className="row-between">
              <strong>{pick(r.category, locale, hotelDefault)}</strong>
              <span className={`badge ${BADGE[r.status]}`}>{t(`requests.status.${r.status}`)}</span>
            </div>
            {(r.place || r.note) && <p className="small pre">{[r.place, r.note].filter(Boolean).join(' · ')}</p>}
            <p className="hint">{t('requests.sentAt', { when: when(r.createdAt) })}{r.doneAt ? ` · ${t('requests.doneAt', { when: when(r.doneAt) })}` : ''}</p>
            {r.status === 'open' && (
              <div><button type="button" className="btn btn-ghost btn-small" onClick={() => void cancel(r.id)}>{t('requests.cancel')}</button></div>
            )}
            {r.status === 'done' && r.rating === null && (
              <div className="row">
                <span className="small">{t('requests.howWasIt')}</span>
                <button type="button" className="btn btn-secondary btn-small" aria-label={t('requests.rateUp')} onClick={() => void rate(r.id, true)}>👍</button>
                <button type="button" className="btn btn-secondary btn-small" aria-label={t('requests.rateDown')} onClick={() => void rate(r.id, false)}>👎</button>
              </div>
            )}
            {r.rating !== null && <p className="hint">{t(r.rating === 1 ? 'requests.ratedUp' : 'requests.ratedDown')}</p>}
          </article>
        ))}
      </section>
    </>
  );
}
