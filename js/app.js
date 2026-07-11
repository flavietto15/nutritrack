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
  if (!s.workouts) s.workouts = {};
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

let staggerNextRender = true; // all'avvio e al cambio giorno le liste entrano in sequenza

function shiftViewDate(days) {
  const [y, m, d] = viewDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  viewDate = dateToKey(dt);
  staggerNextRender = true;
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

/* ---------- Animazioni (Motion) ---------- */

const MOTION_OK = typeof Motion !== "undefined" &&
  !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

const EASE_OUT = [0.22, 1, 0.36, 1];

const fx = {
  /** Anello kcal con effetto molla (al posto della transizione CSS) */
  ring(el, to) {
    const from = parseFloat(el.style.strokeDashoffset);
    if (!MOTION_OK || isNaN(from) || Math.abs(from - to) < 1) {
      el.style.strokeDashoffset = to;
      return;
    }
    el.style.transition = "stroke 0.3s";
    Motion.animate(from, to, {
      type: "spring", stiffness: 110, damping: 22,
      onUpdate: (v) => { el.style.strokeDashoffset = v; },
    });
  },

  /** Numero che "conta" fino al nuovo valore */
  count(el, value, suffix = "", prefix = "") {
    const from = parseFloat((el.textContent || "").replace(/[^\d.-]/g, ""));
    const write = (v) => { el.textContent = prefix + r0(v) + suffix; };
    if (!MOTION_OK || isNaN(from) || r0(from) === r0(value)) { write(value); return; }
    Motion.animate(from, value, { duration: 0.6, ease: EASE_OUT, onUpdate: write });
  },

  /** Barre dei macro dal valore precedente al nuovo */
  meterFill(el, from, to) {
    if (!MOTION_OK || Math.abs(from - to) < 0.5) return;
    el.style.transition = "none";
    Motion.animate(el, { width: [from + "%", to + "%"] }, { duration: 0.55, ease: EASE_OUT });
  },

  /** Elementi di una lista che entrano in sequenza */
  staggerList(els) {
    if (!MOTION_OK || !els.length) return;
    Motion.animate(els, { opacity: [0, 1], y: [10, 0] },
      { delay: Motion.stagger(0.04), duration: 0.35, ease: EASE_OUT });
  },

  /** Comparsa dei pulsanti flottanti all'avvio */
  fabIntro(els) {
    if (!MOTION_OK) return;
    Motion.animate(els, { opacity: [0, 1], scale: [0.4, 1] },
      { delay: Motion.stagger(0.07, { startDelay: 0.25 }), type: "spring", stiffness: 380, damping: 22 });
  },
};

let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
}

const modalCloseToken = {};

function openModal(id) {
  const bd = $("#" + id);
  modalCloseToken[id] = null; // annulla un'eventuale chiusura in corso
  bd.style.opacity = "";
  const m = bd.querySelector(".modal");
  if (m) { m.style.opacity = ""; m.style.transform = ""; }
  bd.classList.remove("hidden");
  if (MOTION_OK) {
    Motion.animate(bd, { opacity: [0, 1] }, { duration: 0.18, ease: "easeOut" });
    if (m) Motion.animate(m,
      { opacity: [0, 1], scale: [0.94, 1], y: [18, 0] },
      { type: "spring", stiffness: 420, damping: 32 });
  }
}

function closeModal(id) {
  const bd = $("#" + id);
  if (!bd.classList.contains("hidden")) {
    const m = bd.querySelector(".modal");
    if (MOTION_OK) {
      const token = {};
      modalCloseToken[id] = token;
      if (m) Motion.animate(m,
        { opacity: 0, scale: 0.96, y: 12 },
        { duration: 0.13, ease: "easeIn" });
      Motion.animate(bd, { opacity: 0 }, { duration: 0.16, ease: "easeIn" }).finished.then(() => {
        if (modalCloseToken[id] !== token) return; // riaperto nel frattempo
        bd.classList.add("hidden");
        bd.style.opacity = "";
        if (m) { m.style.opacity = ""; m.style.transform = ""; }
      });
    } else {
      bd.classList.add("hidden");
    }
  }
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
  fx.ring(ring, RING_C * (1 - pct));
  ring.classList.toggle("over", totals.kcal > g.kcal);
  fx.count($("#ringValue"), totals.kcal);
  fx.count($("#statGoal"), g.kcal, " kcal");
  fx.count($("#statEaten"), totals.kcal, " kcal");
  const leftEl = $("#statLeft");
  if (rem.kcal >= 0) {
    fx.count(leftEl, rem.kcal, " kcal");
    leftEl.classList.remove("negative");
  } else {
    fx.count(leftEl, -rem.kcal, " oltre", "+");
    leftEl.classList.add("negative");
  }

  renderMeters(totals);
  renderSuggestions();
  renderTraining();
  renderMeals();

  if (staggerNextRender) {
    staggerNextRender = false;
    fx.staggerList($$("#mealsRoot .meal-card"));
  }
}

const prevMeterPct = {};

function renderMeters(totals) {
  const g = activeGoals();
  const pcts = {};
  $("#macroMeters").innerHTML = MACROS.map((m) => {
    const eaten = totals[m.id];
    const goal = g[m.id];
    const pct = goal > 0 ? Math.min((eaten / goal) * 100, 100) : 0;
    pcts[m.id] = pct;
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

  // Le barre si muovono dal valore precedente al nuovo
  $$("#macroMeters .meter-fill").forEach((fill, i) => {
    const id = MACROS[i].id;
    fx.meterFill(fill, prevMeterPct[id] ?? 0, pcts[id]);
    prevMeterPct[id] = pcts[id];
  });
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
      : `<div class="empty-meal">Nessun alimento — tocca <strong>+</strong> qui sopra, oppure 🎤 Detta o 📷 Scan in basso.</div>`;
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

function renderResults(items, query = "") {
  // Con la modalità IA attiva, qualsiasi cosa cercata (anche un piatto
  // composto tipo "carbonara") può passare dal nutrizionista IA, che la
  // scompone in ingredienti e stima le porzioni da ristorante.
  const aiRow = query && state.apiKey ? `
    <div class="result-row ai-ask" id="aiAskRow">
      <span class="result-emoji">🤖</span>
      <div class="result-info">
        <div class="result-name">Chiedi al nutrizionista IA: «${esc(query)}»</div>
        <div class="result-detail">scompone il piatto in ingredienti e stima le porzioni da ristorante</div>
      </div>
      <span class="result-src">IA</span>
    </div>` : "";
  $("#searchResults").innerHTML = items.map((it, i) => `
    <div class="result-row" data-idx="${i}">
      <span class="result-emoji">${it.emoji}</span>
      <div class="result-info">
        <div class="result-name">${esc(it.name)}</div>
        <div class="result-detail">${r0(it.per100.kcal)} kcal · P ${r1(it.per100.p)} · C ${r1(it.per100.c)} · G ${r1(it.per100.f)} / 100 g</div>
      </div>
      <span class="result-src">${it.source}</span>
    </div>`).join("") + aiRow;
  $$(".result-row[data-idx]").forEach((row) =>
    row.addEventListener("click", () => openAmountModal(items[Number(row.dataset.idx)]))
  );
  const ask = $("#aiAskRow");
  if (ask) ask.addEventListener("click", () => askAiFromSearch(query));
}

/** Passa la query della ricerca manuale al nutrizionista IA (riusa la dettatura) */
function askAiFromSearch(query) {
  const meal = $("#addModal").dataset.meal || currentMealSlot();
  const prefix = { colazione: "a colazione", pranzo: "a pranzo", spuntino: "come spuntino", cena: "a cena" }[meal] || "";
  closeModal("addModal");
  openVoiceModal();
  $("#voiceText").value = `${prefix} ${query}`.trim();
  analyzeVoiceText();
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
  renderResults(items, q);
  $("#searchHint").textContent = "Cerco anche su Open Food Facts…";

  searchTimer = setTimeout(async () => {
    searchAbort = new AbortController();
    try {
      const off = await searchOFF(q, searchAbort.signal);
      // Rileggi il campo: l'utente potrebbe aver già cambiato query
      if ($("#searchInput").value.trim() !== q) return;
      items = items.concat(off);
      renderResults(items, q);
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

    // conteggi ("due", "3"), misure ("cucchiai", "fette", "piatto") e formati ("mini")
    let count = null, measure = null, mini = false;
    const rest = [];
    for (const w of seg.split(/[^a-z0-9']+/).filter(Boolean)) {
      if (MEASURE_WORDS[w] !== undefined) { measure = MEASURE_WORDS[w]; continue; }
      if (NUM_WORDS[w] !== undefined) { count = NUM_WORDS[w]; continue; }
      if (/^\d+([.,]\d+)?$/.test(w)) { count = parseFloat(w.replace(",", ".")); continue; }
      if (w === "mini" || w === "mignon" || /^piccol[oaie]?$/.test(w)) { mini = true; continue; }
      if (!PARSE_STOPWORDS.has(w)) rest.push(w);
    }
    if (!rest.length) continue;

    const food = matchFood(rest);
    items.push({
      query: rest.join(" "),
      meal,
      grams: resolveGrams({ grams, count, measure, mini }, food),
      food: food ? {
        name: food.name,
        emoji: foodEmoji(food),
        per100: { kcal: food.kcal, p: food.p, c: food.c, f: food.f },
      } : null,
    });
  }
  return items;
}

function resolveGrams({ grams, count, measure, mini }, food) {
  if (grams) return Math.round(grams);
  const size = mini ? 0.5 : 1; // "mini"/"mignon": circa metà del formato normale
  const portion = (food ? food.portion : 100) * size;
  const unit = food && food.unit ? food.unit * size : null;
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

/* --- Modalità IA: comprensione del parlato libero e analisi coach ---
   Due provider: Google Gemini (chiave creabile gratis su aistudio.google.com)
   o Anthropic (chiave sk-ant-…). Il formato delle chiavi Google cambia nel
   tempo (AIza…, AQ…), quindi l'unico prefisso su cui si può decidere è
   quello Anthropic: sk-… → Anthropic, qualsiasi altra chiave → Gemini. --- */

const AI_MODEL = "claude-opus-4-8";
const GEMINI_MODEL = "gemini-2.5-flash";
// Modelli di riserva, in ordine: prima il "lite" (quota giornaliera più alta),
// poi gli alias "-latest" di Google che puntano sempre al modello più recente —
// così se Google ritira un modello (es. per le chiavi nuove) l'app non si rompe.
const GEMINI_FALLBACKS = ["gemini-2.5-flash-lite", "gemini-flash-lite-latest", "gemini-flash-latest"];

function aiProvider() {
  return state.apiKey && state.apiKey.startsWith("sk-") ? "anthropic" : "gemini";
}

function aiProviderLabel() {
  return aiProvider() === "gemini" ? "Google Gemini, piano gratuito" : "Claude di Anthropic";
}

/** Converte il nostro JSON Schema nel formato schema di Gemini */
function jsonSchemaToGemini(s) {
  const out = {};
  if (s.type) out.type = String(s.type).toUpperCase();
  if (s.enum) out.enum = s.enum;
  if (s.description) out.description = s.description;
  if (s.required) out.required = s.required;
  if (s.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(s.properties)) out.properties[k] = jsonSchemaToGemini(v);
  }
  if (s.items) out.items = jsonSchemaToGemini(s.items);
  return out;
}

/** Chiamata IA unificata: blocks = [{type:"text",text}|{type:"image"|"pdf",media_type,data}] */
async function aiComplete({ system, schema, blocks, maxTokens, effort }) {
  if (aiProvider() === "gemini") {
    const parts = blocks.map((b) => b.type === "text"
      ? { text: b.text }
      : { inline_data: { mime_type: b.media_type, data: b.data } });
    const bodyFor = (model) => JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        maxOutputTokens: 8192,
        // a parità di input la risposta deve restare la stessa
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: jsonSchemaToGemini(schema),
        // effort "low" = risposta immediata; altrimenti il modello ragiona
        // prima di rispondere (dettatura nutrizionista e coach).
        // Solo per la famiglia 2.5: i modelli più nuovi dietro gli alias
        // potrebbero non accettare questo parametro.
        ...(model.startsWith("gemini-2.5")
          ? { thinkingConfig: { thinkingBudget: effort === "low" ? 0 : 8192 } }
          : {}),
      },
    });
    // Quota esaurita (429) o modello ritirato/non trovato: prova il successivo.
    let quotaHit = false;
    let lastMsg = "";
    for (const model of [GEMINI_MODEL, ...GEMINI_FALLBACKS]) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": state.apiKey },
        body: bodyFor(model),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        const msg = err?.error?.message || "errore " + res.status;
        if (res.status === 403 || (res.status === 400 && /api key/i.test(msg)))
          throw new Error("chiave Gemini non valida o non abilitata");
        if (res.status === 429) { quotaHit = true; continue; }
        if (res.status === 404 || /no longer available|not (?:found|available)|deprecat|retired/i.test(msg)) {
          lastMsg = msg;
          continue;
        }
        throw new Error(msg);
      }
      const data = await res.json();
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      if (!text) throw new Error("risposta vuota da Gemini");
      return JSON.parse(text);
    }
    throw new Error(quotaHit
      ? "limite gratuito Gemini esaurito per ora: riprova tra un minuto; se hai finito le richieste del giorno, si azzerano ogni notte"
      : lastMsg || "nessun modello Gemini disponibile");
  }

  // Anthropic
  const content = blocks.map((b) => {
    if (b.type === "text") return { type: "text", text: b.text };
    return { type: b.type === "pdf" ? "document" : "image",
      source: { type: "base64", media_type: b.media_type, data: b.data } };
  });
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
      max_tokens: maxTokens,
      system,
      output_config: { effort, format: { type: "json_schema", schema } },
      messages: [{ role: "user", content }],
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
  return JSON.parse(block.text);
}

const AI_SYSTEM = `Sei un nutrizionista professionista italiano, motore di un diario alimentare.
Ricevi la trascrizione di un messaggio vocale in cui una persona racconta liberamente cosa ha
mangiato o bevuto. Estrai SOLO gli alimenti e le bevande effettivamente consumati, ignorando il
resto del discorso (luoghi, persone, commenti, divagazioni). Lavora con il rigore di una visita
nutrizionale: stime accurate e realistiche, mai numeri di comodo arrotondati a 100 g.

SCOMPOSIZIONE DEI PIATTI — regola centrale. OGNI piatto composto va scomposto in UNA VOCE PER
INGREDIENTE, con il campo "piatto" uguale per tutte le voci di quel piatto:
- pasta alla carbonara → pasta, guanciale, uova/tuorli, pecorino;
- pizza margherita → impasto, passata di pomodoro, mozzarella, olio;
- lasagna → sfoglia all'uovo, ragù, besciamella, parmigiano;
- panino / piadina / insalatona / poke → pane o base + OGNI farcitura, salse comprese.
Conta anche gli ingredienti "invisibili" che un ristoratore usa davvero: olio per soffriggere o
condire, burro, zucchero nelle salse, pangrattato nelle panature. Restano una voce sola
(piatto = "") solo gli alimenti semplici (una mela, una bistecca, uno yogurt) e le preparazioni
davvero omogenee (frullato, purè, brodo, vellutata).

QUANTITÀ — in ordine di priorità:
1. Peso detto dall'utente per quell'ingrediente: vincolante, non modificarlo mai.
2. Peso detto solo per UN ingrediente del piatto ("100 g di pasta alla carbonara", "250 g di
   impasto per la pizza"): usalo come ÀNCORA. Fissa quell'ingrediente e ricava TUTTI gli altri
   in proporzione dalle ricette reali di ristorazione (es. carbonara per 100 g di pasta secca:
   guanciale ≈ 35 g, uova/tuorli ≈ 45 g, pecorino ≈ 18 g; pizza per 250 g di impasto:
   pomodoro ≈ 90 g, mozzarella ≈ 90 g, olio ≈ 10 g).
3. Nessuna quantità: ragiona come se avessi pesato quel piatto in un campione enorme di
   ristoranti, trattorie e pizzerie italiane. Per ogni ingrediente stima il peso MEDIANO
   davvero servito dai ristoratori e usa quello (es. carbonara al ristorante ≈ 110-130 g di
   pasta secca; lasagna ≈ 300-380 g totali; patatine fritte ≈ 150 g; smash burger ≈ 250 g
   totali). L'obiettivo è avvicinarsi il più possibile a ciò che finisce davvero nel piatto.

PEZZI: se la persona conta i pezzi ("2 fagottini", "tre biscotti"), compila "pezzi" e stima in
"grammi_a_pezzo" il peso realistico di UN pezzo, facendo attenzione al formato: «mini» o
«mignon» pesa circa la metà del formato normale (mini fagottino o mini cornetto ≈ 25 g,
fagottino/cornetto normale ≈ 50-60 g, biscotto ≈ 8-12 g, cioccolatino ≈ 10 g, polpetta
≈ 30-40 g, pezzo di sushi ≈ 25-35 g); in "grammi" metti il totale = pezzi × grammi_a_pezzo.
Se non ci sono pezzi contati metti pezzi = 0 e grammi_a_pezzo = 0.

CRUDO/COTTO: se l'utente dà il peso di pasta o riso ("80 g di pasta") intende il peso a crudo:
usa i valori per 100 g del crudo. Se stimi tu un piatto già pronto puoi ragionare da cotto, ma
i valori per 100 g devono riferirsi SEMPRE allo stesso stato del peso indicato in "grammi".

VALORI: per ogni voce stima kcal, proteine, carboidrati e grassi medi per 100 g da fonti
standard (CREA/USDA), riferiti all'ingrediente così com'è nel piatto.

PASTO: usa i riferimenti nel testo ("stasera" → cena, "stamattina" → colazione, "a pranzo" →
pranzo); senza riferimenti, deducilo dall'ora attuale indicata; tutte le voci dello stesso
piatto vanno nello stesso pasto.
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
        required: ["nome", "piatto", "pasto", "pezzi", "grammi_a_pezzo", "grammi", "kcal_100g", "proteine_100g", "carboidrati_100g", "grassi_100g"],
        properties: {
          nome: { type: "string", description: "Nome breve dell'alimento in italiano" },
          piatto: { type: "string", description: "Nome del piatto composto di cui questa voce è un ingrediente (es. 'Carbonara'); stringa vuota se l'alimento è a sé" },
          pasto: { type: "string", enum: ["colazione", "pranzo", "spuntino", "cena"] },
          pezzi: { type: "number", description: "Numero di pezzi contati dalla persona; 0 se non conta a pezzi" },
          grammi_a_pezzo: { type: "number", description: "Peso realistico di un singolo pezzo in grammi; 0 se non conta a pezzi" },
          grammi: { type: "number", description: "Porzione totale consumata stimata, in grammi (= pezzi × grammi_a_pezzo se contata a pezzi)" },
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
  const parsed = await aiComplete({
    system: AI_SYSTEM,
    schema: AI_SCHEMA,
    maxTokens: 3000,
    // il nutrizionista ragiona prima di pesare: scomposizione e proporzioni
    // richiedono il thinking attivo, come per il coach
    effort: "high",
    blocks: [{
      type: "text",
      text: `Ora attuale: ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}.\nTrascrizione: «${text}»`,
    }],
  });
  return (parsed.alimenti || []).map((a) => {
    // Il totale si ricalcola qui da pezzi × peso a pezzo: non ci si fida
    // della moltiplicazione fatta dal modello dentro "grammi".
    const pieces = Math.max(0, Math.round(a.pezzi || 0));
    const perPiece = Math.max(0, Math.round(a.grammi_a_pezzo || 0));
    const byPieces = pieces > 0 && perPiece > 0;
    const grams = Math.max(1, byPieces ? pieces * perPiece : Math.round(a.grammi));
    return {
      query: a.nome,
      dish: (a.piatto || "").trim(),
      meal: MEALS.some((m) => m.id === a.pasto) ? a.pasto : currentMealSlot(),
      grams,
      // peso stimato in origine: serve a riproporzionare gli altri
      // ingredienti del piatto quando l'utente ne corregge uno
      origGrams: grams,
      pieces: byPieces ? { n: pieces, g: perPiece } : null,
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
    };
  });
}

function renderAiBox() {
  const has = Boolean(state.apiKey);
  $("#aiKeyRow").classList.toggle("hidden", has);
  $("#aiRemoveKey").classList.toggle("hidden", !has);
  $("#aiStatus").innerHTML = has
    ? `🤖 <strong>Modalità IA attiva</strong> (${aiProviderLabel()}): parla liberamente («100 g di pasta alla carbonara…») e faccio da nutrizionista: scompongo ogni piatto nei suoi ingredienti, rispetto i pesi che mi dai (anche solo quello della pasta o della base) e per il resto uso le porzioni medie servite dai ristoranti. Vale anche per il Coach obiettivi.`
    : '🤖 Vuoi la <strong>modalità IA</strong> (parlato libero + Coach potenziato)? <strong>Gratis</strong>: vai su <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> con il tuo account Google, premi "Create API key" e incolla qui la chiave. In alternativa una chiave Anthropic da <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>. La chiave resta salvata solo sul tuo dispositivo:';
}

/** Chiamata minima al provider per verificare subito che la chiave funzioni davvero */
async function aiTestKey() {
  try {
    await aiComplete({
      system: "Rispondi solo con ok = true.",
      schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
      blocks: [{ type: "text", text: "test di attivazione" }],
      maxTokens: 100,
      effort: "low",
    });
  } catch (err) {
    if (err instanceof TypeError) throw new Error("nessuna connessione a internet o richiesta bloccata dal browser");
    throw err;
  }
}

async function saveAiKey() {
  // le chiavi non contengono mai spazi o virgolette: via i residui di copia-incolla
  const key = $("#aiKeyInput").value.replace(/[\s"'«»]/g, "");
  if (!key) { toast("Incolla prima la chiave API"); return; }
  const btn = $("#aiKeySave");
  btn.disabled = true;
  btn.textContent = "Verifico…";
  $("#aiStatus").innerHTML = "🤖 Sto provando la chiave con una richiesta di test…";
  const prev = state.apiKey;
  state.apiKey = key;
  try {
    await aiTestKey();
    saveState();
    $("#aiKeyInput").value = "";
    renderAiBox();
    toast(`Modalità IA attivata con ${aiProviderLabel()} 🤖`);
  } catch (err) {
    state.apiKey = prev;
    $("#aiStatus").innerHTML = `⚠️ <strong>Chiave non attivata</strong> — ${esc(err.message)}.<br>
      Controlla di aver copiato la chiave intera da
      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>
      e riprova; se l'hai appena creata, aspetta un minuto.`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Attiva";
  }
}

function removeAiKey() {
  state.apiKey = null;
  saveState();
  renderAiBox();
  toast("Modalità IA disattivata");
}

/* --- UI dettatura --- */

let voiceItems = [];
let voiceAiError = "";

function openVoiceModal() {
  voiceItems = [];
  voiceAiError = "";
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
  voiceAiError = "";
  if (state.apiKey) {
    $("#voiceParsed").innerHTML = `<p class="hint">🤖 Il nutrizionista IA sta ragionando: scompone i piatti e pesa ogni ingrediente…</p>`;
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
      // l'errore resta visibile nell'anteprima, non solo in un toast che sparisce
      voiceAiError = err.message;
    }
  }

  voiceItems = parseFoodText(text);
  if (!voiceItems.length) {
    $("#voiceParsed").innerHTML = voiceAiErrorHtml() +
      `<p class="hint">Non ho riconosciuto alimenti: prova a riformulare (es. «100 grammi di riso e una mela»).</p>`;
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

function voiceAiErrorHtml() {
  if (!voiceAiError) return "";
  return `<p class="vp-error">⚠️ <strong>IA non disponibile</strong> (${esc(voiceAiError)}):
    questi risultati vengono dal riconoscimento base.</p>`;
}

/** Testo riassuntivo di una voce (mostra i pezzi solo finché il totale coincide) */
function vpDetail(it) {
  const n = it.food.per100;
  const showPieces = it.pieces && it.grams === it.pieces.n * it.pieces.g;
  return `${showPieces ? `${it.pieces.n} pz × ${it.pieces.g} g · ` : ""}${r0(n.kcal * it.grams / 100)} kcal · P ${r0(n.p * it.grams / 100)} g`;
}

let voiceDishNames = []; // indice gruppo → nome piatto, per aggiornare i totali

function refreshDishTotals() {
  $$("#voiceParsed [data-dishtotal]").forEach((span) => {
    const dish = voiceDishNames[Number(span.dataset.dishtotal)];
    let kcal = 0, p = 0;
    for (const it of voiceItems) {
      if (it.food && (it.dish || "") === dish) {
        kcal += it.food.per100.kcal * it.grams / 100;
        p += it.food.per100.p * it.grams / 100;
      }
    }
    span.textContent = `${r0(kcal)} kcal · P ${r0(p)} g`;
  });
}

function renderVoicePreview() {
  const el = $("#voiceParsed");

  const rowHtml = (it, i, sub) => {
    if (!it.food) {
      return `
        <div class="vp-row${sub}">
          <span class="vp-emoji">❓</span>
          <div class="vp-info">
            <div class="vp-name">${esc(it.query)}</div>
            <div class="vp-detail vp-miss">non trovato — cerca e aggiungilo a mano</div>
          </div>
          <button class="sugg-add" data-vsearch="${i}">Cerca</button>
          <button class="vp-x" data-vremove="${i}" title="Rimuovi">✕</button>
        </div>`;
    }
    const opts = MEALS.map((m) =>
      `<option value="${m.id}" ${m.id === it.meal ? "selected" : ""}>${m.emoji} ${m.label}</option>`).join("");
    return `
      <div class="vp-row${sub}">
        <span class="vp-emoji">${it.food.emoji}</span>
        <div class="vp-info">
          <div class="vp-name">${esc(it.food.name)}</div>
          <div class="vp-detail">${vpDetail(it)}</div>
        </div>
        <input type="number" class="input vp-grams" data-vgrams="${i}" value="${it.grams}" min="1">
        <select class="input vp-meal" data-vmeal="${i}">${opts}</select>
        <button class="vp-x" data-vremove="${i}" title="Rimuovi">✕</button>
      </div>`;
  };

  // Raggruppa gli ingredienti dello stesso piatto sotto un'intestazione
  const groups = [];
  const byDish = new Map();
  voiceItems.forEach((it, i) => {
    const dish = it.food && it.dish ? it.dish : "";
    if (dish) {
      if (!byDish.has(dish)) {
        const g = { dish, rows: [] };
        byDish.set(dish, g);
        groups.push(g);
      }
      byDish.get(dish).rows.push(i);
    } else {
      groups.push({ dish: "", rows: [i] });
    }
  });

  voiceDishNames = [];
  let hasDish = false;
  const html = groups.map((g) => {
    if (g.dish && g.rows.length > 1) {
      hasDish = true;
      const gi = voiceDishNames.push(g.dish) - 1;
      return `
        <div class="vp-dish">
          <span class="vp-dish-name">🍽️ ${esc(g.dish)}</span>
          <span class="vp-dish-total" data-dishtotal="${gi}"></span>
        </div>` +
        g.rows.map((i) => rowHtml(voiceItems[i], i, " vp-sub")).join("");
    }
    return g.rows.map((i) => rowHtml(voiceItems[i], i, "")).join("");
  }).join("");

  el.innerHTML = voiceAiErrorHtml() + html +
    (hasDish ? `<p class="vp-scale-hint">⚖️ Piatto scomposto dal nutrizionista IA: correggi il peso di un ingrediente (es. la pasta) e riproporziono gli altri.</p>` : "");
  refreshDishTotals();

  const found = voiceItems.filter((it) => it.food).length;
  $("#voiceAddAll").classList.toggle("hidden", !found);
  $("#voiceAddAll").textContent = `Aggiungi ${found > 1 ? found + " voci" : "al diario"}`;

  fx.staggerList($$("#voiceParsed .vp-row"));

  $$("[data-vgrams]").forEach((inp) => inp.addEventListener("input", () => {
    const i = Number(inp.dataset.vgrams);
    const it = voiceItems[i];
    it.grams = Math.max(1, Number(inp.value) || 1);
    it.gramsEdited = true;
    inp.parentElement.querySelector(".vp-detail").textContent = vpDetail(it);
    // Nutrizionista: gli altri ingredienti del piatto seguono in proporzione,
    // tranne quelli già corretti a mano e quelli contati a pezzi.
    if (it.dish && it.origGrams) {
      const factor = it.grams / it.origGrams;
      voiceItems.forEach((sib, j) => {
        if (j === i || !sib.food || (sib.dish || "") !== it.dish) return;
        if (sib.gramsEdited || sib.pieces || !sib.origGrams) return;
        sib.grams = Math.max(1, Math.round(sib.origGrams * factor));
        const sInp = $(`[data-vgrams="${j}"]`);
        if (sInp) {
          sInp.value = sib.grams;
          sInp.parentElement.querySelector(".vp-detail").textContent = vpDetail(sib);
        }
      });
    }
    refreshDishTotals();
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
    // gli ingredienti di un piatto scomposto restano riconoscibili nel diario
    const name = it.dish && it.dish !== it.food.name ? `${it.dish} · ${it.food.name}` : it.food.name;
    addEntry({ meal: it.meal, name, grams: it.grams, per100: it.food.per100 });
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

/** Correzione del fattore attività in base al racconto della giornata (modalità calcolo) */
function dayLifeAdjust(text) {
  if (!text) return { delta: 0, notes: [] };
  const t = text.toLowerCase();
  let delta = 0;
  const notes = [];
  if (/uffici|scrivania|seduto|seduta|smart working|al computer|sedentari/.test(t)) {
    delta -= 0.05;
    notes.push("lavoro sedentario");
  }
  if (/in piedi|camerier|commess|murator|cantier|magazzin|fattorin|rider|agricol|infermier|cuoc|barist/.test(t)) {
    delta += 0.1;
    notes.push("lavoro attivo, in piedi");
  }
  const steps = t.match(/(\d{1,2}[.\s]?\d{3}|\d{3,5})\s*passi/);
  if (steps) {
    const n = Number(steps[1].replace(/[.\s]/g, ""));
    if (n >= 10000) { delta += 0.1; notes.push(`~${n} passi al giorno (tanti)`); }
    else if (n >= 7000) { delta += 0.05; notes.push(`~${n} passi al giorno`); }
    else if (n < 4000) { delta -= 0.03; notes.push(`~${n} passi al giorno (pochi)`); }
  } else if (/cammin|a piedi|passeggiat/.test(t)) {
    delta += 0.04;
    notes.push("cammina regolarmente");
  }
  if (/bici per andare|in bici al lavoro|vado in bici/.test(t)) {
    delta += 0.04;
    notes.push("si sposta in bici");
  }
  return { delta: Math.max(-0.1, Math.min(0.25, delta)), notes };
}

/** Calorie e macro consigliati per obiettivo e allenamento (riposo + allenamento) */
function coachTargets(input, cons = null) {
  const { sex, age, weight, height, bf, goal, type, sessions, minutes } = input;
  // Katch-McArdle se conosce la massa grassa, altrimenti Mifflin-St Jeor
  const bmr = bf
    ? 370 + 21.6 * weight * (1 - bf / 100)
    : 10 * weight + 6.25 * height - 5 * age + (sex === "m" ? 5 : -161);
  const factor = coachActivityFactor(type, sessions, minutes) + dayLifeAdjust(input.dayLife).delta;
  const tdee = bmr * Math.max(1.15, Math.min(1.95, factor));

  const kcalMult = { cut: 0.80, maintain: 1.0, bulk: 1.10, recomp: 0.93 }[goal];
  let kcal = Math.round(tdee * kcalMult / 10) * 10;

  // Ancore reali dalle note (calorie già usate con un professionista):
  // contano più del TDEE teorico, che resta solo come confronto.
  let anchored = false;
  if (cons) {
    const mid = cons.kcalMaintain ||
      (cons.kcalCut && cons.kcalBulk
        ? Math.round((cons.kcalCut + cons.kcalBulk) / 2 / 10) * 10
        : null);
    const base = mid ||
      (cons.kcalCut ? Math.round(cons.kcalCut / 0.85 / 10) * 10 : null) ||
      (cons.kcalBulk ? Math.round(cons.kcalBulk / 1.08 / 10) * 10 : null);
    if (base) {
      if (goal === "cut" && cons.kcalCut) kcal = cons.kcalCut;
      else if (goal === "bulk" && cons.kcalBulk) kcal = cons.kcalBulk;
      else kcal = Math.round(base * { cut: 0.85, maintain: 1.0, bulk: 1.08, recomp: 0.95 }[goal] / 10) * 10;
      anchored = true;
    }
  }

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
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), rest, train, anchored };
}

/* Analisi locale dei gruppi muscolari dal testo dell'allenamento */
const MUSCLE_MAP = {
  petto: /panca|chest|croci|spinte|push.?up|piegament|pettoral|petto|dip/,
  schiena: /trazion|pull.?up|chin.?up|rematore|lat machine|pulley|stacc|dorsal|schiena|row/,
  spalle: /military|lento avanti|alzate|arnold|spalle|shoulder|overhead|ohp/,
  gambe: /squat|affond|leg press|pressa|leg extension|leg curl|stacc|hip thrust|polpacc|gambe|corsa|bici|spinning|scatti/,
  bicipiti: /curl|bicipit|trazion|chin.?up/,
  tricipiti: /french press|pushdown|tricipit|dip|panca stretta/,
  core: /plank|crunch|addominal|core|sit.?up|russian twist|hollow/,
};
const MUSCLE_SUGGEST = {
  petto: "panca o piegamenti",
  schiena: "trazioni o rematore",
  spalle: "lento avanti o alzate laterali",
  gambe: "squat o affondi",
  bicipiti: "curl",
  tricipiti: "dip o pushdown",
  core: "plank",
};

function muscleAnalysis(text) {
  const t = (text || "").toLowerCase();
  const covered = [], missing = [];
  for (const [group, re] of Object.entries(MUSCLE_MAP)) {
    (re.test(t) ? covered : missing).push(group);
  }
  return { covered, missing };
}

function muscleSectionHtml(covered, missing, advice) {
  if (!covered.length && !missing.length) return "";
  const chips = [
    ...covered.map((m) => `<span class="muscle-chip covered">✅ ${m}</span>`),
    ...missing.map((m) => `<span class="muscle-chip missing">➕ ${m}</span>`),
  ].join("");
  return `
    <p class="gsection">💪 Muscoli coinvolti dal tuo allenamento</p>
    <div class="muscle-chips">${chips}</div>
    ${advice ? `<p class="hint">${advice}</p>` : ""}`;
}

/** Elenco di verifiche ok/warn/bad sul piano attuale rispetto al consigliato */
function coachChecks(input, targets) {
  const { weight, goal, type, sessions } = input;
  const checks = [];
  const add = (level, text) => checks.push({ level, text });
  const g = input.mode === "calc" ? null : state.goals;

  // Obiettivo calorico attuale vs consigliato (solo in modalità check-up)
  if (input.mode === "calc") {
    const adj = dayLifeAdjust(input.dayLife);
    add("ok", adj.notes.length
      ? `Ho calcolato i macro dai tuoi dati tenendo conto della tua giornata: ${adj.notes.join(", ")}.`
      : "Ho calcolato i macro dai tuoi dati e dal tuo allenamento: trovi tutto nella tabella qui sotto.");
  } else if (!g) {
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
  const planKcal = input.mode === "calc" ? targets.rest.kcal : state.goals?.kcal;
  if (input.targetW && planKcal) {
    const deltaKg = input.targetW - weight;
    const dailyGap = planKcal - targets.tdee; // + surplus, − deficit
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
  if (state.goals && input.mode !== "calc") {
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

/* --- Coach IA: analisi completa con Claude (testo libero + foto) --- */

const AI_COACH_SYSTEM = `Sei un coach italiano esperto di nutrizione sportiva e allenamento.
Ricevi i dati di una persona (misure, obiettivo, allenamento, testi liberi e a volte file
allegati: report di plicometria e/o la dieta che segue) e rispondi con un'analisi onesta,
concreta e incoraggiante, dando del tu.
REGOLA FONDAMENTALE: per OGNI informazione extra fornita (giornata tipo, allenamento nel
dettaglio, note, ogni file allegato) inserisci in "analisi" almeno un punto che la richiami
esplicitamente, citando le parole o i numeri della persona, e spiega come ne hai tenuto
conto nei macro o nei consigli. Nessun dato fornito deve restare senza commento. Se nelle
note ci sono indicazioni di un professionista (es. "la nutrizionista ha detto di non
scendere sotto X kcal"), rispettale nei macro e dillo.
ANCORE REALI: se la persona riferisce calorie già prescritte o vissute sul proprio corpo
(es. "in cut stavo a 1900, in bulk a 2300"), quei numeri valgono PIÙ di qualsiasi formula:
il suo mantenimento reale sta circa a metà tra cut e bulk noti (nell'esempio ≈2100), il cut
va vicino al valore di cut noto e il bulk vicino al valore di bulk noto. NON proporre
calorie lontane da queste ancore solo perché il TDEE teorico dice altro: le formule servono
solo quando mancano dati reali. Se il tuo calcolo teorico si discosta molto dalle ancore,
fidati delle ancore, usa il TDEE solo come confronto e spiega la scelta nell'analisi.
- "verdetto": 2-3 frasi di sintesi: se la strada scelta è quella giusta per l'obiettivo e la
  cosa più importante da sistemare per prima.
- "analisi": 4-8 punti con livello ok/warn/bad su calorie, proteine, allenamento, recupero e
  sui dati extra. Se c'è un report di plicometria, leggi i valori e commenta la composizione
  corporea (usala anche per stimare il metabolismo).
- "dieta_letta"/"dieta_attuale": se è allegata la dieta attuale, leggila, stima i macro
  giornalieri medi che quella dieta fornisce (dieta_letta=true) e usali come base di
  partenza nell'analisi; altrimenti dieta_letta=false e valori a 0.
- "macro_riposo" e "macro_allenamento": calorie e macro giornalieri consigliati per
  l'obiettivo (kcal, proteine/carboidrati/grassi in grammi). Se non serve distinguere i
  giorni di allenamento, metti usa_macro_allenamento=false e ripeti gli stessi valori.
- "muscoli_coperti" / "muscoli_da_aggiungere": dai dettagli dell'allenamento, i gruppi
  muscolari già allenati e quelli scoperti (nomi brevi in italiano: petto, schiena, spalle,
  gambe, bicipiti, tricipiti, core); "consiglio_allenamento": come completare la settimana
  con esercizi concreti. Senza dettagli sull'allenamento lascia le liste vuote.
- "consigli": 3-5 consigli pratici che collegano nutrizione e allenamento per QUESTA persona.
Non fare diagnosi mediche; situazioni delicate (infortuni, sonno scarso, deficit estremi)
segnalale come warn o bad.`;

const AI_COACH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdetto", "analisi", "macro_riposo", "macro_allenamento", "usa_macro_allenamento",
    "dieta_letta", "dieta_attuale",
    "muscoli_coperti", "muscoli_da_aggiungere", "consiglio_allenamento", "consigli"],
  properties: {
    verdetto: { type: "string" },
    analisi: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["livello", "testo"],
        properties: {
          livello: { type: "string", enum: ["ok", "warn", "bad"] },
          testo: { type: "string" },
        },
      },
    },
    macro_riposo: {
      type: "object",
      additionalProperties: false,
      required: ["kcal", "proteine", "carboidrati", "grassi"],
      properties: {
        kcal: { type: "number" }, proteine: { type: "number" },
        carboidrati: { type: "number" }, grassi: { type: "number" },
      },
    },
    macro_allenamento: {
      type: "object",
      additionalProperties: false,
      required: ["kcal", "proteine", "carboidrati", "grassi"],
      properties: {
        kcal: { type: "number" }, proteine: { type: "number" },
        carboidrati: { type: "number" }, grassi: { type: "number" },
      },
    },
    usa_macro_allenamento: { type: "boolean" },
    dieta_letta: { type: "boolean" },
    dieta_attuale: {
      type: "object",
      additionalProperties: false,
      required: ["kcal", "proteine", "carboidrati", "grassi"],
      properties: {
        kcal: { type: "number" }, proteine: { type: "number" },
        carboidrati: { type: "number" }, grassi: { type: "number" },
      },
    },
    muscoli_coperti: { type: "array", items: { type: "string" } },
    muscoli_da_aggiungere: { type: "array", items: { type: "string" } },
    consiglio_allenamento: { type: "string" },
    consigli: { type: "array", items: { type: "string" } },
  },
};

const GOAL_LABEL = {
  cut: "perdere grasso", maintain: "mantenersi",
  bulk: "mettere massa muscolare", recomp: "ricomposizione (perdere grasso tenendo il muscolo)",
};

function coachPromptText(input) {
  const lines = [
    input.mode === "calc"
      ? "MODALITÀ: calcola tu i macro giusti per il mio obiettivo in base a come vivo e mi alleno."
      : "MODALITÀ: rivedi il mio piano attuale e dimmi se è la strada giusta per il mio obiettivo.",
    `Dati: ${input.sex === "m" ? "uomo" : "donna"}, ${input.age} anni, ${input.weight} kg, ${input.height} cm` +
      (input.bf ? `, massa grassa ${input.bf}%` : ""),
    `Obiettivo: ${GOAL_LABEL[input.goal]}` + (input.targetW ? ` — peso obiettivo ${input.targetW} kg` : ""),
    `Allenamento: ${TRAIN_LABEL[input.type]}, ${input.sessions} sedute/settimana da ~${input.minutes} minuti`,
  ];
  if (input.dayLife) lines.push(`La mia giornata tipo: «${input.dayLife}»`);
  if (input.training) lines.push(`Il mio allenamento nel dettaglio: «${input.training}»`);
  if (input.notes) lines.push(`Altre note: «${input.notes}»`);
  if (input.mode !== "calc" && state.goals) {
    lines.push(`Macro attuali impostati nell'app — riposo: ${state.goals.kcal} kcal, P ${state.goals.p} g, C ${state.goals.c} g, G ${state.goals.f} g` +
      (state.trainingGoals ? `; giorni di allenamento: ${state.trainingGoals.kcal} kcal, P ${state.trainingGoals.p} g, C ${state.trainingGoals.c} g, G ${state.trainingGoals.f} g` : ""));
  }
  const adh = diaryAverages(7);
  if (adh.days >= 3) {
    lines.push(`Dal diario (ultimi 7 giorni, ${adh.days} registrati): media ${Math.round(adh.kcal)} kcal e ${Math.round(adh.p)} g di proteine al giorno`);
  }
  return lines.join("\n");
}

async function aiCoachAnalyze(input, files) {
  const blocks = [];
  let extra = "";
  const attach = (file, label) => {
    if (!file) return;
    if (file.kind === "image" || file.kind === "pdf") {
      blocks.push({ type: file.kind, media_type: file.media_type, data: file.data });
      extra += `\nIn allegato (${file.kind === "pdf" ? "PDF" : "immagine"}) ${label}: «${file.name}».`;
    } else if (file.kind === "text") {
      extra += `\n--- ${label} («${file.name}») ---\n${file.text}\n---`;
    }
  };
  attach(files.pliche, "il report della mia plicometria/misure");
  attach(files.diet, "la dieta che seguo attualmente");
  blocks.push({ type: "text", text: coachPromptText(input) + extra });

  return aiComplete({
    system: AI_COACH_SYSTEM,
    schema: AI_COACH_SCHEMA,
    maxTokens: 4000,
    effort: "high",
    blocks,
  });
}

let coachTargetsCache = null;
let coachMode = "check";

function setCoachMode(mode) {
  coachMode = mode;
  $$("#coachModes .coach-mode").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode));
  $("#coachCalcOnly").classList.toggle("hidden", mode !== "calc");
  $("#coachRun").textContent = mode === "calc" ? "🧮 Calcola i miei macro" : "🔍 Analizza il mio piano";
}

function readCoachInput() {
  return {
    mode: coachMode,
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
    dayLife: $("#cDayLife").value.trim(),
    training: $("#cTraining").value.trim(),
    notes: $("#cNotes").value.trim(),
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
  $("#cDayLife").value = c.dayLife || "";
  $("#cTraining").value = c.training || "";
  $("#cNotes").value = c.notes || "";
  $("#cPlicheFile").value = "";
  $("#cDietFile").value = "";
  setCoachMode(c.mode || "check");
  $("#coachResults").innerHTML = "";
  openModal("coachModal");
}

/** Legge un file allegato al coach: foto (ridimensionata), PDF (base64) o testo */
function readCoachFile(sel) {
  const file = $(sel).files[0];
  if (!file) return Promise.resolve(null);

  if (file.type.startsWith("image/")) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        try {
          resolve({ kind: "image", name: file.name, media_type: "image/jpeg",
            data: canvas.toDataURL("image/jpeg", 0.82).split(",")[1] });
        } catch { resolve(null); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  if (file.type === "application/pdf") {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve({ kind: "pdf", name: file.name,
        media_type: "application/pdf", data: String(r.result).split(",")[1] });
      r.onerror = () => resolve(null);
      r.readAsDataURL(file);
    });
  }

  // Qualsiasi altro formato lo trattiamo come testo
  return file.text()
    .then((text) => ({ kind: "text", name: file.name, text: text.slice(0, 8000) }))
    .catch(() => null);
}

/* --- Lettura locale dei dati extra: note e file devono incidere sui calcoli --- */

/** Estrae vincoli e segnali dalle note libere (sonno, infortuni, soglia kcal,
 *  esclusioni, pasti sgarro, fase indicata dal professionista) */
function parseCoachNotes(text) {
  const out = { sleep: null, injury: null, kcalFloor: null, exclusions: [],
    cheats: null, phase: null, cutMacros: false,
    kcalCut: null, kcalBulk: null, kcalMaintain: null };
  if (!text) return out;
  const t = text.toLowerCase();

  // Ancore reali: calorie già prescritte/osservate ("in cut stavo a 1900,
  // in bulk a 2300"). Valgono più di qualsiasi formula teorica.
  const anchor = (re) => {
    const m = t.match(re);
    const n = m ? Number(m[1]) : null;
    return n && n >= 1000 && n <= 5000 ? n : null;
  };
  out.kcalCut = anchor(/(?:cut|definizione|deficit)[^\d]{0,30}(\d{4})\s*(?:kcal|calorie)?/);
  out.kcalBulk = anchor(/(?:bulk|massa)[^\d]{0,30}(\d{4})\s*(?:kcal|calorie)?/);
  out.kcalMaintain = anchor(/(?:mantenim\w+|manten\w+)[^\d]{0,30}(\d{4})\s*(?:kcal|calorie)?/);

  // Pasti sgarro/liberi: "2/3 pasti sgarri", "2-3 sgarri", "un pasto libero"
  const gm = t.match(/(\d)\s*[\/\-–]\s*(\d)\s*(?:pasti\s+)?(?:sgarr\w+|liber\w+)/) ||
             t.match(/(\d)\s*(?:pasti\s+)?(?:sgarr\w+|pasti\s+liber\w+)/) ||
             (/un pasto (?:sgarro|libero)|uno sgarro/.test(t) ? [null, "1"] : null);
  if (gm) out.cheats = Number(gm[2] || gm[1]);
  else if (/sgarr|pasto libero|pasti liberi/.test(t)) out.cheats = 1;

  // Fase indicata (es. dalla nutrizionista): mantenimento / cut / bulk
  if (/mantenim|manten[ae]rmi|di mantenermi|solo mantenere/.test(t)) out.phase = "maintain";
  else if (/(?:ora|adesso|fase di|sono in)\s+(?:cut|definizione)/.test(t)) out.phase = "cut";
  else if (/(?:ora|adesso|fase di|sono in)\s+(?:bulk|massa)/.test(t)) out.phase = "bulk";

  // "mi ha lasciato i macro del cut" e simili
  if (/macro\s+(?:del|da|di)\s+cut|lasciat\w+\s+i\s+macro|stessi\s+macro/.test(t)) out.cutMacros = true;
  const sm = t.match(/dorm\w*[^\d]{0,12}(\d{1,2})(?:[-–](\d{1,2}))?\s*or[ae]/);
  if (sm) out.sleep = Number(sm[1]);
  const fm = t.match(/non\s+(?:scendere|andare)\s+sotto\s+(?:le|i|a)?\s*(\d{3,4})/) ||
             t.match(/(?:almeno|minimo)\s+(\d{3,4})\s*(?:kcal|calorie)/);
  if (fm) out.kcalFloor = Number(fm[1]);
  const im = t.match(/[\wàèéìòù]+\s+infortunat\w+/) ||
             t.match(/infortun\w+\s+(?:al|alla|ai|alle)?\s*[\wàèéìòù]*/) ||
             t.match(/(?:dolore|male|tendinite|ernia)\s+(?:al|alla|ai|alle)\s+[\wàèéìòù]+/);
  if (im) out.injury = im[0].trim();
  const em = t.match(/non\s+mangio\s+(?:la |il |le |i |lo |l')?([\wàèéìòù]+(?:\s+[\wàèéìòù]+)?)/);
  if (em) out.exclusions.push(em[1].trim());
  if (/vegetarian/.test(t)) out.exclusions.push("carne e pesce (vegetariano)");
  else if (/vegan/.test(t)) out.exclusions.push("prodotti animali (vegano)");
  return out;
}

/** Cerca la massa grassa in un report di plicometria in formato testo */
function parsePlicheText(text) {
  const t = (text || "").toLowerCase();
  const m = t.match(/(?:massa grassa|grasso corporeo|body ?fat|bf)\D{0,15}?(\d{1,2}(?:[.,]\d)?)\s*%/) ||
            t.match(/(\d{1,2}(?:[.,]\d)?)\s*%\s*(?:di\s+)?(?:massa grassa|grasso|body ?fat|bf)/);
  return m ? Number(m[1].replace(",", ".")) : null;
}

/** Cerca i totali giornalieri (kcal e macro) in una dieta in formato testo */
function parseDietText(text) {
  const t = (text || "").toLowerCase();
  const num = (re) => { const m = t.match(re); return m ? Number(m[1].replace(",", ".")) : null; };
  return {
    kcal: num(/(\d{3,4})\s*(?:kcal|calorie)/),
    p: num(/prot\w*\D{0,12}?(\d{2,3})(?:[.,]\d)?\s*g/),
    c: num(/carbo\w*\D{0,12}?(\d{2,3})(?:[.,]\d)?\s*g/),
    f: num(/(?:grassi|lipidi)\D{0,12}?(\d{2,3})(?:[.,]\d)?\s*g/),
  };
}

/** Impronta compatta di una stringa (anche molto lunga, es. file in base64) */
function hash32(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36) + ":" + str.length;
}

async function runCoach() {
  const input = readCoachInput();
  state.coach = { ...input };
  saveState();

  const btn = $("#coachRun");
  btn.disabled = true;
  btn.textContent = state.apiKey ? "🤖 Il coach sta analizzando…" : "📖 Sto leggendo i tuoi dati…";
  $("#coachResults").innerHTML = `<p class="hint">${state.apiKey ? "🤖 Analisi IA in corso…" : "📖 Analisi in corso…"}</p>`;
  try {
    const files = {
      pliche: await readCoachFile("#cPlicheFile"),
      diet: await readCoachFile("#cDietFile"),
    };
    if (state.apiKey) {
      try {
        // Stessi input → stesso risultato: se non è cambiato nulla dall'ultima
        // analisi IA, riusa quella invece di rifare la stima (che potrebbe
        // variare leggermente) e di consumare quota.
        const cacheKey = hash32(JSON.stringify([input, files, AI_COACH_SYSTEM]));
        const cached = state.coachAiCache;
        const ai = cached && cached.key === cacheKey
          ? cached.ai
          : await aiCoachAnalyze(input, files);
        state.coachAiCache = { key: cacheKey, ai };
        saveState();
        renderCoachResults(input, aiCoachToView(input, ai, files));
        return;
      } catch (e) {
        toast("IA non disponibile (" + e.message + "): uso l'analisi locale");
      }
    }
    renderCoachResults(input, localCoachView(input, files));
  } finally {
    btn.disabled = false;
    setCoachMode(input.mode);
  }
}

/** Analisi locale: formule + euristiche (nessuna chiave API necessaria) */
function localCoachView(input, files) {
  files = files || {};
  const extras = [];
  const needAi = [];

  // Plicometria da file: se è testo provo a leggere la massa grassa e la uso nei calcoli
  if (files.pliche) {
    const bfFile = files.pliche.kind === "text" ? parsePlicheText(files.pliche.text) : null;
    if (bfFile && !input.bf) {
      input = { ...input, bf: bfFile };
      extras.push({ level: "ok", text: `📎 Dal file della plicometria («${files.pliche.name}») ho letto massa grassa ≈ <strong>${bfFile}%</strong>: l'ho usata per calcolare il tuo metabolismo con la formula più precisa (Katch-McArdle).` });
    } else if (bfFile) {
      extras.push({ level: "ok", text: `📎 Nel file della plicometria («${files.pliche.name}») trovo massa grassa ≈ ${bfFile}%: nei calcoli uso il ${input.bf}% che hai indicato tu nel campo apposito.` });
    } else {
      needAi.push(`il file della plicometria («${files.pliche.name}»)`);
    }
  }

  // Vincoli e segnali dalle note libere
  const cons = parseCoachNotes(input.notes);
  const targets = coachTargets(input, cons);

  if (targets.anchored) {
    const nums = [
      cons.kcalCut ? `cut ${cons.kcalCut} kcal` : "",
      cons.kcalBulk ? `bulk ${cons.kcalBulk} kcal` : "",
      cons.kcalMaintain ? `mantenimento ${cons.kcalMaintain} kcal` : "",
    ].filter(Boolean).join(", ");
    extras.push({ level: "ok", text: `📎 Nelle note riporti calorie già usate nel tuo percorso (${nums}): sono <strong>dati reali sul tuo corpo</strong> e valgono più di qualsiasi formula, quindi ho ancorato i macro consigliati a quei numeri e non al calcolo teorico.` });
  }

  if (cons.kcalFloor) {
    if (targets.rest.kcal < cons.kcalFloor) {
      const addK = cons.kcalFloor - targets.rest.kcal;
      targets.rest.kcal = cons.kcalFloor;
      targets.rest.c += Math.round(addK / 4);
      if (targets.train && targets.train.kcal < cons.kcalFloor) {
        targets.train.c += Math.round((cons.kcalFloor - targets.train.kcal) / 4);
        targets.train.kcal = cons.kcalFloor;
      }
      extras.push({ level: "ok", text: `📎 Nelle note scrivi di <strong>non scendere sotto le ${cons.kcalFloor} kcal</strong>: il mio calcolo dava meno, quindi ho alzato i macro consigliati a quella soglia (rispetta l'indicazione che hai ricevuto).` });
    } else {
      extras.push({ level: "ok", text: `📎 Ho letto la soglia minima di ${cons.kcalFloor} kcal indicata nelle note: i macro consigliati (${targets.rest.kcal} kcal) la rispettano già.` });
    }
  }
  if (cons.sleep !== null) {
    extras.push(cons.sleep < 7
      ? { level: "warn", text: `📎 Scrivi che dormi ${cons.sleep} ore: è poco. Il recupero (muscolo e fame) passa dal sonno — puntare a 7–9 ore vale quanto sistemare i macro.` }
      : { level: "ok", text: `📎 Dormi ${cons.sleep} ore: recupero a posto, ottima base per l'obiettivo.` });
  }
  if (cons.injury) {
    extras.push({ level: "warn", text: `📎 Ho letto «${cons.injury}»: adatta gli esercizi per non caricare la zona e, se il dolore persiste, fatti seguire da un professionista. Nel frattempo allena il resto del corpo normalmente.` });
  }
  if (cons.exclusions.length) {
    extras.push({ level: "ok", text: `📎 Non mangi ${cons.exclusions.join(", ")}: nessun problema per i macro, copri le proteine con le alternative (uova, latticini, legumi, carne o pesce a seconda di cosa mangi).` });
  }

  // Fase indicata dal professionista vs obiettivo selezionato
  if (cons.phase && cons.phase !== input.goal && !(cons.phase === "maintain" && input.goal === "recomp")) {
    extras.push({ level: "warn", text: `📎 Nelle note racconti che ora la tua fase è «${GOAL_LABEL[cons.phase]}», ma qui sopra hai selezionato l'obiettivo «${GOAL_LABEL[input.goal]}»: l'analisi segue quello selezionato. Se la fase attuale è un'altra, cambia obiettivo e rilancia.` });
  } else if (cons.phase) {
    extras.push({ level: "ok", text: `📎 Ho letto che la tua fase attuale è «${GOAL_LABEL[cons.phase]}», coerente con l'obiettivo selezionato: analizzo su questa base.` });
  }

  // Pasti sgarro/liberi a settimana
  if (cons.cheats) {
    const lo = Math.round(cons.cheats * 400 / 7 / 10) * 10;
    const hi = Math.round(cons.cheats * 800 / 7 / 10) * 10;
    let text = `📎 Ho letto dei <strong>${cons.cheats} past${cons.cheats === 1 ? "o" : "i"} sgarro a settimana</strong>: in media valgono +400–800 kcal l'uno, cioè circa <strong>+${lo}–${hi} kcal/giorno</strong> sulla media settimanale. `;
    if (cons.cutMacros && (cons.phase === "maintain" || input.goal === "maintain")) {
      text += "Tenere i macro del cut nei giorni normali e aggiungere gli sgarri è una strategia sensata: gli sgarri colmano il deficit e di fatto ti tengono in mantenimento flessibile. Controlla il peso 1–2 volte a settimana: se scende ancora, aggiungi qualcosa nei giorni normali; se sale, togli uno sgarro.";
    } else if (input.goal === "cut") {
      text += `Occhio: con l'obiettivo «${GOAL_LABEL.cut}» quegli sgarri possono mangiarsi buona parte del deficit — tienili contenuti o riduci a 1.`;
    } else {
      text += "Con il tuo obiettivo ci stanno: l'importante è che la media settimanale resti vicina ai macro consigliati.";
    }
    extras.push({ level: input.goal === "cut" && cons.cheats > 1 ? "warn" : "ok", text });
  }

  if (input.notes && !cons.kcalFloor && cons.sleep === null && !cons.injury &&
      !cons.exclusions.length && !cons.cheats && !cons.phase) {
    needAi.push("le tue note");
  }

  // Dieta attuale da file (modalità calcolo): la uso come base di partenza
  let baseline = null;
  if (files.diet) {
    const d = files.diet.kind === "text" ? parseDietText(files.diet.text) : null;
    if (d && d.kcal) {
      baseline = { kcal: d.kcal, p: d.p, c: d.c, f: d.f };
      const diff = targets.rest.kcal - d.kcal;
      extras.push({
        level: Math.abs(diff) <= 150 ? "ok" : "warn",
        text: `📎 Dalla dieta che mi hai mandato («${files.diet.name}») leggo circa <strong>${d.kcal} kcal</strong>${d.p ? `, ${d.p} g di proteine` : ""}: ` +
          (Math.abs(diff) <= 150
            ? "sei già molto vicino ai macro consigliati, ti basta ritoccare poco."
            : diff > 0
              ? `per il tuo obiettivo servono circa ${diff} kcal in più al giorno rispetto a quella base.`
              : `per il tuo obiettivo servono circa ${-diff} kcal in meno al giorno rispetto a quella base.`),
      });
    } else {
      needAi.push(`il file della dieta («${files.diet.name}»)`);
    }
  }

  if (needAi.length) {
    extras.push({ level: "warn", text: `Per capire ${needAi.join(" e ")} fino in fondo (foto/PDF o racconti articolati) serve la modalità IA 🤖 — si attiva <strong>gratis</strong> con una chiave Google Gemini da aistudio.google.com/apikey (la trovi nella dettatura vocale 🎤). Poi rilancia l'analisi e commento ogni cosa che hai scritto.` });
  }

  const checks = [...extras, ...coachChecks(input, targets)];
  const tips = coachLinkTips(input);

  let muscles = null;
  if (input.training) {
    const m = muscleAnalysis(input.training);
    if (m.covered.length) {
      const advice = m.missing.length
        ? "Per una settimana completa aggiungi lavoro per: " +
          m.missing.map((g) => `<strong>${g}</strong> (${MUSCLE_SUGGEST[g]})`).join(", ") + "."
        : "Copri tutti i principali gruppi muscolari: ottima struttura 💪";
      muscles = { covered: m.covered, missing: m.missing, advice };
    }
  }

  return {
    badge: null,
    intro: `Mantenimento stimato: <strong>${targets.tdee} kcal/giorno</strong> (metabolismo base ${targets.bmr} kcal).`,
    verdict: null,
    checks,
    rest: targets.rest,
    train: targets.train,
    baseline,
    muscles,
    tips,
    footer: "Stime indicative basate su formule standard (Mifflin-St Jeor / Katch-McArdle): non sostituiscono medico o nutrizionista.",
  };
}

/** Converte la risposta dell'IA nella stessa struttura usata dal render */
function aiCoachToView(input, ai, files) {
  const toMacro = (m) => ({
    kcal: Math.round(m.kcal), p: Math.round(m.proteine),
    c: Math.round(m.carboidrati), f: Math.round(m.grassi),
  });
  const rest = toMacro(ai.macro_riposo);
  const train = ai.usa_macro_allenamento ? toMacro(ai.macro_allenamento) : null;
  let muscles = null;
  if (ai.muscoli_coperti.length || ai.muscoli_da_aggiungere.length) {
    muscles = {
      covered: ai.muscoli_coperti,
      missing: ai.muscoli_da_aggiungere,
      advice: ai.consiglio_allenamento || "",
    };
  }
  const nFiles = [files?.pliche, files?.diet].filter(Boolean).length;
  return {
    badge: "🤖 Analisi IA personalizzata" + (nFiles ? ` (${nFiles === 1 ? "file letto" : "file letti"})` : ""),
    intro: null,
    verdict: ai.verdetto,
    checks: ai.analisi.map((a) => ({ level: a.livello, text: a.testo })),
    rest,
    train,
    baseline: ai.dieta_letta ? toMacro(ai.dieta_attuale) : null,
    muscles,
    tips: ai.consigli,
    footer: "Analisi generata dall'IA sui dati che hai fornito: non sostituisce medico o nutrizionista.",
  };
}

function renderCoachResults(input, view) {
  coachTargetsCache = { rest: view.rest, train: view.train };
  const LEVEL = { ok: "✅", warn: "⚠️", bad: "❌" };
  const trainRow = view.train ? `
      <tr><td>🏋️ Allenamento</td><td>${view.train.kcal}</td><td>${view.train.p}</td><td>${view.train.c}</td><td>${view.train.f}</td></tr>` : "";

  const nn = (v) => (v || v === 0 ? v : "—");
  const baselineRow = view.baseline ? `
      <tr><td>📄 La tua dieta oggi</td><td>${nn(view.baseline.kcal)}</td><td>${nn(view.baseline.p)}</td><td>${nn(view.baseline.c)}</td><td>${nn(view.baseline.f)}</td></tr>` : "";

  const macroTable = `
    <p class="gsection">${input.mode === "calc" ? "🧮 I tuoi macro per l'obiettivo" : "🎯 Macro consigliati"}</p>
    <div class="coach-table-wrap">
      <table class="coach-table">
        <thead><tr><th>Giorno</th><th>kcal</th><th>P (g)</th><th>C (g)</th><th>G (g)</th></tr></thead>
        <tbody>${baselineRow}
          <tr><td>${view.train ? "🛋️ Riposo" : "Ogni giorno"}</td><td>${view.rest.kcal}</td><td>${view.rest.p}</td><td>${view.rest.c}</td><td>${view.rest.f}</td></tr>${trainRow}
        </tbody>
      </table>
    </div>
    <button class="btn primary full" id="coachApply">Applica questi obiettivi</button>`;

  const verdictBlock = `
    <p class="gsection">📋 Verdetto</p>
    ${view.badge ? `<span class="coach-ai-badge">${view.badge}</span>` : ""}
    ${view.verdict ? `<p class="coach-tip"><strong>${view.verdict}</strong></p>` : ""}
    ${view.intro ? `<p class="hint">${view.intro}</p>` : ""}
    <div class="coach-checks">
      ${view.checks.map((ch) => `
        <div class="coach-check coach-${LEVEL[ch.level] ? ch.level : "warn"}">
          <span>${LEVEL[ch.level] || "⚠️"}</span>
          <span>${ch.text}</span>
        </div>`).join("")}
    </div>`;

  const muscleBlock = view.muscles
    ? muscleSectionHtml(view.muscles.covered, view.muscles.missing, view.muscles.advice)
    : "";

  // In modalità calcolo i macro sono la risposta: vanno per primi
  const main = input.mode === "calc"
    ? macroTable + verdictBlock
    : verdictBlock + macroTable;

  $("#coachResults").innerHTML = `
    ${main}
    ${muscleBlock}
    <p class="gsection">🔗 Nutrizione ↔ allenamento</p>
    <div class="coach-tips">${view.tips.map((t) => `<p class="coach-tip">${t}</p>`).join("")}</div>
    <p class="hint">${view.footer}</p>`;

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

/* ---------- Zona allenamento ---------- */

const WORKOUT_TYPES = {
  pesi: { label: "Pesi / palestra", emoji: "🏋️", met: 5 },
  calisthenics: { label: "Calisthenics", emoji: "🤸", met: 6 },
  cardio: { label: "Cardio", emoji: "🏃", met: 8 },
  misto: { label: "Misto pesi + cardio", emoji: "🔀", met: 6.5 },
  sport: { label: "Sport", emoji: "⚽", met: 7 },
};

let editingWorkoutId = null;

function dayWorkouts(key = viewDate) {
  return state.workouts[key] || [];
}

/** Stima kcal bruciate: MET del tipo di attività × peso × ore */
function workoutKcal(w) {
  const met = (WORKOUT_TYPES[w.type] || WORKOUT_TYPES.pesi).met;
  const kg = (state.profile && state.profile.weight) || 75;
  return Math.round(met * kg * (w.minutes / 60));
}

function workoutMuscleText(w) {
  return [(w.exercises || []).map((e) => e.name).join(" "), w.note || ""].join(" ");
}

function renderTraining() {
  const list = dayWorkouts();
  const rows = list.length
    ? list.map((w) => {
        const t = WORKOUT_TYPES[w.type] || WORKOUT_TYPES.pesi;
        const ex = (w.exercises || []).map((e) => {
          const detail = [
            e.sets && e.reps ? `${e.sets}×${e.reps}` : e.sets ? `${e.sets} serie` : "",
            e.kg ? `${e.kg} kg` : "",
          ].filter(Boolean).join(" · ");
          return `<div class="wk-ex"><span>${esc(e.name)}</span><span class="wk-ex-detail">${detail}</span></div>`;
        }).join("");
        return `
          <div class="wk-row" data-workout="${w.id}" title="Tocca per modificare">
            <div class="wk-head">
              <span class="wk-emoji">${t.emoji}</span>
              <span class="wk-title">${t.label}</span>
              <span class="wk-kcal">${w.minutes} min · ≈${workoutKcal(w)} kcal</span>
            </div>
            ${ex}
            ${w.note ? `<div class="wk-note">${esc(w.note)}</div>` : ""}
          </div>`;
      }).join("")
    : `<p class="hint">Nessun allenamento ${viewDate === todayKey() ? "oggi" : "in questo giorno"} — tocca <strong>＋ Registra</strong> qui sopra per segnarlo.</p>`;

  // Recap degli ultimi 7 giorni con i gruppi muscolari coperti
  let weekCount = 0;
  const weekTexts = [];
  for (let i = 0; i < 7; i++) {
    for (const w of state.workouts[todayKey(-i)] || []) {
      weekCount++;
      weekTexts.push(workoutMuscleText(w));
    }
  }
  let weekHtml = "";
  if (weekCount) {
    weekHtml = `<p class="hint wk-week">Ultimi 7 giorni: <strong>${weekCount} allenament${weekCount === 1 ? "o" : "i"}</strong>.</p>`;
    const { covered, missing } = muscleAnalysis(weekTexts.join(" "));
    if (covered.length) {
      const advice = missing.length
        ? "Da aggiungere questa settimana: " + missing.slice(0, 3).map((m) => `${m} (${MUSCLE_SUGGEST[m]})`).join(", ")
        : "Tutti i gruppi muscolari coperti questa settimana 💪";
      weekHtml += muscleSectionHtml(covered, missing, advice);
    }
  }

  $("#trainingBody").innerHTML = rows + weekHtml;
  $$(".wk-row").forEach((r) =>
    r.addEventListener("click", () => openWorkoutModal(r.dataset.workout))
  );
}

function addExerciseRow(ex = null) {
  const div = document.createElement("div");
  div.className = "wx-row";
  div.innerHTML = `
    <input type="text" class="input wx-name" placeholder="Esercizio (es. panca piana)" value="${ex ? esc(ex.name) : ""}">
    <input type="number" class="input wx-sets" placeholder="serie" min="1" value="${ex && ex.sets ? ex.sets : ""}">
    <input type="number" class="input wx-reps" placeholder="rip." min="1" value="${ex && ex.reps ? ex.reps : ""}">
    <input type="number" class="input wx-kg" placeholder="kg" min="0" step="0.5" value="${ex && ex.kg ? ex.kg : ""}">
    <button class="vp-x wx-x" title="Rimuovi esercizio">✕</button>`;
  div.querySelector(".wx-x").addEventListener("click", () => div.remove());
  $("#wExercises").appendChild(div);
}

function openWorkoutModal(workoutId = null) {
  editingWorkoutId = workoutId;
  const w = workoutId ? dayWorkouts().find((x) => x.id === workoutId) : null;
  $("#workoutTitle").textContent = w ? "🏋️ Modifica allenamento" : "🏋️ Registra allenamento";
  $("#wType").value = w ? w.type : "pesi";
  $("#wMinutes").value = w ? w.minutes : 60;
  $("#wNote").value = (w && w.note) || "";
  $("#wDelete").classList.toggle("hidden", !w);
  $("#wExercises").innerHTML = "";
  const exercises = w && w.exercises && w.exercises.length ? w.exercises : [null];
  exercises.forEach(addExerciseRow);
  openModal("workoutModal");
}

function saveWorkout() {
  const exercises = $$("#wExercises .wx-row").map((r) => ({
    name: r.querySelector(".wx-name").value.trim(),
    sets: Number(r.querySelector(".wx-sets").value) || 0,
    reps: Number(r.querySelector(".wx-reps").value) || 0,
    kg: Number(r.querySelector(".wx-kg").value) || 0,
  })).filter((e) => e.name);
  const w = {
    id: editingWorkoutId || uid(),
    type: $("#wType").value,
    minutes: Math.min(300, Math.max(5, Number($("#wMinutes").value) || 60)),
    exercises,
    note: $("#wNote").value.trim(),
  };
  const list = dayWorkouts().filter((x) => x.id !== w.id);
  list.push(w);
  state.workouts[viewDate] = list;

  // Con i macro da allenamento impostati, il giorno passa da solo ad "allenamento"
  let msg = "Allenamento salvato 💪";
  if (state.trainingGoals && !state.trainingDays[viewDate]) {
    state.trainingDays[viewDate] = true;
    msg = "Allenamento salvato 💪 — macro del giorno passati ad allenamento 🏋️";
  }
  saveState();
  closeModal("workoutModal");
  render();
  toast(msg);
}

function deleteWorkout() {
  const list = dayWorkouts().filter((x) => x.id !== editingWorkoutId);
  if (list.length) state.workouts[viewDate] = list;
  else delete state.workouts[viewDate];
  saveState();
  closeModal("workoutModal");
  render();
  toast("Allenamento eliminato");
}

/* ---------- Wiring ---------- */

function init() {
  // Data
  $("#prevDay").addEventListener("click", () => shiftViewDate(-1));
  $("#nextDay").addEventListener("click", () => shiftViewDate(1));
  $("#dateLabel").addEventListener("click", () => { viewDate = todayKey(); staggerNextRender = true; render(); });

  // Suggerimenti
  $("#refreshSuggestions").addEventListener("click", () => {
    suggOffset += 4;
    renderSuggestions();
    fx.staggerList($$("#suggestionList .sugg-row"));
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

  // Allenamento
  $("#openWorkout").addEventListener("click", () => openWorkoutModal());
  $("#wAddEx").addEventListener("click", () => addExerciseRow());
  $("#wSave").addEventListener("click", saveWorkout);
  $("#wDelete").addEventListener("click", deleteWorkout);

  // Coach
  $("#openCoach").addEventListener("click", openCoachModal);
  $("#coachRun").addEventListener("click", runCoach);
  $$("#coachModes .coach-mode").forEach((b) =>
    b.addEventListener("click", () => setCoachMode(b.dataset.mode))
  );

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
    ["addModal", "amountModal", "voiceModal", "coachModal", "workoutModal"].forEach(closeModal);
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
  fx.fabIntro($$(".fab"));
  if (!state.goals) openGoalsModal();

  // Apertura cinematica: bagliore + nome, poi dissolvenza sull'app
  const splash = $("#splash");
  if (splash) {
    if (MOTION_OK) {
      Motion.animate($(".splash-orb"), { opacity: [0, 1], scale: [0.7, 1] },
        { duration: 0.9, ease: EASE_OUT });
      Motion.animate($(".splash-name"), { opacity: [0, 1], y: [12, 0] },
        { duration: 0.7, delay: 0.3, ease: EASE_OUT });
      Motion.animate(splash, { opacity: [1, 0] },
        { delay: 1.3, duration: 0.5, ease: "easeIn" }).finished.then(() => splash.remove());
    } else {
      splash.remove();
    }
  }
}

init();
