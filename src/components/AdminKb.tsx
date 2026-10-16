'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Locale } from '@/lib/types';
import { LOCALE_NAMES } from '@/lib/types';
import { call } from './client-api';
import { useConfirm, useErrorText, useI18n } from './I18n';

export interface KbRow { id: string; category: string; title: string; content: string; locale: Locale; active: boolean }
const CATEGORIES = ['general', 'hours', 'dining', 'spa', 'pool', 'rooms', 'transport', 'rules', 'contacts', 'events', 'other'];
const LIMIT = 25_000;
interface Form { id?: string; category: string; title: string; content: string; locale: Locale; active: boolean }

export function AdminKb({ entries, topics, canDelete }: { entries: KbRow[]; topics: { topic: string; count: number }[]; canDelete: boolean }) {
  const { t, locale } = useI18n();
  const errText = useErrorText();
  const confirmAsk = useConfirm();
  const router = useRouter();
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<{ text: string; handoff: boolean; mode: string } | null>(null);
  const total = entries.filter((e) => e.active).reduce((a, e) => a + e.content.length, 0);

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!f) return;
    setBusy(true); setError(null);
    const r = await call('/api/staff/kb-save', f);
    setBusy(false);
    if (r.ok) { setF(null); router.refresh(); } else setError(errText(r.error));
  };
  const del = async (id: string, title: string) => {
    if (!(await confirmAsk({ title: t('common.delete'), body: t('admin.ai.deleteConfirm', { title }), confirmLabel: t('common.delete'), danger: true }))) return;
    const r = await call('/api/staff/kb-delete', { id });
    if (!r.ok) setError(errText(r.error));
    router.refresh();
  };
  const ask = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setAnswer(null);
    const r = await call('/api/staff/ai-test', { question: q, locale });
    setBusy(false);
    if (r.ok) setAnswer({ text: r.text as string, handoff: !!r.handoff, mode: r.mode as string });
    else setError(errText(r.error));
  };

  return (
    <>
      <div className="row-between">
        <h1>{t('admin.ai.title')}</h1>
        {!f && <button type="button" className="btn btn-primary" onClick={() => setF({ category: 'general', title: '', content: '', locale, active: true })}>{t('admin.ai.add')}</button>}
      </div>

      <section className="card card-muted" aria-labelledby="test">
        <h2 id="test" className="h3">{t('admin.ai.testTitle')}</h2>
        <p className="muted small">{t('admin.ai.testHelp')}</p>
        <form className="row" onSubmit={ask}>
          <input type="text" className="grow" aria-label={t('admin.ai.testTitle')} placeholder={t('admin.ai.testPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} />
          <button type="submit" className="btn btn-secondary" disabled={busy || !q.trim()}>{t('admin.ai.testRun')}</button>
        </form>
        {answer && (
          <div className="stack" aria-live="polite">
            <div className="bubble bubble-ai"><span className="who">{t('reception.badgeAi')}</span>{answer.text}</div>
            <p className="hint">{t('admin.ai.testMode', { mode: answer.mode === 'claude' ? t('admin.ai.modeClaude') : t('admin.ai.modeKeyword') })}{answer.handoff ? ' · → ' + t('reception.talkToOperator') : ''}</p>
          </div>
        )}
      </section>

      {f && (
        <form className="card stack" onSubmit={save}>
          <p className="muted small">{t('admin.ai.kbHelp')}</p>
          <div className="grid2">
            <div><label htmlFor="kc">{t('admin.ai.category')}</label>
              <select id="kc" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`admin.ai.categories.${c}`)}</option>)}</select></div>
            <div><label htmlFor="kl">{t('admin.ai.lang')}</label>
              <select id="kl" value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value as Locale })}>{(['it', 'en', 'de'] as Locale[]).map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}</select></div>
          </div>
          <div><label htmlFor="kt">{t('admin.ai.entryTitle')}</label><input id="kt" type="text" required maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div><label htmlFor="kx">{t('admin.ai.content')}</label><textarea id="kx" required maxLength={4000} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} className="tall" /><p className="hint">{f.content.length} / 4000</p></div>
          <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /><span>{t('admin.ai.active')}</span></label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>{t('common.save')}</button>
            <button type="button" className="btn btn-secondary" onClick={() => { setF(null); setError(null); }}>{t('common.cancel')}</button>
          </div>
        </form>
      )}

      <h2 className="h3">{t('admin.ai.kbTitle')} <span className="muted small">· {t('admin.ai.kbSize', { n: total })}</span></h2>
      {total > LIMIT * 0.9 && <p className="notice notice-warn">{t('admin.ai.kbSize', { n: total })}</p>}
      {entries.map((e) => (
        <article key={e.id} className="card">
          <div className="row-between">
            <strong>{e.title}</strong>
            <span className="row"><span className="badge badge-info">{t(`admin.ai.categories.${e.category}`)}</span>{!e.active && <span className="badge badge-warn">{t('admin.ai.inactive')}</span>}</span>
          </div>
          <p className="pre">{e.content}</p>
          <div className="row">
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setF({ ...e })}>{t('common.edit')}</button>
            {canDelete && <button type="button" className="btn btn-danger btn-small" onClick={() => void del(e.id, e.title)}>{t('common.delete')}</button>}
          </div>
        </article>
      ))}

      <section className="card" aria-labelledby="un">
        <h2 id="un" className="h3">{t('admin.ai.unanswered')}</h2>
        <p className="muted small">{t('admin.ai.unansweredHelp')}</p>
        {topics.length === 0 ? <p>{t('admin.ai.unansweredEmpty')}</p> : (
          <table className="t"><tbody>{topics.map((x) => <tr key={x.topic}><td>{x.topic}</td><td>{x.count}</td></tr>)}</tbody></table>
        )}
      </section>
    </>
  );
}
