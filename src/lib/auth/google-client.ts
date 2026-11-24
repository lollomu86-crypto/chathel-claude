// Lato CLIENT (browser) dell'accesso con Google. Nessun import server: questo file puo' essere usato dai componenti.
//
// NON VERIFICATO: richiede un progetto Supabase con il provider Google abilitato (client id/secret di Google Cloud,
// URI di redirect autorizzati) e `@supabase/supabase-js` nel browser. Scritto sulla documentazione di supabase-js v2.
//
// Flusso:
//  1. il componente crea il client Supabase del browser (createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY));
//  2. chiama `signInWithGoogle(client, redirectTo)`: redirect a Google;
//  3. al ritorno, nella pagina di callback: `finishGoogleLogin(client)` legge la sessione e la invia al server
//     (POST /api/identity/session). Il server la verifica e imposta il cookie HttpOnly di identita'; i token non restano nel browser.
//  4. il browser chiama poi POST /api/onboarding con il QR dell'hotel.
// Il redirectTo deve riportare allo stesso /h/<slug>?k=<codice> da cui si e' partiti.

export interface BrowserAuthClient {
  auth: {
    signInWithOAuth(args: {
      provider: 'google';
      options?: { redirectTo?: string; scopes?: string; queryParams?: Record<string, string> };
    }): Promise<{ error: { message: string } | null }>;
    getSession(): Promise<{ data: { session: { access_token: string; refresh_token: string } | null } }>;
    signOut?(opts?: { scope: 'local' | 'global' | 'others' }): Promise<unknown>;
  };
}

export function googleSignInArgs(redirectTo: string) {
  return {
    provider: 'google' as const,
    options: {
      redirectTo,
      // minimo indispensabile: identificativo e nome. (Supabase puo' richiedere comunque l'e-mail per creare l'utente.)
      scopes: 'openid profile',
      queryParams: { prompt: 'select_account' },
    },
  };
}

export async function signInWithGoogle(client: BrowserAuthClient, redirectTo: string): Promise<{ error: string | null }> {
  const { error } = await client.auth.signInWithOAuth(googleSignInArgs(redirectTo));
  return { error: error?.message ?? null };
}

/** Da chiamare al ritorno da Google: passa i token al server e li toglie dal browser. */
export async function finishGoogleLogin(
  client: BrowserAuthClient,
  post: (url: string, body: unknown) => Promise<{ ok: boolean; error?: string }>,
): Promise<{ ok: boolean; error?: string }> {
  const { data } = await client.auth.getSession();
  const s = data.session;
  if (!s) return { ok: false, error: 'no_session' };
  const r = await post('/api/identity/session', { accessToken: s.access_token, refreshToken: s.refresh_token });
  // il server ha il cookie HttpOnly: il browser non deve conservare i token.
  // NON si chiama signOut(): anche con scope 'local' Supabase CANCELLA la sessione sul server, cioe' quella appena
  // consegnata al server (poi getUser risponderebbe 403 "Session not found" e l'ospite tornerebbe al login).
  // Si tolgono quindi solo le chiavi locali di supabase-js, senza nessuna chiamata di rete.
  clearLocalAuthStorage();
  return r;
}

/** Toglie da localStorage/sessionStorage la sessione e il verificatore PKCE di supabase-js (chiavi `sb-<ref>-auth-token*`). */
export function clearLocalAuthStorage(): void {
  for (const st of [() => globalThis.localStorage, () => globalThis.sessionStorage]) {
    try {
      const store = st();
      if (!store) continue;
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && /^sb-.*-auth-token/.test(k)) keys.push(k);
      }
      for (const k of keys) store.removeItem(k);
    } catch {
      /* archivio non disponibile (modalita' privata): nulla da togliere */
    }
  }
}

// ----------------------------------------------------------------------------- pulsante ufficiale di Google (GIS)
// Con il redirect OAuth (signInWithOAuth) Google mostra "continua su <progetto>.supabase.co", perche' il ritorno passa da
// Supabase. Con Google Identity Services il pulsante e la scelta dell'account stanno sul NOSTRO dominio: Google mostra
// "continua su chathel.it". Il token di Google (ID token) passa poi a Supabase con signInWithIdToken, che crea la stessa
// sessione di prima: il resto del flusso (server, cookie HttpOnly) non cambia.
// Richiede: GOOGLE_CLIENT_ID sul server (lo stesso client "ChatHel Web" gia' configurato in Supabase) e l'indirizzo del
// sito tra le "Origini JavaScript autorizzate" del client in Google Cloud. Senza, si usa il redirect di prima.

export interface IdTokenAuthClient extends BrowserAuthClient {
  auth: BrowserAuthClient['auth'] & {
    signInWithIdToken(args: { provider: 'google'; token: string; nonce?: string }): Promise<{ error: { message: string } | null }>;
  };
}

/** Le parti di `google.accounts.id` che usiamo. */
export interface GoogleIdApi {
  initialize(cfg: {
    client_id: string;
    callback: (r: { credential?: string }) => void;
    nonce?: string;
    ux_mode?: 'popup' | 'redirect';
    itp_support?: boolean;
    use_fedcm_for_button?: boolean;
    cancel_on_tap_outside?: boolean;
  }): void;
  renderButton(el: HTMLElement, opts: Record<string, string | number>): void;
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let gisPromise: Promise<GoogleIdApi | null> | null = null;

/** Carica una sola volta lo script di Google; null se non si carica (rete, blocco dei contenuti, browser interni alle app). */
export function loadGoogleIdentity(timeoutMs = 8000): Promise<GoogleIdApi | null> {
  type W = { google?: { accounts?: { id?: GoogleIdApi } } };
  const w = globalThis as unknown as W;
  if (w.google?.accounts?.id) return Promise.resolve(w.google.accounts.id);
  if (typeof document === 'undefined') return Promise.resolve(null);
  gisPromise ??= new Promise<GoogleIdApi | null>((resolve) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    const timer = setTimeout(() => resolve(null), timeoutMs);
    s.onload = () => { clearTimeout(timer); resolve(w.google?.accounts?.id ?? null); };
    s.onerror = () => { clearTimeout(timer); gisPromise = null; resolve(null); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

/** Nonce casuale: a Google va il suo SHA-256 (esadecimale), a Supabase quello in chiaro (come da documentazione Supabase). */
export function makeNonce(bytes = 32): string {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256Hex(s: string): Promise<string> {
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Dal token di Google alla sessione Supabase, poi al server come nel flusso con redirect. */
export async function finishIdTokenLogin(
  client: IdTokenAuthClient,
  credential: string,
  nonce: string,
  post: (url: string, body: unknown) => Promise<{ ok: boolean; error?: string }>,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await client.auth.signInWithIdToken({ provider: 'google', token: credential, nonce });
  if (error) { clearLocalAuthStorage(); return { ok: false, error: 'id_token_rejected' }; }
  return finishGoogleLogin(client, post);
}
