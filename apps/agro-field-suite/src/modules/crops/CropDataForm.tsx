import {
  type Plot,
  type PlotCampaign,
  useAgroStore,
} from "@agrogea/core";
import { Button, Input, Label, Select } from "@geolibre/ui";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCountryCatalog } from "../../hooks/useTenantCountry";
import { allCropFormSchemas, cropFormSchema } from "./cropFormSchema";

/**
 * Scheda "Dati coltura" del modulo CropType. Sistema smart e semplice per
 * registrare la crop di un plot per la Campagna Agraria attiva:
 *   * scheda dedicata per ogni tipo (vite/olivo/frutteto/seminativo/orticoltura),
 *     con i campi di filiera specifici (clone, sesto, portainnesto, ciclo…);
 *   * scrive su DUE tabelle normalizzate — la specie/varietà in `crops`
 *     (campi di filiera in `crop_metadata`) e lo stato annuale in `plots_campaign`;
 *   * in MODIFICA ricarica i valori dell'annata; se l'annata è VUOTA ma esiste un
 *     anno precedente per lo stesso plot, precompila con quei dati
 *     (perenni: vite/olivo/frutteto) creando però righe nuove al salvataggio.
 *
 * La categoria scelta finisce in `crop_metadata.category`: è ciò che la scheda
 * DSS legge per risolvere il modulo verticale dell'appezzamento.
 */

type MetaState = Record<string, string>;

function metaToStrings(meta: Record<string, unknown>): MetaState {
  const out: MetaState = {};
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (k === "category") continue;
    out[k] = v == null ? "" : String(v);
  }
  return out;
}

/** Legge una stringa non vuota da `metadata` di una voce di catalogo. */
function metaStr(meta: Record<string, unknown>, key: string): string | null {
  const v = meta?.[key];
  return typeof v === "string" && v.trim() ? v : null;
}

export function CropDataForm({
  plot,
  onSaved,
}: {
  plot: Plot;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const dal = useAgroStore((s) => s.dal);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const crops = useAgroStore((s) => s.crops);
  const activeCampaign = useAgroStore((s) => s.activeCampaign);
  const setActiveCampaign = useAgroStore((s) => s.setActiveCampaign);
  const saveCrop = useAgroStore((s) => s.saveCrop);
  const savePlotCampaign = useAgroStore((s) => s.savePlotCampaign);

  // Cataloghi di stato filtrati per il country_code risolto del tenant (Modulo 3):
  // specie e varietà del registro nazionale per i quick-pick guidati. Se vuoti,
  // i campi restano a testo libero (l'utente non è bloccato).
  const { voci: cropCatalog, countryCode } = useCountryCatalog("crop");
  const { voci: varietyCatalog } = useCountryCatalog("variety");

  // Tutte le campagne dell'appezzamento (ogni annata), per modifica + copia anno
  // precedente. Ricaricate al cambio plot e dopo ogni salvataggio.
  const [plotCampaigns, setPlotCampaigns] = useState<PlotCampaign[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let vivo = true;
    if (!dal) return;
    void dal
      .listCampiCampagna({ plotId: plot.id })
      .then((rows) => {
        if (vivo) setPlotCampaigns(rows);
      });
    return () => {
      vivo = false;
    };
  }, [dal, plot.id, reloadKey]);

  // Data dell'ultima SEMINA/TRAPIANTO dal Quaderno di Campagna (fonte di verità
  // per le annuali; alimenta il biofix GDD del DSS). Sola lettura qui.
  const [ultimaSemina, setUltimaSemina] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    if (!dal || !activeCompanyId) return;
    void dal
      .listTreatments(activeCompanyId, { plotId: plot.id, limit: 200 })
      .then((rows) => {
        if (!vivo) return;
        const semina = rows.find((t) => t.operation_type === "sowing");
        setUltimaSemina(semina?.executed_at ?? null);
      });
    return () => {
      vivo = false;
    };
  }, [dal, activeCompanyId, plot.id, reloadKey]);

  const [category, setCategory] = useState<string>("");
  const [commonName, setCommonName] = useState("");
  const [scientificName, setScientificName] = useState("");
  const [varietyName, setVarietyName] = useState("");
  const [meta, setMeta] = useState<MetaState>({});
  const [declaredArea, setDeclaredArea] = useState("");
  const [refParcel, setRefParcel] = useState("");
  const [agriParcel, setAgriParcel] = useState("");
  const [cropCode, setCropCode] = useState("");
  const [varietyCode, setVarietyCode] = useState("");
  // Id da riusare in MODIFICA (annata corrente già presente); undefined = nuovo.
  const [editCampaignId, setEditCampaignId] = useState<string | undefined>();
  const [editCropId, setEditCropId] = useState<string | undefined>();
  // Annata da cui i valori sono stati copiati (precompilazione perenni).
  const [copiedFrom, setCopiedFrom] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [esito, setEsito] = useState<"idle" | "ok" | "errore">("idle");
  const [erroreMsg, setErroreMsg] = useState<string>();

  // Prefill quando cambia plot, annata attiva o l'elenco campagne.
  useEffect(() => {
    const current =
      plotCampaigns.find((c) => c.campaign_year === activeCampaign) ?? null;
    const previous = plotCampaigns
      .filter((c) => c.campaign_year < activeCampaign)
      .sort((a, b) => b.campaign_year - a.campaign_year)[0] ?? null;
    const source = current ?? previous;
    const crop = source ? crops.find((c) => c.id === source.crop_id) ?? null : null;

    setEditCampaignId(current?.id);
    // In copia-da-precedente NON si riusa il crop_id: si crea un nuovo snapshot
    // della specie per l'annata (no mutazione retroattiva degli anni passati).
    setEditCropId(current ? crop?.id : undefined);
    setCopiedFrom(!current && previous ? previous.campaign_year : null);

    setCategory(
      crop && typeof crop.crop_metadata?.["category"] === "string"
        ? (crop.crop_metadata["category"] as string)
        : "",
    );
    setCommonName(crop?.common_name ?? "");
    setScientificName(crop?.scientific_name ?? "");
    setVarietyName(crop?.variety_name ?? "");
    setMeta(crop ? metaToStrings(crop.crop_metadata) : {});
    setDeclaredArea(
      String(source?.declared_area_ha ?? plot.area_ha ?? ""),
    );
    setRefParcel(source?.reference_parcel_external_id ?? "");
    setAgriParcel(source?.agricultural_parcel_external_id ?? "");
    setCropCode(source?.crop_external_code ?? "");
    setVarietyCode(source?.variety_external_code ?? "");
    setEsito("idle");
  }, [plot.id, plot.area_ha, activeCampaign, plotCampaigns, crops]);

  const schema = cropFormSchema(t, category);
  // Annuali (semina/trapianto ogni campagna) vs perenni (anno d'impianto).
  const isAnnuale = category === "seminativo" || category === "orticoltura";

  // Varietà del catalogo, filtrate sulla specie scelta (metadata.crop_code) se il
  // collegamento esiste; altrimenti tutte le varietà del paese.
  const varietyOptions = useMemo(() => {
    const code = cropCode.trim();
    if (!code) return varietyCatalog;
    const linked = varietyCatalog.filter(
      (v) => metaStr(v.metadata, "crop_code") === code,
    );
    return linked.length > 0 ? linked : varietyCatalog;
  }, [varietyCatalog, cropCode]);

  // Quick-pick specie dal catalogo: auto-compila tipo (se mappato), name comune,
  // name scientifico e codice ministeriale.
  function selezionaSpecieCatalogo(code: string) {
    const voce = cropCatalog.find((v) => v.code === code);
    if (!voce) {
      setCropCode("");
      return;
    }
    const cat = metaStr(voce.metadata, "category");
    if (cat && cropFormSchema(t, cat)) setCategory(cat);
    setCommonName(voce.name);
    const sci = metaStr(voce.metadata, "scientific_name");
    if (sci) setScientificName(sci);
    setCropCode(voce.code);
  }

  // Quick-pick varietà dal catalogo: auto-compila name varietà, codice e clone.
  function selezionaVarietaCatalogo(code: string) {
    setVarietyCode(code);
    const voce = varietyOptions.find((v) => v.code === code);
    if (!voce) return;
    setVarietyName(voce.name);
    const clone = metaStr(voce.metadata, "clone");
    if (clone) setMeta((m) => ({ ...m, clone }));
  }

  function selezionaCategoria(cat: string) {
    setCategory(cat);
    const s = cropFormSchema(t, cat);
    if (!s) return;
    setCommonName((v) => v || s.commonName);
    setScientificName((v) => v || s.scientificName);
  }

  const setMetaField = (key: string, value: string) =>
    setMeta((m) => ({ ...m, [key]: value }));

  const areaNum = declaredArea.trim() === "" ? null : Number(declaredArea);
  const areaValida = areaNum != null && Number.isFinite(areaNum);
  const canSave = Boolean(category && commonName.trim() && areaValida) && !saving;

  async function salva() {
    if (!canSave) return;
    setSaving(true);
    setEsito("idle");
    setErroreMsg(undefined);
    try {
      const cropMetadata: Record<string, unknown> = { category };
      for (const f of schema?.metaFields ?? []) {
        const raw = (meta[f.key] ?? "").trim();
        if (!raw) continue;
        cropMetadata[f.key] = f.type === "number" ? Number(raw) : raw;
      }

      const crop = await saveCrop({
        id: editCropId,
        common_name: commonName.trim(),
        scientific_name: scientificName.trim() || null,
        variety_name: varietyName.trim() || null,
        crop_metadata: cropMetadata,
      });
      if (!crop) throw new Error(t("cropDataForm.noActiveCompany"));

      const camp = await savePlotCampaign({
        id: editCampaignId,
        plot_id: plot.id,
        crop_id: crop.id,
        campaign_year: activeCampaign,
        declared_area_ha: areaNum as number,
        reference_parcel_external_id: refParcel.trim() || null,
        agricultural_parcel_external_id: agriParcel.trim() || null,
        crop_external_code: cropCode.trim() || null,
        variety_external_code: varietyCode.trim() || null,
      });
      if (!camp) throw new Error(t("cropDataForm.noActiveCompany"));

      setEsito("ok");
      setReloadKey((k) => k + 1); // ricarica le campagne del plot (nuova annata)
      onSaved?.();
    } catch (e) {
      setEsito("errore");
      setErroreMsg(
        e instanceof Error ? e.message : t("cropDataForm.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Annata della Campagna Agraria */}
      <div className="flex items-center justify-between rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
          {t("cropDataForm.campaignYear")}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void setActiveCampaign(activeCampaign - 1)}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-3)] hover:bg-[var(--panel)]"
            aria-label={t("cropDataForm.previousYear")}
          >
            −
          </button>
          <span className="agro-num min-w-[3ch] text-center text-sm font-semibold">
            {activeCampaign}
          </span>
          <button
            type="button"
            onClick={() => void setActiveCampaign(activeCampaign + 1)}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-3)] hover:bg-[var(--panel)]"
            aria-label={t("cropDataForm.nextYear")}
          >
            +
          </button>
        </div>
      </div>

      {copiedFrom != null && (
        <p className="rounded-[var(--r-2)] border border-[var(--accent-bd)] bg-[var(--accent-l)] px-3 py-2 text-xs text-[var(--accent)]">
          {t("cropDataForm.prefilledFromCampaign", {
            copiedFrom,
            campaignYear: activeCampaign,
          })}
        </p>
      )}

      {/* Quick-pick specie dal catalogo nazionale (se disponibile) */}
      {cropCatalog.length > 0 && (
        <div>
          <Label htmlFor="crop-catalog">
            {t("cropDataForm.speciesFromCatalog", { countryCode })}
          </Label>
          <Select
            id="crop-catalog"
            value={cropCode}
            onChange={(e) => selezionaSpecieCatalogo(e.target.value)}
          >
            <option value="">{t("cropDataForm.selectFromNationalRegister")}</option>
            {cropCatalog.map((v) => (
              <option key={v.id} value={v.code}>
                {v.name}
                {v.code ? ` · ${v.code}` : ""}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* Tipo crop: una scheda diversa per tipo */}
      <div>
        <Label>{t("cropDataForm.cropType")}</Label>
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          {allCropFormSchemas(t).map((s) => (
            <button
              key={s.category}
              type="button"
              onClick={() => selezionaCategoria(s.category)}
              className={
                "flex flex-col items-center gap-1 rounded-[var(--r-2)] border px-2 py-2 text-xs font-medium " +
                (category === s.category
                  ? "border-[var(--accent-bd)] bg-[var(--accent-l)] text-[var(--accent)]"
                  : "border-[var(--line)] bg-[var(--panel)] text-[var(--ink-2)]")
              }
            >
              <span className="text-lg leading-none">{s.emoji}</span>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {!schema ? (
        <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] p-3 text-sm text-[var(--ink-3)]">
          {t("cropDataForm.chooseCropTypeHint")}
        </p>
      ) : (
        <>
          {/* Identità della specie (tabella crops) */}
          <section className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("cropDataForm.speciesLabel", { label: schema.label })}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="crop-common">{t("cropDataForm.commonName")}</Label>
                <Input
                  id="crop-common"
                  value={commonName}
                  onChange={(e) => setCommonName(e.target.value)}
                  placeholder={schema.commonName}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="crop-variety">{schema.varietyLabel}</Label>
                {varietyOptions.length > 0 && (
                  <Select
                    aria-label={t("cropDataForm.varietyFromCatalog")}
                    value={varietyCode}
                    onChange={(e) => selezionaVarietaCatalogo(e.target.value)}
                  >
                    <option value="">{t("cropDataForm.fromCatalog")}</option>
                    {varietyOptions.map((v) => (
                      <option key={v.id} value={v.code}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                )}
                <Input
                  id="crop-variety"
                  value={varietyName}
                  onChange={(e) => setVarietyName(e.target.value)}
                  placeholder={t("cropDataForm.varietyPlaceholder")}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="crop-sci">{t("cropDataForm.scientificName")}</Label>
              <Input
                id="crop-sci"
                value={scientificName}
                onChange={(e) => setScientificName(e.target.value)}
                placeholder={schema.scientificName || t("cropDataForm.scientificNamePlaceholder")}
              />
            </div>
          </section>

          {/* Campi di filiera specifici → crop_metadata */}
          {schema.metaFields.length > 0 && (
            <section className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
                {t("cropDataForm.detailsLabel", { label: schema.label.toLowerCase() })}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {schema.metaFields.map((f) => (
                  <div key={f.key}>
                    <Label htmlFor={`meta-${f.key}`}>{f.label}</Label>
                    {f.type === "select" ? (
                      <Select
                        id={`meta-${f.key}`}
                        value={meta[f.key] ?? ""}
                        onChange={(e) => setMetaField(f.key, e.target.value)}
                      >
                        <option value="">—</option>
                        {(f.options ?? []).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        id={`meta-${f.key}`}
                        type={f.type === "number" ? "number" : "text"}
                        inputMode={f.type === "number" ? "decimal" : undefined}
                        value={meta[f.key] ?? ""}
                        onChange={(e) => setMetaField(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        className={f.type === "number" ? "agro-num" : undefined}
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Stato annuale (tabella plots_campaign) */}
          <section className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("cropDataForm.campaignDeclarativeData", { campaignYear: activeCampaign })}
            </p>
            {isAnnuale && (
              <div className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-xs">
                <span className="font-semibold text-[var(--ink-3)]">
                  {t("cropDataForm.sowingDate")}
                </span>
                <span className="text-[var(--ink-4)]">
                  {": "}
                  {ultimaSemina
                    ? new Date(ultimaSemina).toLocaleDateString("it-IT")
                    : "—"}
                </span>
                <p className="mt-0.5 text-[10px] text-[var(--ink-4)]">
                  {t("cropDataForm.sowingHint")}
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="camp-area">{t("cropDataForm.declaredArea")}</Label>
                <Input
                  id="camp-area"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={declaredArea}
                  onChange={(e) => setDeclaredArea(e.target.value)}
                  className="agro-num"
                  aria-invalid={!areaValida || undefined}
                />
              </div>
              <div>
                <Label htmlFor="camp-cropcode">{t("cropDataForm.cropCode")}</Label>
                <Input
                  id="camp-cropcode"
                  value={cropCode}
                  onChange={(e) => setCropCode(e.target.value)}
                  placeholder={t("cropDataForm.cropCodePlaceholder")}
                  className="agro-num"
                />
              </div>
              <div>
                <Label htmlFor="camp-varcode">{t("cropDataForm.varietyCode")}</Label>
                <Input
                  id="camp-varcode"
                  value={varietyCode}
                  onChange={(e) => setVarietyCode(e.target.value)}
                  className="agro-num"
                />
              </div>
              <div>
                <Label htmlFor="camp-ref">{t("cropDataForm.referenceParcel")}</Label>
                <Input
                  id="camp-ref"
                  value={refParcel}
                  onChange={(e) => setRefParcel(e.target.value)}
                  className="agro-num"
                />
              </div>
              <div>
                <Label htmlFor="camp-agri">{t("cropDataForm.agriculturalParcel")}</Label>
                <Input
                  id="camp-agri"
                  value={agriParcel}
                  onChange={(e) => setAgriParcel(e.target.value)}
                  className="agro-num"
                />
              </div>
            </div>
          </section>

          {esito === "errore" && (
            <p className="rounded-[var(--r-2)] bg-[var(--danger-l)] p-2 text-sm text-[var(--danger)]">
              {erroreMsg}
            </p>
          )}
          {esito === "ok" && (
            <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] p-2 text-sm text-[var(--accent)]">
              {t("cropDataForm.cropSaved", { campaignYear: activeCampaign })}
            </p>
          )}

          <Button
            className="min-h-[var(--touch-min)]"
            disabled={!canSave}
            onClick={() => void salva()}
          >
            {saving
              ? t("logbook.common.saving")
              : editCampaignId
                ? t("cropDataForm.updateCrop")
                : t("cropDataForm.saveCrop")}
          </Button>
        </>
      )}
    </div>
  );
}
