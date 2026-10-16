// Selezione dello store. FAIL-CLOSED: la demo parte solo con CHATHEL_DEMO=1 (vedi env.ts). Senza configurazione
// l'app rifiuta di partire (ConfigError -> 503), non ripiega in silenzio su dati in memoria con password note.
import { readEnv, resolveMode, supabaseConfig } from '../env';
import { setRateBackend } from '../ratelimit';
import type { Store } from './types';

const G = globalThis as unknown as { __chathelStore?: Store };

export async function getStore(): Promise<Store> {
  if (G.__chathelStore) return G.__chathelStore;
  const mode = resolveMode(); // lancia ConfigError se manca la configurazione
  let store: Store;
  if (mode === 'demo') {
    // import dinamico: il codice e i dati demo (password di esempio) non vengono caricati fuori dalla demo
    const { DemoStore } = await import('./demo');
    const num = (name: string) => {
      const v = readEnv(name);
      const n = Number(v);
      return v !== undefined && Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    store = new DemoStore({ bonusCap: num('DEMO_BONUS_CAP'), bonusMaxPerHour: num('DEMO_BONUS_PER_HOUR'), qrToken: readEnv('DEMO_QR_TOKEN') });
  } else {
    const { SupabaseStore, supabaseRateBackend } = await import('./supabase');
    const { createClient } = await import('@supabase/supabase-js');
    const c = supabaseConfig()!;
    const s = new SupabaseStore({ createClient: createClient as never });
    // contatore condiviso tra istanze (funzione rate_limit_hit, migrazione 0004). Se manca la chiave di servizio resta quello in memoria.
    if (c.serviceKey) setRateBackend(supabaseRateBackend(s));
    store = s;
  }
  G.__chathelStore = store;
  return store;
}
