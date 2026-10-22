'use client';
import { useEffect, useRef } from 'react';

/** Ultimo valore, senza far ripartire gli effetti che lo leggono (evita dipendenze instabili). */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Polling unico per tutta l'app: si ferma a scheda nascosta o offline, riparte subito al ritorno in primo piano,
 * backoff (fino a x4) se `fn` restituisce false. `fn` e' letta da un ref: non entra nelle dipendenze.
 */
export function usePolling(fn: () => Promise<boolean | void> | boolean | void, intervalMs: number, enabled = true) {
  const latest = useLatest(fn);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let factor = 1;
    const tick = async () => {
      if (stopped) return;
      if (typeof document !== 'undefined' && document.hidden) { schedule(); return; }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { schedule(); return; }
      let ok: boolean | void = true;
      try { ok = await latest.current(); } catch { ok = false; }
      factor = ok === false ? Math.min(4, factor * 2) : 1;
      schedule();
    };
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(tick, intervalMs * factor);
    };
    const onVisible = () => {
      if (!document.hidden) { if (timer) clearTimeout(timer); void tick(); }
    };
    document.addEventListener('visibilitychange', onVisible);
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, enabled, latest]);
}

/** Vero se il contenitore con scroll (o la finestra) e' gia' vicino al fondo: serve a non strappare chi sta rileggendo. */
export function nearBottom(px = 120): boolean {
  const el = document.scrollingElement ?? document.documentElement;
  return el.scrollHeight - el.scrollTop - el.clientHeight < px;
}

/** Porta la pagina in fondo (stesso riferimento di nearBottom): l'ultimo messaggio e cio' che sta sotto la chat restano sopra la barra di scrittura. */
export function scrollToBottom(): void {
  const el = document.scrollingElement ?? document.documentElement;
  el.scrollTop = el.scrollHeight;
}

/** localStorage sicuro: puo' mancare o lanciare (finestra privata, dati bloccati). Solo comodita' per-dispositivo. */
export const safeStore = {
  get(key: string): string | null {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { window.localStorage.setItem(key, value); } catch { /* ignorato */ }
  },
};
