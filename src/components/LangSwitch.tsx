'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/types';
import { call, setLangCookie } from './client-api';
import { useI18n } from './I18n';
import { Flag } from './LangFlags';

/**
 * Selettore lingua a bandiere (it, en, de, ru), ordine fisso. La bandiera e' decorativa: il nome della lingua,
 * nella lingua stessa, e' sempre il nome accessibile (testo visibile o aria-label).
 *  - variant "inline": gruppo di quattro pulsanti radio (ingresso, profilo);
 *  - variant "compact": un pulsante bandiera+codice con menu (testate).
 */
export function LangSwitch({ variant = 'inline', saveToProfile = false }: { variant?: 'inline' | 'compact'; saveToProfile?: boolean }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  const choose = async (l: Locale) => {
    setOpen(false);
    if (l === locale) { btn.current?.focus(); return; }
    setLangCookie(l);
    if (saveToProfile) await call('/api/guest/locale', { locale: l });
    router.refresh();
  };

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    const onDoc = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const moveFocus = (e: React.KeyboardEvent<HTMLElement>, selector: string, activate: boolean) => {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const all = Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>(selector) ?? []);
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    const next = all[(i + (fwd ? 1 : -1) + all.length) % all.length];
    next?.focus();
    if (activate) next?.click();
  };

  if (variant === 'compact') {
    return (
      <div className="lang-compact" ref={wrap} onKeyDown={(e) => {
        if (e.key === 'Escape' && open) { setOpen(false); btn.current?.focus(); }
        else if (open) moveFocus(e, '[role="menuitemradio"]', false);
      }}>
        <button ref={btn} type="button" className="lang-compact-btn" aria-haspopup="menu" aria-expanded={open}
          aria-label={`${t('common.language')}: ${LOCALE_NAMES[locale]}`} onClick={() => setOpen((o) => !o)}>
          <Flag locale={locale} />
          <span aria-hidden="true">{locale.toUpperCase()}</span>
        </button>
        {open && (
          <div className="menu lang-menu" role="menu" aria-label={t('common.language')}>
            {LOCALES.map((l) => (
              <button key={l} type="button" role="menuitemradio" aria-checked={l === locale} lang={l} aria-label={LOCALE_NAMES[l]} onClick={() => choose(l)}>
                <Flag locale={l} size="lg" />
                <span>{LOCALE_NAMES[l]}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="lang" role="radiogroup" aria-label={t('common.language')} ref={wrap} onKeyDown={(e) => moveFocus(e, '[role="radio"]', true)}>
      {LOCALES.map((l) => (
        <button key={l} type="button" role="radio" aria-checked={l === locale} tabIndex={l === locale ? 0 : -1} className="lang-opt" lang={l} aria-label={LOCALE_NAMES[l]} onClick={() => choose(l)}>
          <Flag locale={l} size="lg" />
          <span>{LOCALE_NAMES[l]}</span>
        </button>
      ))}
    </div>
  );
}
