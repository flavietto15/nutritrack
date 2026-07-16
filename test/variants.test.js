/* Varianti: il DB locale distingue tipologie (latte, philadelphia, gelato)
   e il prompt IA impone varianti esplicite, gelateria e misure casalinghe. */
const { assert, onboard } = require("./helpers");

module.exports = async function ({ browser, baseURL }) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await onboard(page);

    const parse = (t) => page.evaluate((txt) =>
      parseFoodText(txt).map((it) => ({ food: it.food && it.food.name, g: it.grams })), t);

    let r = await parse("un bicchiere di latte intero");
    assert(r[0].food === "Latte intero", "«latte intero» → Latte intero, non generico");

    r = await parse("30 grammi di philadelphia light");
    assert(r[0].food === "Formaggio spalmabile light" && r[0].g === 30, "«philadelphia light» → variante light");

    r = await parse("due palline di gelato al pistacchio");
    assert(r[0].food === "Gelato al pistacchio" && r[0].g === 120, "2 palline di pistacchio → 120 g");

    r = await parse("una coca zero");
    assert(r[0].food === "Bibita zero", "«coca zero» → Bibita zero (0 kcal)");

    const sys = await page.evaluate(() => AI_SYSTEM);
    for (const chunk of ["VARIANTI", "GELATO", "MISURE CASALINGHE", "parzialmente scremato", "pallina"]) {
      assert(sys.includes(chunk), `il prompt IA contiene la sezione «${chunk}»`);
    }
  } finally {
    await ctx.close();
  }
};
