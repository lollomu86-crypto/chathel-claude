'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from './client-api';
import { useConfirm, useErrorText, useI18n } from './I18n';

export function AdminNotify({ left, history }: { left: number; history: { id: string; when: string; title: string; body: string }[] }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const ask = useConfirm();
  const router = useRouter();
  const [f, setF] = useState({ ti: '', te: '', td: '', bi: '', be: '', bd: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(await ask({ title: t('admin.notifications.publish'), body: t('admin.notifications.publishConfirm'), confirmLabel: t('admin.notifications.publish') }))) return;
    setBusy(true); setError(null); setSent(false);
    const r = await call('/api/staff/notify', { title: { it: f.ti, en: f.te, de: f.td }, body: { it: f.bi, en: f.be, de: f.bd } });
    setBusy(false);
    if (r.ok) { setSent(true); setF({ ti: '', te: '', td: '', bi: '', be: '', bd: '' }); router.refresh(); } else setError(errText(r.error));
  };
  return (
    <>
      <h1>{t('admin.notifications.title')}</h1>
      <p className="notice notice-info">{t('admin.notifications.note')}</p>
      <p className={left > 0 ? 'muted' : 'error-text'}>{left > 0 ? t('admin.notifications.remaining', { n: left }) : t('admin.notifications.limitReached')}</p>
      <form className="card stack" onSubmit={send}>
        {([['i', 'itLabel'], ['e', 'enLabel'], ['d', 'deLabel']] as const).map(([k, lab]) => (
          <fieldset key={k} className="fieldset">
            <legend className="h3">{t(`admin.notifications.${lab}`)}</legend>
            <label htmlFor={`nt${k}`}>{t('admin.notifications.titleField')}</label>
            <input id={`nt${k}`} type="text" maxLength={120} required={k === 'i'} value={f[`t${k}` as 'ti']} onChange={(e) => set(`t${k}` as 'ti', e.target.value)} />
            <label htmlFor={`nb${k}`}>{t('admin.notifications.bodyField')}</label>
            <textarea id={`nb${k}`} maxLength={500} value={f[`b${k}` as 'bi']} onChange={(e) => set(`b${k}` as 'bi', e.target.value)} />
          </fieldset>
        ))}
        <p className="hint">{t('admin.events.fallbackNote')}</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        {sent && <p className="notice notice-ok" role="status">{t('common.confirmed')}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || left <= 0 || !f.ti.trim()}>{t('admin.notifications.publish')}</button>
      </form>
      <h2 className="h3">{t('admin.notifications.history')}</h2>
      {history.length === 0 && <p className="muted">{t('admin.notifications.empty')}</p>}
      {history.map((h) => (
        <article key={h.id} className="card"><p className="muted small">{h.when}</p><strong>{h.title}</strong>{h.body && <p>{h.body}</p>}</article>
      ))}
    </>
  );
}
