import { v4 as uuidv4 } from "uuid";
import { normalizeGeometry } from "../geo/area";
import type {
  InfrastructureAsset,
  SoilSample,
  Harvest,
  TreatmentLog,
  ScoutingObservation,
  LastOperation,
} from "../types";
import { AgroDalRegistry } from "./dal-registry";
import { nowIso, type Row } from "./write";

const ETICHETTE_OPERAZIONE: Record<string, string> = {
  phytosanitary: "Trattamento",
  fertilization: "Fertilizzazione",
  irrigation: "Irrigazione",
  tillage: "Lavorazione",
  sowing: "Semina",
  harvest: "Harvest",
  sampling: "Campionamento",
  survey: "Rilievo",
};

/**
 * Strato "registrazioni di campo" del DAL: Quaderno di Campagna (treatments),
 * harvests, soilSamples suolo, rilievi scouting e asset infrastrutturali.
 */
export class AgroDalLogbook extends AgroDalRegistry {
  // -- registro treatments (Quaderno di Campagna) ---------------------------

  async insertTreatment(
    input: Omit<
      TreatmentLog,
      "id" | "tenant_id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string },
  ): Promise<TreatmentLog> {
    const ts = nowIso();
    const row: TreatmentLog = {
      ...input,
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox(
      "treatment_logs",
      "insert",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  /**
   * Soft-delete di una singola operazione del Quaderno: marca `deleted_at` e
   * accoda la mutazione di delete nello stesso percorso transazionale dato+outbox.
   */
  async deleteTreatment(id: string): Promise<void> {
    await this.softDelete("treatment_logs", id);
  }

  async listTreatments(
    companyId: string,
    options: { plotId?: string; limit?: number } = {},
  ): Promise<TreatmentLog[]> {
    const conditions = ["company_id = $1", "deleted_at is null"];
    const params: unknown[] = [companyId];
    if (options.plotId) {
      params.push(options.plotId);
      conditions.push(`plot_id = $${params.length}`);
    }
    params.push(options.limit ?? 200);
    const result = await this.db.query<TreatmentLog>(
      `select * from treatment_logs
       where ${conditions.join(" and ")}
       order by executed_at desc
       limit $${params.length}`,
      params,
    );
    return result.rows;
  }

  /**
   * Ultima operazione di campagna su un appezzamento, per la scheda di
   * dettaglio: la più recente per `executed_at`, con etichetta pronta
   * "[Operazione] - [Data]". Null se l'appezzamento non ha registrazioni.
   */
  async lastOperation(
    plotId: string,
  ): Promise<LastOperation | null> {
    const result = await this.db.query<TreatmentLog>(
      `select * from treatment_logs
       where plot_id = $1 and deleted_at is null
       order by executed_at desc
       limit 1`,
      [plotId],
    );
    const t = result.rows[0];
    if (!t) return null;
    const nomeOp = ETICHETTE_OPERAZIONE[t.operation_type] ?? t.operation_type;
    const data = new Date(t.executed_at).toLocaleDateString("it-IT");
    return {
      plot_id: plotId,
      operation_type: t.operation_type,
      executed_at: t.executed_at,
      product_name: t.product_name,
      etichetta: `${nomeOp} - ${data}`,
    };
  }

  // -- soilSamples suolo (Modulo 1) ----------------------------------------

  async upsertSoilSample(
    input: Omit<
      SoilSample,
      "tenant_id" | "created_at" | "updated_at" | "deleted_at"
    >,
  ): Promise<SoilSample> {
    const ts = nowIso();
    const row: SoilSample = {
      ...input,
      tenant_id: this.tenantId,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox(
      "soil_samples",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  async deleteSoilSample(id: string): Promise<void> {
    await this.softDelete("soil_samples", id);
  }

  async listSoilSamples(companyId: string): Promise<SoilSample[]> {
    const result = await this.db.query<SoilSample>(
      `select * from soil_samples
       where company_id = $1 and deleted_at is null
       order by sampled_at desc`,
      [companyId],
    );
    return result.rows;
  }

  // -- harvest_logs (Modulo Harvest) ----------------------------------------

  async upsertHarvest(
    input: Omit<
      Harvest,
      "tenant_id" | "created_at" | "updated_at" | "deleted_at"
    > &
      Partial<Pick<Harvest, "created_at">>,
  ): Promise<Harvest> {
    const ts = nowIso();
    const row: Harvest = {
      created_at: ts,
      ...input,
      tenant_id: this.tenantId,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox(
      "harvest_logs",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  async deleteHarvest(id: string): Promise<void> {
    await this.softDelete("harvest_logs", id);
  }

  async listHarvests(
    companyId: string,
    options: { plotId?: string; limit?: number } = {},
  ): Promise<Harvest[]> {
    const conditions = ["company_id = $1", "deleted_at is null"];
    const params: unknown[] = [companyId];
    if (options.plotId) {
      params.push(options.plotId);
      conditions.push(`plot_id = $${params.length}`);
    }
    params.push(options.limit ?? 1000);
    const result = await this.db.query<Harvest>(
      `select * from harvest_logs
       where ${conditions.join(" and ")}
       order by harvested_at desc
       limit $${params.length}`,
      params,
    );
    return result.rows;
  }

  // -- asset infrastruttura (Modulo 4 CAD-GIS) -------------------------------

  async upsertAsset(
    input: Omit<
      InfrastructureAsset,
      "tenant_id" | "created_at" | "updated_at" | "deleted_at"
    >,
  ): Promise<InfrastructureAsset> {
    const ts = nowIso();
    const row: InfrastructureAsset = {
      ...input,
      geometry: normalizeGeometry(input.geometry),
      tenant_id: this.tenantId,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox(
      "infrastructure_assets",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  async deleteAsset(id: string): Promise<void> {
    await this.softDelete("infrastructure_assets", id);
  }

  async listAssets(
    companyId: string,
    options: { categoria?: "fixed" | "mobile" } = {},
  ): Promise<InfrastructureAsset[]> {
    const conditions = ["company_id = $1", "deleted_at is null"];
    const params: unknown[] = [companyId];
    if (options.categoria) {
      params.push(options.categoria);
      conditions.push(`category = $${params.length}`);
    }
    const result = await this.db.query<InfrastructureAsset>(
      `select * from infrastructure_assets
       where ${conditions.join(" and ")}
       order by asset_type`,
      params,
    );
    return result.rows;
  }

  // -- scouting_observations (rilievi GPS, multidispositivo) ------------------

  async listOsservazioniScouting(
    companyId: string,
    options: { limit?: number } = {},
  ): Promise<ScoutingObservation[]> {
    const result = await this.db.query<ScoutingObservation>(
      `select * from scouting_observations
       where company_id = $1 and deleted_at is null
       order by created_at desc
       limit $2`,
      [companyId, options.limit ?? 200],
    );
    return result.rows;
  }

  /**
   * Salva un rilievo scouting (PGlite + outbox in un'unica transazione). L'`id`
   * può essere fornito dal chiamante: serve quando la foto va caricata su
   * storage remoto PRIMA dell'insert (il path la usa), così `photo_url` è già
   * valorizzato e passa anch'esso dall'outbox — niente patch local-only.
   */
  async saveScoutingObservation(
    input: Omit<ScoutingObservation, "tenant_id" | "created_at" | "updated_at" | "deleted_at"> &
      Partial<Pick<ScoutingObservation, "id">>,
  ): Promise<ScoutingObservation> {
    const ts = nowIso();
    const row: ScoutingObservation = {
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      company_id: input.company_id,
      lat: input.lat,
      lng: input.lng,
      accuracy_m: input.accuracy_m,
      note: input.note,
      capture_count: input.capture_count,
      observation_date: input.observation_date,
      photo_url: input.photo_url,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox("scouting_observations", "insert", row as unknown as Row & { id: string });
    return row;
  }

  async deleteScoutingObservation(id: string): Promise<void> {
    await this.softDelete("scouting_observations", id);
  }
}
