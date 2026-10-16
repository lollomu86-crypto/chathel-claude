# Note di sviluppo (stato al 13 ottobre 2026)

> **Aggiornamento BACKEND dopo la revisione (docs/10, sezione 8).** Le sezioni qui sotto "Cosa è stato verificato" e "Livello sociale > Cosa NON è stato verificato" sono dello stato precedente: i numeri aggiornati e il contratto API per il frontend sono nella sezione **"Stato dopo le correzioni"** in fondo a questo file. Dove i due testi divergono vale quello in fondo.

Il blocco "Livello sociale" qui sotto è l'aggiornamento del 13 ottobre; il resto del documento è lo stato del 12 ottobre, invariato.

## Cosa è stato verificato
- `tsx --test tests/*.test.ts`: 47 test su 47 superati (bonus: un solo riscatto e tetto stagionale; slot: capienza e
  overbooking; reception AI: guardrail e passaggio all'operatore; traduzioni it/en/de; store demo).
- Prova di fumo HTTP sulle API (`scripts/harness-server.ts` + `scripts/smoke.mjs`): 13 controlli su 13 superati
  (onboarding, QR errato rifiutato, bonus, riscatto al bar e secondo riscatto rifiutato, KPI solo per admin, chat AI).
- Lo schema `supabase/migrations/0001_init.sql` è stato provato su un Postgres 16 pulito dall'agente architetto
  (accesso a tempo, doppio riscatto, tetto, capienza, cancellazione al check-out).

## Cosa NON è stato verificato
- **`next build` e `next dev`**: nell'ambiente di lavoro il registry npm è bloccato dalla policy di rete (403), quindi
  `next`, `react`, `qrcode`, `@anthropic-ai/sdk`, `@supabase/supabase-js` non erano installabili. Nessuna schermata è mai
  stata renderizzata. Il controllo dei tipi fatto con stub dà 49 errori, tutti riconducibili agli stub
  (parametri `e` senza tipo React, `useRef(null)`, `toCanvas` di qrcode, tipo `Anthropic`, `SupabaseClient`):
  vanno rivalutati dopo `npm install`.
- **Supabase reale** (`src/lib/store/supabase.ts`), realtime, `pg_cron`: mai eseguiti.
- **Chiamata a Claude** (`src/lib/ai/claude.ts`): mai eseguita (nessuna chiave); testati solo guardrail e fallback.
- Scansione QR con la fotocamera (vista barista) e installazione PWA su iPhone/Android.

## Da fare per primo, sul tuo computer
1. `npm install && npm run dev` e provare a mano il flusso: `/h/demo?k=demo-qr-token` → bonus → `/bar` → `/admin`.
2. `npm run typecheck` e correggere gli errori reali che emergono con i pacchetti veri.
3. Provare un progetto Supabase UE con la migrazione e la reception AI con una chiave di prova.

## Livello sociale (P0, decisione dei soci del 13 ottobre 2026)

### Cosa c'è
- **Elenco ospiti**: compare solo chi è maggiorenne E ha scelto di comparire (casella all'ingresso, spenta di default, modificabile dalla scheda Ospiti > Profilo). Si vedono solo nickname (di default la prima parola del nome inserito, mai il cognome), lingua e se accetta messaggi privati. L'id esposto è un id sociale casuale, mai l'id interno dell'ospite. Chi non ha scelto di comparire non può nemmeno vedere l'elenco (reciprocità). Nickname validati: niente e-mail, link, sequenze di 5+ cifre.
- **Chat pubblica** (una per struttura): max 280 caratteri (contati per punti di codice), 5 messaggi al minuto e 100 al giorno per ospite, regole d'uso da accettare prima della prima scrittura, segnalazione di ogni messaggio altrui, blocco dell'autore.
- **Chat privata**: il primo messaggio è una **richiesta** (scelta di prodotto implementata come da incarico; nel CONTESTO era ancora [DA DECIDERE], è reversibile in un solo punto: `startThread`/`sendPrivate` in `rules/social.ts`). Il mittente non può aggiungere altro finché il destinatario non accetta; una richiesta rifiutata non si ripete. Limite di 5 nuovi contatti al giorno, 10 messaggi al minuto, opzione "non ricevere privati", blocca e segnala sempre disponibili. Chi scrive riceve sempre lo stesso errore (`recipient_unavailable`) sia se il destinatario non accetta privati, sia se ha bloccato, sia se è uscito dall'elenco.
- **Coupon** (caffè, aperitivo, cena condivisa): inviati dentro una chat privata accettata, solo nei locali dell'hotel (li valida solo lo staff bar/direttore dello stesso hotel), uso singolo, scadenza 48 ore e mai oltre la fine del soggiorno del destinatario, max 3 al giorno e 5 attivi per mittente, annullabili dal mittente, annullati se una delle parti blocca. Il destinatario genera un QR a vita breve (90 s, token con prefisso `c.`), il barista lo scansiona nella stessa vista del bonus e vede il tipo di coupon, il nickname del destinatario e di chi lo ha offerto. **Nessun pagamento nell'app. Chi paga e come si regola il conto è ancora [DA DECIDERE]**: l'app non lo sa e non lo dice.
- **Pannello hotel** (`/admin/social`, direttore e reception; il barista no): coda segnalazioni (pubbliche e private), moderazione della chat pubblica (nascondi/mostra messaggio, silenzia 1 ora o fino al check-out, escludi/riammetti dal social), numeri aggregati per periodo (ospiti in elenco, messaggi pubblici, richieste private inviate/accettate/rifiutate, solo il *numero* di messaggi privati, coupon inviati/riscattati/scaduti, messaggi nascosti, segnalazioni aperte). **L'hotel non ha alcun modo di leggere le chat private**: vede solo il messaggio segnalato e al massimo 4 precedenti, condivisi da chi segnala.
- **Check-out / "Esci e cancella"**: profilo, messaggi pubblici, conversazioni e messaggi privati, blocchi spariscono; i coupon non usati vengono annullati e restano come righe anonime; le segnalazioni che riguardano la persona sono chiuse (`subject_left`) e il testo condiviso cancellato. Restano solo contatori anonimi.

### Dove sta il codice
- Regole di dominio pure e testabili: `src/lib/rules/social.ts` (profili, elenco, chat, blocchi, richieste, segnalazioni, moderazione, statistiche, purge) e `src/lib/rules/coupons.ts` (emissione, QR, validazione, uso singolo, scadenza).
- Store demo: `src/lib/store/demo-social.ts` (adattatori per ospite e staff), integrazione in `demo.ts` (creazione profilo all'ingresso, purge, scadenza coupon, validazione coupon in `redeem`); contratti in `store/types.ts` (`SocialGuestApi`, `SocialStaffApi`).
- API: `src/lib/api/social-handlers.ts`, instradate da `guestAction`/`staffAction` con prefisso `social-` (nessun nuovo route file: le route dinamiche esistenti le coprono). Nuovo codice errore `CH007` (limite di frequenza, HTTP 429).
- Schermate ospite: `/stay/social` (elenco, chat, privati, profilo) e `/stay/social/[id]` (conversazione, coupon); componenti `Social*.tsx`, `ThreadClient.tsx`, `CouponQr.tsx`; tab "Ospiti" nella barra (ora 5 voci); casella di opt-in in `OnboardingForm.tsx`. Pannello: `/admin/social`, `AdminSocial.tsx`. Vista barista: `BarClient.tsx` riconosce i coupon.
- Stringhe it/en/de: sezioni `social`, `admin.social`, `nav.social`, `bar.couponDetail`, nuovi codici in `errors`; aggiornati il testo "maggiorenne" dell'ingresso e la sezione "Altri ospiti" dell'informativa (prima diceva che non esisteva alcun elenco di ospiti: non era più vero).
- Database: `supabase/migrations/0002_social.sql` (tabelle, vincoli, RLS, RPC `SECURITY DEFINER`, trigger di purge, job di scadenza) e prova `supabase/tests/0002_social_test.sql`.

### Cosa è stato verificato (13 ottobre)
- `NODE_PATH=/opt/npm-tools/node_modules npx tsx --test tests/*.test.ts`: **83 test su 83 superati** (47 preesistenti + 36 nuovi in `tests/social.test.ts`). Coprono: visibilità solo opt-in e reciprocità, minorenni esclusi (elenco, scrittura, attivazione, ricezione di richieste), nessun cognome/id interno/date nei DTO, regole d'uso prima di scrivere, 280 caratteri (anche con emoji), limiti di frequenza e tetti giornalieri, segnalazione (idempotente, non del proprio messaggio), moderazione (nascondi chiude la segnalazione, silenzia a tempo e fino al check-out, escludi/riammetti, ruoli: il barista è escluso), richiesta privata accettata/rifiutata/non ripetibile, "non ricevere privati" indistinguibile da un blocco, limite di nuovi contatti al giorno, blocco (elenco, chat pubblica, privata, coupon annullati), segnalazione privata limitata a 5 messaggi, coupon (tipi, solo in chat accettata, uso singolo, scadenza a 48 ore e al fine soggiorno, QR di 90 s, annullamento, tetti, convivenza con il QR del bonus, staff di un altro hotel respinto), check-out (manuale e per scadenza) con coupon annullati e segnalazioni svuotate, statistiche aggregate, routing e codici HTTP (403/429/401) dei handler.
- Prova di fumo HTTP (`scripts/harness-server.ts` + `scripts/smoke.mjs`, esteso): **31 controlli su 31 superati**, di cui 18 nuovi sul sociale (elenco, minorenne, opt-in mancante, regole, 280 caratteri, segnalazione, coda reception, barista escluso, messaggio nascosto, richiesta, accettazione, coupon, QR, validazione al bar, secondo uso rifiutato, numeri aggregati).
- `0002_social.sql` applicata dopo `0001_init.sql` su un **Postgres 16 pulito** e provata con `supabase/tests/0002_social_test.sql` (impersonificazione con `request.jwt.claims` + `SET ROLE authenticated`): **53 controlli superati**. Coprono RLS (l'ospite non legge le tabelle sociali, la reception non legge chat private né preferenze), opt-in/minorenni, nickname, limiti, richieste, blocco, segnalazione privata (snapshot di 5 messaggi), coupon (uso singolo, scadenza, tetto, scadenza oltre il soggiorno), `redeem_coupon` (solo bartender/direttore), numeri aggregati, e la cancellazione al check-out via `app.purge_guest`.
- Controllo dei tipi con `tsc` senza i pacchetti reali: sui file toccati restano solo errori riconducibili all'assenza di `react`/`next`/`@types/node` (JSX senza tipi, parametri `e`, `redirect` non tipato `never`, `children`); nessun errore di tipo nei moduli `src/lib` né nei nuovi test.

### Cosa NON è stato verificato
- **`next build` / `next dev` non eseguiti** (npm non installabile, registro bloccato; non ho tentato di aggirarlo). **Nessuna delle nuove schermate è mai stata renderizzata**: né `/stay/social`, né la conversazione, né `/admin/social`, né il QR del coupon, né la scansione reale col telefono. Il CSS nuovo (barra a 5 voci, tablist, riquadri di moderazione) è sconosciuto a vista. Aspettarsi correzioni dopo `npm install && npm run typecheck`.
- **Lo store Supabase non è collegato al sociale**: `SbGuestApi.social()` e `SbStaffApi.social()` lanciano `social_not_available` (la UI mostra "non ancora disponibili"); `SbStaffApi.redeem` non chiama `redeem_coupon`; `start_stay` non riceve la scelta di opt-in (andrà passata chiamando `social_update_settings` subito dopo l'ingresso). Il sociale funziona oggi solo in modalità demo (memoria). Le RPC SQL sono provate in isolamento, non dal codice TypeScript.
- Le RPC sono provate con il meccanismo di impersonificazione di PostgREST simulato, non con GoTrue/PostgREST reali. `pg_cron` non c'era: il job `expire_social_coupons` non è mai girato. In SQL `now()` non avanza dentro una transazione: la prova retrodata le righe per superare i limiti di frequenza.
- Nessun realtime: chat e privati si aggiornano con polling ogni 5-8 secondi. Nessuna notifica push per richieste e coupon. Il limite di frequenza HTTP aggiuntivo è in memoria (una sola istanza).
- Nessun filtro automatico di parolacce/spam/link, nessuna analisi dei contenuti: la moderazione è solo umana e a posteriori.

### Limiti e scelte da rivedere con il team (non nascondere)
- **Età non verificabile**: `isAdult` è una dichiarazione. Un minorenne che spunta la casella entra. Serve un parere legale su cosa basta (DPIA e parere legale prima del primo hotel, come da CONTESTO).
- **Chi paga i coupon [DA DECIDERE]**: l'app non gestisce conti; al bar il coupon è solo "validato". Finché non si decide chi paga e come si fattura, l'hotel potrebbe offrire consumazioni senza copertura: considerare un tetto per locale/giorno.
- **Cancellazione al check-out**: usa la data dichiarata dall'ospite (nessun PMS); un ospite che mente sulla data tiene i dati più a lungo. Regola da decidere. Se una delle due parti parte, la conversazione sparisce anche per l'altra.
- **Segnalazioni**: se chi segnala o chi è segnalato fa check-out, la segnalazione si chiude e il testo viene cancellato (scelta di privacy): un molestatore che parte sfugge a ogni provvedimento. Valutare con il legale una conservazione minima motivata.
- Chi viene bloccato non lo sa (la conversazione resta visibile ma non può scrivere): protegge chi blocca, ma può confondere. Chi blocca non può scrivere all'altro finché non sblocca.
- Il nickname è unico per hotel (anti-impersonificazione tra ospiti) ma non impedisce di scegliere un nome che sembri dello staff: valutare un'etichetta "staff" nelle risposte dell'hotel (oggi lo staff non scrive in chat pubblica).
- L'hotel non ha un modo di scrivere nella chat pubblica né di sapere chi sia dietro un nickname (non c'è camera): per un provvedimento serio (allontanamento) dovrebbe poterlo fare: punto aperto di prodotto e di privacy.
- Una richiesta rifiutata non si ripete mai per quella coppia durante il soggiorno; il rifiuto non è annullabile.
- Screenshot e inoltro dei messaggi fuori dall'app non sono controllabili.

## Storia del lavoro (per trasparenza)
Il codice in `src/` è stato scritto da due sviluppatori-agenti. Per un mio errore la cartella `src/`, il `package.json`
originale, `public/manifest.webmanifest` e `public/sw.js` sono stati cancellati/sovrascritti e poi ricostruiti
dalle trascrizioni degli agenti (riesecuzione dei soli comandi di scrittura file). La ricostruzione è stata confrontata
con i 22 file sopravvissuti: identici byte per byte. `src/` non ha un riferimento diretto, ma la suite di test e la
prova di fumo che lo usano passano. Un backup dello stato precedente al ripristino è nella cartella di lavoro dell'agente.
Una correzione fatta dopo il ripristino: in `scripts/smoke.mjs` il controllo "QR errato rifiutato" usa ora una
sessione pulita (prima riusava il cookie di un ospite già registrato, caso in cui l'API risponde 200 per idempotenza).

## Punti di prodotto ancora aperti (dai documenti in ../docs)
QR dell'hotel pubblico (limitazione dell'abuso del bonus), chi finanzia il bonus, dati verso Anthropic fuori UE,
società non ancora costituita (niente DPA né dati reali), notifiche push iPhone inaffidabili.


---

## Stato dopo le correzioni (BACKEND, 13 ottobre 2026)

### Cosa è stato eseguito davvero
- `NODE_PATH=/opt/npm-tools/node_modules /opt/npm-tools/node_modules/.bin/tsx --test tests/*.test.ts`: **143 test su 143** (76 preesistenti, adattati all'ingresso con identità senza indebolire le asserzioni; 31 in `hardening.test.ts`; 3 `parity`; 22 `ai`; 10 `supabase`; 1 parità coupon in `social.test.ts`).
- Fumo HTTP (`scripts/harness-server.ts` + `scripts/smoke.mjs`): **tutti i controlli superati** (aggiunti: onboarding senza identità rifiutato, login demo, emergenza con 112 e avviso in reception).
- SQL su Postgres 16 temporaneo (poi cancellato), `scripts/sql-test.sh`: 0001 = 48, 0002 = 82, 0003 = 44, 0004 = 68, parità = 1, concorrenza reale (sessioni parallele) = 18. Prova di mutazione sulla parte SQL.
- `tsc` con stub: nessun errore nuovo nei moduli `src/lib` e nei test (restano solo errori da assenza di `next`/`react`, es. `redirect` non tipato `never` in `server.ts`).

### Contratto API per il frontend (cosa è cambiato)
- **Ingresso con identità**: la demo non è più automatica. Prima di `POST /api/onboarding` serve un'identità: `GET /api/identity/options` (`{mode:'demo'|'supabase', demo:[{id,label}]}`), `POST /api/identity/demo-login {id}` (solo demo; imposta il cookie `ch_ident`), `POST /api/identity/session {accessToken, refreshToken}` (dopo il login Google di Supabase), `GET /api/identity/me` (solo `givenName` e `provider`), `POST /api/identity/logout`.
- `POST /api/onboarding` richiede il cookie `ch_ident`; il campo `name` è **ignorato** (il nome è quello di battesimo dell'identità); `nickname` opzionale; `socialOptIn` vale solo per maggiorenni. Nuovi `reason`/errori: `identity_required` (401), `identity_invalid`, `hotel_coupon_limit` (429), `bonus_hour_cap`, `service_unavailable` (503), `rate_limited` (429).
- Bonus: il valore di `bonus` può essere `'throttled'` (ingresso ok ma niente bonus per il tetto orario): la UI lo tratti come `cap_reached`.
- AI chat (`POST /api/ai/chat`): la risposta può avere `emergency: true` (messaggio fisso con 112, mai passa dai tetti); oltre il tetto di sicurezza è 429 con `emergencyText` da mostrare comunque. Codici nuovi: `daily_limit`, `rate_limited`, `ai_cap`.
- Staff: `GET /api/staff/alerts` (avvisi urgenti), `GET /api/staff/hotels` e `POST /api/staff/select-hotel {hotelId}` per chi lavora in più hotel; la reception vede solo le chat passate all'operatore.
- Token QR: bonus `b.…`, coupon `c.…` (non più `c_`).

### Limiti noti (da non nascondere)
- **Supabase reale e login Google mai eseguiti**: il ramo `supabase` è provato solo con PostgREST/GoTrue simulati e con SQL su Postgres puro. Aspettarsi correzioni al primo collegamento (nomi di funzioni, permessi, formato dei cookie).
- Supabase Auth conserva l'e-mail dell'utente Google in `auth.users`; l'app non la legge né la salva, ma esiste.
- Canali di avviso per le emergenze (webhook `EMERGENCY_WEBHOOK_URL`) non verificati; nessun SMS/push.
- `ru` esiste nei tipi e nei controlli di emergenza, ma **non c'è `messages/ru.json`** (fallback sui testi inglesi) e `supportedLocales` degli hotel è invariato.
- Chi è stato throttled sul bonus (tetto orario) non riceve il bonus; un bonus annullato non riscattato può essere riemesso a un nuovo ingresso.
- I limiti AI nel database (20/min, 100/giorno) sono una rete di sicurezza; l'app applica 12/min e 30/giorno.
- Validazione dell'output AI: controlla link, telefoni, prezzi, orari con minuti e fuga del prompt, non la verità dei fatti.
- Non fatti: MFA staff, retention di `audit_log`/`social_events`, `client_id` di idempotenza su AI/social, `requestId`/metriche/allarmi, Turnstile, prova di carico/Realtime, CSP.
- `src/middleware.ts` è stato toccato (non è tra i file vietati, ma il frontend deve saperlo).
- Variabili d'ambiente nuove in `.env.example`: `CHATHEL_DEMO`, `CHATHEL_DEMO_ALLOW_PRODUCTION`, `IDENTITY_PEPPER` (obbligatoria con Supabase), `TRUSTED_IP_HEADER`, `EMERGENCY_WEBHOOK_URL`, `DEMO_BONUS_PER_HOUR`. Per provare in locale: `CHATHEL_DEMO=1`.

### Fatto / Da fare
**Fatto**: B2 (parte codice), A1, A2, A3, A4, A5, A6, A7 (parte codice), M1, M2, M4, M5, M6, M7, M9, M10, M13, L1-L4; login Google (codice); sociale su Supabase (codice); migrazioni 0003 e 0004; 23 test T-S/T-D e SQL per 0001; suite TS, fumo e SQL verdi.
**Da fare**: collegare un progetto Supabase UE e Google reali e rieseguire tutto; `npm install` + `next build`; `messages/ru.json` (frontend); Turnstile; MFA staff; `client_id` di idempotenza; osservabilità; retention; prova di carico; decisioni dei soci (docs/10 sezione 7).

## Stato dopo le correzioni (FRONTEND, 13 ottobre 2026)

Dettaglio F-01..F-28 in `docs/11-revisione-frontend.md`, sezione "Stato dopo le correzioni (FRONTEND)".

### Cosa è stato eseguito davvero
- Harness e2e senza Next (`scripts/e2e/`): server component reali risolti da un mini-RSC, componenti client reali in Chromium headless, API demo reali. `npm run e2e` esegue `e2e-f01`, `e2e-guest`, `e2e-staff`, `e2e-matrix` (5, 36, 44, 309 controlli, tutti verdi). `npm run i18n` controlla le 4 lingue (681 chiavi). `tsc` con stub: 0 errori. Suite TS: 143/143 (con `NODE_PATH=/opt/npm-tools/node_modules`).

### Limiti noti (da non nascondere)
- Routing, Link, redirect, cookies, metadata sono sostituti del harness: **una prova con `next dev`/`next build` e un telefono vero resta da fare**. Niente SSR/idratazione, middleware, service worker, `next/font`; QR segnaposto; Google e Supabase non provati.
- `messages/ru.json` è una traduzione mia: serve un madrelingua. I contenuti admin (eventi, avvisi, base di conoscenza) non hanno campi in russo.
- Conteggio dei non letti lato client; il pannello hotel non ha un endpoint di conteggio (si aggiorna a ogni navigazione/azione).
- Non provato con uno screen reader; contrasti del tema scuro non misurati (DESIGN).
- Manifest PWA, service worker, `offline.html` non toccati.
- Il test F-01 conta le richieste ma non ho potuto dimostrare che avrebbe fallito sul codice originale.

### Fatto / Da fare (FRONTEND)
Fatto: F-01, F-02, ingresso Google/QR e onboarding con tre consensi, 4 lingue con bandiere, strato sociale completo, logo, accessibilità di base, pannello staff (emergenze, coda, conferme, selezione hotel), barista bonus+coupon, risposte AI con emergenza e passaggio allo staff.
Da fare: prova con Next vero; revisione madrelingua del russo; campi ru nei contenuti admin; PWA (manifest, offline); componente Button unico; misura dei contrasti scuri; prova con screen reader e su iPhone/Safari.
