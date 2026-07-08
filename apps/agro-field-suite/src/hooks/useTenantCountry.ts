/**
 * Hook di Country Resolution per la UI (Moduli 0/3): risolve il `country_code`
 * del tenant attivo e ne deriva i cataloghi di stato filtered.
 *
 *   * {@link useTenantCountry} — paese risolto (anagrafica + cross-check spaziale
 *     sulle geometrie degli plots) con eventuali warning per la UI.
 *   * {@link useCountryCatalog} — voci di catalog (crop/fitosanitario/concime/
 *     varietà) del solo paese del tenant, per i dropdown dei form dinamici.
 */
import {
  type CatalogEntry,
  type CountryResolution,
  resolveCountry,
  type CatalogType,
  useAgroStore,
} from "@agrogea/core";
import { useEffect, useMemo, useState } from "react";

/** Paese risolto del tenant attivo (anagrafica primaria + cross-check coordinate). */
export function useTenantCountry(): CountryResolution {
  const companies = useAgroStore((s) => s.companies);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const plots = useAgroStore((s) => s.plots);

  return useMemo(() => {
    const company = companies.find((a) => a.id === activeCompanyId);
    return resolveCountry({
      addressCountry: company?.country ?? null,
      plots: plots.map((a) => ({ plotId: a.id, geometria: a.geometry })),
    });
  }, [companies, activeCompanyId, plots]);
}

/**
 * Voci di catalog del tipo dato, filtrate per il `country_code` risolto. I
 * dropdown "CropType"/"Product" caricano così solo le voci registrate nel paese
 * del tenant (es. fitofarmaci MAPA in Spagna). Ritorna anche il paese usato e lo
 * stato di caricamento per la UI.
 */
export function useCountryCatalog(tipo: CatalogType): {
  voci: CatalogEntry[];
  countryCode: CountryResolution["countryCode"];
  loading: boolean;
} {
  const dal = useAgroStore((s) => s.dal);
  const { countryCode } = useTenantCountry();
  const [voci, setVoci] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!dal) {
      setVoci([]);
      return;
    }
    let alive = true;
    setLoading(true);
    dal
      .listCatalogo(countryCode, tipo)
      .then((v) => {
        if (alive) setVoci(v);
      })
      .catch(() => {
        if (alive) setVoci([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [dal, countryCode, tipo]);

  return { voci, countryCode, loading };
}
