'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from './client-api';
import { useErrorText, useI18n } from './I18n';
import { Icon } from './ui/Icon';

export interface ConvRow {
  id: string; status: 'handoff_pending' | 'operator' | 'closed'; priority: 'urgent' | 'normal'; when: string; locale: string; reason: string; topic: string;
  messages: { id: string; role: string; content: string; when: string; wrong: boolean }[];
}

export function AdminInbox({ convs, showClosed }: { convs: ConvRow[]; showClosed: boolean }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const router = useRouter();
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (url: string, body: unknown) => {
    setBusy(true); setError(null);
    const r = await call(url, body);
    setBusy(false);
    if (!r.ok) setError(errText(r.error));
    router.refresh();
    return r.ok;
  };
  const who = (role: string) => (role === 'guest' ? t('admin.inbox.guest') : role === 'operator' ? t('admin.inbox.staff') : t('admin.inbox.ai'));
  const statusLabel = (s: ConvRow['status']) => (s === 'handoff_pending' ? t('admin.inbox.statusHandoff') : s === 'operator' ? t('admin.inbox.statusOperator') : t('admin.inbox.statusClosed'));

  return (
    <>
      <div className="row-between">
        <h1>{t('admin.inbox.title')}</h1>
        <Link className="btn btn-secondary btn-small" href={showClosed ? '/admin/inbox' : '/admin/inbox?closed=1'}>{showClosed && <Icon name="check" />}{t('admin.inbox.showClosed')}</Link>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {convs.length === 0 && <p className="muted">{t('admin.inbox.empty')}</p>}
      {convs.map((c) => (
        <article key={c.id} className={`card ${c.priority === 'urgent' ? 'card-urgent' : ''}`}>
          <div className="row-between">
            <span className="row">
              {c.priority === 'urgent' && <span className="badge badge-err"><Icon name="alert" />{t('admin.inbox.urgent')}</span>}
              <span className={`badge ${c.status === 'handoff_pending' ? 'badge-warn' : c.status === 'closed' ? '' : 'badge-info'}`}>{statusLabel(c.status)}</span>
              <span className="badge">{c.reason}</span>
              <span className="muted small">{c.when} · {c.locale.toUpperCase()}{c.topic ? ` · ${c.topic}` : ''}</span>
            </span>
          </div>
          <div className="convo">
            {c.messages.map((m) => (
              <div key={m.id} className="msg-line">
                <span className="who">{who(m.role)} · {m.when}</span>
                <div>{m.content}</div>
                {m.role === 'assistant' && (m.wrong
                  ? <span className="badge badge-err">{t('admin.inbox.marked')}</span>
                  : <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => act('/api/staff/mark-wrong', { messageId: m.id })}>{t('admin.inbox.markWrong')}</button>)}
              </div>
            ))}
          </div>
          {c.status !== 'closed' && (
            <form onSubmit={async (e) => { e.preventDefault(); const v = (text[c.id] ?? '').trim(); if (v && (await act('/api/staff/handoff-reply', { conversationId: c.id, text: v }))) setText({ ...text, [c.id]: '' }); }} className="stack">
              <label htmlFor={`r-${c.id}`}>{t('admin.inbox.reply')}</label>
              <textarea id={`r-${c.id}`} maxLength={1000} placeholder={t('admin.inbox.replyPlaceholder')} value={text[c.id] ?? ''} onChange={(e) => setText({ ...text, [c.id]: e.target.value })} />
              <div className="row">
                <button type="submit" className="btn btn-primary btn-auto" disabled={busy || !(text[c.id] ?? '').trim()}>{t('admin.inbox.reply')}</button>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => act('/api/staff/handoff-close', { conversationId: c.id })}>{t('admin.inbox.close')}</button>
              </div>
            </form>
          )}
        </article>
      ))}
    </>
  );
}
