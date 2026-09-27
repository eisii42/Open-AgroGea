import {
  type InfrastructureAsset,
  type Plot,
  type SoilSample,
  type SelectableKind,
  type SelectedFeatureRef,
  useAgroStore,
} from "@agrogea/core";
import { FieldSheet } from "@agrogea/ui";
import { Button, Input, Label, Select } from "@geolibre/ui";
import { Pencil, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useReadOnly } from "@agrogea/core";
import { ComplianceBadges } from "../modules/compliance/ComplianceBadges";
import {
  mergeSoilMetadata,
  readSoilForm,
  SoilCompositionSection,
  type SoilForm,
} from "../modules/soil/SoilCompositionSection";
import { SafetyDeleteModal } from "./SafetyDeleteModal";

/**
 * Scheda di dettaglio/editing di un elemento esistente (Modulo 4). Si apre alla
 * selezione sulla mappa, pre-compilata col record del DAL:
 *   * editing alfanumerico → UPDATE su PGlite (preserva i campi non toccati);
 *   * editing spaziale → "Modifica geometria" attiva il trascinamento dei
 *     vertici nell'engine, con area ricalcolata in tempo reale;
 *   * eliminazione → cancellazione protetta (digita il name esatto).
 */

const TIPI_ASSET = [
  "condotta",
  "recinzione",
  "rete-antigrandine",
  "strada",
  "pozzo",
  "trappola",
  "sensore-iot",
  "ingresso",
  "fabbricato",
  "generico",
];

export function DetailEditSheet({
  selected,
}: {
  selected: SelectedFeatureRef;
}) {
  const plots = useAgroStore((s) => s.plots);
  const assets = useAgroStore((s) => s.assets);
  const soilSamples = useAgroStore((s) => s.soilSamples);

  if (selected.kind === "appezzamento") {
    const record = plots.find((a) => a.id === selected.id);
    if (!record) return null;
    return <PlotEdit record={record} />;
  }
  if (selected.kind === "infrastruttura") {
    const record = assets.find((a) => a.id === selected.id);
    if (!record) return null;
    return <AssetEdit record={record} />;
  }
  const record = soilSamples.find((c) => c.id === selected.id);
  if (!record) return null;
  return <SoilSampleEdit record={record} />;
}

// ---------------------------------------------------------------------------
// Controlli condivisi: editing geometria + zona pericolo (eliminazione)
// ---------------------------------------------------------------------------

/**
 * Avvio/salvataggio/annullo dell'editing spaziale NATIVO di un elemento. Le
 * azioni impostano solo marcatore/richieste nello store: il motore nativo
 * (`startLayerGeometryEdit`/`endLayerGeometryEdit`) e la persistenza sul DAL
 * sono orchestrati da `useFieldPlugins`, l'unico che possiede l'app API mappa.
 */
function useGeomEdit(kind: SelectableKind, id: string) {
  const geomEdit = useAgroStore((s) => s.geomEdit);
  const startGeometryEdit = useAgroStore((s) => s.startGeometryEdit);
  const requestSaveGeometry = useAgroStore((s) => s.requestSaveGeometry);
  const requestCancelGeometry = useAgroStore((s) => s.requestCancelGeometry);
  const openPanels = useAgroStore((s) => s.openPanels);
  const togglePanel = useAgroStore((s) => s.togglePanel);

  const editingThis = geomEdit?.id === id;

  const start = () => {
    // La suite di disegno deve essere attiva perché l'engine carichi la feature.
    if (!openPanels.includes("geoeditor")) togglePanel("geoeditor");
    startGeometryEdit(kind, id);
  };
  const save = () => requestSaveGeometry();
  const cancel = () => requestCancelGeometry();

  return { editingThis, start, save, cancel };
}

function GeometryEditRow({
  ctrl,
  liveAreaLabel,
}: {
  ctrl: ReturnType<typeof useGeomEdit>;
  liveAreaLabel?: string;
}) {
  const { t } = useTranslation();
  if (ctrl.editingThis) {
    return (
      <div className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--accent)] bg-[var(--accent-l)] p-2">
        <p className="text-[12px] text-[var(--accent)]">
          {t("detailEditSheet.dragVertices")}
          {liveAreaLabel ? ` ${liveAreaLabel}` : ""}
        </p>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => void ctrl.cancel()}
          >
            {t("logbook.common.cancel")}
          </Button>
          <Button className="flex-1" onClick={() => void ctrl.save()}>
            {t("detailEditSheet.saveGeometry")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <Button variant="ghost" className="w-full justify-start" onClick={ctrl.start}>
      <Pencil size={15} className="mr-2" /> {t("detailEditSheet.editGeometry")}
    </Button>
  );
}

function DangerZone({
  kind,
  id,
  elementName,
}: {
  kind: SelectableKind;
  id: string;
  elementName: string;
}) {
  const { t } = useTranslation();
  const deleteElement = useAgroStore((s) => s.deleteElement);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-[var(--r-2)] border border-[#dc2626]/40 px-3 py-2 text-sm font-medium text-[#dc2626] hover:bg-[#dc2626]/10"
      >
        <Trash2 size={15} /> {t("detailEditSheet.deleteElement")}
      </button>
      <SafetyDeleteModal
        open={open}
        elementName={elementName}
        onClose={() => setOpen(false)}
        onConfirm={() => deleteElement(kind, id)}
      />
    </>
  );
}

/** Chiusura pulita: annulla un'eventuale sessione di editing geometria attiva. */
function useCloseDetail(id: string) {
  const clearSelectedFeature = useAgroStore((s) => s.clearSelectedFeature);
  const requestCancelGeometry = useAgroStore((s) => s.requestCancelGeometry);
  return () => {
    // Se si sta editando questo elemento, richiedi l'annullamento: l'editing
    // nativo viene closed da useFieldPlugins (sempre montato) anche dopo che la
    // scheda si chiude.
    if (useAgroStore.getState().geomEdit?.id === id) {
      requestCancelGeometry();
    }
    clearSelectedFeature();
  };
}

// ---------------------------------------------------------------------------
// Form per tipo
// ---------------------------------------------------------------------------

function PlotEdit({ record }: { record: Plot }) {
  const { t } = useTranslation();
  const update = useAgroStore((s) => s.updatePlot);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const readOnly = useReadOnly(activeCompanyId);
  const close = useCloseDetail(record.id);
  const ctrl = useGeomEdit("appezzamento", record.id);

  const [name, setName] = useState(record.user_plot_name);
  const [irrigation, setIrrigation] = useState(record.irrigation_type ?? "");
  const [soil, setSoil] = useState<SoilForm>(() =>
    readSoilForm(record.metadata),
  );
  const [saving, setSaving] = useState(false);

  // L'area è ricalcolata dal DAL al salvataggio (editing nativo: niente area
  // "live" durante il trascinamento). Unico punto di verità: area_ha.
  const area = record.area_ha;

  const setSoilField = (field: keyof SoilForm, value: string) =>
    setSoil((s) => ({ ...s, [field]: value }));

  const submit = async () => {
    setSaving(true);
    try {
      await update(record.id, {
        user_plot_name: name.trim() || record.user_plot_name,
        irrigation_type: irrigation.trim() || null,
        metadata: mergeSoilMetadata(record.metadata, soil),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FieldSheet
      title={record.user_plot_name || t("detailEditSheet.plot")}
      onClose={close}
      footer={
        <div className="flex flex-col gap-2">
          <Button disabled={saving || readOnly} onClick={() => void submit()}>
            {readOnly
              ? t("dataEntrySheet.readOnly")
              : saving
                ? t("logbook.common.saving")
                : t("detailEditSheet.saveChanges")}
          </Button>
          <DangerZone
            kind="appezzamento"
            id={record.id}
            elementName={record.user_plot_name}
          />
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Badge geo-compliance (ZVN / aree protette / EUDR) dell'appezzamento. */}
        <ComplianceBadges plot={record} />
        <div>
          <Label>{t("dataEntrySheet.areaGeodetic")}</Label>
          <div className="agro-num rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
            {area != null ? `${area.toFixed(4)} ha` : "—"}
          </div>
        </div>
        <GeometryEditRow ctrl={ctrl} />
        <div>
          <Label htmlFor="ed-nome">{t("dataEntrySheet.plotName")}</Label>
          <Input
            id="ed-nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="ed-irrig">{t("dataEntrySheet.irrigationType")}</Label>
          <Input
            id="ed-irrig"
            value={irrigation}
            onChange={(e) => setIrrigation(e.target.value)}
          />
        </div>
        <SoilCompositionSection soil={soil} onChange={setSoilField} />
      </div>
    </FieldSheet>
  );
}

function AssetEdit({ record }: { record: InfrastructureAsset }) {
  const { t } = useTranslation();
  const update = useAgroStore((s) => s.updateAsset);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const readOnly = useReadOnly(activeCompanyId);
  const close = useCloseDetail(record.id);
  const ctrl = useGeomEdit("infrastruttura", record.id);

  const [name, setName] = useState(record.name ?? "");
  const [type, setType] = useState(record.asset_type);
  const [category, setCategory] = useState<"fixed" | "mobile">(
    record.category,
  );
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await update(record.id, {
        name: name.trim() || null,
        asset_type: type,
        category: category,
      });
    } finally {
      setSaving(false);
    }
  };

  const elementName = record.name || record.asset_type;

  return (
    <FieldSheet
      title={elementName || t("detailEditSheet.infrastructure")}
      onClose={close}
      footer={
        <div className="flex flex-col gap-2">
          <Button disabled={saving || readOnly} onClick={() => void submit()}>
            {readOnly
              ? t("dataEntrySheet.readOnly")
              : saving
                ? t("logbook.common.saving")
                : t("detailEditSheet.saveChanges")}
          </Button>
          <DangerZone
            kind="infrastruttura"
            id={record.id}
            elementName={elementName}
          />
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {record.length_m != null && (
          <div>
            <Label>{t("dataEntrySheet.lengthGeodetic")}</Label>
            <div className="agro-num rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
              {record.length_m} m
            </div>
          </div>
        )}
        <GeometryEditRow ctrl={ctrl} />
        <div>
          <Label htmlFor="ed-as-tipo">{t("dataEntrySheet.assetType")}</Label>
          <Select
            id="ed-as-tipo"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {[...new Set([type, ...TIPI_ASSET])].map((tipoOpt) => (
              <option key={tipoOpt} value={tipoOpt}>
                {tipoOpt}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ed-as-nome">{t("dataEntrySheet.assetName")}</Label>
          <Input
            id="ed-as-nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="ed-as-cat">{t("detailEditSheet.operationalStatus")}</Label>
          <Select
            id="ed-as-cat"
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as "fixed" | "mobile")
            }
          >
            <option value="fixed">{t("dataEntrySheet.fixed")}</option>
            <option value="mobile">{t("dataEntrySheet.mobile")}</option>
          </Select>
        </div>
      </div>
    </FieldSheet>
  );
}

function SoilSampleEdit({ record }: { record: SoilSample }) {
  const { t } = useTranslation();
  const close = useCloseDetail(record.id);
  const ctrl = useGeomEdit("poi", record.id);
  const elementName = t("detailEditSheet.samplingName", {
    id: record.id.slice(0, 8),
  });
  const [lon, lat] = record.sampling_position.coordinates;

  return (
    <FieldSheet
      title={elementName}
      onClose={close}
      footer={
        <DangerZone kind="poi" id={record.id} elementName={elementName} />
      }
    >
      <div className="flex flex-col gap-3">
        <GeometryEditRow ctrl={ctrl} />
        <Info label={t("detailEditSheet.sampledOn")} value={fmtDate(record.sampled_at)} />
        <Info label={t("detailEditSheet.ph")} value={record.ph != null ? String(record.ph) : "—"} />
        <Info
          label={t("detailEditSheet.organicMatter")}
          value={
            record.organic_matter != null
              ? `${record.organic_matter}%`
              : "—"
          }
        />
        <Info
          label={t("dataEntrySheet.position")}
          value={`${lat.toFixed(5)}, ${lon.toFixed(5)}`}
        />
      </div>
    </FieldSheet>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="agro-num rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
        {value}
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("it-IT");
  } catch {
    return iso;
  }
}
