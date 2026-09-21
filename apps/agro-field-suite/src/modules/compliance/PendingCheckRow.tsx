import { useAgroStore, type Plot } from "@agrogea/core";
import { resolveParameters, type CheckSpec } from "@agrogea/tools";
import { Button } from "@geolibre/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  checkSceneAvailability,
  fetchMissingScenes,
  type SceneAvailability,
} from "./scene-availability";

/**
 * Una scheda non ancora valutata: che cosa osserva, quanto è osservabile, e
 * **che cosa le manca** per pronunciarsi.
 *
 * ## Perché la verifica delle scene sta qui
 *
 * Una scheda che dice "non decidibile: scene insufficienti" senza dire quante
 * ne servono e senza un modo per procurarsele è un vicolo cieco. Qui l'utente
 * interroga il catalogo (che è gratuito e non scarica immagini), vede quante
 * scene esistono per la finestra di QUESTA scheda, quante ne ha già in cache e
 * quante mancano — con i megabyte, stimati dal costo misurato di 0,45 MB per
 * banda per scena — e decide.
 *
 * ## Il riuso non è un dettaglio
 *
 * Il numero mostrato è sempre quello **residuo**: le scene che un'altra scheda
 * ha già scaricato non si ripagano. Dodici schede che guardano l'NDVI della
 * stessa annata costano una volta sola, ed è il motivo per cui conviene
 * verificare prima di scaricare invece di scaricare tutto in blocco.
 */
export function PendingCheckRow({
  spec,
  plot,
  campaignYear,
  busy,
  disabled,
  onRun,
  onScenesFetched,
}: {
  spec: CheckSpec;
  plot: Plot;
  campaignYear: number;
  busy: boolean;
  disabled: boolean;
  onRun: () => void;
  /** Le scene nuove cambiano l'ingresso: il pannello deve ricostruirlo. */
  onScenesFetched: () => void;
}) {
  const { t } = useTranslation();
  const dal = useAgroStore((s) => s.dal);
  const [availability, setAvailability] = useState<SceneAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const [fetching, setFetching] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const satellite = spec.requires.indices.length > 0;

  const verify = async () => {
    if (!dal) return;
    setChecking(true);
    setError(null);
    try {
      setAvailability(
        await checkSceneAvailability(
          dal,
          plot,
          spec,
          campaignYear,
          resolveParameters(spec),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  const download = async () => {
    if (!dal || !availability) return;
    setFetching({ done: 0, total: availability.missing });
    setError(null);
    try {
      await fetchMissingScenes(dal, plot, availability, setFetching);
      // Si rilegge la disponibilità: dopo il download il residuo è zero, e
      // mostrarlo chiude il ciclo invece di lasciare il vecchio numero.
      await verify();
      onScenesFetched();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(null);
    }
  };

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
            {satellite
              ? t("compliance.card.needsImagery", {
                  indices: spec.requires.indices.join(", ").toUpperCase(),
                  years: spec.requires.archiveYears,
                })
              : t("compliance.card.needsNoImagery")}
          </dd>
        </div>
      </dl>

      {/* Verifica e recupero delle scene: solo per le schede che guardano il
          cielo. Per le altre non c'è nulla da scaricare, e mostrare un pulsante
          suggerirebbe il contrario. */}
      {satellite && (
        <div className="flex flex-col gap-1.5 rounded-[var(--r-2)] bg-[var(--panel-2)] px-2 py-1.5">
          {availability ? (
            <p className="text-[11px] text-[var(--ink-3)]">
              {t("compliance.scenes.summary", {
                available: availability.available,
                cached: availability.cached,
                missing: availability.missing,
                from: availability.window.from,
                to: availability.window.to,
              })}
              {availability.missing > 0 && (
                <>
                  {" "}
                  <span className="font-medium text-[var(--warn)]">
                    {t("compliance.scenes.size", {
                      mb: (availability.estimatedBytes / 1048576).toFixed(1),
                    })}
                  </span>
                </>
              )}
            </p>
          ) : (
            <p className="text-[11px] text-[var(--ink-4)]">
              {t("compliance.scenes.hint")}
            </p>
          )}

          {fetching && (
            <p className="text-[11px] text-[var(--accent)]">
              {t("compliance.scenes.downloading", {
                done: fetching.done,
                total: fetching.total,
              })}
            </p>
          )}

          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              className="text-[11px]"
              disabled={checking || fetching != null}
              onClick={() => void verify()}
            >
              {checking
                ? t("compliance.panel.running")
                : t("compliance.scenes.verify")}
            </Button>
            {availability && availability.missing > 0 && (
              <Button
                variant="outline"
                className="text-[11px]"
                disabled={fetching != null}
                onClick={() => void download()}
              >
                {t("compliance.scenes.download", { count: availability.missing })}
              </Button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-[var(--r-2)] bg-[var(--danger-l)] px-2 py-1 text-[11px] text-[var(--danger)]">
          {error}
        </p>
      )}

      <Button
        className="min-h-[var(--touch-min)] self-start"
        variant="outline"
        disabled={disabled || fetching != null}
        onClick={onRun}
      >
        {busy ? t("compliance.panel.running") : t("compliance.panel.runOne")}
      </Button>
    </article>
  );
}
