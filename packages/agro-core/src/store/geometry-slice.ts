import { v4 as uuidv4 } from "uuid";
import {
  assertWritable,
  MAX_GEOMETRY_HISTORY,
  persistGeometryToDal,
} from "./helpers";
import type { GeometrySlice, StoreGet, StoreSet } from "./state";

/** Slice geometrie: disegno, selezione in mappa, editing nativo e undo/redo. */
export function createGeometrySlice(
  set: StoreSet,
  get: StoreGet,
): GeometrySlice {
  return {
    pendingGeometry: null,
    drawIntent: null,
    selectedFeature: null,
    geomEdit: null,
    geomEditRequest: null,
    geometryUndo: [],
    geometryRedo: [],

    saveDrawnPlot: async (geometria, attrs = {}) => {
      assertWritable(get);
      const { dal, activeCompanyId, syncRouter, plots } = get();
      if (!dal || !activeCompanyId) return null;
      // L'area geodetica (area_ha) è calcolata dal DAL dalla geometria.
      const record = await dal.upsertPlot({
        id: attrs.id ?? uuidv4(),
        company_id: activeCompanyId,
        user_plot_name: attrs.name ?? `Plot ${plots.length + 1}`,
        cadastral_sheet: attrs.cadastral_sheet ?? null,
        cadastral_parcel: attrs.cadastral_parcel ?? null,
        last_ndvi_mean: null,
        geometry: geometria,
        irrigation_type: attrs.irrigation_type ?? null,
        planting_year: attrs.planting_year ?? null,
        historical_notes: null,
        metadata: { origine: "geo-editor" },
      });
      set((s) => {
        const others = s.plots.filter((a) => a.id !== record.id);
        return { plots: [...others, record] };
      });
      syncRouter?.notifyLocalWrite();
      return record;
    },

    saveDrawnAsset: async (geometria, attrs = {}) => {
      assertWritable(get);
      const { dal, activeCompanyId, syncRouter } = get();
      if (!dal || !activeCompanyId) return null;
      const record = await dal.upsertAsset({
        id: attrs.id ?? uuidv4(),
        company_id: activeCompanyId,
        asset_type: attrs.asset_type ?? "generico",
        category: attrs.category ?? "fixed",
        name: attrs.name ?? null,
        geometry: geometria,
        attributes: attrs.attributes ?? {},
        length_m: attrs.length_m ?? null,
        area_ha: null,
      });
      set((s) => ({
        assets: [...s.assets.filter((a) => a.id !== record.id), record],
      }));
      syncRouter?.notifyLocalWrite();
      return record;
    },

    setPendingGeometry: (pending) => set({ pendingGeometry: pending }),

    clearPendingGeometry: () => set({ pendingGeometry: null }),

    setDrawIntent: (kind) =>
      // Avviare un disegno chiude la scheda di dettaglio eventualmente aperta:
      // creazione e selezione non coesistono.
      set(kind ? { drawIntent: kind, selectedFeature: null } : { drawIntent: kind }),

    selectFeatureOnMap: async (ref) => {
      set({ selectedFeature: ref });
      // L'appezzamento selezionato pilota anche le schede analitiche (NDVI/crop).
      if (ref?.kind === "appezzamento") {
        await get().selectPlot(ref.id);
      }
    },

    clearSelectedFeature: () => set({ selectedFeature: null }),

    startGeometryEdit: (kind, id) =>
      set({ geomEdit: { kind, id }, geomEditRequest: null }),

    requestSaveGeometry: () =>
      set((s) => (s.geomEdit ? { geomEditRequest: "save" } : s)),

    requestCancelGeometry: () =>
      set((s) => (s.geomEdit ? { geomEditRequest: "cancel" } : s)),

    finishGeometryEdit: () => set({ geomEdit: null, geomEditRequest: null }),

    applyEditedGeometry: async (geometry) => {
      assertWritable(get);
      const { geomEdit } = get();
      if (!geomEdit) return;
      const outcome = await persistGeometryToDal(
        get,
        set,
        geomEdit.kind,
        geomEdit.id,
        geometry,
      );
      if (outcome) {
        set((s) => ({
          geometryUndo: [
            ...s.geometryUndo,
            { kind: geomEdit.kind, id: geomEdit.id, before: outcome.before, after: geometry },
          ].slice(-MAX_GEOMETRY_HISTORY),
          geometryRedo: [],
        }));
      }
      set({ geomEdit: null, geomEditRequest: null });
    },

    undoGeometry: async () => {
      assertWritable(get);
      const stack = get().geometryUndo;
      const snap = stack[stack.length - 1];
      if (!snap) return;
      await persistGeometryToDal(get, set, snap.kind, snap.id, snap.before);
      set((s) => ({
        geometryUndo: s.geometryUndo.slice(0, -1),
        geometryRedo: [...s.geometryRedo, snap],
      }));
    },

    redoGeometry: async () => {
      assertWritable(get);
      const stack = get().geometryRedo;
      const snap = stack[stack.length - 1];
      if (!snap) return;
      await persistGeometryToDal(get, set, snap.kind, snap.id, snap.after);
      set((s) => ({
        geometryRedo: s.geometryRedo.slice(0, -1),
        geometryUndo: [...s.geometryUndo, snap],
      }));
    },

    deleteElement: async (kind, id) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal) return;
      if (kind === "appezzamento") {
        await dal.deletePlot(id);
        set((s) => ({ plots: s.plots.filter((a) => a.id !== id) }));
      } else if (kind === "infrastruttura") {
        await dal.deleteAsset(id);
        set((s) => ({ assets: s.assets.filter((a) => a.id !== id) }));
      } else {
        await dal.deleteSoilSample(id);
        set((s) => ({
          soilSamples: s.soilSamples.filter((c) => c.id !== id),
        }));
      }
      syncRouter?.notifyLocalWrite();
      set((s) => ({
        selectedFeature:
          s.selectedFeature?.id === id ? null : s.selectedFeature,
        geomEdit: s.geomEdit?.id === id ? null : s.geomEdit,
        selectedPlotId:
          s.selectedPlotId === id
            ? null
            : s.selectedPlotId,
      }));
    },

    updatePlot: async (id, patch) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal) return;
      const existing = get().plots.find((a) => a.id === id);
      if (!existing) return;
      const record = await dal.upsertPlot({ ...existing, ...patch });
      set((s) => ({
        plots: [
          ...s.plots.filter((a) => a.id !== record.id),
          record,
        ],
      }));
      syncRouter?.notifyLocalWrite();
    },

    updateAsset: async (id, patch) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal) return;
      const existing = get().assets.find((a) => a.id === id);
      if (!existing) return;
      const record = await dal.upsertAsset({ ...existing, ...patch });
      set((s) => ({
        assets: [...s.assets.filter((a) => a.id !== record.id), record],
      }));
      syncRouter?.notifyLocalWrite();
    },
  };
}
