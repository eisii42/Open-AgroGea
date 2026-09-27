import { cn } from "@geolibre/ui";
import { BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type ManualSection, manualUrl, openExternal } from "./helpActions";

/**
 * Link a una sezione del manuale utente, nella lingua dell'interfaccia. Apre
 * il browser di sistema sul desktop (plugin opener) o una nuova scheda sul web.
 */
export function ManualLink({
  section,
  label,
  className,
}: {
  section: ManualSection;
  label: string;
  className?: string;
}) {
  const { i18n } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => void openExternal(manualUrl(i18n.language, section))}
      className={cn(
        "inline-flex items-center gap-1 text-[var(--accent)] underline-offset-2 hover:underline",
        className,
      )}
    >
      <BookOpen size={11} />
      {label}
    </button>
  );
}
