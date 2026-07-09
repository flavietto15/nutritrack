# 🥗 NutriTrack

Diario giornaliero di calorie e macronutrienti, semplice e veloce, con:

- **Anello calorie + meter dei macro** (proteine, carboidrati, grassi) aggiornati in tempo reale
- **Suggerimenti intelligenti** durante la giornata: in base a ora, pasto e macro
  ancora mancanti, propone alimenti e porzioni per centrare gli obiettivi
- **Scansione codice a barre** con la fotocamera (Open Food Facts) per i prodotti confezionati
- **Ricerca alimenti**: database locale (~65 alimenti comuni italiani, valori CREA/USDA)
  \+ ricerca online su Open Food Facts
- **Calcolo obiettivi**: TDEE con formula Mifflin-St Jeor, livello di attività e
  obiettivo (dimagrimento / mantenimento / massa), oppure macro personalizzati
- **4 pasti** (colazione, pranzo, spuntino, cena), modifica/eliminazione voci,
  navigazione tra i giorni
- Dati salvati **in locale nel browser** (localStorage) — nessun account, nessun server

## Avvio

La fotocamera richiede un contesto sicuro (HTTPS o `localhost`), quindi serve un
piccolo server locale — basta uno di questi comandi dalla cartella `nutritrack/`:

```bash
python3 -m http.server 8080
# oppure
npx serve .
```

Poi apri **http://localhost:8080** nel browser (su smartphone: stessa rete Wi-Fi
e IP del computer, ma per la fotocamera serve HTTPS — comodo `npx serve` con un
tunnel tipo `ngrok`, oppure installa l'app su un hosting statico qualsiasi).

## Note tecniche

- Nessuna dipendenza e nessuna build: HTML + CSS + JavaScript vanilla.
- Scanner: usa l'API nativa `BarcodeDetector` (Chrome/Edge/Android); su Safari e
  Firefox ripiega automaticamente su ZXing caricato da CDN. In assenza di
  fotocamera si può sempre digitare il codice a mano.
- Dati prodotti: [Open Food Facts](https://world.openfoodfacts.org) (API pubblica).
- I valori del database locale sono per 100 g, indicativi (fonti CREA/USDA);
  pasta, riso e cereali sono a crudo.

> ⚠️ Le stime caloriche e i suggerimenti sono indicativi e non sostituiscono il
> parere di un medico o di un nutrizionista.
