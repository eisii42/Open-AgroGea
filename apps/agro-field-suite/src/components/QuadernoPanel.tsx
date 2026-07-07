import {
  dichiarativiMancanti,
  type RegistroTrattamento,
  type ScaricoRichiesta,
  sistemaDichiarativo,
  type TipoOperazione,
  useAgroStore,
} from "@agrogea/core";
import {
  type CampoCampagnaOption,
  FieldSheet,
  type TrattamentoFormValues,
} from "@agrogea/ui";
import { Button, cn, Input, Label, Select } from "@geolibre/ui";
import { Copy, MapPin, MapPinOff, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGeoCompliance } from "../modules/compliance/useGeoCompliance";
import { useCountryCatalog } from "../hooks/useTenantCountry";
import { ConfirmDeleteOperazione } from "./ConfirmDeleteOperazione";
import { OperazioneDettaglioCard } from "./OperazioneDettaglioCard";
import {
  type AssegnazioneColtura,
  OPERAZIONI,
  OperazioneForm,
  operazioneSpec,
} from "./OperazioneForm";

const TIPO_COLOR: Record<string, string> = {
  phytosanitary: "var(--danger)",
  fertilization: "var(--crop-cereali)",
  irrigation: "var(--accent)",
  tillage: "var(--ink-3)",
};

/**
 * Quaderno di Campagna (Design.md §Feature popups): lista record dal DAL +
 * form di registrazione. Ogni insert finisce in PGlite e nell'outbox nella
 * stessa transazione; il badge "coda" sparisce quando il sync router conferma.
 *
 * La lista è filtrabile per intervallo di date e per appezzamento (geometria).
 * Il form può aprirsi pre-mirato a un appezzamento tramite la scorciatoia "QDC"
 * del popup del campo (store: quadernoNuovoAppezzamentoId).
 */
export function QuadernoPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const trattamenti = useAgroStore((s) => s.trattamenti);
  const appezzamenti = useAgroStore((s) => s.appezzamenti);
  const campiCampagna = useAgroStore((s) => s.campiCampagna);
  const valutaCompliance = useGeoCompliance();
  // Cataloghi di stato filtrati per il country_code risolto del tenant (Modulo 3):
  // i dropdown Prodotto/Concime mostrano solo le voci del registro nazionale.
  const { voci: fitosanitari, countryCode } = useCountryCatalog("phytosanitary");
  const { voci: concimi } = useCountryCatalog("fertilizer");
  // Magazzino (0.2.0): anagrafica e lotti per la sezione di scarico del form.
  const prodotti = useAgroStore((s) => s.prodotti);
  const lotti = useAgroStore((s) => s.lotti);
  const sync = useAgroStore((s) => s.sync);
  const registraTrattamento = useAgroStore((s) => s.registraTrattamento);
  const salvaCampionamento = useAgroStore((s) => s.salvaCampionamento);
  const eliminaTrattamento = useAgroStore((s) => s.eliminaTrattamento);
  // Automazione v17: semina con semente → scheda coltura + campagna agraria.
  const salvaCrop = useAgroStore((s) => s.salvaCrop);
  const salvaCampoCampagna = useAgroStore((s) => s.salvaCampoCampagna);
  const campagnaAttiva = useAgroStore((s) => s.campagnaAttiva);
  const quadernoApriAppezzamentoId = useAgroStore(
    (s) => s.quadernoApriAppezzamentoId,
  );
  const consumaQuadernoApri = useAgroStore((s) => s.consumaQuadernoApri);
  const operazioniMappaIds = useAgroStore((s) => s.operazioniMappaIds);
  const setOperazioniMappaIds = useAgroStore((s) => s.setOperazioniMappaIds);

  // Tipo operazione in compilazione (null = nessun form aperto); `chooser`
  // mostra il selettore impilato di tutti i tipi operazione.
  const [formType, setFormType] = useState<TipoOperazione | null>(null);
  const [chooser, setChooser] = useState(false);
  const [formDefaultAppId, setFormDefaultAppId] = useState<string>("");
  // Valori iniziali per "Ripeti operazione" (v17); null = form vuoto. Il nonce
  // fa da key del form: rimonta il componente a ogni apertura, così gli
  // initializer di stato rileggono i default.
  const [formDefaults, setFormDefaults] =
    useState<Partial<TrattamentoFormValues> | null>(null);
  const [formNonce, setFormNonce] = useState(0);

  // Opzioni di campo per la Campagna Agraria attiva (nome + codice coltura
  // SIAN). Solo campagne APERTE: quelle chiuse dal raccolto (v17) non sono più
  // un target valido per nuove operazioni, e il campo risulta "senza coltura"
  // (abilita l'auto-assegnazione alla semina).
  const campiCampagnaOptions = useMemo<CampoCampagnaOption[]>(
    () =>
      campiCampagna
        .filter((c) => c.closed_at == null && c.deleted_at == null)
        .map((c) => {
          const base =
            appezzamenti.find((a) => a.id === c.plot_id)?.user_plot_name ??
            t("quadernoPanel.fieldFallbackName", { id: c.plot_id.slice(0, 6) });
          // Badge compliance: dichiarativi incompleti per il sistema del paese
          // (IT → SIAN, ES → SIEX), visibile a ogni selezione del campo.
          const sistema = sistemaDichiarativo(countryCode);
          const dichiarativiKo =
            sistema != null && dichiarativiMancanti(countryCode, c).length > 0;
          return {
            campoCampagnaId: c.id,
            appezzamentoId: c.plot_id,
            nome: dichiarativiKo ? `${base} · ${sistema} ✗` : base,
            codiceColturaSian: c.crop_external_code,
            superficieHa: c.declared_area_ha,
          };
        }),
    [campiCampagna, appezzamenti, countryCode],
  );

  function apriForm(type: TipoOperazione) {
    setFormType(type);
    setFormDefaultAppId(filtroAppId);
    setFormDefaults(null);
    setFormNonce((n) => n + 1);
    setChooser(false);
  }

  // "Ripeti operazione" (v17): riapre il form del tipo giusto precompilato dal
  // record esistente; la data resta oggi e gli scarichi si riscelgono sui
  // lotti attuali del magazzino.
  function ripetiOperazione(op: RegistroTrattamento) {
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
    setDettaglio(null);
  }

  // Cancellazione protetta: operazione in attesa di conferma + notifica esito.
  const [daEliminare, setDaEliminare] = useState<RegistroTrattamento | null>(
    null,
  );
  const [notifica, setNotifica] = useState<string | null>(null);
  // Operazione aperta in scheda dettaglio (modale centrale di sola lettura).
  const [dettaglio, setDettaglio] = useState<RegistroTrattamento | null>(null);

  // Filtri lista.
  const [filtroAppId, setFiltroAppId] = useState<string>("");
  const [filtroDa, setFiltroDa] = useState<string>("");
  const [filtroA, setFiltroA] = useState<string>("");

  // Apertura dal click sul campo in mappa: mostra la LISTA filtrata sulle
  // lavorazioni di quell'appezzamento (il "Nuovo record" qui sotto eredita il
  // filtro come default, così registrare resta a un tap di distanza).
  useEffect(() => {
    if (quadernoApriAppezzamentoId) {
      setFiltroAppId(quadernoApriAppezzamentoId);
      setFormType(null);
      setChooser(false);
      consumaQuadernoApri();
    }
  }, [quadernoApriAppezzamentoId, consumaQuadernoApri]);

  // Con `scarichi` valorizzato l'attività scarica i lotti di magazzino nella
  // stessa transazione: un errore (giacenza/lotto scaduto) risale al form, che
  // resta aperto e mostra il messaggio. `assegnazione` (semina di una semente
  // su campo libero, v17) crea scheda coltura + campagna agraria in automatico.
  async function handleSubmit(
    values: TrattamentoFormValues,
    scarichi?: ScaricoRichiesta[],
    assegnazione?: AssegnazioneColtura | null,
  ) {
    await registraTrattamento(values, scarichi);
    if (assegnazione) {
      const crop = await salvaCrop({
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
        await salvaCampoCampagna({
          plot_id: assegnazione.plotId,
          crop_id: crop.id,
          campaign_year: campagnaAttiva,
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

  // Campionamento di suolo: scrive sulla tabella dedicata `soil_samples`.
  async function handleSubmitSoil(
    input: Parameters<typeof salvaCampionamento>[0],
  ) {
    await salvaCampionamento(input);
    setFormType(null);
    setFormDefaultAppId("");
    setFormDefaults(null);
  }

  // Notifica transitoria (auto-dismiss dopo l'avvenuta rimozione).
  useEffect(() => {
    if (!notifica) return;
    const t = setTimeout(() => setNotifica(null), 3500);
    return () => clearTimeout(t);
  }, [notifica]);

  /** Etichetta sintetica dell'operazione, per il banner di conferma. */
  function etichettaOperazione(t: RegistroTrattamento): string {
    const data = new Date(t.executed_at).toLocaleDateString("it-IT");
    return `${t.product_name ?? t.operation_type} · ${data}`;
  }

  async function confermaEliminazione() {
    if (!daEliminare) return;
    const etichetta = etichettaOperazione(daEliminare);
    await eliminaTrattamento(daEliminare.id);
    setDaEliminare(null);
    setNotifica(t("quadernoPanel.notification.removed", { label: etichetta }));
  }

  const filtrati = useMemo(() => {
    const daTs = filtroDa ? new Date(filtroDa).setHours(0, 0, 0, 0) : null;
    const aTs = filtroA ? new Date(filtroA).setHours(23, 59, 59, 999) : null;
    return trattamenti.filter((t) => {
      if (filtroAppId && t.plot_id !== filtroAppId) return false;
      const ts = new Date(t.executed_at).getTime();
      if (daTs != null && ts < daTs) return false;
      if (aTs != null && ts > aTs) return false;
      return true;
    });
  }, [trattamenti, filtroAppId, filtroDa, filtroA]);

  const filtriAttivi = Boolean(filtroAppId || filtroDa || filtroA);

  // Toggle "Mostra sulla mappa": proietta come simboli SOLO le operazioni
  // attualmente visibili nel registro (rispetta i filtri). Mentre è attivo,
  // il set di ID resta allineato alla lista filtrata.
  const mappaAttiva = operazioniMappaIds !== null;
  useEffect(() => {
    if (!mappaAttiva) return;
    setOperazioniMappaIds(filtrati.map((t) => t.id));
  }, [filtrati, mappaAttiva, setOperazioniMappaIds]);

  const toggleMappa = () => {
    if (mappaAttiva) setOperazioniMappaIds(null);
    else setOperazioniMappaIds(filtrati.map((t) => t.id));
  };

  return (
    <FieldSheet
      title={
        formType
          ? operazioneSpec(formType).label
          : chooser
            ? t("quadernoPanel.title.newOperation")
            : t("quadernoPanel.title.logbook")
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
              setFormDefaultAppId(filtroAppId);
              setChooser(true);
            }}
          >
            ＋ {t("quadernoPanel.button.registerOperation")}
          </Button>
        )
      }
    >
      {formType ? (
        <OperazioneForm
          key={formNonce}
          operationType={formType}
          appezzamenti={appezzamenti}
          campiCampagna={campiCampagnaOptions}
          prodottiCatalogo={fitosanitari}
          concimiCatalogo={concimi}
          prodottiMagazzino={prodotti}
          lottiMagazzino={lotti}
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
            {t("quadernoPanel.chooser.description")}
          </p>
          {OPERAZIONI.map((o) => (
            <button
              key={o.type}
              type="button"
              onClick={() => apriForm(o.type)}
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
          {notifica && (
            <div
              role="status"
              className="rounded-[var(--r-2)] border border-[var(--ok)] bg-[var(--ok-l,#dcfce7)] px-3 py-2 text-xs text-[var(--ok)]"
            >
              {notifica}
            </div>
          )}
          {/* Barra filtri: data + appezzamento (geometria). */}
          <div className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="qdc-f-da">{t("quadernoPanel.filter.from")}</Label>
                <Input
                  id="qdc-f-da"
                  type="date"
                  value={filtroDa}
                  onChange={(e) => setFiltroDa(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="qdc-f-a">{t("quadernoPanel.filter.to")}</Label>
                <Input
                  id="qdc-f-a"
                  type="date"
                  value={filtroA}
                  onChange={(e) => setFiltroA(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="qdc-f-app">{t("logbook.common.plot")}</Label>
              <Select
                id="qdc-f-app"
                value={filtroAppId}
                onChange={(e) => setFiltroAppId(e.target.value)}
              >
                <option value="">{t("quadernoPanel.filter.allPlots")}</option>
                {appezzamenti.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.user_plot_name}
                  </option>
                ))}
              </Select>
            </div>
            {filtriAttivi && (
              <button
                type="button"
                onClick={() => {
                  setFiltroAppId("");
                  setFiltroDa("");
                  setFiltroA("");
                }}
                className="self-start text-xs text-[var(--accent)]"
              >
                {t("quadernoPanel.filter.reset")}
              </button>
            )}
          </div>

          {filtrati.length > 0 && (
            <button
              type="button"
              onClick={toggleMappa}
              className={cn(
                "flex items-center justify-center gap-2 rounded-[var(--r-2)] border px-3 py-2 text-sm font-medium transition-colors",
                mappaAttiva
                  ? "border-[var(--accent)] bg-[var(--accent-l)] text-[var(--accent)]"
                  : "border-[var(--line)] text-[var(--ink-2)] hover:bg-[var(--panel-2)]",
              )}
            >
              {mappaAttiva ? <MapPinOff size={15} /> : <MapPin size={15} />}
              {mappaAttiva
                ? t("quadernoPanel.map.hide", { count: filtrati.length })
                : t("quadernoPanel.map.show", { count: filtrati.length })}
            </button>
          )}

          {filtrati.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--ink-3)]">
              {trattamenti.length === 0
                ? t("quadernoPanel.empty.noRecords")
                : t("quadernoPanel.empty.noFilterMatch")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {filtrati.map((trattamento) => {
                const appezzamento = appezzamenti.find(
                  (a) => a.id === trattamento.plot_id,
                );
                return (
                  <li
                    key={trattamento.id}
                    className="flex items-stretch gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
                  >
                    <span
                      className="w-1 shrink-0 rounded-full"
                      style={{
                        background:
                          TIPO_COLOR[trattamento.operation_type] ?? "var(--ink-4)",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setDettaglio(trattamento)}
                      title={t("quadernoPanel.list.openDetail")}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-semibold">
                        {trattamento.product_name ?? trattamento.operation_type}
                      </p>
                      <p className="truncate text-xs text-[var(--ink-3)]">
                        {[
                          trattamento.operation_type,
                          appezzamento?.user_plot_name ?? t("logbook.common.wholeFarm"),
                          trattamento.dose_value != null
                            ? `${trattamento.dose_value} ${trattamento.dose_unit ?? ""}`
                            : null,
                          trattamento.target_disease,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </button>
                    <div className="flex shrink-0 flex-col items-end justify-between">
                      <time className="agro-num text-xs text-[var(--ink-3)]">
                        {new Date(trattamento.executed_at).toLocaleDateString("it-IT")}
                      </time>
                      {sync.pendingCount > 0 ? (
                        <span className="rounded-full bg-[var(--warn-l)] px-1.5 text-[10px] text-[var(--warn)]">
                          {t("quadernoPanel.list.queued")}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--ok)]">✓</span>
                      )}
                    </div>
                    {/* "Ripeti operazione": form precompilato con data = oggi. */}
                    <button
                      type="button"
                      onClick={() => ripetiOperazione(trattamento)}
                      title={t("quadernoPanel.list.repeatOperation")}
                      aria-label={t("quadernoPanel.list.repeatOperation")}
                      className="flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-[var(--r-2)] text-[var(--accent)] hover:bg-[var(--accent-l)]"
                    >
                      <Copy size={15} />
                    </button>
                    {/* Cancellazione protetta della singola operazione (FIX 1). */}
                    <button
                      type="button"
                      onClick={() => setDaEliminare(trattamento)}
                      title={t("quadernoPanel.list.deleteOperation")}
                      aria-label={t("quadernoPanel.list.deleteAriaLabel", {
                        label: etichettaOperazione(trattamento),
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

      <ConfirmDeleteOperazione
        open={daEliminare != null}
        etichetta={daEliminare ? etichettaOperazione(daEliminare) : ""}
        onConfirm={confermaEliminazione}
        onClose={() => setDaEliminare(null)}
      />

      {dettaglio && (
        <OperazioneDettaglioCard
          operazione={dettaglio}
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
