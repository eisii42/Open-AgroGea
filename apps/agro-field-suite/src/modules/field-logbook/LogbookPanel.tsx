import {
  missingDeclarative,
  type TreatmentLog,
  type IssueRequest,
  type MachineUsageRequest,
  declarativeSystem,
  type OperationType,
  useAgroStore,
} from "@agrogea/core";
import {
  type FieldCampaignOption,
  FieldSheet,
  type TreatmentFormValues,
} from "@agrogea/ui";
import { Button, cn, Input, Label, Select } from "@geolibre/ui";
import { Copy, MapPin, MapPinOff, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGeoCompliance } from "../compliance/useGeoCompliance";
import { useCountryCatalog } from "../../hooks/useTenantCountry";
import { ConfirmDeleteOperation } from "./ConfirmDeleteOperation";
import { OperationDetailCard } from "./OperationDetailCard";
import {
  type CropAssignment,
  OPERATIONS,
  OperationForm,
  operationSpec,
} from "./OperationForm";

const TYPE_COLOR: Record<string, string> = {
  phytosanitary: "var(--danger)",
  fertilization: "var(--crop-cereali)",
  irrigation: "var(--accent)",
  tillage: "var(--ink-3)",
};

/**
 * Quaderno di Campagna (Design.md §Feature popups): lista record dal DAL +
 * form di registrazione. Ogni insert finisce in PGlite e nell'outbox nella
 * stessa transazione; il badge "coda" sparisce quando il sync router confirm.
 *
 * La lista è filtrabile per intervallo di date e per plot (geometria).
 * Il form può aprirsi pre-mirato a un plot tramite la scorciatoia "QDC"
 * del popup del field (store: quadernoNuovoAppezzamentoId).
 */
export function LogbookPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const treatments = useAgroStore((s) => s.treatments);
  const plots = useAgroStore((s) => s.plots);
  const campaignFields = useAgroStore((s) => s.campaignFields);
  const valutaCompliance = useGeoCompliance();
  // Cataloghi di stato filtered per il country_code risolto del tenant (Modulo 3):
  // i dropdown Product/Concime mostrano solo le voci del registro nazionale.
  const { items: fitosanitari, countryCode } = useCountryCatalog("phytosanitary");
  const { items: concimi } = useCountryCatalog("fertilizer");
  // Magazzino (0.2.0): anagrafica e lots per la sezione di issue del form.
  const products = useAgroStore((s) => s.products);
  const lots = useAgroStore((s) => s.lots);
  // Parco macchine (0.3.0): mezzi e attrezzi per il selettore del form (§5.1).
  const machines = useAgroStore((s) => s.machines);
  const equipment = useAgroStore((s) => s.equipment);
  const sync = useAgroStore((s) => s.sync);
  const recordTreatment = useAgroStore((s) => s.recordTreatment);
  const saveSoilSample = useAgroStore((s) => s.saveSoilSample);
  const deleteTreatment = useAgroStore((s) => s.deleteTreatment);
  // Automazione v17: semina con semente → scheda crop + campagna agraria.
  const saveCrop = useAgroStore((s) => s.saveCrop);
  const savePlotCampaign = useAgroStore((s) => s.savePlotCampaign);
  const activeCampaign = useAgroStore((s) => s.activeCampaign);
  const logbookOpenPlotId = useAgroStore(
    (s) => s.logbookOpenPlotId,
  );
  const consumeLogbookOpen = useAgroStore((s) => s.consumeLogbookOpen);
  const mapOperationIds = useAgroStore((s) => s.mapOperationIds);
  const setMapOperationIds = useAgroStore((s) => s.setMapOperationIds);

  // Tipo operation in compilazione (null = nessun form aperto); `chooser`
  // mostra il selettore impilato di tutti i tipi operation.
  const [formType, setFormType] = useState<OperationType | null>(null);
  const [chooser, setChooser] = useState(false);
  const [formDefaultAppId, setFormDefaultAppId] = useState<string>("");
  // Valori iniziali per "Ripeti operazione" (v17); null = form vuoto. Il nonce
  // fa da key del form: rimonta il componente a ogni apertura, così gli
  // initializer di stato rileggono i default.
  const [formDefaults, setFormDefaults] =
    useState<Partial<TreatmentFormValues> | null>(null);
  const [formNonce, setFormNonce] = useState(0);

  // Opzioni di field per la Campagna Agraria attiva (name + codice crop
  // SIAN). Solo campagne APERTE: quelle chiuse dal raccolto (v17) non sono più
  // un target valido per nuove operazioni, e il field risulta "senza coltura"
  // (abilita l'auto-assegnazione alla semina).
  const campaignFieldOptions = useMemo<FieldCampaignOption[]>(
    () =>
      campaignFields
        .filter((c) => c.closed_at == null && c.deleted_at == null)
        .map((c) => {
          const base =
            plots.find((a) => a.id === c.plot_id)?.user_plot_name ??
            t("logbookPanel.fieldFallbackName", { id: c.plot_id.slice(0, 6) });
          // Badge compliance: dichiarativi incompleti per il sistema del paese
          // (IT → SIAN, ES → SIEX), visibile a ogni selezione del field.
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
    [campaignFields, plots, countryCode],
  );

  function openForm(type: OperationType) {
    setFormType(type);
    setFormDefaultAppId(filterPlotId);
    setFormDefaults(null);
    setFormNonce((n) => n + 1);
    setChooser(false);
  }

  // "Ripeti operazione" (v17): riapre il form del tipo giusto precompilato dal
  // record esistente; la data resta oggi e gli issues si riscelgono sui
  // lots attuali del warehouse.
  function repeatOperation(op: TreatmentLog) {
    setFormDefaults({
      plot_id: op.plot_id,
      plot_campaign_id: op.plot_campaign_id,
      product_name: op.product_name,
      registration_number: op.registration_number,
      active_substance: op.active_substance,
      target_disease: op.target_disease,
      dose_value: op.dose_value,
      dose_unit: op.dose_unit,
      water_volume_l: op.water_volume_l,
      total_quantity: op.total_quantity,
      fertilizer_type: op.fertilizer_type,
      npk_ratio: op.npk_ratio,
      operator_name: op.operator_name,
      operator_tax_code: op.operator_tax_code,
      license_number: op.license_number,
      machinery_equipment: op.machinery_equipment,
      reentry_interval_h: op.reentry_interval_h,
      safety_period_days: op.safety_period_days,
    });
    setFormDefaultAppId(op.plot_id ?? "");
    setFormType(op.operation_type);
    setFormNonce((n) => n + 1);
    setChooser(false);
    setDetail(null);
  }

  // Cancellazione protetta: operation in attesa di confirm + notifica esito.
  const [toDelete, setToDelete] = useState<TreatmentLog | null>(
    null,
  );
  const [notification, setNotification] = useState<string | null>(null);
  // Operazione aperta in scheda dettaglio (modale centrale di sola reading).
  const [detail, setDetail] = useState<TreatmentLog | null>(null);

  // Filtri lista.
  const [filterPlotId, setFilterPlotId] = useState<string>("");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");

  // Apertura dal click sul field in mappa: mostra la LISTA filtrata sulle
  // lavorazioni di quell'appezzamento (il "Nuovo record" qui sotto eredita il
  // filtro come default, così registrare resta a un tap di distanza).
  useEffect(() => {
    if (logbookOpenPlotId) {
      setFilterPlotId(logbookOpenPlotId);
      setFormType(null);
      setChooser(false);
      consumeLogbookOpen();
    }
  }, [logbookOpenPlotId, consumeLogbookOpen]);

  // Con `scarichi` valorizzato l'attività download i lots di warehouse nella
  // stessa transazione: un errore (stock/lot scaduto) risale al form, che
  // resta aperto e mostra il messaggio. `assegnazione` (semina di una semente
  // su field libero, v17) crea scheda crop + campagna agraria in automatico.
  async function handleSubmit(
    values: TreatmentFormValues,
    issues?: IssueRequest[],
    assegnazione?: CropAssignment | null,
    machineUsages?: MachineUsageRequest[],
  ) {
    await recordTreatment(values, issues, machineUsages);
    if (assegnazione) {
      const crop = await saveCrop({
        common_name: assegnazione.species,
        scientific_name: assegnazione.scientificName,
        variety_name: assegnazione.varietyName,
        crop_metadata: {
          category: assegnazione.cropCategory,
          ...(assegnazione.densitaSemina != null
            ? { densita_semina: assegnazione.densitaSemina }
            : {}),
        },
      });
      if (crop) {
        await savePlotCampaign({
          plot_id: assegnazione.plotId,
          crop_id: crop.id,
          campaign_year: activeCampaign,
          declared_area_ha: assegnazione.declaredAreaHa,
          reference_parcel_external_id: null,
          agricultural_parcel_external_id: null,
          crop_external_code: null,
          variety_external_code: null,
        });
      }
    }
    setFormType(null);
    setFormDefaultAppId("");
    setFormDefaults(null);
  }

  // Campionamento di soil: scrive sulla tabella dedicata `soil_samples`.
  async function handleSubmitSoil(
    input: Parameters<typeof saveSoilSample>[0],
  ) {
    await saveSoilSample(input);
    setFormType(null);
    setFormDefaultAppId("");
    setFormDefaults(null);
  }

  // Notifica transitoria (auto-dismiss dopo l'avvenuta rimozione).
  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 3500);
    return () => clearTimeout(t);
  }, [notification]);

  /** Etichetta sintetica dell'operazione, per il banner di confirm. */
  function operationLabel(t: TreatmentLog): string {
    const data = new Date(t.executed_at).toLocaleDateString("it-IT");
    return `${t.product_name ?? t.operation_type} · ${data}`;
  }

  async function confirmDeletion() {
    if (!toDelete) return;
    const label = operationLabel(toDelete);
    await deleteTreatment(toDelete.id);
    setToDelete(null);
    setNotification(t("logbookPanel.notification.removed", { label: label }));
  }

  const filtered = useMemo(() => {
    const daTs = filterFrom ? new Date(filterFrom).setHours(0, 0, 0, 0) : null;
    const aTs = filterTo ? new Date(filterTo).setHours(23, 59, 59, 999) : null;
    return treatments.filter((t) => {
      if (filterPlotId && t.plot_id !== filterPlotId) return false;
      const ts = new Date(t.executed_at).getTime();
      if (daTs != null && ts < daTs) return false;
      if (aTs != null && ts > aTs) return false;
      return true;
    });
  }, [treatments, filterPlotId, filterFrom, filterTo]);

  const activeFilters = Boolean(filterPlotId || filterFrom || filterTo);

  // Toggle "Mostra sulla mappa": proietta come simboli SOLO le operazioni
  // attualmente visibili nel registro (rispetta i filters). Mentre è active,
  // il set di ID resta allineato alla lista filtrata.
  const activeMap = mapOperationIds !== null;
  useEffect(() => {
    if (!activeMap) return;
    setMapOperationIds(filtered.map((t) => t.id));
  }, [filtered, activeMap, setMapOperationIds]);

  const toggleMappa = () => {
    if (activeMap) setMapOperationIds(null);
    else setMapOperationIds(filtered.map((t) => t.id));
  };

  return (
    <FieldSheet
      title={
        formType
          ? operationSpec(formType).label
          : chooser
            ? t("logbookPanel.title.newOperation")
            : t("logbookPanel.title.logbook")
      }
      onClose={onClose}
      footer={
        formType ? undefined : chooser ? (
          <Button
            variant="outline"
            className="min-h-[var(--touch-min)] w-full"
            onClick={() => setChooser(false)}
          >
            {t("logbook.common.cancel")}
          </Button>
        ) : (
          <Button
            className="min-h-[var(--touch-min)] w-full"
            onClick={() => {
              setFormDefaultAppId(filterPlotId);
              setChooser(true);
            }}
          >
            ＋ {t("logbookPanel.button.registerOperation")}
          </Button>
        )
      }
    >
      {formType ? (
        <OperationForm
          key={formNonce}
          operationType={formType}
          plots={plots}
          campaignFields={campaignFieldOptions}
          prodottiCatalogo={fitosanitari}
          concimiCatalogo={concimi}
          prodottiMagazzino={products}
          lottiMagazzino={lots}
          machines={machines}
          equipment={equipment}
          valutaCompliance={valutaCompliance}
          defaultAppezzamentoId={formDefaultAppId}
          defaults={formDefaults ?? undefined}
          onSubmit={handleSubmit}
          onSubmitSoil={handleSubmitSoil}
          onCancel={() => {
            setFormType(null);
            setFormDefaultAppId("");
            setFormDefaults(null);
          }}
        />
      ) : chooser ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-[var(--ink-3)]">
            {t("logbookPanel.chooser.description")}
          </p>
          {OPERATIONS.map((o) => (
            <button
              key={o.type}
              type="button"
              onClick={() => openForm(o.type)}
              className="flex items-center gap-3 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-3 text-left hover:bg-[var(--panel-2)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className="block text-xs text-[var(--ink-3)]">{o.descr}</span>
              </span>
              <span className="text-[var(--ink-4)]">›</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Notifica transitoria di avvenuta rimozione. */}
          {notification && (
            <div
              role="status"
              className="rounded-[var(--r-2)] border border-[var(--ok)] bg-[var(--ok-l,#dcfce7)] px-3 py-2 text-xs text-[var(--ok)]"
            >
              {notification}
            </div>
          )}
          {/* Barra filters: data + plot (geometria). */}
          <div className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="qdc-f-da">{t("logbookPanel.filter.from")}</Label>
                <Input
                  id="qdc-f-da"
                  type="date"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="qdc-f-a">{t("logbookPanel.filter.to")}</Label>
                <Input
                  id="qdc-f-a"
                  type="date"
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="qdc-f-app">{t("logbook.common.plot")}</Label>
              <Select
                id="qdc-f-app"
                value={filterPlotId}
                onChange={(e) => setFilterPlotId(e.target.value)}
              >
                <option value="">{t("logbookPanel.filter.allPlots")}</option>
                {plots.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.user_plot_name}
                  </option>
                ))}
              </Select>
            </div>
            {activeFilters && (
              <button
                type="button"
                onClick={() => {
                  setFilterPlotId("");
                  setFilterFrom("");
                  setFilterTo("");
                }}
                className="self-start text-xs text-[var(--accent)]"
              >
                {t("logbookPanel.filter.reset")}
              </button>
            )}
          </div>

          {filtered.length > 0 && (
            <button
              type="button"
              onClick={toggleMappa}
              className={cn(
                "flex items-center justify-center gap-2 rounded-[var(--r-2)] border px-3 py-2 text-sm font-medium transition-colors",
                activeMap
                  ? "border-[var(--accent)] bg-[var(--accent-l)] text-[var(--accent)]"
                  : "border-[var(--line)] text-[var(--ink-2)] hover:bg-[var(--panel-2)]",
              )}
            >
              {activeMap ? <MapPinOff size={15} /> : <MapPin size={15} />}
              {activeMap
                ? t("logbookPanel.map.hide", { count: filtered.length })
                : t("logbookPanel.map.show", { count: filtered.length })}
            </button>
          )}

          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--ink-3)]">
              {treatments.length === 0
                ? t("logbookPanel.empty.noRecords")
                : t("logbookPanel.empty.noFilterMatch")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {filtered.map((treatment) => {
                const plot = plots.find(
                  (a) => a.id === treatment.plot_id,
                );
                return (
                  <li
                    key={treatment.id}
                    className="flex items-stretch gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
                  >
                    <span
                      className="w-1 shrink-0 rounded-full"
                      style={{
                        background:
                          TYPE_COLOR[treatment.operation_type] ?? "var(--ink-4)",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setDetail(treatment)}
                      title={t("logbookPanel.list.openDetail")}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-semibold">
                        {treatment.product_name ?? treatment.operation_type}
                      </p>
                      <p className="truncate text-xs text-[var(--ink-3)]">
                        {[
                          treatment.operation_type,
                          plot?.user_plot_name ?? t("logbook.common.wholeFarm"),
                          treatment.dose_value != null
                            ? `${treatment.dose_value} ${treatment.dose_unit ?? ""}`
                            : null,
                          treatment.target_disease,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </button>
                    <div className="flex shrink-0 flex-col items-end justify-between">
                      <time className="agro-num text-xs text-[var(--ink-3)]">
                        {new Date(treatment.executed_at).toLocaleDateString("it-IT")}
                      </time>
                      {sync.pendingCount > 0 ? (
                        <span className="rounded-full bg-[var(--warn-l)] px-1.5 text-[10px] text-[var(--warn)]">
                          {t("logbookPanel.list.queued")}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--ok)]">✓</span>
                      )}
                    </div>
                    {/* "Ripeti operazione": form precompilato con data = oggi. */}
                    <button
                      type="button"
                      onClick={() => repeatOperation(treatment)}
                      title={t("logbookPanel.list.repeatOperation")}
                      aria-label={t("logbookPanel.list.repeatOperation")}
                      className="flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-[var(--r-2)] text-[var(--accent)] hover:bg-[var(--accent-l)]"
                    >
                      <Copy size={15} />
                    </button>
                    {/* Cancellazione protetta della singola operation (FIX 1). */}
                    <button
                      type="button"
                      onClick={() => setToDelete(treatment)}
                      title={t("logbookPanel.list.deleteOperation")}
                      aria-label={t("logbookPanel.list.deleteAriaLabel", {
                        label: operationLabel(treatment),
                      })}
                      className="flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-[var(--r-2)] text-[#dc2626] hover:bg-[var(--danger-l,#fee2e2)]"
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <ConfirmDeleteOperation
        open={toDelete != null}
        label={toDelete ? operationLabel(toDelete) : ""}
        onConfirm={confirmDeletion}
        onClose={() => setToDelete(null)}
      />

      {detail && (
        <OperationDetailCard
          operation={detail}
          appezzamentoNome={
            plots.find((a) => a.id === detail.plot_id)?.user_plot_name ??
            null
          }
          onClose={() => setDetail(null)}
          onDelete={() => {
            setToDelete(detail);
            setDetail(null);
          }}
        />
      )}
    </FieldSheet>
  );
}
