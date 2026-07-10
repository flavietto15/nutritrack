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
  let s = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) s = JSON.parse(raw);
  } catch (_) { /* storage corrotto: riparti pulito */ }
  if (!s) s = { goals: null, profile: null, days: {} };
  if (!s.trainingGoals) s.trainingGoals = null;
  if (!s.trainingDays) s.trainingDays = {};
  return s;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) { /* storage pieno o bloccato: l'app continua in memoria */ }
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
  if (id === "voiceModal") stopMic();
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

/** Obiettivi attivi per il giorno: allenamento o riposo */
function activeGoals(key = viewDate) {
  return (state.trainingDays[key] && state.trainingGoals) || state.goals;
}

function isTrainingDay(key = viewDate) {
  return Boolean(state.trainingDays[key] && state.trainingGoals);
}

function remaining(totals) {
  const g = activeGoals();
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
  const g = activeGoals();

  // Tipo di giornata
  const training = isTrainingDay();
  const dayBtn = $("#dayTypeToggle");
  dayBtn.textContent = training ? "🏋️ Allenamento" : "🛋️ Riposo";
  dayBtn.classList.toggle("training", training);

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
  const g = activeGoals();
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
  const g = activeGoals();
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
  const g = activeGoals();
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
    let formats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];
    try { formats = await BarcodeDetector.getSupportedFormats(); } catch (_) {}
    const detector = new BarcodeDetector({ formats });
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

/* ---------- Dettatura vocale pasti ---------- */

const NUM_WORDS = {
  un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5,
  sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, dodici: 12,
  mezzo: 0.5, mezza: 0.5,
};

/* Misure casalinghe → grammi (o riferimento a porzione/pezzo del cibo) */
const MEASURE_WORDS = {
  cucchiaino: 5, cucchiaini: 5, cucchiaio: 10, cucchiai: 10,
  bicchiere: 200, bicchieri: 200, tazza: 250, tazze: 250,
  vasetto: 125, vasetti: 125, lattina: 330, lattine: 330,
  fetta: "unit30", fette: "unit30",
  piatto: "portion", piatti: "portion", porzione: "portion", porzioni: "portion",
  pezzo: "unit", pezzi: "unit",
};

const MEAL_WORDS = {
  colazione: "colazione", stamattina: "colazione", mattina: "colazione", stamani: "colazione",
  pranzo: "pranzo",
  spuntino: "spuntino", merenda: "spuntino", pomeriggio: "spuntino",
  cena: "cena", stasera: "cena", sera: "cena", stanotte: "cena",
};

/* Parole del discorso da ignorare: il resto della frase può essere libero */
const PARSE_STOPWORDS = new Set([
  "di", "d", "del", "della", "dello", "dei", "degli", "delle", "al", "alla",
  "allo", "ai", "agli", "alle", "la", "il", "lo", "le", "i", "gli",
  "in", "a", "da", "ho", "mi", "sono", "po", "anche", "circa", "tipo", "oggi",
  "mangiato", "mangiata", "mangiati", "mangiate", "mangio", "bevuto", "bevuta",
  "preso", "presa", "ordinato", "ordinata", "assaggiato", "fatto", "abbiamo",
  "ristorante", "pizzeria", "bar", "fuori", "casa", "amici", "lavoro",
  "non", "so", "pero", "però", "valori", "quanto", "quanti", "quante",
  "esattamente", "davvero", "molto", "buono", "buona", "bello", "che", "cosa",
  "era", "erano", "credo", "penso", "forse", "magari", "questo", "questa",
]);

/* Radice grezza per tollerare singolare/plurale (mela/mele, uovo/uova) */
function stemWord(w) { return w.length > 3 ? w.slice(0, -1) : w; }

let FOOD_INDEX = null;
function buildFoodIndex() {
  FOOD_INDEX = FOOD_DB.map((food) => {
    const words = normalize([food.name, ...(food.alias || [])].join(" "))
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !PARSE_STOPWORDS.has(w));
    return { food, tokens: new Set(words.map(stemWord)) };
  });
}

/** Trova l'alimento locale che copre meglio le parole dette */
function matchFood(words) {
  if (!FOOD_INDEX) buildFoodIndex();
  const q = words.map(stemWord);
  if (!q.length) return null;
  let best = null;
  for (const { food, tokens } of FOOD_INDEX) {
    const hits = q.filter((w) => tokens.has(w)).length;
    if (!hits) continue;
    const coverage = hits / q.length;            // quanto del parlato è coperto
    const precision = hits / tokens.size;        // quanto è specifico il nome
    const score = coverage + precision * 0.15;
    if (coverage >= 0.5 && (!best || score > best.score)) best = { food, score };
  }
  return best ? best.food : null;
}

/** "80 grammi di pasta, due uova e una mela" → voci con quantità e pasto */
function parseFoodText(text) {
  const items = [];
  let meal = currentMealSlot();
  let mealExplicit = false;
  const segs = normalize(text)
    .replace(/[.;!?\n]/g, ",")
    .split(/,|\be\b|\bed\b|\bcon\b|\bpiu\b|\bpoi\b|\binsieme\b/);

  for (let seg of segs) {
    seg = seg.trim();
    if (!seg) continue;

    // cambio pasto: "a pranzo…", "per cena…"
    for (const [w, m] of Object.entries(MEAL_WORDS)) {
      if (new RegExp("\\b" + w + "\\b").test(seg)) {
        meal = m;
        seg = seg.replace(new RegExp("\\b(a|per)?\\s*" + w + "\\b"), " ");
        // "due uova e un caffè a colazione": vale anche per le voci già lette
        if (!mealExplicit) items.forEach((it) => { it.meal = m; });
        mealExplicit = true;
      }
    }

    // grammi/ml espliciti
    let grams = null;
    const gMatch = seg.match(/(\d+[.,]?\d*)\s*(?:g\b|gr\b|grammi\b|grammo\b|ml\b|millilitri\b)/);
    if (gMatch) { grams = parseFloat(gMatch[1].replace(",", ".")); seg = seg.replace(gMatch[0], " "); }
    const ettiMatch = seg.match(/([\w\d.,]+)\s*ett[oi]\b/);
    if (grams == null && ettiMatch) {
      const n = NUM_WORDS[ettiMatch[1]] ?? parseFloat(ettiMatch[1].replace(",", "."));
      if (n) { grams = n * 100; seg = seg.replace(ettiMatch[0], " "); }
    }
    const kgMatch = seg.match(/([\w\d.,]+)\s*(?:kg\b|chil[oi]\b)/);
    if (grams == null && kgMatch) {
      const n = NUM_WORDS[kgMatch[1]] ?? parseFloat(kgMatch[1].replace(",", "."));
      if (n) { grams = n * 1000; seg = seg.replace(kgMatch[0], " "); }
    }

    // conteggi ("due", "3") e misure ("cucchiai", "fette", "piatto")
    let count = null, measure = null;
    const rest = [];
    for (const w of seg.split(/[^a-z0-9']+/).filter(Boolean)) {
      if (MEASURE_WORDS[w] !== undefined) { measure = MEASURE_WORDS[w]; continue; }
      if (NUM_WORDS[w] !== undefined) { count = NUM_WORDS[w]; continue; }
      if (/^\d+([.,]\d+)?$/.test(w)) { count = parseFloat(w.replace(",", ".")); continue; }
      if (!PARSE_STOPWORDS.has(w)) rest.push(w);
    }
    if (!rest.length) continue;

    const food = matchFood(rest);
    items.push({
      query: rest.join(" "),
      meal,
      grams: resolveGrams({ grams, count, measure }, food),
      food: food ? {
        name: food.name,
        emoji: foodEmoji(food),
        per100: { kcal: food.kcal, p: food.p, c: food.c, f: food.f },
      } : null,
    });
  }
  return items;
}

function resolveGrams({ grams, count, measure }, food) {
  if (grams) return Math.round(grams);
  const portion = food ? food.portion : 100;
  const unit = food && food.unit ? food.unit : null;
  if (measure != null) {
    const n = count || 1;
    if (measure === "portion") return Math.round(n * portion);
    if (measure === "unit") return Math.round(n * (unit || portion));
    if (measure === "unit30") return Math.round(n * (unit || 30));
    return Math.round(n * measure);
  }
  if (count != null) return Math.round(count * (unit || portion));
  return portion;
}

/* --- Modalità IA (Claude): comprensione del parlato libero --- */

const AI_MODEL = "claude-opus-4-8";

const AI_SYSTEM = `Sei il motore di un diario alimentare italiano. Ricevi la trascrizione
di un messaggio vocale in cui una persona racconta liberamente cosa ha mangiato o bevuto.
Estrai SOLO gli alimenti e le bevande effettivamente consumati dalla persona, ignorando
tutto il resto del discorso (luoghi, persone, commenti, divagazioni).
Per ogni alimento:
- stima la porzione in grammi: rispetta le quantità dette dall'utente; altrimenti usa
  porzioni tipiche italiane o da ristorante (es. uno smash burger ≈ 250 g, una porzione
  di patatine fritte ≈ 150 g, un piatto di pasta cotta ≈ 300 g);
- stima i valori nutrizionali medi per 100 g (kcal, proteine, carboidrati, grassi) da
  fonti standard tipo CREA/USDA; per i piatti composti stima la ricetta media;
- assegna il pasto usando i riferimenti nel testo ("stasera" → cena, "stamattina" →
  colazione, "a pranzo" → pranzo); senza riferimenti, deducilo dall'ora attuale indicata.
Non inventare alimenti non menzionati. Se non ci sono alimenti, restituisci la lista vuota.`;

const AI_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["alimenti"],
  properties: {
    alimenti: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nome", "pasto", "grammi", "kcal_100g", "proteine_100g", "carboidrati_100g", "grassi_100g"],
        properties: {
          nome: { type: "string", description: "Nome breve dell'alimento in italiano" },
          pasto: { type: "string", enum: ["colazione", "pranzo", "spuntino", "cena"] },
          grammi: { type: "number", description: "Porzione consumata stimata, in grammi" },
          kcal_100g: { type: "number" },
          proteine_100g: { type: "number" },
          carboidrati_100g: { type: "number" },
          grassi_100g: { type: "number" },
        },
      },
    },
  },
};

async function aiParseFoodText(text) {
  const now = new Date();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": state.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 2000,
      system: AI_SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: AI_SCHEMA } },
      messages: [{
        role: "user",
        content: `Ora attuale: ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}.\nTrascrizione: «${text}»`,
      }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    if (res.status === 401) throw new Error("chiave API non valida");
    throw new Error(err?.error?.message || "errore " + res.status);
  }
  const data = await res.json();
  if (data.stop_reason === "refusal") throw new Error("richiesta rifiutata");
  const block = (data.content || []).find((b) => b.type === "text");
  const parsed = JSON.parse(block.text);
  return (parsed.alimenti || []).map((a) => ({
    query: a.nome,
    meal: MEALS.some((m) => m.id === a.pasto) ? a.pasto : currentMealSlot(),
    grams: Math.max(1, Math.round(a.grammi)),
    food: {
      name: a.nome,
      emoji: "🤖",
      per100: {
        kcal: Math.max(0, a.kcal_100g),
        p: Math.max(0, a.proteine_100g),
        c: Math.max(0, a.carboidrati_100g),
        f: Math.max(0, a.grassi_100g),
      },
    },
  }));
}

function renderAiBox() {
  const has = Boolean(state.apiKey);
  $("#aiKeyRow").classList.toggle("hidden", has);
  $("#aiRemoveKey").classList.toggle("hidden", !has);
  $("#aiStatus").innerHTML = has
    ? "🤖 <strong>Modalità IA attiva</strong>: parla liberamente («stasera ho mangiato uno smash burger al ristorante…») e stimo tutto io, anche i valori dei piatti che non conosco."
    : '🤖 Vuoi la <strong>modalità IA</strong>? Capisce il parlato libero e stima i valori dei piatti da ristorante. Crea una chiave API su <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> e incollala qui (resta salvata solo sul tuo dispositivo):';
}

function saveAiKey() {
  const key = $("#aiKeyInput").value.trim();
  if (!key) { toast("Incolla prima la chiave API"); return; }
  state.apiKey = key;
  saveState();
  $("#aiKeyInput").value = "";
  renderAiBox();
  toast("Modalità IA attivata 🤖");
}

function removeAiKey() {
  state.apiKey = null;
  saveState();
  renderAiBox();
  toast("Modalità IA disattivata");
}

/* --- UI dettatura --- */

let voiceItems = [];

function openVoiceModal() {
  voiceItems = [];
  $("#voiceText").value = "";
  $("#voiceParsed").innerHTML = "";
  $("#voiceStatus").textContent = "";
  $("#voiceAddAll").classList.add("hidden");
  renderAiBox();
  openModal("voiceModal");
}

async function analyzeVoiceText() {
  const text = $("#voiceText").value.trim();
  if (!text) { toast("Detta o scrivi cosa hai mangiato"); return; }
  stopMic();

  // Con la chiave API: comprensione IA del parlato libero
  if (state.apiKey) {
    $("#voiceParsed").innerHTML = `<p class="hint">🤖 Sto analizzando quello che hai detto…</p>`;
    $("#voiceAddAll").classList.add("hidden");
    try {
      voiceItems = await aiParseFoodText(text);
      if (!voiceItems.length) {
        $("#voiceParsed").innerHTML = `<p class="hint">🤖 Non ho trovato alimenti in quello che hai detto.</p>`;
        return;
      }
      renderVoicePreview();
      return;
    } catch (err) {
      toast(`IA non disponibile (${err.message}): uso il riconoscimento base`);
    }
  }

  voiceItems = parseFoodText(text);
  if (!voiceItems.length) {
    $("#voiceParsed").innerHTML = `<p class="hint">Non ho riconosciuto alimenti: prova a riformulare (es. «100 grammi di riso e una mela»).</p>`;
    $("#voiceAddAll").classList.add("hidden");
    return;
  }
  renderVoicePreview();
  lookupMissingOnline();
}

/** Per le voci non trovate in locale prova Open Food Facts */
async function lookupMissingOnline() {
  const pending = voiceItems.filter((it) => !it.food);
  if (!pending.length) return;
  await Promise.allSettled(pending.map(async (it) => {
    try {
      const results = await searchOFF(it.query);
      if (results.length && !it.food) {
        it.food = { name: results[0].name, emoji: "📦", per100: results[0].per100 };
        if (!it.gramsEdited) it.grams = it.grams || results[0].portion;
      }
    } catch (_) { /* offline o CSP: resta "non trovato" */ }
  }));
  renderVoicePreview();
}

function renderVoicePreview() {
  const el = $("#voiceParsed");
  el.innerHTML = voiceItems.map((it, i) => {
    if (!it.food) {
      return `
        <div class="vp-row">
          <span class="vp-emoji">❓</span>
          <div class="vp-info">
            <div class="vp-name">${esc(it.query)}</div>
            <div class="vp-detail vp-miss">non trovato — cerca e aggiungilo a mano</div>
          </div>
          <button class="sugg-add" data-vsearch="${i}">Cerca</button>
          <button class="vp-x" data-vremove="${i}" title="Rimuovi">✕</button>
        </div>`;
    }
    const n = {
      kcal: it.food.per100.kcal * it.grams / 100,
      p: it.food.per100.p * it.grams / 100,
    };
    const opts = MEALS.map((m) =>
      `<option value="${m.id}" ${m.id === it.meal ? "selected" : ""}>${m.emoji} ${m.label}</option>`).join("");
    return `
      <div class="vp-row">
        <span class="vp-emoji">${it.food.emoji}</span>
        <div class="vp-info">
          <div class="vp-name">${esc(it.food.name)}</div>
          <div class="vp-detail">${r0(n.kcal)} kcal · P ${r0(n.p)} g</div>
        </div>
        <input type="number" class="input vp-grams" data-vgrams="${i}" value="${it.grams}" min="1">
        <select class="input vp-meal" data-vmeal="${i}">${opts}</select>
        <button class="vp-x" data-vremove="${i}" title="Rimuovi">✕</button>
      </div>`;
  }).join("");

  const found = voiceItems.filter((it) => it.food).length;
  $("#voiceAddAll").classList.toggle("hidden", !found);
  $("#voiceAddAll").textContent = `Aggiungi ${found > 1 ? found + " voci" : "al diario"}`;

  $$("[data-vgrams]").forEach((inp) => inp.addEventListener("input", () => {
    const it = voiceItems[Number(inp.dataset.vgrams)];
    it.grams = Math.max(1, Number(inp.value) || 1);
    it.gramsEdited = true;
    const n = it.food.per100;
    inp.parentElement.querySelector(".vp-detail").textContent =
      `${r0(n.kcal * it.grams / 100)} kcal · P ${r0(n.p * it.grams / 100)} g`;
  }));
  $$("[data-vmeal]").forEach((sel) => sel.addEventListener("change", () => {
    voiceItems[Number(sel.dataset.vmeal)].meal = sel.value;
  }));
  $$("[data-vremove]").forEach((btn) => btn.addEventListener("click", () => {
    voiceItems.splice(Number(btn.dataset.vremove), 1);
    renderVoicePreview();
  }));
  $$("[data-vsearch]").forEach((btn) => btn.addEventListener("click", () => {
    const it = voiceItems[Number(btn.dataset.vsearch)];
    closeModal("voiceModal");
    openAddModal(it.meal);
    $("#searchInput").value = it.query;
    onSearchInput();
  }));
}

function addAllVoiceItems() {
  const found = voiceItems.filter((it) => it.food);
  if (!found.length) return;
  for (const it of found) {
    addEntry({ meal: it.meal, name: it.food.name, grams: it.grams, per100: it.food.per100 });
  }
  closeModal("voiceModal");
  toast(`${found.length} ${found.length === 1 ? "voce aggiunta" : "voci aggiunte"} al diario 🎤`);
}

/* --- Riconoscimento vocale (Web Speech API) --- */

let recog = null, recActive = false, voiceFinal = "";

function toggleMic() {
  if (recActive) { stopMic(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $("#voiceStatus").textContent = "Voce non supportata da questo browser: scrivi qui sotto.";
    return;
  }
  recog = new SR();
  recog.lang = "it-IT";
  recog.continuous = true;
  recog.interimResults = true;
  voiceFinal = $("#voiceText").value ? $("#voiceText").value.trim() + ", " : "";
  recog.onresult = (ev) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const t = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) voiceFinal += t + " ";
      else interim += t;
    }
    $("#voiceText").value = (voiceFinal + interim).trim();
  };
  recog.onerror = (ev) => {
    $("#voiceStatus").textContent = ev.error === "not-allowed"
      ? "Microfono negato: consenti l'accesso o scrivi qui sotto."
      : "Microfono non disponibile: scrivi qui sotto.";
  };
  recog.onend = () => stopMic();
  try {
    recog.start();
    recActive = true;
    $("#micBtn").textContent = "⏹ Ferma";
    $("#micBtn").classList.add("recording");
    $("#voiceStatus").textContent = "Ti ascolto… parla pure.";
  } catch (_) {
    $("#voiceStatus").textContent = "Impossibile avviare il microfono: scrivi qui sotto.";
  }
}

function stopMic() {
  if (recog) { try { recog.stop(); } catch (_) {} recog = null; }
  recActive = false;
  const btn = $("#micBtn");
  if (btn) { btn.textContent = "🎤 Parla"; btn.classList.remove("recording"); }
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

/** Giorno di allenamento: +10% kcal rispetto al riposo, tutte da carboidrati */
function trainingFromBase(g) {
  const extra = Math.round(g.kcal * 0.10 / 10) * 10;
  return { kcal: g.kcal + extra, p: g.p, c: g.c + Math.round(extra / 4), f: g.f };
}

function fillCustomGoals(g, train = state.trainingGoals) {
  $("#gKcal").value = g.kcal;
  $("#gProt").value = g.p;
  $("#gCarb").value = g.c;
  $("#gFat").value = g.f;
  $("#gTrainEnabled").checked = Boolean(train);
  if (train) {
    $("#gtKcal").value = train.kcal;
    $("#gtProt").value = train.p;
    $("#gtCarb").value = train.c;
    $("#gtFat").value = train.f;
  }
  syncTrainFields();
  updateGoalsCheck();
}

/** Mostra/nasconde i campi allenamento in base alla spunta */
function syncTrainFields() {
  const on = $("#gTrainEnabled").checked;
  $("#trainFields").classList.toggle("hidden", !on);
  $("#gsecRest").classList.toggle("hidden", !on);
}

function readMacroFields(prefix) {
  return {
    kcal: Number($("#" + prefix + "Kcal").value) || 0,
    p: Number($("#" + prefix + "Prot").value) || 0,
    c: Number($("#" + prefix + "Carb").value) || 0,
    f: Number($("#" + prefix + "Fat").value) || 0,
  };
}

function macroCheckText(g) {
  const fromMacros = g.p * 4 + g.c * 4 + g.f * 9;
  if (!g.kcal || !fromMacros) return "";
  const diff = fromMacros - g.kcal;
  return Math.abs(diff) <= 50
    ? `✓ Coerente: i macro valgono ${fromMacros} kcal.`
    : `⚠️ I macro valgono ${fromMacros} kcal, ${diff > 0 ? "+" : ""}${diff} rispetto alle calorie impostate.`;
}

function updateGoalsCheck() {
  $("#goalsCheck").textContent = macroCheckText(readMacroFields("g"));
  $("#goalsCheckTrain").textContent = macroCheckText(readMacroFields("gt"));
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
  const g = readMacroFields("g");
  if (!g.kcal || g.kcal < 800) {
    switchGoalsTab("custom");
    toast("Imposta le calorie (o usa il calcolo automatico)");
    return;
  }
  if ($("#gTrainEnabled").checked) {
    const t = readMacroFields("gt");
    if (!t.kcal || t.kcal < 800) {
      switchGoalsTab("custom");
      toast("Imposta le calorie dei giorni di allenamento");
      return;
    }
    state.trainingGoals = t;
  } else {
    state.trainingGoals = null;
  }
  state.goals = g;
  saveState();
  closeModal("goalsModal");
  render();
  toast("Obiettivi salvati 💪");
}

function toggleDayType() {
  if (!state.trainingGoals) {
    openGoalsModal();
    switchGoalsTab("custom");
    $("#gTrainEnabled").checked = true;
    prefillTrainFields();
    syncTrainFields();
    toast("Imposta i macro dei giorni di allenamento");
    return;
  }
  if (state.trainingDays[viewDate]) delete state.trainingDays[viewDate];
  else state.trainingDays[viewDate] = true;
  saveState();
  render();
  toast(state.trainingDays[viewDate]
    ? "Giorno di allenamento 🏋️ — macro aggiornati"
    : "Giorno di riposo 🛋️ — macro aggiornati");
}

/** Se i campi allenamento sono vuoti, proponi riposo +10% (carboidrati) */
function prefillTrainFields() {
  if (Number($("#gtKcal").value) > 0) return;
  const base = readMacroFields("g");
  if (!base.kcal) return;
  const t = trainingFromBase(base);
  $("#gtKcal").value = t.kcal;
  $("#gtProt").value = t.p;
  $("#gtCarb").value = t.c;
  $("#gtFat").value = t.f;
  updateGoalsCheck();
}

/* ---------- Coach obiettivi ---------- */

const TRAIN_LABEL = {
  pesi: "pesi", calisthenics: "calisthenics", cardio: "cardio",
  misto: "misto pesi+cardio", sport: "sport", nessuno: "nessun allenamento",
};

/** Fattore attività stimato da frequenza, durata e tipo di allenamento */
function coachActivityFactor(type, sessions, minutes) {
  if (type === "nessuno" || !sessions) return 1.25;
  let f = sessions <= 2 ? 1.375 : sessions <= 4 ? 1.5 : sessions <= 6 ? 1.65 : 1.75;
  if (minutes >= 75 || type === "cardio" || type === "sport") f += 0.05;
  return Math.min(f, 1.9);
}

/** Calorie e macro consigliati per obiettivo e allenamento (riposo + allenamento) */
function coachTargets(input) {
  const { sex, age, weight, height, bf, goal, type, sessions, minutes } = input;
  // Katch-McArdle se conosce la massa grassa, altrimenti Mifflin-St Jeor
  const bmr = bf
    ? 370 + 21.6 * weight * (1 - bf / 100)
    : 10 * weight + 6.25 * height - 5 * age + (sex === "m" ? 5 : -161);
  const tdee = bmr * coachActivityFactor(type, sessions, minutes);

  const kcalMult = { cut: 0.80, maintain: 1.0, bulk: 1.10, recomp: 0.93 }[goal];
  const kcal = Math.round(tdee * kcalMult / 10) * 10;

  const protPerKg = { cut: 2.0, maintain: 1.6, bulk: 1.8, recomp: 2.2 }[goal];
  const p = Math.round(weight * protPerKg);
  const f = Math.round(Math.max(0.7 * weight, kcal * 0.27 / 9));
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  const rest = { kcal, p, c, f };

  // Split allenamento/riposo: le kcal extra dei giorni duri vanno in carboidrati
  let train = null;
  if (sessions >= 2 && type !== "nessuno") {
    const extra = Math.round(kcal * 0.10 / 10) * 10;
    train = { kcal: kcal + extra, p, c: c + Math.round(extra / 4), f };
    if (goal === "cut" || goal === "recomp") {
      const cutRest = Math.round(kcal * 0.95 / 10) * 10;
      rest.c = Math.max(0, rest.c - Math.round((kcal - cutRest) / 4));
      rest.kcal = cutRest;
    }
  }
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), rest, train };
}

/** Elenco di verifiche ok/warn/bad sul piano attuale rispetto al consigliato */
function coachChecks(input, targets) {
  const { weight, goal, type, sessions } = input;
  const checks = [];
  const add = (level, text) => checks.push({ level, text });
  const g = state.goals;

  // Obiettivo calorico attuale vs consigliato
  if (!g) {
    add("warn", "Non hai ancora obiettivi salvati: applica quelli consigliati qui sotto.");
  } else {
    const diff = g.kcal - targets.rest.kcal;
    if (goal === "cut" && g.kcal >= targets.tdee) {
      add("bad", `Con ${g.kcal} kcal non sei in deficit (mantenimento ≈ ${targets.tdee} kcal): così il grasso non scende.`);
    } else if (goal === "cut" && g.kcal < targets.tdee * 0.7) {
      add("bad", `Deficit troppo aggressivo (${g.kcal} kcal): rischi di perdere muscolo e mollare. Meglio ≈ ${targets.rest.kcal} kcal.`);
    } else if (goal === "bulk" && g.kcal <= targets.tdee) {
      add("warn", `Con ${g.kcal} kcal non sei in surplus (mantenimento ≈ ${targets.tdee} kcal): difficile costruire massa.`);
    } else if (Math.abs(diff) <= 150) {
      add("ok", `Calorie in linea con l'obiettivo (${g.kcal} kcal vs ${targets.rest.kcal} consigliate).`);
    } else {
      add("warn", `Le tue ${g.kcal} kcal si discostano dal consigliato (${targets.rest.kcal}): valuta di aggiornarle.`);
    }

    // Proteine
    const perKg = g.p / weight;
    const minP = { cut: 1.8, maintain: 1.4, bulk: 1.6, recomp: 2.0 }[goal];
    if (perKg < minP - 0.3) {
      add("bad", `Proteine basse (${r1(perKg)} g/kg): per questo obiettivo puntane almeno ${minP} g/kg (≈ ${Math.round(weight * minP)} g).`);
    } else if (perKg < minP) {
      add("warn", `Proteine un po' basse (${r1(perKg)} g/kg): meglio ≥ ${minP} g/kg.`);
    } else {
      add("ok", `Proteine adeguate (${r1(perKg)} g/kg): ottimo per ${goal === "cut" || goal === "recomp" ? "preservare il muscolo in deficit" : "supportare l'allenamento"}.`);
    }
  }

  // Allenamento vs obiettivo
  if (type === "nessuno" || sessions === 0) {
    add(goal === "bulk" || goal === "recomp" ? "bad" : "warn",
      goal === "bulk" || goal === "recomp"
        ? "Senza allenamento coi sovraccarichi non si costruisce (né si preserva) massa muscolare: parti da 2–3 sedute di pesi a settimana."
        : "Anche 2–3 allenamenti a settimana aiutano molto: preservano il muscolo e alzano le calorie che puoi mangiare.");
  } else if ((goal === "bulk" || goal === "recomp") && type === "cardio") {
    add("warn", "Solo cardio non basta per la massa muscolare: aggiungi 2–3 sedute di pesi o corpo libero, il cardio tienilo come extra.");
  } else if (goal === "cut" && (type === "pesi" || type === "misto" || type === "calisthenics")) {
    add("ok", `${sessions} sedute di ${TRAIN_LABEL[type]} in deficit: perfetto per perdere grasso preservando il muscolo.`);
  } else {
    add("ok", `${sessions} sedute di ${TRAIN_LABEL[type]} a settimana sono coerenti con l'obiettivo.`);
  }
  if (sessions > 6) {
    add("warn", "Più di 6 sedute a settimana: occhio al recupero, il muscolo cresce quando riposi (e dormi 7–9 ore).");
  }

  // Tempi realistici verso il peso obiettivo
  if (input.targetW && state.goals) {
    const deltaKg = input.targetW - weight;
    const dailyGap = state.goals.kcal - targets.tdee; // + surplus, − deficit
    const weeklyKg = dailyGap * 7 / 7700;
    if (deltaKg < 0 && weeklyKg < 0) {
      const weeks = Math.ceil(deltaKg / weeklyKg);
      const rate = Math.abs(weeklyKg) / weight * 100;
      add(rate > 1 ? "warn" : "ok",
        `Ritmo stimato: ${r1(Math.abs(weeklyKg))} kg/settimana → ~${weeks} settimane per arrivare a ${input.targetW} kg.` +
        (rate > 1 ? " È veloce: sopra l'1% del peso a settimana aumenta la perdita di muscolo." : " Ritmo sostenibile."));
    } else if (deltaKg > 0 && weeklyKg > 0) {
      const weeks = Math.ceil(deltaKg / weeklyKg);
      add(weeklyKg > weight * 0.005 ? "warn" : "ok",
        `Ritmo stimato: +${r1(weeklyKg)} kg/settimana → ~${weeks} settimane per ${input.targetW} kg.` +
        (weeklyKg > weight * 0.005 ? " Surplus generoso: parte del peso sarà grasso." : ""));
    } else if (deltaKg !== 0) {
      add("warn", `Con le calorie attuali non ti muovi verso ${input.targetW} kg: applica i macro consigliati.`);
    }
  }

  // Uso del toggle allenamento/riposo
  if (sessions >= 2 && type !== "nessuno") {
    const marked = countTrainingDaysLast7();
    if (!state.trainingGoals) {
      add("warn", "Ti alleni più volte a settimana: attiva i macro separati per i giorni di allenamento (più carboidrati quando ti alleni).");
    } else if (marked === 0) {
      add("warn", `Hai i macro da allenamento configurati ma negli ultimi 7 giorni non hai marcato nessun giorno 🏋️ (dichiari ${sessions} sedute): usa il toggle in alto.`);
    } else {
      add("ok", `Negli ultimi 7 giorni hai marcato ${marked} giorni di allenamento: il diario segue le tue sedute.`);
    }
  }

  // Aderenza del diario (ultimi 7 giorni con dati)
  if (state.goals) {
    const adh = diaryAverages(7);
    if (adh.days >= 3) {
      const kcalDev = (adh.kcal - state.goals.kcal) / state.goals.kcal;
      if (Math.abs(kcalDev) <= 0.1) {
        add("ok", `Diario: negli ultimi ${adh.days} giorni registrati hai fatto in media ${Math.round(adh.kcal)} kcal, in linea con l'obiettivo.`);
      } else {
        add("warn", `Diario: media di ${Math.round(adh.kcal)} kcal negli ultimi ${adh.days} giorni registrati, ${kcalDev > 0 ? "sopra" : "sotto"} l'obiettivo del ${Math.round(Math.abs(kcalDev) * 100)}%.`);
      }
      if (adh.p < state.goals.p * 0.8) {
        add("warn", `Diario: proteine medie ${Math.round(adh.p)} g/giorno, sotto l'obiettivo di ${state.goals.p} g — è il macro da sistemare per primo.`);
      }
    }
  }

  return checks;
}

function countTrainingDaysLast7() {
  let n = 0;
  for (let i = 0; i < 7; i++) if (state.trainingDays[todayKey(-i)]) n++;
  return n;
}

function diaryAverages(lastNDays) {
  let days = 0, kcal = 0, p = 0;
  for (let i = 0; i < lastNDays; i++) {
    const key = todayKey(-i);
    if (!dayEntries(key).length) continue;
    const t = dayTotals(key);
    days++; kcal += t.kcal; p += t.p;
  }
  return days ? { days, kcal: kcal / days, p: p / days } : { days: 0, kcal: 0, p: 0 };
}

/** Consigli che collegano nutrizione e allenamento, in base al tipo */
function coachLinkTips(input) {
  const { type, goal } = input;
  const tips = [];
  if (type !== "nessuno" && input.sessions > 0) {
    tips.push(type === "cardio" || type === "sport"
      ? "⏱️ <strong>1–2 ore prima</strong> della seduta: carboidrati facili da digerire (banana, pane con marmellata, gallette) e poca fibra/grassi."
      : "⏱️ <strong>1–2 ore prima</strong> dei pesi: carboidrati + un po' di proteine (yogurt greco con frutta, pane e bresaola).");
    tips.push("💪 <strong>Entro un paio d'ore dopo</strong>: proteine (25–40 g) + carboidrati per il recupero — es. pollo con riso, uova e pane, oppure whey con una banana.");
    tips.push("🍚 Nei <strong>giorni di allenamento</strong> metti più carboidrati (usa il toggle 🏋️), nei giorni di riposo più verdure e grassi buoni a parità di proteine.");
  }
  tips.push("🥩 Distribuisci le proteine su 3–4 pasti (~0,3–0,4 g/kg a pasto): l'app te le mostra pasto per pasto.");
  if (goal === "cut" || goal === "recomp") {
    tips.push("🥦 In deficit punta su cibi voluminosi e poco calorici (verdure, patate, yogurt greco, carni magre): stessa sazietà, meno kcal.");
  }
  if (goal === "bulk") {
    tips.push("🥜 Se fai fatica a mangiare tutto, usa cibi densi: frutta secca, olio EVO, granola — tante kcal in poco volume.");
  }
  tips.push("💧 Bevi ~30–35 ml/kg al giorno, di più nei giorni di allenamento.");
  return tips;
}

let coachTargetsCache = null;

function readCoachInput() {
  return {
    sex: $("#cSex").value,
    age: Number($("#cAge").value) || 30,
    weight: Number($("#cWeight").value) || 75,
    height: Number($("#cHeight").value) || 175,
    bf: Number($("#cBf").value) || null,
    goal: $("#cGoal").value,
    targetW: Number($("#cTargetW").value) || null,
    type: $("#cTrainType").value,
    sessions: Number($("#cSessions").value) || 0,
    minutes: Number($("#cMinutes").value) || 60,
  };
}

function openCoachModal() {
  const c = state.coach || {};
  const prof = state.profile || {};
  $("#cSex").value = c.sex || prof.sex || "m";
  $("#cAge").value = c.age || prof.age || 30;
  $("#cWeight").value = c.weight || prof.weight || 75;
  $("#cHeight").value = c.height || prof.height || 175;
  $("#cBf").value = c.bf || "";
  $("#cGoal").value = c.goal || (prof.goal === "cut" || prof.goal === "bulk" ? prof.goal : "maintain");
  $("#cTargetW").value = c.targetW || "";
  $("#cTrainType").value = c.type || "pesi";
  $("#cSessions").value = c.sessions ?? 3;
  $("#cMinutes").value = c.minutes || 60;
  $("#coachResults").innerHTML = "";
  openModal("coachModal");
}

function runCoach() {
  const input = readCoachInput();
  state.coach = input;
  saveState();

  const targets = coachTargets(input);
  coachTargetsCache = targets;
  const checks = coachChecks(input, targets);
  const tips = coachLinkTips(input);

  const LEVEL = { ok: "✅", warn: "⚠️", bad: "❌" };
  const trainRow = targets.train ? `
      <tr><td>🏋️ Allenamento</td><td>${targets.train.kcal}</td><td>${targets.train.p}</td><td>${targets.train.c}</td><td>${targets.train.f}</td></tr>` : "";

  $("#coachResults").innerHTML = `
    <p class="gsection">📋 Verdetto</p>
    <p class="hint">Mantenimento stimato: <strong>${targets.tdee} kcal/giorno</strong> (metabolismo base ${targets.bmr} kcal).</p>
    <div class="coach-checks">
      ${checks.map((ch) => `
        <div class="coach-check coach-${ch.level}">
          <span>${LEVEL[ch.level]}</span>
          <span>${ch.text}</span>
        </div>`).join("")}
    </div>

    <p class="gsection">🎯 Macro consigliati</p>
    <div class="coach-table-wrap">
      <table class="coach-table">
        <thead><tr><th>Giorno</th><th>kcal</th><th>P (g)</th><th>C (g)</th><th>G (g)</th></tr></thead>
        <tbody>
          <tr><td>${targets.train ? "🛋️ Riposo" : "Ogni giorno"}</td><td>${targets.rest.kcal}</td><td>${targets.rest.p}</td><td>${targets.rest.c}</td><td>${targets.rest.f}</td></tr>${trainRow}
        </tbody>
      </table>
    </div>
    <button class="btn primary full" id="coachApply">Applica questi obiettivi</button>

    <p class="gsection">🔗 Nutrizione ↔ allenamento</p>
    <div class="coach-tips">${tips.map((t) => `<p class="coach-tip">${t}</p>`).join("")}</div>
    <p class="hint">Stime indicative basate su formule standard (Mifflin-St Jeor / Katch-McArdle):
      non sostituiscono medico o nutrizionista.</p>`;

  $("#coachApply").addEventListener("click", applyCoachTargets);
  $("#coachResults").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function applyCoachTargets() {
  if (!coachTargetsCache) return;
  state.goals = { ...coachTargetsCache.rest };
  state.trainingGoals = coachTargetsCache.train ? { ...coachTargetsCache.train } : null;
  saveState();
  render();
  closeModal("coachModal");
  toast("Obiettivi del coach applicati 🧭");
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
  $("#fabVoice").addEventListener("click", openVoiceModal);
  $("#micBtn").addEventListener("click", toggleMic);
  $("#voiceParse").addEventListener("click", analyzeVoiceText);
  $("#voiceAddAll").addEventListener("click", addAllVoiceItems);
  $("#aiKeySave").addEventListener("click", saveAiKey);
  $("#aiRemoveKey").addEventListener("click", removeAiKey);
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
    const base = computeGoals(profile);
    const trainOn = $("#gTrainEnabled").checked;
    fillCustomGoals(base, trainOn ? trainingFromBase(base) : null);
    switchGoalsTab("custom");
    toast("Macro calcolati: controlla e salva");
  });
  ["gKcal", "gProt", "gCarb", "gFat", "gtKcal", "gtProt", "gtCarb", "gtFat"].forEach((id) =>
    $("#" + id).addEventListener("input", updateGoalsCheck)
  );
  $("#gTrainEnabled").addEventListener("change", () => {
    if ($("#gTrainEnabled").checked) prefillTrainFields();
    syncTrainFields();
  });
  $("#dayTypeToggle").addEventListener("click", toggleDayType);
  $("#saveGoals").addEventListener("click", saveGoals);

  // Coach
  $("#openCoach").addEventListener("click", openCoachModal);
  $("#coachRun").addEventListener("click", runCoach);

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
    ["addModal", "amountModal", "voiceModal", "coachModal"].forEach(closeModal);
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
