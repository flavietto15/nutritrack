/* ============================================================
   NutriTrack — diario calorie & macro con suggerimenti smart
   ============================================================ */

const STORAGE_KEY = "nutritrack:v1";

const MEALS = [
  { id: "colazione", label: "Colazione", emoji: "☀️" },
  { id: "pranzo",    label: "Pranzo",    emoji: "🍽️" },
  { id: "spuntino",  label: "Spuntino",  emoji: "🥜" },
  { id: "cena",      label: "Cena",      emoji: "🌙" },
];

/* Quota indicativa delle kcal giornaliere per pasto (per i suggerimenti) */
const MEAL_SHARE = { colazione: 0.25, pranzo: 0.35, spuntino: 0.10, cena: 0.30 };

const MACROS = [
  { id: "p", label: "Proteine",     kcalPerG: 4, cssVar: "--prot" },
  { id: "c", label: "Carboidrati",  kcalPerG: 4, cssVar: "--carb" },
  { id: "f", label: "Grassi",       kcalPerG: 9, cssVar: "--fat"  },
];

/* ---------- Stato ---------- */

let state = loadState();
let viewDate = todayKey();          // giorno visualizzato
let pendingFood = null;             // alimento in attesa di quantità
let editingEntryId = null;          // voce del diario in modifica
let suggOffset = 0;                 // rotazione suggerimenti
let searchAbort = null;
let searchTimer = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* storage corrotto: riparti pulito */ }
  return { goals: null, profile: null, days: {} };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------- Utility ---------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return dateToKey(d);
}

function dateToKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftViewDate(days) {
  const [y, m, d] = viewDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  viewDate = dateToKey(dt);
  render();
}

function fmtDate(key) {
  if (key === todayKey()) return "Oggi";
  if (key === todayKey(-1)) return "Ieri";
  if (key === todayKey(1)) return "Domani";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("it-IT", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function r0(n) { return Math.round(n); }
function r1(n) { return Math.round(n * 10) / 10; }

let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
}

function openModal(id) { $("#" + id).classList.remove("hidden"); }
function closeModal(id) {
  $("#" + id).classList.add("hidden");
  if (id === "addModal") stopScanner();
}

/* ---------- Calcoli nutrizionali ---------- */

function dayEntries(key = viewDate) {
  return state.days[key] || [];
}

function entryNutrients(entry) {
  const k = entry.grams / 100;
  return {
    kcal: entry.per100.kcal * k,
    p: entry.per100.p * k,
    c: entry.per100.c * k,
    f: entry.per100.f * k,
  };
}

function dayTotals(key = viewDate) {
  return dayEntries(key).reduce((acc, e) => {
    const n = entryNutrients(e);
    acc.kcal += n.kcal; acc.p += n.p; acc.c += n.c; acc.f += n.f;
    return acc;
  }, { kcal: 0, p: 0, c: 0, f: 0 });
}

function remaining(totals) {
  const g = state.goals;
  return {
    kcal: g.kcal - totals.kcal,
    p: g.p - totals.p,
    c: g.c - totals.c,
    f: g.f - totals.f,
  };
}

function currentMealSlot() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h < 10.5) return "colazione";
  if (h < 14.5) return "pranzo";
  if (h < 17.5) return "spuntino";
  return "cena";
}

/* ---------- Rendering ---------- */

const RING_C = 2 * Math.PI * 56;

function render() {
  $("#dateLabel").textContent = fmtDate(viewDate);
  if (!state.goals) return; // l'onboarding è aperto

  const totals = dayTotals();
  const rem = remaining(totals);
  const g = state.goals;

  // Anello kcal
  const ring = $("#ringFill");
  const pct = Math.min(totals.kcal / g.kcal, 1);
  ring.style.strokeDasharray = RING_C;
  ring.style.strokeDashoffset = RING_C * (1 - pct);
  ring.classList.toggle("over", totals.kcal > g.kcal);
  $("#ringValue").textContent = r0(totals.kcal);
  $("#statGoal").textContent = `${r0(g.kcal)} kcal`;
  $("#statEaten").textContent = `${r0(totals.kcal)} kcal`;
  const leftEl = $("#statLeft");
  if (rem.kcal >= 0) {
    leftEl.textContent = `${r0(rem.kcal)} kcal`;
    leftEl.classList.remove("negative");
  } else {
    leftEl.textContent = `+${r0(-rem.kcal)} oltre`;
    leftEl.classList.add("negative");
  }

  renderMeters(totals);
  renderSuggestions();
  renderMeals();
}

function renderMeters(totals) {
  const g = state.goals;
  $("#macroMeters").innerHTML = MACROS.map((m) => {
    const eaten = totals[m.id];
    const goal = g[m.id];
    const pct = goal > 0 ? Math.min((eaten / goal) * 100, 100) : 0;
    const over = eaten - goal;
    const color = `var(${m.cssVar})`;
    return `
      <div class="meter">
        <div class="meter-head">
          <span class="meter-dot" style="background:${color}"></span>
          <span class="meter-name">${m.label}</span>
          <span class="meter-values">
            <strong>${r0(eaten)}</strong> / ${r0(goal)} g
            ${over > 1 ? `<span class="meter-over">+${r0(over)}</span>` : ""}
          </span>
        </div>
        <div class="meter-track">
          <div class="meter-fill" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>`;
  }).join("");
}

function renderMeals() {
  const entries = dayEntries();
  $("#mealsRoot").innerHTML = MEALS.map((meal) => {
    const list = entries.filter((e) => e.meal === meal.id);
    const kcal = list.reduce((s, e) => s + entryNutrients(e).kcal, 0);
    const rows = list.length
      ? list.map((e) => {
          const n = entryNutrients(e);
          return `
            <div class="entry" data-entry="${e.id}">
              <div class="entry-info">
                <div class="entry-name">${esc(e.name)}</div>
                <div class="entry-macros">${e.grams} g · P ${r0(n.p)} · C ${r0(n.c)} · G ${r0(n.f)}</div>
              </div>
              <span class="entry-kcal">${r0(n.kcal)} kcal</span>
            </div>`;
        }).join("")
      : `<div class="empty-meal">Nessun alimento registrato.</div>`;
    return `
      <div class="card meal-card">
        <div class="meal-head">
          <span>${meal.emoji}</span>
          <span class="meal-title">${meal.label}</span>
          <span class="meal-kcal">${r0(kcal)} kcal</span>
          <button class="meal-add" data-meal="${meal.id}" title="Aggiungi a ${meal.label}">+</button>
        </div>
        ${rows}
      </div>`;
  }).join("");

  $$(".meal-add").forEach((btn) =>
    btn.addEventListener("click", () => openAddModal(btn.dataset.meal))
  );
  $$(".entry").forEach((row) =>
    row.addEventListener("click", () => openEditEntry(row.dataset.entry))
  );
}

/* ---------- Motore suggerimenti ---------- */

function renderSuggestions() {
  const listEl = $("#suggestionList");
  const tipEl = $("#tipLine");

  if (viewDate !== todayKey()) {
    tipEl.textContent = "I suggerimenti sono disponibili solo per il giorno corrente.";
    listEl.innerHTML = "";
    return;
  }

  const totals = dayTotals();
  const rem = remaining(totals);
  const slot = currentMealSlot();
  const slotLabel = MEALS.find((m) => m.id === slot).label.toLowerCase();

  if (rem.kcal <= 60) {
    tipEl.textContent = rem.kcal < -100
      ? "Hai superato l'obiettivo calorico: per oggi meglio fermarsi qui. Domani si riparte!"
      : "Obiettivo calorico raggiunto per oggi. 🎉";
    listEl.innerHTML = `<p class="all-done">✅ Hai completato i tuoi obiettivi di oggi.</p>`;
    return;
  }

  tipEl.textContent = buildTip(rem, slotLabel);

  const picks = suggestFoods(rem, slot);
  if (!picks.length) {
    listEl.innerHTML = `<p class="hint">Nessun suggerimento adatto: prova ad aggiungere manualmente.</p>`;
    return;
  }

  listEl.innerHTML = picks.map((s, i) => {
    const n = {
      kcal: s.food.kcal * s.grams / 100,
      p: s.food.p * s.grams / 100,
      c: s.food.c * s.grams / 100,
      f: s.food.f * s.grams / 100,
    };
    return `
      <div class="sugg-row">
        <span class="sugg-emoji">${foodEmoji(s.food)}</span>
        <div class="sugg-info">
          <div class="sugg-name">${esc(s.food.name)} — ${s.grams} g</div>
          <div class="sugg-detail">${r0(n.kcal)} kcal · P ${r0(n.p)} · C ${r0(n.c)} · G ${r0(n.f)}</div>
        </div>
        <button class="sugg-add" data-sugg="${i}">＋ Aggiungi</button>
      </div>`;
  }).join("");

  $$(".sugg-add").forEach((btn) =>
    btn.addEventListener("click", () => {
      const s = picks[Number(btn.dataset.sugg)];
      addEntry({
        meal: slot,
        name: s.food.name,
        grams: s.grams,
        per100: { kcal: s.food.kcal, p: s.food.p, c: s.food.c, f: s.food.f },
      });
      toast(`${s.food.name} aggiunto a ${slotLabel}`);
    })
  );
}

/**
 * Suggerisce alimenti il cui profilo macro somiglia a ciò che manca.
 * Confronta la ripartizione calorica dei macro rimanenti con quella
 * di ogni alimento (distanza in variazione totale) e propone porzioni
 * che stanno nel budget del pasto corrente.
 */
function suggestFoods(rem, slot) {
  const g = state.goals;
  const mealBudget = Math.min(rem.kcal, Math.max(150, g.kcal * MEAL_SHARE[slot]));

  // Ripartizione calorica dei macro ancora da assumere
  const remP = Math.max(0, rem.p) * 4;
  const remC = Math.max(0, rem.c) * 4;
  const remF = Math.max(0, rem.f) * 9;
  const remTot = remP + remC + remF;
  const target = remTot > 0
    ? { p: remP / remTot, c: remC / remTot, f: remF / remTot }
    : { p: 0.33, c: 0.34, f: 0.33 };

  const scored = FOOD_DB
    .filter((food) => food.meals.includes(slot))
    .map((food) => {
      const kcalMacro = food.p * 4 + food.c * 4 + food.f * 9;
      if (kcalMacro <= 0) return null;
      const prof = { p: food.p * 4 / kcalMacro, c: food.c * 4 / kcalMacro, f: food.f * 9 / kcalMacro };
      const dist = Math.abs(prof.p - target.p) + Math.abs(prof.c - target.c) + Math.abs(prof.f - target.f);
      const score = 1 - dist / 2; // 1 = profilo perfetto, 0 = opposto

      // Porzione: ~40% del budget pasto, vicina alla porzione tipica
      const targetKcal = mealBudget * 0.4;
      let grams = food.kcal > 0 ? (targetKcal / food.kcal) * 100 : food.portion;
      grams = Math.min(Math.max(grams, food.portion * 0.5), food.portion * 1.5);
      grams = grams >= 100 ? Math.round(grams / 10) * 10 : Math.round(grams / 5) * 5;
      if (grams < 5) return null;

      // Non sforare le kcal rimanenti
      if (food.kcal * grams / 100 > rem.kcal + 30) return null;
      return { food, grams, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  // Varietà: al massimo un alimento per categoria tra i migliori
  const seen = new Set();
  const diverse = [];
  for (const s of scored) {
    if (seen.has(s.food.cat)) continue;
    seen.add(s.food.cat);
    diverse.push(s);
    if (diverse.length >= 12) break;
  }

  // Rotazione con il pulsante "Altri"
  const out = [];
  for (let i = 0; i < Math.min(4, diverse.length); i++) {
    out.push(diverse[(suggOffset + i) % diverse.length]);
  }
  return out;
}

function buildTip(rem, slotLabel) {
  const g = state.goals;
  // Macro con il gap relativo maggiore rispetto all'obiettivo
  const gaps = MACROS.map((m) => ({
    m, gap: g[m.id] > 0 ? Math.max(0, rem[m.id]) / g[m.id] : 0,
  })).sort((a, b) => b.gap - a.gap);
  const top = gaps[0];

  if (top.gap < 0.08) {
    return `Sei in linea con tutti i macro: per ${slotLabel} scegli quello che preferisci, hai ${r0(rem.kcal)} kcal a disposizione.`;
  }
  const gLeft = r0(rem[top.m.id]);
  const advice = {
    p: "punta su fonti proteiche magre (pollo, pesce, yogurt greco, albumi)",
    c: "via libera a cereali, pane integrale, frutta o patate",
    f: "aggiungi grassi buoni (olio EVO, avocado, frutta secca)",
  }[top.m.id];
  return `Ti mancano ancora ~${gLeft} g di ${top.m.label.toLowerCase()}: per ${slotLabel} ${advice}. Budget: ${r0(rem.kcal)} kcal.`;
}

/* ---------- Diario: aggiunta / modifica ---------- */

function addEntry({ meal, name, grams, per100 }) {
  if (!state.days[viewDate]) state.days[viewDate] = [];
  state.days[viewDate].push({ id: uid(), meal, name, grams, per100 });
  saveState();
  render();
}

function openAddModal(mealId) {
  pendingFood = null;
  editingEntryId = null;
  $("#addModal").dataset.meal = mealId || currentMealSlot();
  switchAddTab("search");
  $("#searchInput").value = "";
  $("#searchResults").innerHTML = "";
  openModal("addModal");
  $("#searchInput").focus();
}

function openAmountModal(food, { grams = null, meal = null, editing = false } = {}) {
  pendingFood = food;
  $("#amountTitle").textContent = editing ? "Modifica" : food.name;
  $("#amountSub").textContent =
    `${food.name} — ${r0(food.per100.kcal)} kcal / 100 g · ` +
    `P ${r1(food.per100.p)} · C ${r1(food.per100.c)} · G ${r1(food.per100.f)}`;
  $("#amountGrams").value = grams || food.portion || 100;
  $("#amountMeal").value = meal || $("#addModal").dataset.meal || currentMealSlot();
  $("#amountConfirm").textContent = editing ? "Salva" : "Aggiungi";
  $("#amountDelete").classList.toggle("hidden", !editing);
  updateAmountPreview();
  closeModal("addModal");
  openModal("amountModal");
}

function openEditEntry(entryId) {
  const entry = dayEntries().find((e) => e.id === entryId);
  if (!entry) return;
  editingEntryId = entryId;
  openAmountModal(
    { name: entry.name, per100: entry.per100, portion: entry.grams },
    { grams: entry.grams, meal: entry.meal, editing: true }
  );
}

function updateAmountPreview() {
  if (!pendingFood) return;
  const grams = Math.max(1, Number($("#amountGrams").value) || 0);
  const k = grams / 100;
  const p = pendingFood.per100;
  $("#amountPreview").innerHTML = `
    <span><strong>${r0(p.kcal * k)}</strong>kcal</span>
    <span><strong>${r1(p.p * k)}</strong>prot</span>
    <span><strong>${r1(p.c * k)}</strong>carb</span>
    <span><strong>${r1(p.f * k)}</strong>grassi</span>`;
}

function confirmAmount() {
  const grams = Math.max(1, Number($("#amountGrams").value) || 0);
  const meal = $("#amountMeal").value;

  if (editingEntryId) {
    const entry = dayEntries().find((e) => e.id === editingEntryId);
    if (entry) { entry.grams = grams; entry.meal = meal; }
    editingEntryId = null;
    saveState();
    render();
    toast("Voce aggiornata");
  } else if (pendingFood) {
    addEntry({ meal, name: pendingFood.name, grams, per100: pendingFood.per100 });
    toast(`${pendingFood.name} aggiunto`);
  }
  pendingFood = null;
  closeModal("amountModal");
}

function deleteEditingEntry() {
  if (!editingEntryId) return;
  state.days[viewDate] = dayEntries().filter((e) => e.id !== editingEntryId);
  editingEntryId = null;
  saveState();
  render();
  closeModal("amountModal");
  toast("Voce eliminata");
}

/* ---------- Ricerca (locale + Open Food Facts) ---------- */

function normalize(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function searchLocal(query) {
  const q = normalize(query);
  return FOOD_DB
    .filter((f) => normalize(f.name).includes(q))
    .slice(0, 8)
    .map((f) => ({
      name: f.name,
      emoji: foodEmoji(f),
      per100: { kcal: f.kcal, p: f.p, c: f.c, f: f.f },
      portion: f.portion,
      source: "Locale",
    }));
}

function offProductToFood(prod) {
  const n = prod.nutriments || {};
  let kcal = n["energy-kcal_100g"];
  if (kcal == null && n["energy_100g"] != null) kcal = n["energy_100g"] / 4.184;
  if (kcal == null) return null;
  const name = [prod.product_name, prod.brands].filter(Boolean).join(" — ");
  if (!name) return null;
  return {
    name,
    emoji: "📦",
    per100: {
      kcal: Number(kcal) || 0,
      p: Number(n["proteins_100g"]) || 0,
      c: Number(n["carbohydrates_100g"]) || 0,
      f: Number(n["fat_100g"]) || 0,
    },
    portion: Number(prod.serving_quantity) || 100,
    source: "OFF",
  };
}

async function searchOFF(query, signal) {
  const url = "https://it.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=8" +
    "&fields=product_name,brands,nutriments,serving_quantity&search_terms=" + encodeURIComponent(query);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  return (data.products || []).map(offProductToFood).filter(Boolean);
}

function renderResults(items) {
  $("#searchResults").innerHTML = items.map((it, i) => `
    <div class="result-row" data-idx="${i}">
      <span class="result-emoji">${it.emoji}</span>
      <div class="result-info">
        <div class="result-name">${esc(it.name)}</div>
        <div class="result-detail">${r0(it.per100.kcal)} kcal · P ${r1(it.per100.p)} · C ${r1(it.per100.c)} · G ${r1(it.per100.f)} / 100 g</div>
      </div>
      <span class="result-src">${it.source}</span>
    </div>`).join("");
  $$(".result-row").forEach((row) =>
    row.addEventListener("click", () => openAmountModal(items[Number(row.dataset.idx)]))
  );
}

function onSearchInput() {
  const q = $("#searchInput").value.trim();
  clearTimeout(searchTimer);
  if (searchAbort) searchAbort.abort();

  if (q.length < 2) {
    $("#searchResults").innerHTML = "";
    $("#searchHint").textContent = "Database locale + Open Food Facts per i prodotti confezionati.";
    return;
  }

  let items = searchLocal(q);
  renderResults(items);
  $("#searchHint").textContent = "Cerco anche su Open Food Facts…";

  searchTimer = setTimeout(async () => {
    searchAbort = new AbortController();
    try {
      const off = await searchOFF(q, searchAbort.signal);
      // Rileggi il campo: l'utente potrebbe aver già cambiato query
      if ($("#searchInput").value.trim() !== q) return;
      items = items.concat(off);
      renderResults(items);
      $("#searchHint").textContent = off.length
        ? "Risultati: database locale + Open Food Facts."
        : "Nessun prodotto confezionato trovato online.";
    } catch (err) {
      if (err.name !== "AbortError") {
        $("#searchHint").textContent = "Open Food Facts non raggiungibile (offline?). Risultati solo locali.";
      }
    }
  }, 450);
}

/* ---------- Barcode ---------- */

let mediaStream = null;
let scanRAF = null;
let zxingControls = null;
let scanning = false;

function setScanStatus(msg) { $("#scanStatus").textContent = msg; }

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("caricamento fallito"));
    document.head.appendChild(s);
  });
}

async function startScanner() {
  if (scanning) return;
  const video = $("#scanVideo");

  if (!window.isSecureContext) {
    setScanStatus("⚠️ La fotocamera richiede HTTPS o localhost. Usa il campo qui sotto.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setScanStatus("Fotocamera non supportata dal browser. Usa il campo qui sotto.");
    return;
  }

  setScanStatus("Avvio fotocamera…");
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
  } catch (err) {
    setScanStatus("Accesso alla fotocamera negato. Inserisci il codice a mano.");
    return;
  }
  video.srcObject = mediaStream;
  await video.play();
  scanning = true;

  if ("BarcodeDetector" in window) {
    const detector = new BarcodeDetector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
    });
    setScanStatus("Inquadra il codice a barre…");
    const loop = async () => {
      if (!scanning) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) { onBarcodeDetected(codes[0].rawValue); return; }
      } catch (_) { /* frame non pronto */ }
      scanRAF = requestAnimationFrame(loop);
    };
    loop();
  } else {
    // Fallback per Safari/Firefox: ZXing da CDN
    setScanStatus("Carico il lettore barcode…");
    try {
      if (!window.ZXingBrowser) {
        await loadScript("https://unpkg.com/@zxing/browser@0.1.5/umd/zxing-browser.min.js");
      }
      const reader = new ZXingBrowser.BrowserMultiFormatReader();
      zxingControls = await reader.decodeFromVideoElement(video, (result) => {
        if (result && scanning) onBarcodeDetected(result.getText());
      });
      setScanStatus("Inquadra il codice a barre…");
    } catch (err) {
      setScanStatus("Lettore non disponibile (serve internet). Inserisci il codice a mano.");
    }
  }
}

function stopScanner() {
  scanning = false;
  if (scanRAF) { cancelAnimationFrame(scanRAF); scanRAF = null; }
  if (zxingControls) { try { zxingControls.stop(); } catch (_) {} zxingControls = null; }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  const video = $("#scanVideo");
  if (video) video.srcObject = null;
}

function onBarcodeDetected(code) {
  stopScanner();
  if (navigator.vibrate) navigator.vibrate(80);
  setScanStatus(`Codice ${code} — cerco il prodotto…`);
  lookupBarcode(code);
}

async function lookupBarcode(code) {
  code = String(code).replace(/\D/g, "");
  if (!code) { setScanStatus("Codice non valido."); return; }
  setScanStatus(`Cerco il prodotto ${code}…`);
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json` +
      `?fields=product_name,brands,nutriments,serving_quantity`
    );
    const data = await res.json();
    if (data.status !== 1 || !data.product) {
      setScanStatus(`Prodotto ${code} non trovato su Open Food Facts. Inseriscilo dalla scheda Manuale.`);
      return;
    }
    const food = offProductToFood(data.product);
    if (!food) {
      setScanStatus("Prodotto trovato ma senza valori nutrizionali. Usa la scheda Manuale.");
      return;
    }
    openAmountModal(food);
  } catch (err) {
    setScanStatus("Errore di rete: controlla la connessione e riprova.");
  }
}

/* ---------- Obiettivi ---------- */

/** Mifflin-St Jeor + moltiplicatore attività + aggiustamento obiettivo */
function computeGoals({ sex, age, weight, height, activity, goal }) {
  const bmr = 10 * weight + 6.25 * height - 5 * age + (sex === "m" ? 5 : -161);
  let kcal = bmr * activity;
  if (goal === "cut") kcal *= 0.85;
  if (goal === "bulk") kcal *= 1.10;
  kcal = Math.round(kcal / 10) * 10;

  const proteinPerKg = { cut: 2.0, maintain: 1.6, bulk: 1.8 }[goal];
  const p = Math.round(weight * proteinPerKg);
  const f = Math.round((kcal * 0.30) / 9);
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  return { kcal, p, c, f };
}

function fillCustomGoals(g) {
  $("#gKcal").value = g.kcal;
  $("#gProt").value = g.p;
  $("#gCarb").value = g.c;
  $("#gFat").value = g.f;
  updateGoalsCheck();
}

function updateGoalsCheck() {
  const kcal = Number($("#gKcal").value) || 0;
  const p = Number($("#gProt").value) || 0;
  const c = Number($("#gCarb").value) || 0;
  const f = Number($("#gFat").value) || 0;
  const fromMacros = p * 4 + c * 4 + f * 9;
  const el = $("#goalsCheck");
  if (!kcal || !fromMacros) { el.textContent = ""; return; }
  const diff = fromMacros - kcal;
  el.textContent = Math.abs(diff) <= 50
    ? `✓ Coerente: i macro valgono ${fromMacros} kcal.`
    : `⚠️ I macro valgono ${fromMacros} kcal, ${diff > 0 ? "+" : ""}${diff} rispetto alle calorie impostate.`;
}

function openGoalsModal() {
  const isFirstRun = !state.goals;
  $("#goalsClose").classList.toggle("hidden", isFirstRun);
  if (state.goals) fillCustomGoals(state.goals);
  if (state.profile) {
    $("#pSex").value = state.profile.sex;
    $("#pAge").value = state.profile.age;
    $("#pWeight").value = state.profile.weight;
    $("#pHeight").value = state.profile.height;
    $("#pActivity").value = state.profile.activity;
    $("#pGoal").value = state.profile.goal;
  }
  switchGoalsTab(state.goals ? "custom" : "calc");
  openModal("goalsModal");
}

function saveGoals() {
  const g = {
    kcal: Number($("#gKcal").value),
    p: Number($("#gProt").value),
    c: Number($("#gCarb").value),
    f: Number($("#gFat").value),
  };
  if (!g.kcal || g.kcal < 800) {
    switchGoalsTab("custom");
    toast("Imposta le calorie (o usa il calcolo automatico)");
    return;
  }
  state.goals = g;
  saveState();
  closeModal("goalsModal");
  render();
  toast("Obiettivi salvati 💪");
}

/* ---------- Tabs ---------- */

function switchAddTab(tab) {
  $$("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ["search", "barcode", "manual"].forEach((t) =>
    $("#panel-" + t).classList.toggle("hidden", t !== tab)
  );
  if (tab === "barcode") startScanner();
  else stopScanner();
}

function switchGoalsTab(tab) {
  $$("[data-gtab]").forEach((b) => b.classList.toggle("active", b.dataset.gtab === tab));
  $("#gpanel-calc").classList.toggle("hidden", tab !== "calc");
  $("#gpanel-custom").classList.toggle("hidden", tab !== "custom");
}

/* ---------- Wiring ---------- */

function init() {
  // Data
  $("#prevDay").addEventListener("click", () => shiftViewDate(-1));
  $("#nextDay").addEventListener("click", () => shiftViewDate(1));
  $("#dateLabel").addEventListener("click", () => { viewDate = todayKey(); render(); });

  // Suggerimenti
  $("#refreshSuggestions").addEventListener("click", () => {
    suggOffset += 4;
    renderSuggestions();
  });

  // Aggiungi
  $("#fabScan").addEventListener("click", () => { openAddModal(); switchAddTab("barcode"); });
  $$(".tab[data-tab]").forEach((b) =>
    b.addEventListener("click", () => switchAddTab(b.dataset.tab))
  );
  $("#searchInput").addEventListener("input", onSearchInput);
  $("#barcodeLookup").addEventListener("click", () => lookupBarcode($("#barcodeInput").value));
  $("#barcodeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") lookupBarcode($("#barcodeInput").value);
  });
  $("#manualNext").addEventListener("click", () => {
    const name = $("#mName").value.trim();
    const kcal = Number($("#mKcal").value);
    if (!name || !(kcal >= 0)) { toast("Inserisci almeno nome e kcal"); return; }
    openAmountModal({
      name,
      per100: {
        kcal,
        p: Number($("#mProt").value) || 0,
        c: Number($("#mCarb").value) || 0,
        f: Number($("#mFat").value) || 0,
      },
      portion: 100,
    });
  });

  // Quantità
  $("#amountGrams").addEventListener("input", updateAmountPreview);
  $$(".step-btn").forEach((b) =>
    b.addEventListener("click", () => {
      const el = $("#amountGrams");
      el.value = Math.max(1, (Number(el.value) || 0) + Number(b.dataset.step));
      updateAmountPreview();
    })
  );
  $("#amountConfirm").addEventListener("click", confirmAmount);
  $("#amountDelete").addEventListener("click", deleteEditingEntry);

  // Obiettivi
  $("#openSettings").addEventListener("click", openGoalsModal);
  $$(".tab[data-gtab]").forEach((b) =>
    b.addEventListener("click", () => switchGoalsTab(b.dataset.gtab))
  );
  $("#calcGoals").addEventListener("click", () => {
    const profile = {
      sex: $("#pSex").value,
      age: Number($("#pAge").value) || 30,
      weight: Number($("#pWeight").value) || 75,
      height: Number($("#pHeight").value) || 175,
      activity: Number($("#pActivity").value),
      goal: $("#pGoal").value,
    };
    state.profile = profile;
    fillCustomGoals(computeGoals(profile));
    switchGoalsTab("custom");
    toast("Macro calcolati: controlla e salva");
  });
  ["gKcal", "gProt", "gCarb", "gFat"].forEach((id) =>
    $("#" + id).addEventListener("input", updateGoalsCheck)
  );
  $("#saveGoals").addEventListener("click", saveGoals);

  // Chiusura modali
  $$("[data-close]").forEach((b) =>
    b.addEventListener("click", () => closeModal(b.dataset.close))
  );
  $$(".modal-backdrop").forEach((bd) =>
    bd.addEventListener("click", (e) => {
      if (e.target !== bd) return;
      if (bd.id === "goalsModal" && !state.goals) return; // onboarding obbligatorio
      closeModal(bd.id);
    })
  );
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    ["addModal", "amountModal"].forEach(closeModal);
    if (state.goals) closeModal("goalsModal");
  });

  // Ferma la fotocamera se la pagina va in background
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopScanner();
  });

  // Aggiorna i suggerimenti al cambio fascia oraria
  setInterval(() => {
    if (viewDate === todayKey() && state.goals) renderSuggestions();
  }, 5 * 60 * 1000);

  render();
  if (!state.goals) openGoalsModal();
}

init();
