/**
 * Hook di Country Resolution per la UI (Moduli 0/3): risolve il `country_code`
 * del tenant attivo e ne deriva i cataloghi di stato filtrati.
 *
 *   * {@link useTenantCountry} — paese risolto (anagrafica + cross-check spaziale
 *     sulle geometrie degli appezzamenti) con eventuali warning per la UI.
 *   * {@link useCountryCatalog} — voci di catalogo (coltura/fitosanitario/concime/
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
  const aziende = useAgroStore((s) => s.aziende);
  const aziendaAttivaId = useAgroStore((s) => s.aziendaAttivaId);
  const appezzamenti = useAgroStore((s) => s.appezzamenti);

  return useMemo(() => {
    const azienda = aziende.find((a) => a.id === aziendaAttivaId);
    return resolveCountry({
      addressCountry: azienda?.country ?? null,
      plots: appezzamenti.map((a) => ({ plotId: a.id, geometria: a.geometry })),
    });
  }, [aziende, aziendaAttivaId, appezzamenti]);
}

/**
 * Voci di catalogo del tipo dato, filtrate per il `country_code` risolto. I
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
