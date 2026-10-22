'use client';
import { useEffect } from 'react';

/** Allinea <html lang> alla lingua mostrata. Il layout radice la ricava da cookie o browser; le pagine ospite usano la
 *  lingua del profilo, che senza cookie (nuovo accesso, altro dispositivo) puo' essere diversa. Serve a lettori di schermo
 *  e sillabazione (hyphens: auto). */
export function HtmlLang({ locale }: { locale: string }) {
  useEffect(() => {
    const el = document.documentElement;
    const before = el.lang;
    el.lang = locale;
    // uscendo dalle pagine ospite (es. /privacy) torna la lingua del layout radice
    return () => { el.lang = before; };
  }, [locale]);
  return null;
}
