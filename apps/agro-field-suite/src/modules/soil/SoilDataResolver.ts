import type { Plot, SoilSample } from "@agrogea/core";
import {
  type FrazioniTessitura,
  frazioniDaTessitura,
  normalizzaFrazioni,
  type ParametriSuolo,
  parametriSuoloSaxtonRawls,
} from "@agrogea/tools";
import type { Feature, FeatureCollection } from "geojson";

/**
 * SoilDataResolver — risoluzione idro-pedologica del campo (Modulo Suolo §2).
 *
 * Ricava i {@link ParametriSuolo} (θFC, θPWP, profondità, deplezione) necessari
 * al bilancio idrico FAO 66 applicando una GERARCHIA CONDIZIONALE basata SOLO su
 * dati interni del tenant (nessuna API pubblica: no SoilGrids/Geoscopio):
 *
 *   TIER 1 — Mappa custom: uno strato vettoriale (Shapefile/GeoJSON da Add Data)
 *            di EC_a o tessitura caricato dall'utente. Sorgente primaria della
 *            variabilità spaziale del suolo.
 *   TIER 2 — Campionamenti georeferenziati: query spaziale DuckDB Spatial che
 *            interseca la geometria dell'appezzamento (`plots_registry.geometry`)
 *            con i punti di `soil_samples` interni o nelle immediate vicinanze;
 *            la tessitura/SO aggregata alimenta Saxton-Rawls.
 *   TIER 3 — Metadata dell'appezzamento, infine default (terreno franco).
 *
 * Le funzioni di mappatura attributi e aggregazione sono PURE (testabili sotto
 * Node). La parte spaziale importa {@link SpatialAnalysisEngine} dinamicamente,
 * così il grafo statico del modulo resta privo di DuckDB-WASM.
 */

/** Sorgente effettiva dei parametri risolti (per diagnostica/UI). */
export type SoilSource =
  | "custom-map"
  | "soil-samples"
  | "manual"
  | "metadata"
  | "default";

/** Chiave in `appezzamento.metadata` per la composizione del suolo inserita a mano. */
export const METADATA_SUOLO_KEY = "suolo";

/**
 * Composizione idro-pedologica inserita MANUALMENTE nella scheda appezzamento
 * (`metadata.suolo`). I campi sono tutti opzionali: la tessitura (classe o
 * percentuali) alimenta Saxton-Rawls; in alternativa si possono fornire
 * direttamente le costanti idrauliche θFC/θPWP per l'utente esperto.
 */
export interface SuoloManuale {
  /** Classe tessiturale testuale (IT/EN/ES). */
  tessitura?: string;
  /** Percentuali granulometriche (somma ~100). */
  sabbia?: number;
  limo?: number;
  argilla?: number;
  /** Sostanza organica (%). */
  sostanza_organica?: number;
  /** Reazione (pH). */
  ph?: number;
  /** Macronutrienti (mg/kg). */
  azoto?: number;
  fosforo?: number;
  potassio?: number;
  /** Profondità della zona radicale (m). */
  profondita_radici?: number;
  /** Frazione di deplezione FAO p (0..1). */
  frazione_deplezione?: number;
  /** Costanti idrauliche dirette (override esperto). */
  capacita_campo?: number;
  punto_appassimento?: number;
}

export interface ParametriSuoloRisolti {
  parametri: ParametriSuolo;
  sorgente: SoilSource;
  /** Numero di campioni/feature che hanno concorso al calcolo. */
  campioniUsati: number;
  /** Tessitura aggregata usata da Saxton-Rawls (null se da metadata/default). */
  tessitura: FrazioniTessitura | null;
  /** Messaggio sintetico per la UI. */
  dettaglio: string;
}

/** Parametri di default: terreno FRANCO (FAO-56 tab.19, valori conservativi). */
export const SUOLO_FRANCO_DEFAULT: ParametriSuolo = {
  capacitaCampo: 0.3,
  puntoAppassimento: 0.12,
  profonditaRadici: 0.8,
  frazioneDeplezione: 0.5,
};

export interface OpzioniRisoluzione {
  /** Strato vettoriale custom (EC_a/tessitura) da Add Data, se presente. */
  mappaCustom?: FeatureCollection | null;
  /** Profondità radicale (m): override coltura/appezzamento. */
  profonditaRadiciM?: number;
  /** Frazione di deplezione FAO p (0..1). */
  frazioneDeplezione?: number;
  /** Tolleranza spaziale (gradi) per i campioni "nelle immediate vicinanze". */
  tolleranzaVicinanzaDeg?: number;
}

/** ~50 m a latitudini medie: campioni appena fuori dal poligono restano validi. */
const TOLLERANZA_VICINANZA_DEG = 0.0005;

// ---------------------------------------------------------------------------
// Mappatura attributi (PURA)
// ---------------------------------------------------------------------------

function numero(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Primo valore numerico tra più chiavi candidate (case-insensitive). */
function primoNumero(
  props: Record<string, unknown>,
  chiavi: string[],
): number | null {
  const lower = new Map(
    Object.entries(props).map(([k, v]) => [k.toLowerCase(), v]),
  );
  for (const chiave of chiavi) {
    const n = numero(lower.get(chiave.toLowerCase()));
    if (n != null) return n;
  }
  return null;
}

/** Prima stringa non vuota tra più chiavi candidate (case-insensitive). */
function primaStringa(
  props: Record<string, unknown>,
  chiavi: string[],
): string | null {
  const lower = new Map(
    Object.entries(props).map(([k, v]) => [k.toLowerCase(), v]),
  );
  for (const chiave of chiavi) {
    const v = lower.get(chiave.toLowerCase());
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

/**
 * Estrae le frazioni granulometriche da un set di proprietà (feature custom o
 * campionamento): prima le percentuali esplicite sabbia/limo/argilla (multi
 * spelling IT/EN/ES), poi la classe tessiturale testuale. EC_a da sola non
 * determina la tessitura: in quel caso restituisce null (guida solo la zonazione).
 */
export function frazioniDaProprieta(
  props: Record<string, unknown>,
): FrazioniTessitura | null {
  const sabbia = primoNumero(props, ["sabbia", "sand", "arena", "sand_pct", "sand_perc"]);
  const limo = primoNumero(props, ["limo", "silt", "limos", "silt_pct"]);
  const argilla = primoNumero(props, ["argilla", "clay", "arcilla", "clay_pct"]);
  if (sabbia != null || limo != null || argilla != null) {
    const fr = normalizzaFrazioni(sabbia ?? 0, limo ?? 0, argilla ?? 0);
    if (fr) return fr;
  }
  const classe = primaStringa(props, ["tessitura", "texture", "textura", "classe", "soil_texture"]);
  return frazioniDaTessitura(classe);
}

/** Sostanza organica (%) dalle proprietà, multi spelling. */
export function sostanzaOrganicaDaProprieta(
  props: Record<string, unknown>,
): number | null {
  return primoNumero(props, [
    "organic_matter",
    "sostanza_organica",
    "om",
    "materia_organica",
    "soc",
  ]);
}

/** Frazioni di un campionamento: tessitura testuale o percentuali in metadata. */
export function frazioniDaCampione(
  c: SoilSample,
): FrazioniTessitura | null {
  const daClasse = frazioniDaTessitura(c.texture);
  if (daClasse) return daClasse;
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  return frazioniDaProprieta(meta);
}

interface Aggregato {
  frazioni: FrazioniTessitura;
  sostanzaOrganica: number | null;
  n: number;
}

/** Media delle frazioni e della SO su una lista di campioni/feature validi. */
export function aggregaTessitura(
  voci: Array<{ frazioni: FrazioniTessitura; sostanzaOrganica: number | null }>,
): Aggregato | null {
  if (voci.length === 0) return null;
  let sabbia = 0;
  let limo = 0;
  let argilla = 0;
  const so: number[] = [];
  for (const v of voci) {
    sabbia += v.frazioni.sabbia;
    limo += v.frazioni.limo;
    argilla += v.frazioni.argilla;
    if (v.sostanzaOrganica != null) so.push(v.sostanzaOrganica);
  }
  const n = voci.length;
  const frazioni = normalizzaFrazioni(sabbia / n, limo / n, argilla / n);
  if (!frazioni) return null;
  return {
    frazioni,
    sostanzaOrganica: so.length ? so.reduce((a, b) => a + b, 0) / so.length : null,
    n,
  };
}

/**
 * Parametri suolo dalla composizione inserita MANUALMENTE nella scheda
 * appezzamento (`metadata.suolo`). Ordine: costanti idrauliche dirette → da
 * tessitura/percentuali via Saxton-Rawls → null. Profondità e frazione di
 * deplezione manuali hanno la precedenza sugli override del chiamante.
 */
export function parametriDaSuoloManuale(
  appezzamento: Plot,
  opzioni: { profonditaRadiciM?: number; frazioneDeplezione?: number } = {},
): ParametriSuolo | null {
  const meta = (appezzamento.metadata ?? {}) as Record<string, unknown>;
  const raw = meta[METADATA_SUOLO_KEY];
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;

  const profondita =
    numero(s.profondita_radici) ??
    opzioni.profonditaRadiciM ??
    SUOLO_FRANCO_DEFAULT.profonditaRadici;
  const deplezione =
    numero(s.frazione_deplezione) ??
    opzioni.frazioneDeplezione ??
    SUOLO_FRANCO_DEFAULT.frazioneDeplezione;

  // Costanti idrauliche dirette (utente esperto).
  const cc = numero(s.capacita_campo);
  const pa = numero(s.punto_appassimento);
  if (cc != null && pa != null) {
    return {
      capacitaCampo: cc,
      puntoAppassimento: pa,
      profonditaRadici: profondita,
      frazioneDeplezione: deplezione,
    };
  }

  // Tessitura/percentuali → Saxton-Rawls (con SO se disponibile).
  const frazioni = frazioniDaProprieta(s);
  if (!frazioni) return null;
  return parametriSuoloSaxtonRawls(frazioni, {
    sostanzaOrganicaPct: sostanzaOrganicaDaProprieta(s) ?? undefined,
    profonditaRadiciM: profondita,
    frazioneDeplezione: deplezione,
  });
}

/** Parametri suolo dal metadata dell'appezzamento, se completi; altrimenti null. */
export function parametriDaMetadata(
  appezzamento: Plot,
): ParametriSuolo | null {
  const meta = (appezzamento.metadata ?? {}) as Record<string, unknown>;
  const raw = meta.parametri_suolo;
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const cc = numero(p.capacitaCampo);
  const pa = numero(p.puntoAppassimento);
  if (cc == null || pa == null) return null;
  return {
    capacitaCampo: cc,
    puntoAppassimento: pa,
    profonditaRadici: numero(p.profonditaRadici) ?? SUOLO_FRANCO_DEFAULT.profonditaRadici,
    frazioneDeplezione: numero(p.frazioneDeplezione) ?? SUOLO_FRANCO_DEFAULT.frazioneDeplezione,
  };
}

// ---------------------------------------------------------------------------
// FeatureCollection helpers (PURE)
// ---------------------------------------------------------------------------

/** FeatureCollection con il solo poligono dell'appezzamento. */
function plotFeatureCollection(appezzamento: Plot): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: appezzamento.geometry,
        properties: { id: appezzamento.id },
      },
    ],
  };
}

/**
 * FeatureCollection dei punti di campionamento (solo quelli con posizione e non
 * cancellati). Porta come properties il solo `sample_id`: chimica e tessitura
 * restano in JS (mappa per id), così DuckDB esegue unicamente il filtro spaziale.
 */
function sampleFeatureCollection(
  campionamenti: SoilSample[],
): { fc: FeatureCollection; byId: Map<string, SoilSample> } {
  const byId = new Map<string, SoilSample>();
  const features: Feature[] = [];
  for (const c of campionamenti) {
    if (c.deleted_at != null || !c.sampling_position) continue;
    byId.set(c.id, c);
    features.push({
      type: "Feature",
      geometry: c.sampling_position,
      properties: { sample_id: c.id },
    });
  }
  return { fc: { type: "FeatureCollection", features }, byId };
}

// ---------------------------------------------------------------------------
// Resolver (IO: compone DuckDB Spatial)
// ---------------------------------------------------------------------------

export class SoilDataResolver {
  /**
   * Risolve i parametri idro-pedologici dell'appezzamento secondo la gerarchia
   * Tier 1 → 2 → 3. È resiliente: ogni tier che fallisce (assente, senza
   * tessitura, errore spaziale) ricade sul successivo.
   */
  async risolvi(
    appezzamento: Plot,
    campionamenti: SoilSample[],
    opzioni: OpzioniRisoluzione = {},
  ): Promise<ParametriSuoloRisolti> {
    const opzSaxton = {
      profonditaRadiciM: opzioni.profonditaRadiciM,
      frazioneDeplezione: opzioni.frazioneDeplezione,
    };

    // TIER 1 — Mappa custom (EC_a/tessitura).
    if (opzioni.mappaCustom && opzioni.mappaCustom.features.length > 0) {
      try {
        const agg = await this.daMappaCustom(appezzamento, opzioni.mappaCustom);
        if (agg) {
          return {
            parametri: parametriSuoloSaxtonRawls(agg.frazioni, {
              ...opzSaxton,
              sostanzaOrganicaPct: agg.sostanzaOrganica ?? undefined,
            }),
            sorgente: "custom-map",
            campioniUsati: agg.n,
            tessitura: agg.frazioni,
            dettaglio: `Tessitura da mappa custom (${agg.n} feature) → Saxton-Rawls.`,
          };
        }
      } catch {
        // mappa custom illeggibile/senza tessitura: si prova coi campionamenti.
      }
    }

    // TIER 2 — Campionamenti georeferenziati (DuckDB Spatial → Saxton-Rawls).
    try {
      const agg = await this.daCampionamenti(
        appezzamento,
        campionamenti,
        opzioni.tolleranzaVicinanzaDeg ?? TOLLERANZA_VICINANZA_DEG,
      );
      if (agg) {
        return {
          parametri: parametriSuoloSaxtonRawls(agg.frazioni, {
            ...opzSaxton,
            sostanzaOrganicaPct: agg.sostanzaOrganica ?? undefined,
          }),
          sorgente: "soil-samples",
          campioniUsati: agg.n,
          tessitura: agg.frazioni,
          dettaglio: `Tessitura da ${agg.n} campionamento/i georeferenziato/i → Saxton-Rawls.`,
        };
      }
    } catch {
      // motore spaziale non disponibile: si ripiega su metadata/default.
    }

    // TIER 3 — Composizione inserita manualmente nella scheda appezzamento.
    const manuale = parametriDaSuoloManuale(appezzamento, opzSaxton);
    if (manuale) {
      return {
        parametri: manuale,
        sorgente: "manual",
        campioniUsati: 0,
        tessitura: null,
        dettaglio: "Composizione del suolo inserita manualmente nella scheda appezzamento.",
      };
    }

    // TIER 4 — Metadata legacy (`parametri_suolo`), infine default franco.
    const daMeta = parametriDaMetadata(appezzamento);
    if (daMeta) {
      return {
        parametri: {
          ...daMeta,
          profonditaRadici: opzSaxton.profonditaRadiciM ?? daMeta.profonditaRadici,
          frazioneDeplezione: opzSaxton.frazioneDeplezione ?? daMeta.frazioneDeplezione,
        },
        sorgente: "metadata",
        campioniUsati: 0,
        tessitura: null,
        dettaglio: "Parametri suolo dai metadata dell'appezzamento.",
      };
    }
    return {
      parametri: {
        ...SUOLO_FRANCO_DEFAULT,
        profonditaRadici:
          opzSaxton.profonditaRadiciM ?? SUOLO_FRANCO_DEFAULT.profonditaRadici,
        frazioneDeplezione:
          opzSaxton.frazioneDeplezione ?? SUOLO_FRANCO_DEFAULT.frazioneDeplezione,
      },
      sorgente: "default",
      campioniUsati: 0,
      tessitura: null,
      dettaglio: "Nessun dato pedologico: default terreno franco (FAO-56).",
    };
  }

  /** Tier 1: interseca lo strato custom col poligono e ne aggrega la tessitura. */
  private async daMappaCustom(
    appezzamento: Plot,
    mappa: FeatureCollection,
  ): Promise<Aggregato | null> {
    const { SpatialAnalysisEngine } = await import(
      "../../services/gis/SpatialAnalysisEngine"
    );
    const engine = SpatialAnalysisEngine.instance();
    const plotTbl = await engine.registerGeoJson("soil_plot", plotFeatureCollection(appezzamento));
    const layerTbl = await engine.registerGeoJson("soil_custom_layer", mappa);
    const intersecate = await engine.selectByLocation({
      targetTable: layerTbl,
      maskTable: plotTbl,
      predicate: "intersects",
    });
    const voci = intersecate.features
      .map((f) => mappaFeatureAVoce(f))
      .filter((v): v is NonNullable<typeof v> => v != null);
    return aggregaTessitura(voci);
  }

  /** Tier 2: filtra i campioni interni/vicini al poligono e aggrega la tessitura. */
  private async daCampionamenti(
    appezzamento: Plot,
    campionamenti: SoilSample[],
    tolleranzaDeg: number,
  ): Promise<Aggregato | null> {
    const { fc, byId } = sampleFeatureCollection(campionamenti);
    if (fc.features.length === 0) return null;

    const { SpatialAnalysisEngine } = await import(
      "../../services/gis/SpatialAnalysisEngine"
    );
    const { quoteIdentifier } = await import("../../services/gis/spatial-sql");
    const engine = SpatialAnalysisEngine.instance();
    const plotTbl = await engine.registerGeoJson("soil_plot", plotFeatureCollection(appezzamento));
    const sampleTbl = await engine.registerGeoJson("soil_sample_pts", fc);

    // Campioni interni al poligono O nelle immediate vicinanze (ST_DWithin).
    const s = quoteIdentifier("s");
    const p = quoteIdentifier("p");
    const sql =
      `SELECT ${s}.${quoteIdentifier("sample_id")} AS sample_id ` +
      `FROM ${quoteIdentifier(sampleTbl)} AS ${s}, ${quoteIdentifier(plotTbl)} AS ${p} ` +
      `WHERE ST_Intersects(${s}.${quoteIdentifier("geom")}, ${p}.${quoteIdentifier("geom")}) ` +
      `OR ST_DWithin(${s}.${quoteIdentifier("geom")}, ${p}.${quoteIdentifier("geom")}, ${tolleranzaDeg})`;
    const rows = await engine.query(sql);

    const voci: Array<{ frazioni: FrazioniTessitura; sostanzaOrganica: number | null }> = [];
    const visti = new Set<string>();
    for (const row of rows) {
      const id = row.sample_id;
      if (typeof id !== "string" || visti.has(id)) continue;
      visti.add(id);
      const campione = byId.get(id);
      if (!campione) continue;
      const frazioni = frazioniDaCampione(campione);
      if (!frazioni) continue;
      voci.push({ frazioni, sostanzaOrganica: campione.organic_matter });
    }
    return aggregaTessitura(voci);
  }
}

/** Mappa una feature dello strato custom in una voce (frazioni + SO) o null. */
function mappaFeatureAVoce(
  feature: Feature,
): { frazioni: FrazioniTessitura; sostanzaOrganica: number | null } | null {
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const frazioni = frazioniDaProprieta(props);
  if (!frazioni) return null;
  return { frazioni, sostanzaOrganica: sostanzaOrganicaDaProprieta(props) };
}
