// Test de toute l'appli (routes, candidats, fiches, résumés, comparaisons) à 320 et 390 px de large.
// Depuis la racine du dépôt : python3 -m http.server 8790 & puis node outils/test_app.js (Playwright requis).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs = []; let overflow = [];
  for (const w of [320, 390]) {
    const pg = await b.newPage({ viewport: { width: w, height: 800 } });
    pg.on('pageerror', e => errs.push(`${w} ${pg.url().split('#')[1]} : ${e.message}`));
    await pg.goto('http://localhost:8790/index.html'); await pg.waitForTimeout(800);
    const routes = await pg.evaluate(() => {
      const r = ['', 'actu', 'candidats', 'comparer', 'sondages', 'videos', 'methode', 'bref', 'budget', 'kit-promesse'];
      DATA.rubriques.forEach(([k]) => r.push('p-' + k, 'comprendre-r-' + k));
      DATA.themes.forEach(([k]) => { r.push('t-' + k); if (DATA.sujets[k]) r.push('comprendre-' + k); });
      DATA.candidats.forEach(c => r.push('c-' + c.id));
      return r;
    });
    for (const r of routes) {
      await pg.evaluate(h => { location.hash = h; }, r); await pg.waitForTimeout(60);
      const o = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (o > 1) overflow.push(`${w} #${r} +${o}px`);
    }
    // comparaison deux candidats : toutes les paires avec Mélenchon + quelques autres
    const cmp = await pg.evaluate(() => { const out = []; ui.cmpMode = 'deux'; const ids = DATA.candidats.map(c => c.id);
      for (const a of ids) for (const b of ids.slice(0, 6)) { if (a === b) continue; ui.cmpA = a; ui.cmpB = b; ui.cmpTh = 'tous'; try { screenComparer(); } catch (e) { out.push(a + '/' + b + ' ' + e.message); } }
      for (const [k] of DATA.rubriques) { ui.cmpTh = k; ui.cmpA = 'melenchon'; ui.cmpB = 'le-pen'; try { screenComparer(); } catch (e) { out.push(k + ' ' + e.message); } }
      return out; });
    errs.push(...cmp.map(x => `${w} comparer ${x}`));
    if (w === 390) {
      const sheets = await pg.evaluate(() => { const out = []; DATA.propositions.forEach(p => { try { moreHtml(p); } catch (e) { out.push(p.id + ' ' + e.message); } }); return out; });
      errs.push(...sheets.map(x => 'fiche ' + x));
      const st = await pg.evaluate(async () => { const out = []; const keys = [...document.querySelectorAll('[data-story]')].map(x => x.dataset.story);
        location.hash = 'bref'; await new Promise(r => setTimeout(r, 200));
        for (const k of [...new Set([...document.querySelectorAll('[data-story]')].map(x => x.dataset.story))]) { try { openStory(k); } catch (e) { out.push(k + ' ' + e.message); } document.querySelector('.story [data-act="close"], .story .close')?.click(); }
        return out; });
      errs.push(...st.map(x => 'résumé ' + x));
    }
    await pg.close();
  }
  console.log('débordements :', overflow.length ? overflow.join(' ; ') : 'aucun');
  console.log('erreurs :', errs.length ? '\n  ' + [...new Set(errs)].join('\n  ') : 'aucune');
  await b.close();
})();
