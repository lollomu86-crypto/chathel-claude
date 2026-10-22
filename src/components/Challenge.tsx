'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { pick } from '@/lib/format';
import { CHALLENGE_STAKES, type ChallengeStake, type ChallengeView, type GameView, type SocialSettings, type ThreadSummary } from '@/lib/types';
import { call } from './client-api';
import { chatTime } from './format-ui';
import { useConfirm, useErrorText, useI18n } from './I18n';
import { Dialog } from './ui/Dialog';
import { Icon } from './ui/Icon';

const MINUTES = [15, 30, 60, 120] as const;

/** Sfida come card dentro una chat (pubblica o privata): chi sfida, chi gioca, gioco, orario, posta e azioni. */
export function ChallengeCard({ c, timezone, onChanged }: { c: ChallengeView; timezone: string; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const errText = useErrorText();
  const ask = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const game = pick(c.game, locale);
  const time = chatTime(c.startsAt, locale, timezone);
  // "Tu contro Bruno", "Marco contro te", "Marco ti sfida", "Hai sfidato tutti"...
  const title = c.status === 'accepted' && c.opponent
    ? t('challenge.versus', { a: c.mine ? t('challenge.youShort') : c.challenger.nickname, b: c.meOpponent ? t('challenge.you') : c.opponent.nickname, game })
    : c.mine
      ? (c.opponent ? t('challenge.titleMinePrivate', { name: c.opponent.nickname, game }) : t('challenge.titleMinePublic', { game }))
      : (c.meOpponent ? t('challenge.titleTheirsPrivate', { name: c.challenger.nickname, game }) : t('challenge.titleTheirsPublic', { name: c.challenger.nickname, game }));
  const badge = c.status === 'open' ? 'badge-info' : c.status === 'accepted' ? 'badge-ok' : 'badge-warn';

  const act = async (url: string, body: unknown) => {
    setBusy(true); setError(null);
    const r = await call(url, body);
    setBusy(false);
    if (!r.ok) setError(errText(r.error, 'challenge'));
    onChanged();
  };
  const cancel = async () => {
    if (!(await ask({ title: t('challenge.cancelConfirm'), confirmLabel: t('challenge.cancel'), danger: true }))) return;
    await act('/api/guest/social-challenge-cancel', { challengeId: c.id });
  };

  return (
    <article className={`challenge ${c.mine ? 'challenge-mine' : 'challenge-theirs'}${c.status === 'open' || c.status === 'accepted' ? '' : ' challenge-done'}`} aria-label={title}>
      <div className="challenge-head">
        <span className="challenge-icon" aria-hidden="true"><Icon name="trophy" /></span>
        <p className="challenge-title">{title}</p>
      </div>
      <p className="challenge-meta">
        <span><Icon name="clock" />{t('challenge.at', { time })}</span>
        <span>{t(`challenge.stakes.${c.stake}`)}</span>
      </p>
      <div className="challenge-foot">
        <span className={`badge ${badge}`}>{c.status === 'accepted' && <Icon name="check" />}{t(`challenge.status.${c.status}`)}</span>
        {(c.canAccept || c.canDecline || c.canCancel) && (
          <div className="btn-group">
            {c.canAccept && <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void act('/api/guest/social-challenge-respond', { challengeId: c.id, accept: true, threadId: c.threadId })}>{t('challenge.accept')}</button>}
            {c.canDecline && <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => void act('/api/guest/social-challenge-respond', { challengeId: c.id, accept: false, threadId: c.threadId })}>{t('challenge.decline')}</button>}
            {c.canCancel && <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => void cancel()}>{t('challenge.cancel')}</button>}
          </div>
        )}
      </div>
      {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
    </article>
  );
}

/**
 * Finestra per lanciare una sfida. `threadId` = sfida privata dentro quella conversazione; `publicOnly` = dalla chat pubblica;
 * senza nessuno dei due (pagina Giochi) l'ospite sceglie: a tutti nella chat dell'hotel, oppure a una persona con cui ha una chat aperta.
 */
export function ChallengeDialog({ open, onClose, onSent, gameId, threadId, publicOnly }: {
  open: boolean; onClose: () => void; onSent: (c: ChallengeView) => void; gameId?: string; threadId?: string; publicOnly?: boolean;
}) {
  const { t, locale } = useI18n();
  const errText = useErrorText();
  const [games, setGames] = useState<GameView[] | null>(null);
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [game, setGame] = useState(gameId ?? '');
  const [minutes, setMinutes] = useState<number>(15);
  const [stake, setStake] = useState<ChallengeStake>('coffee');
  const [target, setTarget] = useState<string>(threadId ?? 'public');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null); setLoadError(false); setGame(gameId ?? ''); setTarget(threadId ?? 'public');
    let alive = true;
    void (async () => {
      const [g, s] = await Promise.all([call('/api/guest/games'), call('/api/guest/social-threads')]);
      if (!alive) return;
      if (!g.ok) { setLoadError(true); return; }
      const list = g.games as GameView[];
      setGames(list);
      setGame((cur) => cur || list[0]?.id || '');
      if (s.ok) {
        setSettings(s.settings as SocialSettings);
        setThreads((s.threads as ThreadSummary[]).filter((x) => x.status === 'accepted'));
      } else setSettings(null);
    })();
    return () => { alive = false; };
  }, [open, gameId, threadId]);

  const canChallenge = !!settings && settings.visible && settings.rulesAccepted && !settings.muted && !settings.removed;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!game) return;
    setBusy(true); setError(null);
    const startsAt = new Date(Date.now() + minutes * 60_000).toISOString();
    const r = await call('/api/guest/social-challenge-create', { gameId: game, startsAt, stake, threadId: target === 'public' ? null : target });
    setBusy(false);
    if (r.ok) onSent(r.challenge as ChallengeView); else setError(errText(r.error, 'challenge'));
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('challenge.title')}>
      {loadError && <p className="error-text" role="alert"><Icon name="alert" />{t('common.genericError')}</p>}
      {!loadError && !games && <div className="stack" aria-busy="true"><span className="skeleton sk-48" /><span className="skeleton sk-48" /></div>}
      {games && games.length === 0 && <p className="muted">{t('challenge.noGames')}</p>}
      {games && games.length > 0 && !canChallenge && (
        <div className="stack-sm">
          <p>{t('challenge.needSocial')}</p>
          <Link className="btn btn-secondary" href="/stay/social?tab=settings" onClick={onClose}>{t('challenge.goSocial')}</Link>
        </div>
      )}
      {games && games.length > 0 && canChallenge && (
        <form className="form" onSubmit={send}>
          {!gameId && (
            <fieldset className="fieldset">
              <legend>{t('challenge.game')}</legend>
              <div className="chips">
                {games.map((g) => <button key={g.id} type="button" className="chip" aria-pressed={game === g.id} onClick={() => setGame(g.id)}>{pick(g.name, locale)}</button>)}
              </div>
            </fieldset>
          )}
          <fieldset className="fieldset">
            <legend>{t('challenge.when')}</legend>
            <div className="chips">
              {MINUTES.map((m) => <button key={m} type="button" className="chip" aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{t(`challenge.in${m}`)}</button>)}
            </div>
          </fieldset>
          <fieldset className="fieldset">
            <legend>{t('challenge.stake')}</legend>
            <div className="chips">
              {CHALLENGE_STAKES.map((s) => <button key={s} type="button" className="chip" aria-pressed={stake === s} onClick={() => setStake(s)}>{t(`challenge.stakes.${s}`)}</button>)}
            </div>
          </fieldset>
          {!threadId && !publicOnly && (
            <div className="field">
              <label htmlFor="ch-target">{t('challenge.where')}</label>
              <select id="ch-target" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="public">{t('challenge.wherePublic')}</option>
                {threads.map((th) => <option key={th.id} value={th.id}>{t('challenge.wherePrivate', { name: th.peer.nickname })}</option>)}
              </select>
              {threads.length === 0 && <p className="hint">{t('challenge.whereHint')}</p>}
            </div>
          )}
          {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !game} aria-busy={busy}><Icon name="trophy" />{t('challenge.send')}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
