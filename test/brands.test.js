/* Marche: per i prodotti confezionati i macro reali arrivano da Open Food Facts;
   se il prodotto non si trova resta la stima IA; i freschi non fanno lookup. */
const { assert, onboard, enableAi, mockAI, mockOFF } = require("./helpers");

const AI = { alimenti: [
  { nome: "Gocciole", marca: "Pavesi", confezionato: true, piatto: "", pasto: "colazione", pezzi: 0, grammi_a_pezzo: 0, grammi: 40, kcal_100g: 480, proteine_100g: 6, carboidrati_100g: 65, grassi_100g: 21 },
  { nome: "Yogurt", marca: "MarcaFantasma", confezionato: true, piatto: "", pasto: "colazione", pezzi: 0, grammi_a_pezzo: 0, grammi: 125, kcal_100g: 60, proteine_100g: 4, carboidrati_100g: 7, grassi_100g: 2 },
  { nome: "Mela", marca: "", confezionato: false, piatto: "", pasto: "colazione", pezzi: 1, grammi_a_pezzo: 180, grammi: 180, kcal_100g: 52, proteine_100g: 0.3, carboidrati_100g: 14, grassi_100g: 0.2 },
]};

function off(terms) {
  if (terms.includes("gocciole")) return { products: [
    { product_name: "Gocciole Classiche", brands: "Pavesi", nutriments: { "energy-kcal_100g": 495, "proteins_100g": 6.5, "carbohydrates_100g": 64, "fat_100g": 23 }, serving_quantity: 34 },
  ]};
  return { products: [] }; // marca fantasma: nessun riscontro
}

module.exports = async function ({ browser, baseURL }) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  try {
    await mockAI(page, AI);
    await mockOFF(page, off);
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await onboard(page);
    await enableAi(page);

    await page.click("#fabVoice");
    await page.waitForSelector("#voiceModal:not(.hidden)");
    await page.fill("#voiceText", "a colazione gocciole, uno yogurt e una mela");
    await page.click("#voiceParse");
    await page.waitForSelector(".vp-row");
    await page.waitForFunction(() => !document.querySelector(".vp-tag-wait"), { timeout: 5000 });

    const rows = await page.evaluate(() => voiceItems.map((it) => ({
      name: it.food.name, packaged: it.packaged, exact: it.exact, kcal: Math.round(it.food.per100.kcal),
    })));
    const gocciole = rows.find((r) => r.name.includes("Gocciole"));
    const fantasma = rows.find((r) => r.name.includes("Yogurt"));
    const mela = rows.find((r) => r.name.includes("Mela"));

    assert(gocciole && gocciole.exact && gocciole.kcal === 495, "le Gocciole prendono i macro reali da Open Food Facts");
    assert(fantasma && fantasma.packaged && !fantasma.exact, "un prodotto non trovato resta con la stima IA");
    assert(mela && !mela.packaged, "la mela fresca non fa alcun lookup di marca");
  } finally {
    await ctx.close();
  }
};
