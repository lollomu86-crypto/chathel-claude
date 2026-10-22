# ChatHel — guida per Claude Code (passaggio del 22/10/2026)

## Chi e cosa
- **ChatHel SRL** (non ancora costituita, obiettivo 15/01/2027; prima dei contratti si scrive solo "ChatHel"). Soci: **Lorenzo Murgia** (50%, design/sviluppo) e **Jacopo Anedda** (50%, hotel, pilota, bandi, SRL). Lorenzo: lollomu86@gmail.com.
- Obiettivo unico: dare vita a ChatHel = app MVP + contratti con resort stagionali italiani per il 2027 + legale, economico, burocratico, informatico. Ogni compito a un agente diverso, niente confusione; muoversi come squadra, in modo strategico.
- Prodotto: PWA per ospiti di hotel/resort (QR o codice a 6 cifre + login Google): bonus di benvenuto validato dal barista, eventi, prenotazioni servizi, reception AI (NON attiva: manca la chiave Anthropic), parte sociale (elenco ospiti, chat pubblica, chat private su richiesta, coupon, moderazione hotel). Lingue it/en/de/ru.
- Lingua di lavoro con Lorenzo: **italiano**.

## Regole da non rompere
1. **Mai incollare segreti in chat** (chiavi, secret Google, service role, VAPID privata): vanno solo nei campi di Supabase/Vercel.
2. **I colori dell'app non si cambiano** (richiesta esplicita di Lorenzo). Palette/brand: vedi docs nel Project (BRAND.md, 12-revisione-design-sistema.md).
3. Il **codice 967991** di Hotel Prova deve restare valido; non ruotarlo.
4. Prima si esegue l'eventuale migrazione SQL in Supabase (a cura di Lorenzo), poi si pubblica il codice che la usa.
5. Niente claim legali/privacy non verificati (vedi BRAND.md "Claims"; 09-social-privacy-legale.md). ChatHel non è un parere legale.
6. Per il pilota resta la **web app/PWA**: niente App Store/Play Store per ora.

## Infrastruttura
- App: **chathel.com** (+ www) su **Vercel** (progetto `chathel-app`, team `chat-hel`, piano Hobby). Repo GitHub **lollomu86-crypto/chathel-claude**, collegata: push su `main` = deploy produzione. Il sito per i direttori **chathel.it** è un progetto separato (repo `chathel-sito`, vuoto).
- Database/Auth: **Supabase** (progetto ChatHel, piano Free, UE). Migrazioni in `supabase/migrations` (0001–0007 applicate). Login Google attivo (Google Cloud progetto ChatHel, client "ChatHel Web"; Site URL https://chathel.com; redirect https://chathel.com/**).
- Hotel di prova: slug `hotel-prova`, codice 967991, admin su chathel.com/admin/login. Dati demo: `supabase/seed/demo-hotel-prova.sql` (atteso `6 | 5 | 123 | 9`). Immagini di esempio in `public/demo/*.svg`.
- Variabili Vercel (solo i nomi): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, IDENTITY_PEPPER, TRUSTED_IP_HEADER, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY. Previste: ANTHROPIC_API_KEY (+ANTHROPIC_MODEL, AI_HOTEL_DAILY_CAP), EMERGENCY_WEBHOOK_URL, VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (push).
- Il connettore Vercel MCP dà 403 sullo scope chat-hel: le azioni sul dashboard le fa Lorenzo (Deployments → Create Deployment se serve).

## Stack e test
Next.js 15.5 (App Router) + Supabase, niente librerie push: Web Push scritto con `node:crypto` (`src/lib/push/`). Test: `npm test` (150 passano; con `NODE_PATH=/opt/npm-tools/node_modules` nel container cloud). `npm run i18n` controlla le traduzioni it/en/de/ru. `tsc` ha solo errori d'ambiente (mancano @types/node ecc.) nel container cloud: su una macchina con `npm install` deve essere pulito. Leggere anche `NOTE-SVILUPPO.md`.
Fatti importanti: dopo il login Google il browser NON deve chiamare `signOut` (revoca la sessione sul server; vedi `src/lib/auth/google-client.ts`). Eventi/servizi usano jsonb `{it,en,de}`; gli slot sono unici per (servizio, orario).

## Notifiche push (stato: ATTIVE in produzione dal 22/10/2026)
Provate da Lorenzo su telefono Android: gli avvisi dell'hotel arrivano (anche con app chiusa). Tipi: avvisi hotel, risposte reception, messaggi privati, chat pubblica (per ospite, spenta di default, max 1 ogni 10 min). Testi generici, mai contenuti dei messaggi né nickname; l'avviso mostra come titolo il nome dell'hotel e sotto titolo e testo scritti dall'hotel. Migrazione 0007 applicata; variabili VAPID_* create in Vercel. Limite avvisi hotel: 10 al giorno (`src/lib/limits.ts`). Icone dell'app/notifica: solo H con C (`scripts/gen-icons.py`, sorgente JPG a bassa risoluzione: serve il vettoriale); iconcina monocroma `public/icons/badge-96.png`.
Da provare ancora: iPhone (serve app aggiunta alla Home, iOS >=16.4), notifiche di reception/privati/chat pubblica, ritardo di consegna (uno degli avvisi è arrivato in ritardo: forse risparmio batteria del telefono). Ogni avviso ha lo stesso `tag` per categoria e quindi sostituisce il precedente sul telefono: valutare tag unici per avviso.
Privacy: l'iscrizione è dato personale, si cancella con l'ospite; paragrafo in `messages/*.json` (privacy.push).

## Da fare (in ordine di priorità)
1. Completare le prove delle push (iPhone, reception, privati, chat pubblica).
2. Provare il percorso demo con Jacopo (copione); inserire email e telefono nella scheda hotel; Jacopo rivede il copione.
3. Reception AI: decidere budget e inserire ANTHROPIC_API_KEY.
4. Prima del lancio: Vercel Pro e Supabase Pro (Free va in pausa e non ha backup), MFA staff, osservabilità (Sentry/uptime), CSP, prova di carico, test dell'avviso di emergenza (webhook), verifica del job di cancellazione al check-out (pg_cron), strumento per creare hotel senza SQL, caricamento foto dal pannello (oggi `image_url` solo da Supabase).
5. Legale: avvocato/DPO, DPIA, DPA, informativa e termini; revisione madrelingua del russo; verifica frasi su minori/blocco/segnalazione.
6. Eventuale: leggere il QR dall'interno dell'app; rifinitura grafica (senza cambiare i colori); aggiornare la skill `chathel` (descrive ancora Expo/Google-only: il codice è Next.js PWA).

## Piano e numeri (dal Project, doc piano-operativo)
Traguardi: 20/11/2026 prototipo per demo; nov–dic demo e lettere d'intenti; 15/01/2027 SRL; 31/01/2027 contratto pilota/DPA/informativa; 10/02/2027 contratti firmati e MVP online; 15/02–30/04/2027 pilota 4–6 hotel (Cagliari + 1–2 fuori regione); 31/03/2027 fine offerta Founding Hotel (−40%, prezzo bloccato 2 anni); 15/05/2027 lancio.
Budget deciso: 12.500 € fino a maggio 2027 (soci), ~37.000 € solo con bandi. Listino (canone mensile, IVA esclusa, solo nei mesi di apertura): Small ≤40 camere 99 €; Medium 41–100 camere 179 €; Large >100 camere 279 €; primo mese gratuito con resoconto dati.
Bandi: priorità Voucher Startup Innovative (Sardegna Ricerche, a sportello fino al 30/04/2027, 40–200k €, 70–85% fondo perduto; email allo Sportello Startup inviata il 20/10, da scrivere a Silvia Marcis marcis@sardegnaricerche.it) e Resto al Sud 2.0 (gen–feb 2027). Pratica proprietà intellettuale n. 1906 su Punto Cartesiano in attesa.

## Documenti (nel Project claude.ai "ChatHel", cartella `claude/`)
piano-operativo-2026-2027 · stima-ottobre-2027 · resort-target-sardegna (50 resort, priorità A/B/C) · voucher-startup-candidatura · BRAND.md (voce, claims, colori, tagline "Dove l'hotel si parla.") · 09-social-privacy-legale (salvaguardie S1–S27, decisioni D1–D12, test SOC) · 10-revisione-backend · 11-revisione-frontend · 12-revisione-design-sistema · 13-pubblicazione · 14-stato-tecnico-2026-10-20 · ChatHel_Documento_Validazione_Hotel.pdf. Materiali hotel: due Docs (scheda di presentazione, copione demo). Aggiornare questi documenti quando cambia lo stato; il doc 14 è da aggiornare con seed, immagini e push.
