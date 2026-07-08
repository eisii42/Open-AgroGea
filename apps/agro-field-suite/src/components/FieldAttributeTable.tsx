import { isTauriRuntime } from "@agrogea/core";
import {
  AttributeTable,
  downloadTextVectorLayer,
  type ExpressionSnippet,
} from "@geolibre/attribute-table";
import { useAppStore } from "@geolibre/core";
import type { MapController } from "@geolibre/map";
import { type RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  downloadArtifact,
  serializzaVettoriale,
} from "../services/gis/geo-export";
import { DetachedWindow } from "./DetachedWindow";

/**
 * Preset di espressioni agronomiche per il Field Calculator (Modulo Harvest /
 * gestione del territorio). Inseriti nel calcolatore come chip cliccabili via
 * `insertExpressionSnippet`, così l'agronomo applica una formula validata senza
 * digitarla. Usano l'accesso `props["campo"]` per essere robusti a nomi con
 * spazi/maiuscole e per non dipendere dalla validità del campo come identificatore.
 */
function getAgroExpressionSnippets(t: TFunction): ExpressionSnippet[] {
  return [
    {
      label: t("fieldAttributeTable.plantDensity"),
      expression: 'props["numero_piante"] / props["area_ha"]',
      title: t("fieldAttributeTable.plantDensityFormula"),
    },
    {
      label: t("fieldAttributeTable.yieldTHa"),
      expression: '(props["resa_kg"] / 1000) / props["area_ha"]',
      title: t("fieldAttributeTable.yieldFormula"),
    },
    {
      label: t("fieldAttributeTable.maxOrganicNitrogen"),
      expression: 'props["area_ha"] * 170',
      title: t("fieldAttributeTable.maxOrganicNitrogenFormula"),
    },
  ];
}

/**
 * Tabelle analizzabili dalla tabella attributi. L'utente le sceglie dal selettore
 * in barra; non si attiva più in base al layer selezionato in mappa. Gli id
 * corrispondono ai layer proiettati nello store GeoLibre (vedi useFieldLayers /
 * usePlotsLayer).
 */
function getTableOptions(t: TFunction): { layerId: string; label: string }[] {
  return [
    { layerId: "agrogea-harvests", label: t("fieldAttributeTable.harvests") },
    { layerId: "agrogea-plots", label: t("fieldAttributeTable.plots") },
  ];
}

/**
 * Host campo della tabella attributi condivisa (`@geolibre/attribute-table`).
 * Sceglie le opzioni specifiche di AgroGea:
 *  - selettore esplicito tra le 3 tabelle ammesse (non auto-attivazione per layer);
 *  - schema bloccato: niente add/rename/move/delete colonne né dati — solo
 *    nascondere colonne o modificare celle; il calcolatore deriva solo NUOVI campi;
 *  - niente pulsante Dashboard (non c'è una dashboard host in field-suite);
 *  - "#" e "id" nascosti di default;
 *  - export leggero solo testuale (GeoJSON/CSV) e `deferResize` nella webview Tauri;
 *  - pop-out su una finestra separata (secondo schermo) condividendo lo stato.
 */
export function FieldAttributeTable({
  mapControllerRef,
}: {
  mapControllerRef: RefObject<MapController | null>;
}) {
  const { t } = useTranslation();
  const [detached, setDetached] = useState(false);
  const layers = useAppStore((s) => s.layers);
  const selectedLayerId = useAppStore((s) => s.selectedLayerId);
  const selectLayer = useAppStore((s) => s.selectLayer);

  const tableOptions = getTableOptions(t);

  // All'apertura (o se la selezione non è una delle tabelle ammesse) seleziona la
  // prima tabella disponibile, così la vista parte popolata invece che vuota.
  useEffect(() => {
    const ids = tableOptions.map((o) => o.layerId);
    if (selectedLayerId && ids.includes(selectedLayerId)) return;
    const firstAvailable = tableOptions.find((o) =>
      layers.some((l) => l.id === o.layerId),
    );
    if (firstAvailable) selectLayer(firstAvailable.layerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, selectedLayerId, selectLayer]);

  const table = (
    <AttributeTable
      mapControllerRef={mapControllerRef}
      expressionSnippets={getAgroExpressionSnippets(t)}
      exportFormats={["geojson", "csv", "shapefile"]}
      deferResize={isTauriRuntime()}
      restrictSchemaEditing
      showDashboardButton={false}
      showFeatureIdColumn={false}
      defaultHiddenColumns={["id"]}
      tableOptions={tableOptions}
      detachable
      detached={detached}
      onToggleDetach={() => setDetached((v) => !v)}
      fillContainer={detached}
      exportVectorLayer={(geojson, format, baseName) => {
        if (format === "csv" || format === "geojson") {
          return downloadTextVectorLayer(geojson, format, baseName);
        }
        // Shapefile (.zip): writer puro condiviso col modulo VRA.
        if (format === "shapefile") {
          const artifact = serializzaVettoriale(geojson, "shapefile", baseName);
          downloadArtifact(artifact);
          return Promise.resolve(artifact.filename);
        }
        return Promise.resolve(null);
      }}
    />
  );

  if (detached) {
    return (
      <DetachedWindow
        title={t("fieldAttributeTable.detachedTitle")}
        onClose={() => setDetached(false)}
      >
        {table}
      </DetachedWindow>
    );
  }
  return table;
}
