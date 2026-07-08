import { controlPlane } from "../control-plane";
import { isTauriRuntime, tauriInvoke } from "../runtime";
import type { AgroDal } from "../db/dal";
import type {
  OutboxMutation,
  StorageConfig,
  SyncPushResult,
  SyncTable,
} from "../types";

/**
 * Un target di sincronizzazione riceve un batch di mutazioni dell'outbox e le
 * applica al data plane scelto dal cliente. L'interfaccia è identica per ogni
 * destinazione (data plane gestito dall'edizione o PostgreSQL on-premise): il
 * router non sa (né deve sapere) dove finiscono i dati.
 */
export interface SyncTarget {
  readonly kind: StorageConfig["kind"];
  push(batch: OutboxMutation[]): Promise<SyncPushResult>;
  /**
   * Idratazione inversa: download le rows del tenant dal data plane remoto
   * nel PGlite locale (primo avvio su un dispositivo nuovo, o riallineamento
   * dopo modifiche fatte altrove). Resta opzionale nell'interfaccia per i
   * target che non la supportano. Ritorna il number di rows applicate.
   */
  pull?(dal: AgroDal): Promise<number>;
}

/** Serializza il batch nel wire format condiviso con i data plane remoti. */
export function toWirePayload(batch: OutboxMutation[]) {
  return batch.map((m) => ({
    mutation_id: m.mutation_id,
    table_name: m.table_name,
    row_id: m.row_id,
    operation: m.operation,
    payload: m.payload,
    mutated_at: m.mutated_at,
    device_id: m.device_id,
  }));
}

export const PULL_PAGE_SIZE = 1000;

/**
 * Massimo `updated_at` (ISO) tra le rows di un pull: diventa il watermark
 * della tabella per il pull incrementale successivo. Ignora rows senza
 * timestamp o con timestamp non parsabile.
 */
export function maxUpdatedAt(rows: Record<string, unknown>[]): string | null {
  let max: number | null = null;
  for (const row of rows) {
    const raw = row.updated_at;
    if (typeof raw !== "string") continue;
    const ts = Date.parse(raw);
    if (Number.isNaN(ts)) continue;
    if (max === null || ts > max) max = ts;
  }
  return max === null ? null : new Date(max).toISOString();
}

/**
 * Colonne lette dal data plane remoto per ciascuna tabella sincronizzata: il
 * modello locale, esplicitato per NON trascinarsi `geom` (la colonna spaziale
 * materializzata server-side, che PGlite non conosce). In ordine parent →
 * child, così gli upsert locali rispettano le foreign key.
 */
export const PULL_TABLES: { tabella: SyncTable; columns: string }[] = [
  {
    tabella: "companies",
    columns:
      "id,tenant_id,business_name,national_company_id,vat_number,legal_form," +
      "address,city,province,region,postal_code,country,email,pec,sdi_code," +
      "centroid,certifications,farm_file_id,paying_agency,contact_name," +
      "contact_role,created_at,updated_at,deleted_at",
  },
  {
    tabella: "crops",
    columns:
      "id,tenant_id,common_name,scientific_name,variety_name,crop_metadata," +
      "created_at,updated_at,deleted_at",
  },
  {
    tabella: "plots_registry",
    columns:
      "id,tenant_id,company_id,user_plot_name,cadastral_sheet,cadastral_parcel," +
      "geometry,irrigation_type,planting_year,area_ha,last_ndvi_mean," +
      "historical_notes,metadata,created_at,updated_at,deleted_at",
  },
  {
    tabella: "plots_campaign",
    columns:
      "id,tenant_id,plot_id,crop_id,campaign_year,reference_parcel_external_id," +
      "agricultural_parcel_external_id,crop_external_code,variety_external_code," +
      "declared_area_ha,closed_at,created_at,updated_at,deleted_at",
  },
  {
    tabella: "treatment_logs",
    columns:
      "id,tenant_id,company_id,plot_id,plot_campaign_id,operation_type," +
      "product_name,registration_number,active_substance,dose_value,dose_unit," +
      "total_quantity,water_volume_l,target_disease,fertilizer_type,npk_ratio," +
      "operator_name,operator_tax_code,license_number,machinery_equipment," +
      "executed_at,reentry_interval_h,safety_period_days,weather_conditions," +
      "note,created_at,updated_at,deleted_at",
  },
  {
    tabella: "weather_readings",
    columns:
      "id,tenant_id,company_id,station_id,measured_at,air_temperature," +
      "relative_humidity,rain_mm,leaf_wetness,solar_radiation,wind_speed," +
      "wind_direction,metadata,created_at,updated_at,deleted_at",
  },
  {
    tabella: "soil_samples",
    columns:
      "id,tenant_id,company_id,plot_id,sampled_at,sampling_position," +
      "depth_cm,nitrogen,phosphorus,potassium,organic_matter,ph,texture," +
      "metadata,created_at,updated_at,deleted_at",
  },
  {
    tabella: "infrastructure_assets",
    columns:
      "id,tenant_id,company_id,asset_type,category,name,geometry,attributes," +
      "length_m,area_ha,created_at,updated_at,deleted_at",
  },
  {
    tabella: "harvest_logs",
    columns:
      "id,tenant_id,company_id,plot_id,plot_campaign_id,cultivar," +
      "destination_logistics,quantity_kg,harvested_at,geometry,notes,metadata," +
      "created_at,updated_at,deleted_at",
  },
  {
    tabella: "tenant_memberships",
    columns:
      "id,tenant_id,company_id,email,role,status,invited_at,joined_at," +
      "created_at,updated_at,deleted_at",
  },
  {
    tabella: "products",
    columns:
      "id,tenant_id,company_id,category,name,unit,registration_number," +
      "active_substance,npk_n,npk_p,npk_k,uma_code,supplier,avg_unit_cost," +
      "notes,metadata,created_at,updated_at,deleted_at",
  },
  {
    tabella: "product_lots",
    columns:
      "id,tenant_id,product_id,lot_number,expires_at,initial_quantity," +
      "quantity_on_hand,unit_cost,created_at,updated_at,deleted_at",
  },
  {
    tabella: "activity_products",
    columns:
      "id,tenant_id,treatment_log_id,product_lot_id,quantity,unit_cost," +
      "total_cost,created_at,updated_at,deleted_at",
  },
];

/**
 * Data plane on-premise: il batch è consegnato al comando Rust
 * `agro_push_mutations`, che apre la connessione tokio-postgres verso il
 * PostgreSQL privato del cliente (rete locale/VPN). La stringa di connessione
 * non transita mai per il JS: il comando la risolve dal keystore cifrato
 * usando l'id del profile presente nelle claims di licenza.
 */
export class OnPremiseSyncTarget implements SyncTarget {
  readonly kind = "on_premise" as const;

  constructor(
    private readonly connectionProfile: string,
    private readonly tenantId: string,
  ) {}

  async push(batch: OutboxMutation[]): Promise<SyncPushResult> {
    if (!isTauriRuntime()) {
      throw new Error(
        "Il sync on-premise richiede l'app nativa (comandi Rust di Tauri).",
      );
    }
    return tauriInvoke<SyncPushResult>("agro_push_mutations", {
      profile: this.connectionProfile,
      tenantId: this.tenantId,
      mutations: JSON.stringify(toWirePayload(batch)),
    });
  }

  /**
   * Idratazione inversa dal PostgreSQL privato: il comando Rust
   * `agro_pull_mutations` ritorna `{ tabella: rows[] }` per il tenant (geom
   * esclusa, tombstone inclusi). Le rows si applicano al PGlite locale con
   * LWW, in ordine parent → child per le foreign key. Rende l'on-premise
   * bidirezionale (multi-dispositivo).
   *
   * Pull INCREMENTALE: i watermark per tabella (ultimo `updated_at` visto,
   * persistiti in `agro_meta`) sono passati al comando Rust, che download solo
   * le rows più recenti. Al primo avvio (nessun watermark) il pull è totale.
   */
  async pull(dal: AgroDal): Promise<number> {
    if (!isTauriRuntime()) {
      throw new Error(
        "Il pull on-premise richiede l'app nativa (comandi Rust di Tauri).",
      );
    }
    const watermarks = await dal.getPullWatermarks();
    const data = await tauriInvoke<Record<string, Record<string, unknown>[]>>(
      "agro_pull_mutations",
      {
        profile: this.connectionProfile,
        tenantId: this.tenantId,
        watermarks: JSON.stringify(watermarks),
      },
    );
    let total = 0;
    for (const { tabella } of PULL_TABLES) {
      const rows = data[tabella] ?? [];
      if (rows.length === 0) continue;
      total += await dal.applyRemoteRows(tabella, rows);
      const max = maxUpdatedAt(rows);
      if (max) await dal.setPullWatermark(tabella, max);
    }
    return total;
  }
}

/**
 * Data plane assente (edizione standalone/OSS): le mutazioni restano nel PGlite
 * locale. La `push` è un no-op che dichiara l'intero batch "applicato", così il
 * router marca le rows come sincronizzate e l'outbox non cresce all'infinito;
 * nessuna `pull` è esposta, quindi il drain non tocca mai la rete. Garantisce
 * che il salvataggio di un soilSample soil o di un treatment scriva
 * direttamente sul locale senza alcuna dipendenza remota.
 */
export class LocalOnlySyncTarget implements SyncTarget {
  readonly kind = "local" as const;

  async push(batch: OutboxMutation[]): Promise<SyncPushResult> {
    return { applied: batch.length, skipped_lww: 0, duplicates: 0 };
  }
}

export function createSyncTarget(
  config: StorageConfig,
  tenantId: string,
): SyncTarget {
  switch (config.kind) {
    case "on_premise":
      return new OnPremiseSyncTarget(config.connection_profile, tenantId);
    case "local":
      return new LocalOnlySyncTarget();
    default:
      // Data plane gestito: lo fornisce l'adapter dell'edizione, se presente.
      // Senza adapter (standalone) si degrada al target locale.
      return (
        controlPlane().createSyncTarget?.(tenantId) ?? new LocalOnlySyncTarget()
      );
  }
}
