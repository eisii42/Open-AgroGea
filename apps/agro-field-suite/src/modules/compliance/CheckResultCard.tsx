import type {
  CheckOutcome,
  CheckParameter,
  CheckResult,
  ComplianceMessage,
} from "@agrogea/tools";
import { Input } from "@geolibre/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

/**
 * Una scheda di compliance, con tutto ciò che serve a contestarne il metodo:
 * norma, oggetto osservato, finestra, scene usate, soglie modificabili,
 * incertezza scomposta e serie grezza.
 *
 * L'ordine degli elementi non è estetico. L'esito è in alto perché è ciò che si
 * cerca, ma **la riga dell'autovalutazione gli sta accanto**, non in un
 * tooltip: chi guarda l'esito deve leggere nello stesso colpo d'occhio che non
 * è un controllo ufficiale. Sotto vengono provenienza e incertezza, che sono le
 * ragioni dell'esito; i parametri e la serie sono richiudibili perché servono a
 * chi vuole discutere, non a chi vuole solo sapere.
 */

/** Traduce un messaggio del motore. Le chiavi sono un'unione finita: sono type-checkate. */
function message(t: TFunction, msg: ComplianceMessage): string {
  return t(`compliance.messages.${msg.id}`, msg.values ?? {});
}

const OUTCOME_TONE: Record<CheckOutcome, string> = {
  compliant: "bg-[var(--ok-l)] text-[var(--ok)] border-[var(--ok)]",
  attention: "bg-[var(--warn-l)] text-[var(--warn)] border-[var(--warn)]",
  non_compliant: "bg-[var(--danger-l)] text-[var(--danger)] border-[var(--danger)]",
  // "Non decidibile" è un esito legittimo: colore neutro, mai quello d'errore.
  undecidable: "bg-[var(--panel-2)] text-[var(--ink-3)] border-[var(--line)]",
};

const OUTCOME_ICON: Record<CheckOutcome, string> = {
  compliant: "✓",
  attention: "!",
  non_compliant: "✕",
  undecidable: "?",
};

export interface CheckResultCardProps {
  result: CheckResult;
  /** Salva un override; `null` riporta il parametro al default normativo. */
  onParameterChange: (
    checkId: string,
    parameterId: string,
    value: number | null,
  ) => void;
  /** Rivaluta questa scheda (e solo questa). */
  onRerun: () => void;
  /** Valutazione di questa scheda in corso. */
  busy?: boolean;
  readOnly?: boolean;
}

export function CheckResultCard({
  result,
  onParameterChange,
  onRerun,
  busy = false,
  readOnly = false,
}: CheckResultCardProps) {
  const { t } = useTranslation();
  const [openSection, setOpenSection] = useState<
    "none" | "confidence" | "parameters" | "series" | "scenes"
  >("none");

  const toggle = (section: typeof openSection) =>
    setOpenSection((current) => (current === section ? "none" : section));

  const confidencePct = Math.round(result.confidence.value * 100);

  return (
    <article className="flex flex-col gap-2 rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-3">
      {/* Intestazione: oggetto osservato e norma */}
      <header className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--ink-1)]">
            {message(t, result.subject)}
          </h3>
          <span
            className={
              "shrink-0 rounded-[var(--r-2)] border px-2 py-0.5 text-xs font-semibold " +
              OUTCOME_TONE[result.outcome]
            }
          >
            {OUTCOME_ICON[result.outcome]}{" "}
            {t(`compliance.outcome.${result.outcome}`)}
          </span>
        </div>
        <p className="text-[11px] text-[var(--ink-4)]">
          {result.reference.act}
          {result.reference.provision ? ` · ${result.reference.provision}` : ""}
        </p>
      </header>

      {/* Autovalutazione: accanto all'esito, non in un tooltip. */}
      <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] px-2 py-1 text-[10px] leading-snug text-[var(--ink-4)]">
        {t("compliance.disclaimer.short")}
      </p>

      {/* Spiegazione dell'esito */}
      <p className="text-sm text-[var(--ink-2)]">
        {message(t, result.explanation)}
      </p>

      {/* Che cosa manca, quando manca */}
      {result.missing.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-[var(--r-2)] bg-[var(--panel-2)] p-2">
          {result.missing.map((missing, i) => (
            <li key={i} className="text-[11px] text-[var(--ink-3)]">
              <span className="font-medium">{message(t, missing.what)}</span>
              <span className="text-[var(--ink-4)]">
                {" — "}
                {message(t, missing.howToFix)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Riga di sintesi: osservabilità, finestra, confidenza */}
      <dl className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt className="text-[var(--ink-4)]">{t("compliance.card.observability")}</dt>
          <dd className="font-medium text-[var(--ink-2)]">
            {t(`compliance.observability.${result.observability}`)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--ink-4)]">{t("compliance.card.window")}</dt>
          <dd className="agro-num font-medium text-[var(--ink-2)]">
            {result.window.from} → {result.window.to}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--ink-4)]">{t("compliance.card.confidence")}</dt>
          <dd className="agro-num font-medium text-[var(--ink-2)]">
            {confidencePct}%
          </dd>
        </div>
      </dl>

      {/* Perché la confidenza è quella: i fattori limitanti, in chiaro */}
      {result.confidence.limitedBy.length > 0 && (
        <p className="text-[11px] text-[var(--ink-3)]">
          {t("compliance.card.limitedBy", {
            factors: result.confidence.limitedBy
              .map((id) => t(`compliance.factor.${id}`))
              .join(", "),
          })}
        </p>
      )}

      {/* Sezioni richiudibili */}
      <div className="flex flex-wrap gap-1.5">
        <SectionButton
          label={t("compliance.card.uncertainty")}
          active={openSection === "confidence"}
          onClick={() => toggle("confidence")}
        />
        <SectionButton
          label={t("compliance.card.method")}
          active={openSection === "parameters"}
          onClick={() => toggle("parameters")}
        />
        <SectionButton
          label={t("compliance.card.scenes", { count: result.scenes.length })}
          active={openSection === "scenes"}
          onClick={() => toggle("scenes")}
        />
        {result.series && result.series.points.length > 0 && (
          <SectionButton
            label={t("compliance.card.series")}
            active={openSection === "series"}
            onClick={() => toggle("series")}
          />
        )}
        {/* Rivalutare riguarda QUESTA scheda: le altre non c'entrano con le
            sue soglie né con la sua finestra. */}
        <button
          type="button"
          onClick={onRerun}
          disabled={busy}
          className="rounded-[var(--r-2)] border border-[var(--line)] px-2 py-1 text-[11px] font-medium text-[var(--ink-3)] disabled:opacity-50"
        >
          {busy ? t("compliance.panel.running") : t("compliance.panel.rerunOne")}
        </button>
      </div>

      <p className="text-[10px] text-[var(--ink-4)]">
        {t("compliance.card.computedAt", {
          at: new Date(result.computedAt).toLocaleString("it-IT"),
        })}
      </p>

      {openSection === "confidence" && (
        <ul className="flex flex-col gap-1 rounded-[var(--r-2)] bg-[var(--panel-2)] p-2">
          {result.confidence.factors.map((factor, i) => (
            <li key={`${factor.id}-${i}`} className="flex items-baseline gap-2 text-[11px]">
              <span
                className={
                  "w-10 shrink-0 text-right font-semibold " +
                  (factor.limiting ? "text-[var(--warn)]" : "text-[var(--ink-3)]")
                }
              >
                {Math.round(factor.score * 100)}%
              </span>
              <span className="text-[var(--ink-3)]">
                <span className="font-medium">{t(`compliance.factor.${factor.id}`)}</span>
                {" — "}
                {message(t, factor.observed)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {openSection === "parameters" && (
        <div className="flex flex-col gap-2 rounded-[var(--r-2)] bg-[var(--panel-2)] p-2">
          <p className="text-[11px] text-[var(--ink-3)]">
            {message(t, result.method)}
          </p>
          {result.parameters.map((parameter) => (
            <ParameterRow
              key={parameter.id}
              checkId={result.checkId}
              parameter={parameter}
              readOnly={readOnly}
              onChange={onParameterChange}
            />
          ))}
        </div>
      )}

      {openSection === "scenes" && (
        <div className="max-h-56 overflow-auto rounded-[var(--r-2)] bg-[var(--panel-2)] p-2">
          {result.scenes.length === 0 ? (
            <p className="text-[11px] text-[var(--ink-4)]">
              {t("compliance.card.noScenes")}
            </p>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="text-[var(--ink-4)]">
                <tr>
                  <th className="text-left font-medium">{t("compliance.card.sceneDate")}</th>
                  <th className="text-left font-medium">{t("compliance.card.sceneId")}</th>
                  <th className="text-right font-medium">{t("compliance.card.sceneCloud")}</th>
                  <th className="text-right font-medium">{t("compliance.card.scenePixels")}</th>
                </tr>
              </thead>
              <tbody className="text-[var(--ink-3)]">
                {result.scenes.map((scene) => (
                  <tr key={scene.sceneId}>
                    <td className="agro-num">{scene.sensedAt.slice(0, 10)}</td>
                    <td className="truncate" title={scene.sceneId}>
                      {scene.sceneId}
                    </td>
                    <td className="agro-num text-right">
                      {scene.cloudCoverPct == null
                        ? "—"
                        : `${Math.round(scene.cloudCoverPct)}%`}
                    </td>
                    <td className="agro-num text-right">{scene.validPixels}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {openSection === "series" && result.series && (
        <SeriesInspector series={result.series} />
      )}
    </article>
  );
}

function SectionButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-[var(--r-2)] border px-2 py-1 text-[11px] font-medium " +
        (active
          ? "border-[var(--accent-bd)] bg-[var(--accent-l)] text-[var(--accent)]"
          : "border-[var(--line)] text-[var(--ink-3)]")
      }
    >
      {label}
    </button>
  );
}

/**
 * Una soglia, con il suo default e la norma da cui viene. Modificabile: è il
 * requisito che distingue un modulo consultabile da una scatola nera.
 */
function ParameterRow({
  checkId,
  parameter,
  readOnly,
  onChange,
}: {
  checkId: string;
  parameter: CheckParameter;
  readOnly: boolean;
  onChange: CheckResultCardProps["onParameterChange"];
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(parameter.value));

  const commit = () => {
    const value = Number(draft.replace(",", "."));
    if (!Number.isFinite(value) || value < parameter.min || value > parameter.max) {
      setDraft(String(parameter.value));
      return;
    }
    onChange(checkId, parameter.id, value === parameter.defaultValue ? null : value);
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <label
          htmlFor={`${checkId}-${parameter.id}`}
          className="flex-1 text-[11px] text-[var(--ink-3)]"
        >
          {message(t, parameter.description)}
        </label>
        <Input
          id={`${checkId}-${parameter.id}`}
          className="agro-num w-24"
          type="number"
          inputMode="decimal"
          min={parameter.min}
          max={parameter.max}
          step="any"
          value={draft}
          disabled={readOnly}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
        <span className="w-12 text-[10px] text-[var(--ink-4)]">
          {parameter.unit ?? ""}
        </span>
      </div>
      <p className="text-[10px] text-[var(--ink-4)]">
        {t("compliance.card.parameterDefault", {
          value: parameter.defaultValue,
          source: t(`compliance.parameterSource.${parameter.source}`),
        })}
        {parameter.reference
          ? ` · ${parameter.reference.act}${
              parameter.reference.provision ? `, ${parameter.reference.provision}` : ""
            }`
          : ""}
      </p>
    </div>
  );
}

/**
 * Serie grezza: le date delle scene e i valori dell'indice, in tabella e in uno
 * sparkline SVG. Non è un grafico d'effetto, è la prova: da qui si vede su che
 * cosa poggia la conclusione, e si può non essere d'accordo.
 */
function SeriesInspector({
  series,
}: {
  series: NonNullable<CheckResult["series"]>;
}) {
  const { t } = useTranslation();
  const values = series.points
    .map((p) => p.values[series.index])
    .filter((v): v is number => typeof v === "number");
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 280;
  const height = 60;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const path = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(" ");

  return (
    <div className="flex flex-col gap-2 rounded-[var(--r-2)] bg-[var(--panel-2)] p-2">
      <p className="text-[11px] font-medium text-[var(--ink-3)]">
        {t("compliance.card.seriesTitle", {
          index: series.index.toUpperCase(),
          count: values.length,
        })}
      </p>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-16 w-full min-w-[280px]"
          role="img"
          aria-label={t("compliance.card.seriesTitle", {
            index: series.index.toUpperCase(),
            count: values.length,
          })}
        >
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
        </svg>
      </div>
      <div className="max-h-40 overflow-auto">
        <table className="w-full text-[11px]">
          <tbody className="text-[var(--ink-3)]">
            {series.points.map((point) => {
              const value = point.values[series.index];
              return (
                <tr key={point.sceneId}>
                  <td className="agro-num">{point.date.slice(0, 10)}</td>
                  <td className="agro-num text-right">
                    {typeof value === "number" ? value.toFixed(3) : "—"}
                  </td>
                  <td className="agro-num text-right text-[var(--ink-4)]">
                    {point.cloudCoverPct == null
                      ? "—"
                      : `${Math.round(point.cloudCoverPct)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
