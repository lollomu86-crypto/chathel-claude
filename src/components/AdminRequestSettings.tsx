'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CONTENT_LOCALES, DEPARTMENTS, type Department, type RequestCategory, type TeamMember } from '@/lib/types';
import { call } from './client-api';
import { useConfirm, useErrorText, useI18n } from './I18n';
import { Icon } from './ui/Icon';

type Names = Record<(typeof CONTENT_LOCALES)[number], string>;
const blank = (): Names => ({ it: '', en: '', de: '', ru: '' });
interface CatForm { id?: string; name: Names; department: Department; active: boolean }

/** Impostazioni delle richieste (solo direttore): categorie che l'ospite vede e account del personale di reparto (Team). */
export function AdminRequestSettings({ categories, team }: { categories: RequestCategory[]; team: TeamMember[] }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const ask = useConfirm();
  const router = useRouter();
  const [f, setF] = useState<CatForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nm, setNm] = useState({ name: '', email: '', department: 'housekeeping' as Department });
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  const saveCat = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!f) return;
    setBusy(true); setError(null);
    const r = await call('/api/staff/request-category-save', { id: f.id, name: f.name, department: f.department, active: f.active });
    setBusy(false);
    if (r.ok) { setF(null); router.refresh(); } else setError(errText(r.error, 'admin.requests'));
  };
  const toggleCat = async (c: RequestCategory) => {
    const r = await call('/api/staff/request-category-save', { id: c.id, name: c.name, department: c.department, active: !c.active });
    if (!r.ok) setError(errText(r.error, 'admin.requests'));
    router.refresh();
  };
  const addMember = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true); setError(null); setCreated(null);
    const r = await call('/api/staff/team-create', nm);
    setBusy(false);
    if (r.ok) { setCreated({ email: nm.email.trim().toLowerCase(), password: r.password as string }); setNm({ name: '', email: '', department: nm.department }); router.refresh(); }
    else setError(errText(r.error, 'admin.requests'));
  };
  const toggleMember = async (m: TeamMember) => {
    if (m.active && !(await ask({ title: t('admin.requests.teamOff'), body: t('admin.requests.teamOffConfirm', { name: m.name }), confirmLabel: t('admin.requests.teamOff'), danger: true }))) return;
    const r = await call('/api/staff/team-active', { id: m.id, active: !m.active });
    if (!r.ok) setError(errText(r.error, 'admin.requests'));
    router.refresh();
  };

  return (
    <section className="card stack" aria-labelledby="rqs">
      <h2 id="rqs" className="h3">{t('admin.requests.settingsTitle')}</h2>
      <p className="muted">{t('admin.requests.settingsIntro')}</p>
      {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}

      <h3 className="t-sub">{t('admin.requests.categories')}</h3>
      {categories.map((c) => (
        <div key={c.id} className="row-between">
          <span><strong>{c.name.it}</strong> <span className="muted small">· {t(`admin.requests.departments.${c.department}`)}</span>{!c.active && <> <span className="badge badge-warn">{t('admin.requests.off')}</span></>}</span>
          <span className="btn-group">
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setF({ id: c.id, name: { ...blank(), ...c.name } as Names, department: c.department, active: c.active })}>{t('common.edit')}</button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void toggleCat(c)}>{c.active ? t('admin.requests.turnOff') : t('admin.requests.turnOn')}</button>
          </span>
        </div>
      ))}
      {!f && <div><button type="button" className="btn btn-secondary btn-small" onClick={() => setF({ name: blank(), department: 'housekeeping', active: true })}>{t('admin.requests.newCategory')}</button></div>}
      {f && (
        <form className="card card-muted stack" onSubmit={saveCat}>
          <div className="grid2">
            {CONTENT_LOCALES.map((l) => (
              <div key={l} className="field"><label htmlFor={`rqc-${l}`}>{t(`admin.requests.name_${l}`)}</label>
                <input id={`rqc-${l}`} type="text" maxLength={60} required={l === 'it'} value={f.name[l]} onChange={(e) => setF({ ...f, name: { ...f.name, [l]: e.target.value } })} /></div>
            ))}
          </div>
          <div className="field"><label htmlFor="rqc-dep">{t('admin.requests.department')}</label>
            <select id="rqc-dep" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value as Department })}>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{t(`admin.requests.departments.${d}`)}</option>)}
            </select></div>
          <div className="btn-group">
            <button type="submit" className="btn btn-primary" disabled={busy}>{t('common.save')}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setF(null)}>{t('common.cancel')}</button>
          </div>
        </form>
      )}

      <hr />
      <h3 className="t-sub">{t('admin.requests.team')}</h3>
      <p className="hint">{t('admin.requests.teamIntro')}</p>
      {team.length === 0 && <p className="muted">{t('admin.requests.teamEmpty')}</p>}
      {team.map((m) => (
        <div key={m.id} className="row-between">
          <span><strong>{m.name}</strong> <span className="muted small">· {t(`admin.requests.departments.${m.department}`)}</span>{!m.active && <> <span className="badge badge-warn">{t('admin.requests.off')}</span></>}</span>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => void toggleMember(m)}>{m.active ? t('admin.requests.teamOff') : t('admin.requests.teamOn')}</button>
        </div>
      ))}
      <form className="card card-muted stack" onSubmit={addMember}>
        <h4 className="t-sub">{t('admin.requests.teamAdd')}</h4>
        <div className="grid2">
          <div className="field"><label htmlFor="tm-name">{t('admin.requests.teamName')}</label>
            <input id="tm-name" type="text" required maxLength={60} value={nm.name} onChange={(e) => setNm({ ...nm, name: e.target.value })} autoComplete="off" /></div>
          <div className="field"><label htmlFor="tm-email">{t('admin.requests.teamEmail')}</label>
            <input id="tm-email" type="email" required maxLength={200} value={nm.email} onChange={(e) => setNm({ ...nm, email: e.target.value })} autoComplete="off" /></div>
        </div>
        <div className="field"><label htmlFor="tm-dep">{t('admin.requests.department')}</label>
          <select id="tm-dep" value={nm.department} onChange={(e) => setNm({ ...nm, department: e.target.value as Department })}>
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{t(`admin.requests.departments.${d}`)}</option>)}
          </select></div>
        <div><button type="submit" className="btn btn-primary" disabled={busy}>{t('admin.requests.teamCreate')}</button></div>
        {created && (
          <div className="notice notice-ok" role="status">
            <Icon name="check" />
            <span className="grow">{t('admin.requests.teamCreated', { email: created.email })}<span className="tokenbox block">{created.password}</span>{t('admin.requests.teamPasswordOnce')}</span>
          </div>
        )}
      </form>
    </section>
  );
}
