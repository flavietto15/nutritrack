/* Runner dei test end-to-end di NutriTrack.
   Avvia un server statico sulla cartella del progetto, apre l'app in Chromium
   (Playwright) e lancia i file *.test.js. Esce con codice ≠ 0 se un test fallisce.

   Uso:  node test/run.js
   Richiede: playwright-core (vedi test/package.json) e un Chromium.
   In assenza di CHROMIUM_PATH usa il Chromium preinstallato dell'ambiente. */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 8181;
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    let file = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end("not found"); return; }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function main() {
  let chromium;
  try { ({ chromium } = require("playwright-core")); }
  catch (_) {
    console.error("playwright-core non installato. Esegui:  cd test && npm install");
    process.exit(2);
  }

  const server = await startServer();
  const baseURL = `http://localhost:${PORT}/`;
  const browser = await chromium.launch({ executablePath: CHROMIUM });

  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort();
  let failed = 0;
  for (const f of files) {
    const name = f.replace(".test.js", "");
    try {
      await require(path.join(__dirname, f))({ browser, baseURL });
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}\n      ${err.message}`);
    }
  }

  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} test falliti su ${files.length}.` : `\nTutti i ${files.length} test passati.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
