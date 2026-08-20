import {
  type IssueRequest,
  type MachineUsageRequest,
  type OperationType,
  declarativeSystem,
  missingDeclarative,
  useAgroStore,
} from "@agrogea/core";
import type { FieldCampaignOption, TreatmentFormValues } from "@agrogea/ui";
import { cn } from "@geolibre/ui";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCountryCatalog } from "../../hooks/useTenantCountry";
import { useGeoCompliance } from "../compliance/useGeoCompliance";
import {
  type CropAssignment,
  OPERATIONS,
  OperationForm,
} from "../field-logbook/OperationForm";

/**
 * Registrazione di un'operazione PASSATA dal Calendario: stesso form del
 * Quaderno di Campagna (`OperationForm`), stesso salvataggio
 * (`recordTreatment` + scarico magazzino atomico + assegnazione coltura alla
 * semina) — solo con la data precompilata sul giorno cliccato.
 *
 * Riusa il form invece di riscriverne uno semplificato: un registro di
 * rilevanza legale non può avere due porte d'ingresso con regole diverse.
 */
export function CalendarOperationDialog({
  day,
  defaultPlotId,
  onClose,
}: {
  /** Giorno "YYYY-MM-DD" su cui registrare. */
  day: string;
  defaultPlotId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const plots = useAgroStore((s) => s.plots);
  const campaignFields = useAgroStore((s) => s.campaignFields);
  const products = useAgroStore((s) => s.products);
  const lots = useAgroStore((s) => s.lots);
  const machines = useAgroStore((s) => s.machines);
  const equipment = useAgroStore((s) => s.equipment);
  const recordTreatment = useAgroStore((s) => s.recordTreatment);
  const saveSoilSample = useAgroStore((s) => s.saveSoilSample);
  const saveCrop = useAgroStore((s) => s.saveCrop);
  const savePlotCampaign = useAgroStore((s) => s.savePlotCampaign);
  const activeCampaign = useAgroStore((s) => s.activeCampaign);
  const valutaCompliance = useGeoCompliance();
  const { items: phytoCatalog, countryCode } = useCountryCatalog("phytosanitary");
  const { items: fertilizerCatalog } = useCountryCatalog("fertilizer");

  const [operationType, setOperationType] = useState<OperationType | null>(null);

  const campaignFieldOptions = useMemo<FieldCampaignOption[]>(
    () =>
      campaignFields
        .filter((c) => c.closed_at == null && c.deleted_at == null)
        .map((c) => {
          const base =
            plots.find((p) => p.id === c.plot_id)?.user_plot_name ??
            t("logbookPanel.fieldFallbackName", { id: c.plot_id.slice(0, 6) });
          const system = declarativeSystem(countryCode);
          const declarativeMissing =
            system != null && missingDeclarative(countryCode, c).length > 0;
          return {
            fieldCampaignId: c.id,
            plotId: c.plot_id,
            name: declarativeMissing ? `${base} · ${system} ✗` : base,
            codiceColturaSian: c.crop_external_code,
            superficieHa: c.declared_area_ha,
          };
        }),
    [campaignFields, plots, countryCode, t],
  );

  // Stesso salvataggio del Quaderno, inclusa l'automazione semina → coltura.
  async function handleSubmit(
    values: TreatmentFormValues,
    issues?: IssueRequest[],
    assignment?: CropAssignment | null,
    machineUsages?: MachineUsageRequest[],
  ) {
    await recordTreatment(values, issues, machineUsages);
    if (assignment) {
      const crop = await saveCrop({
        common_name: assignment.species,
        scientific_name: assignment.scientificName,
        variety_name: assignment.varietyName,
        crop_metadata: {
          category: assignment.cropCategory,
          ...(assignment.densitaSemina != null
            ? { densita_semina: assignment.densitaSemina }
            : {}),
        },
      });
      if (crop) {
        await savePlotCampaign({
          plot_id: assignment.plotId,
          crop_id: crop.id,
          campaign_year: activeCampaign,
          declared_area_ha: assignment.declaredAreaHa,
          reference_parcel_external_id: null,
          agricultural_parcel_external_id: null,
          crop_external_code: null,
          variety_external_code: null,
        });
      }
    }
    onClose();
  }

  async function handleSubmitSoil(input: Parameters<typeof saveSoilSample>[0]) {
    await saveSoilSample(input);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="my-auto flex w-full max-w-[640px] flex-col rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">
              {t("calendar.addOperationTitle")}
            </h3>
            <p className="text-[11px] text-[var(--ink-3)]">{day}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("logbook.common.cancel")}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-4)] hover:bg-[var(--panel-2)]"
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-4">
          {operationType == null ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-[var(--ink-3)]">
                {t("logbookPanel.chooser.description")}
              </p>
              {OPERATIONS.map((operation) => (
                <button
                  key={operation.type}
                  type="button"
                  onClick={() => setOperationType(operation.type)}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-[var(--r-2)] border border-[var(--line)] px-3 py-2 text-left",
                    "hover:border-[var(--accent)] hover:bg-[var(--panel-2)]",
                  )}
                >
                  <span className="text-sm font-medium">{operation.label}</span>
                  <span className="text-[11px] text-[var(--ink-3)]">
                    {operation.descr}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <OperationForm
              operationType={operationType}
              plots={plots}
              campaignFields={campaignFieldOptions}
              prodottiCatalogo={phytoCatalog}
              concimiCatalogo={fertilizerCatalog}
              prodottiMagazzino={products}
              lottiMagazzino={lots}
              machines={machines}
              equipment={equipment}
              valutaCompliance={valutaCompliance}
              defaultAppezzamentoId={defaultPlotId ?? null}
              defaultDate={day}
              onSubmit={handleSubmit}
              onSubmitSoil={handleSubmitSoil}
              onCancel={() => setOperationType(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
