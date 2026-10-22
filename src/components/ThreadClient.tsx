'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { COUPON_KINDS, type ChallengeView, type CouponKind, type CouponView, type ReportReason, type ThreadDetail } from '@/lib/types';
import { ChallengeCard, ChallengeDialog } from './Challenge';
import { formatDateTime } from '@/lib/format';
import { call } from './client-api';
import { CouponQr } from './CouponQr';
import { chatTime, dayKeyOf, dayLabel } from './format-ui';
import { nearBottom, scrollToBottom, usePolling } from './hooks';
import { useConfirm, useErrorText, useI18n } from './I18n';
import { ReportDialog } from './ReportDialog';
import { useSocialBadge } from './SocialBadge';
import { ActionMenu } from './ui/ActionMenu';
import { Icon } from './ui/Icon';

/** Conversazione privata: richiesta iniziale (accetta/rifiuta), messaggi con il nome, coupon come biglietti, blocca e segnala ovunque. */
export function ThreadClient({ initial, timezone, couponsLeft }: { initial: ThreadDetail; timezone: string; couponsLeft: number }) {
  const { t, locale } = useI18n();
  const errText = useErrorText();
  const ask = useConfirm();
  const router = useRouter();
  const badge = useSocialBadge();
  const [th, setTh] = useState<ThreadDetail>(initial);
  const [chs, setChs] = useState<ChallengeView[]>([]);
  const [challenging, setChallenging] = useState(false);
  const [left, setLeft] = useState(couponsLeft);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showQr, setShowQr] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [couponOpen, setCouponOpen] = useState(false);
  const [kind, setKind] = useState<CouponKind | null>(null);
  const [announce, setAnnounce] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const known = useRef(new Set(initial.messages.map((m) => m.id)));
  const stick = useRef(true); // all'apertura si va all'ultimo messaggio; poi si segue solo chi e' gia' in fondo
  const name = th.peer.nickname;
  const peerId = initial.id;

  const reload = useCallback(async () => {
    const [r, c] = await Promise.all([call(`/api/guest/social-thread?id=${encodeURIComponent(peerId)}`), call(`/api/guest/social-challenges?thread=${encodeURIComponent(peerId)}`)]);
    if (r.ok) { stick.current = nearBottom(); if (c.ok) setChs(c.challenges as ChallengeView[]); setTh(r.thread as ThreadDetail); }
    else if (r.status === 400 || r.status === 403) router.replace('/stay/social?tab=private');
    return r.ok;
  }, [peerId, router]);
  usePolling(reload, 5000, !showQr);

  // segna come visto ogni volta che arrivano messaggi nuovi (il server non traccia le letture)
  useEffect(() => { void badge.markSeen(peerId); }, [th.messages.length, th.status, peerId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (stick.current) scrollToBottom();
    for (const m of th.messages) {
      if (known.current.has(m.id)) continue;
      known.current.add(m.id);
      if (!m.mine) setAnnounce(m.kind === 'coupon' ? t('social.coupon.received') : `${name}: ${m.text ?? ''}`);
    }
  }, [th.messages, name, t]);

  const act = async (url: string, body: unknown, after?: () => void) => {
    setBusy(true); setError(null); setInfo(null);
    const r = await call(url, body);
    setBusy(false);
    if (!r.ok) setError(errText(r.error)); else after?.();
    stick.current = true;
    await reload();
    return r;
  };
  const send = async () => {
    const m = text.trim();
    if (!m) return;
    await act('/api/guest/social-thread-send', { threadId: th.id, text: m }, () => setText(''));
  };
  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
  };
  const sendCoupon = async () => {
    if (!kind) return;
    await act('/api/guest/social-coupon-send', { threadId: th.id, kind }, () => { setLeft((n) => Math.max(0, n - 1)); setInfo(t('social.thread.couponSent')); setCouponOpen(false); setKind(null); });
  };
  const cancelCoupon = async (c: CouponView) => {
    if (!(await ask({ title: t('social.coupon.cancel'), body: t('social.coupon.cancelConfirm'), confirmLabel: t('social.coupon.cancel'), danger: true }))) return;
    await act('/api/guest/social-coupon-cancel', { couponId: c.id });
  };
  const block = async () => {
    if (!(await ask({ title: t('social.thread.block'), body: t('social.thread.blockConfirm', { name }), confirmLabel: t('social.thread.block'), danger: true }))) return;
    const r = await call('/api/guest/social-block', { target: th.peer.id });
    if (r.ok) router.replace('/stay/social?tab=private'); else setError(errText(r.error));
  };
  const report = async (reason: ReportReason): Promise<string | null> => {
    const r = await call('/api/guest/social-report-private', { threadId: th.id, messageId: reporting, reason });
    if (r.ok) { setInfo(t('social.chat.reportThanks')); return null; }
    return errText(r.error);
  };

  const rows: React.ReactNode[] = [];
  // messaggi e sfide in un'unica sequenza per tempo: separatore del giorno per entrambi, raggruppamento solo tra messaggi
  const timeline = [
    ...th.messages.map((m) => ({ at: m.createdAt, m, c: null as ChallengeView | null })),
    ...chs.map((c) => ({ at: c.createdAt, m: null as ThreadDetail['messages'][number] | null, c })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  timeline.forEach((it, i) => {
    const before = timeline[i - 1];
    const newDay = !before || dayKeyOf(before.at, timezone) !== dayKeyOf(it.at, timezone);
    if (newDay) rows.push(<div key={`d-${it.m?.id ?? it.c!.id}`} className="date-sep">{dayLabel(it.at, locale, timezone)}</div>);
    if (it.c) {
      rows.push(<ChallengeCard key={`c-${it.c.id}`} c={it.c} timezone={timezone} onChanged={() => { stick.current = true; void reload(); }} />);
      return;
    }
    const m = it.m!;
    const prev = before?.m;
    const grouped = !newDay && !!prev && prev.kind === 'text' && m.kind === 'text' && prev.mine === m.mine && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
    if (m.kind === 'coupon' && m.coupon) {
      const c = m.coupon;
      const sent = c.direction === 'sent';
      const kindLabel = t(`social.coupon.kinds.${c.kind}`);
      const dead = c.status === 'redeemed' || c.status === 'expired' || c.status === 'void';
      rows.push(
        <div key={m.id} className={`ticket ticket-compact ${sent ? 'ticket-mine' : 'ticket-theirs'} ${dead ? (c.status === 'redeemed' ? 'ticket-used' : 'ticket-expired') : ''}`}>
          <div className="ticket-body">
            <span className="ticket-title">{sent ? t('social.coupon.toPeer', { kind: kindLabel, name }) : t('social.coupon.fromPeer', { kind: kindLabel, name })}</span>
            <span className="ticket-meta">
              {c.status === 'issued' ? t('social.coupon.validUntil', { when: formatDateTime(c.expiresAt, locale, timezone) }) : c.status === 'redeemed' && c.redeemedAt ? formatDateTime(c.redeemedAt, locale, timezone) : t('social.coupon.onlyHotel')}
            </span>
          </div>
          <div className="ticket-side">
            <span className={`badge ${c.status === 'issued' ? 'badge-info' : c.status === 'redeemed' ? 'badge-ok' : 'badge-warn'}`}>
              {c.status === 'redeemed' && <Icon name="check" />}{t(`social.coupon.status.${c.status}`)}
            </span>
            {c.status === 'issued' && !sent && <button type="button" className="btn btn-primary btn-small" onClick={() => setShowQr(c.id)}>{t('social.coupon.show')}</button>}
            {c.status === 'issued' && sent && <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => void cancelCoupon(c)}>{t('social.coupon.cancel')}</button>}
          </div>
        </div>,
      );
    } else if (m.mine) {
      rows.push(<div key={m.id} className={`bubble bubble-me${grouped ? ' bubble-cont' : ''}`}>{m.text}<span className="time">{chatTime(m.createdAt, locale, timezone)}</span></div>);
    } else {
      rows.push(
        <div key={m.id} className={`msg msg-other${grouped ? ' msg-cont' : ''}`}>
          {grouped ? <span className="msg-gap" /> : <span className="avatar" aria-hidden="true">{[...name][0] ?? '?'}</span>}
          <div className="bubble bubble-other">
            {!grouped && <span className="who">{name}</span>}
            {m.text}
            <span className="time">{chatTime(m.createdAt, locale, timezone)}</span>
          </div>
          <ActionMenu label={t('social.chat.moreAbout', { name })} items={[{ key: 'rep', label: t('social.chat.report'), icon: 'flag', onSelect: () => { setInfo(null); setReporting(m.id); } }]} />
        </div>,
      );
    }
  });

  return (
    <>
      <div className="row row-nowrap thread-head">
        <Link className="icon-btn icon-btn-plain" href="/stay/social?tab=private" aria-label={t('social.thread.back')}><Icon name="back" /></Link>
        <h1 className="grow truncate">{t('social.thread.title', { name })}</h1>
        <ActionMenu label={t('social.chat.moreAbout', { name })} items={[{ key: 'block', label: t('social.thread.block'), icon: 'ban', danger: true, onSelect: () => void block() }]} />
      </div>

      {th.status === 'pending' && !th.incoming && <p className="notice notice-info" role="status"><Icon name="clock" />{t('social.thread.pendingMine', { name })}</p>}
      {th.status === 'pending' && th.incoming && <p className="notice notice-info" role="status"><Icon name="info" />{t('social.thread.pendingTheirs', { name })}</p>}
      {th.status === 'declined' && <p className="notice notice-warn" role="status"><Icon name="info" />{t('social.thread.declined')}</p>}
      {th.status === 'accepted' && !th.canSend && <p className="notice notice-warn" role="status"><Icon name="info" />{t('social.thread.unavailable')}</p>}

      <div className="chat" role="log" aria-label={t('social.thread.title', { name })}>{rows}<div ref={end} /></div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announce}</div>

      {showQr && (() => {
        const c = th.messages.find((m) => m.coupon?.id === showQr)?.coupon;
        return <CouponQr threadId={th.id} couponId={showQr} kindLabel={c ? t(`social.coupon.kinds.${c.kind}`) : ''} onClose={() => { setShowQr(null); void reload(); }} />;
      })()}

      {th.canRespond && (
        <div className="decision card stack-sm">
          <p><strong>{t('social.thread.decide', { name })}</strong></p>
          <div className="btn-group">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act('/api/guest/social-thread-respond', { threadId: th.id, accept: true }).then(() => badge.reload())}>{t('social.private.accept')}</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void act('/api/guest/social-thread-respond', { threadId: th.id, accept: false }).then(() => badge.reload())}>{t('social.private.decline')}</button>
          </div>
        </div>
      )}

      {info && <p className="notice notice-ok" role="status"><Icon name="check" />{info}</p>}
      {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}

      {th.canSendCoupon && (
        <section className="stack-sm" aria-label={t('social.thread.couponsTitle')}>
          <div className="btn-group">
            <button type="button" className="btn btn-secondary btn-small" aria-expanded={couponOpen} aria-controls="cp-panel" onClick={() => setCouponOpen((o) => !o)}>
              <Icon name="ticket" />{t('social.thread.couponsTitle')}
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setChallenging(true)}>
              <Icon name="trophy" />{t('challenge.button')}
            </button>
          </div>
          {couponOpen && (
            <div className="card stack" id="cp-panel">
              <p className="hint">{t('social.thread.couponsNote')}</p>
              <div className="chips" role="group" aria-label={t('social.thread.couponsTitle')}>
                {COUPON_KINDS.map((k) => (
                  <button key={k} type="button" className="chip" aria-pressed={kind === k} disabled={busy || left <= 0} onClick={() => setKind(k)}>{t(`social.coupon.kinds.${k}`)}</button>
                ))}
              </div>
              <p className="muted small">{t('social.thread.couponsLeft', { n: left })}</p>
              <button type="button" className="btn btn-cta" disabled={busy || !kind || left <= 0} aria-busy={busy} onClick={() => void sendCoupon()}>{t('social.thread.couponSend')}</button>
            </div>
          )}
        </section>
      )}

      {th.canSend && (
        <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <label htmlFor="pm" className="sr-only">{t('social.thread.placeholder')}</label>
          <textarea id="pm" className="composer-text" rows={1} maxLength={280} placeholder={t('social.thread.placeholder')} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} autoComplete="off" />
          <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()} aria-busy={busy}>{t('common.send')}</button>
        </form>
      )}
      <ReportDialog open={reporting !== null} onClose={() => setReporting(null)} onSend={report} defaultReason="harassment" />
      <ChallengeDialog open={challenging} threadId={th.id} onClose={() => setChallenging(false)}
        onSent={() => { setChallenging(false); stick.current = true; void reload(); }} />
    </>
  );
}
