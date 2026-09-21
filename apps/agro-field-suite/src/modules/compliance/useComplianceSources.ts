import { useAgroStore, type Plot } from "@agrogea/core";
import type { OrthophotoSummary, TerrainSummary } from "@agrogea/tools";
import type { FeatureCollection } from "geojson";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  listOrthophotos,
  subscribeOrthophotos,
  type RegisteredOrthophoto,
} from "../add-data/orthophoto-registry";
import { loadOrthophoto } from "./orthophoto-loader";
import { fetchWaterNetwork, OSM_ATTRIBUTION } from "./osm-water-network";
import { fetchTerrainSummary } from "./terrain-dem";

/**
 * Le tre fonti che le schede non-satellitari si procurano da sole: il DEM per
 * la pendenza (BCAA 5), il reticolo idrografico da OpenStreetMap (BCAA 4) e
 * l'ortofoto caricata dall'utente (BCAA 8).
 *
 * Stanno insieme perché condividono la stessa forma: sono **per appezzamento**,
 * si recuperano su richiesta, e finché non ci sono la scheda corrispondente dice
 * "non decidibile" invece di tacere. Cambiare appezzamento le azzera tutte: un
 * DEM o un reticolo di un altro campo non descrivono questo.
 */

export interface ComplianceSourcesState {
  terrain: TerrainSummary | null;
  waterNetwork: FeatureCollection | null;
  waterNetworkCount: number;
  orthophoto: OrthophotoSummary | null;
  /** Fonte in corso di recupero, o `null`. */
  loading: "terrain" | "water" | "orthophoto" | null;
  error: string | null;
  loadTerrain: () => void;
  loadWaterNetwork: () => void;
  loadOrthophotoFile: (file: File) => void;
  clearOrthophoto: () => void;
  /**
   * Ortofoto già caricate da "Aggiungi dati". Sono lo stesso file: qui si
   * rilegge a piena risoluzione e ritagliato sull'appezzamento, mentre sulla
   * mappa la texture è ridimensionata e non servirebbe a misurare.
   */
  fromMap: RegisteredOrthophoto[];
  attribution: string;
}

export function useComplianceSources(plot: Plot | null): ComplianceSourcesState {
  const [terrain, setTerrain] = useState<TerrainSummary | null>(null);
  const [waterNetwork, setWaterNetwork] = useState<FeatureCollection | null>(null);
  const [orthophoto, setOrthophoto] = useState<OrthophotoSummary | null>(null);
  const [loading, setLoading] = useState<ComplianceSourcesState["loading"]>(null);
  const [error, setError] = useState<string | null>(null);

  // Le fonti descrivono UN appezzamento: al cambio si azzerano, altrimenti la
  // pendenza del campo precedente finirebbe nell'esito di questo.
  useEffect(() => {
    setTerrain(null);
    setWaterNetwork(null);
    setOrthophoto(null);
    setError(null);
    setLoading(null);
  }, [plot?.id]);

  const loadTerrain = useCallback(() => {
    if (!plot) return;
    setLoading("terrain");
    setError(null);
    void (async () => {
      try {
        const summary = await fetchTerrainSummary(plot.geometry);
        setTerrain(summary);
        if (!summary) setError("Il DEM non copre questo appezzamento.");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(null);
      }
    })();
  }, [plot]);

  const loadWaterNetwork = useCallback(() => {
    if (!plot) return;
    setLoading("water");
    setError(null);
    void (async () => {
      try {
        const result = await fetchWaterNetwork(plot.geometry);
        setWaterNetwork(result.fc);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(null);
      }
    })();
  }, [plot]);

  const loadOrthophotoFile = useCallback(
    (file: File) => {
      if (!plot) return;
      setLoading("orthophoto");
      setError(null);
      void (async () => {
        try {
          setOrthophoto(await loadOrthophoto(file, plot.geometry));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setLoading(null);
        }
      })();
    },
    [plot],
  );

  const clearOrthophoto = useCallback(() => setOrthophoto(null), []);

  // Il registro è di sessione e cambia quando l'utente carica da "Aggiungi
  // dati": si sottoscrive invece di rileggerlo a ogni render.
  const fromMap = useSyncExternalStore(subscribeOrthophotos, listOrthophotos);

  return {
    terrain,
    waterNetwork,
    waterNetworkCount: waterNetwork?.features.length ?? 0,
    orthophoto,
    loading,
    error,
    loadTerrain,
    loadWaterNetwork,
    loadOrthophotoFile,
    clearOrthophoto,
    fromMap,
    attribution: OSM_ATTRIBUTION,
  };
}

/** Pulizia della cache degli indici, per il pulsante in fondo al pannello. */
export function useIndexCacheMaintenance(plotId: string | null) {
  const dal = useAgroStore((s) => s.dal);
  const [stats, setStats] = useState<{
    scenes: number;
    approximateBytes: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!dal) return;
    void dal
      .vegetationIndexCacheStats()
      .then((s) => setStats({ scenes: s.scenes, approximateBytes: s.approximateBytes }));
  }, [dal]);

  useEffect(() => refresh(), [refresh, plotId]);

  const clear = useCallback(
    async (scope: "plot" | "all") => {
      if (!dal) return 0;
      setBusy(true);
      try {
        const removed = await dal.clearVegetationIndexCache(
          scope === "plot" ? plotId ?? undefined : undefined,
        );
        refresh();
        return removed;
      } finally {
        setBusy(false);
      }
    },
    [dal, plotId, refresh],
  );

  return { stats, busy, clear, refresh };
}
