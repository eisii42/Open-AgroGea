/**
 * Adozione: da {@link Parcel} — ciò che la fonte pubblica dichiara — a
 * {@link Plot}, ciò che l'azienda coltiva.
 *
 * È la transizione fra i due mondi del contratto, ed è **sempre un atto
 * esplicito dell'utente**. I livelli LPIS pubblici sono anonimizzati per legge
 * (in Francia il livello con l'identificativo PACAGE è riservato alle
 * amministrazioni): non esiste, e non sarebbe lecito, un modo di riempire da
 * solo il portafoglio di un'azienda. Questo modulo converte una particella che
 * l'utente ha scelto; non ne cerca né ne propone.
 *
 * Modulo PURO: nessun DB, nessuna rete. Il salvataggio resta del DAL, così la
 * conversione è verificabile senza istanziare nulla.
 */
import type { Parcel } from "@agrogea/parcel";
import { isSourcedParcel, parcelGeometry } from "@agrogea/parcel";
import type { MultiPolygon, Polygon } from "geojson";
import type { Plot } from "../types";

/** Chiave sotto cui vive la provenienza estesa in `plots_registry.metadata`. */
export const PARCEL_METADATA_KEY = "parcel";

/**
 * Provenienza estesa, persistita in `metadata.parcel`. **Contratto persistito**:
 * su dispositivi reali ci sono dati, quindi queste chiavi si aggiungono ma non
 * si rinominano.
 *
 * Sta in JSONB e non in colonne perché nessuno ci interroga sopra: serve a
 * mostrare l'attribuzione, a poter risalire alla fonte e a conservare la
 * geometria come l'ente l'ha pubblicata. Ciò su cui invece si deduplica e si
 * filtra — identificativo nativo, nodo NUTS, tipo di unità, annata — sono
 * colonne vere.
 */
export interface ParcelProvenance {
  /** Marcatore dell'origine, per distinguere gli appezzamenti adottati. */
  origin: "parcel-adoption";
  /** Nome della fonte, come va mostrato e attribuito. */
  sourceName: string | null;
  /** URL del servizio da cui proviene. */
  sourceUrl: string | null;
  /** Licenza del dato, con l'attribuzione che deve sopravvivere all'export. */
  license: { id: string; attribution: string; url?: string } | null;
  /** Istante di acquisizione (ISO 8601). */
  retrievedAt: string;
  /** CRS in cui la fonte pubblicava, forma `"EPSG:<codice>"`. */
  originalCrs: string | null;
  /**
   * Geometria come è arrivata dalla fonte, non riproiettata. `null` quando la
   * fonte pubblica già in WGS84 e la geometria dell'appezzamento È l'originale.
   */
  originalGeometry: Polygon | MultiPolygon | null;
  /** Codice coltura nella codifica della fonte, non tradotto. */
  nationalCropCode: string | null;
  /** Traduzione nella tassonomia HCAT (EuroCrops / JRC), quando disponibile. */
  hcatCode: string | null;
  /** Superficie ammissibile a premio dichiarata dalla fonte (ettari). */
  eligibleArea: number | null;
  /** Superficie dichiarata dalla fonte (ettari). */
  declaredArea: number | null;
}

/** Campi che l'utente completa a mano al momento dell'adozione. */
export interface AdoptionInput {
  /** Company che adotta. */
  companyId: string;
  /** Nome libero scelto dall'utente per l'appezzamento. */
  name: string;
  /** Foglio catastale, se l'utente lo conosce. */
  cadastralSheet?: string | null;
  /** Particella catastale, se l'utente la conosce. */
  cadastralParcel?: string | null;
}

/**
 * La riga da passare a `AgroDal.upsertPlot`. `area_ha` non c'è: la ricalcola il
 * DAL dalla geometria con `@turf/area`, ed è l'unico punto di verità per la
 * superficie — quella dichiarata dalla fonte resta in `metadata` come dato di
 * provenienza, non come misura su cui calcolare le dosi.
 */
export type AdoptedPlotDraft = Omit<
  Plot,
  "tenant_id" | "created_at" | "updated_at" | "deleted_at" | "area_ha"
>;

/** Provenienza estesa di una particella, pronta per `metadata.parcel`. */
export function parcelProvenance(parcel: Parcel): ParcelProvenance {
  const sourced = isSourcedParcel(parcel);
  return {
    origin: "parcel-adoption",
    sourceName: sourced ? parcel.sourceName : null,
    sourceUrl: sourced ? parcel.sourceUrl : null,
    license: sourced ? parcel.license : null,
    retrievedAt: parcel.retrievedAt,
    originalCrs: sourced ? parcel.originalCrs : null,
    originalGeometry: sourced ? parcel.originalGeometry : null,
    nationalCropCode: parcel.nationalCropCode,
    hcatCode: parcel.hcatCode,
    eligibleArea: parcel.eligibleArea,
    declaredArea: parcel.declaredArea,
  };
}

/**
 * Converte una particella scelta dall'utente nella riga da persistere.
 *
 * La geometria adottata è quella EFFICACE ({@link parcelGeometry}): se l'utente
 * ha rettificato il poligono prima di adottarlo, l'appezzamento nasce con la
 * rettifica — mentre la geometria della fonte resta comunque leggibile nella
 * provenienza. La correzione non cancella mai ciò che l'ente dichiarava.
 */
export function parcelToPlotDraft(
  parcel: Parcel,
  input: AdoptionInput,
  newId: () => string,
): AdoptedPlotDraft {
  return {
    id: newId(),
    company_id: input.companyId,
    user_plot_name: input.name,
    cadastral_sheet: input.cadastralSheet ?? null,
    cadastral_parcel: input.cadastralParcel ?? null,
    geometry: parcelGeometry(parcel),
    irrigation_type: null,
    planting_year: null,
    last_ndvi_mean: null,
    historical_notes: null,
    source_id: isSourcedParcel(parcel) ? parcel.sourceId : null,
    nuts_code: parcel.nutsCode,
    reference_unit_type: parcel.referenceUnitType,
    validity_year: parcel.validityYear,
    metadata: { [PARCEL_METADATA_KEY]: parcelProvenance(parcel) },
  };
}

/**
 * L'appezzamento già adottato che corrisponde a questa particella, o `null`.
 *
 * Il confronto è su `source_id` + `nuts_code`, la stessa coppia dell'indice
 * unico in `plots_registry`: l'interfaccia può così avvisare PRIMA di tentare
 * una scrittura che il vincolo respingerebbe. Una particella disegnata a mano
 * non ha provenienza e non corrisponde mai a nulla — due disegni sullo stesso
 * campo restano due appezzamenti distinti, ed è giusto così: nessuno può dire
 * che fossero lo stesso.
 */
export function findAdoptedPlot(
  plots: readonly Plot[],
  parcel: Parcel,
): Plot | null {
  if (!isSourcedParcel(parcel)) return null;
  return (
    plots.find(
      (plot) =>
        plot.source_id === parcel.sourceId &&
        plot.nuts_code === parcel.nutsCode &&
        plot.deleted_at == null,
    ) ?? null
  );
}

/**
 * La particella è già nel portafoglio. Porta con sé l'appezzamento esistente,
 * così l'interfaccia può indicarlo invece di limitarsi a rifiutare: chi ha
 * cliccato vuole sapere QUALE campo è già suo, non solo che l'operazione non si
 * può fare.
 */
export class ParcelAlreadyAdoptedError extends Error {
  constructor(readonly existing: Plot) {
    super(
      `La particella è già adottata come "${existing.user_plot_name}".`,
    );
    this.name = "ParcelAlreadyAdoptedError";
  }
}

/** Provenienza estesa di un appezzamento adottato, o `null` se non ne ha. */
export function plotProvenance(plot: Plot): ParcelProvenance | null {
  const raw = plot.metadata?.[PARCEL_METADATA_KEY];
  if (raw == null || typeof raw !== "object") return null;
  const provenance = raw as Partial<ParcelProvenance>;
  return provenance.origin === "parcel-adoption"
    ? (provenance as ParcelProvenance)
    : null;
}

/**
 * Riga di attribuzione da mostrare all'utente, o `null` se l'appezzamento non
 * viene da una fonte esterna. La licenza non è un ornamento: è un obbligo che
 * viaggia col dato, e questa è la forma in cui si onora a schermo.
 */
export function attributionLine(plot: Plot): string | null {
  const provenance = plotProvenance(plot);
  if (!provenance?.license) return null;
  const { attribution, id } = provenance.license;
  const source = provenance.sourceName;
  return source ? `${source} — ${attribution} (${id})` : `${attribution} (${id})`;
}
