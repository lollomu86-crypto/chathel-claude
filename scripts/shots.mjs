// Schermate di revisione design: node scripts/shots.mjs <cartella> [dark]  (harness locale o E2E_BASE)
import { startE2eServer } from './e2e/serve.mjs';
import { launch, newCtx, ready, enterAsGuest } from './e2e/lib.mjs';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] || '/tmp/shots'; const dark = process.argv[3] === 'dark';
mkdirSync(out, { recursive: true });
const srv = await startE2eServer(Number(process.env.PORT || 3207));
const browser = await launch();
try {
  const A = await newCtx(browser, { base: srv.base, dark }); const a = await A.ctx.newPage();
  await a.goto('/'); await ready(a); await a.screenshot({ path: `${out}/01-landing.png`, fullPage: true });
  await a.goto('/h/demo?k=482915'); await ready(a); await a.screenshot({ path: `${out}/02-entry.png`, fullPage: true });
  await enterAsGuest(a, { who: 'Giulia', k: '482915' });
  const pages = [['03-home', '/stay'], ['04-bonus', '/stay/bonus'], ['05-events', '/stay/events'], ['06-book', '/stay/book'], ['07-reception', '/stay/reception'], ['08-social', '/stay/social?tab=chat'], ['09-profile', '/stay/profile']];
  for (const [n, p] of pages) { await a.goto(p); await ready(a); await a.waitForTimeout(400); await a.screenshot({ path: `${out}/${n}.png`, fullPage: true }); }
  const S = await newCtx(browser, { base: srv.base, dark, w: 1100, h: 800 }); const s = await S.ctx.newPage();
  await s.goto('/admin/login'); await ready(s); await s.screenshot({ path: `${out}/10-admin-login.png` });
  await s.locator('input[type=email]').fill('admin@demo.chathel.test'); await s.locator('input[type=password]').fill('demo-admin'); await s.locator('form button[type=submit]').click();
  await s.waitForURL(/\/admin/); await ready(s); await s.waitForTimeout(500); await s.screenshot({ path: `${out}/11-admin-home.png` });
  const B = await newCtx(browser, { base: srv.base, dark }); const b = await B.ctx.newPage();
  await b.goto('/bar'); await ready(b); await b.screenshot({ path: `${out}/12-bar-login.png`, fullPage: true });
} catch (e) { console.error(e); } finally { await browser.close(); await srv.close?.(); }
