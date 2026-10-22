// Genera la coppia di chiavi VAPID per le notifiche push. Uso: node scripts/gen-vapid.mjs
// Le due righe vanno copiate SOLO nelle variabili d'ambiente di Vercel (mai in chat, mai nel codice).
import { createECDH } from 'node:crypto';
const e = createECDH('prime256v1'); e.generateKeys();
console.log('VAPID_PUBLIC_KEY=' + e.getPublicKey().toString('base64url'));
console.log('VAPID_PRIVATE_KEY=' + e.getPrivateKey().toString('base64url'));
console.log('VAPID_SUBJECT=mailto:INSERISCI-LA-TUA-EMAIL');
