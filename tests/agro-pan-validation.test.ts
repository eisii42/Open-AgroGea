import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateFertilizationLog,
  validateTreatmentLog,
  type FertilizationDraft,
  type TreatmentDraft,
} from "../packages/agro-core/src/field/pan-validation";

const validTreatment: TreatmentDraft = {
  operation_date: "2026-05-20",
  target_disease: "Peronospora",
  product_name: "Poltiglia Bordolese",
  registration_number: "12345",
  active_substance: "Rame",
  applied_dose: 3,
  unit_of_measure: "kg/ha",
  operator_license_number: "PAT-9",
};

const validFertilization: FertilizationDraft = {
  operation_date: "2026-03-01",
  fertilizer_type: "minerale",
  commercial_name: "Nitrophoska",
  total_amount_kg: 200,
  npk_ratio: "15-15-15",
};

function fields(errors: { field: string }[]): string[] {
  return errors.map((e) => e.field).sort();
}

describe("PAN validation / treatments fitosanitari", () => {
  it("una bozza completa e valida non produce errori", () => {
    assert.deepEqual(validateTreatmentLog(validTreatment), []);
  });

  it("segnala tutti i campi obbligatori mancanti", () => {
    const errs = validateTreatmentLog({});
    assert.deepEqual(
      fields(errs),
      [
        "active_substance",
        "applied_dose",
        "operation_date",
        "operator_license_number",
        "product_name",
        "registration_number",
        "target_disease",
        "unit_of_measure",
      ].sort(),
    );
  });

  it("rifiuta data in formato non ISO", () => {
    const errs = validateTreatmentLog({ ...validTreatment, operation_date: "20/05/2026" });
    assert.ok(errs.some((e) => e.field === "operation_date" && e.messageKey === "validation.dateFormat"));
  });

  it("rifiuta unità di misura fuori dal set PAN", () => {
    const errs = validateTreatmentLog({ ...validTreatment, unit_of_measure: "sacchi" });
    const u = errs.find((e) => e.field === "unit_of_measure");
    assert.equal(u?.messageKey, "validation.invalidUnit");
    assert.ok(String(u?.params?.allowed).includes("kg/ha"));
  });

  it("rifiuta dose non positiva", () => {
    const errs = validateTreatmentLog({ ...validTreatment, applied_dose: 0 });
    assert.ok(errs.some((e) => e.field === "applied_dose" && e.messageKey === "validation.positiveNumber"));
  });
});

describe("PAN validation / fertilizzazioni", () => {
  it("una bozza completa e valida non produce errori", () => {
    assert.deepEqual(validateFertilizationLog(validFertilization), []);
  });

  it("accetta sia 'minerale' sia 'organic' (IT/EN)", () => {
    assert.deepEqual(validateFertilizationLog({ ...validFertilization, fertilizer_type: "organic" }), []);
  });

  it("rifiuta un tipo concime non valido", () => {
    const errs = validateFertilizationLog({ ...validFertilization, fertilizer_type: "liquido" });
    assert.ok(errs.some((e) => e.field === "fertilizer_type" && e.messageKey === "validation.invalidFertilizerType"));
  });

  it("rifiuta un title NPK mal formato", () => {
    const errs = validateFertilizationLog({ ...validFertilization, npk_ratio: "15/15/15" });
    assert.ok(errs.some((e) => e.field === "npk_ratio" && e.messageKey === "validation.npkFormat"));
  });

  it("accetta un title NPK valido", () => {
    assert.deepEqual(validateFertilizationLog({ ...validFertilization, npk_ratio: "20-10-10" }), []);
  });
});
