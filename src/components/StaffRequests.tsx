'use client';
import { useCallback, useEffect, useState } from 'react';
import { DEPARTMENTS, type Department, type StaffRequest } from '@/lib/types';
import { pick } from '@/lib/format';
import { call } from './client-api';
import { usePolling } from './hooks';
import { useErrorText, useI18n } from './I18n';
import { Icon } from './ui/Icon';

/**
 * Elenco delle richieste per lo staff. mode "full" (direttore, reception): tutti i reparti, filtri, priorita' e reparto.
 * mode "team" (personale di reparto): solo il proprio reparto e solo "Prendo in carico" / "Fatto". Aggiornato ogni 20 s.
 */
export function StaffRequests({ initial, mode, timezone }: { initial: StaffRequest[]; mode: 'full' | 'team'; timezone: string }) {
  const { t, locale } = useI18n();
  const errText = useErrorText();
  const [list, setList] = useState(initial);
  const [dept, setDept] = useState<Department | 'all'>('all');
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const full = mode === 'full';

  const reload = useCallback(async () => {
    const r = await call(`/api/staff/requests${closed ? '?closed=1' : ''}`);
    if (r.ok) setList(r.requests as StaffRequest[]);
    setNow(Date.now());
    return r.ok;
  }, [closed]);
  usePolling(reload, 20_000);
  useEffect(() => { void reload(); }, [reload]);

  const act = async (id: string, body: Record<string, unknown>) => {
    setBusy(id); setError(null);
    const r = await call('/api/staff/request-update', { id, ...body });
    setBusy(null);
    if (!r.ok) setError(errText(r.error, 'admin.requests'));
    await reload();
  };
  const waited = (iso: string) => Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  const time = (iso: string) => new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const shown = list.filter((r) => dept === 'all' || r.department === dept);
  const openCount = list.filter((r) => r.status === 'open' || r.status === 'taken').length;

  return (
    <div className="stack">
      {full && (
        <div className="row">
          <label className="sr-only" htmlFor="rq-dept">{t('admin.requests.department')}</label>
          <select id="rq-dept" value={dept} onChange={(e) => setDept(e.target.value as Department | 'all')}>
            <option value="all">{t('admin.requests.allDepartments')}</option>
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{t(`admin.requests.departments.${d}`)}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /><span>{t('admin.requests.showClosed')}</span></label>
        </div>
      )}
      <p className="muted small" role="status">{t('admin.requests.openCount', { n: openCount })}</p>
      {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
      {shown.length === 0 && <div className="card empty"><Icon name="check" /><p className="empty-title">{t('admin.requests.emptyTitle')}</p><p>{t('admin.requests.empty')}</p></div>}
      {shown.map((r) => {
        const live = r.status === 'open' || r.status === 'taken';
        const mins = waited(r.createdAt);
        return (
          <article key={r.id} className={`card stack-sm${r.priority === 'high' && live ? ' card-urgent' : ''}`}>
            <div className="row-between">
              <strong>{pick(r.category, locale, 'it')}</strong>
              <span className={`badge ${r.status === 'open' ? 'badge-info' : r.status === 'taken' ? 'badge-warn' : r.status === 'done' ? 'badge-ok' : ''}`}>{t(`admin.requests.status.${r.status}`)}</span>
            </div>
            <p className="small">
              {r.place && <><strong>{r.place}</strong> · </>}
              {r.guestName ?? t('admin.requests.guestGone')}
              {full && <> · {t(`admin.requests.departments.${r.department}`)}</>}
              {r.priority === 'high' && <> · <span className="badge badge-err">{t('admin.requests.high')}</span></>}
            </p>
            {r.note && <p className="pre">{r.note}</p>}
            <p className="hint">
              {live ? t('admin.requests.waiting', { n: mins, at: time(r.createdAt) }) : t('admin.requests.sentAt', { at: time(r.createdAt) })}
              {r.takenBy ? ` · ${t('admin.requests.takenBy', { name: r.takenBy })}` : ''}
              {r.rating !== null ? ` · ${r.rating === 1 ? '👍' : '👎'}` : ''}
            </p>
            {live && (
              <div className="btn-group">
                {r.status === 'open' && <button type="button" className="btn btn-secondary" disabled={busy === r.id} onClick={() => void act(r.id, { status: 'taken' })}>{t('admin.requests.take')}</button>}
                <button type="button" className="btn btn-primary" disabled={busy === r.id} onClick={() => void act(r.id, { status: 'done' })}>{t('admin.requests.done')}</button>
                {full && (
                  <>
                    <button type="button" className="btn btn-ghost btn-small" disabled={busy === r.id} onClick={() => void act(r.id, { priority: r.priority === 'high' ? 'normal' : 'high' })}>
                      {r.priority === 'high' ? t('admin.requests.makeNormal') : t('admin.requests.makeHigh')}
                    </button>
                    <label className="sr-only" htmlFor={`mv-${r.id}`}>{t('admin.requests.move')}</label>
                    <select id={`mv-${r.id}`} value={r.department} disabled={busy === r.id} onChange={(e) => void act(r.id, { department: e.target.value })}>
                      {DEPARTMENTS.map((d) => <option key={d} value={d}>{t(`admin.requests.departments.${d}`)}</option>)}
                    </select>
                  </>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
