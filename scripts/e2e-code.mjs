// Ingresso con il codice numerico dell'hotel: schermata iniziale -> 6 cifre -> procedura d'ingresso -> app. Uso: node scripts/e2e-code.mjs
import { startE2eServer } from './e2e/serve.mjs';
import { launch, newCtx, ready, check, summary, T, re } from './e2e/lib.mjs';

const srv = await startE2eServer(Number(process.env.PORT || 3206));
const browser = await launch();
const t = T('it');
let exit = 0;
try {
  const A = await newCtx(browser, { base: srv.base }); const a = await A.ctx.newPage();
  await a.goto('/'); await ready(a);
  const input = a.locator('#hotel-code');
  const go = a.getByRole('button', { name: re(t('landing.codeGo')) });
  check(await go.isDisabled(), 'senza cifre il pulsante e\' disattivato');
  await input.fill('12ab34');
  check(await input.inputValue() === '1234', 'accetta solo cifre');
  await input.fill('999999');
  await go.click();
  await a.getByRole('alert').filter({ hasText: t('errors.invalid_code') }).waitFor();
  check(true, 'codice sbagliato: messaggio chiaro, si resta qui');
  check(!/\/h\//.test(a.url()), 'codice sbagliato: nessun ingresso');
  await input.fill('482915');
  await go.click();
  await a.waitForURL(/\/h\/demo\?k=482915/);
  await ready(a);
  check(true, 'codice giusto: si apre l\'ingresso dell\'hotel');
  // da qui la procedura e' quella del QR: Google (demo), nickname, consensi
  await a.locator('.card button.btn-primary').first().click();
  await a.locator('[role=group] button', { hasText: 'Giulia' }).click();
  await a.locator('#nick').waitFor();
  await a.locator('label.check', { hasText: /18/ }).locator('input').check();
  await a.locator('label.check input[required]').check();
  await a.locator('form button[type=submit]').click();
  await a.waitForURL(/\/stay/);
  await a.locator('main#main').waitFor();
  check(true, 'entrata nell\'app con il codice dell\'hotel');
  check(A.errors.filter((e) => !/status of 401|favicon|Service Worker/.test(e)).length === 0, 'nessun errore di console: ' + A.errors.join(' | '));
  await A.ctx.close();
} catch (e) { console.error(e); exit = 1; }
finally { await browser.close(); await srv.close?.(); }
exit = summary() || exit;
process.exit(exit);
