'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fromLocalInput, toLocalInput } from '@/lib/time';
import type { I18nText } from '@/lib/types';
import { call } from './client-api';
import { useConfirm, useErrorText, useI18n } from './I18n';

export interface EventRow {
  id: string; title: I18nText; description?: I18nText | null; location?: string | null;
  startsAt: string; endsAt?: string | null; capacity?: number | null; published: boolean; rsvps: number; whenLabel: string;
}
interface Form { id?: string; ti: string; te: string; td: string; di: string; de: string; dd: string; location: string; starts: string; ends: string; capacity: string; published: boolean }
const empty: Form = { ti: '', te: '', td: '', di: '', de: '', dd: '', location: '', starts: '', ends: '', capacity: '', published: false };

export function AdminEvents({ events, tz }: { events: EventRow[]; tz: string }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const ask = useConfirm();
  const router = useRouter();
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Form, v: string | boolean) => setF((x) => (x ? { ...x, [k]: v } : x));

  const edit = (e: EventRow) => setF({ id: e.id, ti: e.title.it ?? '', te: e.title.en ?? '', td: e.title.de ?? '', di: e.description?.it ?? '', de: e.description?.en ?? '', dd: e.description?.de ?? '',
    location: e.location ?? '', starts: toLocalInput(e.startsAt, tz), ends: e.endsAt ? toLocalInput(e.endsAt, tz) : '', capacity: e.capacity ? String(e.capacity) : '', published: e.published });

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!f) return;
    const startsAt = fromLocalInput(f.starts, tz);
    const endsAt = f.ends ? fromLocalInput(f.ends, tz) : null;
    if (!startsAt) { setError(errText('invalid_event')); return; }
    setBusy(true); setError(null);
    const r = await call('/api/staff/event-save', {
      id: f.id, title: { it: f.ti, en: f.te, de: f.td }, description: { it: f.di, en: f.de, de: f.dd },
      location: f.location || null, startsAt, endsAt, capacity: f.capacity ? Number(f.capacity) : null, published: f.published,
    });
    setBusy(false);
    if (r.ok) { setF(null); router.refresh(); } else setError(errText(r.error));
  };
  const del = async (e: EventRow) => {
    if (!(await ask({ title: t('common.delete'), body: t('admin.events.deleteConfirm', { title: e.title.it ?? '' }), confirmLabel: t('common.delete'), danger: true }))) return;
    const r = await call('/api/staff/event-delete', { id: e.id });
    if (!r.ok) setError(errText(r.error));
    router.refresh();
  };

  return (
    <>
      <div className="row-between"><h1>{t('admin.events.title')}</h1>{!f && <button type="button" className="btn btn-primary" onClick={() => setF({ ...empty })}>{t('admin.events.new')}</button>}</div>

      {f && (
        <form className="card stack" onSubmit={save}>
          <h2 className="h3">{f.id ? t('admin.events.edit') : t('admin.events.new')}</h2>
          <div className="grid2">
            <div><label htmlFor="ti">{t('admin.events.titleIt')}</label><input id="ti" type="text" required maxLength={120} value={f.ti} onChange={(e) => set('ti', e.target.value)} /></div>
            <div><label htmlFor="te">{t('admin.events.titleEn')}</label><input id="te" type="text" maxLength={120} value={f.te} onChange={(e) => set('te', e.target.value)} /></div>
            <div><label htmlFor="td">{t('admin.events.titleDe')}</label><input id="td" type="text" maxLength={120} value={f.td} onChange={(e) => set('td', e.target.value)} /></div>
          </div>
          <div className="grid2">
            <div><label htmlFor="di">{t('admin.events.descIt')}</label><textarea id="di" maxLength={500} value={f.di} onChange={(e) => set('di', e.target.value)} /></div>
            <div><label htmlFor="de">{t('admin.events.descEn')}</label><textarea id="de" maxLength={500} value={f.de} onChange={(e) => set('de', e.target.value)} /></div>
            <div><label htmlFor="dd">{t('admin.events.descDe')}</label><textarea id="dd" maxLength={500} value={f.dd} onChange={(e) => set('dd', e.target.value)} /></div>
          </div>
          <p className="hint">{t('admin.events.fallbackNote')}</p>
          <div className="grid2">
            <div><label htmlFor="loc">{t('admin.events.location')}</label><input id="loc" type="text" maxLength={120} value={f.location} onChange={(e) => set('location', e.target.value)} /></div>
            <div><label htmlFor="st">{t('admin.events.starts')}</label><input id="st" type="datetime-local" required value={f.starts} onChange={(e) => set('starts', e.target.value)} /></div>
            <div><label htmlFor="en">{t('admin.events.ends')}</label><input id="en" type="datetime-local" value={f.ends} onChange={(e) => set('ends', e.target.value)} /></div>
            <div><label htmlFor="cap">{t('admin.events.capacity')}</label><input id="cap" type="number" min={1} value={f.capacity} onChange={(e) => set('capacity', e.target.value)} /></div>
          </div>
          <label className="check"><input type="checkbox" checked={f.published} onChange={(e) => set('published', e.target.checked)} /><span>{t('admin.events.published')}</span></label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="btn-group">
            <button type="submit" className="btn btn-primary" disabled={busy}>{t('common.save')}</button>
            <button type="button" className="btn btn-secondary" onClick={() => { setF(null); setError(null); }}>{t('common.cancel')}</button>
          </div>
        </form>
      )}

      {events.map((e) => (
        <article key={e.id} className="card">
          <div className="row-between">
            <strong>{e.title.it}</strong>
            <span className={`badge ${e.published ? 'badge-ok' : 'badge-warn'}`}>{e.published ? t('admin.events.statusPublished') : t('admin.events.draft')}</span>
          </div>
          <p className="muted small">{e.whenLabel}{e.location ? ` · ${e.location}` : ''}{e.capacity ? ` · ${t('admin.events.max', { n: e.capacity })}` : ''} · {t('admin.events.rsvps', { n: e.rsvps })}</p>
          <div className="row">
            <button type="button" className="btn btn-secondary btn-small" onClick={() => edit(e)}>{t('common.edit')}</button>
            <button type="button" className="btn btn-danger btn-small" onClick={() => void del(e)}>{t('common.delete')}</button>
          </div>
        </article>
      ))}
    </>
  );
}
