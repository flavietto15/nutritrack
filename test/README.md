# Test end-to-end di NutriTrack

Test di regressione che guidano l'app reale in un browser (Playwright) e
verificano i flussi critici. Le chiamate esterne (IA e Open Food Facts) sono
**intercettate**, quindi i test sono deterministici e non consumano quota né
richiedono una chiave API.

## Cosa coprono

- **backup** — esporta i dati, simula un nuovo dispositivo (localStorage
  azzerato), reimporta il file e verifica che il diario sia recuperato; il file
  non contiene la chiave API e un secondo import non duplica le voci.
- **dish** — un piatto composto (carbonara) viene scomposto in ingredienti e,
  correggendo il peso della base, gli altri si riproporzionano.
- **brands** — i prodotti di marca prendono i macro reali da Open Food Facts;
  se non si trovano resta la stima IA; i freschi non fanno lookup.

## Eseguirli

```bash
cd test
npm install          # scarica playwright-core
npm test             # avvia server + browser e lancia tutti i *.test.js
```

Il runner avvia da solo un server statico sulla cartella del progetto, quindi
non serve avviarne uno a parte.

Serve un Chromium. Il runner usa `/opt/pw-browsers/chromium` se presente,
altrimenti imposta il percorso con la variabile d'ambiente `CHROMIUM_PATH`:

```bash
CHROMIUM_PATH=/percorso/al/chromium npm test
```

## Aggiungere un test

Crea `test/<nome>.test.js` che esporta una funzione:

```js
module.exports = async function ({ browser, baseURL }) {
  // usa gli helper in ./helpers.js: onboard, enableAi, mockAI, mockOFF, assert
};
```

Il runner esegue automaticamente tutti i file `*.test.js` della cartella.
