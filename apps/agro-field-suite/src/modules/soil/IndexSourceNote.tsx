import { cn } from "@geolibre/ui";
import { BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { manualUrl, openExternal } from "../../components/help/helpActions";
import { ManualLink } from "../../components/help/ManualLink";

/**
 * Dicitura di provenienza degli indici spettrali: i dati sono immagini
 * Copernicus Sentinel-2, gli indici li calcola AgroGea. Accompagna ogni punto
 * in cui l'analisi si mostra, con il link alla sezione del manuale che spiega
 * come vengono calcolati.
 *
 * Non è un dettaglio: chi legge un NDVI deve sapere che non è un dato ufficiale
 * né un prodotto del fornitore del satellite, ma una elaborazione fatta sul
 * dispositivo, con i suoi limiti (nuvole, risoluzione di 10 m, scala relativa).
 *
 * `compact` è la variante per la legenda sulla mappa, dove lo spazio è poco.
 */
export function IndexSourceNote({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const openManual = () =>
    void openExternal(manualUrl(i18n.language, "satelliteIndices"));

  if (compact) {
    return (
      <p
        className={cn(
          "pointer-events-auto flex items-center gap-1 text-[9px] text-[var(--ink-4)]",
          className,
        )}
      >
        <span>{t("soilPanel.dataSource.short")}</span>
        <button
          type="button"
          onClick={openManual}
          title={t("soilPanel.dataSource.manualLink")}
          aria-label={t("soilPanel.dataSource.manualLink")}
          className="text-[var(--accent)] hover:opacity-80"
        >
          <BookOpen size={10} />
        </button>
      </p>
    );
  }

  return (
    <p className={cn("text-[11px] leading-snug text-[var(--ink-4)]", className)}>
      {t("soilPanel.dataSource.note")}{" "}
      <ManualLink
        section="satelliteIndices"
        label={t("soilPanel.dataSource.manualLink")}
      />
    </p>
  );
}
