import {
  type Warehouse,
  WAREHOUSE_KINDS,
  useAgroStore,
  useReadOnly,
} from "@agrogea/core";
import type { MapController } from "@geolibre/map";
import { Button, Input, Label, Select, cn } from "@geolibre/ui";
import type { TFunction } from "i18next";
import { MapPin, Pencil, Trash2 } from "lucide-react";
import {
  type FormEvent,
  type RefObject,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/**
 * Etichetta della tipologia di deposito. `warehouse_type` è testo libero a DB
 * (le tipologie sono aziendali, non normative): quelle fuori dall'elenco
 * canonico si mostrano come sono, invece di stampare una chiave i18n mancante.
 */
function kindLabel(t: TFunction, kind: string): string {
  return (WAREHOUSE_KINDS as readonly string[]).includes(kind)
    ? t(`warehouseSheet.kind.${kind}` as never)
    : kind;
}

/**
 * Anagrafica dei MAGAZZINI (i luoghi, non il loro contenuto): elenco, creazione
 * e modifica. Ogni magazzino può avere un punto sulla mappa — si posa toccando
 * la mappa mentre il form è aperto — e da quel momento diventa un POI cliccabile
 * che riapre questa stessa scheda filtrata sul deposito (vedi
 * `components/WarehouseMarkers.tsx`).
 *
 * Il posizionamento riusa il pattern del rilievo scouting: un flag nello store
 * (`warehousePlacing`) inibisce la selezione globale delle feature, così il tap
 * serve a posare il punto e non apre la scheda dell'appezzamento sottostante.
 */
export function WarehouseManager({
  onBack,
  mapControllerRef,
}: {
  onBack: () => void;
  mapControllerRef?: RefObject<MapController | null>;
}) {
  const { t } = useTranslation();
  const warehouses = useAgroStore((s) => s.warehouses);
  const lots = useAgroStore((s) => s.lots);
  const saveWarehouse = useAgroStore((s) => s.saveWarehouse);
  const deleteWarehouse = useAgroStore((s) => s.deleteWarehouse);
  const readOnly = useReadOnly(useAgroStore((s) => s.activeCompanyId));

  const [editing, setEditing] = useState<Warehouse | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Lotti con giacenza per magazzino: quantifica "che cosa c'è dentro". */
  const lotCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lot of lots) {
      if (lot.deleted_at != null || !lot.warehouse_id) continue;
      if (Number(lot.quantity_on_hand) <= 0) continue;
      counts.set(lot.warehouse_id, (counts.get(lot.warehouse_id) ?? 0) + 1);
    }
    return counts;
  }, [lots]);

  if (editing) {
    return (
      <WarehouseForm
        warehouse={editing === "new" ? null : editing}
        mapControllerRef={mapControllerRef}
        onCancel={() => setEditing(null)}
        onSubmit={async (input) => {
          setError(null);
          try {
            await saveWarehouse(input);
            setEditing(null);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-xs text-[var(--accent)]"
      >
        {t("warehouseSheet.backToProducts")}
      </button>

      {error && (
        <p className="rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}

      {warehouses.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--ink-3)]">
          {t("warehouseSheet.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {warehouses.map((w) => (
            <li
              key={w.id}
              className="flex items-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {w.name}
                </span>
                <span className="block truncate text-xs text-[var(--ink-3)]">
                  {kindLabel(t, w.warehouse_type)}
                  {" · "}
                  {t("warehouseSheet.lotsInStock", {
                    count: lotCounts.get(w.id) ?? 0,
                  })}
                  {w.geometry ? "" : ` · ${t("warehouseSheet.noPosition")}`}
                </span>
              </span>
              {w.geometry && (
                <MapPin size={14} className="shrink-0 text-[var(--accent)]" />
              )}
              <button
                type="button"
                onClick={() => setEditing(w)}
                title={t("warehouseSheet.edit")}
                aria-label={t("warehouseSheet.edit")}
                disabled={readOnly}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-2)] text-[var(--ink-3)] hover:bg-[var(--panel-2)] disabled:opacity-40"
              >
                <Pencil size={15} />
              </button>
              <button
                type="button"
                onClick={() => void deleteWarehouse(w.id)}
                title={t("warehouseSheet.delete")}
                aria-label={t("warehouseSheet.delete")}
                disabled={readOnly}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-2)] text-[#dc2626] hover:bg-[var(--danger-l,#fee2e2)] disabled:opacity-40"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-[var(--ink-3)]">
        {t("warehouseSheet.deleteNotice")}
      </p>

      <Button
        type="button"
        disabled={readOnly}
        onClick={() => setEditing("new")}
        className="min-h-[var(--touch-min)]"
      >
        ＋ {t("warehouseSheet.newWarehouse")}
      </Button>
    </div>
  );
}

interface WarehouseFormInput {
  id?: string;
  name: string;
  warehouse_type: string;
  geometry: Warehouse["geometry"];
  address: string | null;
  notes: string | null;
}

function WarehouseForm({
  warehouse,
  mapControllerRef,
  onSubmit,
  onCancel,
}: {
  warehouse: Warehouse | null;
  mapControllerRef?: RefObject<MapController | null>;
  onSubmit: (input: WarehouseFormInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const setWarehousePlacing = useAgroStore((s) => s.setWarehousePlacing);
  const [name, setName] = useState(warehouse?.name ?? "");
  const [kind, setKind] = useState(warehouse?.warehouse_type ?? "general");
  const [address, setAddress] = useState(warehouse?.address ?? "");
  const [notes, setNotes] = useState(warehouse?.notes ?? "");
  const [geometry, setGeometry] = useState<Warehouse["geometry"]>(
    warehouse?.geometry ?? null,
  );
  const [placing, setPlacing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Attesa del tap sulla mappa. `once` basta: si posa un punto per volta, e il
  // cleanup toglie sempre il flag globale — anche se il pannello si smonta a
  // metà, altrimenti la mappa resterebbe insensibile ai click successivi.
  useEffect(() => {
    const map = mapControllerRef?.current?.getMap();
    if (!map || !placing) return;
    setWarehousePlacing(true);
    const handler = (e: { lngLat: { lng: number; lat: number } }) => {
      setGeometry({
        type: "Point",
        coordinates: [e.lngLat.lng, e.lngLat.lat],
      });
      setPlacing(false);
      setWarehousePlacing(false);
    };
    map.once("click", handler);
    return () => {
      setWarehousePlacing(false);
      map.off("click", handler as Parameters<typeof map.off>[1]);
    };
  }, [placing, mapControllerRef, setWarehousePlacing]);

  const canSave = name.trim().length > 0 && !saving;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      await onSubmit({
        id: warehouse?.id,
        name: name.trim(),
        warehouse_type: kind,
        geometry,
        address: address.trim() || null,
        notes: notes.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wh-name">{t("warehouseSheet.name")}</Label>
        <Input
          id="wh-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("warehouseSheet.namePlaceholder")}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wh-kind">{t("warehouseSheet.type")}</Label>
        <Select
          id="wh-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {WAREHOUSE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`warehouseSheet.kind.${k}` as never)}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wh-address">{t("warehouseSheet.address")}</Label>
        <Input
          id="wh-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </div>

      {/* Posizione sulla mappa: opzionale, ma è ciò che rende il magazzino un
          POI cliccabile. Senza mappa disponibile (pannello staccato) il blocco
          resta informativo. */}
      <section className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
          {t("warehouseSheet.position")}
        </p>
        <p className="agro-num text-xs text-[var(--ink-3)]">
          {geometry
            ? `${geometry.coordinates[1].toFixed(5)}, ${geometry.coordinates[0].toFixed(5)}`
            : t("warehouseSheet.noPosition")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!mapControllerRef?.current}
            onClick={() => setPlacing((v) => !v)}
            className={cn(
              "min-h-[36px] gap-1.5 px-2 text-xs",
              placing && "border-[var(--accent)] text-[var(--accent)]",
            )}
          >
            <MapPin size={14} />
            {placing
              ? t("warehouseSheet.tapMapEllipsis")
              : t("warehouseSheet.tapMap")}
          </Button>
          {geometry && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setGeometry(null)}
              className="min-h-[36px] px-2 text-xs"
            >
              {t("warehouseSheet.clearPosition")}
            </Button>
          )}
        </div>
      </section>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wh-notes">{t("warehouse.notes")}</Label>
        <textarea
          id="wh-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="resize-none rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          type="submit"
          disabled={!canSave}
          className="min-h-[var(--touch-min)] flex-1"
        >
          {saving ? t("logbook.common.saving") : t("warehouseSheet.save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="min-h-[var(--touch-min)]"
        >
          {t("logbook.common.cancel")}
        </Button>
      </div>
    </form>
  );
}
