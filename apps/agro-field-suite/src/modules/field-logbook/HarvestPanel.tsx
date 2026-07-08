import {
  missingDeclarative,
  type Harvest,
  declarativeSystem,
  useAgroStore,
} from "@agrogea/core";
import { FieldSheet } from "@agrogea/ui";
import { Button, Input, Label, Select } from "@geolibre/ui";
import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useTenantCountry } from "../../hooks/useTenantCountry";
import { ConfirmDeleteOperation } from "./ConfirmDeleteOperation";
import { HarvestDetailCard } from "./HarvestDetailCard";

/**
 * Modulo Harvest: lista degli eventi di harvest + form di registrazione. Ogni
 * insert passa da `saveHarvest` (PGlite + outbox nella stessa transazione) e
 * idrata lo store; il layer "Raccolte" e i grafici della tabella attributi
 * (Barre: somma/media di `quantita_kg` per `cultivar`/`destinazione`) si
 * aggiornano di conseguenza.
 */

const DESTINAZIONE_IDS = [
  "vinificazione",
  "mensa",
  "industria",
  "olio",
  "conferimento",
  "essiccazione",
] as const;

function getDestinazioni(t: TFunction): { id: string; label: string }[] {
  return DESTINAZIONE_IDS.map((id) => ({
    id,
    label: t(`raccoltaPanel.destinations.${id}`),
  }));
}

function oggiInputDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function HarvestPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const harvests = useAgroStore((s) => s.harvests);
  const plots = useAgroStore((s) => s.plots);
  const campaignFields = useAgroStore((s) => s.campaignFields);
  const crops = useAgroStore((s) => s.crops);
  const activeCampaign = useAgroStore((s) => s.activeCampaign);
  const saveHarvest = useAgroStore((s) => s.saveHarvest);
  const deleteHarvest = useAgroStore((s) => s.deleteHarvest);
  const closeCampaign = useAgroStore((s) => s.closeCampaign);
  const openCropForPlot = useAgroStore(
    (s) => s.openCropForPlot,
  );
  const sync = useAgroStore((s) => s.sync);
  // Compliance dichiarativa: il paese risolto sceglie il sistema (IT → SIAN,
  // ES → SIEX/CUE); gli altri paesi non hanno gate.
  const { countryCode } = useTenantCountry();
  const sistema = declarativeSystem(countryCode);

  const [daEliminare, setDaEliminare] = useState<Harvest | null>(null);
  const [notifica, setNotifica] = useState<string | null>(null);
  // Harvest aperta in scheda dettaglio (modale centrale di sola reading).
  const [dettaglio, setDettaglio] = useState<Harvest | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [appId, setAppId] = useState("");
  const [cultivar, setCultivar] = useState("");
  const [destinazione, setDestinazione] = useState("");
  // Quantità in QUINTALI (q): convertita in kg per la persistenza (1 q = 100 kg).
  const [quintali, setQuintali] = useState("");
  const [destinazioneLotto, setDestinazioneLotto] = useState("");
  const [data, setData] = useState(oggiInputDate());
  const [saving, setSaving] = useState(false);

  const quintaliNum = quintali.trim() === "" ? null : Number(quintali);
  const validQuintals = quintaliNum == null || Number.isFinite(quintaliNum);

  // -- ciclo colturale (v17): campagna APERTA del field scelto ---------------
  const openField = useMemo(
    () =>
      appId
        ? campaignFields.find(
            (c) =>
              c.plot_id === appId &&
              c.deleted_at == null &&
              c.closed_at == null,
          ) ?? null
        : null,
    [campaignFields, appId],
  );
  const fieldCrop = useMemo(
    () =>
      openField
        ? crops.find((c) => c.id === openField.crop_id) ?? null
        : null,
    [crops, openField],
  );
  // Solo le ANNUALI si chiudono col raccolto (le perenni restano in field).
  const fieldCategory =
    typeof fieldCrop?.crop_metadata?.["category"] === "string"
      ? (fieldCrop.crop_metadata["category"] as string)
      : null;
  const isAnnuale =
    fieldCategory === "seminativo" || fieldCategory === "orticoltura";
  const [chiudi, setChiudi] = useState(false);

  // Al cambio field: proponi la chiusura per le annuali e precompila la
  // cultivar dalla crop di campagna (se il field cultivar è ancora vuoto).
  useEffect(() => {
    setChiudi(isAnnuale);
    if (fieldCrop) {
      const label = fieldCrop.variety_name ?? fieldCrop.common_name;
      setCultivar((current) => current || label);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, isAnnuale, fieldCrop?.id]);

  // -- compliance dichiarativa (SIAN/SIEX): campi mancanti sulla campagna -----
  // Gate consapevole, non blocco duro: senza dati dichiarativi il salvataggio
  // richiede la spunta esplicita "Registra comunque" (o la compilazione via CTA).
  const mancantiSian = useMemo(
    () => (openField ? missingDeclarative(countryCode, openField) : []),
    [countryCode, openField],
  );
  const [senzaSian, setSenzaSian] = useState(false);
  useEffect(() => {
    setSenzaSian(false); // ogni cambio field richiede una nuova scelta esplicita
  }, [appId]);
  const sianOk = mancantiSian.length === 0 || senzaSian;

  const canSubmit = data !== "" && validQuintals && sianOk && !saving;

  /** Etichette leggibili dei campi mancanti, nella semantica del paese. */
  const etichetteMancanti = mancantiSian
    .map((field) => t(`raccoltaPanel.declField.${countryCode}.${field}` as never))
    .join(", ");

  // Badge "SIAN/SIEX ✗" nel selettore: campi con campagna aperta ma
  // dichiarativi incompleti — visibili PRIMA di arrivare al salvataggio.
  const plotsSianIncompleti = useMemo(() => {
    const out = new Set<string>();
    if (!sistema) return out;
    for (const c of campaignFields) {
      if (
        c.deleted_at == null &&
        c.closed_at == null &&
        missingDeclarative(countryCode, c).length > 0
      ) {
        out.add(c.plot_id);
      }
    }
    return out;
  }, [sistema, countryCode, campaignFields]);

  function resetForm() {
    setAppId("");
    setCultivar("");
    setDestinazione("");
    setQuintali("");
    setDestinazioneLotto("");
    setData(oggiInputDate());
  }

  // Notifica transitoria (auto-dismiss dopo l'avvenuta rimozione).
  useEffect(() => {
    if (!notifica) return;
    const t = setTimeout(() => setNotifica(null), 3500);
    return () => clearTimeout(t);
  }, [notifica]);

  function harvestLabel(r: Harvest): string {
    const data = new Date(r.harvested_at).toLocaleDateString("it-IT");
    return `${r.cultivar ?? t("raccoltaPanel.harvestFallbackLabel")} · ${data}`;
  }

  async function confirmDeletion() {
    if (!daEliminare) return;
    const label = harvestLabel(daEliminare);
    await deleteHarvest(daEliminare.id);
    setDaEliminare(null);
    setNotifica(t("raccoltaPanel.removedNotice", { label: label }));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await saveHarvest({
        plot_id: appId || null,
        // Aggancio alla campagna APERTA del field (le chiuse sono storia).
        plot_campaign_id: openField?.id ?? null,
        cultivar: cultivar.trim() || null,
        destination_logistics: destinazione.trim() || null,
        // Quintali → kg per la persistenza (la metrica aggregata resta in kg).
        quantity_kg: quintaliNum != null ? quintaliNum * 100 : null,
        harvested_at: new Date(`${data}T12:00:00`).toISOString(),
        metadata: destinazioneLotto.trim()
          ? { destinazione_lotto: destinazioneLotto.trim() }
          : {},
      });
      // v17: il raccolto di un'annuale chiude il ciclo colturale — il field
      // torna libero (mappa neutra, DSS spento, nuova semina possibile).
      if (chiudi && openField) {
        await closeCampaign(openField.id);
      }
      resetForm();
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  const destinazioni = getDestinazioni(t);

  return (
    <FieldSheet
      title={showForm ? t("raccoltaPanel.newHarvest") : t("raccoltaPanel.title")}
      onClose={onClose}
      footer={
        showForm ? undefined : (
          <Button
            className="min-h-[var(--touch-min)] w-full"
            onClick={() => setShowForm(true)}
          >
            {t("raccoltaPanel.newHarvest")}
          </Button>
        )
      }
    >
      {/* Notifica transitoria di avvenuta rimozione. */}
      {notifica && !showForm && (
        <div
          role="status"
          className="mb-3 rounded-[var(--r-2)] border border-[var(--ok)] bg-[var(--ok-l,#dcfce7)] px-3 py-2 text-xs text-[var(--ok)]"
        >
          {notifica}
        </div>
      )}
      {showForm ? (
        <div className="flex flex-col gap-3">
          <div>
            <Label htmlFor="rac-app">{t("logbook.common.plot")}</Label>
            <Select
              id="rac-app"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
            >
              <option value="">{t("logbook.common.wholeFarm")}</option>
              {plots.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.user_plot_name}
                  {plotsSianIncompleti.has(a.id) ? ` · ${sistema} ✗` : ""}
                </option>
              ))}
            </Select>
          </div>

          {/* Compliance dichiarativa (SIAN/SIEX): campi mancanti sulla campagna
              del field scelto. CTA per completare subito o override consapevole. */}
          {mancantiSian.length > 0 && (
            <div className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--warn)] bg-[var(--warn-l)] px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--warn)]">
                {t("raccoltaPanel.sianMissingTitle", { system: sistema })}
              </p>
              <p className="text-xs text-[var(--ink-2)]">
                {t("raccoltaPanel.sianMissingHint", {
                  fields: etichetteMancanti,
                  system: sistema,
                })}
              </p>
              <Button
                type="button"
                variant="outline"
                className="min-h-[36px] self-start px-2 text-xs"
                onClick={() => openCropForPlot(appId)}
              >
                {t("raccoltaPanel.sianCompleteNow")}
              </Button>
              <label className="flex items-center gap-2 text-xs text-[var(--ink-2)]">
                <input
                  type="checkbox"
                  checked={senzaSian}
                  onChange={(e) => setSenzaSian(e.target.checked)}
                  className="h-4 w-4 accent-[var(--warn)]"
                />
                {t("raccoltaPanel.sianOverride", { system: sistema })}
              </label>
            </div>
          )}
          <div>
            <Label htmlFor="rac-cultivar">{t("raccoltaPanel.cultivar")}</Label>
            <Input
              id="rac-cultivar"
              value={cultivar}
              placeholder={t("raccoltaPanel.cultivarPlaceholder")}
              onChange={(e) => setCultivar(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="rac-dest">{t("raccoltaPanel.destination")}</Label>
            <Select
              id="rac-dest"
              value={destinazione}
              onChange={(e) => setDestinazione(e.target.value)}
            >
              <option value="">{t("raccoltaPanel.destinationUnspecified")}</option>
              {destinazioni.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="rac-lotto">{t("raccoltaPanel.lotDestination")}</Label>
            <Input
              id="rac-lotto"
              value={destinazioneLotto}
              placeholder={t("raccoltaPanel.lotDestinationPlaceholder")}
              onChange={(e) => setDestinazioneLotto(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="rac-qta">{t("raccoltaPanel.quantity")}</Label>
              <Input
                id="rac-qta"
                type="number"
                inputMode="decimal"
                min="0"
                value={quintali}
                placeholder="0"
                aria-invalid={!validQuintals || undefined}
                onChange={(e) => setQuintali(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="rac-data">{t("raccoltaPanel.harvestDate")}</Label>
              <Input
                id="rac-data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
          </div>
          {quintaliNum != null && validQuintals && (
            <p className="text-xs text-[var(--ink-4)]">
              = {(quintaliNum * 100).toLocaleString("it-IT")} kg
            </p>
          )}
          {!validQuintals && (
            <p className="text-xs text-[var(--danger)]">
              {t("raccoltaPanel.quantityMustBeNumber")}
            </p>
          )}

          {/* v17: chiusura del ciclo colturale al raccolto (solo campagne
              aperte; proposta pre-attiva per le annuali). */}
          {openField && fieldCrop && (
            <label className="flex items-start gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2">
              <input
                type="checkbox"
                checked={chiudi}
                onChange={(e) => setChiudi(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {t("raccoltaPanel.closeCampaign", {
                    crop: fieldCrop.variety_name
                      ? `${fieldCrop.common_name} (${fieldCrop.variety_name})`
                      : fieldCrop.common_name,
                    year: activeCampaign,
                  })}
                </span>
                <span className="block text-[11px] text-[var(--ink-3)]">
                  {isAnnuale
                    ? t("raccoltaPanel.closeCampaignHintAnnual")
                    : t("raccoltaPanel.closeCampaignHintPerennial")}
                </span>
              </span>
            </label>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="min-h-[var(--touch-min)] flex-1"
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
            >
              {t("logbook.common.cancel")}
            </Button>
            <Button
              className="min-h-[var(--touch-min)] flex-1"
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
            >
              {t("raccoltaPanel.saveAction")}
            </Button>
          </div>
        </div>
      ) : harvests.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--ink-3)]">
          {t("raccoltaPanel.emptyState")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {harvests.map((r) => {
            const plot = plots.find(
              (a) => a.id === r.plot_id,
            );
            return (
              <li
                key={r.id}
                className="flex items-stretch gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
              >
                <span
                  className="w-1 shrink-0 rounded-full"
                  style={{ background: "var(--crop-frutta, var(--accent))" }}
                />
                <button
                  type="button"
                  onClick={() => setDettaglio(r)}
                  title={t("raccoltaPanel.openCard")}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-semibold">
                    {r.cultivar ?? t("raccoltaPanel.harvestFallbackLabel")}
                  </p>
                  <p className="truncate text-xs text-[var(--ink-3)]">
                    {[
                      plot?.user_plot_name ?? t("raccoltaPanel.wholeFarmLower"),
                      r.destination_logistics,
                      r.quantity_kg != null
                        ? `${r.quantity_kg.toLocaleString("it-IT")} kg`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </button>
                <div className="flex shrink-0 flex-col items-end justify-between">
                  <time className="agro-num text-xs text-[var(--ink-3)]">
                    {new Date(r.harvested_at).toLocaleDateString("it-IT")}
                  </time>
                  {sync.pendingCount > 0 ? (
                    <span className="rounded-full bg-[var(--warn-l)] px-1.5 text-[10px] text-[var(--warn)]">
                      {t("raccoltaPanel.queueBadge")}
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--ok)]">✓</span>
                  )}
                </div>
                {/* Cancellazione protetta della singola harvest. */}
                <button
                  type="button"
                  onClick={() => setDaEliminare(r)}
                  title={t("raccoltaPanel.deleteHarvest")}
                  aria-label={t("raccoltaPanel.deleteHarvestAria", { label: harvestLabel(r) })}
                  className="flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-[var(--r-2)] text-[#dc2626] hover:bg-[var(--danger-l,#fee2e2)]"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDeleteOperation
        open={daEliminare != null}
        label={daEliminare ? harvestLabel(daEliminare) : ""}
        title={t("raccoltaPanel.deleteHarvest")}
        messaggio={t("raccoltaPanel.deleteConfirmMessage")}
        consensoLabel={t("raccoltaPanel.deleteConfirmConsent")}
        onConfirm={confirmDeletion}
        onClose={() => setDaEliminare(null)}
      />

      {dettaglio && (
        <HarvestDetailCard
          harvest={dettaglio}
          appezzamentoNome={
            plots.find((a) => a.id === dettaglio.plot_id)?.user_plot_name ??
            null
          }
          onClose={() => setDettaglio(null)}
          onDelete={() => {
            setDaEliminare(dettaglio);
            setDettaglio(null);
          }}
        />
      )}
    </FieldSheet>
  );
}
