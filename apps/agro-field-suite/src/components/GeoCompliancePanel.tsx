import { FieldSheet } from "@agrogea/ui";
import { useTranslation } from "react-i18next";
import { ComplianceLayerSelector } from "../modules/compliance/ComplianceLayerSelector";

/**
 * Pannello "GeoCompliance" (scheda dedicata sotto Impostazioni Azienda).
 * Riprogettato (FEATURE 3): non carica più file (compito dell'Add Data globale
 * nella barra). Qui si SELEZIONA un layer esterno già caricato e lo si classifica
 * come vincolo (ZVN, SIC/ZPS, EUDR): il layer viene marcato `metadata.compliance`
 * — così gli alert e il tetto azoto lo raccolgono automaticamente — e il motore
 * spaziale calcola le intersezioni con gli appezzamenti del tenant.
 */
export function GeoCompliancePanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <FieldSheet title={t("nav.toolGeoCompliance")} onClose={onClose}>
      <ComplianceLayerSelector />
    </FieldSheet>
  );
}
