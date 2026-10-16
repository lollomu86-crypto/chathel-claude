# ChatHel – MVP P0 (scheletro)

PWA per resort e hotel stagionali: ospite (da QR), vista barista, pannello hotel, reception AI.
Next.js (App Router) + TypeScript, Postgres/Supabase (UE), Claude via API. Contesto e scelte: `../docs/` e `../CONTESTO.md`.

## Avvio in locale (modalità DEMO, senza backend)

Richiede Node 20.9+.

```bash
npm install
npm run dev          # http://localhost:3000
```

Senza variabili d'ambiente Supabase l'app usa uno store in memoria con un hotel finto (eventi,
spa/piscina/sala giochi con slot e capienze, base di conoscenza AI). Il codice con Supabase reale
è in `src/lib/store/supabase.ts` (migrazione in `supabase/migrations/0001_init.sql`).
Senza `ANTHROPIC_API_KEY` la reception AI risponde a parole chiave (dichiarato come demo).

Variabili: vedi `.env.example`.

## Test

```bash
npm test             # tsx --test tests/*.test.ts  (regole bonus, slot, AI, i18n, store)
npm run harness      # solo API, senza Next (porta 3100)
npm run smoke        # prova di fumo HTTP contro un server già avviato (BASE=http://localhost:3100)
```

Schema SQL: `supabase/tests/0002_social_test.sql` si lancia con `psql -v ON_ERROR_STOP=1 -f` su un Postgres 15+ dopo `0001_init.sql` e `0002_social.sql`.

## Struttura

- `src/app` pagine e API (ospite `/h/[slug]` e `/stay/*`, barista `/bar`, pannello `/admin`)
- `src/lib/rules` regole di bonus, slot, livello sociale e coupon (pure, testate)
- `src/lib/store` store demo e Supabase
- `src/lib/ai` guardrail, prompt, demo e Claude
- `messages/` traduzioni it/en/de
- `supabase/migrations` schema con RLS

Stato e limiti noti: `NOTE-SVILUPPO.md`.
