// Utilita' comuni degli script e2e: browser, contesti (viewport/tema/lingua), raccolta errori di console, screenshot.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(process.env.PW_MODULES || '/opt/npm-tools/node_modules/');
export const { chromium } = require('playwright');
export const SHOTS = process.env.E2E_SHOTS || join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.e2e-shots');
mkdirSync(SHOTS, { recursive: true });

export async function launch() {
  return chromium.launch({ ...(process.env.CHROMIUM === 'bundled' ? {} : { executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }), args: ['--no-sandbox'] });
}
/** Contesto con viewport, tema e lingua del browser; service worker bloccato; raccoglie errori di console e di pagina. */
export async function newCtx(browser, { w = 390, h = 844, dark = false, lang = 'it-IT', base } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light', locale: lang, serviceWorkers: 'block', deviceScaleFactor: 1, baseURL: base, hasTouch: w < 600 });
  const errors = [];
  ctx.on('page', (p) => {
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
    p.on('pageerror', (e) => errors.push(`[pageerror] ${String(e.message).slice(0, 300)}`));
  });
  return { ctx, errors };
}
/** Screenshot. Pagina intera: il viewport si allunga per un attimo, cosi' la barra fissa in basso non copre il contenuto. */
export const shot = async (page, name, full = true) => {
  const vp = page.viewportSize();
  if (full && vp) {
    const h = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    if (h > vp.height) await page.setViewportSize({ width: vp.width, height: Math.min(h, 3000) });
    await page.screenshot({ path: join(SHOTS, `${name}.png`) });
    await page.setViewportSize(vp);
  } else await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};
import { readFileSync } from 'node:fs';
const MSG = {};
/** Traduttore per gli script: legge messages/<lingua>.json, cosi' i test non dipendono da testi scritti a mano. */
export function T(lang) {
  MSG[lang] ??= JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'messages', `${lang}.json`), 'utf8'));
  return (key, vars = {}) => String(key.split('.').reduce((a, k) => a?.[k], MSG[lang]) ?? `??${key}`).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}
export const re = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

let pass = 0; const fails = [];
export const check = (cond, msg) => { if (cond) { pass++; console.log('  ok  ', msg); } else { fails.push(msg); console.log('  FAIL', msg); } };
export const summary = () => { console.log(`\n${pass} controlli ok, ${fails.length} falliti`); if (fails.length) console.log(fails.map((f) => ' - ' + f).join('\n')); return fails.length; };
export const ready = (page) => page.waitForFunction(() => window.__chReady === true);

/** Ingresso ospite dal QR come farebbe una persona: identita' demo, nickname, consensi, informativa. */
export async function enterAsGuest(page, { slug = 'demo', k = 'demo-qr-token', who = 'Giulia', nick, adult = true, consents = { list: true, chat: true, dm: true } } = {}) {
  await page.goto(`/h/${slug}?k=${k}`); await ready(page);
  await page.locator('.card button.btn-primary').first().click();
  await page.locator('[role=group] button', { hasText: who }).click();
  await page.locator('#nick').waitFor();
  if (nick) await page.locator('#nick').fill(nick);
  if (adult) {
    await page.locator('label.check', { hasText: /18/ }).locator('input').check();
    if (consents.list) await page.locator('#ob-list').check();
    if (consents.chat) await page.locator('#ob-chat').check();
    if (consents.dm) await page.locator('#ob-dm').check();
  }
  await page.locator('label.check input[required]').check();
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(/\/stay/);
  await page.locator('main#main').waitFor();
}
