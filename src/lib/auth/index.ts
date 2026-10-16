// Selezione del provider di identita' in base alla modalita' (vedi env.ts: nessun ripiego silenzioso sulla demo).
import { resolveMode, supabaseConfig } from '../env';
import { DemoIdentityProvider, SupabaseIdentityProvider, type GuestIdentityProvider } from './guest-identity';

const G = globalThis as unknown as { __chathelIdentity?: GuestIdentityProvider };

export async function getIdentityProvider(): Promise<GuestIdentityProvider> {
  if (G.__chathelIdentity) return G.__chathelIdentity;
  const mode = resolveMode();
  let p: GuestIdentityProvider;
  if (mode === 'demo') p = new DemoIdentityProvider();
  else {
    const c = supabaseConfig()!;
    // import dinamico: nessun codice Supabase nel percorso demo
    const { createClient } = await import('@supabase/supabase-js');
    const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;
    p = new SupabaseIdentityProvider({
      anon: () => createClient(c.url, c.anonKey, opts) as never,
      service: () => {
        if (!c.serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY mancante');
        return createClient(c.url, c.serviceKey, opts) as never;
      },
    });
  }
  G.__chathelIdentity = p;
  return p;
}

export function _resetIdentityForTests() {
  G.__chathelIdentity = undefined;
}
