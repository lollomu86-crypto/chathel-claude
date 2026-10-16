'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicMessageView, ReportReason, SocialSettings } from '@/lib/types';
import { call } from './client-api';
import { dayKeyOf, dayLabel, chatTime } from './format-ui';
import { nearBottom, usePolling } from './hooks';
import { useConfirm, useErrorText, useI18n } from './I18n';
import { ReportDialog } from './ReportDialog';
import { ActionMenu } from './ui/ActionMenu';
import { Icon } from './ui/Icon';
import { EmptyState, ErrorState } from './ui/States';

/** Chat comune della struttura. Regole d'uso mostrate prima della prima scrittura; segnala e blocca su ogni messaggio altrui. */
export function SocialPublicChat({ hotelName, settings, timezone, onChanged }: { hotelName: string; settings: SocialSettings; timezone: string; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const errText = useErrorText();
  const ask = useConfirm();
  const [msgs, setMsgs] = useState<PublicMessageView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const known = useRef<Set<string> | null>(null);
  const stick = useRef(true);
  const max = settings.limits.messageMax;
  const canWrite = settings.rulesAccepted && !settings.muted;

  const load = useCallback(async () => {
    const r = await call('/api/guest/social-feed');
    if (r.ok) { stick.current = nearBottom(); setMsgs(r.messages as PublicMessageView[]); setLoadError(null); } else setLoadError(r.error ?? 'network');
    return r.ok;
  }, []);
  usePolling(load, 6000); // nessun realtime nel P0 demo

  useEffect(() => {
    if (!msgs) return;
    if (stick.current) end.current?.scrollIntoView({ block: 'end' });
    // lettori di schermo: si annunciano solo i messaggi NUOVI degli altri (la prima volta si memorizza lo storico senza leggerlo)
    if (known.current === null) { known.current = new Set(msgs.map((m) => m.id)); return; }
    for (const m of msgs) {
      if (known.current.has(m.id)) continue;
      known.current.add(m.id);
      if (!m.mine) setAnnounce(`${m.nickname}: ${m.text}`);
    }
  }, [msgs]);

  const acceptRules = async () => {
    const r = await call('/api/guest/social-rules', {});
    if (r.ok) onChanged(); else setError(errText(r.error));
  };
  const send = async () => {
    const m = text.trim();
    if (!m || busy) return;
    setBusy(true); setError(null); setInfo(null);
    const r = await call('/api/guest/social-post', { text: m });
    setBusy(false);
    if (r.ok) { stick.current = true; setText(''); setMsgs(r.messages as PublicMessageView[]); } else setError(errText(r.error));
  };
  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
  };
  const report = async (reason: ReportReason): Promise<string | null> => {
    const r = await call('/api/guest/social-report', { messageId: reporting, reason });
    if (r.ok) { setInfo(t('social.chat.reportThanks')); void load(); return null; }
    return errText(r.error);
  };
  const block = async (m: PublicMessageView) => {
    if (!(await ask({ title: t('social.chat.blockAuthor'), body: t('social.people.blockConfirm', { name: m.nickname }), confirmLabel: t('social.chat.blockAuthor'), danger: true }))) return;
    const r = await call('/api/guest/social-block', { target: m.authorId });
    if (r.ok) void load(); else setError(errText(r.error));
  };

  const rows: React.ReactNode[] = [];
  (msgs ?? []).forEach((m, i, all) => {
    const prev = all[i - 1];
    const newDay = !prev || dayKeyOf(prev.createdAt, timezone) !== dayKeyOf(m.createdAt, timezone);
    const grouped = !newDay && prev.authorId === m.authorId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
    if (newDay) rows.push(<div key={`d-${m.id}`} className="date-sep">{dayLabel(m.createdAt, locale, timezone)}</div>);
    if (m.mine) {
      rows.push(<div key={m.id} className="bubble bubble-me">{m.text}<span className="time">{chatTime(m.createdAt, locale, timezone)}</span></div>);
    } else {
      rows.push(
        <div key={m.id} className="msg msg-other">
          {grouped ? <span className="msg-gap" /> : <span className="avatar" aria-hidden="true">{[...m.nickname][0] ?? '?'}</span>}
          <div className="bubble bubble-other">
            {!grouped && <span className="who">{m.nickname}</span>}
            {m.text}
            <span className="time">{chatTime(m.createdAt, locale, timezone)}</span>
          </div>
          <ActionMenu label={t('social.chat.moreAbout', { name: m.nickname })} items={[
            m.reportedByMe
              ? { key: 'rep', label: t('social.chat.reported'), icon: 'flag', onSelect: () => undefined }
              : { key: 'rep', label: t('social.chat.report'), icon: 'flag', onSelect: () => { setInfo(null); setReporting(m.id); } },
            { key: 'blk', label: t('social.chat.blockAuthor'), icon: 'ban', danger: true, onSelect: () => void block(m) },
          ]} />
        </div>,
      );
    }
  });

  return (
    <section className="stack" aria-labelledby="pc-h">
      <h2 id="pc-h" className="t-sub">{t('social.chat.title', { hotel: hotelName })}</h2>
      {!settings.rulesAccepted && (
        <div className="card stack">
          <h3 className="t-sub">{t('social.chat.rulesTitle')}</h3>
          <p>{t('social.chat.rules')}</p>
          <button type="button" className="btn btn-primary" onClick={acceptRules}>{t('social.chat.rulesAccept')}</button>
        </div>
      )}
      {loadError && <ErrorState text={errText(loadError)} onRetry={() => void load()} />}
      {!msgs && !loadError && <div className="stack" aria-busy="true"><span className="skeleton sk-48" /><span className="skeleton sk-48" /></div>}
      {msgs && msgs.length === 0 && <EmptyState icon="chat" title={t('social.chat.emptyTitle')} text={t('social.chat.empty')} />}
      {msgs && msgs.length > 0 && <div className="chat" role="log" aria-label={t('social.chat.title', { hotel: hotelName })}>{rows}<div ref={end} /></div>}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announce}</div>
      {info && <p className="notice notice-ok" role="status"><Icon name="check" />{info}</p>}
      {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label htmlFor="pub" className="sr-only">{t('social.chat.placeholder')}</label>
        <textarea id="pub" className="composer-text" rows={1} maxLength={max} placeholder={t('social.chat.placeholder')} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} autoComplete="off" disabled={!canWrite} />
        <button type="submit" className="btn btn-primary" disabled={busy || !text.trim() || !canWrite} aria-busy={busy}>{t('common.send')}</button>
      </form>
      <p className="muted small">{t('social.chat.charsLeft', { n: max - [...text].length })}</p>
      <ReportDialog open={reporting !== null} onClose={() => setReporting(null)} onSend={report} />
    </section>
  );
}
