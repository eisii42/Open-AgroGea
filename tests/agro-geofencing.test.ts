import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type GeofencePlot,
  type GeofenceState,
  activeReentryWindows,
  advanceGeofence,
  dwellRemainingSeconds,
  haversineMeters,
  initialGeofenceState,
  pathLengthMeters,
  plotContainingPoint,
  reentryWindowForPlot,
  speedKmh,
  workedAreaHectares,
} from "@agrogea/tools";
import type { Polygon } from "geojson";

/**
 * Geofencing GPS + tempo di rientro PAN:
 * riduttore puro dwell/isteresi (nessun DB, nessun `navigator`), utility
 * cinematiche del tracciato e finestre di rientro derivate dal registro
 * trattamenti. Stesso idioma di `agro-machinery.test.ts`/`agro-tools.test.ts`
 * (node:test, nessun DOM).
 */

// ---------------------------------------------------------------------------
// Fixture geometriche
// ---------------------------------------------------------------------------

/** Quadratino di lato ~2·half gradi centrato su (cx, cy). */
function squarePolygon(cx: number, cy: number, half = 0.001): Polygon {
  return {
    type: "Polygon",
    coordinates: [
      [
        [cx - half, cy - half],
        [cx + half, cy - half],
        [cx + half, cy + half],
        [cx - half, cy + half],
        [cx - half, cy - half],
      ],
    ],
  };
}

const PLOT_A: GeofencePlot = {
  id: "plot-a",
  name: "Campo A",
  geometry: squarePolygon(9, 45),
  area_ha: 2,
};
const PLOT_B: GeofencePlot = {
  id: "plot-b",
  name: "Campo B",
  geometry: squarePolygon(9.01, 45),
  area_ha: 1.5,
};

// ---------------------------------------------------------------------------
// plotContainingPoint
// ---------------------------------------------------------------------------

describe("plotContainingPoint", () => {
  it("trova il plot quando il punto è dentro un Polygon", () => {
    const found = plotContainingPoint(
      { lat: 45, lon: 9, timestamp: 0 },
      [PLOT_A, PLOT_B],
    );
    assert.equal(found?.id, "plot-a");
  });

  it("trova il plot quando il punto è dentro un MultiPolygon", () => {
    const multiPlot: GeofencePlot = {
      id: "plot-multi",
      name: "Campo multi-corpo",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          squarePolygon(20, 45).coordinates,
          squarePolygon(20.01, 45).coordinates,
        ],
      },
    };
    const found = plotContainingPoint(
      { lat: 45, lon: 20.01, timestamp: 0 },
      [multiPlot],
    );
    assert.equal(found?.id, "plot-multi");
  });

  it("ritorna null quando il punto è fuori da ogni plot", () => {
    const found = plotContainingPoint(
      { lat: 0, lon: 0, timestamp: 0 },
      [PLOT_A, PLOT_B],
    );
    assert.equal(found, null);
  });

  it("il prefiltro bbox non produce falsi positivi (punto nel bbox ma fuori dall'anello)", () => {
    // Poligono a "L": quadrato 0..2 con l'angolo in alto a sinistra (0..1, 1..2)
    // asportato. Il punto (0.5, 1.5) sta nel bounding box [0,0]-[2,2] ma FUORI
    // dal perimetro reale.
    const lShaped: GeofencePlot = {
      id: "plot-l",
      name: "Campo a L",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [1, 2],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    };
    const found = plotContainingPoint(
      { lat: 1.5, lon: 0.5, timestamp: 0 },
      [lShaped],
    );
    assert.equal(found, null);
    // Controprova: un punto nella parte piena del medesimo bbox è trovato.
    const foundInside = plotContainingPoint(
      { lat: 0.5, lon: 0.5, timestamp: 0 },
      [lShaped],
    );
    assert.equal(foundInside?.id, "plot-l");
  });
});

// ---------------------------------------------------------------------------
// advanceGeofence: dwell debounce, candidate reset, isteresi d'uscita
// ---------------------------------------------------------------------------

const OPTS = { dwellSeconds: 15, exitGraceSeconds: 30, maxAccuracyM: 50 };

function sampleAt(lon: number, lat: number, timestamp: number, accuracyM: number | null = 5) {
  return { lat, lon, accuracy_m: accuracyM, timestamp };
}

describe("advanceGeofence — dwell debounce", () => {
  it("14s continuativi dentro il plot non emettono alcun evento", () => {
    let state = initialGeofenceState();
    const r1 = advanceGeofence(state, sampleAt(9, 45, 0), [PLOT_A], OPTS);
    assert.equal(r1.event, null);
    state = r1.state;
    assert.equal(state.candidatePlotId, "plot-a");

    const r2 = advanceGeofence(state, sampleAt(9, 45, 14_000), [PLOT_A], OPTS);
    assert.equal(r2.event, null);
    assert.equal(r2.state.insidePlotId, null);
  });

  it("il superamento dei 15s emette ESATTAMENTE un enter; i campioni successivi non emettono altro", () => {
    let state = initialGeofenceState();
    state = advanceGeofence(state, sampleAt(9, 45, 0), [PLOT_A], OPTS).state;

    const confirmation = advanceGeofence(state, sampleAt(9, 45, 15_000), [PLOT_A], OPTS);
    assert.deepEqual(confirmation.event, { kind: "enter", plotId: "plot-a", at: 15_000 });
    assert.equal(confirmation.state.insidePlotId, "plot-a");
    assert.equal(confirmation.state.candidatePlotId, null);
    state = confirmation.state;

    const next = advanceGeofence(state, sampleAt(9, 45, 16_000), [PLOT_A], OPTS);
    assert.equal(next.event, null);
    assert.equal(next.state.insidePlotId, "plot-a");

    const next2 = advanceGeofence(next.state, sampleAt(9, 45, 20_000), [PLOT_A], OPTS);
    assert.equal(next2.event, null);
  });

  it("candidate reset: uscire prima della conferma fa ripartire il timer da zero", () => {
    let state = initialGeofenceState();
    state = advanceGeofence(state, sampleAt(9, 45, 0), [PLOT_A], OPTS).state;
    state = advanceGeofence(state, sampleAt(9, 45, 5_000), [PLOT_A], OPTS).state;
    assert.equal(state.candidateSince, 0);

    // Campione fuori da ogni plot: il candidato si azzera.
    const reset = advanceGeofence(state, sampleAt(0, 0, 6_000), [PLOT_A], OPTS);
    assert.equal(reset.event, null);
    assert.equal(reset.state.candidatePlotId, null);
    assert.equal(reset.state.candidateSince, null);

    // Rientra: nuovo candidato con candidateSince = 7000 (non riprende da 0/5000).
    const reenter = advanceGeofence(reset.state, sampleAt(9, 45, 7_000), [PLOT_A], OPTS);
    assert.equal(reenter.event, null);
    assert.equal(reenter.state.candidateSince, 7_000);

    // A 14999ms dal NUOVO inizio (21999 assoluto) non è ancora confermato:
    // se il timer non fosse ripartito da zero, sarebbe già confermato da tempo.
    const almost = advanceGeofence(reenter.state, sampleAt(9, 45, 7_000 + 14_999), [PLOT_A], OPTS);
    assert.equal(almost.event, null);

    const confirmed = advanceGeofence(almost.state, sampleAt(9, 45, 7_000 + 15_000), [PLOT_A], OPTS);
    assert.deepEqual(confirmed.event, { kind: "enter", plotId: "plot-a", at: 22_000 });
  });

  it("un campione con accuratezza peggiore della soglia è scartato: stato invariato, nessun evento", () => {
    const state = initialGeofenceState();
    const result = advanceGeofence(
      state,
      sampleAt(9, 45, 0, 999),
      [PLOT_A],
      OPTS,
    );
    assert.equal(result.event, null);
    assert.deepEqual(result.state, state);
    // Stato letteralmente invariato: nessun candidato avviato dal campione scartato.
    assert.equal(result.state.candidatePlotId, null);
  });
});

describe("advanceGeofence — isteresi d'uscita", () => {
  function confirmedState(plotId: string): GeofenceState {
    return {
      insidePlotId: plotId,
      candidatePlotId: null,
      candidateSince: null,
      outsideSince: null,
    };
  }

  it("un singolo campione fuori (jitter) non fa scattare l'uscita, e un campione di rientro azzera l'isteresi", () => {
    let state = confirmedState("plot-a");
    const jitter = advanceGeofence(state, sampleAt(0, 0, 1_000), [PLOT_A], OPTS);
    assert.equal(jitter.event, null);
    assert.equal(jitter.state.insidePlotId, "plot-a");
    assert.equal(jitter.state.outsideSince, 1_000);

    const back = advanceGeofence(jitter.state, sampleAt(9, 45, 1_500), [PLOT_A], OPTS);
    assert.equal(back.event, null);
    assert.equal(back.state.outsideSince, null);
    state = back.state;
    assert.deepEqual(state, confirmedState("plot-a"));
  });

  it("l'assenza sostenuta oltre exitGraceSeconds conferma l'uscita", () => {
    const state = confirmedState("plot-a");
    const started = advanceGeofence(state, sampleAt(0, 0, 2_000), [PLOT_A], OPTS);
    assert.equal(started.event, null);

    const almost = advanceGeofence(
      started.state,
      sampleAt(0, 0, 2_000 + 29_999),
      [PLOT_A],
      OPTS,
    );
    assert.equal(almost.event, null);
    assert.equal(almost.state.insidePlotId, "plot-a");

    const exited = advanceGeofence(
      almost.state,
      sampleAt(0, 0, 2_000 + 30_000),
      [PLOT_A],
      OPTS,
    );
    assert.deepEqual(exited.event, { kind: "exit", plotId: "plot-a", at: 32_000 });
    assert.equal(exited.state.insidePlotId, null);
  });
});

describe("dwellRemainingSeconds", () => {
  it("conta alla rovescia e raggiunge 0 esattamente alla conferma", () => {
    let state = initialGeofenceState();
    state = advanceGeofence(state, sampleAt(9, 45, 0), [PLOT_A], OPTS).state;
    assert.equal(dwellRemainingSeconds(state, 0, OPTS), 15);
    assert.equal(dwellRemainingSeconds(state, 5_000, OPTS), 10);
    assert.equal(dwellRemainingSeconds(state, 15_000, OPTS), 0);
  });

  it("ritorna null senza un candidato in corso", () => {
    assert.equal(dwellRemainingSeconds(initialGeofenceState(), 0, OPTS), null);
  });
});

// ---------------------------------------------------------------------------
// Cinematica: haversine, pathLength, speedKmh, workedAreaHectares
// ---------------------------------------------------------------------------

describe("haversineMeters / pathLengthMeters / speedKmh", () => {
  it("haversineMeters: 0.001° di latitudine ≈ 111.2 m", () => {
    const d = haversineMeters({ lat: 0, lon: 0 }, { lat: 0.001, lon: 0 });
    assert.ok(Math.abs(d - 111.2) < 1, `atteso ~111.2 m, ottenuto ${d}`);
  });

  it("pathLengthMeters: somma dei segmenti consecutivi", () => {
    const length = pathLengthMeters([
      [0, 0],
      [0, 0.001],
      [0, 0.002],
    ]);
    assert.ok(Math.abs(length - 222.4) < 2, `atteso ~222.4 m, ottenuto ${length}`);
  });

  it("speedKmh: distanza/tempo convertita in km/h", () => {
    const speed = speedKmh(
      { lat: 0, lon: 0, timestamp: 0 },
      { lat: 0, lon: 0.001, timestamp: 10_000 },
    );
    assert.ok(speed != null && Math.abs(speed - 40.03) < 0.5, `atteso ~40 km/h, ottenuto ${speed}`);
  });

  it("speedKmh: null con Δt non utilizzabile (zero o negativo)", () => {
    assert.equal(
      speedKmh({ lat: 0, lon: 0, timestamp: 5_000 }, { lat: 0, lon: 0, timestamp: 5_000 }),
      null,
    );
    assert.equal(
      speedKmh({ lat: 0, lon: 0, timestamp: 5_000 }, { lat: 0, lon: 0, timestamp: 1_000 }),
      null,
    );
  });
});

describe("workedAreaHectares", () => {
  it("senza larghezza di lavoro ritorna 0", () => {
    const coords: [number, number][] = [
      [0, 0],
      [0, 0.009],
    ];
    assert.equal(workedAreaHectares(coords, null), 0);
    assert.equal(workedAreaHectares(coords, 0), 0);
    assert.equal(workedAreaHectares(coords, -3), 0);
  });

  it("stima lunghezza × larghezza, clampata alla superficie del plot", () => {
    // ~1000.76 m di tracciato × 10 m = 1.00076 ha.
    const coords: [number, number][] = [
      [0, 0],
      [0, 0.009],
    ];
    const unclamped = workedAreaHectares(coords, 10);
    assert.ok(Math.abs(unclamped - 1.0008) < 0.01, `atteso ~1.0008 ha, ottenuto ${unclamped}`);

    const clamped = workedAreaHectares(coords, 10, 0.5);
    assert.equal(clamped, 0.5);
  });
});

// ---------------------------------------------------------------------------
// Tempo di rientro PAN
// ---------------------------------------------------------------------------

describe("activeReentryWindows / reentryWindowForPlot", () => {
  const NOW = Date.parse("2024-06-01T12:00:00.000Z");
  const isoHoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

  const logs = [
    // Plot A: due trattamenti aperti — questo è il più restrittivo (scade fra 2h).
    {
      plot_id: "plot-a",
      executed_at: isoHoursAgo(2),
      reentry_interval_h: 4,
      product_name: "Rame",
    },
    // Plot A: scade fra 1h — MENO restrittivo del precedente, non deve vincere.
    {
      plot_id: "plot-a",
      executed_at: isoHoursAgo(1),
      reentry_interval_h: 2,
      product_name: "Zolfo",
    },
    // Plot C: già scaduto (10h fa, intervallo 2h ⇒ scaduto da 8h) — ignorato.
    {
      plot_id: "plot-c",
      executed_at: isoHoursAgo(10),
      reentry_interval_h: 2,
      product_name: "Scaduto",
    },
    // Plot B: reentry_interval_h nullo — ignorato.
    {
      plot_id: "plot-b",
      executed_at: isoHoursAgo(1),
      reentry_interval_h: null,
      product_name: "Senza rientro",
    },
    // plot_id nullo — ignorato.
    {
      plot_id: null,
      executed_at: isoHoursAgo(1),
      reentry_interval_h: 4,
      product_name: "Operazione intera azienda",
    },
    // Plot B: scade fra 2.5h — l'unica finestra valida sul plot B.
    {
      plot_id: "plot-b",
      executed_at: isoHoursAgo(0.5),
      reentry_interval_h: 3,
      product_name: "Insetticida",
    },
  ];

  it("seleziona per plot la finestra più restrittiva e ordina per scadenza più lontana", () => {
    const windows = activeReentryWindows(logs, NOW);
    // B scade fra 2.5h (più lontano), A fra 2h: B prima di A. C e il plot_id
    // nullo sono esclusi (scaduto/non valido).
    assert.deepEqual(
      windows.map((w) => w.plotId),
      ["plot-b", "plot-a"],
    );
    assert.equal(windows.find((w) => w.plotId === "plot-a")?.productName, "Rame");
    assert.equal(windows.find((w) => w.plotId === "plot-a")?.hoursRemaining, 2);
    assert.equal(windows.find((w) => w.plotId === "plot-b")?.hoursRemaining, 3);
  });

  it("reentryWindowForPlot ritorna la finestra più restrittiva del plot, o null se scaduta/assente", () => {
    const windowA = reentryWindowForPlot(logs, "plot-a", NOW);
    assert.equal(windowA?.productName, "Rame");
    assert.equal(windowA?.hoursRemaining, 2);

    assert.equal(reentryWindowForPlot(logs, "plot-c", NOW), null);
    assert.equal(reentryWindowForPlot(logs, "plot-z", NOW), null);
  });

  it("le ore residue sono arrotondate per eccesso con minimo 1", () => {
    const soonLogs = [
      {
        plot_id: "plot-d",
        executed_at: new Date(NOW - 100 * 60_000).toISOString(),
        reentry_interval_h: 2, // scade fra 20 minuti (0.33h)
        product_name: "Erbicida",
      },
    ];
    const window = reentryWindowForPlot(soonLogs, "plot-d", NOW);
    assert.equal(window?.hoursRemaining, 1);
  });
});
