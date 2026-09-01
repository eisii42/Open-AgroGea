# `@agrogea/parcel`

Il contratto delle unità di riferimento territoriale e il catalogo delle fonti
pubbliche europee da cui provengono.

Pacchetto **foglia**: zero dipendenze runtime, nessun accesso a rete, DB o DOM.
Lo importano `@agrogea/core` e i plugin distribuiti a parte, che devono poter
leggere il contratto senza tirarsi dietro PGlite. Non dipende, e non deve mai
dipendere, da `@agrogea/core`.

## `Parcel` non è `Plot`

- **`Parcel`** — ciò che la FONTE dichiara: una geometria con la sua provenienza,
  la sua licenza e la sua annata. Candidata all'adozione.
- **`Plot`** (`@agrogea/core`, tabella `plots_registry`) — ciò che l'AZIENDA ha
  adottato e coltiva, con i suoi dati agronomici.

L'adozione è la transizione fra i due, ed è sempre un atto esplicito
dell'utente: i livelli LPIS pubblici sono anonimizzati per legge, e nessuna
pre-popolazione automatica del portafoglio è possibile né lecita.

`Parcel` è un'unione discriminata — `SourcedParcel | ManualParcel` — così il
tipo impedisce di costruire una particella acquisita senza dire da dove viene e
con quale licenza. Anche la digitalizzazione a mano passa da qui: stesso
contratto, non un percorso parallelo.

## Il catalogo è dato, non codice

Un file JSON per fonte in `src/catalog/`, validato da `validateSourceRecord`.
Aggiungere un paese significa aggiungere un record e verificarlo — mai scrivere
un modulo. La granularità è il **nodo NUTS, non lo Stato**: gli endpoint reali
sono sub-nazionali, e la copertura si eredita verso il basso (`"NL"` risponde
per `"NL32"`).

Le differenze fra portali vivono in `attributeMap`, che ammette sia il nome
dell'attributo sia `{ attribute, pattern }` quando il valore va estratto — nei
servizi INSPIRE armonizzati il codice coltura è l'ultimo segmento di un URI di
codelist, e senza un modo dichiarativo di tirarlo fuori servirebbe una funzione
per portale.

Procedura completa in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) →
*How to add … a new parcel source*.

## Fonti verificate

| id | nodi | tipo di unità | licenza |
|---|---|---|---|
| `nl-brp-gewaspercelen` | `NL` | `agricultural_parcel` | CC0-1.0 — RVO / PDOK |
| `fr-rpg-parcelles` | `FR` | `farmer_parcel` | etalab-2.0 — IGN |

```bash
npm run verify:sources
```

Interroga davvero ogni endpoint e controlla che gli attributi mappati esistano
ancora: un portale che rinomina una colonna non rompe niente in compilazione,
rompe l'acquisizione sul dispositivo di un agricoltore. È l'unico punto del
repository che tocca la rete — test e build non ne fanno mai.

## Rete e geodesia sono iniettate

Gli adapter costruiscono l'URL e interpretano la risposta; **non** decidono come
si arriva in rete né come si trasformano le coordinate. Il recupero
({`ParcelFetch`}) sotto Tauri avviene in Rust, fuori dal sandbox CORS del
webview e con concorrenza controllata; la riproiezione ({`Reprojector`}) usa
proj4 da `@agrogea/core`. È ciò che tiene questo pacchetto senza dipendenze e i
normalizzatori testabili su fixture salvate.
