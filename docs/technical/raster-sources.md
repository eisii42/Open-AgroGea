# Cartografia raster: WMS e ortofoto

> [`modules/add-data/wms.ts`](../../apps/agro-field-suite/src/modules/add-data/wms.ts) ·
> [`geotiff-overlay.ts`](../../apps/agro-field-suite/src/modules/add-data/geotiff-overlay.ts) ·
> [`orthophoto-registry.ts`](../../apps/agro-field-suite/src/modules/add-data/orthophoto-registry.ts) ·
> [`wms-basemaps.ts`](../../apps/agro-field-suite/src/modules/add-data/wms-basemaps.ts) ·
> UI: [`AddRasterSection.tsx`](../../apps/agro-field-suite/src/components/AddRasterSection.tsx)
>
> **Versione documento 0.6.1** · aggiornato il 4 ottobre 2026 · allineato ad **AgroGea 0.6**.

La sezione **Cartografia raster** di *Aggiungi dati* porta sulla mappa immagini
georeferenziate, in due modi con caratteristiche opposte:

| | WMS | Ortofoto `.tif` |
|---|---|---|
| dove sta il dato | sul server di chi lo pubblica | sul dispositivo dell'utente |
| aggiornamento | sempre l'ultimo | fermo alla data del volo |
| senza rete | non funziona | funziona |
| costo | nessuno per noi | memoria e decodifica |

Il rendering non è nostro: il motore cartografico (`@geolibre/map`) supporta
nativamente `type: "wms"` (con GetFeatureInfo) e `type: "image"` in [`layer-sync.ts`](../../packages/map/src/layer-sync.ts).
Qui si costruiscono soltanto il template dell'URL e la sovrapposizione.

## WMS: perché non basta incollare l'indirizzo

Un endpoint WMS non è un'immagine, è un servizio che espone *molti* layer con
nomi tecnici (`p:ortofoto2023`). Chiederli all'utente significa chiedergli un
dato che non ha — e sbagliarli di una lettera **non produce un errore**: il
server risponde con un'immagine vuota o trasparente, e la mappa semplicemente
non cambia.

Si interroga quindi il **GetCapabilities** e si presenta l'elenco con i titoli
leggibili. Il parser è volutamente tollerante (namespace con prefisso, CDATA,
entità, gerarchie profonde): un parser rigido fallirebbe su metà dei servizi
regionali italiani. Salta il blocco `<Service>`, dove il `<Name>` è quello del
servizio e non di un layer.

### Le tre trappole, tutte coperte dai test

1. **`CRS` nella 1.3.0, `SRS` nella 1.1.1.** Stesso parametro, nome diverso per
   versione. Sbagliarlo fa rispondere «missing parameter» in un modo che nessuno
   collega al protocollo.
2. **`{bbox-epsg-3857}` non va percent-encodato**, o MapLibre non lo riconosce e
   il layer resta trasparente. Si aggiunge dopo la serializzazione dell'URL.
3. **`STYLES` va dichiarato anche vuoto**: omesso, parecchi server rispondono con
   un XML d'errore invece che con un'immagine.

Si usa **EPSG:3857**, l'unica proiezione in cui i tile di MapLibre sono quadrati;
con EPSG:4326 la 1.3.0 pretende anche l'ordine invertito degli assi e le immagini
tornano ruotate.

## WMS salvati come sfondo (0.6)

Fino alla 0.5 un WMS aggiunto viveva solo nello store in memoria: chiudendo
l'app spariva e andava ricercato da capo. Dalla 0.6 se ne conserva la
**configurazione** — indirizzo, nome tecnico del layer, versione, titolo e
attribuzione, non le immagini — in `wms-basemaps.ts`:

- **per azienda e per dispositivo**, in `localStorage`, come le altre preferenze
  di visualizzazione (grafici e schede KPI del Command Center). È configurazione
  della vista, non un dato agronomico: non entra nella `sync_outbox` né nei
  backup. Un contenuto corrotto vale «nessun WMS salvato», mai un errore
  all'avvio (`sanitizeItem` scarta le voci incomplete);
- **un'alternativa al satellite, non un layer in più**: quando è attivo ne prende
  il posto (un solo sfondo alla volta) e resta sotto i dati dell'azienda e sotto
  l'overlay catastale. Compare fra gli sfondi del riquadro *Livelli* e
  nell'elenco *WMS salvati*, da cui si modifica o si elimina.

## Attribuzione e sicurezza

Quasi tutti i servizi pubblici chiedono di citare la fonte. Il layer-sync del
motore cartografico crea le sorgenti senza inoltrare `source.attribution`, quindi
lo fa [`useLayerAttributions`](../../apps/agro-field-suite/src/hooks/useLayerAttributions.ts)
sull'evento `sourcedataloading`, che MapLibre emette in modo sincrono prima che
il controllo delle attribuzioni si aggiorni.

L'attribuzione di un WMS nasce dal **titolo del servizio letto dal
GetCapabilities**, cioè da un server esterno, e il parser ne decodifica le
entità XML (`&lt;` torna `<`). MapLibre la inserisce come **HTML**, e il suo
sanitizer nella 5.x si aggira (CVE-2026-85061): un servizio ostile poteva
eseguire codice nell'app. Dalla 0.6.0 ogni attribuzione passa da
[`lib/escape-markup.ts`](../../apps/agro-field-suite/src/lib/escape-markup.ts):

- quelle dei layer dell'azienda (WMS, satellite, catasto, celle degli indici)
  sono **testo** e vengono escapate per intero (`escapeMarkup`);
- quelle delle altre sorgenti (stili remoti, plugin) possono contenere link
  legittimi e vengono ridotte a **testo più link `http(s)`**
  (`sanitizeAttribution`): ogni altro tag e attributo sparisce, i link ricevono
  `rel="noopener noreferrer"`. La funzione è idempotente, perché la stessa
  sorgente può passare più volte dall'hook.

I test sono in `tests/agro-escape-markup.test.ts`, payload della CVE compreso.

## Ortofoto: due limiti dichiarati

**L'immagine viene ridimensionata** a 4096 px di lato. Un'ortofoto a 20 cm su
cento ettari è una texture da 50.000 px: nessuna GPU la accetta come sorgente
singola. La lettura ricampiona già in `readRasters` (geotiff.js), così
l'immagine intera non entra mai in memoria. La risoluzione **dichiarata** resta
quella originale: è il dato che serve a capire se l'ortofoto è adatta a una
verifica, non quella della texture.

**La sovrapposizione è un quadrilatero**, non una riproiezione: MapLibre deforma
l'immagine sui quattro angoli in modo lineare. Su un'ortofoto aziendale lo
scarto è sotto il pixel; su un'immagine regionale si vedrebbe ai bordi.

Sistemi di riferimento gestiti: **WGS84/ETRS89 geografici e UTM**. Qualunque
altro viene **rifiutato citando il codice EPSG** invece di essere disegnato nel
posto sbagliato — un'ortofoto fuori registro di centinaia di metri sembra
funzionare, ed è peggio di una che non si carica.

I valori si normalizzano sull'intervallo osservato: un'ortofoto a 16 bit
disegnata senza normalizzare sarebbe nera.

## Un solo caricamento, due usi

La stessa ortofoto serve a **guardare** (mappa) e a **misurare** (scheda BCAA 8
del modulo Normativa). Chiedere due caricamenti dello stesso file da centinaia di
megabyte sarebbe assurdo, ma tenerne i pixel decodificati per tutta la sessione
lo sarebbe altrettanto.

Il registro tiene l'oggetto **`File`**, che è un riferimento ai byte su disco e
non i byte: costa nulla, e chi ne ha bisogno lo rilegge come vuole — la mappa
ridimensionato per la texture, la BCAA 8 a piena risoluzione e ritagliato
sull'appezzamento. Nessuno dei due paga il lavoro dell'altro.

Il registro è **di sessione**: chiudere l'applicazione lo svuota. È deliberato —
un'ortofoto è un file dell'utente, non un dato dell'azienda, e persisterla
vorrebbe dire decidere per lui che va conservata.
