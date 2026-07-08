import {
  type WeatherDataSource,
  useAgroStore,
  type WeatherVariable,
} from "@agrogea/core";
import { FieldSheet } from "@agrogea/ui";
import { Button, cn } from "@geolibre/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

/**
 * Pannello "Fonte meteo & variabili" (Modulo Meteo §4). Configura, per il
 * tenant active, la sorgente meteo e le variabili visibili a schermo. Scrive su
 * `config_meteo_azienda` via store/DAL (local-only): nessuna delle credenziali
 * lascia il device. Anagrafica e GeoCompliance vivono in pannelli dedicati
 * sotto lo stesso module "Impostazioni Company". Lazy-loaded (peso bundle).
 */

const VARIABILE_IDS: WeatherVariable[] = [
  "temperature",
  "humidity",
  "rain",
  "radiation",
  "leaf_wetness",
  "wind",
];

function getVariabili(
  t: TFunction,
): { id: WeatherVariable; label: string; descr: string }[] {
  return VARIABILE_IDS.map((id) => ({
    id,
    label: t(`impostazioniPanel.variables.${id}.label`),
    descr: t(`impostazioniPanel.variables.${id}.descr`),
  }));
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const weatherConfig = useAgroStore((s) => s.weatherConfig);
  const saveWeatherConfig = useAgroStore((s) => s.saveWeatherConfig);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);

  const [fonte, setFonte] = useState<WeatherDataSource>(
    weatherConfig?.data_source ?? "public_api",
  );
  const [modello, setModello] = useState(weatherConfig?.station_model ?? "");
  const [apiKey, setApiKey] = useState(weatherConfig?.station_api_key ?? "");
  const [deviceId, setDeviceId] = useState(
    weatherConfig?.station_device_id ?? "",
  );
  const [variabili, setVariabili] = useState<Set<WeatherVariable>>(
    new Set(weatherConfig?.visible_variables ?? ["temperature", "humidity", "rain"]),
  );
  const [salvataggio, setSalvataggio] = useState<"idle" | "salvo" | "fatto" | "errore">(
    "idle",
  );
  const [erroreMsg, setErroreMsg] = useState<string>();

  const toggleVar = (id: WeatherVariable) =>
    setVariabili((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setSalvataggio("salvo");
    setErroreMsg(undefined);
    try {
      await saveWeatherConfig({
        data_source: fonte,
        api_provider: fonte === "public_api" ? "open-meteo" : null,
        station_model: fonte === "private_station" ? modello || null : null,
        station_api_key: fonte === "private_station" ? apiKey || null : null,
        station_device_id:
          fonte === "private_station" ? deviceId || null : null,
        visible_variables: [...variabili],
      });
      setSalvataggio("fatto");
    } catch (err) {
      setSalvataggio("errore");
      setErroreMsg(err instanceof Error ? err.message : t("impostazioniPanel.saveError"));
    }
  };

  const variabiliOptions = getVariabili(t);

  return (
    <FieldSheet
      title={t("impostazioniPanel.title")}
      onClose={onClose}
      footer={
        <Button
          className="min-h-[var(--touch-min)] w-full"
          disabled={!activeCompanyId || salvataggio === "salvo"}
          onClick={() => void save()}
        >
          {salvataggio === "salvo"
            ? t("logbook.common.saving")
            : salvataggio === "fatto"
              ? t("impostazioniPanel.saved")
              : t("impostazioniPanel.saveConfig")}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        {!activeCompanyId && (
          <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] p-2 text-sm text-[var(--ink-3)]">
            {t("impostazioniPanel.selectCompany")}
          </p>
        )}

        {/* 1) Fonte meteo */}
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("impostazioniPanel.weatherSource")}
          </p>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setFonte("public_api")}
              className={cn(
                "rounded-[var(--r-2)] border p-2.5 text-left",
                fonte === "public_api"
                  ? "border-[var(--accent)] bg-[var(--accent-l)]"
                  : "border-[var(--line)]",
              )}
            >
              <p className="text-sm font-medium">{t("impostazioniPanel.publicApi.label")}</p>
              <p className="text-xs text-[var(--ink-4)]">
                {t("impostazioniPanel.publicApi.descr")}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setFonte("private_station")}
              className={cn(
                "rounded-[var(--r-2)] border p-2.5 text-left",
                fonte === "private_station"
                  ? "border-[var(--accent)] bg-[var(--accent-l)]"
                  : "border-[var(--line)]",
              )}
            >
              <p className="text-sm font-medium">{t("impostazioniPanel.privateStation.label")}</p>
              <p className="text-xs text-[var(--ink-4)]">
                {t("impostazioniPanel.privateStation.descr")}
              </p>
            </button>
          </div>

          {fonte === "private_station" && (
            <div className="mt-2 flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--line)] p-2.5">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-semibold text-[var(--ink-4)]">
                  {t("impostazioniPanel.stationModel")}
                </span>
                <input
                  value={modello}
                  onChange={(e) => setModello(e.target.value)}
                  placeholder={t("impostazioniPanel.stationModelPlaceholder")}
                  className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-semibold text-[var(--ink-4)]">
                  {t("impostazioniPanel.apiKey")}
                </span>
                <input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  type="password"
                  autoComplete="off"
                  placeholder={t("impostazioniPanel.apiKeyPlaceholder")}
                  className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-semibold text-[var(--ink-4)]">
                  {t("impostazioniPanel.deviceId")}
                </span>
                <input
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  placeholder={t("impostazioniPanel.deviceIdPlaceholder")}
                  className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
                />
              </label>
              <p className="text-[11px] text-[var(--ink-4)]">
                {t("impostazioniPanel.credentialsNotice")}
              </p>
            </div>
          )}
        </section>

        {/* 2) Selettore variabili */}
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("impostazioniPanel.visibleVariables")}
          </p>
          <div className="flex flex-col gap-1">
            {variabiliOptions.map((v) => (
              <label
                key={v.id}
                className="flex items-center gap-2 rounded-[var(--r-2)] px-2 py-1.5 hover:bg-[var(--panel-2)]"
              >
                <input
                  type="checkbox"
                  checked={variabili.has(v.id)}
                  onChange={() => toggleVar(v.id)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className="flex-1 text-sm font-medium">{v.label}</span>
                <span className="text-xs text-[var(--ink-4)]">{v.descr}</span>
              </label>
            ))}
          </div>
        </section>

        {salvataggio === "errore" && (
          <div className="rounded-[var(--r-2)] bg-[var(--danger-l)] p-2 text-sm text-[var(--danger)]">
            {erroreMsg}
          </div>
        )}
      </div>
    </FieldSheet>
  );
}
