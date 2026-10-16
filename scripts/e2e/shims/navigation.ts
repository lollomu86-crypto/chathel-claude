// Sostituto di next/navigation per il harness e2e (NON e' Next). Isomorfico: sul server solo redirect().
import { useSyncExternalStore } from 'react';

export class RedirectError extends Error {
  digest = 'NEXT_REDIRECT';
  constructor(public url: string) { super('NEXT_REDIRECT'); }
}
export function redirect(url: string): never { throw new RedirectError(url); }

type W = { __chNavigate?: (url: string, replace?: boolean) => void; __chRefresh?: () => void };
const w = (): W => (typeof window === 'undefined' ? {} : (window as unknown as W));

// oggetto STABILE come in Next: useRouter() restituisce sempre la stessa identita'
const router = {
  push: (u: string) => w().__chNavigate?.(u),
  replace: (u: string) => w().__chNavigate?.(u, true),
  refresh: () => w().__chRefresh?.(),
  back: () => history.back(),
  forward: () => history.forward(),
  prefetch: () => undefined,
};
export function useRouter() { return router; }

const sub = (cb: () => void) => { window.addEventListener('ch:nav', cb); window.addEventListener('popstate', cb); return () => { window.removeEventListener('ch:nav', cb); window.removeEventListener('popstate', cb); }; };
export function usePathname() { return useSyncExternalStore(sub, () => location.pathname, () => '/'); }
