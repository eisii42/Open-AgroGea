# AgroGea — Documentazione tecnica dei moduli agronomici

> 🇮🇹 Italiano · [🇬🇧 English](./agronomic-modules.en.md)

> Questo documento spiega **come funzionano davvero** i moduli agronomici di AgroGea: quali grandezze calcolano, con quali formule e assunzioni, e come vanno interpretati i risultati. È il complemento tecnico del [Manuale utente](../user-guide/manuale.md), che invece descrive *dove cliccare*.
>
> Tutti i motori di calcolo sono **funzioni pure** in `plugins/agro-tools/src/` (NDVI, FAO 56/66, fenologia, fitopatologia, suolo, zonazione): girano interamente sul dispositivo, senza rete. I parametri agronomici (soglie termiche, coefficienti colturali, fattori di risposta) sono **default editabili di letteratura, non costanti regolatorie**: vanno tarati sull'ambiente e sulla coltura reale.

---

## Indice

1. [Indici vegetazionali satellitari](#1-indici-vegetazionali-satellitari)
2. [Calibrazione fenologica per coltura](#2-calibrazione-fenologica-per-coltura)
3. [Da tessitura a parametri idrici del suolo (pedotransfer)](#3-da-tessitura-a-parametri-idrici-del-suolo-pedotransfer)
4. [Bilancio idrico (FAO 56/66)](#4-bilancio-idrico-fao-5666)
5. [Riduzione di resa da stress idrico](#5-riduzione-di-resa-da-stress-idrico)
6. [DSS fitopatologico e gradi-giorno](#6-dss-fitopatologico-e-gradi-giorno)
7. [Mappa del rischio DSS (verde/giallo/rosso)](#7-mappa-del-rischio-dss-verdegiallorosso)
8. [Mappe a rateo variabile (VRA)](#8-mappe-a-rateo-variabile-vra)
9. [Formule del Field Calculator](#9-formule-del-field-calculator)
10. [Riferimenti bibliografici](#10-riferimenti-bibliografici)

---

## 1. Indici vegetazionali satellitari

**A cosa servono.** Un indice vegetazionale trasforma le riflettanze di alcune bande spettrali in un numero che stima lo **stato della vegetazione** (biomassa fotosinteticamente attiva, vigore, contenuto di clorofilla o d'acqua). AgroGea li calcola da immagini **Sentinel-2** (10–20 m di risoluzione, accesso via STAC) e li usa per: cartografia del vigore, base di zonazione VRA, componente del punteggio DSS, correlazione con la chimica del suolo.

**Sorgente dati.** Le funzioni operano su `Float32Array` di riflettanze già riproiettate sulla stessa griglia; i pixel senza dato producono `NaN` così che simbologia e statistiche zonali possano escluderli.

### Indici a differenza normalizzata — (a − b) / (a + b)

Sono gli indici più robusti perché il rapporto normalizzato riduce l'effetto di illuminazione e topografia.

| Indice | Formula (bande Sentinel-2) | Cosa misura |
|---|---|---|
| **NDVI** | (B08 − B04) / (B08 + B04) = (NIR − Rosso) / (NIR + Rosso) | Vigore/biomassa verde. È l'indice di riferimento; satura ad alta copertura fogliare. |
| **NDRE** | (B08 − B05) / (B08 + B05) = (NIR − Red-Edge) / (NIR + Red-Edge) | Stato azotato/clorofilla. Il red-edge penetra meglio la chioma densa: più sensibile dell'NDVI su vigneto e frutteto a piena vegetazione. |
| **NDWI** | (B03 − B08) / (B03 + B08) = (Verde − NIR) / (Verde + NIR) | Contenuto idrico della vegetazione e superfici sature (formulazione McFeeters). Valori alti = più acqua. |

> **Attenzione all'interpretazione:** il valore assoluto non è comparabile tra colture diverse o tra fasi fenologiche diverse. Lo stesso NDVI = 0,55 è "scarso" per un seminativo a piena copertura e "normale" per un vigneto a inizio stagione. Per questo AgroGea non legge gli indici in assoluto ma li **parametrizza sulla fase fenologica** (vedi §2).

### Indici corretti per il suolo — SAVI e MSAVI2

Quando la copertura vegetale è rada (arboree giovani, fasi iniziali, colture a file larghe), il suolo nudo tra le piante "sporca" il segnale. Gli indici soil-adjusted lo compensano.

- **SAVI** — Soil-Adjusted Vegetation Index (Huete 1988):

  ```
  SAVI = ((NIR − Rosso) / (NIR + Rosso + L)) · (1 + L)
  ```

  Il fattore `L` (0..1, default **0,5**) attenua l'influenza del suolo: alto per copertura rada, basso a piena copertura. Con `L = 0` degenera esattamente in NDVI.

- **MSAVI2** — Modified SAVI (Qi et al. 1994):

  ```
  MSAVI2 = (2·NIR + 1 − √((2·NIR + 1)² − 8·(NIR − Rosso))) / 2
  ```

  Il fattore di correzione si **auto-calibra pixel per pixel**, eliminando la scelta manuale di `L`. È l'indice più affidabile su suolo nudo o bassa copertura.

### Soil-masking (isolamento della chioma)

Sulle **colture arboree** l'interfila (suolo, inerbimento) va escluso prima di calcolare le statistiche, altrimenti abbassa artificialmente la media. AgroGea azzera (→ `NaN`) i pixel sotto una **soglia di indice** che arriva dalla matrice fenologica della coltura (es. NDVI del suolo nudo ~0,2, della chioma ben più alto). La **frazione di pixel validi** dopo il masking è a sua volta una stima della copertura vegetale. Sui seminativi a copertura continua il masking non viene applicato.

### Statistiche e simbologia

Per ogni appezzamento si calcolano media, min, max, deviazione standard e numero di pixel validi (sui soli pixel non-`NaN`). L'overlay raster usa rampe colore dedicate: una rampa di vigore (rosso → verde) per NDVI/NDRE/SAVI/MSAVI2 e una rampa idrica (beige → blu) per NDWI.

---

## 2. Calibrazione fenologica per coltura

**A cosa serve.** È il "dizionario" che rende gli indici e i modelli confrontabili tra colture e stagioni. Per ogni coltura e **fase fenologica** (iniziale, sviluppo, piena, maturazione) la matrice definisce:

- il **coefficiente colturale Kc** (per il bilancio idrico, §4);
- la **soglia di soil-masking NDVI** (per l'isolamento della chioma, §1);
- la **banda NDVI attesa** [min, max] della fase, base della scala di vigore relativa;
- le **soglie termiche** `tBase` e `tCutoff` (per i gradi-giorno, §6).

Colture calibrate: **vite, olivo, melo** (arboree, con soil-masking attivo) e **frumento, mais, pomodoro** (a copertura continua). Esempio — la vite ha `tBase = 10 °C`, `tCutoff = 30 °C`, e Kc che sale da 0,3 (germogliamento) a 0,85 (piena vegetazione) per poi ridiscendere a 0,45 a maturazione. I valori sono coerenti con FAO-56 e la letteratura agronomica, e sono **modificabili**.

---

## 3. Da tessitura a parametri idrici del suolo (pedotransfer)

**A cosa serve.** Il bilancio idrico ha bisogno di due costanti idrauliche del suolo — **capacità di campo θFC** e **punto di appassimento θPWP** — che raramente sono misurate in azienda. AgroGea le stima dalla **tessitura** (ciò che di solito *è* disponibile: una classe tessiturale o le percentuali sabbia/limo/argilla) tramite **funzioni di pedotransfer**.

### Risoluzione della tessitura

Da una classe testuale (multilingue IT/EN/ES, es. "franco argilloso" / "clay loam" / "franco arcilloso") si risolvono le tre frazioni granulometriche. Il match esatto usa i **centroidi USDA** delle 12 classi tessiturali; se l'etichetta è composta o atipica, un fallback euristico a parole-chiave assegna comunque frazioni plausibili. In alternativa si inseriscono direttamente le percentuali sabbia/limo/argilla, normalizzate a somma 1.

### Equazioni di Saxton & Rawls (2006)

Note sabbia (S), argilla (C) e sostanza organica (OM, % in peso), si stimano i contenuti d'acqua volumetrici alle due tensioni di riferimento:

- **Punto di appassimento** θ a 1500 kPa;
- **Capacità di campo** θ a 33 kPa.

Le costanti sono quelle pubblicate (*Soil Sci. Soc. Am. J.* 70:1569–1578). L'output è vincolato ai limiti fisici plausibili: `0 < θPWP < θFC < porosità (~0,55)`. Default: sostanza organica 2,5% (terreno agrario tipico), profondità radicale 0,8 m, frazione di deplezione p = 0,5 — tutti sovrascrivibili.

> **Perché conta.** Un suolo argilloso trattiene molta più acqua disponibile di uno sabbioso: a parità di clima e coltura, cambia radicalmente il numero di giorni di autonomia idrica. Fornire la composizione del suolo dell'appezzamento è il singolo dato che più migliora l'accuratezza del bilancio.

---

## 4. Bilancio idrico (FAO 56/66)

**A cosa serve.** Stimare giorno per giorno **quanta acqua c'è nella zona radicale** e prevedere quando la coltura entrerà in stress idrico, così da pianificare le irrigazioni con un modello invece che a sensazione. Segue il metodo del bilancio idrico per zona radicale di FAO Irrigation & Drainage Paper 56 (Allen et al. 1998) e 66.

### Passo 1 — Evapotraspirazione di riferimento ET₀ (Penman-Monteith FAO-56)

ET₀ è l'evapotraspirazione di una coltura di riferimento (erba, altezza 0,12 m, albedo 0,23) in condizioni idriche ottimali. È calcolata con l'equazione **Penman-Monteith FAO-56** dai dati della stazione meteo:

```
        0,408·Δ·(Rn − G) + γ·(900/(T+273))·u₂·(es − ea)
ET₀ = ─────────────────────────────────────────────────
              Δ + γ·(1 + 0,34·u₂)
```

dove Δ è la pendenza della curva di pressione di vapore (Tetens), γ la costante psicrometrica derivata dalla pressione atmosferica (funzione dell'altitudine), Rn la radiazione netta, G il flusso di calore nel suolo (≈ 0 su base giornaliera), u₂ il vento a 2 m, (es − ea) il deficit di pressione di vapore da T e umidità relativa min/max. La radiazione netta di onda lunga, se non fornita, è stimata con la formulazione FAO-56 (Stefan-Boltzmann, correzione per umidità e nuvolosità).

### Passo 2 — Evapotraspirazione colturale ETc

```
ETc = ET₀ · Kc
```

Il **coefficiente colturale Kc** dipende da coltura e fase fenologica (matrice del §2). ETc è il consumo idrico effettivo della coltura nella giornata.

### Passo 3 — Bilancio della zona radicale (equazione di deplezione)

Si traccia la **deplezione radicale Dr** (mm di acqua mancante rispetto alla capacità di campo) con l'equazione FAO-56 eq. 85 in forma esplicita:

```
Dr,t = Dr,t-1 − P_t − I_t + ETc,t + DP_t        (poi limitata a [0, AWC])
```

- **P** = pioggia efficace del giorno (mm), **I** = irrigazione misurata dai log gestionali (mm);
- **DP** = percolazione profonda: l'acqua che drena sotto la zona radicale quando l'apporto eccede la capacità di campo. È un **termine esplicito** del bilancio (FAO-56 eq. 88): `DP = max(0, −(Dr,t-1 − P − I + ETc))`. Non c'è percolazione finché il profilo non è saturo;
- risalita capillare (CR) e ruscellamento (RO) sono trascurati (≈ 0): default conservativo coerente con i dati da stazione.

Due grandezze definiscono la capacità del serbatoio-suolo (dai parametri del §3):

- **AWC** (Acqua disponibile totale) = (θFC − θPWP) · profondità radicale · 1000 [mm];
- **RAW** (Acqua facilmente disponibile) = p · AWC, con p frazione di deplezione senza stress (FAO-56 ~0,5).

**Soglia di stress:** finché Dr ≤ RAW la coltura traspira senza limitazioni; quando **Dr ≥ RAW** entra in stress idrico. I **giorni di autonomia** sono i giorni prima che, senza irrigare, Dr raggiunga RAW.

### Piano irriguo predittivo

Una variante proietta il bilancio in avanti con irrigazione automatica: quando la deplezione raggiunge RAW, prescrive un intervento che riporta il suolo a capacità di campo (Dr = 0), suggerendo così **volume e momento** dell'irrigazione.

---

## 5. Riduzione di resa da stress idrico

**A cosa serve.** Quantificare il costo produttivo dello stress idrico, non solo segnalarlo. Si basa su due grandezze FAO.

### Coefficiente di stress idrico Ks (FAO-56 eq. 84)

```
Ks = 1                              se Dr ≤ RAW  (nessuno stress)
Ks = (AWC − Dr) / (AWC − RAW)       se Dr > RAW  (decresce linearmente)
Ks = 0                              al punto di appassimento (Dr = AWC)
```

Ks è il fattore per cui la traspirazione reale è ridotta rispetto a quella potenziale: sotto RAW la coltura "chiude gli stomi" e traspira di meno.

### Riduzione di resa (FAO-33/66)

```
1 − Ya/Ym = Ky · (1 − ETa/ETc) = Ky · (1 − Ks)
```

dove **Ky** è il **fattore di risposta della coltura** allo stress idrico (default editabile per coltura). L'output è la **frazione di resa persa** in [0, 1]. Ky > 1 indica colture molto sensibili allo stress (es. mais in fioritura); Ky < 1 colture più tolleranti.

> Questa è una stima agronomica di prima approssimazione, utile per confrontare scenari e prioritizzare gli interventi, non una previsione di resa puntuale.

---

## 6. DSS fitopatologico e gradi-giorno

**A cosa serve.** Anticipare i rischi di malattia e la fenologia di colture e insetti a partire dalla serie meteo, per una difesa **integrata e mirata** (trattare quando serve, non a calendario). Output: alert tipizzati con livello di rischio (nullo/basso/medio/alto) e indice 1–5 per la gauge del DSS.

### Gradi-giorno (Growing Degree Days)

L'accumulo termico governa lo sviluppo di piante e insetti. AgroGea offre due metodi:

- **Media-soglia:** `GDD = clamp((Tmax+Tmin)/2, [tBase, tCutoff]) − tBase`. Il cutoff superiore evita che le temperature estreme gonfino l'accumulo.
- **Single-sine (Baskerville-Emin):** integra la curva termica sinusoidale del giorno; più accurato del media-soglia vicino alla soglia base, tipicamente usato per gli insetti.

L'accumulo cumulato segnala il giorno in cui si supera una soglia obiettivo (es. comparsa di uno stadio del target). `tBase`/`tCutoff` vengono dalla matrice della coltura (§2).

### Peronospora della vite — regola "tre-dieci"

Modello classico (Baldacci/Goidanich) per l'**infezione primaria** di *Plasmopara viticola*. Il rischio scatta quando, nella stessa finestra, coesistono le tre condizioni:

- germogli ≥ **10 cm**,
- temperatura media ≥ **10 °C**,
- pioggia ≥ **10 mm**.

Al verificarsi delle tre, il modulo genera un alert di rischio alto (indice 5) suggerendo la valutazione di un trattamento preventivo.

### Oidio della vite — finestra termica

*Erysiphe necator* è favorito da temperature **20–27 °C** con umidità moderata, sfavorito da T > 32 °C o piogge battenti. Il modello valuta ogni giorno la finestra favorevole e **scala il rischio se i giorni favorevoli sono consecutivi** (basso → medio → alto), restituendo l'alert peggiore della finestra.

### Occhio di pavone dell'olivo — bagnatura/temperatura

*Spilocaea oleagina* (*Fusicladium oleagineum*) richiede **bagnatura fogliare prolungata** (≥ ~10 h) con temperatura mite (ottimo ~15–20 °C, tollerata ~8–26 °C): il driver è l'umidità primaverile/autunnale, non l'estate secca. Bagnatura lunga (≥ 18 h) in piena banda ottimale produce un evento severo anche in un solo giorno; altrimenti il rischio scala sui giorni d'infezione consecutivi. L'alert suggerisce la valutazione di una difesa rameica.

---

## 7. Mappa del rischio DSS (verde/giallo/rosso)

**A cosa serve.** Sintetizzare in un **colpo d'occhio** lo stato agronomico di ogni appezzamento, combinando segnali eterogenei in un punteggio unico normalizzato 0..1:

- 🟢 **Verde — ottimale:** nessuna criticità rilevante;
- 🟡 **Giallo — allerta:** condizioni da monitorare (ingresso in stress o rischio fungino crescente);
- 🔴 **Rosso — critico:** intervento consigliato.

Il punteggio combina quattro componenti, ciascuna riportata su scala 0..1:

- **stress idrico** — da Dr rispetto a RAW/AWC (§4);
- **rischio fitopatologico** — dagli alert dei modelli fungini, con l'indice 1–5 normalizzato (indice/5) (§6);
- **vigore** — dall'NDVI relativo alla banda attesa della fase (§1–2);
- **fertilità del suolo** — da azoto e sostanza organica.

I **pesi sono calibrati per coltura**: le arboree pesano di più vigore e patologie, i seminativi lo stress idrico. Come per gli altri motori, pesi e soglie sono default editabili.

---

## 8. Mappe a rateo variabile (VRA)

**A cosa servono.** Una mappa VRA (Variable-Rate Application) suddivide l'appezzamento in **zone omogenee** e assegna a ciascuna una **dose diversa** di input (concime, seme, acqua, fitofarmaco), da inviare al terminale ISOBUS del trattore. L'obiettivo è distribuire l'input dove serve, riducendo sprechi e disomogeneità.

### Zonazione — K-Means 1-D deterministico

I pixel di un indice di base (es. NDVI storico medio) sono raggruppati in **k classi di vigore** (tipicamente 3–5) con un K-Means monodimensionale:

- **inizializzazione dei centroidi per quantili** (non casuale): stesso input → stesso output. È un requisito per mappe **riproducibili e auditabili**;
- essendo 1-D, l'assegnazione a un cluster è una semplice ricerca di soglia tra centroidi;
- i pixel `NaN` (soil-masking) sono scartati.

Per ogni classe si ottengono centroide, intervallo [min, max), numerosità e frazione del totale.

### Assegnazione delle dosi

A partire da una **dose di riferimento**, la mappa applica una delle due logiche agronomiche:

- **Conservativa** — più dose dove il vigore è **basso** (riempire le carenze, uniformare la coltura). Tipica per l'azoto/concimazione di sostegno.
- **Spinta** — più dose dove il vigore è **alto** (assecondare il potenziale produttivo). Tipica per la semina a rateo variabile.

Un parametro `intensità` (0..1) regola lo scostamento massimo dalla dose di riferimento tra la zona a vigore minore e quella a vigore maggiore. Le zone si vettorializzano poi (DuckDB Spatial) e si esportano in **ISO-XML** o **GeoJSON** per i terminali di campo.

---

## 9. Formule del Field Calculator

Il Field Calculator deriva **nuovi** campi dalla tabella attributi senza alterare i dati originali. Le formule pronte:

| Campo derivato | Formula | Note |
|---|---|---|
| **Densità piante** | `numero_piante / area_ha` | Piante per ettaro. |
| **Resa (t/ha)** | `(resa_kg / 1000) / area_ha` | Conversione kg → t sulla superficie. |
| **Max N organico (ZVN)** | `area_ha × 170` | Massimale di azoto organico (kg N/ha·anno) ammesso in **Zona Vulnerabile ai Nitrati**, come da Direttiva Nitrati 91/676/CEE. Fuori ZVN il limite di riferimento è più alto (tipicamente 340 kg N/ha): il valore va adeguato al contesto normativo dell'azienda. |

---

## 10. Riferimenti bibliografici

- **Allen R.G., Pereira L.S., Raes D., Smith M. (1998).** *Crop Evapotranspiration — Guidelines for computing crop water requirements.* FAO Irrigation and Drainage Paper 56. — ET₀ Penman-Monteith, Kc, bilancio della zona radicale, coefficiente di stress Ks.
- **Steduto P., Hsiao T.C., Fereres E., Raes D. (2012).** *Crop yield response to water.* FAO Irrigation and Drainage Paper 66; **Doorenbos J., Kassam A.H. (1979)**, Paper 33. — Fattore di risposta Ky e riduzione di resa.
- **Saxton K.E., Rawls W.J. (2006).** *Soil water characteristic estimates by texture and organic matter for hydrologic solutions.* Soil Sci. Soc. Am. J. 70:1569–1578. — Pedotransfer θFC/θPWP.
- **Huete A.R. (1988).** *A Soil-Adjusted Vegetation Index (SAVI).* Remote Sensing of Environment 25:295–309.
- **Qi J., Chehbouni A., Huete A.R., Kerr Y.H., Sorooshian S. (1994).** *A Modified Soil Adjusted Vegetation Index (MSAVI).* Remote Sensing of Environment 48:119–126.
- **Rouse J.W. et al. (1974).** *Monitoring vegetation systems in the Great Plains with ERTS.* — NDVI.
- **McFeeters S.K. (1996).** *The use of the Normalized Difference Water Index (NDWI).* International Journal of Remote Sensing 17:1425–1432.
- **Baskerville G.L., Emin P. (1969).** *Rapid estimation of heat accumulation from maximum and minimum temperatures.* Ecology 50:514–517. — Gradi-giorno single-sine.
- **Goidanich G. (1964).** *Manuale di Patologia Vegetale.* — Regola "tre-dieci" per la peronospora della vite.
- **Direttiva 91/676/CEE (Direttiva Nitrati)** — massimale di azoto organico in Zona Vulnerabile ai Nitrati.
