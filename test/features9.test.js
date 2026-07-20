/* Le 9 del giro grande: progressione, banca settimanale, menu foto, proteine
   per pasto, micro, integratori, fame serale, profili, cache barcode. */
const { assert, onboard, enableAi, mockAI } = require("./helpers");

module.exports = async function ({ browser, baseURL }) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.route("**openfoodfacts.org/**", (r) => {
      const url = r.request().url();
      if (url.includes("/api/v2/product/")) {
        r.fulfill({ contentType: "application/json", body: JSON.stringify({ status: 1, product: {
          product_name: "Barretta Test", brands: "TestBrand",
          nutriments: { "energy-kcal_100g": 400, "proteins_100g": 30, "carbohydrates_100g": 40, "fat_100g": 10, "fiber_100g": 6, "sugars_100g": 20, "salt_100g": 0.5 },
          serving_quantity: 40 } }) });
      } else r.fulfill({ contentType: "application/json", body: '{"products":[]}' });
    });
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await onboard(page);

    // Proteine per pasto + micro (voce con fibre/zuccheri/sale)
    await page.evaluate(() => {
      addEntry({ meal: "pranzo", name: "Pollo", grams: 200, per100: { kcal: 100, p: 23, c: 0, f: 1, fib: 0, sug: 0, salt: 0.3 } });
      addEntry({ meal: "pranzo", name: "Pane integrale", grams: 100, per100: { kcal: 240, p: 8, c: 45, f: 2, fib: 7, sug: 3, salt: 1.2 } });
    });
    assert((await page.textContent("#microLine")).includes("Fibre 7 g"), "riga fibre/zuccheri/sale presente");
    const chip = await page.textContent(".meal-prot");
    assert(chip.includes("P 54"), "chip proteine del pasto: " + chip);

    // Banca settimanale
    assert((await page.textContent("#weekBank")).includes("Banca settimana"), "banca settimanale mostrata");

    // Fame serale
    await page.click('[data-mood="3"]');
    assert((await page.evaluate(() => state.mood[viewDate])) === 3, "fame serale salvata");
    assert(await page.locator('[data-mood="3"].active').count() === 1, "emoji attiva");

    // Integratori
    await page.click("#suppEdit");
    await page.fill("#suppInput", "Creatina 5 g");
    await page.click("#suppAdd");
    await page.click("#suppEdit"); // fine modifica
    await page.click('[data-supp="Creatina 5 g"]');
    assert((await page.evaluate(() => state.supps.taken[viewDate]["Creatina 5 g"])) === true, "integratore spuntato oggi");

    // Progressione allenamento
    await page.evaluate(() => {
      const d1 = new Date(); d1.setDate(d1.getDate() - 14);
      state.workouts[dateToKey(d1)] = [{ id: "a", type: "pesi", minutes: 60, exercises: [{ name: "Panca piana", sets: 4, reps: 8, kg: 60 }] }];
      state.workouts[todayKey()] = [{ id: "b", type: "pesi", minutes: 60, exercises: [{ name: "panca piana", sets: 4, reps: 8, kg: 70 }] }];
      saveState(); render();
    });
    const progText = await page.textContent("#trainingBody");
    assert(progText.includes("Progressione") && progText.includes("60→70 kg"), "progressione panca 60→70 mostrata");

    // Cache barcode: 1° lookup dalla rete, 2° dalla cache (rete staccata)
    await page.evaluate(() => lookupBarcode("8000000000001"));
    await page.waitForSelector("#amountModal:not(.hidden)");
    await page.click('[data-close="amountModal"]');
    await page.unroute("**openfoodfacts.org/**");
    await page.route("**openfoodfacts.org/**", (r) => r.abort());
    await page.evaluate(() => lookupBarcode("8000000000001"));
    await page.waitForSelector("#amountModal:not(.hidden)");
    assert((await page.textContent("#amountTitle")).includes("Barretta"), "secondo scan servito dalla cache offline");
    await page.click('[data-close="amountModal"]');

    // Menu ristorante da foto (IA simulata)
    await enableAi(page);
    await mockAI(page, { consigli: [{ piatto: "Tagliata di manzo", kcal: 450, perche: "proteine alte, pochi grassi" }] });
    await page.evaluate(() => analyzeMenuPhoto(new File([new Uint8Array([1, 2, 3])], "menu.jpg", { type: "image/jpeg" })));
    await page.waitForFunction(() => document.querySelector("#voiceParsed").textContent.includes("Tagliata"));
    assert(true, "consigli dal menu renderizzati");
    await page.click('[data-close="voiceModal"]');

    // Profili: switch crea storage separato e torna indietro
    await page.evaluate(() => switchProfile("Test"));
    assert((await page.evaluate(() => dayEntries().length)) === 0, "il profilo nuovo parte vuoto");
    await page.evaluate(() => switchProfile("Principale"));
    assert((await page.evaluate(() => dayEntries().length)) >= 2, "il profilo principale ritrova i suoi dati");
  } finally {
    await ctx.close();
  }
};
