/**
 * Database alimenti locale — valori per 100 g (fonte: tabelle CREA/USDA, arrotondati).
 * kcal, p = proteine g, c = carboidrati g, f = grassi g
 * portion = porzione tipica in grammi
 * meals   = pasti per cui l'alimento è un suggerimento sensato
 * cat     = categoria (per emoji e filtri)
 */
const FOOD_DB = [
  // ---- Fonti proteiche magre ----
  { name: "Petto di pollo",            kcal: 100, p: 23.0, c: 0.0,  f: 1.0,  portion: 150, cat: "proteine", meals: ["pranzo", "cena"] },
  { name: "Fesa di tacchino",          kcal: 107, p: 24.0, c: 0.0,  f: 1.2,  portion: 150, cat: "proteine", meals: ["pranzo", "cena"] },
  { name: "Manzo magro",               kcal: 129, p: 21.0, c: 0.0,  f: 5.0,  portion: 150, cat: "proteine", meals: ["pranzo", "cena"] },
  { name: "Merluzzo",                  kcal: 82,  p: 17.0, c: 0.0,  f: 0.9,  portion: 180, cat: "pesce",    meals: ["pranzo", "cena"] },
  { name: "Salmone",                   kcal: 185, p: 20.0, c: 0.0,  f: 12.0, portion: 125, cat: "pesce",    meals: ["pranzo", "cena"] },
  { name: "Tonno al naturale",         kcal: 103, p: 24.0, c: 0.0,  f: 0.8,  portion: 80,  cat: "pesce",    meals: ["pranzo", "cena", "spuntino"] },
  { name: "Gamberi",                   kcal: 85,  p: 18.0, c: 0.5,  f: 1.0,  portion: 120, cat: "pesce",    meals: ["pranzo", "cena"] },
  { name: "Uova",                      kcal: 128, p: 12.5, c: 0.5,  f: 8.7,  portion: 120, cat: "uova",     meals: ["colazione", "pranzo", "cena"] },
  { name: "Albume d'uovo",             kcal: 43,  p: 10.7, c: 0.7,  f: 0.2,  portion: 150, cat: "uova",     meals: ["colazione", "cena"] },
  { name: "Bresaola",                  kcal: 151, p: 32.0, c: 0.0,  f: 2.0,  portion: 50,  cat: "salumi",   meals: ["pranzo", "cena", "spuntino"] },
  { name: "Prosciutto crudo sgrassato",kcal: 145, p: 27.0, c: 0.0,  f: 4.0,  portion: 50,  cat: "salumi",   meals: ["pranzo", "cena", "spuntino"] },
  { name: "Tofu",                      kcal: 76,  p: 8.0,  c: 2.0,  f: 4.5,  portion: 120, cat: "proteine", meals: ["pranzo", "cena"] },
  { name: "Proteine in polvere (whey)",kcal: 380, p: 80.0, c: 6.0,  f: 5.0,  portion: 30,  cat: "integr.",  meals: ["colazione", "spuntino"] },

  // ---- Latticini ----
  { name: "Yogurt greco 0%",           kcal: 57,  p: 10.0, c: 3.9,  f: 0.2,  portion: 170, cat: "latticini", meals: ["colazione", "spuntino"] },
  { name: "Yogurt greco 2%",           kcal: 73,  p: 9.5,  c: 4.0,  f: 2.0,  portion: 170, cat: "latticini", meals: ["colazione", "spuntino"] },
  { name: "Skyr",                      kcal: 63,  p: 11.0, c: 4.0,  f: 0.2,  portion: 150, cat: "latticini", meals: ["colazione", "spuntino"] },
  { name: "Fiocchi di latte",          kcal: 98,  p: 11.0, c: 3.4,  f: 4.3,  portion: 150, cat: "latticini", meals: ["pranzo", "cena", "spuntino"] },
  { name: "Ricotta vaccina",           kcal: 146, p: 11.0, c: 3.5,  f: 10.0, portion: 100, cat: "latticini", meals: ["colazione", "pranzo", "cena"] },
  { name: "Mozzarella",                kcal: 253, p: 18.7, c: 0.7,  f: 19.5, portion: 100, cat: "latticini", meals: ["pranzo", "cena"] },
  { name: "Parmigiano Reggiano",       kcal: 392, p: 33.0, c: 0.0,  f: 28.0, portion: 20,  cat: "latticini", meals: ["pranzo", "cena", "spuntino"] },
  { name: "Latte parzialmente scremato", kcal: 46, p: 3.3, c: 5.0,  f: 1.5,  portion: 200, cat: "latticini", meals: ["colazione"] },

  // ---- Legumi ----
  { name: "Ceci cotti",                kcal: 120, p: 7.0,  c: 18.0, f: 2.4,  portion: 150, cat: "legumi", meals: ["pranzo", "cena"] },
  { name: "Lenticchie cotte",          kcal: 92,  p: 6.9,  c: 16.0, f: 0.4,  portion: 150, cat: "legumi", meals: ["pranzo", "cena"] },
  { name: "Fagioli cotti",             kcal: 91,  p: 6.5,  c: 16.0, f: 0.5,  portion: 150, cat: "legumi", meals: ["pranzo", "cena"] },
  { name: "Edamame",                   kcal: 121, p: 11.0, c: 9.0,  f: 5.0,  portion: 100, cat: "legumi", meals: ["pranzo", "cena", "spuntino"] },

  // ---- Carboidrati ----
  { name: "Pasta di semola (cruda)",   kcal: 353, p: 11.0, c: 71.0, f: 1.4,  portion: 80,  cat: "cereali", meals: ["pranzo", "cena"] },
  { name: "Pasta integrale (cruda)",   kcal: 335, p: 13.0, c: 63.0, f: 2.5,  portion: 80,  cat: "cereali", meals: ["pranzo", "cena"] },
  { name: "Riso (crudo)",              kcal: 332, p: 6.7,  c: 78.0, f: 0.4,  portion: 80,  cat: "cereali", meals: ["pranzo", "cena"] },
  { name: "Riso basmati (crudo)",      kcal: 349, p: 7.5,  c: 78.0, f: 0.6,  portion: 80,  cat: "cereali", meals: ["pranzo", "cena"] },
  { name: "Quinoa (cruda)",            kcal: 368, p: 14.0, c: 64.0, f: 6.0,  portion: 70,  cat: "cereali", meals: ["pranzo", "cena"] },
  { name: "Couscous (crudo)",          kcal: 376, p: 13.0, c: 72.0, f: 1.0,  portion: 80,  cat: "cereali", meals: ["pranzo", "cena"] },
  { name: "Pane integrale",            kcal: 243, p: 8.5,  c: 44.0, f: 2.0,  portion: 60,  cat: "pane",    meals: ["colazione", "pranzo", "cena"] },
  { name: "Pane bianco",               kcal: 275, p: 8.0,  c: 55.0, f: 1.0,  portion: 60,  cat: "pane",    meals: ["colazione", "pranzo", "cena"] },
  { name: "Fiocchi d'avena",           kcal: 389, p: 13.0, c: 66.0, f: 7.0,  portion: 40,  cat: "cereali", meals: ["colazione"] },
  { name: "Gallette di riso",          kcal: 387, p: 8.0,  c: 82.0, f: 1.0,  portion: 20,  cat: "cereali", meals: ["colazione", "spuntino"] },
  { name: "Patate",                    kcal: 85,  p: 2.0,  c: 18.0, f: 0.1,  portion: 250, cat: "cereali", meals: ["pranzo", "cena"] },
  { name: "Patate dolci",              kcal: 86,  p: 1.6,  c: 20.0, f: 0.1,  portion: 250, cat: "cereali", meals: ["pranzo", "cena"] },

  // ---- Frutta ----
  { name: "Banana",                    kcal: 89,  p: 1.1,  c: 23.0, f: 0.3,  portion: 120, cat: "frutta", meals: ["colazione", "spuntino"] },
  { name: "Mela",                      kcal: 52,  p: 0.3,  c: 14.0, f: 0.2,  portion: 180, cat: "frutta", meals: ["colazione", "spuntino"] },
  { name: "Arancia",                   kcal: 47,  p: 0.9,  c: 12.0, f: 0.1,  portion: 150, cat: "frutta", meals: ["colazione", "spuntino"] },
  { name: "Pera",                      kcal: 57,  p: 0.4,  c: 15.0, f: 0.1,  portion: 160, cat: "frutta", meals: ["colazione", "spuntino"] },
  { name: "Kiwi",                      kcal: 61,  p: 1.1,  c: 15.0, f: 0.5,  portion: 100, cat: "frutta", meals: ["colazione", "spuntino"] },
  { name: "Fragole",                   kcal: 32,  p: 0.7,  c: 8.0,  f: 0.3,  portion: 150, cat: "frutta", meals: ["colazione", "spuntino"] },
  { name: "Mirtilli",                  kcal: 57,  p: 0.7,  c: 14.0, f: 0.3,  portion: 100, cat: "frutta", meals: ["colazione", "spuntino"] },
  { name: "Uva",                       kcal: 69,  p: 0.7,  c: 18.0, f: 0.2,  portion: 120, cat: "frutta", meals: ["spuntino"] },

  // ---- Verdura ----
  { name: "Zucchine",                  kcal: 17,  p: 1.2,  c: 3.1,  f: 0.3,  portion: 200, cat: "verdura", meals: ["pranzo", "cena"] },
  { name: "Insalata mista",            kcal: 15,  p: 1.4,  c: 2.9,  f: 0.2,  portion: 100, cat: "verdura", meals: ["pranzo", "cena"] },
  { name: "Pomodori",                  kcal: 18,  p: 0.9,  c: 3.9,  f: 0.2,  portion: 150, cat: "verdura", meals: ["pranzo", "cena"] },
  { name: "Broccoli",                  kcal: 34,  p: 2.8,  c: 7.0,  f: 0.4,  portion: 200, cat: "verdura", meals: ["pranzo", "cena"] },
  { name: "Spinaci",                   kcal: 23,  p: 2.9,  c: 3.6,  f: 0.4,  portion: 150, cat: "verdura", meals: ["pranzo", "cena"] },
  { name: "Carote",                    kcal: 41,  p: 0.9,  c: 10.0, f: 0.2,  portion: 150, cat: "verdura", meals: ["pranzo", "cena", "spuntino"] },
  { name: "Peperoni",                  kcal: 26,  p: 1.0,  c: 6.0,  f: 0.3,  portion: 150, cat: "verdura", meals: ["pranzo", "cena"] },

  // ---- Grassi buoni ----
  { name: "Olio extravergine d'oliva", kcal: 884, p: 0.0,  c: 0.0,  f: 100.0, portion: 10, cat: "grassi", meals: ["pranzo", "cena"] },
  { name: "Avocado",                   kcal: 160, p: 2.0,  c: 8.5,  f: 15.0, portion: 100, cat: "grassi", meals: ["colazione", "pranzo", "cena"] },
  { name: "Mandorle",                  kcal: 603, p: 22.0, c: 4.6,  f: 55.0, portion: 20,  cat: "frutta secca", meals: ["colazione", "spuntino"] },
  { name: "Noci",                      kcal: 654, p: 15.0, c: 7.0,  f: 65.0, portion: 20,  cat: "frutta secca", meals: ["colazione", "spuntino"] },
  { name: "Burro d'arachidi",          kcal: 588, p: 25.0, c: 20.0, f: 50.0, portion: 20,  cat: "frutta secca", meals: ["colazione", "spuntino"] },
  { name: "Cioccolato fondente 85%",   kcal: 584, p: 9.0,  c: 24.0, f: 46.0, portion: 20,  cat: "dolci", meals: ["spuntino"] },

  // ---- Extra / piatti comuni ----
  { name: "Pizza margherita",          kcal: 271, p: 11.0, c: 33.0, f: 10.0, portion: 300, cat: "piatti", meals: ["pranzo", "cena"] },
  { name: "Marmellata",                kcal: 240, p: 0.5,  c: 59.0, f: 0.1,  portion: 25,  cat: "dolci", meals: ["colazione"] },
  { name: "Miele",                     kcal: 304, p: 0.6,  c: 80.0, f: 0.0,  portion: 15,  cat: "dolci", meals: ["colazione"] },
  { name: "Biscotti secchi",           kcal: 416, p: 7.0,  c: 80.0, f: 8.0,  portion: 30,  cat: "dolci", meals: ["colazione", "spuntino"] },
  { name: "Fette biscottate integrali",kcal: 380, p: 12.0, c: 70.0, f: 6.0,  portion: 30,  cat: "pane", meals: ["colazione"] },
  { name: "Crackers",                  kcal: 428, p: 9.5,  c: 68.0, f: 13.0, portion: 25,  cat: "pane", meals: ["spuntino"] },
];

const CAT_EMOJI = {
  proteine: "🍗", pesce: "🐟", uova: "🥚", salumi: "🥩", latticini: "🥛",
  legumi: "🫘", cereali: "🌾", pane: "🍞", frutta: "🍎", verdura: "🥦",
  grassi: "🫒", "frutta secca": "🥜", dolci: "🍯", piatti: "🍕", "integr.": "🥤",
};

function foodEmoji(food) {
  return CAT_EMOJI[food.cat] || "🍽️";
}
