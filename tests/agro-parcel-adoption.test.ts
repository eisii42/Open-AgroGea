import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  attributionLine,
  findAdoptedPlot,
  PARCEL_METADATA_KEY,
  parcelProvenance,
  parcelToPlotDraft,
  plotProvenance,
  type Plot,
} from "@agrogea/core";
import type { ManualParcel, Parcel, SourcedParcel } from "@agrogea/parcel";
import type { Polygon } from "geojson";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";

/**
 * Adozione delle particelle (v22): migrazione additiva di `plots_registry`,
 * chiave di deduplica e conversione Parcel → Plot con la provenienza intatta.
 */

const SOURCE_GEOMETRY: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [5.1, 51.44],
      [5.11, 51.44],
      [5.11, 51.45],
      [5.1, 51.44],
    ],
  ],
};

const EDITED_GEOMETRY: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [5.2, 51.5],
      [5.21, 51.5],
      [5.21, 51.51],
      [5.2, 51.5],
    ],
  ],
};

function sourcedParcel(overrides: Partial<SourcedParcel> = {}): SourcedParcel {
  return {
    id: "1e0d5f8a-2f47-4c3e-9a10-4d2a6b7c8e90",
    geometry: SOURCE_GEOMETRY,
    editedGeometry: null,
    referenceUnitType: "agricultural_parcel",
    country: "NL",
    nutsCode: "NL",
    eligibleArea: 2.1,
    declaredArea: 2.4312,
    validityYear: 2025,
    nationalCropCode: "259",
    hcatCode: null,
    farmFields: [],
    retrievedAt: "2026-09-01T08:00:00.000Z",
    sourceId: "BRP.2025.45247317",
    originalGeometry: SOURCE_GEOMETRY,
    originalCrs: "EPSG:4258",
    sourceName: "BRP Gewaspercelen (INSPIRE geharmoniseerd)",
    sourceUrl: "https://service.pdok.nl/rvo/gewaspercelen-geharmoniseerd/wfs/v1_0",
    license: { id: "CC0-1.0", attribution: "RVO / PDOK" },
    ...overrides,
  };
}

function manualParcel(): ManualParcel {
  return {
    id: "3c7f1a92-5b6d-4e28-9f01-6a2b8c4d5e30",
    geometry: SOURCE_GEOMETRY,
    editedGeometry: null,
    referenceUnitType: "manual",
    country: "IT",
    nutsCode: "ITI1",
    eligibleArea: null,
    declaredArea: null,
    validityYear: null,
    nationalCropCode: null,
    hcatCode: null,
    farmFields: [],
    retrievedAt: "2026-09-01T08:00:00.000Z",
    sourceId: null,
    originalGeometry: null,
    originalCrs: null,
    sourceName: null,
    sourceUrl: null,
    license: null,
  };
}

/** Riga completa di `plots_registry` a partire da una bozza di adozione. */
function plotFromDraft(
  draft: ReturnType<typeof parcelToPlotDraft>,
  overrides: Partial<Plot> = {},
): Plot {
  return {
    ...draft,
    tenant_id: "00000000-0000-4000-8000-000000000001",
    area_ha: 2.4,
    created_at: "2026-09-01T08:00:00.000Z",
    updated_at: "2026-09-01T08:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

let idCounter = 0;
const nextId = () => `plot-${++idCounter}`;

async function columnNames(db: PGlite, table: string): Promise<string[]> {
  const r = await db.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_name=$1 order by 1",
    [table],
  );
  return r.rows.map((x) => x.column_name);
}

describe("adozione particelle / migrazione v22", () => {
  it("aggiunge le colonne di provenienza ed è idempotente", async () => {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    await db.exec(AGRO_LOCAL_SCHEMA_SQL); // due volte: idempotente
    const columns = await columnNames(db, "plots_registry");
    for (const column of [
      "source_id",
      "nuts_code",
      "reference_unit_type",
      "validity_year",
    ]) {
      assert.ok(columns.includes(column), `manca la colonna ${column}`);
    }
  });

  it("un database pre-v22 si aggiorna senza perdere le righe esistenti", async () => {
    const db = new PGlite();
    // Istanza com'era prima della v22: tabella senza le colonne nuove, con
    // dentro un appezzamento disegnato a mano da un utente reale.
    await db.exec(`
      create table companies (id uuid primary key, tenant_id uuid not null);
      create table plots_registry (
        id             uuid primary key,
        tenant_id      uuid not null,
        company_id     uuid not null references companies (id),
        user_plot_name text not null,
        geometry       jsonb not null,
        area_ha        numeric(10, 4) not null,
        metadata       jsonb not null default '{}',
        created_at     timestamptz not null default now(),
        updated_at     timestamptz not null default now(),
        deleted_at     timestamptz
      );
      insert into companies (id, tenant_id) values
        ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
      insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
      values ('33333333-3333-4333-8333-333333333333',
              '22222222-2222-4222-8222-222222222222',
              '11111111-1111-4111-8111-111111111111',
              'Campo vecchio', '{"type":"Polygon","coordinates":[]}', 1.5);
    `);

    await db.exec(AGRO_LOCAL_SCHEMA_SQL);

    const rows = await db.query<{
      user_plot_name: string;
      area_ha: number;
      source_id: string | null;
      reference_unit_type: string | null;
    }>("select user_plot_name, area_ha, source_id, reference_unit_type from plots_registry");
    assert.equal(rows.rows.length, 1);
    // La riga preesistente sopravvive intatta, con la provenienza a null.
    assert.equal(rows.rows[0].user_plot_name, "Campo vecchio");
    assert.equal(Number(rows.rows[0].area_ha), 1.5);
    assert.equal(rows.rows[0].source_id, null);
    assert.equal(rows.rows[0].reference_unit_type, null);
  });
});

describe("adozione particelle / chiave di deduplica", () => {
  async function seeded(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    await db.exec(`
      insert into companies (id, tenant_id, business_name) values
        ('11111111-1111-4111-8111-111111111111',
         '22222222-2222-4222-8222-222222222222', 'Azienda A'),
        ('44444444-4444-4444-8444-444444444444',
         '22222222-2222-4222-8222-222222222222', 'Azienda B');
    `);
    return db;
  }

  const insert = `insert into plots_registry
    (id, tenant_id, company_id, user_plot_name, geometry, area_ha, source_id, nuts_code)
    values ($1,'22222222-2222-4222-8222-222222222222',$2,$3,'{"type":"Polygon","coordinates":[]}',1,$4,$5)`;

  const COMPANY_A = "11111111-1111-4111-8111-111111111111";
  const COMPANY_B = "44444444-4444-4444-8444-444444444444";

  /** UUID valido e riconoscibile a partire da un indice (la colonna è `uuid`). */
  function uid(n: number): string {
    return `99999999-9999-4999-8999-${String(n).padStart(12, "0")}`;
  }

  it("impedisce di adottare due volte la stessa particella", async () => {
    const db = await seeded();
    await db.query(insert, [uid(1), COMPANY_A, "Primo", "BRP.2025.1", "NL"]);
    await assert.rejects(
      () => db.query(insert, [uid(2), COMPANY_A, "Doppione", "BRP.2025.1", "NL"]),
      /duplicate key|unique/i,
    );
  });

  it("lo stesso identificativo in un nodo NUTS diverso è un'altra particella", async () => {
    // La granularità del catalogo è il nodo: due nodi possono usare numerazioni
    // sovrapposte, quindi il solo source_id non sarebbe univoco.
    const db = await seeded();
    await db.query(insert, [uid(1), COMPANY_A, "NL", "12345", "NL"]);
    await db.query(insert, [uid(2), COMPANY_A, "DE", "12345", "DE1"]);
    const r = await db.query("select count(*)::int n from plots_registry");
    assert.equal((r.rows[0] as { n: number }).n, 2);
  });

  it("due companies possono avere la stessa particella", async () => {
    // È il caso dell'agronomo che segue più aziende: il confine di proprietà è
    // la company, non il tenant.
    const db = await seeded();
    await db.query(insert, [uid(1), COMPANY_A, "A", "BRP.9", "NL"]);
    await db.query(insert, [uid(2), COMPANY_B, "B", "BRP.9", "NL"]);
    const r = await db.query("select count(*)::int n from plots_registry");
    assert.equal((r.rows[0] as { n: number }).n, 2);
  });

  it("una particella cancellata può essere riadottata", async () => {
    // Senza la condizione sul tombstone, cancellare un appezzamento ne
    // vieterebbe per sempre la riadozione.
    const db = await seeded();
    await db.query(insert, [uid(1), COMPANY_A, "Primo", "BRP.7", "NL"]);
    await db.query("update plots_registry set deleted_at = now() where id = $1", [
      uid(1),
    ]);
    await db.query(insert, [uid(2), COMPANY_A, "Riadottato", "BRP.7", "NL"]);
    const r = await db.query(
      "select count(*)::int n from plots_registry where deleted_at is null",
    );
    assert.equal((r.rows[0] as { n: number }).n, 1);
  });

  it("gli appezzamenti disegnati a mano non si ostacolano fra loro", async () => {
    // Nessuna provenienza, nessun vincolo: due disegni sullo stesso campo
    // restano due appezzamenti distinti, e nessuno può dire che siano lo stesso.
    const db = await seeded();
    await db.query(insert, [uid(1), COMPANY_A, "Disegno 1", null, null]);
    await db.query(insert, [uid(2), COMPANY_A, "Disegno 2", null, null]);
    const r = await db.query("select count(*)::int n from plots_registry");
    assert.equal((r.rows[0] as { n: number }).n, 2);
  });
});

describe("adozione particelle / conversione in appezzamento", () => {
  it("porta la provenienza nelle colonne e nei metadata", () => {
    const draft = parcelToPlotDraft(
      sourcedParcel(),
      { companyId: "company-1", name: "Campo dei Mais" },
      nextId,
    );
    assert.equal(draft.user_plot_name, "Campo dei Mais");
    assert.equal(draft.company_id, "company-1");
    // Colonne: ciò su cui si deduplica e si filtra.
    assert.equal(draft.source_id, "BRP.2025.45247317");
    assert.equal(draft.nuts_code, "NL");
    assert.equal(draft.reference_unit_type, "agricultural_parcel");
    assert.equal(draft.validity_year, 2025);
    // Metadata: ciò che si conserva ma non si interroga.
    const provenance = draft.metadata[PARCEL_METADATA_KEY] as Record<string, unknown>;
    assert.equal(provenance.origin, "parcel-adoption");
    assert.equal(provenance.sourceName, "BRP Gewaspercelen (INSPIRE geharmoniseerd)");
    assert.equal(provenance.originalCrs, "EPSG:4258");
    assert.deepEqual(provenance.license, { id: "CC0-1.0", attribution: "RVO / PDOK" });
    assert.deepEqual(provenance.originalGeometry, SOURCE_GEOMETRY);
    assert.equal(provenance.nationalCropCode, "259");
    assert.equal(provenance.declaredArea, 2.4312);
  });

  it("non porta la superficie dichiarata dalla fonte come misura", () => {
    // area_ha è ricalcolata dal DAL con @turf/area ed è l'unico punto di verità
    // per dosi e quantità: la superficie della fonte resta un dato di
    // provenienza, non una misura su cui calcolare.
    const draft = parcelToPlotDraft(
      sourcedParcel(),
      { companyId: "company-1", name: "X" },
      nextId,
    );
    assert.ok(!("area_ha" in draft));
  });

  it("adotta la rettifica dell'utente quando c'è, senza perdere l'originale", () => {
    const draft = parcelToPlotDraft(
      sourcedParcel({ editedGeometry: EDITED_GEOMETRY }),
      { companyId: "company-1", name: "X" },
      nextId,
    );
    assert.deepEqual(draft.geometry, EDITED_GEOMETRY);
    const provenance = draft.metadata[PARCEL_METADATA_KEY] as Record<string, unknown>;
    // La correzione non cancella ciò che l'ente dichiarava.
    assert.deepEqual(provenance.originalGeometry, SOURCE_GEOMETRY);
  });

  it("una particella disegnata a mano non porta provenienza", () => {
    const draft = parcelToPlotDraft(
      manualParcel(),
      { companyId: "company-1", name: "Disegno" },
      nextId,
    );
    assert.equal(draft.source_id, null);
    assert.equal(draft.reference_unit_type, "manual");
    // Il nodo NUTS resta: dice comunque dove si trova il campo.
    assert.equal(draft.nuts_code, "ITI1");
    const provenance = parcelProvenance(manualParcel());
    assert.equal(provenance.license, null);
    assert.equal(provenance.sourceName, null);
  });
});

describe("adozione particelle / riconoscimento e attribuzione", () => {
  const draft = parcelToPlotDraft(
    sourcedParcel(),
    { companyId: "company-1", name: "Campo" },
    () => "plot-fisso",
  );
  const adopted = plotFromDraft(draft);

  it("riconosce una particella già adottata", () => {
    assert.equal(findAdoptedPlot([adopted], sourcedParcel())?.id, "plot-fisso");
  });

  it("non confonde particelle di nodi diversi", () => {
    const altrove = sourcedParcel({ nutsCode: "DE1" });
    assert.equal(findAdoptedPlot([adopted], altrove), null);
  });

  it("ignora gli appezzamenti cancellati", () => {
    // Sono riadottabili, quindi non devono risultare già presenti.
    const cancellato = plotFromDraft(draft, { deleted_at: "2026-09-01T09:00:00.000Z" });
    assert.equal(findAdoptedPlot([cancellato], sourcedParcel()), null);
  });

  it("una particella disegnata a mano non corrisponde mai a nulla", () => {
    assert.equal(findAdoptedPlot([adopted], manualParcel()), null);
  });

  it("rilegge la provenienza dall'appezzamento persistito", () => {
    const provenance = plotProvenance(adopted);
    assert.equal(provenance?.sourceName, "BRP Gewaspercelen (INSPIRE geharmoniseerd)");
    assert.equal(provenance?.license?.attribution, "RVO / PDOK");
  });

  it("compone la riga di attribuzione da mostrare", () => {
    // L'obbligo di attribuzione viaggia col dato: questa è la forma in cui si
    // onora a schermo.
    assert.equal(
      attributionLine(adopted),
      "BRP Gewaspercelen (INSPIRE geharmoniseerd) — RVO / PDOK (CC0-1.0)",
    );
  });

  it("un appezzamento senza provenienza non ha attribuzione", () => {
    const manuale = plotFromDraft(
      parcelToPlotDraft(manualParcel(), { companyId: "c", name: "M" }, nextId),
    );
    assert.equal(plotProvenance(manuale)?.license, null);
    assert.equal(attributionLine(manuale), null);
  });
});
