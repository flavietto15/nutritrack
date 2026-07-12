/* Backup: esporta i dati, simula un nuovo dispositivo, reimporta e verifica
   che il diario sia recuperato e che un secondo import non duplichi nulla. */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { assert, onboard } = require("./helpers");

module.exports = async function ({ browser, baseURL }) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  try {
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await onboard(page);

    await page.evaluate(() => {
      addEntry({ meal: "pranzo", name: "Petto di pollo", grams: 150, per100: { kcal: 100, p: 23, c: 0, f: 1 } });
      addEntry({ meal: "cena", name: "Riso", grams: 80, per100: { kcal: 350, p: 7, c: 78, f: 1 } });
    });
    const before = await page.evaluate(() => dayEntries().map((e) => e.name));

    // Esporta e cattura il file
    await page.click("#openSettings");
    await page.waitForSelector("#goalsModal:not(.hidden)");
    assert(await page.isVisible("#backupBox"), "il box backup è visibile dopo l'onboarding");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#exportData"),
    ]);
    const tmp = path.join(os.tmpdir(), download.suggestedFilename());
    await download.saveAs(tmp);
    const payload = JSON.parse(fs.readFileSync(tmp, "utf8"));
    assert(payload.app === "nutritrack", "il file è un backup NutriTrack");
    assert(!("apiKey" in (payload.data || {})), "il backup NON contiene la chiave API");

    // Nuovo dispositivo: azzera e ricarica
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    await onboard(page);
    assert((await page.evaluate(() => dayEntries().length)) === 0, "il nuovo dispositivo parte vuoto");

    // Importa
    await page.click("#openSettings");
    await page.waitForSelector("#goalsModal:not(.hidden)");
    await page.setInputFiles("#importFile", tmp);
    await page.waitForFunction(() => /importato|già tutti/.test(document.querySelector("#backupStatus").textContent), { timeout: 4000 });
    const after = await page.evaluate(() => dayEntries().map((e) => e.name));
    assert(JSON.stringify(after.sort()) === JSON.stringify(before.sort()), "i dati sono stati recuperati dal backup");

    // Re-import: nessun duplicato (fusione non distruttiva)
    await page.setInputFiles("#importFile", tmp);
    await page.waitForFunction(() => document.querySelector("#backupStatus").textContent.length > 0, { timeout: 4000 });
    assert((await page.evaluate(() => dayEntries().length)) === before.length, "un secondo import non duplica le voci");

    fs.unlinkSync(tmp);
  } finally {
    await ctx.close();
  }
};
