/* Peso corporeo (valore, trend, sparkline, profilo aggiornato), "Ripeti pasto",
   tip post-allenamento e presenza dei pezzi PWA (manifest + service worker). */
const { assert, onboard } = require("./helpers");

module.exports = async function ({ browser, baseURL }) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await onboard(page);

    // --- Peso: registra oggi + uno storico di 7 giorni fa ---
    await page.evaluate(() => {
      const d = new Date(); d.setDate(d.getDate() - 7);
      state.weights[dateToKey(d)] = 76.4;
      saveState();
    });
    await page.fill("#weightInput", "75,4");
    await page.click("#weightSave");
    assert((await page.textContent("#weightValue")) === "75,4", "il peso registrato è mostrato (75,4)");
    const trend = await page.textContent("#weightTrend");
    assert(trend.includes("−1 kg") && trend.includes("7"), "trend −1 kg in 7 giorni: " + trend);
    assert((await page.$$eval("#weightSpark polyline", (n) => n.length)) === 1, "sparkline disegnata");
    const profW = await page.evaluate(() => state.profile.weight);
    assert(profW === 75.4, "il profilo (per coach e stime) usa il peso nuovo");

    // --- Ripeti pasto: ieri a pranzo c'era il pollo → oggi un tap lo copia ---
    await page.evaluate(() => {
      const d = new Date(); d.setDate(d.getDate() - 1);
      state.days[dateToKey(d)] = [{ id: "x1", meal: "pranzo", name: "Petto di pollo", grams: 150, per100: { kcal: 100, p: 23, c: 0, f: 1 } }];
      saveState(); render();
    });
    const btn = page.locator('[data-repeat="pranzo"]');
    assert(await btn.isVisible(), "il pasto vuoto propone «Ripeti pranzo di ieri»");
    await btn.click();
    const names = await page.evaluate(() => dayEntries().filter((e) => e.meal === "pranzo").map((e) => e.name));
    assert(names.includes("Petto di pollo"), "le voci di ieri sono state copiate");

    // --- Allenamento → dieta: dopo una sessione il tip spinge sui carboidrati ---
    await page.evaluate(() => {
      state.workouts[todayKey()] = [{ id: "w1", type: "pesi", minutes: 60, exercises: [], note: "" }];
      saveState(); render();
    });
    const tip = await page.textContent("#tipLine");
    assert(tip.includes("bruciato") && tip.includes("carboidrati"), "tip post-allenamento presente: " + tip.slice(0, 60));

    // --- PWA: manifest e service worker raggiungibili, index li collega ---
    for (const f of ["manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]) {
      const st = await page.evaluate((u) => fetch(u).then((r) => r.status), baseURL + f);
      assert(st === 200, `${f} servito (HTTP ${st})`);
    }
    const html = await page.content();
    assert(html.includes("manifest.webmanifest") && html.includes("apple-touch-icon"), "index collega manifest e icona iOS");

    // --- Il backup ora include peso e allenamenti ---
    const payload = await page.evaluate(() => backupPayload().data);
    assert(payload.weights && payload.workouts, "backup con weights e workouts");
  } finally {
    await ctx.close();
  }
};
