/* Nutrizionista IA: un piatto composto viene scomposto in ingredienti e,
   correggendo il peso della base, gli altri si riproporzionano. */
const { assert, onboard, enableAi, mockAI, mockOFF } = require("./helpers");

const AI = { alimenti: [
  { nome: "Pasta", marca: "", confezionato: false, piatto: "Carbonara", pasto: "pranzo", pezzi: 0, grammi_a_pezzo: 0, grammi: 100, kcal_100g: 353, proteine_100g: 12, carboidrati_100g: 72, grassi_100g: 1.5 },
  { nome: "Guanciale", marca: "", confezionato: false, piatto: "Carbonara", pasto: "pranzo", pezzi: 0, grammi_a_pezzo: 0, grammi: 35, kcal_100g: 655, proteine_100g: 13, carboidrati_100g: 0, grassi_100g: 67 },
  { nome: "Pecorino", marca: "", confezionato: false, piatto: "Carbonara", pasto: "pranzo", pezzi: 0, grammi_a_pezzo: 0, grammi: 18, kcal_100g: 390, proteine_100g: 28, carboidrati_100g: 0, grassi_100g: 31 },
]};

module.exports = async function ({ browser, baseURL }) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  try {
    await mockAI(page, AI);
    await mockOFF(page, () => ({ products: [] }));
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await onboard(page);
    await enableAi(page);

    await page.click("#fabVoice");
    await page.waitForSelector("#voiceModal:not(.hidden)");
    await page.fill("#voiceText", "100 g di pasta alla carbonara");
    await page.click("#voiceParse");
    await page.waitForSelector(".vp-dish");

    assert((await page.textContent(".vp-dish-name")).includes("Carbonara"), "il piatto è raggruppato sotto 'Carbonara'");
    assert((await page.$$eval(".vp-row.vp-sub", (r) => r.length)) === 3, "la carbonara è scomposta in 3 ingredienti");

    await page.locator('[data-vgrams="0"]').fill("200");
    const g = await page.evaluate(() => voiceItems.map((it) => it.grams));
    assert(g[0] === 200 && g[1] === 70 && g[2] === 36, "raddoppiando la pasta gli altri ingredienti si riproporzionano");
  } finally {
    await ctx.close();
  }
};
