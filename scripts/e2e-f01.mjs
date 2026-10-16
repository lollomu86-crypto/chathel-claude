// Regressione F-01: BonusQr, CouponQr, SocialPeople e SocialThreads non devono richiamare l'API in ciclo quando l'API risponde con errore.
// (Causa: useErrorText cambiava identita' a ogni render e finiva fra le dipendenze di useCallback/useEffect.)
// Conta le richieste reali del browser in una finestra di 5 s con le API forzate a 500. Uso: node scripts/e2e-f01.mjs
import { startE2eServer } from './e2e/serve.mjs';
import { launch, newCtx, ready, enterAsGuest, check, summary, T, re } from './e2e/lib.mjs';

const srv = await startE2eServer(Number(process.env.PORT || 3204));
const browser = await launch();
const t = T('it');
const MAX = 6; const WINDOW = 5000;
const fail = (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"internal"}' });
let exit = 0;
try {
  const A = await newCtx(browser, { base: srv.base }); const a = await A.ctx.newPage();
  const B = await newCtx(browser, { base: srv.base }); const b = await B.ctx.newPage();
  await enterAsGuest(a, { who: 'Giulia' }); await enterAsGuest(b, { who: 'Marco' });
  // coupon reale tra A e B, per avere un CouponQr da montare
  await b.goto('/stay/social'); await ready(b);
  await b.locator('.person', { hasText: 'Giulia' }).getByRole('button', { name: re(t('social.people.write')) }).click();
  await b.locator('textarea[id^=rq-]').fill('Ciao!'); await b.getByRole('button', { name: re(t('social.people.sendRequest')) }).click();
  await b.getByText(t('social.people.requestSent')).waitFor();
  await a.goto('/stay/social?tab=private'); await ready(a);
  await a.getByRole('button', { name: re(t('social.private.accept')) }).click();
  await a.locator('a.thread-main', { hasText: 'Marco' }).click(); await a.locator('#pm').waitFor();
  await a.getByRole('button', { name: re(t('social.thread.couponsTitle')) }).click();
  await a.getByRole('button', { name: t('social.coupon.kinds.coffee') }).click();
  await a.getByRole('button', { name: re(t('social.thread.couponSend')) }).click();
  await a.locator('.ticket-mine').waitFor();

  const count = async (page, label, apiPart, act) => {
    const seen = [];
    const on = (r) => { if (r.url().includes(apiPart)) seen.push(r.url()); };
    page.on('request', on);
    await page.route(`**/*${apiPart}*`, fail);
    await act();
    await page.waitForTimeout(WINDOW);
    page.off('request', on);
    await page.unroute(`**/*${apiPart}*`);
    check(seen.length >= 1 && seen.length <= MAX, `${label}: ${seen.length} richieste a ${apiPart} in ${WINDOW / 1000} s con API in errore (max ${MAX})`);
  };
  await count(a, 'BonusQr', '/api/guest/bonus-qr', async () => { await a.goto('/stay/bonus'); await ready(a); });
  await count(a, 'SocialPeople', '/api/guest/social-guests', async () => { await a.goto('/stay/social'); await ready(a); });
  await count(a, 'SocialThreads', '/api/guest/social-threads', async () => { await a.goto('/stay/social?tab=private'); await ready(a); });
  await b.goto('/stay/social?tab=private'); await ready(b);
  await b.locator('a.thread-main', { hasText: 'Giulia' }).click(); await b.locator('.ticket-theirs').waitFor();
  await count(b, 'CouponQr', '/api/guest/social-coupon-qr', async () => { await b.getByRole('button', { name: re(t('social.coupon.show')) }).click(); });
  check(await b.getByRole('button', { name: re(t('common.retry')) }).count() >= 0, 'la pagina resta utilizzabile dopo gli errori');
} catch (e) { console.error(e); exit = 1; }
exit = summary() || exit;
await browser.close(); await srv.close();
process.exit(exit);
