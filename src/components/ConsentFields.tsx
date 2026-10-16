'use client';
import { useI18n } from './I18n';

export interface SocialConsents { list: boolean; chat: boolean; dm: boolean }
export const NO_CONSENTS: SocialConsents = { list: false, chat: false, dm: false };

/**
 * Tre consensi SEPARATI e mai precompilati per le funzioni sociali: elenco ospiti, chat comune, messaggi privati.
 * Chat e privati richiedono di comparire nell'elenco (il dominio le lega all'opt-in): finche' l'elenco non e' scelto
 * restano spente e disabilitate, con la spiegazione. Per i minorenni sono tutte disabilitate.
 */
export function ConsentFields({ value, onChange, adult, idPrefix, disabled }: { value: SocialConsents; onChange: (v: SocialConsents) => void; adult: boolean; idPrefix: string; disabled?: boolean }) {
  const { t } = useI18n();
  const off = !adult || !!disabled;
  const set = (k: keyof SocialConsents, v: boolean) => {
    const next = { ...value, [k]: v };
    if (k === 'list' && !v) { next.chat = false; next.dm = false; }
    onChange(next);
  };
  const row = (k: keyof SocialConsents, locked: boolean) => (
    <label className="check" key={k}>
      <input type="checkbox" id={`${idPrefix}-${k}`} checked={value[k]} disabled={off || locked} aria-describedby={`${idPrefix}-${k}-hint`} onChange={(e) => set(k, e.target.checked)} />
      <span>
        {t(`consent.${k}.label`)}
        <span className="hint block" id={`${idPrefix}-${k}-hint`}>{t(`consent.${k}.hint`)}</span>
      </span>
    </label>
  );
  return (
    <fieldset className="fieldset">
      <legend>{t('consent.title')}</legend>
      <p className="hint">{adult ? t('consent.intro') : t('consent.adultOnly')}</p>
      {row('list', false)}
      {row('chat', !value.list)}
      {row('dm', !value.list)}
      {adult && !value.list && <p className="hint">{t('consent.needList')}</p>}
    </fieldset>
  );
}
