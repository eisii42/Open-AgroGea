import type { Transaction } from "@electric-sql/pglite";
import { v4 as uuidv4 } from "uuid";
import type {
  CatalogEntry,
  CompanyWeatherConfig,
  DataTransferLog,
  DssResult,
  WeatherReading,
  SoilWaterIndex,
  CatalogType,
} from "../types";
import { AgroDalWarehouse } from "./dal-warehouse";
import { nowIso, type Row, upsertSql } from "./write";

/**
 * Strato "moduli locali" del DAL: letture e configurazione meteo, cache DSS,
 * bilancio idrico FAO 56/66, giornale trasferimenti e cataloghi di stato.
 * Tranne le letture meteo di stazione, sono tabelle LOCAL-ONLY: scritture
 * dirette, mai dall'outbox.
 */
export class AgroDalLocal extends AgroDalWarehouse {
  // -- letture meteo (Smart IoT / agrometeo) ---------------------------------

  /**
   * Ingestione in blocco di metriche di stazione (parsing edge → PGlite). Ogni
   * lettura passa dal solito percorso transazionale dato+outbox. Idempotente per `id`.
   */
  async insertLettureMeteo(
    letture: Array<
      Omit<WeatherReading, "tenant_id" | "created_at" | "updated_at" | "deleted_at">
    >,
  ): Promise<number> {
    const ts = nowIso();
    for (const lettura of letture) {
      const row: WeatherReading = {
        ...lettura,
        metadata: lettura.metadata ?? {},
        tenant_id: this.tenantId,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      };
      await this.writeWithOutbox(
        "weather_readings",
        "insert",
        row as unknown as Row & { id: string },
      );
    }
    return letture.length;
  }

  /**
   * Ingestione in blocco di letture meteo RICOMPUTABILI (Open-Meteo): un'unica
   * transazione, nessuna voce di outbox. Idempotente per `id`.
   */
  async insertLettureMeteoLocali(
    letture: Array<
      Omit<WeatherReading, "tenant_id" | "created_at" | "updated_at" | "deleted_at">
    >,
  ): Promise<number> {
    if (letture.length === 0) return 0;
    const ts = nowIso();
    await this.db.transaction(async (tx: Transaction) => {
      for (const lettura of letture) {
        const row: WeatherReading = {
          ...lettura,
          metadata: lettura.metadata ?? {},
          tenant_id: this.tenantId,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        };
        const { sql, values } = upsertSql(
          "weather_readings",
          row as unknown as Row,
        );
        await tx.query(sql, values);
      }
    });
    return letture.length;
  }

  async listLettureMeteo(
    companyId: string,
    options: { stazioneId?: string; dopo?: string; limit?: number } = {},
  ): Promise<WeatherReading[]> {
    const conditions = ["company_id = $1", "deleted_at is null"];
    const params: unknown[] = [companyId];
    if (options.stazioneId) {
      params.push(options.stazioneId);
      conditions.push(`station_id = $${params.length}`);
    }
    if (options.dopo) {
      params.push(options.dopo);
      conditions.push(`measured_at >= $${params.length}`);
    }
    params.push(options.limit ?? 5000);
    const result = await this.db.query<WeatherReading>(
      `select * from weather_readings
       where ${conditions.join(" and ")}
       order by measured_at asc
       limit $${params.length}`,
      params,
    );
    return result.rows;
  }

  /**
   * Timestamp della lettura meteo più vecchia dell'azienda (ISO), o null. Usato
   * dal backfill storico per evitare richieste ridondanti all'Archive API.
   */
  async minRilevatoMeteo(companyId: string): Promise<string | null> {
    const result = await this.db.query<{ m: string | null }>(
      `select min(measured_at) as m from weather_readings
       where company_id = $1 and deleted_at is null`,
      [companyId],
    );
    const m = result.rows[0]?.m ?? null;
    return m ? new Date(m).toISOString() : null;
  }

  // -- config meteo company (Modulo Meteo, local-only) -----------------------

  async getConfigMeteo(companyId: string): Promise<CompanyWeatherConfig | null> {
    const result = await this.db.query<CompanyWeatherConfig>(
      `select * from weather_config where company_id = $1`,
      [companyId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Crea o update la configurazione meteo dell'azienda (upsert sull'azienda).
   * Preserva `last_weather_pull_at` se non passato esplicitamente.
   */
  async upsertConfigMeteo(
    input: Pick<CompanyWeatherConfig, "company_id"> &
      Partial<Omit<CompanyWeatherConfig, "company_id" | "tenant_id" | "created_at" | "updated_at">>,
  ): Promise<CompanyWeatherConfig> {
    const ts = nowIso();
    const corrente = await this.getConfigMeteo(input.company_id);
    const row: CompanyWeatherConfig = {
      company_id: input.company_id,
      tenant_id: this.tenantId,
      data_source: input.data_source ?? corrente?.data_source ?? "public_api",
      api_provider: input.api_provider ?? corrente?.api_provider ?? "open-meteo",
      station_model: input.station_model ?? corrente?.station_model ?? null,
      station_api_key: input.station_api_key ?? corrente?.station_api_key ?? null,
      station_device_id:
        input.station_device_id ?? corrente?.station_device_id ?? null,
      visible_variables:
        input.visible_variables ??
        corrente?.visible_variables ?? ["temperature", "humidity", "rain"],
      last_weather_pull_at:
        input.last_weather_pull_at !== undefined
          ? input.last_weather_pull_at
          : corrente?.last_weather_pull_at ?? null,
      created_at: corrente?.created_at ?? ts,
      updated_at: ts,
    };
    await this.db.query(
      `insert into weather_config
         (company_id, tenant_id, data_source, api_provider, station_model,
          station_api_key, station_device_id, visible_variables,
          last_weather_pull_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (company_id) do update set
         tenant_id = excluded.tenant_id,
         data_source = excluded.data_source,
         api_provider = excluded.api_provider,
         station_model = excluded.station_model,
         station_api_key = excluded.station_api_key,
         station_device_id = excluded.station_device_id,
         visible_variables = excluded.visible_variables,
         last_weather_pull_at = excluded.last_weather_pull_at,
         updated_at = excluded.updated_at`,
      [
        row.company_id,
        row.tenant_id,
        row.data_source,
        row.api_provider,
        row.station_model,
        row.station_api_key,
        row.station_device_id,
        JSON.stringify(row.visible_variables),
        row.last_weather_pull_at,
        row.created_at,
        row.updated_at,
      ],
    );
    return row;
  }

  /** Aggiorna SOLO il lucchetto orario dopo un pull meteo riuscito. */
  async touchWeatherPull(companyId: string, quando: string): Promise<void> {
    const corrente = await this.getConfigMeteo(companyId);
    if (!corrente) {
      await this.upsertConfigMeteo({
        company_id: companyId,
        last_weather_pull_at: quando,
      });
      return;
    }
    await this.db.query(
      `update weather_config
       set last_weather_pull_at = $2, updated_at = $2
       where company_id = $1`,
      [companyId, quando],
    );
  }

  // -- cache risultati DSS (Modulo Meteo, local-only) ------------------------

  /**
   * Sostituisce in transazione i risultati cache dei modelli passati per un
   * plot: semantica "ultimo value per modello".
   */
  async saveDssResults(
    plotId: string,
    risultati: Array<
      Pick<DssResult, "model_name" | "risk_level" | "output_value"> & {
        calculated_at?: string;
      }
    >,
  ): Promise<DssResult[]> {
    const ts = nowIso();
    const rows: DssResult[] = risultati.map((r) => ({
      id: uuidv4(),
      plot_id: plotId,
      model_name: r.model_name,
      risk_level: r.risk_level,
      output_value: r.output_value,
      calculated_at: r.calculated_at ?? ts,
    }));
    await this.db.transaction(async (tx: Transaction) => {
      const modelli = risultati.map((r) => r.model_name);
      if (modelli.length > 0) {
        await tx.query(
          `delete from dss_results
           where plot_id = $1 and model_name = any($2::text[])`,
          [plotId, modelli],
        );
      }
      for (const r of rows) {
        await tx.query(
          `insert into dss_results
             (id, plot_id, model_name, risk_level, output_value, calculated_at)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            r.id,
            r.plot_id,
            r.model_name,
            r.risk_level,
            r.output_value,
            r.calculated_at,
          ],
        );
      }
    });
    return rows;
  }

  async listDssRisultati(
    plotId: string,
    options: { limit?: number } = {},
  ): Promise<DssResult[]> {
    const result = await this.db.query<DssResult>(
      `select * from dss_results
       where plot_id = $1
       order by calculated_at desc
       limit $2`,
      [plotId, options.limit ?? 200],
    );
    return result.rows;
  }

  // -- bilancio idrico FAO 56/66 (Modulo Acqua, local-only) ------------------

  /**
   * Sostituisce in transazione l'INTERA serie del bilancio idrico di una
   * campagna del field: il calcolo è ricomputato per intero ad ogni run, quindi
   * la semantica è "rimpiazza tutto per plot_campaign_id" (come dss_results per
   * modello). Local-only: nessuna voce di outbox.
   */
  async saveWaterIndices(
    plotCampaignId: string,
    rows: Array<
      Omit<SoilWaterIndex, "id" | "plot_campaign_id" | "calculated_at"> & {
        calculated_at?: string;
      }
    >,
  ): Promise<SoilWaterIndex[]> {
    const ts = nowIso();
    const out: SoilWaterIndex[] = rows.map((r) => ({
      id: uuidv4(),
      plot_campaign_id: plotCampaignId,
      date: r.date,
      et0: r.et0,
      etc: r.etc,
      rain_mm: r.rain_mm,
      irrigation_mm: r.irrigation_mm,
      deep_percolation_mm: r.deep_percolation_mm,
      depletion_mm: r.depletion_mm,
      raw_mm: r.raw_mm,
      awc_mm: r.awc_mm,
      water_stress: r.water_stress,
      calculated_at: r.calculated_at ?? ts,
    }));
    await this.db.transaction(async (tx: Transaction) => {
      await tx.query(`delete from soil_water_indices where plot_campaign_id = $1`, [
        plotCampaignId,
      ]);
      for (const r of out) {
        await tx.query(
          `insert into soil_water_indices
             (id, plot_campaign_id, date, et0, etc, rain_mm, irrigation_mm,
              deep_percolation_mm, depletion_mm, raw_mm, awc_mm, water_stress,
              calculated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            r.id,
            r.plot_campaign_id,
            r.date,
            r.et0,
            r.etc,
            r.rain_mm,
            r.irrigation_mm,
            r.deep_percolation_mm,
            r.depletion_mm,
            r.raw_mm,
            r.awc_mm,
            r.water_stress,
            r.calculated_at,
          ],
        );
      }
    });
    return out;
  }

  async listIndiciIdrici(
    plotCampaignId: string,
    options: { limit?: number } = {},
  ): Promise<SoilWaterIndex[]> {
    const result = await this.db.query<SoilWaterIndex>(
      `select * from soil_water_indices
       where plot_campaign_id = $1
       order by date asc
       limit $2`,
      [plotCampaignId, options.limit ?? 1000],
    );
    return result.rows;
  }

  // -- giornale trasferimenti (Modulo Tag I/O, local-only) -------------------

  /**
   * Registra un trasferimento dati (import/export). Scrittura diretta, MAI
   * dall'outbox: è un giornale di attività del device.
   */
  async logDataTransfer(
    input: Pick<
      DataTransferLog,
      "operation_type" | "file_format" | "file_name"
    > & { executed_at?: string; id?: string },
  ): Promise<DataTransferLog> {
    const ts = nowIso();
    const row: DataTransferLog = {
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      operation_type: input.operation_type,
      file_format: input.file_format,
      file_name: input.file_name,
      executed_at: input.executed_at ?? ts,
      created_at: ts,
    };
    await this.db.query(
      `insert into data_transfer_logs
         (id, tenant_id, operation_type, file_format, file_name, executed_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.id,
        row.tenant_id,
        row.operation_type,
        row.file_format,
        row.file_name,
        row.executed_at,
        row.created_at,
      ],
    );
    return row;
  }

  async listDataTransferLogs(
    options: { limit?: number } = {},
  ): Promise<DataTransferLog[]> {
    const result = await this.db.query<DataTransferLog>(
      `select * from data_transfer_logs
       where tenant_id = $1
       order by executed_at desc
       limit $2`,
      [this.tenantId, options.limit ?? 50],
    );
    return result.rows;
  }

  // -- cataloghi di stato multiregionali (Modulo 3, local-only) --------------

  /**
   * Voci di catalogo del paese dato e del tipo dato, sortedList per name.
   * Scrittura/lettura diretta, MAI dall'outbox: è reference data per nazione.
   */
  async listCatalogo(
    countryCode: string,
    tipo: CatalogType,
  ): Promise<CatalogEntry[]> {
    const result = await this.db.query<CatalogEntry>(
      `select * from product_catalogs
       where country_code = $1 and type = $2
       order by name`,
      [countryCode, tipo],
    );
    return result.rows;
  }

  /**
   * Carica in blocco voci di catalogo. Upsert idempotente sulla chiave naturale
   * (country_code, type, code). Local-only.
   */
  async upsertCatalogoVoci(
    voci: Array<
      Pick<CatalogEntry, "country_code" | "type" | "code" | "name"> &
        Partial<Pick<CatalogEntry, "id" | "active_substance" | "registration_number" | "metadata">>
    >,
  ): Promise<number> {
    if (voci.length === 0) return 0;
    const ts = nowIso();
    await this.db.transaction(async (tx: Transaction) => {
      for (const v of voci) {
        await tx.query(
          `insert into product_catalogs
             (id, country_code, type, code, name, active_substance, registration_number, metadata, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
           on conflict (country_code, type, code) do update set
             name = excluded.name,
             active_substance = excluded.active_substance,
             registration_number = excluded.registration_number,
             metadata = excluded.metadata,
             updated_at = excluded.updated_at`,
          [
            v.id ?? uuidv4(),
            v.country_code,
            v.type,
            v.code,
            v.name,
            v.active_substance ?? null,
            v.registration_number ?? null,
            JSON.stringify(v.metadata ?? {}),
            ts,
          ],
        );
      }
    });
    return voci.length;
  }
}
