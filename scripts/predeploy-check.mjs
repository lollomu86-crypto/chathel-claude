// Controllo prima della pubblicazione: node scripts/predeploy-check.mjs
// Legge le variabili dall'ambiente (o da .env.local se esiste) e dice cosa manca. Non stampa mai i valori.
import { readFileSync, existsSync } from 'node:fs';
if (existsSync('.env.local')) {
  for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const e = process.env;
const problems = [];
const warns = [];
const need = (k, why) => { if (!e[k]) problems.push(`${k} manca: ${why}`); };
need('NEXT_PUBLIC_SUPABASE_URL', 'URL del progetto Supabase (regione UE)');
need('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'chiave pubblica anon');
need('SUPABASE_SERVICE_ROLE_KEY', 'chiave di servizio, solo server');
if (!e.IDENTITY_PEPPER || e.IDENTITY_PEPPER.length < 32) problems.push('IDENTITY_PEPPER manca o ha meno di 32 caratteri (generalo con: openssl rand -hex 32)');
if (e.CHATHEL_DEMO) problems.push('CHATHEL_DEMO e\' attivo: in produzione deve essere vuoto');
if (e.CHATHEL_DEMO_ALLOW_PRODUCTION) problems.push('CHATHEL_DEMO_ALLOW_PRODUCTION e\' attivo: va tolto');
if (!e.ANTHROPIC_API_KEY) warns.push('ANTHROPIC_API_KEY vuota: la reception AI usera\' solo risposte per parole chiave');
if (!e.TRUSTED_IP_HEADER) warns.push('TRUSTED_IP_HEADER vuoto: su Vercel usa x-vercel-forwarded-for, altrimenti il limite per IP e\' disattivato');
if (!e.EMERGENCY_WEBHOOK_URL) warns.push('EMERGENCY_WEBHOOK_URL vuoto: gli avvisi di emergenza compaiono solo nel pannello staff');
if (e.NEXT_PUBLIC_SUPABASE_URL && /^https?:\/\/localhost/.test(e.NEXT_PUBLIC_SUPABASE_URL)) warns.push('NEXT_PUBLIC_SUPABASE_URL punta a localhost');
for (const p of problems) console.log('ERRORE  ' + p);
for (const w of warns) console.log('AVVISO  ' + w);
if (!problems.length) console.log('OK: nessun errore bloccante.' + (warns.length ? ' Controlla gli avvisi.' : ''));
process.exit(problems.length ? 1 : 0);
