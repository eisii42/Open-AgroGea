import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pathLengthMeters, workedAreaHectares } from "../plugins/agro-tools/src/geofencing";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";
import { AUDIO_URI_SCHEME } from "../packages/agro-core/src/db/dal-tasks";
import { AgroDal } from "../packages/agro-core/src/db/dal";
import type { FieldOperationSession } from "../packages/agro-core/src/types";

/**
 * InFieldDashboard (Modalità Campo low-touch): accumulo incrementale del
 * tracciato GPS via `updateFieldSession` (path che cresce, path_length_m/
 * area_worked_ha ricalcolati, round-trip reale del LineString) e note vocali
 * geotaggate LOCAL-ONLY (`field_session_audio`, mai nell'outbox — solo
 * `audio_notes` sulla sessione sincronizza). Stesso idioma di
 * `agro-tasks.test.ts`/`agro-machinery.test.ts`: node:test, PGlite in-memory,
 * `TestDal` per esporre il costruttore protetto.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";

/** Espone il costruttore protetto del DAL per i test su PGlite in-memory. */
class TestDal extends AgroDal {
  static async create(): Promise<TestDal> {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    return new TestDal(db, TENANT, "device-test");
  }
}

async function seedCompany(dal: TestDal): Promise<string> {
  const company = await dal.rawQuery<{ id: string }>(
    `insert into companies (id, tenant_id, business_name)
     values (gen_random_uuid(), $1, 'Company Test') returning id`,
    [TENANT],
  );
  return company.rows[0].id;
}

async function seedPlot(dal: TestDal, companyId: string): Promise<string> {
  const plot = await dal.rawQuery<{ id: string }>(
    `insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
     values (gen_random_uuid(), $1, $2, 'Campo 1', '{"type":"Polygon","coordinates":[]}'::jsonb, 5)
     returning id`,
    [TENANT, companyId],
  );
  return plot.rows[0].id;
}

async function seedSession(
  dal: TestDal,
  companyId: string,
  plotId: string,
  workingWidthM: number | null = 4,
): Promise<FieldOperationSession> {
  return dal.startFieldSession({
    company_id: companyId,
    planned_task_id: null,
    plot_id: plotId,
    operation_type: "tillage",
    recipe_id: null,
    machine_id: null,
    equipment_id: null,
    working_width_m: workingWidthM,
    operator_name: null,
    notes: null,
  });
}

// ---------------------------------------------------------------------------
// 1. Tracciato GPS incrementale: path che cresce, ricalcolo, round-trip
// ---------------------------------------------------------------------------

describe("InFieldDashboard / tracciamento GPS incrementale", () => {
  it("updateFieldSession accumula il path, ricalcola path_length_m/area_worked_ha, e il LineString torna un oggetto reale", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, 4);

    const firstCoords: [number, number][] = [
      [9, 45],
      [9.001, 45],
    ];
    const firstLength = pathLengthMeters(firstCoords);
    const firstArea = workedAreaHectares(firstCoords, 4, null);
    const afterFirst = await dal.updateFieldSession(session.id, {
      path: { type: "LineString", coordinates: firstCoords },
      path_length_m: firstLength,
      area_worked_ha: firstArea,
    });
    assert.ok(afterFirst);
    // Round-trip: un oggetto vero, non una stringa JSON grezza.
    assert.equal(typeof afterFirst?.path, "object");
    assert.equal(afterFirst?.path.type, "LineString");
    assert.deepEqual(afterFirst?.path.coordinates, firstCoords);
    assert.ok(Math.abs(Number(afterFirst?.path_length_m) - firstLength) < 0.01);

    // Batch successivo: il path CRESCE (simula il flush del secondo lotto di
    // campioni GPS accumulati dall'InFieldDashboard), non si sovrascrive.
    const secondCoords: [number, number][] = [...firstCoords, [9.002, 45]];
    const secondLength = pathLengthMeters(secondCoords);
    const secondArea = workedAreaHectares(secondCoords, 4, null);
    const afterSecond = await dal.updateFieldSession(session.id, {
      path: { type: "LineString", coordinates: secondCoords },
      path_length_m: secondLength,
      area_worked_ha: secondArea,
    });
    assert.equal(afterSecond?.path.coordinates.length, 3);
    assert.ok(Number(afterSecond?.path_length_m) > Number(afterFirst?.path_length_m));
    assert.ok(Number(afterSecond?.area_worked_ha) >= Number(afterFirst?.area_worked_ha));

    // Rilettura pulita dal DB (non l'oggetto già in memoria): stesso risultato.
    const reread = await dal.getFieldSession(session.id);
    assert.equal(typeof reread?.path, "object");
    assert.equal(reread?.path.coordinates.length, 3);
    assert.ok(Math.abs(Number(reread?.path_length_m) - secondLength) < 0.01);
  });

  it("il bookkeeping di pausa (chiavi extra sul path) sopravvive al round-trip senza rompere coordinates", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, null);

    // L'InFieldDashboard mette in pausa scrivendo pausedSince accanto al path
    // (vedi apps/agro-field-suite/.../field-mode/session-track.ts): niente
    // colonna nuova, solo chiavi aggiuntive nello stesso jsonb.
    const updated = await dal.updateFieldSession(session.id, {
      path: {
        type: "LineString",
        coordinates: [[9, 45]],
        pausedSince: "2024-06-01T08:00:00.000Z",
      } as unknown as FieldOperationSession["path"],
      status: "PAUSED",
    });
    const reread = await dal.getFieldSession(session.id);
    assert.equal(reread?.status, "PAUSED");
    assert.deepEqual(reread?.path.coordinates, [[9, 45]]);
    assert.equal((reread?.path as unknown as { pausedSince: string }).pausedSince, "2024-06-01T08:00:00.000Z");
    assert.equal(updated?.status, "PAUSED");
  });
});

// ---------------------------------------------------------------------------
// 2. Note vocali: blob LOCAL-ONLY + append in audio_notes
// ---------------------------------------------------------------------------

describe("InFieldDashboard / note vocali geotaggate", () => {
  it("saveAudioNote scrive il blob E lo aggiunge a audio_notes; loadAudioBlob lo ritrova dall'URI", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId);

    const note = await dal.saveAudioNote(session.id, {
      mime_type: "audio/webm",
      duration_s: 12,
      data_base64: "ZmFrZS1hdWRpby1kYXRh",
      lat: 45.123,
      lon: 9.456,
    });
    assert.ok(note);
    assert.ok(note?.audio_uri.startsWith(AUDIO_URI_SCHEME));
    assert.equal(note?.lat, 45.123);
    assert.equal(note?.lon, 9.456);
    assert.equal(note?.duration_s, 12);

    const reread = await dal.getFieldSession(session.id);
    assert.equal(reread?.audio_notes.length, 1);
    assert.equal(reread?.audio_notes[0]?.id, note?.id);
    assert.equal(reread?.audio_notes[0]?.audio_uri, note?.audio_uri);

    const blob = await dal.loadAudioBlob(note!.audio_uri);
    assert.ok(blob);
    assert.equal(blob?.mime_type, "audio/webm");
    // duration_s è `numeric(8,2)` a schema: PGlite lo ritorna come stringa.
    assert.equal(Number(blob?.duration_s), 12);
    assert.equal(blob?.data_base64, "ZmFrZS1hdWRpby1kYXRh");
  });

  it("una seconda nota si accoda alla prima senza sostituirla", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId);

    await dal.saveAudioNote(session.id, {
      mime_type: "audio/webm",
      duration_s: 5,
      data_base64: "YQ==",
      lat: 45,
      lon: 9,
    });
    await dal.saveAudioNote(session.id, {
      mime_type: "audio/webm",
      duration_s: 8,
      data_base64: "Yg==",
      lat: 45.1,
      lon: 9.1,
    });

    const reread = await dal.getFieldSession(session.id);
    assert.equal(reread?.audio_notes.length, 2);
  });

  it("loadAudioBlob ritorna null per un URI mancante o senza lo schema atteso", async () => {
    const dal = await TestDal.create();
    assert.equal(
      await dal.loadAudioBlob(`${AUDIO_URI_SCHEME}00000000-0000-0000-0000-000000000000`),
      null,
    );
    assert.equal(await dal.loadAudioBlob("https://non-e-un-blob-audio"), null);
  });

  it("saveAudioNote su una sessione inesistente/cancellata ritorna null", async () => {
    const dal = await TestDal.create();
    const result = await dal.saveAudioNote(
      "00000000-0000-0000-0000-000000000000",
      { mime_type: "audio/webm", duration_s: null, data_base64: "x", lat: 0, lon: 0 },
    );
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// 3. Outbox: il blob è LOCAL-ONLY, la sessione sincronizza normalmente
// ---------------------------------------------------------------------------

describe("InFieldDashboard / outbox", () => {
  it("saveAudioNote produce UNA voce di update su field_operation_sessions e NESSUNA su field_session_audio", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId);

    const before = await dal.rawQuery<{ n: number }>(
      `select count(*)::int as n from sync_outbox where table_name = 'field_operation_sessions'`,
    );

    await dal.saveAudioNote(session.id, {
      mime_type: "audio/webm",
      duration_s: 3,
      data_base64: "YWJj",
      lat: 45,
      lon: 9,
    });

    const afterSession = await dal.rawQuery<{ n: number }>(
      `select count(*)::int as n from sync_outbox where table_name = 'field_operation_sessions'`,
    );
    assert.equal(afterSession.rows[0].n, before.rows[0].n + 1);

    const audioOutbox = await dal.rawQuery<{ n: number }>(
      `select count(*)::int as n from sync_outbox where table_name = 'field_session_audio'`,
    );
    assert.equal(audioOutbox.rows[0].n, 0);

    // La row del blob esiste comunque (solo local-only, non "non scritta").
    const blobRows = await dal.rawQuery<{ n: number }>(
      `select count(*)::int as n from field_session_audio where session_id = $1`,
      [session.id],
    );
    assert.equal(blobRows.rows[0].n, 1);
  });

  it("updateFieldSession del tracciamento GPS produce anch'esso una voce di outbox (a differenza del blob audio)", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId);

    const before = await dal.rawQuery<{ n: number }>(
      `select count(*)::int as n from sync_outbox where table_name = 'field_operation_sessions'`,
    );
    await dal.updateFieldSession(session.id, {
      path: { type: "LineString", coordinates: [[9, 45]] },
      path_length_m: 0,
      area_worked_ha: 0,
    });
    const after = await dal.rawQuery<{ n: number }>(
      `select count(*)::int as n from sync_outbox where table_name = 'field_operation_sessions'`,
    );
    assert.equal(after.rows[0].n, before.rows[0].n + 1);
  });
});

// ---------------------------------------------------------------------------
// 4. Cancellazione/abbandono: cosa garantisce l'implementazione sui blob
// ---------------------------------------------------------------------------

describe("InFieldDashboard / cancellazione e abbandono", () => {
  it("un DELETE reale della sessione cascata l'eliminazione dei blob audio (FK on delete cascade dello schema)", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId);
    const note = await dal.saveAudioNote(session.id, {
      mime_type: "audio/webm",
      duration_s: 4,
      data_base64: "eHl6",
      lat: 45,
      lon: 9,
    });
    const blobId = note!.audio_uri.slice(AUDIO_URI_SCHEME.length);

    const before = await dal.rawQuery<{ n: number }>(
      `select count(*)::int as n from field_session_audio where id = $1`,
      [blobId],
    );
    assert.equal(before.rows[0].n, 1);

    // L'app non fa MAI un DELETE reale sulle sessioni (abortFieldSession è un
    // soft-update): qui si verifica la garanzia a livello di FK dello schema,
    // che è quella che protegge da blob orfani se in futuro un hard-delete
    // dovesse comparire (es. un comando di pulizia manuale).
    await dal.rawQuery(`delete from field_operation_sessions where id = $1`, [session.id]);

    const after = await dal.rawQuery<{ n: number }>(
      `select count(*)::int as n from field_session_audio where id = $1`,
      [blobId],
    );
    assert.equal(after.rows[0].n, 0);
  });

  it("abortFieldSession (soft, nessun DELETE reale) lascia intatti sessione e blob audio: restano ispezionabili nello storico", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId);
    const note = await dal.saveAudioNote(session.id, {
      mime_type: "audio/webm",
      duration_s: 4,
      data_base64: "eHl6",
      lat: 45,
      lon: 9,
    });

    const aborted = await dal.abortFieldSession(session.id);
    assert.equal(aborted?.status, "ABORTED");

    // Il blob NON viene toccato dall'abbandono: la nota resta riproducibile.
    const blob = await dal.loadAudioBlob(note!.audio_uri);
    assert.ok(blob);

    const reread = await dal.getFieldSession(session.id);
    assert.equal(reread?.audio_notes.length, 1);
  });
});
