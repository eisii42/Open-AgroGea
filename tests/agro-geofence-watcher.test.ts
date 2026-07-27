import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  type GeofenceErrorCode,
  createGeofenceWatcher,
} from "../apps/agro-field-suite/src/services/geofencing/geofence-watcher";
import type { GeofencePlot } from "../plugins/agro-tools/src/geofencing";

/**
 * Servizio GPS del geofencing: ciclo di vita del watch.
 *
 * Il punto critico non è la matematica (quella è nel motore puro) ma il
 * RECUPERO: un permesso negato termina il watch per specifica, e se il servizio
 * non lo azzera il rilevamento resta morto per tutta la sessione — anche dopo
 * che l'operatore ha concesso il permesso. È esattamente il bug che questi test
 * presidiano, ed è invisibile a qualunque test del solo motore.
 */

const PLOT: GeofencePlot = {
  id: "p1",
  name: "Campo 1",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ],
    ],
  },
  area_ha: 100,
};

/**
 * In Node `navigator` è un accessor di SOLA LETTURA sul global: assegnarlo non
 * lancia, viene semplicemente ignorato — e il doppio non verrebbe mai
 * installato, con i test che passano per il motivo sbagliato. È `configurable`,
 * quindi `defineProperty` funziona.
 */
function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

/** Doppio di `navigator.geolocation` con controllo esplicito sui callback. */
function installGeolocationStub(): {
  calls: () => number;
  cleared: () => number[];
  succeed: (lat: number, lon: number, timestamp: number) => void;
  succeedWithAccuracy: (
    lat: number,
    lon: number,
    timestamp: number,
    accuracy: number,
  ) => void;
  fail: (code: number) => void;
} {
  let nextId = 1;
  let successCb: PositionCallback | null = null;
  let errorCb: PositionErrorCallback | null = null;
  let startCount = 0;
  const clearedIds: number[] = [];

  const geolocation = {
    watchPosition(success: PositionCallback, error?: PositionErrorCallback) {
      startCount += 1;
      successCb = success;
      errorCb = error ?? null;
      return nextId++;
    },
    clearWatch(id: number) {
      clearedIds.push(id);
    },
    getCurrentPosition() {
      /* non usato */
    },
  };

  defineGlobal("navigator", { geolocation });
  defineGlobal("window", { isSecureContext: true });

  return {
    calls: () => startCount,
    cleared: () => clearedIds,
    succeed: (lat, lon, timestamp) =>
      successCb?.({
        coords: { latitude: lat, longitude: lon, accuracy: 5 },
        timestamp,
      } as unknown as GeolocationPosition),
    succeedWithAccuracy: (lat, lon, timestamp, accuracy) =>
      successCb?.({
        coords: { latitude: lat, longitude: lon, accuracy },
        timestamp,
      } as unknown as GeolocationPosition),
    fail: (code) =>
      errorCb?.({
        code,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
        message: "",
      } as unknown as GeolocationPositionError),
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).navigator;
  delete (globalThis as Record<string, unknown>).window;
});

describe("watcher GPS / recupero dopo un errore", () => {
  it("un permesso negato AZZERA il watch, così un riavvio può davvero ripartire", () => {
    const gps = installGeolocationStub();
    const errors: GeofenceErrorCode[] = [];
    const watcher = createGeofenceWatcher({
      plots: [PLOT],
      onError: (code) => errors.push(code),
    });

    watcher.start();
    assert.equal(gps.calls(), 1);

    gps.fail(1); // PERMISSION_DENIED
    assert.deepEqual(errors, ["permission_denied"]);

    // Il difetto originale: `watchId` restava valorizzato e questo `start()`
    // usciva subito dal guard, lasciando il geofencing morto per sempre.
    watcher.start();
    assert.equal(
      gps.calls(),
      2,
      "dopo un permesso negato il watch deve poter ripartire",
    );
  });

  it("timeout e posizione indisponibile NON azzerano il watch (si riprende da sé)", () => {
    const gps = installGeolocationStub();
    const errors: GeofenceErrorCode[] = [];
    const watcher = createGeofenceWatcher({
      plots: [PLOT],
      onError: (code) => errors.push(code),
    });

    watcher.start();
    gps.fail(3); // TIMEOUT
    gps.fail(2); // POSITION_UNAVAILABLE
    assert.deepEqual(errors, ["timeout", "unavailable"]);

    // Nessun nuovo watch: quello vivo può ancora consegnare posizioni.
    watcher.start();
    assert.equal(gps.calls(), 1);
    assert.deepEqual(gps.cleared(), []);
  });

  it("restart riparte e AZZERA la permanenza accumulata", () => {
    const gps = installGeolocationStub();
    const events: string[] = [];
    const watcher = createGeofenceWatcher({
      plots: [PLOT],
      options: { dwellSeconds: 15 },
      onEvent: (event) => event && events.push(event.kind),
    });

    watcher.start();
    // 10 s dentro l'appezzamento: candidato avviato, non ancora confermato.
    gps.succeed(0.5, 0.5, 0);
    gps.succeed(0.5, 0.5, 10_000);
    assert.deepEqual(events, []);
    assert.equal(watcher.getState().candidatePlotId, "p1");

    watcher.restart();
    assert.equal(
      watcher.getState().candidatePlotId,
      null,
      "ripartire con un candidato stantio produrrebbe un ingresso falso",
    );

    // Dopo il riavvio la permanenza riparte da zero: un campione a +20 s
    // rispetto all'inizio originale non basta più a confermare l'ingresso.
    gps.succeed(0.5, 0.5, 20_000);
    assert.deepEqual(events, []);
  });

  it("un fix impreciso è segnalato come SCARTATO, non spacciato per campione buono", () => {
    const gps = installGeolocationStub();
    const seen: { accepted: boolean; accuracy: number | null | undefined }[] = [];
    const watcher = createGeofenceWatcher({
      plots: [PLOT],
      options: { maxAccuracyM: 100 },
      onSample: (sample, _state, accepted) =>
        seen.push({ accepted, accuracy: sample.accuracy_m }),
    });
    watcher.start();

    // Localizzazione via WiFi/IP: dentro il poligono, ma inutilizzabile.
    gps.succeedWithAccuracy(0.5, 0.5, 0, 1500);
    assert.equal(seen[0].accepted, false);
    assert.equal(
      watcher.getState().candidatePlotId,
      null,
      "un campione scartato non deve avviare una permanenza",
    );

    // GPS agganciato: ora il campione conta.
    gps.succeedWithAccuracy(0.5, 0.5, 1_000, 12);
    assert.equal(seen[1].accepted, true);
    assert.equal(watcher.getState().candidatePlotId, "p1");
  });

  it("con soli fix imprecisi l'ingresso non scatta MAI (il caso che va reso visibile)", () => {
    const gps = installGeolocationStub();
    const events: string[] = [];
    let rejected = 0;
    const watcher = createGeofenceWatcher({
      plots: [PLOT],
      options: { maxAccuracyM: 100, dwellSeconds: 15 },
      onSample: (_s, _st, accepted) => {
        if (!accepted) rejected += 1;
      },
      onEvent: (event) => event && events.push(event.kind),
    });
    watcher.start();

    // Un minuto abbondante fermi dentro il campo, ma sempre con fix scadenti.
    for (let ms = 0; ms <= 60_000; ms += 5_000) {
      gps.succeedWithAccuracy(0.5, 0.5, ms, 400);
    }
    assert.deepEqual(events, [], "nessun ingresso: tutti i campioni scartati");
    assert.equal(rejected, 13, "e ogni scarto è stato segnalato al chiamante");
  });

  it("origine non sicura: codice dedicato e nessun watch avviato", () => {
    const gps = installGeolocationStub();
    (globalThis as { window: { isSecureContext: boolean } }).window.isSecureContext =
      false;
    const errors: GeofenceErrorCode[] = [];
    const watcher = createGeofenceWatcher({
      plots: [PLOT],
      onError: (code) => errors.push(code),
    });

    watcher.start();
    assert.deepEqual(
      errors,
      ["insecure_context"],
      "non è un permesso negato: nessuna impostazione potrebbe rimediare",
    );
    assert.equal(gps.calls(), 0, "inutile avviare un watch destinato a fallire");
  });

  it("senza `navigator.geolocation` riporta unavailable senza lanciare", () => {
    defineGlobal("navigator", {});
    defineGlobal("window", { isSecureContext: true });
    const errors: GeofenceErrorCode[] = [];
    const watcher = createGeofenceWatcher({
      plots: [PLOT],
      onError: (code) => errors.push(code),
    });
    assert.doesNotThrow(() => watcher.start());
    assert.deepEqual(errors, ["unavailable"]);
  });
});
