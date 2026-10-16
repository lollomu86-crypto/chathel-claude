'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { ThreadSummary } from '@/lib/types';
import { call } from './client-api';
import { useErrorText, useI18n } from './I18n';
import { formatDateTime } from '@/lib/format';
import { useSocialBadge } from './SocialBadge';
import { Icon } from './ui/Icon';
import { EmptyState, ErrorState } from './ui/States';

/** Richieste in arrivo (Accetta/Rifiuta qui) e conversazioni. I dati arrivano dal provider dei non letti: un solo polling per tutta l'app. */
export function SocialThreads({ timezone, onGoPeople }: { timezone: string; onGoPeople: () => void }) {
  const { t, locale } = useI18n();
  const errText = useErrorText();
  const badge = useSocialBadge();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const threads = badge.threads;

  const respond = async (id: string, accept: boolean) => {
    setBusyId(id); setError(null);
    const r = await call('/api/guest/social-thread-respond', { threadId: id, accept });
    setBusyId(null);
    if (!r.ok) setError(errText(r.error));
    await badge.reload();
  };
  const when = (iso: string) => formatDateTime(iso, locale, timezone);

  const sorted = [...(threads ?? [])].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const requests = sorted.filter((x) => x.status === 'pending' && x.incoming);
  const others = sorted.filter((x) => !(x.status === 'pending' && x.incoming));

  const card = (th: ThreadSummary) => {
    const unread = badge.unreadIds.has(th.id);
    const status = th.status === 'pending'
      ? (th.incoming ? t('social.private.incoming', { name: th.peer.nickname }) : t('social.private.waiting', { name: th.peer.nickname }))
      : th.status === 'declined' ? t('social.private.declined') : null;
    const preview = th.preview || (th.status === 'accepted' ? t('social.private.couponPreview') : '');
    return (
      <article key={th.id} className="card thread stack-sm">
        <Link className="thread-main" href={`/stay/social/${encodeURIComponent(th.id)}`} aria-label={`${th.peer.nickname}${unread ? `, ${t('social.private.unread')}` : ''}`}>
          <span className="avatar" aria-hidden="true">{[...th.peer.nickname][0] ?? '?'}</span>
          <span className="grow">
            <strong className="truncate block">{th.peer.nickname}</strong>
            {status && <span className="badge badge-warn">{status}</span>}
            {preview && <span className="muted small truncate block">{preview}</span>}
          </span>
          <span className="thread-side">
            <span className="muted xs">{when(th.lastAt)}</span>
            {unread && <span className="dot" aria-hidden="true" />}
          </span>
        </Link>
        {th.status === 'pending' && th.incoming && (
          <div className="btn-group">
            <button type="button" className="btn btn-primary btn-small" disabled={busyId === th.id} onClick={() => void respond(th.id, true)}>{t('social.private.accept')}</button>
            <button type="button" className="btn btn-secondary btn-small" disabled={busyId === th.id} onClick={() => void respond(th.id, false)}>{t('social.private.decline')}</button>
          </div>
        )}
      </article>
    );
  };

  return (
    <section className="stack" aria-labelledby="pt-h">
      <h2 id="pt-h" className="t-sub">{t('social.private.title')}</h2>
      {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
      {badge.error && !threads && <ErrorState text={t('common.genericError')} onRetry={() => void badge.reload()} />}
      {!threads && !badge.error && <div className="stack" aria-busy="true"><span className="skeleton sk-72" /><span className="skeleton sk-72" /></div>}
      {threads && threads.length === 0 && (
        <EmptyState icon="chat" title={t('social.private.emptyTitle')} text={t('social.private.empty')} action={{ label: t('social.private.goPeople'), onClick: onGoPeople }} />
      )}
      {requests.length > 0 && (
        <>
          <h3 className="label">{t('social.private.requests', { n: requests.length })}</h3>
          {requests.map(card)}
        </>
      )}
      {others.length > 0 && (
        <>
          {requests.length > 0 && <h3 className="label">{t('social.private.conversations')}</h3>}
          {others.map(card)}
        </>
      )}
    </section>
  );
}
