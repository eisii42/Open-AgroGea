import {
  categoryForOperation,
  type OperationType,
  type Recipe,
  type RecipeDoseUnit,
  type RecipeProduct,
  useAgroStore,
} from "@agrogea/core";
import { Button, Input, Label, Select } from "@geolibre/ui";
import { Plus, Trash2 } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TASK_OPERATION_TYPES, taskOperationLabel } from "./TaskForm";

const DOSE_UNITS: RecipeDoseUnit[] = ["kg/ha", "l/ha"];

/** Riga di lavoro del form: campi come stringa (input controllati), non ancora validati. */
interface ProductRowDraft {
  key: string;
  /** FK products se scelto dal Magazzino, "" se testo libero. */
  productId: string;
  productName: string;
  activeSubstance: string;
  registrationNumber: string;
  dosePerHa: string;
  unit: RecipeDoseUnit;
}

function emptyRow(key: string): ProductRowDraft {
  return {
    key,
    productId: "",
    productName: "",
    activeSubstance: "",
    registrationNumber: "",
    dosePerHa: "",
    unit: "kg/ha",
  };
}

function rowsFromRecipe(products: RecipeProduct[]): ProductRowDraft[] {
  if (products.length === 0) return [emptyRow("row-0")];
  return products.map((p, i) => ({
    key: `row-${i}`,
    productId: p.product_id ?? "",
    productName: p.product_name,
    activeSubstance: p.active_substance ?? "",
    registrationNumber: p.registration_number ?? "",
    dosePerHa: String(p.dose_per_ha),
    unit: p.unit,
  }));
}

/**
 * Form di creazione/modifica di una ricetta riutilizzabile (`recipes`): name +
 * tipo operation + avversità/patogeno bersaglio + righe prodotto dinamiche
 * (prodotto da Magazzino, che precompila sostanza attiva/n. registrazione e
 * suggerisce l'unità di dose dall'unità di stock, oppure testo libero) +
 * dose/ha + unità + note.
 */
export function RecipeForm({
  existing,
  onCancel,
  onSaved,
}: {
  /** null/undefined = creazione; valorizzato = modifica. */
  existing?: Recipe | null;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const products = useAgroStore((s) => s.products);
  const saveRecipe = useAgroStore((s) => s.saveRecipe);

  const [name, setName] = useState(existing?.name ?? "");
  const [operationType, setOperationType] = useState<OperationType | "">(
    existing?.operation_type ?? "",
  );
  const [targetDisease, setTargetDisease] = useState(
    existing?.target_disease ?? "",
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [rows, setRows] = useState<ProductRowDraft[]>(() =>
    rowsFromRecipe(existing?.products ?? []),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const nextKey = useRef(rows.length);

  const catalog =
    operationType !== "" ? categoryForOperation(operationType) : null;
  const availableProducts = catalog
    ? products.filter((p) => p.deleted_at == null && p.category === catalog)
    : products.filter((p) => p.deleted_at == null);

  function updateRow(key: string, patch: Partial<ProductRowDraft>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function pickProduct(key: string, productId: string) {
    if (productId === "") {
      updateRow(key, { productId: "", productName: "" });
      return;
    }
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const impliedUnit: RecipeDoseUnit =
      product.unit.trim().toLowerCase() === "l" ? "l/ha" : "kg/ha";
    updateRow(key, {
      productId: product.id,
      productName: product.name,
      activeSubstance: product.active_substance ?? "",
      registrationNumber: product.registration_number ?? "",
      unit: impliedUnit,
    });
  }

  function addRow() {
    nextKey.current += 1;
    setRows((prev) => [...prev, emptyRow(`row-${nextKey.current}`)]);
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  const nameMissing = name.trim() === "";
  const completeRows = rows.filter(
    (r) => r.productName.trim() !== "" && Number(r.dosePerHa) > 0,
  );
  const noCompleteRow = completeRows.length === 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitAttempted(true);
    if (saving || nameMissing || noCompleteRow) return;
    setSaving(true);
    setError(null);
    try {
      const recipeProducts: RecipeProduct[] = completeRows.map((r) => ({
        product_id: r.productId || null,
        product_name: r.productName.trim(),
        dose_per_ha: Number(r.dosePerHa),
        unit: r.unit,
        active_substance: r.activeSubstance.trim() || null,
        registration_number: r.registrationNumber.trim() || null,
      }));
      const record = await saveRecipe({
        id: existing?.id,
        name: name.trim(),
        operation_type: operationType || null,
        products: recipeProducts,
        target_disease: targetDisease.trim() || null,
        notes: notes.trim() || null,
      });
      if (!record) return;
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rf-name">{t("recipeForm.name")}</Label>
          <Input
            id="rf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          {submitAttempted && nameMissing && (
            <p className="text-[11px] text-[var(--danger)]">
              {t("recipeForm.nameRequired")}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rf-operation">{t("recipeForm.operationTypeLabel")}</Label>
          <Select
            id="rf-operation"
            value={operationType}
            onChange={(e) => setOperationType(e.target.value as OperationType | "")}
          >
            <option value="">{t("recipeForm.operationTypePlaceholder")}</option>
            {TASK_OPERATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {taskOperationLabel(t, type)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rf-target">{t("recipeForm.targetDisease")}</Label>
        <Input
          id="rf-target"
          value={targetDisease}
          onChange={(e) => setTargetDisease(e.target.value)}
          placeholder={t("recipeForm.targetDiseasePlaceholder")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>{t("recipeForm.products")}</Label>
          <Button
            type="button"
            variant="outline"
            className="min-h-[36px] gap-1 px-2 text-xs"
            onClick={addRow}
          >
            <Plus size={14} /> {t("recipeForm.addProduct")}
          </Button>
        </div>

        {rows.map((row) => (
          <div
            key={row.key}
            className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2"
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr]">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${row.key}-picker`}>{t("recipeForm.product")}</Label>
                <Select
                  id={`${row.key}-picker`}
                  value={row.productId}
                  onChange={(e) => pickProduct(row.key, e.target.value)}
                >
                  <option value="">{t("recipeForm.freeTextProduct")}</option>
                  {availableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                {row.productId === "" && (
                  <Input
                    value={row.productName}
                    onChange={(e) =>
                      updateRow(row.key, { productName: e.target.value })
                    }
                    placeholder={t("recipeForm.productNamePlaceholder")}
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${row.key}-dose`}>{t("recipeForm.dosePerHa")}</Label>
                  <Input
                    id={`${row.key}-dose`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={row.dosePerHa}
                    onChange={(e) =>
                      updateRow(row.key, { dosePerHa: e.target.value })
                    }
                    className="agro-num"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${row.key}-unit`}>{t("recipeForm.unit")}</Label>
                  <Select
                    id={`${row.key}-unit`}
                    value={row.unit}
                    onChange={(e) =>
                      updateRow(row.key, { unit: e.target.value as RecipeDoseUnit })
                    }
                  >
                    {DOSE_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => removeRow(row.key)}
                disabled={rows.length <= 1}
                aria-label={t("recipeForm.removeProduct")}
                title={t("recipeForm.removeProduct")}
                className="flex h-8 w-8 items-center justify-center rounded-[var(--r-2)] text-[var(--danger)] hover:bg-[var(--danger-l)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {submitAttempted && noCompleteRow && (
          <p className="text-[11px] text-[var(--danger)]">
            {t("recipeForm.productRowRequired")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rf-notes">{t("recipeForm.notes")}</Label>
        <textarea
          id="rf-notes"
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
          {saving ? t("logbook.common.saving") : t("recipeForm.save")}
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
