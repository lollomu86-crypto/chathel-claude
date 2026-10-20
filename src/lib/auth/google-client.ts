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
