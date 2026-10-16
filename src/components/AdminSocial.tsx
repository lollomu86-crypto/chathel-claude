'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Period, PublicModerationMessage, SocialReportView, SocialStats } from '@/lib/types';
import { call } from './client-api';
import { useConfirm, useErrorText, useI18n } from './I18n';
import { Icon } from './ui/Icon';

type ReportRow = Omit<SocialReportView, 'excerpt'> & { when: string; excerpt: (SocialReportView['excerpt'][number] & { when: string })[] };
type FeedRow = PublicModerationMessage & { when: string };

const STAT_KEYS = ['visibleGuests', 'publicMessages', 'privateRequests', 'privateAccepted', 'privateDeclined', 'privateMessages', 'couponsSent', 'couponsRedeemed', 'couponsExpired', 'hiddenMessages', 'openReports'] as const;

/** Pannello hotel: numeri aggregati, coda segnalazioni, moderazione della chat pubblica. Nessuna chat privata leggibile. */
export function AdminSocial({ stats, period, showClosed, reports, feed }: { stats: SocialStats; period: Period; showClosed: boolean; reports: ReportRow[]; feed: FeedRow[] }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: string, body: unknown) => {
    setBusy(true); setError(null);
    const r = await call(`/api/staff/${action}`, body);
    setBusy(false);
    if (!r.ok) setError(errText(r.error));
    router.refresh();
  };
  const ask = async (key: 'mute' | 'muteCheckout' | 'remove', go: () => Promise<void>) => {
    if (await confirm({ title: t(`admin.social.confirm.${key}.title`), body: t(`admin.social.confirm.${key}.body`), confirmLabel: t(`admin.social.actions.${key}`), danger: key === 'remove' })) await go();
  };
  const href = (p: Period, closed: boolean) => `/admin/social?period=${p}${closed ? '&closed=1' : ''}`;

  const personActions = (id: string | null, muted: boolean, removed: boolean) => id && (
    <>
      {muted
        ? <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => act('social-mute', { socialId: id, muted: false })}>{t('admin.social.actions.unmute')}</button>
        : (<>
            <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => ask('mute', () => act('social-mute', { socialId: id, muted: true, minutes: 60 }))}>{t('admin.social.actions.mute')}</button>
            <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => ask('muteCheckout', () => act('social-mute', { socialId: id, muted: true }))}>{t('admin.social.actions.muteCheckout')}</button>
          </>)}
      {removed
        ? <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => act('social-remove', { socialId: id, removed: false })}>{t('admin.social.actions.restore')}</button>
        : <button type="button" className="btn btn-danger btn-small" disabled={busy} onClick={() => ask('remove', () => act('social-remove', { socialId: id, removed: true }))}>{t('admin.social.actions.remove')}</button>}
    </>
  );

  return (
    <>
      <h1>{t('admin.social.title')}</h1>
      <p className="muted">{t('admin.social.intro')}</p>
      {error && <p className="error-text" role="alert">{error}</p>}

      <nav className="seg" aria-label={t('admin.social.periodLabel')}>
        {(['today', '7d', 'season'] as Period[]).map((p) => (
          <Link key={p} href={href(p, showClosed)} aria-current={p === period ? 'page' : undefined}>{t(`admin.social.period.${p}`)}</Link>
        ))}
      </nav>
      <section className="kpis kpis-compact" aria-label={t('admin.social.title')}>
        {STAT_KEYS.map((k) => (
          <article key={k} className="card kpi">
            <div className="num">{stats[k]}</div>
            <p className="muted small">{t(`admin.social.stats.${k}`)}</p>
          </article>
        ))}
      </section>

      <div className="row-between section-gap">
        <h2>{t('admin.social.reports.title')}</h2>
        <Link className="btn btn-secondary btn-small" href={href(period, !showClosed)} aria-pressed={showClosed}>{showClosed && <Icon name="check" />}{t('admin.social.reports.showClosed')}</Link>
      </div>
      {reports.length === 0 && <p className="muted">{t('admin.social.reports.empty')}</p>}
      {reports.map((r) => (
        <article key={r.id} className="card">
          <div className="row">
            <span className={`badge ${r.status === 'open' ? 'badge-warn' : ''}`}>{t(`admin.social.reports.status.${r.status}`)}</span>
            <span className="badge badge-info">{t(`admin.social.reports.${r.kind}`)}</span>
            <span className="badge">{t(`social.report.${r.reason}`)}</span>
            <span className="muted small">{r.when}</span>
          </div>
          <p className="small">
            {t('admin.social.reports.by', { name: r.reporter || '—' })}
            {r.reported.nickname && <> · {t('admin.social.reports.about', { name: r.reported.nickname })}</>}
            {r.reported.muted && <> <span className="badge badge-warn">{t('admin.social.badge.muted')}</span></>}
            {r.reported.removed && <> <span className="badge badge-err">{t('admin.social.badge.removed')}</span></>}
            {r.messageHidden && <> <span className="badge">{t('admin.social.badge.hidden')}</span></>}
          </p>
          {r.reportsAgainst > 1 && <p className="small muted">{t('admin.social.reports.count', { n: r.reportsAgainst })}</p>}
          {r.excerpt.length > 0 && (
            <div className="excerpt">
              {r.kind === 'private' && <p className="muted small">{t('admin.social.reports.privateNote')}</p>}
              {r.excerpt.map((e, i) => <p key={i}><span className="muted small">{e.nickname} · {e.when}</span><br />{e.text}</p>)}
            </div>
          )}
          {r.status === 'open' && (
            <div className="mod-actions">
              {r.kind === 'public' && r.messageId && !r.messageHidden && (
                <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => act('social-hide', { messageId: r.messageId, hidden: true })}>{t('admin.social.actions.hide')}</button>
              )}
              {personActions(r.reported.id, r.reported.muted, r.reported.removed)}
              <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => act('social-report-close', { reportId: r.id, outcome: 'actioned' })}>{t('admin.social.reports.actioned')}</button>
              <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => act('social-report-close', { reportId: r.id, outcome: 'dismissed' })}>{t('admin.social.reports.dismiss')}</button>
            </div>
          )}
        </article>
      ))}

      <h2 className="section-gap">{t('admin.social.feed.title')}</h2>
      <p className="muted small">{t('admin.social.feed.hint')}</p>
      {feed.length === 0 && <p className="muted">{t('admin.social.feed.empty')}</p>}
      {feed.map((m) => (
        <article key={m.id} className="card">
          <div className="row">
            <strong>{m.nickname}</strong>
            <span className="muted small">{m.when}</span>
            {m.hidden && <span className="badge">{t('admin.social.badge.hidden')}</span>}
            {m.authorMuted && <span className="badge badge-warn">{t('admin.social.badge.muted')}</span>}
            {m.authorRemoved && <span className="badge badge-err">{t('admin.social.badge.removed')}</span>}
          </div>
          <p className="wrap">{m.text}</p>
          <div className="mod-actions">
            <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => act('social-hide', { messageId: m.id, hidden: !m.hidden })}>{m.hidden ? t('admin.social.actions.unhide') : t('admin.social.actions.hide')}</button>
            {personActions(m.authorId, m.authorMuted, m.authorRemoved)}
          </div>
        </article>
      ))}
    </>
  );
}
