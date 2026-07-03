import { type Raccolta, useAgroStore } from "@agrogea/core";
import { FieldSheet } from "@agrogea/ui";
import { Button, Input, Label, Select } from "@geolibre/ui";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ConfirmDeleteOperazione } from "./ConfirmDeleteOperazione";
import { RaccoltaDettaglioCard } from "./RaccoltaDettaglioCard";

/**
 * Modulo Raccolta: lista degli eventi di raccolta + form di registrazione. Ogni
 * insert passa da `salvaRaccolta` (PGlite + outbox nella stessa transazione) e
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

export function RaccoltaPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const raccolte = useAgroStore((s) => s.raccolte);
  const appezzamenti = useAgroStore((s) => s.appezzamenti);
  const campiCampagna = useAgroStore((s) => s.campiCampagna);
  const salvaRaccolta = useAgroStore((s) => s.salvaRaccolta);
  const eliminaRaccolta = useAgroStore((s) => s.eliminaRaccolta);
  const sync = useAgroStore((s) => s.sync);

  const [daEliminare, setDaEliminare] = useState<Raccolta | null>(null);
  const [notifica, setNotifica] = useState<string | null>(null);
  // Raccolta aperta in scheda dettaglio (modale centrale di sola lettura).
  const [dettaglio, setDettaglio] = useState<Raccolta | null>(null);

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
  const quintaliValidi = quintaliNum == null || Number.isFinite(quintaliNum);
  const canSubmit = data !== "" && quintaliValidi && !saving;

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

  function etichettaRaccolta(r: Raccolta): string {
    const data = new Date(r.harvested_at).toLocaleDateString("it-IT");
    return `${r.cultivar ?? t("raccoltaPanel.harvestFallbackLabel")} · ${data}`;
  }

  async function confermaEliminazione() {
    if (!daEliminare) return;
    const etichetta = etichettaRaccolta(daEliminare);
    await eliminaRaccolta(daEliminare.id);
    setDaEliminare(null);
    setNotifica(t("raccoltaPanel.removedNotice", { label: etichetta }));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      // Aggancio alla Campagna Agraria attiva tramite l'appezzamento scelto.
      const campo = appId
        ? campiCampagna.find((c) => c.plot_id === appId)
        : undefined;
      await salvaRaccolta({
        plot_id: appId || null,
        plot_campaign_id: campo?.id ?? null,
        cultivar: cultivar.trim() || null,
        destination_logistics: destinazione.trim() || null,
        // Quintali → kg per la persistenza (la metrica aggregata resta in kg).
        quantity_kg: quintaliNum != null ? quintaliNum * 100 : null,
        harvested_at: new Date(`${data}T12:00:00`).toISOString(),
        metadata: destinazioneLotto.trim()
          ? { destinazione_lotto: destinazioneLotto.trim() }
          : {},
      });
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
              {appezzamenti.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.user_plot_name}
                </option>
              ))}
            </Select>
          </div>
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
                aria-invalid={!quintaliValidi || undefined}
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
          {quintaliNum != null && quintaliValidi && (
            <p className="text-xs text-[var(--ink-4)]">
              = {(quintaliNum * 100).toLocaleString("it-IT")} kg
            </p>
          )}
          {!quintaliValidi && (
            <p className="text-xs text-[var(--danger)]">
              {t("raccoltaPanel.quantityMustBeNumber")}
            </p>
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
      ) : raccolte.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--ink-3)]">
          {t("raccoltaPanel.emptyState")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {raccolte.map((r) => {
            const appezzamento = appezzamenti.find(
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
                      appezzamento?.user_plot_name ?? t("raccoltaPanel.wholeFarmLower"),
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
                {/* Cancellazione protetta della singola raccolta. */}
                <button
                  type="button"
                  onClick={() => setDaEliminare(r)}
                  title={t("raccoltaPanel.deleteHarvest")}
                  aria-label={t("raccoltaPanel.deleteHarvestAria", { label: etichettaRaccolta(r) })}
                  className="flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-[var(--r-2)] text-[#dc2626] hover:bg-[var(--danger-l,#fee2e2)]"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDeleteOperazione
        open={daEliminare != null}
        etichetta={daEliminare ? etichettaRaccolta(daEliminare) : ""}
        titolo={t("raccoltaPanel.deleteHarvest")}
        messaggio={t("raccoltaPanel.deleteConfirmMessage")}
        consensoLabel={t("raccoltaPanel.deleteConfirmConsent")}
        onConfirm={confermaEliminazione}
        onClose={() => setDaEliminare(null)}
      />

      {dettaglio && (
        <RaccoltaDettaglioCard
          raccolta={dettaglio}
          appezzamentoNome={
            appezzamenti.find((a) => a.id === dettaglio.plot_id)?.user_plot_name ??
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
