import {
  type AppLocale,
  type AreaUnit,
  type DashboardModuleId,
  type WaterUnit,
  type YieldUnit,
  useSettingsStore,
} from "@agrogea/core";
import { Button, Label, Select, cn } from "@geolibre/ui";
import {
  Building2,
  CloudSun,
  Database,
  Droplets,
  FileDown,
  Globe,
  Grid3x3,
  Languages,
  Layers,
  Leaf,
  type LucideIcon,
  Map as MapIcon,
  Mountain,
  MousePointerClick,
  NotebookPen,
  Plus,
  Printer,
  Ruler,
  Satellite,
  ShieldCheck,
  Sprout,
  TableProperties,
  Warehouse,
  Wheat,
  X,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { setLocale } from "../i18n";
import { STANDALONE } from "../standalone";

/**
 * Moduli proprietari/cloud nascosti dai toggle nelle build standalone/OSS.
 * L'export SIAN resta disponibile anche nell'edizione open (CSV puro da PGlite
 * locale): qui solo GeoCompliance (due diligence territoriale, modulo cloud).
 */
const CLOUD_MODULE_IDS: ReadonlySet<DashboardModuleId> = new Set<DashboardModuleId>([
  "panelGeoCompliance",
]);

/**
 * Pagina di gestione delle Impostazioni di Sistema (Modulo Profilo). Pannello
 * a tutto schermo, organizzato in schede (Card) verticali, raggiunto dal menù
 * profilo della Top Bar e dalla Command Palette.
 *
 *   §1 Personalizzazione interfaccia & moduli GeoLibre (toggle granulari che
 *      pilotano la visibilità di pannelli, strumenti e basemap a schermo);
 *   §2 Localizzazione, lingua (i18n) e unità di misura agronomiche.
 *
 * Edizione standalone/OSS, single-user locale: nessun account remoto, nessuna
 * autenticazione, nessuna gestione multi-utente o abbonamento. Le preferenze
 * sono governate da `useSettingsStore` (local-first): ogni toggle salva
 * all'istante nel DB locale del dispositivo.
 */

// ---------------------------------------------------------------------------
// Catalogo dei moduli attivabili (etichette + icone, raggruppati per area)
// ---------------------------------------------------------------------------

interface ModuleItem {
  id: DashboardModuleId;
  Icon: LucideIcon;
  /** Feature ancora in arrivo: mostrata ma non attivabile. */
  comingSoon?: boolean;
}

interface ModuleGroup {
  id: string;
  items: ModuleItem[];
}

const MODULE_GROUPS: ModuleGroup[] = [
  {
    id: "pannelli",
    items: [
      { id: "panelNdvi", Icon: Satellite },
      { id: "panelVra", Icon: Grid3x3 },
      { id: "panelColtura", Icon: Leaf },
      { id: "panelAcqua", Icon: Droplets },
      { id: "panelQuaderno", Icon: NotebookPen },
      { id: "panelRaccolta", Icon: Wheat },
      { id: "panelMagazzino", Icon: Warehouse },
      { id: "panelSian", Icon: FileDown },
      { id: "panelStampa", Icon: Printer },
      { id: "panelRegistro", Icon: MousePointerClick },
      { id: "panelAnagrafica", Icon: Building2 },
      { id: "panelMeteo", Icon: CloudSun },
      { id: "panelGeoCompliance", Icon: ShieldCheck },
    ],
  },
  {
    id: "header",
    items: [
      { id: "headerMeteoCard", Icon: CloudSun },
      { id: "headerAddData", Icon: Plus },
      { id: "headerSyncLed", Icon: Database },
    ],
  },
  {
    id: "mappa",
    items: [
      { id: "mapMeasure", Icon: Ruler },
      { id: "mapAttributeTable", Icon: TableProperties },
      { id: "mapTerrain", Icon: Mountain },
      { id: "mapGeolocate", Icon: MapIcon },
      { id: "mapScale", Icon: Ruler },
      { id: "mapLayerControl", Icon: Layers },
      { id: "mapBasemapSatellite", Icon: Satellite },
      { id: "mapBasemapCadastre", Icon: Grid3x3 },
      { id: "mapBasemapWayback", Icon: Satellite },
      { id: "mapSplitScreen", Icon: Layers, comingSoon: true },
    ],
  },
];

/** Titolo del gruppo di moduli, tradotto a runtime a partire dall'id stabile. */
function moduleGroupTitle(t: TFunction, groupId: string): string {
  const GROUP_TITLE: Record<string, string> = {
    pannelli: t("userProfileSettingsPage.moduleGroup.panels"),
    header: t("userProfileSettingsPage.moduleGroup.header"),
    mappa: t("userProfileSettingsPage.moduleGroup.map"),
  };
  return GROUP_TITLE[groupId] ?? groupId;
}

/** Etichetta e descrizione di un modulo, tradotte a runtime a partire dall'id stabile. */
function moduleItemText(t: TFunction, id: DashboardModuleId): { label: string; descr: string } {
  const MODULE_TEXT: Record<DashboardModuleId, { label: string; descr: string }> = {
    panelNdvi: { label: t("userProfileSettingsPage.module.panelNdvi.label"), descr: t("userProfileSettingsPage.module.panelNdvi.descr") },
    panelVra: { label: t("userProfileSettingsPage.module.panelVra.label"), descr: t("userProfileSettingsPage.module.panelVra.descr") },
    panelColtura: { label: t("userProfileSettingsPage.module.panelColtura.label"), descr: t("userProfileSettingsPage.module.panelColtura.descr") },
    panelAcqua: { label: t("userProfileSettingsPage.module.panelAcqua.label"), descr: t("userProfileSettingsPage.module.panelAcqua.descr") },
    panelQuaderno: { label: t("userProfileSettingsPage.module.panelQuaderno.label"), descr: t("userProfileSettingsPage.module.panelQuaderno.descr") },
    panelRaccolta: { label: t("userProfileSettingsPage.module.panelRaccolta.label"), descr: t("userProfileSettingsPage.module.panelRaccolta.descr") },
    panelMagazzino: { label: t("userProfileSettingsPage.module.panelMagazzino.label"), descr: t("userProfileSettingsPage.module.panelMagazzino.descr") },
    panelSian: { label: t("userProfileSettingsPage.module.panelSian.label"), descr: t("userProfileSettingsPage.module.panelSian.descr") },
    panelStampa: { label: t("userProfileSettingsPage.module.panelStampa.label"), descr: t("userProfileSettingsPage.module.panelStampa.descr") },
    panelRegistro: { label: t("userProfileSettingsPage.module.panelRegistro.label"), descr: t("userProfileSettingsPage.module.panelRegistro.descr") },
    panelAnagrafica: { label: t("userProfileSettingsPage.module.panelAnagrafica.label"), descr: t("userProfileSettingsPage.module.panelAnagrafica.descr") },
    panelMeteo: { label: t("userProfileSettingsPage.module.panelMeteo.label"), descr: t("userProfileSettingsPage.module.panelMeteo.descr") },
    panelGeoCompliance: { label: t("userProfileSettingsPage.module.panelGeoCompliance.label"), descr: t("userProfileSettingsPage.module.panelGeoCompliance.descr") },
    headerMeteoCard: { label: t("userProfileSettingsPage.module.headerMeteoCard.label"), descr: t("userProfileSettingsPage.module.headerMeteoCard.descr") },
    headerAddData: { label: t("userProfileSettingsPage.module.headerAddData.label"), descr: t("userProfileSettingsPage.module.headerAddData.descr") },
    headerSyncLed: { label: t("userProfileSettingsPage.module.headerSyncLed.label"), descr: t("userProfileSettingsPage.module.headerSyncLed.descr") },
    mapMeasure: { label: t("userProfileSettingsPage.module.mapMeasure.label"), descr: t("userProfileSettingsPage.module.mapMeasure.descr") },
    mapAttributeTable: { label: t("userProfileSettingsPage.module.mapAttributeTable.label"), descr: t("userProfileSettingsPage.module.mapAttributeTable.descr") },
    mapTerrain: { label: t("userProfileSettingsPage.module.mapTerrain.label"), descr: t("userProfileSettingsPage.module.mapTerrain.descr") },
    mapGeolocate: { label: t("userProfileSettingsPage.module.mapGeolocate.label"), descr: t("userProfileSettingsPage.module.mapGeolocate.descr") },
    mapScale: { label: t("userProfileSettingsPage.module.mapScale.label"), descr: t("userProfileSettingsPage.module.mapScale.descr") },
    mapLayerControl: { label: t("userProfileSettingsPage.module.mapLayerControl.label"), descr: t("userProfileSettingsPage.module.mapLayerControl.descr") },
    mapBasemapSatellite: { label: t("userProfileSettingsPage.module.mapBasemapSatellite.label"), descr: t("userProfileSettingsPage.module.mapBasemapSatellite.descr") },
    mapBasemapCadastre: { label: t("userProfileSettingsPage.module.mapBasemapCadastre.label"), descr: t("userProfileSettingsPage.module.mapBasemapCadastre.descr") },
    mapBasemapWayback: { label: t("userProfileSettingsPage.module.mapBasemapWayback.label"), descr: t("userProfileSettingsPage.module.mapBasemapWayback.descr") },
    mapSplitScreen: { label: t("userProfileSettingsPage.module.mapSplitScreen.label"), descr: t("userProfileSettingsPage.module.mapSplitScreen.descr") },
  };
  return MODULE_TEXT[id] ?? { label: id, descr: "" };
}

// ---------------------------------------------------------------------------
// Etichette localizzazione
// ---------------------------------------------------------------------------

const LOCALE_LABEL: Record<AppLocale, string> = {
  it: "Italiano",
  en: "English",
  es: "Español",
  fr: "Français",
};

function areaLabel(t: TFunction, unit: AreaUnit): string {
  const AREA_LABEL: Record<AreaUnit, string> = {
    ha: t("userProfileSettingsPage.unit.ha"),
    ac: t("userProfileSettingsPage.unit.ac"),
  };
  return AREA_LABEL[unit];
}

function yieldLabel(t: TFunction, unit: YieldUnit): string {
  const YIELD_LABEL: Record<YieldUnit, string> = {
    q: t("userProfileSettingsPage.unit.q"),
    t: t("userProfileSettingsPage.unit.t"),
    kg: t("userProfileSettingsPage.unit.kg"),
  };
  return YIELD_LABEL[unit];
}

function waterLabel(t: TFunction, unit: WaterUnit): string {
  const WATER_LABEL: Record<WaterUnit, string> = {
    mm: t("userProfileSettingsPage.unit.mm"),
    hl: t("userProfileSettingsPage.unit.hl"),
  };
  return WATER_LABEL[unit];
}

// ---------------------------------------------------------------------------
// Sotto-componenti
// ---------------------------------------------------------------------------

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--sh-1)]">
      <h2 className="text-[17px] font-semibold text-[var(--ink)]">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-[var(--ink-3)]">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Toggle accessibile (role="switch") con accento biopunk. */
function ToggleRow({ item }: { item: ModuleItem }) {
  const { t } = useTranslation();
  const enabled = useSettingsStore((s) => s.dashboardLayout[item.id] !== false);
  const toggleModule = useSettingsStore((s) => s.toggleModule);
  const disabled = item.comingSoon;
  const on = enabled && !disabled;
  const { label, descr } = moduleItemText(t, item.id);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[var(--r-2)] px-2 py-2",
        !disabled && "hover:bg-[var(--panel-2)]",
        disabled && "opacity-60",
      )}
    >
      <item.Icon size={16} className="shrink-0 text-[var(--accent)]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
          {label}
          {disabled && (
            <span className="rounded-full bg-[var(--panel-3)] px-1.5 text-[10px] text-[var(--ink-4)]">
              {t("userProfileSettingsPage.comingSoon")}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-[var(--ink-4)]">{descr}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => toggleModule(item.id)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          on ? "bg-[var(--accent)]" : "bg-[var(--line-2)]",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-[var(--sh-1)] transition-transform",
            on ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

export function UserProfileSettingsPage({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();

  const units = useSettingsStore((s) => s.units);
  const setUnits = useSettingsStore((s) => s.setUnits);
  const remoteSync = useSettingsStore((s) => s.remoteSync);
  const resetLayout = useSettingsStore((s) => s.resetLayout);

  const syncLabel =
    remoteSync === "saving"
      ? t("userProfileSettingsPage.sync.syncing")
      : remoteSync === "saved"
        ? t("userProfileSettingsPage.sync.synced")
        : remoteSync === "error"
          ? t("userProfileSettingsPage.sync.error")
          : remoteSync === "offline"
            ? t("userProfileSettingsPage.sync.offline")
            : t("userProfileSettingsPage.sync.auto");

  return (
    <div className="absolute inset-0 z-40 overflow-y-auto bg-[var(--bg,var(--panel-2))]">
      {/* Header della pagina */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--line)] bg-[var(--panel)] px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-[var(--r-2)] bg-[var(--accent)] text-white">
          <Sprout size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-semibold">{t("userProfileSettingsPage.header.title")}</h1>
          <p className="truncate text-xs text-[var(--ink-4)]">{syncLabel}</p>
        </div>
        <button
          type="button"
          aria-label={t("userProfileSettingsPage.header.closeAria")}
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-[var(--r-2)] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
        >
          <X size={20} />
        </button>
      </header>

      <main className="mx-auto flex max-w-[760px] flex-col gap-4 p-4">
        {/* §1 — Personalizzazione interfaccia & moduli GeoLibre */}
        <Card
          title={t("userProfileSettingsPage.interface.title")}
          subtitle={t("userProfileSettingsPage.interface.subtitle")}
        >
          <div className="flex flex-col gap-5">
            {MODULE_GROUPS.map((group) => {
              // In standalone i moduli cloud (SIAN/GeoCompliance) non sono
              // attivabili: si rimuovono anche i loro toggle. Un gruppo che
              // resta senza item sparisce.
              const items = STANDALONE
                ? group.items.filter((item) => !CLOUD_MODULE_IDS.has(item.id))
                : group.items;
              if (items.length === 0) return null;
              return (
                <div key={group.id}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
                    {moduleGroupTitle(t, group.id)}
                  </p>
                  <div className="flex flex-col">
                    {items.map((item) => (
                      <ToggleRow key={item.id} item={item} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 border-t border-[var(--line)] pt-3">
            <Button variant="ghost" onClick={resetLayout}>
              {t("userProfileSettingsPage.interface.resetLayout")}
            </Button>
          </div>
        </Card>

        {/* §2 — Localizzazione, lingua e unità di misura */}
        <Card title={t("userProfileSettingsPage.locale.title")} subtitle={t("userProfileSettingsPage.locale.subtitle")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pf-lingua" className="flex items-center gap-1.5">
                <Languages size={14} /> {t("userProfileSettingsPage.locale.language")}
              </Label>
              <Select
                id="pf-lingua"
                value={i18n.language?.slice(0, 2) ?? "it"}
                onChange={(e) => setLocale(e.target.value as AppLocale)}
              >
                {(["it", "en", "es", "fr"] as AppLocale[]).map((code) => (
                  <option key={code} value={code}>
                    {LOCALE_LABEL[code]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pf-area" className="flex items-center gap-1.5">
                <Globe size={14} /> {t("userProfileSettingsPage.locale.area")}
              </Label>
              <Select
                id="pf-area"
                value={units.area}
                onChange={(e) => setUnits({ area: e.target.value as AreaUnit })}
              >
                {(["ha", "ac"] as AreaUnit[]).map((u) => (
                  <option key={u} value={u}>
                    {areaLabel(t, u)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pf-resa" className="flex items-center gap-1.5">
                <Wheat size={14} /> {t("userProfileSettingsPage.locale.yield")}
              </Label>
              <Select
                id="pf-resa"
                value={units.yield}
                onChange={(e) => setUnits({ yield: e.target.value as YieldUnit })}
              >
                {(["q", "t", "kg"] as YieldUnit[]).map((u) => (
                  <option key={u} value={u}>
                    {yieldLabel(t, u)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pf-acqua" className="flex items-center gap-1.5">
                <Droplets size={14} /> {t("userProfileSettingsPage.locale.water")}
              </Label>
              <Select
                id="pf-acqua"
                value={units.water}
                onChange={(e) => setUnits({ water: e.target.value as WaterUnit })}
              >
                {(["mm", "hl"] as WaterUnit[]).map((u) => (
                  <option key={u} value={u}>
                    {waterLabel(t, u)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
