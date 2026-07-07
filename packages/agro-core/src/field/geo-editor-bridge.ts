import { useAppStore } from "@geolibre/core";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { areaHectares, classifyGeometry, geometryHasCoordinates } from "../geo/area";
import { useAgroStore } from "../store";

/**
 * Ponte tra il GeoEditor di GeoLibre e il dominio agronomico, limitato alla
 * CATTURA DEI NUOVI DISEGNI.
 *
 * Il plugin `maplibre-gl-geo-editor` proietta i disegni in un layer dello store
 * GeoLibre marcato con sourcePath "geoeditor://sketches". Qui:
 *   1. quel layer grezzo viene tenuto NASCOSTO (visible: false) così non
 *      duplica i layer semantici stilizzati;
 *   2. ogni nuova geometria completata imposta `pendingGeometry` nello store
 *      agronomico, che apre la scheda dati (data-entry) per scegliere tipo e
 *      salvare sul DAL.
 *
 * L'EDITING di un elemento esistente NON passa più da qui: usa il motore NATIVO
 * di GeoLibre (`startLayerGeometryEdit`/`endLayerGeometryEdit`), orchestrato da
 * `useFieldPlugins`, che modifica le feature in-place e le riscrive in modo
 * atomico. Durante una sessione di editing la cattura nuovi-disegni è inibita.
 */

const SKETCHES_SOURCE_PATH = "geoeditor://sketches";

/** Id (o chiavi sintetiche) delle feature già gestite, per non riproporle. */
function featureKey(feature: Feature): string {
  if (feature.id != null) return String(feature.id);
  const props = feature.properties as Record<string, unknown> | null;
  const key = props?.__geoeditor_key ?? props?.id;
  if (key != null) return String(key);
  return JSON.stringify(feature.geometry);
}

/**
 * Attiva l'intercettazione dei disegni. Restituisce l'unsubscribe; va montato
 * una sola volta dalla shell dell'app (vedi useFieldPlugins in agro-field-suite).
 */
export function bindGeoEditorCapture(): () => void {
  // Le feature già presenti al bind (sessione precedente) non vanno
  // riproposte nella scheda dati: sono già passate dal DAL.
  const handled = new Set<string>();
  const initial = useAppStore
    .getState()
    .layers.find((l) => l.sourcePath === SKETCHES_SOURCE_PATH);
  for (const feature of initial?.geojson?.features ?? []) {
    handled.add(featureKey(feature));
  }

  return useAppStore.subscribe((state, prev) => {
    if (state.layers === prev.layers) return;
    const sketches = state.layers.find(
      (l) => l.sourcePath === SKETCHES_SOURCE_PATH,
    );
    if (!sketches?.geojson) return;

    // Durante una sessione di editing NATIVO il motore tiene le feature del layer
    // bersaglio nell'editor (non negli sketches): non si cattura nulla come nuovo
    // disegno.
    if (useAgroStore.getState().geomEdit) return;

    // Fuori sessione: nascondi il layer grezzo del geo-editor — niente
    // duplicazioni con i layer semantici. Lo facciamo qui perché il plugin
    // (ri)crea il layer visibile al primo disegno.
    if (sketches.visible) {
      useAppStore.getState().setLayerVisibility(sketches.id, false);
    }

    // Una geometria alla volta nella scheda dati: se ce n'è già una in attesa,
    // non catturare la successiva finché non è risolta.
    if (useAgroStore.getState().pendingGeometry) return;

    for (const feature of sketches.geojson.features) {
      const key = featureKey(feature);
      if (handled.has(key)) continue;
      const kind = classifyGeometry(feature.geometry);
      if (!kind) continue;
      // Sketch residuo/transitorio senza coordinate valide: non aprire la scheda
      // dati né calcolarne l'area (turf lancerebbe). Si ignora finché non è completo.
      if (!geometryHasCoordinates(feature.geometry)) continue;
      handled.add(key);

      const agro = useAgroStore.getState();
      // Nessun contesto azienda: resta solo sketch GIS, niente data-entry.
      if (!agro.dal || !agro.activeCompanyId) continue;

      const areaHa =
        kind === "polygon"
          ? areaHectares(feature.geometry as Polygon | MultiPolygon)
          : null;
      agro.setPendingGeometry({ feature, kind, sketchKey: key, areaHa });
      break;
    }
  });
}
