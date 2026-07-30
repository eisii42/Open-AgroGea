import {
  evaluateTaskCompleteness,
  loadOperatorMemory,
  type OperationType,
  persistOperatorMemory,
  type PlannedTask,
  type PlannedTaskMetadata,
  type RecipeDoseUnit,
  useAgroStore,
  useSettingsStore,
  waterUnitLabel,
  type WaterUnit,
} from "@agrogea/core";
import { PAN_PESTS } from "@agrogea/ui";
import { Button, Input, Label, Select } from "@geolibre/ui";
import { AlertTriangle } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { completenessFieldLabel } from "./task-completeness-view";
import { TASK_OPERATION_TYPES, taskFieldSpec } from "./task-field-spec";

export { TASK_OPERATION_TYPES };

/** Etichetta i18n di un tipo operation nel dominio Task/Ricette. */
export function taskOperationLabel(t: TFunction, type: OperationType): string {
  return t(`taskForm.operationType.${type}` as never);
}

/** Unità di dose della semina: le sole per-ettaro (come nelle ricette). */
const SEED_UNITS: RecipeDoseUnit[] = ["kg/ha", "l/ha"];

const numStr = (v: number | null | undefined) => (v == null ? "" : String(v));

/**
 * Form di creazione/modifica di una task programmata (`planned_tasks`).
 *
 * Struttura dati SMART, allineata al Quaderno di Campagna: il tipo di
 * operation si scegle per PRIMO, e da quello discende quali campi compaiono
 * — la specifica è derivata dal registro del Quaderno (vedi
 * `task-field-spec.ts`), non ricopiata, così i due form chiedono sempre le
 * stesse cose. Un tipo mostra soltanto ciò che gli serve: la ricetta esiste
 * solo per fitosanitari e fertilizzazioni, l'avversità solo dove il PAN la
 * pretende (e dalla lista rigorosa {@link PAN_PESTS}, mai a testo libero, come
 * nel Quaderno), la semente solo per la semina, e così via.
 *
 * Ciò che è derivabile non viene chiesto: la ricetta porta con sé prodotti,
 * dosi, n. di registrazione e sostanza attiva; scegliendo una ricetta con una
 * sua avversità bersaglio, quella dell'operazione si compila da sé; l'operatore
 * e il patentino arrivano dalla memoria di dispositivo condivisa col Quaderno.
 * Le quantità totali non compaiono affatto: si calcolano a lavoro fatto sulla
 * superficie realmente percorsa dal GPS.
 *
 * Completezza del futuro record: la chiusura della sessione a bordo campo
 * scriverà il Quaderno SENZA conferma dell'operatore, quindi qui si valuta in
 * diretta — con lo stesso motore del cruscotto "Record incompleti" — se la task
 * produrrebbe un record conforme al PAN, mostrando un avviso NON bloccante.
 */
export function TaskForm({
  existing,
  defaultPlotId,
  onCancel,
  onSaved,
}: {
  /** null/undefined = creazione; valorizzato = modifica. */
  existing?: PlannedTask | null;
  /** Plot pre-selezionato in creazione (click "Pianifica task" sul field in mappa). */
  defaultPlotId?: string;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const plots = useAgroStore((s) => s.plots);
  const crops = useAgroStore((s) => s.crops);
  const campaignFields = useAgroStore((s) => s.campaignFields);
  const recipes = useAgroStore((s) => s.recipes);
  const products = useAgroStore((s) => s.products);
  const savePlannedTask = useAgroStore((s) => s.savePlannedTask);
  const units = useSettingsStore((s) => s.units);

  // Memoria per-device dell'operatore (condivisa col Quaderno, vedi
  // `field/operator-memory.ts`): il patentino non è una colonna di
  // `planned_tasks` — è un dato dell'operatore/dispositivo — e qui si legge
  // solo per precompilare, senza farlo ridigitare se già noto.
  const opMemory = useMemo(loadOperatorMemory, []);
  const meta = existing?.metadata ?? {};

  const [plotId, setPlotId] = useState(existing?.plot_id ?? defaultPlotId ?? "");
  const [operationType, setOperationType] = useState<OperationType | "">(
    existing?.operation_type ?? "",
  );
  const [recipeId, setRecipeId] = useState(existing?.recipe_id ?? "");
  const [targetPestOrDisease, setTargetPestOrDisease] = useState(
    existing?.target_pest_or_disease ?? "",
  );
  const [plannedDate, setPlannedDate] = useState(
    existing?.planned_date ? existing.planned_date.slice(0, 10) : "",
  );
  const [operatorName, setOperatorName] = useState(
    existing?.operator_name ?? opMemory.name ?? "",
  );
  const [licenseNumber, setLicenseNumber] = useState(opMemory.license ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  // -- campi per-tipo (jsonb `metadata`, schema v20) -------------------------
  const [tillageType, setTillageType] = useState(meta.tillage_type ?? "");
  const [irrigationAmount, setIrrigationAmount] = useState(
    numStr(meta.irrigation_amount),
  );
  const [irrigationUnit, setIrrigationUnit] = useState<WaterUnit>(
    meta.irrigation_unit ?? units.water,
  );
  const [seedProductId, setSeedProductId] = useState(meta.seed_product_id ?? "");
  const [seedProductName, setSeedProductName] = useState(
    meta.seed_product_name ?? "",
  );
  const [seedDose, setSeedDose] = useState(numStr(meta.seed_dose));
  const [seedDoseUnit, setSeedDoseUnit] = useState<RecipeDoseUnit>(
    meta.seed_dose_unit ?? "kg/ha",
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Campi pertinenti al tipo scelto: la sola fonte di verità di cosa mostrare.
  const f = taskFieldSpec(operationType);

  const selectedRecipe = recipeId
    ? (recipes.find((r) => r.id === recipeId) ?? null)
    : null;

  /** Ricette compatibili col tipo scelto (mai proposte fuori contesto). */
  const availableRecipes = useMemo(
    () =>
      recipes.filter(
        (r) =>
          r.deleted_at == null &&
          (operationType === "" ||
            r.operation_type == null ||
            r.operation_type === operationType),
      ),
    [recipes, operationType],
  );

  /** Sementi dall'anagrafica di Magazzino (categoria rigida `seed`). */
  const seedProducts = useMemo(
    () => products.filter((p) => p.deleted_at == null && p.category === "seed"),
    [products],
  );

  /**
   * Etichetta di un appezzamento con la sua coltura di campagna, quando c'è:
   * scegliere il campo giusto senza aprire un'altra scheda.
   */
  function plotLabel(plotIdValue: string, name: string, areaHa: number): string {
    const campaign = campaignFields.find(
      (c) => c.plot_id === plotIdValue && c.closed_at == null && c.deleted_at == null,
    );
    const crop = campaign
      ? crops.find((c) => c.id === campaign.crop_id)?.common_name
      : null;
    const base = `${name} · ${areaHa.toFixed(2)} ha`;
    return crop ? `${base} · ${crop}` : base;
  }

  // Anteprima di completezza del futuro record del Quaderno.
  const completeness = useMemo(() => {
    if (operationType === "") return null;
    return evaluateTaskCompleteness(
      {
        plot_id: plotId,
        operation_type: operationType,
        target_pest_or_disease: targetPestOrDisease.trim() || null,
        operator_name: operatorName.trim() || null,
      },
      selectedRecipe,
      {
        operatorName: operatorName.trim() || null,
        operatorLicenseNumber: licenseNumber.trim() || null,
      },
    );
  }, [
    operationType,
    plotId,
    targetPestOrDisease,
    operatorName,
    licenseNumber,
    selectedRecipe,
  ]);
  const blockingMissing =
    completeness?.missing.filter((m) => m.severity === "blocking") ?? [];

  const plotMissing = plotId.trim() === "";
  const operationMissing = operationType === "";
  const invalid = plotMissing || operationMissing;

  /**
   * Cambio di tipo operation: azzera ciò che non appartiene più al nuovo tipo.
   * Senza questo, una ricetta o un'avversità scelte per un fitosanitario
   * resterebbero attaccate a una lavorazione del terreno — invisibili nel form
   * (il campo non si mostra più) ma salvate nel record.
   */
  function handleOperationTypeChange(next: OperationType | "") {
    setOperationType(next);
    const nextSpec = taskFieldSpec(next);
    if (!nextSpec.recipe) setRecipeId("");
    else if (
      recipeId &&
      next !== "" &&
      recipes.find((r) => r.id === recipeId)?.operation_type != null &&
      recipes.find((r) => r.id === recipeId)?.operation_type !== next
    ) {
      setRecipeId("");
    }
    if (!nextSpec.targetDisease) setTargetPestOrDisease("");
    if (!nextSpec.tillageType) setTillageType("");
    if (!nextSpec.irrigationAmount) setIrrigationAmount("");
    if (!nextSpec.seedProduct) {
      setSeedProductId("");
      setSeedProductName("");
      setSeedDose("");
    }
  }

  /**
   * Selezione della ricetta: se la ricetta dichiara la propria avversità
   * bersaglio, la porta con sé — un dato in meno da scegliere, ed è lo stesso
   * che finirebbe nel Quaderno.
   */
  function handleRecipeChange(nextId: string) {
    setRecipeId(nextId);
    const recipe = recipes.find((r) => r.id === nextId);
    if (recipe?.target_disease && !targetPestOrDisease) {
      setTargetPestOrDisease(recipe.target_disease);
    }
  }

  /** Selezione della semente: porta con sé il nome dall'anagrafica. */
  function handleSeedChange(nextId: string) {
    setSeedProductId(nextId);
    const product = seedProducts.find((p) => p.id === nextId);
    if (product) setSeedProductName(product.name);
  }

  /** Metadata da persistere: solo le chiavi pertinenti al tipo scelto. */
  function buildMetadata(): PlannedTaskMetadata {
    const out: PlannedTaskMetadata = {};
    if (f.tillageType && tillageType.trim()) {
      out.tillage_type = tillageType.trim();
    }
    if (f.irrigationAmount && irrigationAmount.trim()) {
      const amount = Number.parseFloat(irrigationAmount);
      if (Number.isFinite(amount) && amount > 0) {
        out.irrigation_amount = amount;
        out.irrigation_unit = irrigationUnit;
      }
    }
    if (f.seedProduct) {
      if (seedProductId) out.seed_product_id = seedProductId;
      if (seedProductName.trim()) out.seed_product_name = seedProductName.trim();
      const dose = Number.parseFloat(seedDose);
      if (Number.isFinite(dose) && dose > 0) {
        out.seed_dose = dose;
        out.seed_dose_unit = seedDoseUnit;
      }
    }
    return out;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitAttempted(true);
    if (saving || invalid) return;
    setSaving(true);
    setError(null);
    try {
      const record = await savePlannedTask({
        id: existing?.id,
        plot_id: plotId,
        operation_type: operationType,
        recipe_id: f.recipe ? recipeId || null : null,
        target_pest_or_disease: f.targetDisease
          ? targetPestOrDisease.trim() || null
          : null,
        planned_date: plannedDate || null,
        operator_name: operatorName.trim() || null,
        notes: notes.trim() || null,
        metadata: buildMetadata(),
      });
      if (!record) return;
      // Memoria operatore (condivisa col Quaderno): l'ultimo operatore/
      // patentino usati precompilano il prossimo form, qui o in OperationForm.
      if (operatorName.trim() || licenseNumber.trim()) {
        persistOperatorMemory({
          ...opMemory,
          name: operatorName.trim() || undefined,
          license: licenseNumber.trim() || undefined,
        });
      }
      onSaved(record.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && (
        <p className="rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}

      {/* Tipo operation PRIMA dell'appezzamento: è la scelta che determina
          tutti i campi successivi, quindi va in cima. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tf-operation">{t("taskForm.operationTypeLabel")}</Label>
          <Select
            id="tf-operation"
            value={operationType}
            onChange={(e) =>
              handleOperationTypeChange(e.target.value as OperationType | "")
            }
          >
            <option value="">{t("taskForm.operationTypePlaceholder")}</option>
            {TASK_OPERATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {taskOperationLabel(t, type)}
              </option>
            ))}
          </Select>
          {submitAttempted && operationMissing && (
            <p className="text-[11px] text-[var(--danger)]">
              {t("taskForm.operationTypeRequired")}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tf-plot">{t("taskForm.plot")}</Label>
          <Select
            id="tf-plot"
            value={plotId}
            onChange={(e) => setPlotId(e.target.value)}
          >
            <option value="">{t("taskForm.plotPlaceholder")}</option>
            {plots
              .filter((p) => p.deleted_at == null)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {plotLabel(p.id, p.user_plot_name, p.area_ha)}
                </option>
              ))}
          </Select>
          {submitAttempted && plotMissing && (
            <p className="text-[11px] text-[var(--danger)]">
              {t("taskForm.plotRequired")}
            </p>
          )}
        </div>
      </div>

      {/* Ricetta: SOLO fitosanitari e fertilizzazioni (gli altri tipi non hanno
          una miscela da preimpostare). Porta con sé prodotti, dosi, n. di
          registrazione e sostanza attiva: nulla di tutto questo va ridigitato. */}
      {f.recipe && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tf-recipe">{t("taskForm.recipe")}</Label>
          <Select
            id="tf-recipe"
            value={recipeId}
            onChange={(e) => handleRecipeChange(e.target.value)}
          >
            <option value="">{t("taskForm.noRecipe")}</option>
            {availableRecipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.products.length > 0
                  ? ` · ${t("taskForm.recipeProductCount", { count: r.products.length })}`
                  : ""}
              </option>
            ))}
          </Select>
          {availableRecipes.length === 0 && (
            <p className="text-[11px] text-[var(--ink-4)]">
              {t("taskForm.noRecipeYet")}
            </p>
          )}
        </div>
      )}

      {/* Avversità: stessa lista rigorosa PAN del Quaderno, mai testo libero. */}
      {f.targetDisease && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tf-target">{t("operationForm.targetPest")}</Label>
          <Select
            id="tf-target"
            value={targetPestOrDisease}
            onChange={(e) => setTargetPestOrDisease(e.target.value)}
          >
            <option value="">{t("operationForm.selectEllipsis")}</option>
            {PAN_PESTS.map((pest) => (
              <option key={pest} value={pest}>
                {pest}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* Lavorazione del terreno: stesso campo del Quaderno. */}
      {f.tillageType && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tf-tillage">
            {t("operationForm.tillageTypeLabel")}
          </Label>
          <Input
            id="tf-tillage"
            value={tillageType}
            onChange={(e) => setTillageType(e.target.value)}
            placeholder={t("operationForm.tillageTypePlaceholder")}
          />
        </div>
      )}

      {/* Irrigazione: apporto in mm (lama d'acqua) o hl (volume), come nel
          Quaderno. Il volume in litri si deriva alla chiusura, sulla superficie
          effettiva: qui si pianifica l'intensità, non il totale. */}
      {f.irrigationAmount && (
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="tf-irr">
              {t("operationForm.irrigationAmount", {
                unit: waterUnitLabel(irrigationUnit),
              })}
            </Label>
            <Input
              id="tf-irr"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={irrigationAmount}
              onChange={(e) => setIrrigationAmount(e.target.value)}
              className="agro-num"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tf-irr-unit">{t("logbook.treatment.unit")}</Label>
            <Select
              id="tf-irr-unit"
              value={irrigationUnit}
              onChange={(e) => setIrrigationUnit(e.target.value as WaterUnit)}
            >
              <option value="mm">{t("operationForm.mmSheet")}</option>
              <option value="hl">{t("operationForm.hlVolume")}</option>
            </Select>
          </div>
        </div>
      )}

      {/* Semina: semente dall'anagrafica di Magazzino (categoria `seed`) +
          dose, come nel Quaderno. Scegliendola dall'anagrafica, il nome viene
          con lei e la semina potrà assegnare la coltura da sé. */}
      {f.seedProduct && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="tf-seed">{t("taskForm.seedProduct")}</Label>
            {seedProducts.length > 0 ? (
              <Select
                id="tf-seed"
                value={seedProductId}
                onChange={(e) => handleSeedChange(e.target.value)}
              >
                <option value="">{t("operationForm.selectEllipsis")}</option>
                {seedProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id="tf-seed"
                value={seedProductName}
                onChange={(e) => setSeedProductName(e.target.value)}
                placeholder={t("taskForm.seedProductPlaceholder")}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:col-span-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tf-seed-dose">{t("logbook.treatment.dose")}</Label>
              <Input
                id="tf-seed-dose"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={seedDose}
                onChange={(e) => setSeedDose(e.target.value)}
                className="agro-num"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tf-seed-unit">{t("logbook.treatment.unit")}</Label>
              <Select
                id="tf-seed-unit"
                value={seedDoseUnit}
                onChange={(e) =>
                  setSeedDoseUnit(e.target.value as RecipeDoseUnit)
                }
              >
                {SEED_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tf-date">{t("taskForm.plannedDate")}</Label>
          <Input
            id="tf-date"
            type="date"
            value={plannedDate}
            onChange={(e) => setPlannedDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tf-operator">{t("taskForm.operatorName")}</Label>
          <Input
            id="tf-operator"
            value={operatorName}
            onChange={(e) => setOperatorName(e.target.value)}
          />
        </div>
        {/* Patentino: solo dove il Quaderno lo pretende (fitosanitari). */}
        {f.licenseNumber && (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="tf-license">
              {t("taskForm.operatorLicenseNumber")}
            </Label>
            <Input
              id="tf-license"
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              className="agro-num"
            />
            <p className="text-[11px] text-[var(--ink-4)]">
              {t("taskForm.operatorLicenseNumberHint")}
            </p>
          </div>
        )}
      </div>

      {blockingMissing.length > 0 && (
        <div className="flex flex-col gap-1 rounded-[var(--r-2)] border border-[var(--warn)] bg-[var(--warn-l)] px-3 py-2 text-xs text-[var(--warn)]">
          <span className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={14} /> {t("taskForm.completenessWarning.title")}
          </span>
          <ul className="list-disc pl-5 text-[var(--ink-2)]">
            {blockingMissing.map((m) => (
              <li key={m.field}>{completenessFieldLabel(t, m.field)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tf-notes">{t("taskForm.notes")}</Label>
        <textarea
          id="tf-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="resize-none rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          type="submit"
          disabled={saving}
          className="min-h-[var(--touch-min)] flex-1"
        >
          {saving ? t("logbook.common.saving") : t("taskForm.save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="min-h-[var(--touch-min)]"
        >
          {t("logbook.common.cancel")}
        </Button>
      </div>
    </form>
  );
}
