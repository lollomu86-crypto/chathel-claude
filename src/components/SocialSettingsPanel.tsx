'use client';
import { useCallback, useEffect, useState } from 'react';
import type { SocialSettings } from '@/lib/types';
import { call } from './client-api';
import { useConfirm, useErrorText, useI18n } from './I18n';
import { Icon } from './ui/Icon';

/** Scelte modificabili in ogni momento: nome visibile, elenco, messaggi privati, regole della chat, persone bloccate. */
export function SocialSettingsPanel({ settings, onChanged }: { settings: SocialSettings; onChanged: (s: SocialSettings) => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const ask = useConfirm();
  const [nick, setNick] = useState(settings.nickname);
  const [blocked, setBlocked] = useState<{ id: string; nickname: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const loadBlocked = useCallback(async () => {
    const r = await call('/api/guest/social-blocked');
    if (r.ok) setBlocked(r.blocked as { id: string; nickname: string }[]);
    else setError(errText(r.error));
  }, [errText]);
  // una volta sola all'apertura: errText e' stabile ma non deve comunque far ripartire la richiesta
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadBlocked(); }, []);

  const update = async (body: Record<string, unknown>) => {
    setError(null); setInfo(null);
    const r = await call('/api/guest/social-settings-update', body);
    if (r.ok) { onChanged(r.settings as SocialSettings); setInfo(t('social.settings.saved')); } else setError(errText(r.error));
  };
  const unblock = async (id: string) => {
    const r = await call('/api/guest/social-unblock', { target: id });
    if (!r.ok) setError(errText(r.error));
    void loadBlocked();
  };
  const toggleVisible = async (v: boolean) => {
    if (!v && !(await ask({ title: t('social.settings.leaveTitle'), body: t('social.settings.leaveBody'), confirmLabel: t('social.settings.leaveConfirm'), danger: true }))) return;
    await update({ visible: v });
  };

  return (
    <section className="stack" aria-labelledby="ps-h">
      <h2 id="ps-h" className="t-sub">{t('social.settings.title')}</h2>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void update({ nickname: nick }); }}>
        <div className="field">
          <label htmlFor="nick">{t('social.settings.nickname')}</label>
          <input id="nick" type="text" minLength={2} maxLength={20} value={nick} aria-describedby="nick-h" onChange={(e) => setNick(e.target.value)} />
          <p className="hint" id="nick-h">{t('social.settings.nicknameHint')}</p>
        </div>
        <button type="submit" className="btn btn-secondary" disabled={nick.trim() === settings.nickname}>{t('social.settings.save')}</button>
      </form>

      <div className="card">
        <label className="setting">
          <span id="sv-l"><strong className="block">{t('social.settings.visible')}</strong><span className="hint block">{t('social.settings.visibleHint')}</span></span>
          <input type="checkbox" role="switch" className="switch" aria-labelledby="sv-l" checked={settings.visible} onChange={(e) => void toggleVisible(e.target.checked)} />
        </label>
        <label className="setting">
          <span id="sp-l"><strong className="block">{t('social.settings.acceptsPrivate')}</strong><span className="hint block">{t('social.settings.acceptsPrivateHint')}</span></span>
          <input type="checkbox" role="switch" className="switch" aria-labelledby="sp-l" checked={settings.acceptsPrivate} onChange={(e) => void update({ acceptsPrivate: e.target.checked })} />
        </label>
        <div className="setting">
          <span><strong className="block">{t('social.settings.chatRules')}</strong><span className="hint block">{settings.rulesAccepted ? t('social.settings.chatRulesYes') : t('social.settings.chatRulesNo')}</span></span>
          <span className={`badge ${settings.rulesAccepted ? 'badge-ok' : ''}`}>{settings.rulesAccepted ? <><Icon name="check" />{t('common.yes')}</> : t('common.no')}</span>
        </div>
      </div>

      {info && <p className="notice notice-ok" role="status"><Icon name="check" />{info}</p>}
      {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}

      <h3 className="t-sub section">{t('social.settings.blockedTitle')}</h3>
      {blocked.length === 0 && <p className="muted">{t('social.settings.noBlocked')}</p>}
      {blocked.map((b) => (
        <div key={b.id} className="row-between">
          <span>{b.nickname}</span>
          <button type="button" className="btn btn-secondary btn-small" aria-label={`${t('social.settings.unblock')}: ${b.nickname}`} onClick={() => void unblock(b.id)}>{t('social.settings.unblock')}</button>
        </div>
      ))}
    </section>
  );
}
