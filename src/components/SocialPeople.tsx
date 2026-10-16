'use client';
import { useCallback, useState } from 'react';
import type { GuestListItem, SocialSettings } from '@/lib/types';
import { LOCALE_NAMES } from '@/lib/types';
import { call } from './client-api';
import { usePolling } from './hooks';
import { useConfirm, useErrorText, useI18n } from './I18n';
import { Flag } from './LangFlags';
import { useSocialBadge } from './SocialBadge';
import { ActionMenu } from './ui/ActionMenu';
import { Icon } from './ui/Icon';
import { EmptyState, ErrorState } from './ui/States';

/** Elenco ospiti visibili: solo nickname e lingua (mai camera, cognome, date). Il primo messaggio e' una richiesta da accettare. */
export function SocialPeople({ hotelName, settings, onGoChat, onGoPrivate }: { hotelName: string; settings: SocialSettings; onGoChat: () => void; onGoPrivate: () => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const ask = useConfirm();
  const badge = useSocialBadge();
  const [list, setList] = useState<GuestListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [left, setLeft] = useState(settings.limits.newContactsLeftToday);
  const max = settings.limits.messageMax;

  // un solo caricamento all'apertura e poi ogni 15 s: un nuovo ospite compare senza cambiare scheda (F-01, F-19)
  const load = useCallback(async () => {
    const r = await call('/api/guest/social-guests');
    if (r.ok) { setList(r.guests as GuestListItem[]); setLoadError(null); } else setLoadError(r.error ?? 'network');
    return r.ok;
  }, []);
  usePolling(load, 15_000);

  const send = async (g: GuestListItem) => {
    setBusy(true); setError(null); setInfo(null);
    const r = await call('/api/guest/social-thread-start', { to: g.id, text });
    setBusy(false);
    if (!r.ok) { setError(errText(r.error)); if (r.error === 'thread_exists') setWriting(null); return; }
    setWriting(null); setText(''); setLeft((n) => Math.max(0, n - 1)); setInfo(t('social.people.requestSent'));
    void badge.reload();
  };
  const block = async (g: GuestListItem) => {
    if (!(await ask({ title: t('social.people.block'), body: t('social.people.blockConfirm', { name: g.nickname }), confirmLabel: t('social.people.block'), danger: true }))) return;
    const r = await call('/api/guest/social-block', { target: g.id });
    if (!r.ok) setError(errText(r.error));
    void load();
  };

  return (
    <section className="stack" aria-labelledby="pp-h">
      <div>
        <h2 id="pp-h" className="t-sub">{t('social.people.title', { hotel: hotelName })}</h2>
        <p className="muted small">{t('social.people.hint')}</p>
      </div>
      {info && (
        <p className="notice notice-ok" role="status">
          <Icon name="check" /><span className="grow">{t('social.people.requestSent')}</span>
          <button type="button" className="btn btn-ghost btn-small" onClick={onGoPrivate}>{t('social.people.seePrivate')}</button>
        </p>
      )}
      {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
      {loadError && <ErrorState text={errText(loadError)} onRetry={() => void load()} />}
      {!list && !loadError && <div className="stack" aria-busy="true"><span className="skeleton sk-64" /><span className="skeleton sk-64" /></div>}
      {list && list.length === 0 && (
        <EmptyState icon="users" title={t('social.people.emptyTitle')} text={t('social.people.empty')} action={{ label: t('social.people.goChat'), onClick: onGoChat }} />
      )}
      {list && list.length > 0 && (
        <>
          <p className="muted small">{t('social.people.contactsLeft', { n: left, max: settings.limits.newContactsPerDay })}</p>
          <div className="people" role="list">
            {list.map((g) => (
              <div key={g.id} className="person-block" role="listitem">
                <div className="person">
                  <span className="avatar" aria-hidden="true">{[...g.nickname][0] ?? '?'}</span>
                  <div className="person-main">
                    <span className="person-name">{g.nickname}</span>
                    <span className="person-meta" lang={g.locale}><Flag locale={g.locale} size="sm" />{LOCALE_NAMES[g.locale]}</span>
                  </div>
                  <div className="person-actions">
                    {g.canMessage
                      ? <button type="button" className="btn btn-secondary btn-small" aria-expanded={writing === g.id} aria-controls={`req-${g.id}`} aria-label={`${t('social.people.write')}: ${g.nickname}`}
                          onClick={() => { setWriting(writing === g.id ? null : g.id); setText(''); setError(null); }}>{t('social.people.write')}</button>
                      : <span className="person-note">{t('social.people.noPrivate')}</span>}
                    <ActionMenu label={t('social.people.moreAbout', { name: g.nickname })} items={[{ key: 'block', label: t('social.people.block'), icon: 'ban', danger: true, onSelect: () => void block(g) }]} />
                  </div>
                </div>
                {writing === g.id && (
                  <form className="person-form stack-sm" id={`req-${g.id}`} onSubmit={(e) => { e.preventDefault(); void send(g); }}>
                    <p className="hint">{t('social.people.firstMessageHint', { name: g.nickname })}</p>
                    <label htmlFor={`rq-${g.id}`} className="sr-only">{t('social.people.write')}</label>
                    <textarea id={`rq-${g.id}`} maxLength={max} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
                    <div className="row-between">
                      <span className="muted small">{t('social.chat.charsLeft', { n: max - [...text].length })}</span>
                      <button type="submit" className="btn btn-primary btn-small" disabled={busy || !text.trim()} aria-busy={busy}>{t('social.people.sendRequest')}</button>
                    </div>
                  </form>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
