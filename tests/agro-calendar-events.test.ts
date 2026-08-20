import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCalendarEvents,
  groupEventsByDay,
  monthGrid,
} from "../apps/agro-field-suite/src/modules/calendar/calendar-events";
import type {
  DssResult,
  Harvest,
  PlannedTask,
  SoilWaterIndex,
  TreatmentLog,
} from "../packages/agro-core/src/types";

/**
 * Costruzione degli eventi del Calendario aziendale: quali record diventano una
 * casella, in quale giorno, e cosa resta fuori. È la regola che decide se
 * l'agronomo vede o non vede un impegno — quindi vive in un modulo puro,
 * testato senza React.
 */

const LABELS = {
  task: (t: PlannedTask) => `task:${t.operation_type}`,
  operation: (l: TreatmentLog) => `op:${l.operation_type}`,
  harvest: (h: Harvest) => `harvest:${h.id}`,
  dss: (d: DssResult) => `dss:${d.model_name}`,
  water: (i: SoilWaterIndex) => `water:${i.depletion_mm}`,
};

const EMPTY = {
  plannedTasks: [] as PlannedTask[],
  treatments: [] as TreatmentLog[],
  harvests: [] as Harvest[],
  dssResults: [] as DssResult[],
  soilIndices: [] as SoilWaterIndex[],
  plotIdByCampaign: {} as Record<string, string>,
  plotIds: null,
  today: "2026-07-30",
  labels: LABELS,
};

function task(over: Partial<PlannedTask> = {}): PlannedTask {
  return {
    id: "t1",
    tenant_id: "tn",
    company_id: "c1",
    plot_id: "p1",
    operation_type: "phytosanitary",
    recipe_id: null,
    target_pest_or_disease: null,
    status: "PLANNED",
    planned_date: "2026-08-04",
    operator_name: null,
    notes: null,
    metadata: {},
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    deleted_at: null,
    ...over,
  } as PlannedTask;
}

function treatment(over: Partial<TreatmentLog> = {}): TreatmentLog {
  return {
    id: "o1",
    tenant_id: "tn",
    company_id: "c1",
    plot_id: "p1",
    plot_campaign_id: null,
    operation_type: "tillage",
    executed_at: "2026-07-20T09:00:00",
    product_name: null,
    deleted_at: null,
    ...over,
  } as TreatmentLog;
}

describe("calendario / costruzione degli eventi", () => {
  it("una task programmata futura è un evento del suo giorno, marcato come futuro", () => {
    const events = buildCalendarEvents({ ...EMPTY, plannedTasks: [task()] });
    assert.equal(events.length, 1);
    assert.equal(events[0].day, "2026-08-04");
    assert.equal(events[0].kind, "task");
    assert.equal(events[0].future, true);
  });

  it("le task chiuse, annullate, cancellate o senza data NON occupano una casella", () => {
    const events = buildCalendarEvents({
      ...EMPTY,
      plannedTasks: [
        task({ id: "a", status: "COMPLETED" }),
        task({ id: "b", status: "CANCELLED" }),
        task({ id: "c", deleted_at: "2026-07-02T00:00:00.000Z" }),
        task({ id: "d", planned_date: null }),
      ],
    });
    assert.deepEqual(events, []);
  });

  it("le operazioni registrate usano il giorno LOCALE di esecuzione", () => {
    const events = buildCalendarEvents({
      ...EMPTY,
      treatments: [treatment()],
    });
    assert.equal(events[0].day, "2026-07-20");
    assert.equal(events[0].future, false);
  });

  it("il filtro per appezzamento esclude tutto ciò che è fuori scope", () => {
    const events = buildCalendarEvents({
      ...EMPTY,
      plannedTasks: [task(), task({ id: "t2", plot_id: "p2" })],
      plotIds: new Set(["p2"]),
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].refId, "t2");
  });

  it("dei DSS entra solo il rischio ALTO", () => {
    const dss = (id: string, risk: DssResult["risk_level"]): DssResult => ({
      id,
      plot_id: "p1",
      model_name: "peronospora",
      risk_level: risk,
      output_value: 80,
      calculated_at: "2026-07-15T10:00:00",
    });
    const events = buildCalendarEvents({
      ...EMPTY,
      dssResults: [dss("d1", "high"), dss("d2", "medium"), dss("d3", "low")],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].refId, "d1");
  });

  it("del bilancio idrico entrano solo i giorni in stress, risolti sull'appezzamento della campagna", () => {
    const index = (
      id: string,
      stress: boolean,
      campaign: string,
    ): SoilWaterIndex =>
      ({
        id,
        plot_campaign_id: campaign,
        date: "2026-07-18",
        et0: 5,
        etc: 4,
        rain_mm: 0,
        irrigation_mm: 0,
        deep_percolation_mm: 0,
        depletion_mm: 42,
        raw_mm: 30,
        awc_mm: 90,
        water_stress: stress,
        calculated_at: "2026-07-18T10:00:00",
      }) as SoilWaterIndex;

    const events = buildCalendarEvents({
      ...EMPTY,
      soilIndices: [
        index("i1", true, "camp-1"),
        index("i2", false, "camp-1"),
        index("i3", true, "camp-2"),
      ],
      plotIdByCampaign: { "camp-1": "p1", "camp-2": "p2" },
      plotIds: new Set(["p1"]),
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].refId, "i1");
    assert.equal(events[0].label, "water:42");
  });

  it("raggruppa per giorno conservando l'ordine di costruzione", () => {
    const events = buildCalendarEvents({
      ...EMPTY,
      plannedTasks: [task({ planned_date: "2026-07-20" })],
      treatments: [treatment()],
    });
    const byDay = groupEventsByDay(events);
    assert.equal(byDay.get("2026-07-20")?.length, 2);
    assert.equal(byDay.get("2026-07-20")?.[0].kind, "task");
  });
});

describe("calendario / griglia del mese", () => {
  it("allinea il primo giorno al lunedì e completa l'ultima settimana", () => {
    // 1 luglio 2026 è un mercoledì: due celle vuote in testa.
    const cells = monthGrid(2026, 6);
    assert.equal(cells.length % 7, 0);
    assert.deepEqual(cells.slice(0, 3), [null, null, "2026-07-01"]);
    assert.equal(cells.filter((c) => c != null).length, 31);
    assert.equal(cells[cells.indexOf("2026-07-31")], "2026-07-31");
  });

  it("copre i mesi corti senza buchi (febbraio bisestile)", () => {
    const cells = monthGrid(2028, 1);
    assert.equal(cells.filter((c) => c != null).length, 29);
  });
});
