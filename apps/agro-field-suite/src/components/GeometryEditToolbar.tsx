import { useAgroStore } from "@agrogea/core";
import { type EditMode, enableGeoEditorEditMode } from "@geolibre/plugins";
import { cn } from "@geolibre/ui";
import {
  type LucideIcon,
  Maximize2,
  Minimize2,
  Move,
  PenTool,
  RotateCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Barra degli strumenti di MODIFICA, mostrata solo durante una sessione di
 * editing geometrico (marcatore `geomEdit` nello store). Espone i soli strumenti
 * di modifica del motore nativo GeoLibre — NON quelli di disegno di nuove
 * geometrie (quelli stanno nel menu "Disegna elemento" della sidebar). Compare
 * a lato della barra dei moduli (montata nella colonna fluttuante sinistra).
 */
const STRUMENTI: { mode: EditMode; labelKey: string; Icon: LucideIcon }[] = [
  { mode: "change", labelKey: "geometryEditToolbar.editVertices", Icon: PenTool },
  { mode: "drag", labelKey: "geometryEditToolbar.moveGeometry", Icon: Move },
  { mode: "rotate", labelKey: "geometryEditToolbar.rotate", Icon: RotateCw },
  { mode: "scale", labelKey: "geometryEditToolbar.scale", Icon: Maximize2 },
  { mode: "simplify", labelKey: "geometryEditToolbar.simplify", Icon: Minimize2 },
];

export function GeometryEditToolbar() {
  const { t } = useTranslation();
  const geomEdit = useAgroStore((s) => s.geomEdit);
  const editId = geomEdit?.id ?? null;
  const [active, setActive] = useState<EditMode>("change");

  // All'avvio di una nuova sessione il motore parte in modalità vertici/drag:
  // si allinea l'evidenziazione al default.
  useEffect(() => {
    if (editId) setActive("change");
  }, [editId]);

  if (!geomEdit) return null;

  const select = (mode: EditMode) => {
    setActive(mode);
    enableGeoEditorEditMode(mode);
  };

  return (
    <div className="flex flex-col gap-1 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-1 shadow-[var(--sh-1)]">
      <p className="px-1 pt-0.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
        {t("geometryEditToolbar.edit")}
      </p>
      {STRUMENTI.map(({ mode, labelKey, Icon }) => (
        <button
          key={mode}
          type="button"
          title={t(labelKey as never)}
          aria-label={t(labelKey as never)}
          onClick={() => select(mode)}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-[var(--r-2)]",
            active === mode
              ? "bg-[var(--accent-l)] text-[var(--accent)]"
              : "text-[var(--ink-2)] hover:bg-[var(--panel-2)]",
          )}
        >
          <Icon size={17} />
        </button>
      ))}
    </div>
  );
}
