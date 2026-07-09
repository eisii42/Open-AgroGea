import { useAgroStore } from "@agrogea/core";
import type { Polygon, MultiPolygon } from "geojson";
import {
  matchExistingPlot,
  type SianCampoMappato,
} from "../../services/gis/sian-mapping";
import i18n from "../../i18n";

/**
 * Inserimento create-or-populate dei campi del Fascicolo SIAN in PGlite.
 *
 * Per ogni field decodificato:
 *   * se l'appezzamento FISICO non esiste (nessun match per id SIAN) e c'è una
 *     geometria poligonale → crea la row immutabile in `plots`,
 *     marcandone l'id SIAN nei metadata per i re-import futuri;
 *   * se esiste già (perimetria immutata) → ne riusa l'identità;
 *   * in entrambi i casi → popola/update `campi_campagna` sull'anno indicato
 *     con i codici ministeriali e la area dichiarata.
 *
 * I record CSV privi di geometria che non trovano un plot esistente
 * vengono saltati (non si può creare un'entità fisica senza poligono).
 */

export interface SianImportResult {
  creati: number;
  aggiornati: number;
  saltati: number;
}

function isPoligono(g: SianCampoMappato["geometria"]): g is Polygon | MultiPolygon {
  return g != null && (g.type === "Polygon" || g.type === "MultiPolygon");
}

export async function importSianDossier(
  fields: SianCampoMappato[],
  year: number,
): Promise<SianImportResult> {
  const status = useAgroStore.getState();
  const { activeCompanyId } = status;
  const dal = status.dal;
  if (!dal || !activeCompanyId) {
    throw new Error(i18n.t("importDossier.noActiveCompany"));
  }

  // Snapshot mutabile degli plots per abbinare anche le entità create
  // durante questo stesso import (più campi possono condividere l'id fisico).
  const esistenti = status.plots.map((a) => ({
    id: a.id,
    metadata: a.metadata,
  }));

  const outcome: SianImportResult = { creati: 0, aggiornati: 0, saltati: 0 };

  // Cache delle crops (crops) create durante l'import: una specie per chiave
  // naturale (codice crop + codice varietà ministeriali), così rows diverse
  // della stessa crop condividono la stessa entità normalizzata.
  const cropByKey = new Map<string, string>();
  const resolveCropId = async (field: SianCampoMappato): Promise<string> => {
    const key = `${field.crop_external_code ?? ""}|${field.variety_external_code ?? ""}`;
    const esistente = cropByKey.get(key);
    if (esistente) return esistente;
    const crop = await dal.upsertCrop({
      common_name: field.crop_external_code ?? i18n.t("importDossier.sianCrop"),
      scientific_name: null,
      variety_name: field.variety_external_code,
      crop_metadata: {
        origine: "sian-import",
        crop_external_code: field.crop_external_code,
        variety_external_code: field.variety_external_code,
      },
    });
    cropByKey.set(key, crop.id);
    return crop.id;
  };

  for (const field of fields) {
    let plotId = matchExistingPlot(field, esistenti);

    if (!plotId) {
      if (!isPoligono(field.geometria)) {
        outcome.saltati += 1;
        continue;
      }
      const name =
        field.agricultural_parcel_external_id != null
          ? i18n.t("importDossier.sianPlotName", {
              reference: field.reference_parcel_external_id ?? "?",
              parcel: field.agricultural_parcel_external_id,
            })
          : i18n.t("importDossier.sianPlotFallbackName", {
              index: esistenti.length + 1,
            });
      const creato = await dal.upsertPlot({
        id: crypto.randomUUID(),
        company_id: activeCompanyId,
        // L'appezzamento è l'entità FISICA: la crop vive in plots_campaign/crops.
        user_plot_name: name,
        cadastral_sheet: null,
        cadastral_parcel: null,
        last_ndvi_mean: null,
        geometry: field.geometria,
        irrigation_type: null,
        planting_year: null,
        historical_notes: null,
        metadata: {
          origine: "sian-import",
          agricultural_parcel_external_id: field.agricultural_parcel_external_id,
          reference_parcel_external_id: field.reference_parcel_external_id,
        },
      });
      plotId = creato.id;
      esistenti.push({ id: creato.id, metadata: creato.metadata });
      outcome.creati += 1;
    } else {
      outcome.aggiornati += 1;
    }

    await dal.upsertCampoCampagna({
      plot_id: plotId,
      crop_id: await resolveCropId(field),
      campaign_year: year,
      reference_parcel_external_id: field.reference_parcel_external_id,
      agricultural_parcel_external_id: field.agricultural_parcel_external_id,
      crop_external_code: field.crop_external_code,
      variety_external_code: field.variety_external_code,
      declared_area_ha: field.superficie_ha,
    });
  }

  // Allinea l'anno active all'import e reload il dominio (notifica il sync).
  await useAgroStore.getState().setActiveCampaign(year);
  await useAgroStore.getState().refreshDomainData();
  status.syncRouter?.notifyLocalWrite();

  return outcome;
}
