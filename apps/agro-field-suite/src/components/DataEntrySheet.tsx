import {
  type PlotDrawAttrs,
  lengthMeters,
  type PendingGeometry,
  useAgroStore,
} from "@agrogea/core";
import { FieldSheet } from "@agrogea/ui";
import { clearGeoEditorSketches } from "@geolibre/plugins";
import { Button, Input, Label, Select } from "@geolibre/ui";
import type {
  LineString,
  MultiLineString,
  MultiPolygon,
  Point,
  Polygon,
} from "geojson";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useReadOnly } from "@agrogea/core";

/**
 * Scheda dati fissa (Modulo UI §3): si apre automaticamente a fine disegno e
 * mostra il form contestuale al tipo di geometria appena tracciata.
 *   * Poligono → appezzamento (con area geodetica pre-calcolata, sola lettura);
 *   * Linea/Punto → asset infrastrutturale / POI.
 * "Salva" scrive sul DAL (PGlite → outbox); "Annulla" scarta la geometria
 * provvisoria (lo sketch grezzo è già nascosto, quindi nulla resta sulla mappa).
 */

const TIPI_ASSET_LINEA = ["condotta", "recinzione", "rete-antigrandine", "strada"];
const TIPI_ASSET_PUNTO = ["pozzo", "trappola", "sensore-iot", "ingresso", "fabbricato"];

export function DataEntrySheet({ pending }: { pending: PendingGeometry }) {
  const salvaAppezzamento = useAgroStore((s) => s.salvaAppezzamentoDisegnato);
  const salvaAsset = useAgroStore((s) => s.salvaAssetDisegnato);
  const clearPending = useAgroStore((s) => s.clearPendingGeometry);

  // Risolve la scheda dati: rimuove lo sketch provvisorio dall'engine (così
  // nulla resta sulla mappa) e chiude il pannello. Usato sia su salva sia su
  // annulla.
  const resolve = () => {
    void clearGeoEditorSketches();
    clearPending();
  };

  if (pending.kind === "polygon") {
    return (
      <AppezzamentoForm
        pending={pending}
        onCancel={resolve}
        onSave={async (attrs) => {
          const record = await salvaAppezzamento(
            pending.feature.geometry as Polygon | MultiPolygon,
            attrs,
          );
          // `salva*` restituisce null senza lanciare quando manca l'azienda
          // attiva/DAL: senza questa guardia la geometria andrebbe persa in
          // silenzio e la scheda si chiuderebbe come se avesse salvato.
          if (!record) throw new Error(SAVE_NO_TENANT_MSG);
          resolve();
        }}
      />
    );
  }

  return (
    <AssetForm
      pending={pending}
      onCancel={resolve}
      onSave={async (attrs) => {
        const record = await salvaAsset(pending.feature.geometry, attrs);
        if (!record) throw new Error(SAVE_NO_TENANT_MSG);
        resolve();
      }}
    />
  );
}

const SAVE_NO_TENANT_MSG =
  "Nessuna azienda attiva: impossibile salvare nel database locale.";

/** Estrae un messaggio leggibile da un errore di salvataggio. */
function messaggioErrore(error: unknown, t: TFunction): string {
  if (error instanceof Error && error.message) return error.message;
  return t("dataEntrySheet.saveFailed");
}

/** Banner d'errore non bloccante mostrato in cima al form quando il salvataggio fallisce. */
function ErroreBanner({ messaggio }: { messaggio: string | null }) {
  if (!messaggio) return null;
  return (
    <div
      role="alert"
      className="rounded-[var(--r-2)] border border-[#dc2626]/40 bg-[#dc2626]/10 px-3 py-2 text-[13px] text-[#dc2626]"
    >
      {messaggio}
    </div>
  );
}

function AppezzamentoForm({
  pending,
  onCancel,
  onSave,
}: {
  pending: PendingGeometry;
  onCancel: () => void;
  onSave: (attrs: PlotDrawAttrs) => Promise<void>;
}) {
  const { t } = useTranslation();
  const readOnly = useReadOnly(useAgroStore((s) => s.aziendaAttivaId));
  const [nome, setNome] = useState("");
  const [irrigazione, setIrrigazione] = useState("");
  const [saving, setSaving] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setErrore(null);
    try {
      await onSave({
        name: nome.trim() || undefined,
        irrigation_type: irrigazione.trim() || null,
      });
    } catch (e) {
      // Non si chiude la scheda: l'utente vede il motivo e può ritentare senza
      // perdere la geometria disegnata.
      setErrore(messaggioErrore(e, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FieldSheet
      title={t("dataEntrySheet.newPlot")}
      onClose={onCancel}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onCancel}>
            {t("logbook.common.cancel")}
          </Button>
          <Button
            className="flex-1"
            disabled={saving || readOnly}
            onClick={() => void submit()}
          >
            {readOnly
              ? t("dataEntrySheet.readOnly")
              : saving
                ? t("logbook.common.saving")
                : t("dataEntrySheet.saveLocalDb")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <ErroreBanner messaggio={errore} />
        <div>
          <Label>{t("dataEntrySheet.areaGeodetic")}</Label>
          <div className="agro-num rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
            {pending.areaHa != null ? `${pending.areaHa.toFixed(4)} ha` : "—"}
          </div>
        </div>
        <div>
          <Label htmlFor="ap-nome">{t("dataEntrySheet.plotName")}</Label>
          <Input
            id="ap-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={t("dataEntrySheet.plotNamePlaceholder")}
          />
        </div>
        <div>
          <Label htmlFor="ap-irrig">{t("dataEntrySheet.irrigationType")}</Label>
          <Input
            id="ap-irrig"
            value={irrigazione}
            onChange={(e) => setIrrigazione(e.target.value)}
            placeholder={t("dataEntrySheet.irrigationTypePlaceholder")}
          />
        </div>
        <p className="text-[11px] text-[var(--ink-4)]">
          {t("dataEntrySheet.plotHint")}
        </p>
      </div>
    </FieldSheet>
  );
}

function AssetForm({
  pending,
  onCancel,
  onSave,
}: {
  pending: PendingGeometry;
  onCancel: () => void;
  onSave: (attrs: {
    name: string | null;
    asset_type: string;
    category: "fixed" | "mobile";
    length_m: number | null;
  }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const readOnly = useReadOnly(useAgroStore((s) => s.aziendaAttivaId));
  const isLinea = pending.kind === "line";
  const tipi = isLinea ? TIPI_ASSET_LINEA : TIPI_ASSET_PUNTO;
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState(tipi[0]);
  const [categoria, setCategoria] = useState<"fixed" | "mobile">("fixed");
  const [saving, setSaving] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const lunghezza = useMemo(() => {
    if (!isLinea) return null;
    const g = pending.feature.geometry;
    if (g.type === "LineString" || g.type === "MultiLineString") {
      return lengthMeters(g as LineString | MultiLineString);
    }
    return null;
  }, [isLinea, pending.feature.geometry]);

  const submit = async () => {
    setSaving(true);
    setErrore(null);
    try {
      await onSave({
        name: nome.trim() || null,
        asset_type: tipo,
        category: categoria,
        length_m: lunghezza,
      });
    } catch (e) {
      setErrore(messaggioErrore(e, t));
    } finally {
      setSaving(false);
    }
  };

  // Coordinata del punto per i POI (sola lettura informativa).
  const punto =
    !isLinea && pending.feature.geometry.type === "Point"
      ? (pending.feature.geometry as Point).coordinates
      : null;

  return (
    <FieldSheet
      title={
        isLinea
          ? t("dataEntrySheet.newInfrastructure")
          : t("dataEntrySheet.newPoi")
      }
      onClose={onCancel}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onCancel}>
            {t("logbook.common.cancel")}
          </Button>
          <Button
            className="flex-1"
            disabled={saving || readOnly}
            onClick={() => void submit()}
          >
            {readOnly
              ? t("dataEntrySheet.readOnly")
              : saving
                ? t("logbook.common.saving")
                : t("dataEntrySheet.saveLocalDb")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <ErroreBanner messaggio={errore} />
        <div>
          <Label htmlFor="as-tipo">{t("dataEntrySheet.assetType")}</Label>
          <Select
            id="as-tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
          >
            {tipi.map((tipoOpt) => (
              <option key={tipoOpt} value={tipoOpt}>
                {tipoOpt}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="as-nome">{t("dataEntrySheet.assetName")}</Label>
          <Input
            id="as-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={
              isLinea
                ? t("dataEntrySheet.assetNamePlaceholderLine")
                : t("dataEntrySheet.assetNamePlaceholderPoint")
            }
          />
        </div>
        <div>
          <Label htmlFor="as-cat">{t("dataEntrySheet.category")}</Label>
          <Select
            id="as-cat"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value as "fixed" | "mobile")}
          >
            <option value="fixed">{t("dataEntrySheet.fixed")}</option>
            <option value="mobile">{t("dataEntrySheet.mobile")}</option>
          </Select>
        </div>
        {isLinea && lunghezza != null && (
          <div>
            <Label>{t("dataEntrySheet.lengthGeodetic")}</Label>
            <div className="agro-num rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
              {lunghezza} m
            </div>
          </div>
        )}
        {punto && (
          <div>
            <Label>{t("dataEntrySheet.position")}</Label>
            <div className="agro-num rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-xs text-[var(--ink-2)]">
              {punto[1].toFixed(5)}, {punto[0].toFixed(5)}
            </div>
          </div>
        )}
      </div>
    </FieldSheet>
  );
}
