'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LOCALES, type AdminGame, type Locale } from '@/lib/types';
import { call } from './client-api';
import { useConfirm, useErrorText, useI18n } from './I18n';

type Names = Record<Locale, string>;
interface Form { id?: string; name: Names; desc: Names; location: string; active: boolean }
const blank = (): Names => ({ it: '', en: '', de: '', ru: '' });

/** Giochi dell'hotel per le sfide tra ospiti (ping pong, calcio balilla...). Non si prenotano: niente orari. */
export function AdminGames({ games }: { games: AdminGame[] }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const ask = useConfirm();
  const router = useRouter();
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = (g: AdminGame) => setF({ id: g.id, name: { ...blank(), ...g.name } as Names, desc: { ...blank(), ...(g.description ?? {}) } as Names, location: g.location ?? '', active: g.active });
  const send = async (body: unknown) => {
    setBusy(true); setError(null);
    const r = await call('/api/staff/game-save', body);
    setBusy(false);
    if (r.ok) { setF(null); router.refresh(); } else setError(errText(r.error, 'admin.games'));
    return r.ok;
  };
  const save = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (f) void send({ id: f.id, name: f.name, description: f.desc, location: f.location || null, active: f.active });
  };
  const toggle = (g: AdminGame) => void send({ id: g.id, name: g.name, description: g.description, location: g.location, active: !g.active });
  const del = async (g: AdminGame) => {
    if (!(await ask({ title: t('common.delete'), body: t('admin.games.deleteConfirm', { name: g.name.it ?? '' }), confirmLabel: t('common.delete'), danger: true }))) return;
    const r = await call('/api/staff/game-delete', { id: g.id });
    if (!r.ok) setError(errText(r.error, 'admin.games'));
    router.refresh();
  };

  return (
    <>
      <div className="row-between">
        <h1>{t('admin.games.title')}</h1>
        {!f && <button type="button" className="btn btn-primary" onClick={() => setF({ name: blank(), desc: blank(), location: '', active: true })}>{t('admin.games.new')}</button>}
      </div>
      <p className="muted">{t('admin.games.intro')}</p>

      {f && (
        <form className="card stack" onSubmit={save}>
          <h2 className="h3">{f.id ? t('admin.games.edit') : t('admin.games.new')}</h2>
          <div className="grid2">
            {LOCALES.map((l) => (
              <div key={l}><label htmlFor={`gn-${l}`}>{t(`admin.games.name_${l}`)}</label>
                <input id={`gn-${l}`} type="text" required={l === 'it'} maxLength={60} value={f.name[l]} onChange={(e) => setF({ ...f, name: { ...f.name, [l]: e.target.value } })} /></div>
            ))}
          </div>
          <div className="grid2">
            {LOCALES.map((l) => (
              <div key={l}><label htmlFor={`gd-${l}`}>{t(`admin.games.desc_${l}`)}</label>
                <textarea id={`gd-${l}`} maxLength={300} value={f.desc[l]} onChange={(e) => setF({ ...f, desc: { ...f.desc, [l]: e.target.value } })} /></div>
            ))}
          </div>
          <div className="field"><label htmlFor="gloc">{t('admin.games.location')}</label>
            <input id="gloc" type="text" maxLength={120} value={f.location} placeholder={t('admin.games.locationHint')} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
          <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /><span>{t('admin.games.active')}</span></label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="btn-group">
            <button type="submit" className="btn btn-primary" disabled={busy}>{t('common.save')}</button>
            <button type="button" className="btn btn-secondary" onClick={() => { setF(null); setError(null); }}>{t('common.cancel')}</button>
          </div>
        </form>
      )}

      {!f && error && <p className="error-text" role="alert">{error}</p>}
      {games.length === 0 && !f && <div className="card empty"><p className="empty-title">{t('admin.games.emptyTitle')}</p><p>{t('admin.games.empty')}</p></div>}
      {games.map((g) => (
        <article key={g.id} className="card">
          <div className="row-between">
            <strong>{g.name.it ?? Object.values(g.name)[0]}</strong>
            <span className={`badge ${g.active ? 'badge-ok' : 'badge-warn'}`}>{g.active ? t('admin.games.on') : t('admin.games.off')}</span>
          </div>
          {g.location && <p className="muted small">{g.location}</p>}
          <div className="row">
            <button type="button" className="btn btn-secondary btn-small" onClick={() => edit(g)}>{t('common.edit')}</button>
            <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => toggle(g)}>{g.active ? t('admin.games.turnOff') : t('admin.games.turnOn')}</button>
            <button type="button" className="btn btn-danger btn-small" onClick={() => void del(g)}>{t('common.delete')}</button>
          </div>
        </article>
      ))}
    </>
  );
}
