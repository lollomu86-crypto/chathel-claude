// E2E staff e barista: pannello hotel (emergenze, coda segnalazioni, selezione hotel, numeri) e vista barista (bonus e coupon).
// I dati arrivano da due ospiti veri creati dall'interfaccia. Uso: node scripts/e2e-staff.mjs
import { startE2eServer } from './e2e/serve.mjs';
import { launch, newCtx, shot, ready, enterAsGuest, check, summary, T, re } from './e2e/lib.mjs';

const srv = await startE2eServer(Number(process.env.PORT || 3202));
const browser = await launch();
const t = T('it');
const noise = (e) => !/Service Worker|status of 401|favicon/.test(e);
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
let exit = 0;
try {
  console.log('\n# Preparazione: due ospiti, emergenza, segnalazione, bonus, coupon');
  const A = await newCtx(browser, { base: srv.base }); const a = await A.ctx.newPage();
  const B = await newCtx(browser, { base: srv.base }); const b = await B.ctx.newPage();
  await enterAsGuest(a, { who: 'Giulia' }); await enterAsGuest(b, { who: 'Marco' });
  await a.goto('/stay/social?tab=chat'); await ready(a);
  await a.locator('#pub').fill('Messaggio da moderare'); await a.locator('#pub').press('Enter');
  await a.locator('.bubble-me').waitFor();
  await b.goto('/stay/social?tab=chat'); await ready(b);
  await b.locator('.bubble-other', { hasText: 'Messaggio da moderare' }).waitFor();
  await b.getByRole('button', { name: re(t('social.chat.moreAbout', { name: 'Giulia' })) }).click();
  await b.getByRole('menuitem', { name: re(t('social.chat.report')) }).click();
  await b.locator('#report-why').selectOption('harassment');
  await b.getByRole('button', { name: re(t('social.chat.reportSend')) }).click();
  await b.getByText(t('social.chat.reportThanks')).waitFor();
  await a.goto('/stay/reception'); await ready(a);
  await a.locator('textarea').fill('Aiuto, emergenza: una persona ha perso i sensi'); await a.locator('textarea').press('Enter');
  await a.locator('.emergency').waitFor();
  const bonusTok = (await (await a.request.post('/api/guest/bonus-qr', { data: {} })).json()).qr.token;
  // coupon: B chiede, A accetta e invia, B apre il QR
  await b.goto('/stay/social'); await ready(b);
  await b.locator('.person', { hasText: 'Giulia' }).getByRole('button', { name: re(t('social.people.write')) }).click();
  await b.locator('textarea[id^=rq-]').fill('Ciao!'); await b.getByRole('button', { name: re(t('social.people.sendRequest')) }).click();
  await b.getByText(t('social.people.requestSent')).waitFor();
  await a.goto('/stay/social?tab=private'); await ready(a);
  await a.getByRole('button', { name: re(t('social.private.accept')) }).click();
  await a.locator('a.thread-main', { hasText: 'Marco' }).click(); await a.locator('#pm').waitFor();
  await a.getByRole('button', { name: re(t('social.thread.couponsTitle')) }).click();
  await a.getByRole('button', { name: t('social.coupon.kinds.aperitif') }).click();
  await a.getByRole('button', { name: re(t('social.thread.couponSend')) }).click();
  await a.locator('.ticket-mine').waitFor();
  await b.goto('/stay/social?tab=private'); await ready(b);
  await b.locator('a.thread-main', { hasText: 'Giulia' }).click(); await b.locator('.ticket-theirs').waitFor();
  const qrP = b.waitForResponse((r) => r.url().includes('social-coupon-qr'));
  await b.getByRole('button', { name: re(t('social.coupon.show')) }).click();
  const couponTok = (await (await qrP).json()).qr.token;
  check(bonusTok && couponTok.startsWith('c.'), 'dati pronti: token bonus e token coupon');

  console.log('\n# Pannello hotel (390 px, chiaro)');
  const S = await newCtx(browser, { base: srv.base }); const s = await S.ctx.newPage();
  await s.goto('/admin'); await ready(s);
  await s.locator('#email').fill('admin@demo.chathel.test'); await s.locator('#pw').fill('demo-admin');
  await shot(s, 's-01-login');
  await s.getByRole('button', { name: re(t('staff.signIn')) }).click();
  await s.locator('.admin-nav').waitFor();
  const banner = s.locator('.emergency');
  await banner.waitFor({ timeout: 15000 });
  check(/1/.test(await banner.innerText()), 'avviso prioritario di emergenza in cima al pannello: ' + (await banner.innerText()).replace(/\n/g, ' '));
  check(await s.locator('h1').count() === 1, 'una sola intestazione h1 nella pagina');
  await s.waitForFunction(() => /^\(\d+\)/.test(document.title), null, { timeout: 5000 }).catch(() => undefined);
  check(/^\(\d+\)/.test(await s.title()), 'il titolo della scheda porta il numero degli avvisi: ' + await s.title());
  await shot(s, 's-02-dashboard');
  const navTxt = await s.locator('.admin-nav').innerText();
  check(/\d/.test(navTxt), 'la navigazione mostra i conteggi da gestire: ' + navTxt.replace(/\n/g, ' | '));

  await s.goto('/admin/inbox'); await ready(s);
  check(await s.locator('.badge-err', { hasText: t('admin.inbox.urgent') }).count() >= 1, 'in coda la conversazione di emergenza e\' marcata urgente');
  check(await s.locator('article.card').first().getAttribute('class').then((c) => /card-urgent/.test(c)), 'e\' la prima della coda');
  await shot(s, 's-03-inbox');
  await s.locator('textarea').first().fill('Arriviamo subito, abbiamo chiamato il 112.');
  await s.getByRole('button', { name: re(t('admin.inbox.reply')) }).last().click();
  await s.getByText('Arriviamo subito').waitFor();
  check(true, 'lo staff risponde all\'emergenza');
  await a.goto('/stay/reception'); await ready(a);
  await a.locator('.bubble-staff', { hasText: 'Arriviamo subito' }).waitFor();
  check(true, 'l\'ospite riceve la risposta dello staff nella chat');
  await s.getByRole('button', { name: re(t('admin.inbox.close')) }).first().click();
  await s.waitForTimeout(600);

  await s.goto('/admin/social'); await ready(s);
  await s.getByText('Messaggio da moderare').first().waitFor();
  check(await s.locator('.badge', { hasText: t('social.report.harassment') }).count() >= 1, 'la segnalazione compare in coda con il motivo');
  await shot(s, 's-04-social');
  await s.getByRole('button', { name: re(t('admin.social.actions.hide')) }).first().click();
  await s.waitForTimeout(500);
  await s.getByRole('button', { name: re(t('admin.social.actions.mute')) }).first().click();
  const dlg = s.locator('dialog[open]');
  await dlg.waitFor();
  check(await dlg.getByText(t('admin.social.confirm.mute.title')).count() === 1, 'silenziare chiede conferma con un dialogo (non window.confirm)');
  await shot(s, 's-05-confirm');
  await dlg.getByRole('button', { name: re(t('admin.social.actions.mute')) }).click();
  await s.locator('.badge-warn', { hasText: t('admin.social.badge.muted') }).first().waitFor();
  check(true, 'dopo la conferma l\'ospite risulta silenziato');
  await b.goto('/stay/social?tab=chat'); await ready(b);
  // Giulia silenziata: scrivere in chat deve essere rifiutato con messaggio chiaro
  await a.goto('/stay/social?tab=chat'); await ready(a);
  await a.locator('#pub').waitFor();
  check(await a.locator('#pub').isDisabled(), 'l\'ospite silenziato non puo\' scrivere (campo disattivato)');
  const why = a.locator('.notice').filter({ hasText: /sospeso|silenzi/i });
  check(await why.count() >= 1, 'e un avviso visibile spiega il perche\': ' + (await a.locator('.notice').allInnerTexts()).join(' | ').replace(/\n/g, ' '));
  await shot(a, 'g-12-muted');
  await s.goto('/admin/social'); await ready(s);
  check(await s.getByRole('button', { name: re(t('admin.social.reports.actioned')) }).count() === 0, 'nascondere il messaggio ha chiuso la segnalazione: la coda aperta e\' vuota');
  await shot(s, 's-05b-social-after');

  console.log('\n# Selezione hotel (risposte simulate: la demo ha un solo hotel)');
  const calls = [];
  await s.route('**/api/staff/hotels', (r) => r.fulfill({ json: { ok: true, hotels: [{ id: 'h1', name: 'Hotel Demo Alba', role: 'hotel_admin' }, { id: 'h2', name: 'Hotel Secondo', role: 'reception' }] } }));
  await s.route('**/api/staff/select-hotel', (r) => { calls.push(r.request().postData()); r.fulfill({ json: { ok: true } }); });
  await s.goto('/admin/events'); await ready(s);
  await s.locator('#hotel-sel').waitFor();
  check(await s.locator('#hotel-sel option').count() === 2, 'con due hotel compare il selettore');
  await s.locator('#hotel-sel').selectOption('h2');
  await s.waitForTimeout(300);
  check(calls.length === 1 && /h2/.test(calls[0]), 'la scelta chiama select-hotel con l\'id: ' + calls[0]);
  await shot(s, 's-06-hotelswitch');
  await s.unroute('**/api/staff/hotels'); await s.unroute('**/api/staff/select-hotel');

  console.log('\n# Pagine del pannello a 390 e 1100 px, chiaro e scuro');
  for (const [w, dark] of [[390, false], [1100, true]]) {
    const X = await newCtx(browser, { base: srv.base, w, h: w < 600 ? 844 : 900, dark });
    const x = await X.ctx.newPage();
    await x.goto('/admin'); await ready(x);
    await x.locator('#email').fill('admin@demo.chathel.test'); await x.locator('#pw').fill('demo-admin');
    await x.getByRole('button', { name: re(t('staff.signIn')) }).click(); await x.locator('.admin-nav').waitFor();
    for (const path of ['/admin', '/admin/inbox', '/admin/social', '/admin/events', '/admin/services', '/admin/ai', '/admin/notifications', '/admin/settings']) {
      await x.goto(path); await ready(x); await x.waitForTimeout(400);
      check(!(await overflow(x)), `${path} @${w}${dark ? ' scuro' : ''}: nessuno scroll orizzontale`);
      await shot(x, `s-p${path.replace(/\//g, '-')}-${w}${dark ? '-dark' : ''}`);
    }
    check(X.errors.filter(noise).length === 0, `console pulita @${w}: ` + X.errors.filter(noise).join(' | '));
    await X.ctx.close();
  }

  console.log('\n# Vista barista');
  const Br = await newCtx(browser, { base: srv.base }); const br = await Br.ctx.newPage();
  await br.goto('/bar'); await ready(br);
  await br.locator('#email').fill('bar@demo.chathel.test'); await br.locator('#pw').fill('demo-bar');
  await br.getByRole('button', { name: re(t('staff.signIn')) }).click();
  await br.getByRole('button', { name: re(t('bar.scan')) }).waitFor();
  await shot(br, 'b-01-bar');
  const result = br.locator('.bar-result');
  await br.goto(`/bar#${bonusTok}`); await ready(br);
  await result.waitFor();
  check(await result.evaluate((e) => e.classList.contains('bar-ok')), 'bonus valido: esito verde');
  check(await result.locator('svg').count() === 1 && !/[✓✕]/.test(await result.innerText()), 'l\'esito usa un\'icona, non caratteri unicode');
  await shot(br, 'b-02-bonus-ok');
  await br.getByRole('button', { name: re(t('bar.next')) }).click();
  await br.locator('#manual').fill(bonusTok); await br.getByRole('button', { name: re(t('bar.validate')) }).click();
  await result.waitFor();
  check(await result.evaluate((e) => e.classList.contains('bar-no')) && /Già usato/.test(await result.innerText()), 'secondo uso dello stesso bonus: rifiutato con l\'ora');
  await shot(br, 'b-03-bonus-used');
  await br.getByRole('button', { name: re(t('bar.next')) }).click();
  await br.locator('#manual').fill(couponTok); await br.getByRole('button', { name: re(t('bar.validate')) }).click();
  await result.waitFor();
  const ctext = await result.innerText();
  check(await result.evaluate((e) => e.classList.contains('bar-ok')) && /Aperitivo/.test(ctext) && /Giulia/.test(ctext) && /Marco/.test(ctext), 'coupon valido: tipo, destinatario e mittente: ' + ctext.replace(/\n/g, ' '));
  await shot(br, 'b-04-coupon-ok');
  await br.getByRole('button', { name: re(t('bar.next')) }).click();
  await br.locator('#manual').fill('c.nonvalido'); await br.getByRole('button', { name: re(t('bar.validate')) }).click();
  await result.waitFor();
  check(await result.evaluate((e) => e.classList.contains('bar-no')), 'codice falso: rifiutato');
  await br.getByRole('button', { name: re(t('bar.next')) }).click();
  check(/3/.test(await br.locator('.bar-count').innerText()) || /[1-9]/.test(await br.locator('.bar-count').innerText()), 'contatore del turno: ' + await br.locator('.bar-count').innerText());
  await Br.ctx.setOffline(true);
  await br.locator('#manual').fill('qualcosa'); await br.getByRole('button', { name: re(t('bar.validate')) }).click();
  await br.getByText(t('bar.offline')).waitFor();
  check(true, 'offline: nessuna validazione, messaggio chiaro');
  await Br.ctx.setOffline(false);
  check(Br.errors.filter(noise).length === 0, 'console pulita per il barista: ' + Br.errors.filter(noise).join(' | '));
  check(S.errors.filter(noise).length === 0, 'console pulita per lo staff: ' + S.errors.filter(noise).join(' | '));
} catch (e) { console.error(e); exit = 1; }
exit = summary() || exit;
await browser.close(); await srv.close();
process.exit(exit);
