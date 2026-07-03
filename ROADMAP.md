# Roadmap — AgroGea Community (Desktop OSS)

Questa roadmap riguarda l'edizione Community (Desktop Open Source) distribuita
da questo repository.

## ✅ Disponibile oggi

- Mappa GIS completa (ortofoto Esri, overlay Catasto WMS, Wayback imagery storica, import Shapefile/GeoJSON/OSM/GeoParquet)
- Quaderno di Campagna Digitale con validazione PAN (trattamenti fitosanitari, fertilizzazioni, Tempo di Carenza)
- Harvest & Analytics (registrazione raccolte, grafici, Field Calculator)
- DSS & Bilancio Idrico (mappa colorata del rischio, evapotraspirazione FAO-56, riduzione di resa Ky FAO-33/66)
- Analisi del suolo e rateo variabile (VRA)
- Export SIAN/PAN (Italia), SIEX/CUE (Spagna), tracciato UE di base; import Fascicolo Aziendale SIAN
- Export geometrie (GeoJSON, KML, GPX, CSV, Shapefile) e backup/ripristino dati azienda (GeoJSON esteso)
- Funzionamento 100% offline, storage locale isolato (PGlite)
- Aggiornamenti automatici desktop (Tauri Updater + GitHub Releases)
- Installer nativi Windows/macOS/Linux dallo stesso codice (Tauri v2)

## 🚧 In lavorazione — `0.1.x`

Stabilizzazione della base attuale in vista del primo ciclo di feature.

- Installer macOS e Linux verificati end-to-end (finora testati principalmente su Windows)
- Correzioni e rifiniture sulle funzionalità già disponibili
- PIN offline: lunghezza minima 6 caratteri, parametri Argon2 rinforzati e pepper per-dispositivo nel keychain di sistema
- Proxy tile nativo: blocco degli indirizzi privati/loopback (anti-SSRF), con opt-in esplicito per WMS su rete aziendale
- CSP della webview: rimozione di `unsafe-eval` (resta solo `wasm-unsafe-eval` per PGlite/DuckDB) e restrizione di `connect-src`

## 🔭 Piano di rilascio (`0.2.0` → `1.0.0`)

Ogni minor version è un incremento rilasciabile con valore d'uso concreto. Le
versioni `0.2.0`–`0.4.0` (Magazzino, Parco macchine, Costo colturale) sono
sequenziali perché condividono un prerequisito tecnico; le versioni `0.5.0`–`0.8.0`
(DSS) sono un **binario parallelo indipendente** che può essere anticipato o
interlacciato con le prime, senza vincoli di dipendenza.

### `0.2.0` — Magazzino

Include il refactor del modello dati che abilita anche le versioni successive. Oggi
`treatment_logs` registra già le attività di campo, ma prodotti e mezzi vi sono
salvati come testo libero: questa versione introduce le anagrafiche e le tabelle di
giunzione, con migrazione additiva non distruttiva (PGlite) che mantiene i campi
testo come fallback finché non collegati.

- Fondamenta dati: anagrafiche `products` (categorie rigide — agrofarmaci con
  patentino, concimi con titoli N-P-K, sementi, carburante con assegnazioni UMA) e
  `product_lots` (lotto, scadenza, giacenza); tabella di giunzione
  `activity_products` (attività ↔ lotto, quantità, costo); estensione di DAL,
  coda `sync_outbox`, tipi di dominio e form attività.
- Tracciabilità obbligatoria di scadenze e lotti di produzione con alert di
  scadenza.
- Scarico reale al salvataggio dell'attività con controllo di inventario (blocco
  atomico se la giacenza va in negativo).
- Valorizzazione economica con Costo Unitario Medio Ponderato (CUMP): il costo
  vivo dei prodotti scaricati confluisce sul campo trattato.
- **Rilascio quando:** un'attività di campo scarica un lotto reale, la giacenza si
  aggiorna e il costo prodotti è imputato al campo.

### `0.3.0` — Parco macchine

- Anagrafiche `machines` (unità motrici) ed `equipment` (attrezzi) con la giunzione
  `activity_machines` (attività ↔ macchina ↔ attrezzo, ore).
- Separazione logica tra unità motrici (trattori/mietitrebbie, tracciate a ore di
  lavoro) e attrezzi (aratri/botti, tracciati per usura e larghezza di lavoro).
- Contatori ore aggiornati automaticamente al salvataggio dell'attività.
- Scadenziario di manutenzione ordinaria e straordinaria con alert basati sul
  tempo o sulle ore di utilizzo effettive.
- **Rilascio quando:** l'uso di un mezzo in campo incrementa i suoi contatori e fa
  scattare gli alert di manutenzione a soglia.

### `0.4.0` — Costo colturale integrato

Convergenza delle due versioni precedenti.

- Ammortamento del mezzo incluso nel costo dell'attività.
- Calcolo automatico del bilancio del campo come somma di prodotti + manodopera +
  ammortamento mezzi.
- **Rilascio quando:** ogni campo espone un costo colturale completo derivato dalle
  attività registrate.

### `0.5.0` — DSS: difesa completa sulle colture esistenti

Modelli infettivi veri (oltre alla sola fenologia oggi presente) sulle colture già
supportate. Ogni coltura è una cartella in `modules/crops/` registrata nel registro
moduli.

- Fusariosi della spiga su frumento (finestra BBCH 61-69), Ticchiolatura del melo
  (tabella di Mills), TomCast su pomodoro, Botrite su vite.

### `0.6.0` — DSS: nuovi cereali

- Mais (GDD base 10 °C, rischio aflatossine), orzo, riso.

### `0.7.0` — DSS: nuove arboree e orticole

- Pero (Stemphylium), agrumi (mal secco), patata (modello tipo Mileos/SIMPHYT).

### `0.8.0` — DSS: colture industriali e oleaginose

- Colza (Sclerotinia), barbabietola da zucchero (CercoBet), girasole, soia.

### `0.9.0` — API sensoristica esterna

Sfruttando lo schema `weather_readings` già presente, adapter di ingest da API
esterne per sensoristica fissa e mobile, con pipeline che alimenta direttamente i
modelli DSS.

### `1.0.0` — Prima release stabile

- Revisione UX complessiva sulla base dei feedback raccolti dalle versioni
  precedenti.
- Hardening finale e installer multi-OS verificati: prima release pubblica stabile
  e feature-complete.
- Revisione versione mobile.

---

Per proporre o discutere una voce di roadmap, apri una
[issue](https://github.com/eisii42/Open-AgroGea/issues). Vedi anche la
[guida per contribuire](docs/contributing.md).
