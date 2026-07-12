/* Utility condivise dai test end-to-end di NutriTrack. */

function assert(cond, msg) {
  if (!cond) throw new Error("Assert fallito: " + msg);
}

/* Completa l'onboarding (calcolo macro automatico) e chiude il modale iniziale. */
async function onboard(page) {
  await page.waitForSelector("#goalsModal:not(.hidden)");
  await page.click("#calcGoals");
  await page.click("#saveGoals");
  await page.waitForSelector("#goalsModal.hidden", { state: "attached" });
}

/* Attiva la modalità IA con una chiave finta (le chiamate sono intercettate). */
async function enableAi(page) {
  await page.evaluate(() => { state.apiKey = "AIzaFAKE"; saveState(); renderAiBox(); });
}

/* Intercetta il provider IA e risponde con un JSON fisso (deterministico). */
async function mockAI(page, json) {
  await page.route("**generativelanguage.googleapis.com/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] }),
    }));
}

/* Intercetta Open Food Facts. `fn(searchTerms)` restituisce l'oggetto risposta. */
async function mockOFF(page, fn) {
  await page.route("**openfoodfacts.org/**", (route) => {
    const terms = decodeURIComponent((route.request().url().match(/search_terms=([^&]*)/) || [])[1] || "");
    route.fulfill({ contentType: "application/json", body: JSON.stringify(fn(terms.toLowerCase())) });
  });
}

module.exports = { assert, onboard, enableAi, mockAI, mockOFF };
