// Lettura variabili d'ambiente a RUNTIME (accesso dinamico: Next non le "inchioda" nel bundle
// al momento della build). Solo server.
//
// MODALITA' (fail-closed): la modalita' demo NON e' mai automatica.
//  - CHATHEL_DEMO=1            -> demo (dati in memoria, password staff di esempio)
//  - variabili Supabase presenti -> supabase
//  - altrimenti                -> ConfigError: l'app rifiuta di partire (nessun ripiego silenzioso sulla demo)
//  - CHATHEL_DEMO=1 insieme alle variabili Supabase -> ConfigError (configurazione ambigua)
//  - demo con NODE_ENV=production -> ConfigError, salvo CHATHEL_DEMO_ALLOW_PRODUCTION=1 (demo ospitata di proposito)

export class ConfigError extends Error {
  constructor(public readonly code: 'no_config' | 'ambiguous' | 'demo_in_production', message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function supabaseConfig(): { url: string; anonKey: string; serviceKey?: string } | null {
  const url = readEnv('SUPABASE_URL') ?? readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = readEnv('SUPABASE_ANON_KEY') ?? readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !anonKey) return null;
  return { url, anonKey, serviceKey: readEnv('SUPABASE_SERVICE_ROLE_KEY') };
}

export type AppMode = 'demo' | 'supabase';

/** Decide la modalita' oppure lancia ConfigError. Nessun valore di default: manca la configurazione = non si parte. */
export function resolveMode(): AppMode {
  const demoFlag = readEnv('CHATHEL_DEMO') === '1';
  const sb = supabaseConfig();
  if (demoFlag && sb) {
    throw new ConfigError('ambiguous', 'CHATHEL_DEMO=1 e variabili Supabase presenti insieme: scegliere una sola modalita');
  }
  if (demoFlag) {
    if (process.env.NODE_ENV === 'production' && readEnv('CHATHEL_DEMO_ALLOW_PRODUCTION') !== '1') {
      throw new ConfigError('demo_in_production', 'Demo in produzione rifiutata: serve anche CHATHEL_DEMO_ALLOW_PRODUCTION=1');
    }
    return 'demo';
  }
  if (sb) return 'supabase';
  throw new ConfigError('no_config', 'Nessuna configurazione: impostare le variabili Supabase oppure CHATHEL_DEMO=1 (solo prova)');
}

/** Modalita' demo = flag esplicito CHATHEL_DEMO=1 (mai dedotta dall'assenza di variabili). Non lancia. */
export function isDemoMode(): boolean {
  return readEnv('CHATHEL_DEMO') === '1' && !supabaseConfig();
}

/** Controllo per /api/health: null = ok, altrimenti il codice del problema (senza dettagli). */
export function configProblem(): string | null {
  try {
    resolveMode();
    return null;
  } catch (e) {
    return e instanceof ConfigError ? e.code : 'config';
  }
}
