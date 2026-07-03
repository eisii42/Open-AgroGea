import type { Feature, FeatureCollection, Point } from "geojson";
import { cropStyle } from "../crop-colors";
import type {
  Appezzamento,
  AppezzamentiFeatureCollection,
  AssetInfrastruttura,
  CampionamentoSuolo,
  CampoCampagna,
  Crop,
  Raccolta,
  RaccolteFeatureCollection,
  RegistroTrattamento,
} from "../types";

/**
 * Proiezioni PURE dominio → GeoJSON per i layer MapLibre: nessuna dipendenza
 * dallo store, solo trasformazioni deterministiche degli array di dominio.
 */

/**
 * Risolve la coltura corrente di un appezzamento FISICO tramite il suo record di
 * Campagna Agraria (`plots_campaign` → `crops`). Restituisce la categoria DSS
 * (`crop_metadata.category`, es. "viticoltura") se presente, altrimenti il nome
 * comune della coltura. Coerente con la normalizzazione: un plot ha una coltura
 * solo nel contesto di un'annata. `null` se l'appezzamento non ha campagna/coltura.
 */
export function colturaPerAppezzamento(
  plotId: string,
  campiCampagna: CampoCampagna[],
  crops: Crop[],
): string | null {
  const camp = campiCampagna.find(
    (c) => c.plot_id === plotId && c.deleted_at == null,
  );
  if (!camp) return null;
  const crop = crops.find((cr) => cr.id === camp.crop_id);
  if (!crop) return null;
  const category = crop.crop_metadata?.["category"];
  return typeof category === "string" ? category : crop.common_name;
}

/** Coltura (record `crops`) associata a un appezzamento nell'annata attiva. */
function cropPerAppezzamento(
  plotId: string,
  campiCampagna: CampoCampagna[],
  crops: Crop[],
): Crop | null {
  const camp = campiCampagna.find(
    (c) => c.plot_id === plotId && c.deleted_at == null,
  );
  if (!camp) return null;
  return crops.find((cr) => cr.id === camp.crop_id) ?? null;
}

/**
 * Etichetta leggibile della coltura associata a un appezzamento nella Campagna
 * attiva (`plots_campaign` → `crops`): nome comune con varietà tra parentesi se
 * presente (es. "Vite (Sangiovese)"). `null` se non c'è coltura per l'annata.
 * A differenza di {@link colturaPerAppezzamento} (che ritorna la categoria DSS),
 * qui si privilegia il nome reale della coltura, più informativo nel tooltip.
 */
export function cropLabelPerAppezzamento(
  plotId: string,
  campiCampagna: CampoCampagna[],
  crops: Crop[],
): string | null {
  const crop = cropPerAppezzamento(plotId, campiCampagna, crops);
  if (!crop) return null;
  return crop.variety_name
    ? `${crop.common_name} (${crop.variety_name})`
    : crop.common_name;
}

/** FeatureCollection degli appezzamenti dell'azienda attiva, pronta per MapLibre. */
export function appezzamentiToFeatureCollection(
  appezzamenti: Appezzamento[],
  campiCampagna: CampoCampagna[] = [],
  crops: Crop[] = [],
): AppezzamentiFeatureCollection {
  return {
    type: "FeatureCollection",
    features: appezzamenti.map((a) => {
      const crop = cropPerAppezzamento(a.id, campiCampagna, crops);
      const kind = crop?.common_name ?? null;
      // Colore ad hoc per specie (grigio neutro se senza coltura). Iniettato
      // come proprietà simplestyle per-feature → onorato dal renderer GeoLibre.
      const { color } = cropStyle(kind);
      const label = crop
        ? crop.variety_name
          ? `${crop.common_name} (${crop.variety_name})`
          : crop.common_name
        : null;
      return {
        type: "Feature" as const,
        id: a.id,
        geometry: a.geometry,
        properties: {
          id: a.id,
          user_plot_name: a.user_plot_name,
          // Properties extra per il tooltip hover (Modulo UI §2).
          area_ha: a.area_ha,
          last_ndvi_mean: a.last_ndvi_mean,
          crop: label,
          crop_kind: kind,
          fill: color,
          stroke: color,
          // Obbligatori con simpleStyleEnabled (vedi nota nel tipo): senza, il
          // renderer calcola opacità/spessore = to-number(null) = 0 → invisibile.
          "fill-opacity": 0.35,
          "stroke-width": 1.5,
        },
      };
    }),
  };
}

/** FeatureCollection delle infrastrutture (asset CAD-GIS) per il layer. */
export function assetsToFeatureCollection(
  assets: AssetInfrastruttura[],
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: assets.map((a) => ({
      type: "Feature",
      id: a.id,
      geometry: a.geometry,
      properties: {
        id: a.id,
        name: a.name,
        asset_type: a.asset_type,
        category: a.category,
        length_m: a.length_m,
      },
    })),
  };
}

/**
 * FeatureCollection delle raccolte (Modulo Raccolta). Le properties (cultivar,
 * destinazione, quantita_kg) alimentano i grafici della tabella attributi (es.
 * Barre: somma/media di `quantita_kg` per `cultivar`/`destinazione`). Le raccolte
 * prive di geometria vengono emesse con un Point al centroide dell'appezzamento
 * collegato, se fornito tramite la mappa `centroidi`; altrimenti sono escluse dal
 * layer cartografico ma restano nei dati per i grafici via store.
 */
export function raccolteToFeatureCollection(
  raccolte: Raccolta[],
  centroidi?: Map<string, Point>,
): RaccolteFeatureCollection {
  const features: RaccolteFeatureCollection["features"] = [];
  for (const r of raccolte) {
    const geometry =
      r.geometry ??
      (r.plot_id ? centroidi?.get(r.plot_id) ?? null : null);
    if (!geometry) continue;
    features.push({
      type: "Feature",
      id: r.id,
      geometry,
      properties: {
        id: r.id,
        plot_id: r.plot_id,
        cultivar: r.cultivar,
        destination_logistics: r.destination_logistics,
        quantity_kg: r.quantity_kg,
        harvested_at: r.harvested_at,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * FeatureCollection del Registro operazioni (Quaderno di Campagna). Le properties
 * (tipo_operazione, prodotto, dose, quantità, avversità) alimentano la tabella
 * attributi e i suoi grafici. Geometria puntuale al centroide dell'appezzamento
 * collegato (se disponibile in `centroidi`); le operazioni "intera azienda" senza
 * appezzamento restano fuori dal layer cartografico ma nei dati via store.
 */
export function trattamentiToFeatureCollection(
  trattamenti: RegistroTrattamento[],
  centroidi?: Map<string, Point>,
): FeatureCollection<Point> {
  const features: Feature<Point>[] = [];
  for (const t of trattamenti) {
    const geometry = t.plot_id
      ? centroidi?.get(t.plot_id) ?? null
      : null;
    if (!geometry) continue;
    features.push({
      type: "Feature",
      id: t.id,
      geometry,
      properties: {
        id: t.id,
        plot_id: t.plot_id,
        operation_type: t.operation_type,
        product_name: t.product_name,
        dose_value: t.dose_value,
        dose_unit: t.dose_unit,
        total_quantity: t.total_quantity,
        target_disease: t.target_disease,
        executed_at: t.executed_at,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * FeatureCollection dei Punti di Interesse. Qui i POI sono i campionamenti
 * suolo georeferenziati più gli asset puntuali (pozzi, trappole, sensori)
 * disegnati come Point: entrambi hanno geometria puntuale.
 */
export function poiToFeatureCollection(
  campionamenti: CampionamentoSuolo[],
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: campionamenti.map((c) => ({
      type: "Feature",
      id: c.id,
      geometry: c.sampling_position,
      properties: {
        id: c.id,
        kind: "campionamento",
        ph: c.ph,
        sampled_at: c.sampled_at,
      },
    })),
  };
}
