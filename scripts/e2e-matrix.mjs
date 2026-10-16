// E2E matrice: ospite su 4 combinazioni (viewport, tema, lingua) e su tutte le pagine; controlli di layout, tocco, nomi, chiavi, focus.
// Uso: node scripts/e2e-matrix.mjs
import { startE2eServer } from './e2e/serve.mjs';
import { launch, newCtx, shot, ready, enterAsGuest, check, summary } from './e2e/lib.mjs';

const srv = await startE2eServer(Number(process.env.PORT || 3203));
const browser = await launch();
const noise = (e) => !/Service Worker|status of 401|favicon/.test(e);
const COMBOS = [
  { w: 390, dark: false, lang: 'it-IT', tag: 'it', who: 'Giulia' },
  { w: 390, dark: true, lang: 'en-US', tag: 'en', who: 'Marco' },
  { w: 1100, dark: false, lang: 'de-DE', tag: 'de', who: 'Sofia' },
  { w: 1100, dark: true, lang: 'ru-RU', tag: 'ru', who: 'Luca' },
];
const PAGES = ['/stay', '/stay/bonus', '/stay/events', '/stay/book', '/stay/reception', '/stay/social', '/stay/social?tab=chat', '/stay/social?tab=private', '/stay/social?tab=settings', '/stay/inbox', '/stay/profile', '/privacy'];

const audit = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('.sr-only, [hidden], dialog:not([open])'); };
  const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.textContent || e.getAttribute('title') || (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent) || e.closest('label')?.textContent || '').trim();
  const small = [], unnamed = [];
  for (const e of document.querySelectorAll('a[href], button, select, textarea, input:not([type=hidden]), [role=tab], [role=menuitem]')) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    const inline = e.tagName === 'A' && e.closest('p, li, span.hint, .hint, .muted') && getComputedStyle(e).display === 'inline';
    const lab = e.type === 'checkbox' || e.type === 'radio' ? (e.closest('label') || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e) : e;
    const box = lab === e ? r : (() => { const l = lab.getBoundingClientRect(); return l.height > r.height ? l : r; })();
    if (!inline && (box.height < 43.5 || box.width < 43.5) && !(e.tagName === 'A' && e.classList.contains('skip-link'))) small.push(`${e.tagName.toLowerCase()}.${e.className || ''}[${name(e).slice(0, 20)}] ${Math.round(box.width)}x${Math.round(box.height)}`);
    if (!name(e) && !(e.tagName === 'INPUT' && e.type === 'file')) unnamed.push(`${e.tagName.toLowerCase()}.${e.className}`);
  }
  const imgs = [...document.images].filter((i) => !i.hasAttribute('alt')).length;
  const leak = (document.body.innerText.match(/\b(common|nav|home|social|admin|bar|book|events|reception|profile|consent|onboarding|errors)\.[a-zA-Z]+(\.[a-zA-Z]+)*\b/g) || []).filter((k) => !/\.(test|com|it)$/.test(k));
  const h1 = document.querySelectorAll('h1').length;
  return { small, unnamed, imgs, leak, h1, overflow: document.documentElement.scrollWidth > window.innerWidth + 1, lang: document.documentElement.lang };
};

let exit = 0;
const allSmall = new Map();
try {
  for (const c of COMBOS) {
    console.log(`\n# ${c.tag} ${c.w}px ${c.dark ? 'scuro' : 'chiaro'}`);
    const X = await newCtx(browser, { base: srv.base, w: c.w, h: c.w < 600 ? 844 : 900, dark: c.dark, lang: c.lang });
    const p = await X.ctx.newPage();
    await p.goto('/'); await ready(p);
    check((await p.evaluate(() => document.documentElement.lang)) === c.tag, `lingua scelta dal browser: ${c.tag}`);
    await shot(p, `m-landing-${c.tag}-${c.w}${c.dark ? '-dark' : ''}`);
    await enterAsGuest(p, { who: c.who });
    for (const path of PAGES) {
      await p.goto(path); await ready(p); await p.waitForTimeout(450);
      const r = await p.evaluate(audit);
      const id = `${path} (${c.tag})`;
      check(!r.overflow, `${id}: nessuno scroll orizzontale`);
      check(r.leak.length === 0, `${id}: nessuna chiave di traduzione a vista ${r.leak.slice(0, 3)}`);
      check(r.unnamed.length === 0, `${id}: ogni controllo ha un nome ${r.unnamed.slice(0, 3)}`);
      check(r.imgs === 0, `${id}: immagini con alt`);
      check(r.h1 === 1, `${id}: una sola h1 (${r.h1})`);
      check(r.lang === c.tag, `${id}: html lang=${r.lang}`);
      for (const s of r.small) allSmall.set(`${path} :: ${s}`, 1);
      await shot(p, `m${path.replace(/[\/?=]/g, '-')}-${c.tag}-${c.w}${c.dark ? '-dark' : ''}`);
    }
    const consoleBefore = X.errors.filter(noise);
    // pagine di sistema: 404, caricamento, errore (reale: pagina che fallisce; prova: error.tsx montato)
    await p.goto('/non-esiste'); await ready(p);
    check((await p.locator('h1').count()) === 1 && (await p.locator('a[href="/"]').count()) >= 1, `404 tradotta con h1 e ritorno alla home (${c.tag})`);
    await shot(p, `m-404-${c.tag}-${c.w}${c.dark ? '-dark' : ''}`);
    await p.goto('/stay?__e2e=loading'); await ready(p); await shot(p, `m-loading-${c.tag}-${c.w}${c.dark ? '-dark' : ''}`);
    await p.goto('/stay?__e2e=error'); await ready(p);
    check(await p.getByRole('button').filter({ hasText: /\S/ }).count() >= 1, `error.tsx mostra un'azione per riprovare (${c.tag})`);
    await shot(p, `m-error-${c.tag}-${c.w}${c.dark ? '-dark' : ''}`);
    // tastiera: Tab porta il focus su un elemento con contorno visibile
    await p.goto('/stay'); await ready(p);
    await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
    const fo = await p.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { tag: e.tagName, style: cs.outlineStyle, w: cs.outlineWidth }; });
    check(fo.style !== 'none' && parseFloat(fo.w) >= 2, `focus visibile da tastiera (${fo.tag} ${fo.style} ${fo.w})`);
    check(consoleBefore.length === 0, `console pulita nelle pagine normali: ${consoleBefore.join(' | ')}`);
    await X.ctx.close();
  }
  console.log(`\n# Aree di tocco sotto i 44 px: ${allSmall.size}`);
  for (const k of allSmall.keys()) console.log('   ' + k);
  check(allSmall.size === 0, 'tutte le aree di tocco sono almeno 44x44 px');
} catch (e) { console.error(e); exit = 1; }
exit = summary() || exit;
await browser.close(); await srv.close();
process.exit(exit);
