import { useAgroStore, type Plot } from "@agrogea/core";
import {
  resolveParameters,
  runCheck,
  type CheckInput,
  type CheckResult,
  type CheckSpec,
  type LayerFindings,
  type OrthophotoSummary,
  type ParameterOverrides,
  type TerrainSummary,
} from "@agrogea/tools";
import { useAppStore } from "@geolibre/core";
import type { FeatureCollection } from "geojson";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCheckInput, loadParameterOverrides } from "./check-inputs";
import { complianceRegistry } from "./compliance-registry";
import {
  CONSTRAINT_LABELS,
  geometryBbox,
  minDistanceToLayerM,
  type ConstraintType,
} from "./geo-compliance";
import booleanIntersects from "@turf/boolean-intersects";

/**
 * Esecuzione delle schede di compliance, **una alla volta**.
 *
 * ## Perché una alla volta
 *
 * Ogni scheda ha presupposti propri: finestra temporale, indici, annate di
 * archivio. Eseguirle tutte insieme significa, sull'appezzamento sbagliato o
 * nell'annata sbagliata, chiedere l'archivio della più esigente — la EUDR
 * risale al 2020 — per poi mostrare venti esiti di cui l'utente ne stava
 * cercando uno. Valutare una scheda per volta rende esplicito **che cosa** si
 * sta chiedendo, e limita il lavoro a ciò che quella scheda richiede.
 *
 * I risultati si accumulano per `checkId`: rivalutare una scheda sostituisce il
 * suo esito e lascia intatti gli altri.
 *
 * ## Dove sta il calcolo pesante
 *
 * Non qui. Le schede sono funzioni pure che leggono una serie temporale GIÀ in
 * cache: decine di punti, millisecondi. Il lavoro pesante — scaricare i COG,
 * ritagliarli sul poligono, calcolare gli indici — è quello della pipeline del
 * modulo Suolo, che gira nel suo Web Worker e alimenta la cache che queste
 * schede leggono.
 */

/** Tag `metadata.compliance` riconosciuti sui layer caricati nella mappa. */
const LAYER_TAGS = Object.keys(CONSTRAINT_LABELS) as ConstraintType[];

interface TaggedLayer {
  type: ConstraintType;
  fc: FeatureCollection;
}

/** Layer di compliance caricati nella mappa, per tag. */
function useTaggedLayers(): TaggedLayer[] {
  const layers = useAppStore((s) => s.layers);
  return useMemo(() => {
    const out: TaggedLayer[] = [];
    for (const layer of layers) {
      const tag = layer.metadata?.compliance;
      if (
        typeof tag === "string" &&
        (LAYER_TAGS as string[]).includes(tag) &&
        layer.geojson
      ) {
        out.push({
          type: tag as ConstraintType,
          fc: layer.geojson as FeatureCollection,
        });
      }
    }
    return out;
  }, [layers]);
}

/**
 * Che cosa i layer dicono di questo appezzamento. Riusa il percorso di
 * `geo-compliance.ts` invece di duplicarlo: stesso prefiltro per bounding box,
 * stesso `booleanIntersects`, più la distanza dal reticolo idrografico che la
 * BCAA 4 richiede.
 */
function layerFindingsFor(plot: Plot, layers: TaggedLayer[]): LayerFindings {
  const feature = {
    type: "Feature" as const,
    geometry: plot.geometry,
    properties: {},
  };
  const plotBbox = geometryBbox(plot.geometry);
  const intersects: string[] = [];
  let minDistanceToWaterM: number | null = null;

  for (const layer of layers) {
    const hit = layer.fc.features.some((f) => {
      if (!f.geometry) return false;
      const b = geometryBbox(f.geometry);
      if (b[2] < plotBbox[0] || plotBbox[2] < b[0]) return false;
      if (b[3] < plotBbox[1] || plotBbox[3] < b[1]) return false;
      return booleanIntersects(feature, f);
    });
    if (hit) intersects.push(layer.type);
    if (layer.type === "water_network") {
      minDistanceToWaterM = minDistanceToLayerM(plot.geometry, layer.fc);
    }
  }

  return {
    available: layers.map((l) => l.type),
    intersects,
    minDistanceToWaterM,
  };
}

/**
 * Aggiunge il reticolo recuperato da OpenStreetMap ai layer della mappa. Se
 * l'utente ha già caricato un reticolo proprio, quello VINCE: è cartografia
 * ufficiale, e OSM serve solo a non lasciare la scheda senza dato.
 */
function withWaterNetwork(
  layers: TaggedLayer[],
  osm: FeatureCollection | null,
): TaggedLayer[] {
  if (!osm) return layers;
  if (layers.some((l) => l.type === "water_network")) return layers;
  return [...layers, { type: "water_network", fc: osm }];
}

export interface ComplianceChecksState {
  /** Id della scheda in esecuzione, o `null`. */
  running: string | null;
  error: string | null;
  /** Esiti già calcolati, per `checkId`. */
  results: Record<string, CheckResult>;
  /** Override attivi, per la UI dei parametri. */
  overrides: ParameterOverrides;
  /** Valuta (o rivaluta) una singola scheda. */
  run: (checkId: string) => void;
  /** Schede applicabili al paese dell'azienda, nell'ordine del catalogo. */
  specs: CheckSpec[];
}

export function useComplianceChecks(
  plot: Plot | null,
  campaignYear: number,
  sources: {
    terrain?: TerrainSummary | null;
    waterNetwork?: FeatureCollection | null;
    orthophoto?: OrthophotoSummary | null;
    /** Cambia quando la cache delle scene si arricchisce: forza la ricostruzione. */
    cacheToken?: number;
  } = {},
): ComplianceChecksState {
  const terrain = sources.terrain ?? null;
  const orthophoto = sources.orthophoto ?? null;
  const waterNetwork = sources.waterNetwork ?? null;
  const cacheToken = sources.cacheToken ?? 0;
  const dal = useAgroStore((s) => s.dal);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const companies = useAgroStore((s) => s.companies);
  const crops = useAgroStore((s) => s.crops);
  const layers = useTaggedLayers();

  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [overrides, setOverrides] = useState<ParameterOverrides>({});

  const country =
    companies.find((c) => c.id === activeCompanyId)?.country?.toUpperCase() ?? "IT";

  const specs = useMemo(
    () => complianceRegistry().list({ country }),
    [country],
  );

  /**
   * Ingresso condiviso delle schede, ricostruito quando cambia l'appezzamento o
   * l'annata. Costruirlo una volta sola evita di rileggere il Quaderno intero a
   * ogni scheda valutata, che su un'azienda con dieci anni di storico non è
   * gratis.
   */
  const inputRef = useRef<{
    key: string;
    value: Omit<CheckInput, "parameters">;
  } | null>(null);

  // Cambiare appezzamento o annata invalida esiti e stime: si riparte pulito
  // invece di lasciare a schermo risultati di un altro campo.
  useEffect(() => {
    inputRef.current = null;
    setResults({});
    setError(null);
    setRunning(null);
  }, [plot?.id, campaignYear]);

  // Ingresso condiviso delle schede: Quaderno, campagne, layer e serie in
  // cache. Si costruisce una volta per appezzamento, non una per scheda.
  useEffect(() => {
    let alive = true;
    if (!dal || !plot || !activeCompanyId) return;
    void (async () => {
      try {
        const [input, loaded] = await Promise.all([
          buildCheckInput(dal, activeCompanyId, {
            plot,
            campaignYear,
            country,
            campaigns: await dal.listCampiCampagna({ plotId: plot.id }),
            crops,
            layers: layerFindingsFor(plot, withWaterNetwork(layers, waterNetwork)),
            terrain,
            orthophoto,
            now: new Date().toISOString(),
          }),
          loadParameterOverrides(dal, activeCompanyId),
        ]);
        if (!alive) return;
        inputRef.current = { key: `${plot.id}:${campaignYear}`, value: input };
        setOverrides(loaded);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [
    dal,
    plot,
    activeCompanyId,
    campaignYear,
    country,
    crops,
    layers,
    terrain,
    orthophoto,
    waterNetwork,
    cacheToken,
    specs,
  ]);

  const run = useCallback(
    (checkId: string) => {
      const spec = complianceRegistry().get(checkId);
      const input = inputRef.current?.value;
      if (!spec || !input || !dal || !plot || !activeCompanyId) return;
      setRunning(checkId);
      setError(null);
      void (async () => {
        try {
          // Gli override si rileggono a ogni valutazione: una soglia appena
          // cambiata deve valere per l'esito che si sta per calcolare.
          const current = await loadParameterOverrides(dal, activeCompanyId);
          setOverrides(current);
          const result = runCheck(spec, {
            ...input,
            parameters: resolveParameters(spec, current),
            // L'orologio si legge QUI, una volta: la scheda lo riceve, così lo
            // stesso ingresso produce sempre lo stesso esito.
            now: new Date().toISOString(),
          });
          setResults((previous) => ({ ...previous, [checkId]: result }));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setRunning(null);
        }
      })();
    },
    [dal, plot, activeCompanyId],
  );

  return { running, error, results, overrides, run, specs };
}
