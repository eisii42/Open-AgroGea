import { v4 as uuidv4 } from "uuid";
import { areaHectares, normalizeGeometry } from "../geo/area";
import type {
  Plot,
  Company,
  PlotCampaign,
  Crop,
  TenantMembership,
} from "../types";
import { AgroDalBase } from "./dal-base";
import { nowIso, type Row } from "./write";

/**
 * Strato anagrafico del DAL: companies, posti collaboratore, crops,
 * plots e stato di Campagna Agraria.
 */
export class AgroDalRegistry extends AgroDalBase {
  // -- companies -------------------------------------------------------------

  async upsertCompany(
    input: Omit<Company, "tenant_id" | "created_at" | "updated_at" | "deleted_at"> &
      Partial<Pick<Company, "created_at">>,
  ): Promise<Company> {
    const ts = nowIso();
    const row: Company = {
      created_at: ts,
      ...input,
      tenant_id: this.tenantId,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox("companies", "update", row as unknown as Row & { id: string });
    return row;
  }

  async listAziende(): Promise<Company[]> {
    const result = await this.db.query<Company>(
      `select * from companies where deleted_at is null order by business_name`,
    );
    return result.rows;
  }

  // -- tenant_memberships (multiutente) --------------------------------------

  /**
   * Crea o update un posto collaboratore (`tenant_memberships`). Percorso
   * transazionale dato+outbox come ogni mutazione di dominio. La quota per
   * ruolo/piano è verificata a monte (client-side); qui si persiste soltanto.
   */
  async upsertMembership(
    input: Omit<
      TenantMembership,
      "id" | "tenant_id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string; created_at?: string },
  ): Promise<TenantMembership> {
    const ts = nowIso();
    const row: TenantMembership = {
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      company_id: input.company_id,
      email: input.email,
      role: input.role,
      status: input.status,
      invited_at: input.invited_at ?? null,
      joined_at: input.joined_at ?? null,
      created_at: input.created_at ?? ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox(
      "tenant_memberships",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  /** Posti dell'intero tenant (tutte le companies), non eliminati. */
  async listMemberships(): Promise<TenantMembership[]> {
    const result = await this.db.query<TenantMembership>(
      `select * from tenant_memberships
       where tenant_id = $1 and deleted_at is null
       order by company_id, role, email`,
      [this.tenantId],
    );
    return result.rows;
  }

  /** Soft-delete (tombstone sincronizzato) di un posto collaboratore. */
  async deleteMembership(id: string): Promise<void> {
    await this.softDelete("tenant_memberships", id);
  }

  // -- crops -----------------------------------------------------------------

  /**
   * Crea o update una specie/varietà coltivata (`crops`). Percorso
   * transazionale dato+outbox come ogni mutazione di dominio.
   */
  async upsertCrop(
    input: Omit<
      Crop,
      "tenant_id" | "id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string; created_at?: string },
  ): Promise<Crop> {
    const ts = nowIso();
    const row: Crop = {
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      common_name: input.common_name,
      scientific_name: input.scientific_name ?? null,
      variety_name: input.variety_name ?? null,
      crop_metadata: input.crop_metadata ?? {},
      created_at: input.created_at ?? ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox("crops", "update", row as unknown as Row & { id: string });
    return row;
  }

  async listCrops(): Promise<Crop[]> {
    const result = await this.db.query<Crop>(
      `select * from crops
       where tenant_id = $1 and deleted_at is null
       order by common_name, variety_name`,
      [this.tenantId],
    );
    return result.rows;
  }

  async getCrop(id: string): Promise<Crop | null> {
    const result = await this.db.query<Crop>(
      `select * from crops where id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  // -- plots_registry --------------------------------------------------------

  async upsertPlot(
    input: Omit<
      Plot,
      "tenant_id" | "created_at" | "updated_at" | "deleted_at" | "area_ha"
    > &
      Partial<Pick<Plot, "created_at" | "area_ha">>,
  ): Promise<Plot> {
    const ts = nowIso();
    // Geometria normalizzata PRIMA di persistere: il GeoEditor può emettere un
    // poligono con coordinate mal-annidate. Si riavvolge l'annidamento e si
    // chiudono gli anelli; se irrecuperabile, lancia (salvataggio fallisce in
    // modo visibile invece di corrompere DB locale e outbox).
    const geometry = normalizeGeometry(input.geometry);
    // Area geodetica ricalcolata dalla geometria a ogni upsert: UNICO punto di
    // verità per la area (NUMERIC 10,4), indipendente dal client.
    const area_ha = areaHectares(geometry);
    const row: Plot = {
      created_at: ts,
      ...input,
      geometry,
      area_ha,
      tenant_id: this.tenantId,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox(
      "plots_registry",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  /**
   * Aggiorna solo la cache NDVI dell'appezzamento (pipeline STAC). Percorso
   * transazionale dato+outbox come ogni scrittura, ma non ricalcola l'area né
   * tocca la geometria. La row deve esistere.
   */
  async updateMeanNdvi(id: string, meanNdvi: number): Promise<void> {
    const ts = nowIso();
    const result = await this.db.query<Plot>(
      `select * from plots_registry where id = $1 and deleted_at is null`,
      [id],
    );
    const current = result.rows[0];
    if (!current) {
      throw new Error(`Plot ${id} inesistente: NDVI non salvato.`);
    }
    const row: Plot = {
      ...current,
      last_ndvi_mean: meanNdvi,
      updated_at: ts,
    };
    await this.writeWithOutbox(
      "plots_registry",
      "update",
      row as unknown as Row & { id: string },
    );
  }

  async deletePlot(id: string): Promise<void> {
    await this.softDelete("plots_registry", id);
  }

  async listPlots(companyId: string): Promise<Plot[]> {
    const result = await this.db.query<Plot>(
      `select * from plots_registry
       where company_id = $1 and deleted_at is null
       order by user_plot_name`,
      [companyId],
    );
    return result.rows;
  }

  // -- campi campagna (stato burocratico annuale, SIAN/AGEA) -----------------

  /**
   * Crea o update lo stato di Campagna Agraria di un plot per un'annata
   * (upsert sul vincolo univoco plot_id+campaign_year). Percorso transazionale
   * dato+outbox come ogni mutazione di dominio.
   */
  async upsertCampoCampagna(
    input: Omit<
      PlotCampaign,
      "id" | "tenant_id" | "closed_at" | "created_at" | "updated_at" | "deleted_at"
    > &
      Partial<Pick<PlotCampaign, "closed_at">> & {
        id?: string;
        created_at?: string;
      },
  ): Promise<PlotCampaign> {
    const ts = nowIso();
    // Riusa la row esistente APERTA (stesso plot+anno) per restare
    // idempotente su re-import del Fascicolo, preservandone id e created_at.
    // Le campagne CHIUSE (closed_at) non si riaprono mai: una nuova semina dopo
    // il raccolto crea una nuova row (secondo raccolto nello stesso anno).
    const esistente = await this.db.query<PlotCampaign>(
      `select * from plots_campaign
       where plot_id = $1 and campaign_year = $2
         and deleted_at is null and closed_at is null
       limit 1`,
      [input.plot_id, input.campaign_year],
    );
    const current = esistente.rows[0];
    const row: PlotCampaign = {
      id: input.id ?? current?.id ?? uuidv4(),
      tenant_id: this.tenantId,
      plot_id: input.plot_id,
      crop_id: input.crop_id,
      campaign_year: input.campaign_year,
      reference_parcel_external_id: input.reference_parcel_external_id ?? null,
      agricultural_parcel_external_id: input.agricultural_parcel_external_id ?? null,
      crop_external_code: input.crop_external_code ?? null,
      variety_external_code: input.variety_external_code ?? null,
      declared_area_ha: input.declared_area_ha,
      closed_at: input.closed_at ?? current?.closed_at ?? null,
      created_at: input.created_at ?? current?.created_at ?? ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox(
      "plots_campaign",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  /**
   * Chiude il ciclo colturale di una campagna (v17): imposta `closed_at` e
   * il field torna libero (mappa neutra, DSS spento, nuova semina possibile).
   * Percorso transazionale dato+outbox; no-op se la row non esiste o è già
   * chiusa. Ritorna la row aggiornata o null.
   */
  async closeCampaign(
    id: string,
    closedAt?: string,
  ): Promise<PlotCampaign | null> {
    const result = await this.db.query<PlotCampaign>(
      `select * from plots_campaign
       where id = $1 and deleted_at is null and closed_at is null`,
      [id],
    );
    const current = result.rows[0];
    if (!current) return null;
    const ts = nowIso();
    const row: PlotCampaign = {
      ...current,
      closed_at: closedAt ?? ts,
      updated_at: ts,
    };
    await this.writeWithOutbox(
      "plots_campaign",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  async listCampiCampagna(
    options: { anno?: number; plotId?: string } = {},
  ): Promise<PlotCampaign[]> {
    const conditions = ["tenant_id = $1", "deleted_at is null"];
    const params: unknown[] = [this.tenantId];
    if (options.anno != null) {
      params.push(options.anno);
      conditions.push(`campaign_year = $${params.length}`);
    }
    if (options.plotId) {
      params.push(options.plotId);
      conditions.push(`plot_id = $${params.length}`);
    }
    const result = await this.db.query<PlotCampaign>(
      `select * from plots_campaign
       where ${conditions.join(" and ")}
       order by campaign_year desc`,
      params,
    );
    return result.rows;
  }

  async deleteCampoCampagna(id: string): Promise<void> {
    await this.softDelete("plots_campaign", id);
  }

  /** Anni di campagna distinti presenti nel database locale, dal più recente. */
  async listAnniCampagna(): Promise<number[]> {
    const result = await this.db.query<{ anno: number }>(
      `select distinct campaign_year as anno from plots_campaign
       where tenant_id = $1 and deleted_at is null
       order by anno desc`,
      [this.tenantId],
    );
    return result.rows.map((r) => r.anno);
  }
}
