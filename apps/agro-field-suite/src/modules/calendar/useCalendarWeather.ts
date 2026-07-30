import { centroid, useAgroStore } from "@agrogea/core";
import { useEffect, useMemo, useState } from "react";
import { type ForecastDay, WeatherSyncService } from "../../lib/WeatherSyncService";

/**
 * Meteo GIORNALIERO del mese visualizzato nel Calendario: icona WMO,
 * massima/minima e millimetri di pioggia, giorno per giorno — storico e
 * previsione nella stessa griglia.
 *
 * Dato di CONTORNO, non autorevole: viene da Open-Meteo sul centroide
 * dell'azienda (sede se nota, altrimenti primo appezzamento con geometria) e
 * NON tocca `weather_readings` — quella serie resta di `assicuraDatiMeteo`, che
 * alimenta i DSS. Offline la mappa resta vuota e il calendario funziona lo
 * stesso: nessuna cella dipende dal meteo per esistere.
 */

/** Coordinate [lon, lat] dell'azienda attiva, o null se non localizzabile. */
function useCompanyCoordinates(): [number, number] | null {
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const companies = useAgroStore((s) => s.companies);
  const plots = useAgroStore((s) => s.plots);

  return useMemo(() => {
    const company = companies.find((c) => c.id === activeCompanyId);
    const seat = company?.centroid?.coordinates;
    if (seat && seat.length >= 2) return [seat[0], seat[1]];
    const withGeometry = plots.find((p) => p.geometry);
    if (withGeometry) return centroid(withGeometry.geometry);
    return null;
  }, [activeCompanyId, companies, plots]);
}

export function useCalendarWeather(
  from: string,
  to: string,
): Map<string, ForecastDay> {
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const coordinates = useCompanyCoordinates();
  const [days, setDays] = useState<ForecastDay[]>([]);

  useEffect(() => {
    let alive = true;
    if (!activeCompanyId || !coordinates || !from || !to) {
      setDays([]);
      return;
    }
    void WeatherSyncService.dailyRange({
      companyId: activeCompanyId,
      lon: coordinates[0],
      lat: coordinates[1],
      from,
      to,
    })
      .then((rows) => {
        if (alive) setDays(rows);
      })
      .catch(() => {
        // Offline o quota esaurita: il calendario resta senza meteo, non rotto.
        if (alive) setDays([]);
      });
    return () => {
      alive = false;
    };
  }, [activeCompanyId, coordinates, from, to]);

  return useMemo(() => {
    const map = new Map<string, ForecastDay>();
    for (const day of days) map.set(day.data, day);
    return map;
  }, [days]);
}
