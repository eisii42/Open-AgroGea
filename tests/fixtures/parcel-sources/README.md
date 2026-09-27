# Fixture delle fonti di particelle

Risposte **reali** salvate dai servizi pubblici, per far girare i normalizzatori
senza toccare la rete (nessun test e nessun build fa richieste HTTP).

Si rigenerano solo quando il servizio cambia tracciato, e vanno risalvate
integrali: una fixture ritoccata a mano smette di essere una prova di come si
comporta il servizio vero, che è l'unica ragione per cui esiste.

## `nl-brp-page-1.json`, `nl-brp-page-2.json`, `nl-brp-bbox.json`

- **Fonte:** BRP Gewaspercelen (INSPIRE geharmoniseerd) — record di catalogo
  `nl-brp-gewaspercelen`.
- **Servizio:** `https://service.pdok.nl/rvo/gewaspercelen-geharmoniseerd/wfs/v1_0`
- **Licenza:** CC0-1.0 — RVO / PDOK.
- **Scaricate il:** 2026-09-01.
- **Richieste:** WFS 2.0.0 `GetFeature`, `typeNames=gewaspercelen-geharmoniseerd:gewaspercelen`,
  `outputFormat=application/json`, `srsName=urn:ogc:def:crs:EPSG::4258`.
  - `page-1`: `count=2`
  - `page-2`: `count=2&startIndex=2` (nessuna sovrapposizione con `page-1`)
  - `bbox`: `count=3&bbox=5.09,51.44,5.11,51.45,urn:ogc:def:crs:OGC:1.3:CRS84`

Due dettagli del servizio che le fixture documentano, e su cui il codice fa
affidamento:

1. la risposta GeoJSON **non** contiene `numberReturned` né `numberMatched`, per
   cui la paginazione si ferma quando arrivano meno elementi di quanti richiesti;
2. il codice coltura nazionale non è un attributo a sé: è l'ultimo segmento
   dell'URI `specificLanduseHref` (`.../gewascodes/259`), ed è il motivo per cui
   la mappatura degli attributi ammette un'estrazione con espressione regolare.
