import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  type LucideIcon,
  Sun,
} from "lucide-react";

/**
 * Traduzione dei codici meteo WMO (campo `weather_code` di Open-Meteo) in
 * icona (lucide) ed etichetta italiana per la scheda meteo dell'header. I codici
 * sono raggruppati per famiglia (sereno/nuvoloso/pioggia/neve/temporale) come da
 * tabella WMO 4677 usata da Open-Meteo.
 */

export interface WeatherCodeInfo {
  Icon: LucideIcon;
  label: string;
}

const SCONOSCIUTO: WeatherCodeInfo = { Icon: Cloud, label: "—" };

const TABELLA: Record<number, WeatherCodeInfo> = {
  0: { Icon: Sun, label: "Sereno" },
  1: { Icon: Sun, label: "Quasi sereno" },
  2: { Icon: CloudSun, label: "Parz. nuvoloso" },
  3: { Icon: Cloud, label: "Nuvoloso" },
  45: { Icon: CloudFog, label: "Nebbia" },
  48: { Icon: CloudFog, label: "Nebbia gelata" },
  51: { Icon: CloudDrizzle, label: "Pioviggine debole" },
  53: { Icon: CloudDrizzle, label: "Pioviggine" },
  55: { Icon: CloudDrizzle, label: "Pioviggine intensa" },
  56: { Icon: CloudDrizzle, label: "Pioviggine gelata" },
  57: { Icon: CloudDrizzle, label: "Pioviggine gelata" },
  61: { Icon: CloudRain, label: "Pioggia debole" },
  63: { Icon: CloudRain, label: "Pioggia" },
  65: { Icon: CloudRain, label: "Pioggia intensa" },
  66: { Icon: CloudRain, label: "Pioggia gelata" },
  67: { Icon: CloudRain, label: "Pioggia gelata" },
  71: { Icon: CloudSnow, label: "Neve debole" },
  73: { Icon: CloudSnow, label: "Neve" },
  75: { Icon: CloudSnow, label: "Neve intensa" },
  77: { Icon: CloudSnow, label: "Nevischio" },
  80: { Icon: CloudRain, label: "Rovesci deboli" },
  81: { Icon: CloudRain, label: "Rovesci" },
  82: { Icon: CloudRain, label: "Rovesci intensi" },
  85: { Icon: CloudSnow, label: "Rovesci di neve" },
  86: { Icon: CloudSnow, label: "Rovesci di neve" },
  95: { Icon: CloudLightning, label: "Temporale" },
  96: { Icon: CloudHail, label: "Temporale con grandine" },
  99: { Icon: CloudHail, label: "Temporale con grandine" },
};

/** Icona ed etichetta per un codice WMO (fallback neutro se assente/ignoto). */
export function weatherCodeInfo(code: number | null | undefined): WeatherCodeInfo {
  if (code == null) return SCONOSCIUTO;
  return TABELLA[code] ?? SCONOSCIUTO;
}
