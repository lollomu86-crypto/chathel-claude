'use client';
// Scheda "Ospiti": elenco, chat comune, conversazioni private, profilo social. La sottoscheda sta nell'indirizzo (?tab=).
// Tutto passa dalle API /api/guest/social-*; le regole (maggiorenni, opt-in, limiti) sono nel dominio, qui solo presentazione.
import { useCallback, useState } from 'react';
import type { SocialSettings } from '@/lib/types';
import { formatDateTime } from '@/lib/format';
import { call } from './client-api';
import { ConsentFields, NO_CONSENTS, type SocialConsents } from './ConsentFields';
import { useErrorText, useI18n } from './I18n';
import { SocialPeople } from './SocialPeople';
import { SocialPublicChat } from './SocialPublicChat';
import { SocialSettingsPanel } from './SocialSettingsPanel';
import { useSocialBadge } from './SocialBadge';
import { SocialThreads } from './SocialThreads';
import { Icon } from './ui/Icon';
import { Tabs } from './ui/Tabs';
import { SOCIAL_TABS, type SocialTab } from './social-tabs';


export function SocialClient({ initial, hotelName, timezone, initialTab }: { initial: SocialSettings; hotelName: string; timezone: string; initialTab: SocialTab }) {
  const { t, locale } = useI18n();
  const errText = useErrorText();
  const badge = useSocialBadge();
  const [settings, setSettings] = useState<SocialSettings>(initial);
  const [tab, setTab] = useState<SocialTab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consents, setConsents] = useState<SocialConsents>(NO_CONSENTS);

  const reload = useCallback(async () => {
    const r = await call('/api/guest/social-settings');
    if (r.ok) setSettings(r.settings as SocialSettings);
  }, []);

  const go = useCallback((id: string) => {
    setTab(id as SocialTab);
    window.history.replaceState(null, '', `/stay/social?tab=${id}`);
  }, []);

  const join = async () => {
    setBusy(true); setError(null);
    // prima i privati (se non consentiti si spengono mentre non si e' ancora visibili), poi l'elenco, poi le regole della chat
    let r = await call('/api/guest/social-settings-update', { acceptsPrivate: consents.dm });
    if (r.ok) r = await call('/api/guest/social-settings-update', { visible: true });
    if (r.ok && consents.chat) r = await call('/api/guest/social-rules', {});
    setBusy(false);
    if (r.ok) { setSettings(r.settings as SocialSettings); setConsents(NO_CONSENTS); void badge.reload(); } else { setError(errText(r.error)); void reload(); }
  };

  if (!settings.isAdult) {
    return (<><h1>{t('social.title')}</h1><p className="notice notice-info"><Icon name="info" />{t('social.optIn.minors')}</p></>);
  }
  if (settings.removed) {
    return (<><h1>{t('social.title')}</h1><p className="notice notice-warn"><Icon name="alert" />{t('social.optIn.removed')}</p></>);
  }
  if (!settings.visible) {
    return (
      <>
        <h1>{t('social.title')}</h1>
        <section className="card stack" aria-labelledby="oi">
          <h2 id="oi" className="t-sub">{t('social.optIn.title')}</h2>
          <p>{t('social.optIn.body')}</p>
          <ConsentFields value={consents} onChange={setConsents} adult idPrefix="gate" />
          {error && <p className="error-text" role="alert"><Icon name="alert" />{error}</p>}
          <button type="button" className="btn btn-primary" disabled={busy || !consents.list} aria-busy={busy} onClick={join}>{t('social.optIn.button')}</button>
        </section>
      </>
    );
  }

  const tabs = SOCIAL_TABS.map((x) => ({
    id: x,
    label: t(`social.tabs.${x}`),
    badge: x === 'private' ? badge.unread : undefined,
    badgeLabel: x === 'private' ? t('social.unreadCount', { n: badge.unread }) : undefined,
  }));
  return (
    <>
      <h1>{t('social.title')}</h1>
      {settings.muted && (
        <p className="notice notice-warn" role="status">
          <Icon name="alert" />{t('social.settings.muted', { when: settings.mutedUntil ? formatDateTime(settings.mutedUntil, locale, timezone) : '' })}
        </p>
      )}
      <Tabs tabs={tabs} active={tab} onChange={go} label={t('social.title')} idPrefix="soc">
        {tab === 'people' && <SocialPeople hotelName={hotelName} settings={settings} onGoChat={() => go('chat')} onGoPrivate={() => go('private')} />}
        {tab === 'chat' && <SocialPublicChat hotelName={hotelName} settings={settings} timezone={timezone} onChanged={reload} />}
        {tab === 'private' && <SocialThreads timezone={timezone} onGoPeople={() => go('people')} />}
        {tab === 'settings' && <SocialSettingsPanel settings={settings} onChanged={(s) => { setSettings(s); void badge.reload(); }} />}
      </Tabs>
    </>
  );
}
