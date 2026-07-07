import {
  missingDeclarative,
  EXPIRY_WARNING_DAYS_DEFAULT,
  type FieldProductCost,
  declarativeSystem,
  expiryStatus,
  useAgroStore,
} from "@agrogea/core";
import { Boxes, Euro, MapPinned, PackageX, Timer, Tractor, Wheat } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTenantCountry } from "../../hooks/useTenantCountry";

/**
 * Pagina "Company" del Data Command Center: andamento GENERALE dell'azienda
 * (superficie, campi, operazioni e raccolto dell'annata) e stato del Magazzino
 * (valore giacenze a CUMP, lotti scaduti/in scadenza, costo prodotti imputato
 * per campo). Complementare alla pagina "Colture e appezzamenti", che resta
 * focalizzata sull'analisi agronomica per coltura/campo.
 */
export function CompanyOverview({ campaignYear }: { campaignYear: number }) {
  const { t } = useTranslation();
  const dal = useAgroStore((s) => s.dal);
  const aziendaAttivaId = useAgroStore((s) => s.aziendaAttivaId);
  const appezzamenti = useAgroStore((s) => s.appezzamenti);
  const trattamenti = useAgroStore((s) => s.trattamenti);
  const raccolte = useAgroStore((s) => s.raccolte);
  const prodotti = useAgroStore((s) => s.prodotti);
  const lotti = useAgroStore((s) => s.lotti);
  const campiCampagna = useAgroStore((s) => s.campiCampagna);
  const apriColturaPerAppezzamento = useAgroStore(
    (s) => s.apriColturaPerAppezzamento,
  );
  const setActiveView = useAgroStore((s) => s.setActiveView);
  const { countryCode } = useTenantCountry();

  // Costo prodotti per campo dell'annata (aggregato DAL su activity_products).
  const [costiCampo, setCostiCampo] = useState<FieldProductCost[]>([]);
  useEffect(() => {
    if (!dal || !aziendaAttivaId) return;
    let attivo = true;
    void dal
      .costiProdottiPerCampo(aziendaAttivaId, {
        dal: `${campaignYear}-01-01T00:00:00.000Z`,
        al: `${campaignYear}-12-31T23:59:59.999Z`,
      })
      .then((rows) => {
        if (attivo) setCostiCampo(rows);
      });
    return () => {
      attivo = false;
    };
    // `lotti` come dipendenza: ogni scarico/storno cambia i costi imputati.
  }, [dal, aziendaAttivaId, campaignYear, lotti]);

  const vivi = useMemo(
    () => appezzamenti.filter((a) => a.deleted_at == null),
    [appezzamenti],
  );
  const superficieTotale = vivi.reduce((s, a) => s + Number(a.area_ha ?? 0), 0);

  const operazioniAnno = useMemo(
    () =>
      trattamenti.filter(
        (tr) =>
          tr.deleted_at == null &&
          new Date(tr.executed_at).getUTCFullYear() === campaignYear,
      ).length,
    [trattamenti, campaignYear],
  );
  const raccoltoAnnoKg = useMemo(
    () =>
      raccolte
        .filter(
          (r) =>
            r.deleted_at == null &&
            new Date(r.harvested_at).getUTCFullYear() === campaignYear,
        )
        .reduce((s, r) => s + Number(r.quantity_kg ?? 0), 0),
    [raccolte, campaignYear],
  );

  // -- stato magazzino ---------------------------------------------------------
  const giacenzaPerProdotto = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lotti) {
      if (l.deleted_at != null) continue;
      map.set(l.product_id, (map.get(l.product_id) ?? 0) + Number(l.quantity_on_hand));
    }
    return map;
  }, [lotti]);

  // Valore delle giacenze valorizzate al CUMP corrente di ciascun prodotto.
  const valoreGiacenze = useMemo(
    () =>
      prodotti.reduce(
        (sum, p) =>
          sum + (giacenzaPerProdotto.get(p.id) ?? 0) * Number(p.avg_unit_cost),
        0,
      ),
    [prodotti, giacenzaPerProdotto],
  );

  const lottiConGiacenza = useMemo(
    () => lotti.filter((l) => l.deleted_at == null && Number(l.quantity_on_hand) > 0),
    [lotti],
  );
  const lottiScaduti = lottiConGiacenza.filter(
    (l) => expiryStatus(l.expires_at) === "expired",
  );
  const lottiInScadenza = lottiConGiacenza.filter(
    (l) => expiryStatus(l.expires_at) === "expiring",
  );
  // Scorta minima (v17): prodotti sotto la soglia di riordino.
  const sottoScorta = prodotti.filter((p) => {
    const min = p.metadata?.["min_stock"];
    return (
      typeof min === "number" && (giacenzaPerProdotto.get(p.id) ?? 0) < min
    );
  }).length;

  const nomeCampo = (plotId: string | null): string =>
    plotId
      ? appezzamenti.find((a) => a.id === plotId)?.user_plot_name ??
        plotId.slice(0, 8)
      : t("companyOverview.wholeFarm");

  const euro = (v: number) =>
    v.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Compliance dichiarativa (IT → SIAN, ES → SIEX): campagne APERTE dell'annata
  // con dati incompleti. Il click porta alla scheda Dati coltura del primo campo.
  const sistema = declarativeSystem(countryCode);
  const campagneSianKo = useMemo(
    () =>
      sistema
        ? campiCampagna.filter(
            (c) =>
              c.deleted_at == null &&
              c.closed_at == null &&
              missingDeclarative(countryCode, c).length > 0,
          )
        : [],
    [sistema, countryCode, campiCampagna],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Alert compliance SIAN: impossibile "dimenticare" i dichiarativi. */}
      {campagneSianKo.length > 0 && (
        <button
          type="button"
          onClick={() => {
            apriColturaPerAppezzamento(campagneSianKo[0].plot_id);
            setActiveView("map");
          }}
          className="flex items-center gap-2 rounded-[var(--r-2)] border border-[var(--warn)] bg-[var(--warn-l)] px-3 py-2 text-left text-sm font-medium text-[var(--warn)] hover:opacity-90"
        >
          ⚠ {t("companyOverview.sianAlert", {
            count: campagneSianKo.length,
            system: sistema,
          })}
        </button>
      )}

      {/* Andamento generale dell'annata */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[var(--ink-4)]">
          {t("companyOverview.generalTitle", { year: campaignYear })}
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            Icon={MapPinned}
            label={t("companyOverview.kpi.totalArea")}
            value={`${superficieTotale.toFixed(2)} ha`}
            sub={t("companyOverview.kpi.plots", { count: vivi.length })}
          />
          <KpiCard
            Icon={Tractor}
            label={t("companyOverview.kpi.operationsYear")}
            value={String(operazioniAnno)}
            sub={t("companyOverview.kpi.operationsSub")}
          />
          <KpiCard
            Icon={Wheat}
            label={t("companyOverview.kpi.harvestYear")}
            value={`${(raccoltoAnnoKg / 100).toFixed(1)} q`}
            sub={t("companyOverview.kpi.harvestSub")}
          />
          <KpiCard
            Icon={Euro}
            label={t("companyOverview.kpi.productCosts")}
            value={`${euro(costiCampo.reduce((s, c) => s + Number(c.total_cost), 0))} €`}
            sub={t("companyOverview.kpi.productCostsSub")}
          />
        </div>
      </section>

      {/* Stato del magazzino */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[var(--ink-4)]">
          {t("companyOverview.warehouseTitle")}
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            Icon={Boxes}
            label={t("companyOverview.kpi.products")}
            value={String(prodotti.length)}
            tone={sottoScorta > 0 ? "warn" : undefined}
            sub={
              t("companyOverview.kpi.productsSub", {
                count: lottiConGiacenza.length,
              }) +
              (sottoScorta > 0
                ? ` · ${t("companyOverview.kpi.belowMinStock", { count: sottoScorta })}`
                : "")
            }
          />
          <KpiCard
            Icon={Euro}
            label={t("companyOverview.kpi.stockValue")}
            value={`${euro(valoreGiacenze)} €`}
            sub={t("companyOverview.kpi.stockValueSub")}
          />
          <KpiCard
            Icon={PackageX}
            label={t("companyOverview.kpi.expiredLots")}
            value={String(lottiScaduti.length)}
            tone={lottiScaduti.length > 0 ? "danger" : undefined}
            sub={t("companyOverview.kpi.expiredLotsSub")}
          />
          <KpiCard
            Icon={Timer}
            label={t("companyOverview.kpi.expiringLots", {
              days: EXPIRY_WARNING_DAYS_DEFAULT,
            })}
            value={String(lottiInScadenza.length)}
            tone={lottiInScadenza.length > 0 ? "warn" : undefined}
            sub={t("companyOverview.kpi.expiringLotsSub")}
          />
        </div>
      </section>

      {/* Costo prodotti imputato per campo (base del bilancio di campo 0.4.0) */}
      <section className="rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-3">
        <h3 className="mb-2 text-sm font-semibold text-[var(--ink)]">
          {t("companyOverview.costsByField", { year: campaignYear })}
        </h3>
        {costiCampo.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--ink-3)]">
            {t("companyOverview.noCosts")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-[11px] uppercase tracking-wider text-[var(--ink-4)]">
                <th className="py-1.5 pr-2 font-semibold">
                  {t("companyOverview.field")}
                </th>
                <th className="py-1.5 text-right font-semibold">
                  {t("companyOverview.cost")}
                </th>
              </tr>
            </thead>
            <tbody>
              {costiCampo.map((riga) => (
                <tr
                  key={riga.plot_id ?? "azienda"}
                  className="border-b border-[var(--line)] last:border-0"
                >
                  <td className="py-1.5 pr-2">{nomeCampo(riga.plot_id)}</td>
                  <td className="agro-num py-1.5 text-right">
                    {euro(Number(riga.total_cost))} €
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  Icon,
  label,
  value,
  sub,
  tone,
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  tone?: "warn" | "danger";
}) {
  const color =
    tone === "danger"
      ? "text-[var(--danger)]"
      : tone === "warn"
        ? "text-[var(--warn)]"
        : "text-[var(--ink)]";
  return (
    <div className="flex flex-col gap-1 rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
        <Icon size={13} /> {label}
      </span>
      <span className={`agro-num text-xl font-bold ${color}`}>{value}</span>
      {sub && <span className="text-[11px] text-[var(--ink-3)]">{sub}</span>}
    </div>
  );
}
