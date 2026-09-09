import { useAgroStore, useReadOnly, type ComplianceGroup } from "@agrogea/core";
import type { CheckOutcome, CheckSpec } from "@agrogea/tools";
import { FieldSheet } from "@agrogea/ui";
import { Button, Label, Select } from "@geolibre/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { CheckResultCard } from "./CheckResultCard";
import type { AnalysisCost } from "./check-inputs";
import { buildComplianceReport, reportFilename } from "./compliance-report";
import { useComplianceChecks } from "./useComplianceChecks";

/**
 * Modulo "Normativa": l'autovalutazione delle schede PAC su un appezzamento e
 * un'annata.
 *
 * ## Tre scelte di navigazione, tutte deliberate
 *
 * **L'appezzamento si sceglie qui, non sulla mappa.** Il click su un poligono
 * apre il Quaderno di Campagna e deve continuare a farlo: è il gesto più
 * frequente della giornata di lavoro. Il modulo si sceglie il proprio
 * appezzamento da un elenco che mostra anche la **coltura dichiarata** per
 * l'annata — senza la quale la scelta sarebbe una lista di nomi propri.
 *
 * **Le schede si valutano una alla volta.** Ognuna ha presupposti propri
 * (finestra, indici, annate di archivio): valutarle in blocco chiederebbe
 * l'archivio della più esigente per mostrare venti esiti di cui l'utente ne
 * stava cercando uno. Ogni scheda espone PRIMA che cosa le serve, e si valuta
 * da sé.
 *
 * **Il disclaimer sta in testa**, prima di ogni esito: il controllo ufficiale è
 * l'AMS dell'Organismo Pagatore (Reg. (UE) 2021/2116 art. 66).
 */
export function CompliancePanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const dal = useAgroStore((s) => s.dal);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const activeCampaign = useAgroStore((s) => s.activeCampaign);
  const companies = useAgroStore((s) => s.companies);
  const plots = useAgroStore((s) => s.plots);
  const crops = useAgroStore((s) => s.crops);
  const campaignFields = useAgroStore((s) => s.campaignFields);
  const recordTransfer = useAgroStore((s) => s.recordTransfer);
  const group = useAgroStore((s) => s.complianceGroup);
  const openComplianceGroup = useAgroStore((s) => s.openComplianceGroup);
  const compliancePlotId = useAgroStore((s) => s.compliancePlotId);
  const setCompliancePlotId = useAgroStore((s) => s.setCompliancePlotId);
  const readOnly = useReadOnly(activeCompanyId);
  const [saving, setSaving] = useState(false);

  const plot = plots.find((p) => p.id === compliancePlotId) ?? null;
  const { running, error, results, costs, run, specs } = useComplianceChecks(
    plot,
    activeCampaign,
  );

  /** Appezzamenti con la coltura dichiarata per l'annata attiva, se c'è. */
  const options = useMemo(
    () =>
      plots
        .map((p) => {
          const campaign = campaignFields.find(
            (c) => c.plot_id === p.id && c.campaign_year === activeCampaign,
          );
          const crop = crops.find((c) => c.id === campaign?.crop_id) ?? null;
          return {
            id: p.id,
            label: crop
              ? `${p.user_plot_name} · ${crop.common_name}${
                  crop.variety_name ? ` (${crop.variety_name})` : ""
                }`
              : `${p.user_plot_name} · ${t("compliance.panel.noCrop")}`,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [plots, campaignFields, crops, activeCampaign, t],
  );

  /**
   * Schede della famiglia a schermo. La famiglia la dichiara la scheda
   * (`CheckSpec.group`), non la si indovina dall'id: una scheda di plugin
   * finisce dove ha detto di voler stare.
   */
  const groupSpecs = useMemo(
    () => specs.filter((s) => s.group === group),
    [specs, group],
  );

  const evaluated = groupSpecs
    .map((s) => results[s.id])
    .filter((r): r is NonNullable<typeof r> => r != null);

  const counts = useMemo(() => {
    const out: Record<CheckOutcome, number> = {
      compliant: 0,
      attention: 0,
      non_compliant: 0,
      undecidable: 0,
    };
    for (const result of evaluated) out[result.outcome] += 1;
    return out;
  }, [evaluated]);

  const onParameterChange = async (
    checkId: string,
    parameterId: string,
    value: number | null,
  ) => {
    if (!dal || !activeCompanyId || readOnly) return;
    setSaving(true);
    try {
      if (value == null) {
        await dal.clearComplianceOverride(activeCompanyId, checkId, parameterId);
      } else {
        await dal.setComplianceOverride({
          company_id: activeCompanyId,
          check_id: checkId,
          parameter_id: parameterId,
          value,
        });
      }
      useAgroStore.getState().syncRouter?.notifyLocalWrite();
      // Una soglia cambiata cambia l'esito: si rivaluta QUELLA scheda, non le
      // altre, che con quella soglia non c'entrano.
      run(checkId);
    } finally {
      setSaving(false);
    }
  };

  const allResults = Object.values(results);

  const downloadReport = () => {
    if (!plot) return;
    const company = companies.find((c) => c.id === activeCompanyId);
    // Il report contiene tutte le schede VALUTATE, non solo la famiglia a
    // schermo: chi lo riceve deve vedere il quadro intero.
    const report = buildComplianceReport({
      plot,
      companyName: company?.business_name ?? null,
      campaignYear: activeCampaign,
      results: allResults,
      generatedAt: new Date().toISOString(),
    });
    const fileName = reportFilename(plot, activeCampaign);
    const url = URL.createObjectURL(
      new Blob([report], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    void recordTransfer({
      operation_type: "export",
      file_format: "json",
      file_name: fileName,
    });
  };

  return (
    <FieldSheet
      title={t("compliance.panel.title")}
      onClose={onClose}
      footer={
        allResults.length > 0 ? (
          <Button
            className="min-h-[var(--touch-min)] w-full"
            onClick={downloadReport}
          >
            {t("compliance.panel.exportReport", { count: allResults.length })}
          </Button>
        ) : undefined
      }
    >
      {/* Il disclaimer viene prima di ogni esito, ed è per esteso. */}
      <p className="mb-3 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2 text-[11px] leading-snug text-[var(--ink-3)]">
        {t("compliance.disclaimer.full")}
      </p>

      {/* Famiglia di schede: la sidebar apre già su una, qui si cambia. */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {GROUPS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => openComplianceGroup(id)}
            className={
              "rounded-[var(--r-2)] border px-2 py-1 text-[11px] font-medium " +
              (id === group
                ? "border-[var(--accent-bd)] bg-[var(--accent-l)] text-[var(--accent)]"
                : "border-[var(--line)] text-[var(--ink-3)]")
            }
          >
            {t(`compliance.group.${id}`)}
          </button>
        ))}
      </div>

      {/* Appezzamento + coltura: la scelta è del modulo, non della mappa. */}
      <div className="mb-3">
        <Label htmlFor="compliance-plot">{t("compliance.panel.plot")}</Label>
        <Select
          id="compliance-plot"
          value={compliancePlotId ?? ""}
          onChange={(e) => setCompliancePlotId(e.target.value || null)}
        >
          <option value="">{t("compliance.panel.selectPlot")}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-[10px] text-[var(--ink-4)]">
          {t("compliance.panel.plotHint", { year: activeCampaign })}
        </p>
      </div>

      {plot && (
        <p className="mb-3 text-[11px] text-[var(--ink-4)]">
          {t("compliance.panel.subtitle", {
            year: activeCampaign,
            areaHa: Number(plot.area_ha).toFixed(2),
          })}
        </p>
      )}

      {/* Sintesi della famiglia: conta solo le schede già valutate. */}
      {evaluated.length > 0 && (
        <div className="mb-3 grid grid-cols-4 gap-1.5">
          {(["compliant", "attention", "non_compliant", "undecidable"] as const).map(
            (outcome) => (
              <div
                key={outcome}
                className="rounded-[var(--r-2)] bg-[var(--panel-2)] px-2 py-1.5 text-center"
              >
                <p className="agro-num text-sm font-semibold text-[var(--ink-1)]">
                  {counts[outcome]}
                </p>
                <p className="text-[10px] leading-tight text-[var(--ink-4)]">
                  {t(`compliance.outcome.${outcome}`)}
                </p>
              </div>
            ),
          )}
        </div>
      )}

      {error && (
        <p className="mb-2 rounded-[var(--r-2)] bg-[var(--danger-l)] p-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      {!plot ? (
        <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] p-2 text-sm text-[var(--ink-3)]">
          {t("compliance.panel.selectPlot")}
        </p>
      ) : groupSpecs.length === 0 ? (
        <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] p-2 text-sm text-[var(--ink-3)]">
          {t("compliance.panel.noChecks")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {groupSpecs.map((spec) => {
            const result = results[spec.id];
            return result ? (
              <CheckResultCard
                key={spec.id}
                result={result}
                readOnly={readOnly || saving}
                busy={running === spec.id}
                onRerun={() => run(spec.id)}
                onParameterChange={(checkId, parameterId, value) => {
                  void onParameterChange(checkId, parameterId, value);
                }}
              />
            ) : (
              <PendingCheckRow
                key={spec.id}
                spec={spec}
                cost={costs[spec.id]}
                busy={running === spec.id}
                disabled={running != null}
                onRun={() => run(spec.id)}
                t={t}
              />
            );
          })}
        </div>
      )}
    </FieldSheet>
  );
}

/**
 * Una scheda non ancora valutata: che cosa osserva, quanto è osservabile e
 * **che cosa le serve** per pronunciarsi. È l'informazione che permette di
 * decidere se valutarla adesso — soprattutto quando l'archivio locale non basta
 * e la valutazione comporterebbe di andare in rete.
 */
function PendingCheckRow({
  spec,
  cost,
  busy,
  disabled,
  onRun,
  t,
}: {
  spec: CheckSpec;
  cost: AnalysisCost | undefined;
  busy: boolean;
  disabled: boolean;
  onRun: () => void;
  t: TFunction;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-3">
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-[var(--ink-1)]">
          {t(`compliance.messages.${spec.subject.id}`)}
        </h3>
        <p className="text-[11px] text-[var(--ink-4)]">
          {spec.reference.act}
          {spec.reference.provision ? ` · ${spec.reference.provision}` : ""}
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <dt className="text-[var(--ink-4)]">
            {t("compliance.card.observability")}
          </dt>
          <dd className="font-medium text-[var(--ink-2)]">
            {t(`compliance.observability.${spec.observability}`)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--ink-4)]">{t("compliance.card.needs")}</dt>
          <dd className="font-medium text-[var(--ink-2)]">
            {spec.requires.indices.length === 0
              ? t("compliance.card.needsNoImagery")
              : t("compliance.card.needsImagery", {
                  indices: spec.requires.indices.join(", ").toUpperCase(),
                  years: spec.requires.archiveYears,
                })}
          </dd>
        </div>
      </dl>

      {/* Il costo si dice PRIMA: valutare questa scheda comporta andare in rete? */}
      {cost?.needsNetwork && (
        <p className="rounded-[var(--r-2)] border border-[var(--warn)] bg-[var(--warn-l)] px-2 py-1.5 text-[11px] text-[var(--warn)]">
          {t("compliance.panel.historyCost", {
            years: cost.requiredYears,
            cached: cost.cachedYears,
            scenes: cost.scenesToFetch,
            indices: cost.indices.join(", ").toUpperCase(),
          })}
        </p>
      )}

      <Button
        className="min-h-[var(--touch-min)] self-start"
        variant="outline"
        disabled={disabled}
        onClick={onRun}
      >
        {busy ? t("compliance.panel.running") : t("compliance.panel.runOne")}
      </Button>
    </article>
  );
}

/** Famiglie nell'ordine della sidebar. */
const GROUPS: readonly ComplianceGroup[] = [
  "eligibility",
  "conditionality",
  "ecoSchemes",
  "transversal",
  "organic",
];
