'use client';
// Provider i18n lato client: riceve i messaggi di UNA sola lingua dal server.
// Contiene anche il provider delle conferme (ConfirmDialog accessibile al posto di window.confirm).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { hasKey, translateTree, type Vars } from '@/lib/i18n/core';
import type { Locale } from '@/lib/types';
import { Dialog } from './ui/Dialog';

interface Ctx {
  locale: Locale;
  t: (key: string, vars?: Vars) => string;
  has: (key: string) => boolean;
}
const I18nCtx = createContext<Ctx | null>(null);

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
}
type AskFn = (o: ConfirmOptions) => Promise<boolean>;
const ConfirmCtx = createContext<AskFn | null>(null);

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: unknown; children: ReactNode }) {
  const value = useMemo<Ctx>(
    () => ({ locale, t: (key, vars) => translateTree(messages, key, vars), has: (key) => hasKey(messages, key) }),
    [locale, messages],
  );
  return (
    <I18nCtx.Provider value={value}>
      <ConfirmHost>{children}</ConfirmHost>
    </I18nCtx.Provider>
  );
}

export function useI18n(): Ctx {
  const c = useContext(I18nCtx);
  if (!c) throw new Error('I18nProvider mancante');
  return c;
}

/**
 * Messaggio d'errore leggibile: scope.errors.<codice>, poi errors.<codice>, poi errore generico.
 * La funzione restituita e' STABILE finche' non cambia la lingua (F-01): prima era nuova a ogni render e,
 * messa fra le dipendenze di un useCallback/useEffect, faceva richiamare l'API all'infinito.
 */
export function useErrorText() {
  const { t, has } = useI18n();
  return useCallback(
    (error: string | undefined, scope?: string): string => {
      if (error && scope && has(`${scope}.errors.${error}`)) return t(`${scope}.errors.${error}`);
      if (error && has(`errors.${error}`)) return t(`errors.${error}`);
      if (error && has(`onboarding.errors.${error}`)) return t(`onboarding.errors.${error}`);
      return t('common.genericError');
    },
    [t, has],
  );
}

/** Conferma accessibile: `const ask = useConfirm(); if (await ask({ title, body, danger: true })) ...` */
export function useConfirm(): AskFn {
  const f = useContext(ConfirmCtx);
  if (!f) throw new Error('I18nProvider mancante');
  return f;
}

function ConfirmHost({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions } | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const ask = useCallback<AskFn>((opts) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setState({ opts });
  }), []);
  const done = useCallback((v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setState(null);
  }, []);
  useEffect(() => () => { resolver.current?.(false); }, []);
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <ConfirmDialogView state={state} onDone={done} />
    </ConfirmCtx.Provider>
  );
}

function ConfirmDialogView({ state, onDone }: { state: { opts: ConfirmOptions } | null; onDone: (v: boolean) => void }) {
  const { t } = useI18n();
  const o = state?.opts;
  return (
    <Dialog open={!!o} onClose={() => onDone(false)} title={o?.title ?? ''}>
      {o?.body && <p>{o.body}</p>}
      <div className="btn-group dialog-actions">
        <button type="button" className={`btn ${o?.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => onDone(true)}>{o?.confirmLabel ?? t('common.confirm')}</button>
        <button type="button" className="btn btn-secondary" onClick={() => onDone(false)}>{t('common.cancel')}</button>
      </div>
    </Dialog>
  );
}
