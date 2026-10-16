// Verifica i18n: (1) it/en/de/ru hanno le stesse chiavi; (2) ogni chiave usata nel codice esiste in tutte le lingue.
// Uso: node scripts/check-i18n.mjs   (exit 1 se manca qualcosa)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['it', 'en', 'de', 'ru'];
const flat = (o, p = '', out = new Set()) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object') flat(v, key, out); else out.add(key);
  }
  return out;
};
const sets = {};
for (const l of LANGS) sets[l] = flat(JSON.parse(readFileSync(join(root, 'messages', `${l}.json`), 'utf8')));
let bad = 0;
const all = new Set(LANGS.flatMap((l) => [...sets[l]]));
for (const l of LANGS) {
  const miss = [...all].filter((k) => !sets[l].has(k));
  if (miss.length) { bad += miss.length; console.error(`[${l}] mancano ${miss.length} chiavi:\n  ${miss.slice(0, 40).join('\n  ')}${miss.length > 40 ? '\n  ...' : ''}`); }
}
// placeholder {x} coerenti tra lingue
const raw = {};
for (const l of LANGS) raw[l] = JSON.parse(readFileSync(join(root, 'messages', `${l}.json`), 'utf8'));
const get = (o, k) => k.split('.').reduce((a, p) => (a ? a[p] : undefined), o);
for (const k of sets.it) {
  const ph = (l) => [...String(get(raw[l], k) ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const l of LANGS.slice(1)) if (sets[l].has(k) && ph(l) !== ph('it')) { bad++; console.error(`[${l}] segnaposto diversi in ${k}: it={${ph('it')}} ${l}={${ph(l)}}`); }
}
// chiavi usate nel codice
const walk = (d, out = []) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(tsx?|mjs)$/.test(f)) out.push(p);
  }
  return out;
};
const used = new Map();
for (const f of walk(join(root, 'src'))) {
  if (f.includes('/src/lib/') && !f.includes('/src/lib/server')) continue;
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*(['`])([\w.${}\-?: ]+?)\1/g)) {
    let key = m[2];
    if (key.includes('${')) { key = key.slice(0, key.indexOf('${')); if (!key) continue; if (![...all].some((k) => k.startsWith(key))) used.set(`${key}* (${f})`, 1); continue; }
    if (!all.has(key)) used.set(`${key} (${f.replace(root + '/', '')})`, 1);
  }
}
if (used.size) { bad += used.size; console.error(`Chiavi usate nel codice ma assenti:\n  ${[...used.keys()].join('\n  ')}`); }
if (bad) { console.error(`\ni18n: ${bad} problemi`); process.exit(1); }
console.log(`i18n ok: ${all.size} chiavi x ${LANGS.length} lingue, nessuna chiave mancante, segnaposto coerenti.`);
