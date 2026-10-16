// Identita' dell'ospite = accesso con Google (decisione dei soci, 13 ottobre 2026).
//
// L'ospite entra con il QR dell'hotel PIU' il login Google. La sessione di soggiorno e' legata all'identita':
//  - un'identita' = al massimo un soggiorno attivo per hotel;
//  - lo stesso account non puo' ritirare due bonus nello stesso hotel nella stagione (chiave anti-doppione, vedi identityKey).
//
// Dati trattati dall'app: SOLO provider_subject (per Google il campo `sub`) e nome di battesimo. Nickname scelto dall'ospite.
// Mai e-mail ne' foto nell'elenco, nel database applicativo o nei log. (Attenzione: Supabase Auth, per il login Google,
// conserva da se' e-mail e profilo nella propria tabella auth.users: l'app non li copia, non li legge e non li mostra, e
// vengono cancellati con l'utente al check-out. Va scritto nell'informativa e valutato dal legale.)
//
// Due implementazioni dell'interfaccia GuestIdentityProvider:
//  - DemoIdentityProvider: identita' SIMULATE e selezionabili ("Giulia (demo)"). Nessuna rete. Provata dai test.
//  - SupabaseIdentityProvider: login Google via Supabase Auth. Il client chiama signInWithOAuth({provider:'google'})
//    (vedi google-client.ts), poi invia i token al server (POST /api/identity/session) che li VERIFICA con
//    auth.getUser(). NON VERIFICATO contro un progetto Supabase reale ne' contro Google: scritto sulla base della
//    documentazione di supabase-js; i campi letti da user.identities / user_metadata vanno controllati con un login vero.
//
// Solo server (usa node:crypto).

import { createHmac } from 'node:crypto';
import { decodeSession, encodeSession } from '../session-format';
import { ConfigError, readEnv } from '../env';
import type { GuestIdentity } from '../types';

export type { GuestIdentity };

export interface DemoIdentityOption {
  id: string;
  /** etichetta mostrata al posto del pulsante "Accedi con Google", es. "Giulia (demo)" */
  label: string;
}

export interface VerifiedIdentity {
  identity: GuestIdentity;
  /** Supabase: id dell'utente autenticato (auth.users.id) a cui si lega il soggiorno. */
  authUserId?: string;
}

export interface GuestIdentityProvider {
  readonly mode: 'demo' | 'supabase';
  /** `credential` = valore del cookie di identita'. null se assente, scaduto o non valido. */
  verify(credential: string | undefined): Promise<VerifiedIdentity | null>;
  /** Solo demo: elenco delle identita' selezionabili. */
  listDemo?(): DemoIdentityOption[];
  /** Solo demo: "accede" con un'identita' simulata. Ritorna il valore del cookie. */
  loginDemo?(id: string): Promise<{ credential: string; identity: GuestIdentity } | null>;
  /** Solo Supabase: dopo l'OAuth lato client, verifica i token e ritorna il valore del cookie. */
  exchangeSession?(tokens: { accessToken: string; refreshToken: string }): Promise<{ credential: string; identity: GuestIdentity } | null>;
}

// ----------------------------------------------------------------------------- chiave anti-doppione

/**
 * HMAC-SHA256(pepper, "provider|subject") in esadecimale. Serve a: (a) impedire un secondo bonus per lo stesso account
 * nella stessa stagione anche dopo la cancellazione dei dati al check-out (resta solo questo valore, pseudonimo);
 * (b) chiavi dei limiti di frequenza senza dati in chiaro. Senza il pepper (variabile IDENTITY_PEPPER, solo server) non e'
 * invertibile ne' confrontabile. In Supabase la variabile e' obbligatoria (min 16 caratteri).
 */
export function identityKey(identity: GuestIdentity, pepper = identityPepper()): string {
  return createHmac('sha256', pepper).update(`${identity.provider}|${identity.subject}`).digest('hex');
}

export function identityPepper(): string {
  const p = readEnv('IDENTITY_PEPPER');
  if (p && p.length >= 16) return p;
  if (readEnv('CHATHEL_DEMO') === '1') return 'demo-pepper-non-segreto';
  throw new ConfigError('no_config', 'IDENTITY_PEPPER mancante o troppo corta (minimo 16 caratteri)');
}

// ----------------------------------------------------------------------------- demo

export const DEMO_IDENTITIES: { id: string; subject: string; givenName: string }[] = [
  { id: 'giulia', subject: 'demo-giulia', givenName: 'Giulia' },
  { id: 'marco', subject: 'demo-marco', givenName: 'Marco' },
  { id: 'sofia', subject: 'demo-sofia', givenName: 'Sofia' },
  { id: 'luca', subject: 'demo-luca', givenName: 'Luca' },
  { id: 'anna', subject: 'demo-anna', givenName: 'Anna' },
  { id: 'jan', subject: 'demo-jan', givenName: 'Jan' },
];

export class DemoIdentityProvider implements GuestIdentityProvider {
  readonly mode = 'demo' as const;
  constructor(private readonly list = DEMO_IDENTITIES) {}

  listDemo(): DemoIdentityOption[] {
    return this.list.map((d) => ({ id: d.id, label: `${d.givenName} (demo)` }));
  }

  async loginDemo(id: string) {
    const d = this.list.find((x) => x.id === id);
    if (!d) return null;
    const identity: GuestIdentity = { provider: 'demo', subject: d.subject, givenName: d.givenName };
    return { credential: `demo:${d.id}`, identity };
  }

  async verify(credential: string | undefined): Promise<VerifiedIdentity | null> {
    if (!credential?.startsWith('demo:')) return null;
    const d = this.list.find((x) => x.id === credential.slice(5));
    return d ? { identity: { provider: 'demo', subject: d.subject, givenName: d.givenName } } : null;
  }
}

// ----------------------------------------------------------------------------- supabase

/** Parte di supabase-js che serve qui (permette di provarla con un client simulato). */
export interface AuthClientLike {
  auth: {
    getUser(jwt?: string): Promise<{
      data: {
        user: null | {
          id: string;
          identities?: { provider?: string; identity_data?: Record<string, unknown> | null }[] | null;
          user_metadata?: Record<string, unknown> | null;
          app_metadata?: Record<string, unknown> | null;
        };
      };
      error: unknown;
    }>;
  };
  rpc?(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

export interface SupabaseIdentityDeps {
  /** client con la chiave pubblica (anon): serve a verificare il token dell'utente */
  anon(): AuthClientLike;
  /** client con service_role: registra l'identita' (RPC identity_register) */
  service(): AuthClientLike;
}

/** Primo nome da un nome completo; mai il cognome. */
export function givenNameFrom(meta: Record<string, unknown> | null | undefined): string | null {
  const pick = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const given = pick(meta?.given_name) || pick(meta?.full_name).split(/\s+/)[0] || pick(meta?.name).split(/\s+/)[0];
  const clean = given.replace(/[^\p{L}\p{N} '.-]/gu, '').slice(0, 24).trim();
  return clean.length >= 1 ? clean : null;
}

export class SupabaseIdentityProvider implements GuestIdentityProvider {
  readonly mode = 'supabase' as const;
  constructor(private readonly deps: SupabaseIdentityDeps) {}

  private async userFrom(accessToken: string): Promise<VerifiedIdentity | null> {
    const { data, error } = await this.deps.anon().auth.getUser(accessToken);
    const u = data?.user;
    if (error || !u) return null;
    const g = u.identities?.find((i) => i.provider === 'google');
    // nessun login anonimo ne' e-mail+password: solo Google. Il subject e' il `sub` di Google.
    if (!g) return null;
    const subjectRaw = g.identity_data?.sub ?? g.identity_data?.provider_id ?? u.user_metadata?.provider_id ?? u.user_metadata?.sub;
    const subject = typeof subjectRaw === 'string' ? subjectRaw : '';
    const givenName = givenNameFrom(u.user_metadata) ?? givenNameFrom(g.identity_data ?? undefined);
    if (!subject || !givenName) return null;
    return { identity: { provider: 'google', subject, givenName }, authUserId: u.id };
  }

  async verify(credential: string | undefined): Promise<VerifiedIdentity | null> {
    const tok = decodeSession(credential);
    if (!tok) return null;
    try {
      return await this.userFrom(tok.a);
    } catch {
      return null;
    }
  }

  async exchangeSession(tokens: { accessToken: string; refreshToken: string }) {
    let v: VerifiedIdentity | null = null;
    try {
      v = await this.userFrom(tokens.accessToken);
    } catch {
      return null;
    }
    if (!v?.authUserId) return null;
    // registra l'identita' (solo provider_subject e nome di battesimo) per il legame con il soggiorno
    const svc = this.deps.service();
    const r = await svc.rpc?.('identity_register', {
      p_auth_user: v.authUserId, p_provider: v.identity.provider, p_subject: v.identity.subject, p_given_name: v.identity.givenName,
    });
    if (!r || r.error) return null;
    return { credential: encodeSession({ a: tokens.accessToken, r: tokens.refreshToken }), identity: v.identity };
  }
}
