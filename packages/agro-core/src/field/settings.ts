/**
 * Preferenze di UTENTE local-first: layout della dashboard (visibilità granulare
 * di moduli agronomici, strumenti mappa e pannelli GeoLibre) e unità di misura.
 *
 * Sono preferenze di utente, non di tenant: stesso ciclo di vita di
 * {@link ./theme} e {@link ./locale}. Vengono persistite in `localStorage` per
 * un salvataggio locale ISTANTANEO e offline-safe, poi sincronizzate sul control
 * plane (`public.profili_utenti.dashboard_layout_config` / `preferenze`) quando
 * la rete è disponibile, così seguono l'utente cross-device.
 *
 * Volutamente NON vivono in PGlite: quel data plane è isolato per `tenant_id` e
 * una preferenza d'interfaccia non deve cambiare al cambio di azienda né essere
 * duplicata per workspace. localStorage (device) + profili_utenti (utente) è il
 * binomio corretto, ed è lo stesso già usato da tema e lingua.
 */

// ---------------------------------------------------------------------------
// Catalogo dei moduli/feature attivabili
// ---------------------------------------------------------------------------

/**
 * Identificatore di un modulo, strumento o pannello la cui visibilità è
 * governata da un flag booleano in {@link DashboardLayoutConfig}. Raggruppati
 * per area (vedi {@link DASHBOARD_MODULE_GROUPS} lato UI) ma qui tenuti piatti
 * per una persistenza/serializzazione semplice.
 */
export type DashboardModuleId =
  // -- Pannelli & moduli agronomici (sidebar moduli) --
  | "panelNdvi"
  | "panelVra"
  | "panelColtura"
  | "panelAcqua"
  | "panelQuaderno"
  | "panelRaccolta"
  | "panelMagazzino"
  | "panelSian"
  | "panelStampa"
  | "panelRegistro"
  | "panelAnagrafica"
  | "panelMeteo"
  | "panelGeoCompliance"
  // -- Header / barra superiore --
  | "headerMeteoCard"
  | "headerAddData"
  | "headerSyncLed"
  // -- Strumenti & controlli mappa (GeoLibre) --
  | "mapMeasure"
  | "mapAttributeTable"
  | "mapTerrain"
  | "mapGeolocate"
  | "mapScale"
  | "mapLayerControl"
  | "mapBasemapSatellite"
  | "mapBasemapCadastre"
  | "mapBasemapWayback"
  | "mapSplitScreen";

/** Elenco canonico di tutti gli id (per iterazione, validazione, merge). */
export const DASHBOARD_MODULE_IDS: readonly DashboardModuleId[] = [
  "panelNdvi",
  "panelVra",
  "panelColtura",
  "panelAcqua",
  "panelQuaderno",
  "panelRaccolta",
  "panelMagazzino",
  "panelSian",
  "panelStampa",
  "panelRegistro",
  "panelAnagrafica",
  "panelMeteo",
  "panelGeoCompliance",
  "headerMeteoCard",
  "headerAddData",
  "headerSyncLed",
  "mapMeasure",
  "mapAttributeTable",
  "mapTerrain",
  "mapGeolocate",
  "mapScale",
  "mapLayerControl",
  "mapBasemapSatellite",
  "mapBasemapCadastre",
  "mapBasemapWayback",
  "mapSplitScreen",
];

/** Mappa flag → visibilità. `true` = modulo mostrato a schermo. */
export type DashboardLayoutConfig = Record<DashboardModuleId, boolean>;

/**
 * Default: quasi tutto attivo (UI completa). Le sole eccezioni sono le feature
 * GeoLibre più avanzate, spente di default per non appesantire la prima
 * esperienza: la mappa catastale (overlay WMS pesante), l'imagery storica
 * Wayback e la vista comparativa a schermo diviso.
 */
export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayoutConfig = {
  panelNdvi: true,
  panelVra: true,
  panelColtura: true,
  panelAcqua: true,
  panelQuaderno: true,
  panelRaccolta: true,
  panelMagazzino: true,
  panelSian: true,
  panelStampa: true,
  panelRegistro: true,
  panelAnagrafica: true,
  panelMeteo: true,
  panelGeoCompliance: true,
  headerMeteoCard: true,
  headerAddData: true,
  headerSyncLed: true,
  mapMeasure: true,
  mapAttributeTable: true,
  mapTerrain: true,
  mapGeolocate: true,
  mapScale: true,
  mapLayerControl: true,
  mapBasemapSatellite: true,
  mapBasemapCadastre: false,
  mapBasemapWayback: false,
  mapSplitScreen: false,
};

/**
 * Normalizza una configurazione (parziale o legacy) contro i default: ogni id
 * mancante eredita il default, ogni chiave sconosciuta viene scartata. Così
 * aggiungere un nuovo modulo non rompe le preferenze già salvate dall'utente.
 */
export function mergeDashboardLayout(
  partial: Partial<Record<string, unknown>> | null | undefined,
): DashboardLayoutConfig {
  const out = { ...DEFAULT_DASHBOARD_LAYOUT };
  if (partial && typeof partial === "object") {
    for (const id of DASHBOARD_MODULE_IDS) {
      const v = (partial as Record<string, unknown>)[id];
      if (typeof v === "boolean") out[id] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Unità di misura agronomiche
// ---------------------------------------------------------------------------

/** Unità di superficie: ettari (metrico) o acri (imperiale). */
export type AreaUnit = "ha" | "ac";
/** Unità di resa/quantità: quintali, tonnellate o chilogrammi. */
export type YieldUnit = "q" | "t" | "kg";
/**
 * Unità degli apporti idrici/irrigui: lama d'acqua in millimetri (intensiva, per
 * unità di superficie) o volume in ettolitri (estensiva). 1 mm su 1 ha = 100 hl.
 */
export type WaterUnit = "mm" | "hl";

export interface UnitSystem {
  area: AreaUnit;
  /** Unità di resa (eslint: la chiave `yield` non è una keyword in un oggetto). */
  yield: YieldUnit;
  /** Unità degli apporti irrigui (input/visualizzazione). */
  water: WaterUnit;
}

export const DEFAULT_UNITS: UnitSystem = { area: "ha", yield: "q", water: "mm" };

const HECTARE_TO_ACRE = 2.471053814671653;
const KG_PER_QUINTAL = 100;
const KG_PER_TONNE = 1000;
/** 1 mm d'acqua distribuito su 1 ha = 10 000 litri. */
const LITRES_PER_MM_HA = 10_000;
/** 1 ettolitro = 100 litri. */
const LITRES_PER_HL = 100;

export function areaUnitLabel(unit: AreaUnit): string {
  return unit === "ac" ? "ac" : "ha";
}

export function yieldUnitLabel(unit: YieldUnit): string {
  return unit === "t" ? "t" : unit === "kg" ? "kg" : "q";
}

export function waterUnitLabel(unit: WaterUnit): string {
  return unit === "hl" ? "hl" : "mm";
}

/**
 * Converte un apporto irriguo espresso nell'unità scelta in VOLUME (litri),
 * forma canonica salvata su `treatment_logs.water_volume_l`. I mm (lama d'acqua)
 * richiedono la superficie dell'appezzamento; gli ettolitri sono già un volume.
 * Ritorna null se l'input non è un volume positivo calcolabile.
 */
export function irrigationToLitres(
  amount: number,
  unit: WaterUnit,
  areaHa: number | null | undefined,
): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit === "hl") return Math.round(amount * LITRES_PER_HL);
  // mm → litri: serve l'area; senza, si assume 1 ha (l'irrigazione senza campo
  // non incide comunque su alcun bilancio, che è per-appezzamento).
  const ha = areaHa && areaHa > 0 ? areaHa : 1;
  return Math.round(amount * ha * LITRES_PER_MM_HA);
}

/** Inverso di {@link irrigationToLitres}: volume (litri) → quantità nell'unità scelta. */
export function litresToIrrigation(
  litres: number,
  unit: WaterUnit,
  areaHa: number | null | undefined,
): number {
  if (!Number.isFinite(litres) || litres <= 0) return 0;
  if (unit === "hl") return litres / LITRES_PER_HL;
  const ha = areaHa && areaHa > 0 ? areaHa : 1;
  return litres / (ha * LITRES_PER_MM_HA);
}

/** Formatta un valore in ettari nell'unità scelta (2 decimali). */
export function formatArea(
  hectares: number | null | undefined,
  unit: AreaUnit = DEFAULT_UNITS.area,
  fractionDigits = 2,
): string {
  if (hectares == null || Number.isNaN(hectares)) return "—";
  const value = unit === "ac" ? hectares * HECTARE_TO_ACRE : hectares;
  return `${value.toFixed(fractionDigits)} ${areaUnitLabel(unit)}`;
}

/** Formatta una quantità in kg nell'unità di resa scelta. */
export function formatYield(
  kilograms: number | null | undefined,
  unit: YieldUnit = DEFAULT_UNITS.yield,
  fractionDigits = 2,
): string {
  if (kilograms == null || Number.isNaN(kilograms)) return "—";
  const value =
    unit === "t"
      ? kilograms / KG_PER_TONNE
      : unit === "kg"
        ? kilograms
        : kilograms / KG_PER_QUINTAL;
  return `${value.toFixed(fractionDigits)} ${yieldUnitLabel(unit)}`;
}

// ---------------------------------------------------------------------------
// Persistenza locale (localStorage)
// ---------------------------------------------------------------------------

const LAYOUT_KEY = "agrogea.dashboardLayout";
const UNITS_KEY = "agrogea.units";

export function loadDashboardLayout(): DashboardLayoutConfig {
  try {
    const raw = globalThis.localStorage?.getItem(LAYOUT_KEY);
    if (raw) return mergeDashboardLayout(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    /* localStorage non disponibile o JSON corrotto: si ricade sui default */
  }
  return { ...DEFAULT_DASHBOARD_LAYOUT };
}

export function persistDashboardLayout(config: DashboardLayoutConfig): void {
  try {
    globalThis.localStorage?.setItem(LAYOUT_KEY, JSON.stringify(config));
  } catch {
    /* no-op */
  }
}

/** Valida i campi noti, tollerando `water` assente (pre-aggiornamento). */
function isUnitSystem(v: unknown): v is Partial<UnitSystem> {
  if (!v || typeof v !== "object") return false;
  const u = v as Record<string, unknown>;
  return (
    (u.area === "ha" || u.area === "ac") &&
    (u.yield === "q" || u.yield === "t" || u.yield === "kg")
  );
}

export function loadUnits(): UnitSystem {
  try {
    const raw = globalThis.localStorage?.getItem(UNITS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      // `water` può mancare nei valori salvati prima dell'aggiunta: default mm.
      if (isUnitSystem(parsed)) {
        return {
          area: parsed.area ?? DEFAULT_UNITS.area,
          yield: parsed.yield ?? DEFAULT_UNITS.yield,
          water:
            parsed.water === "hl" || parsed.water === "mm"
              ? parsed.water
              : DEFAULT_UNITS.water,
        };
      }
    }
  } catch {
    /* no-op */
  }
  return { ...DEFAULT_UNITS };
}

export function persistUnits(units: UnitSystem): void {
  try {
    globalThis.localStorage?.setItem(UNITS_KEY, JSON.stringify(units));
  } catch {
    /* no-op */
  }
}
