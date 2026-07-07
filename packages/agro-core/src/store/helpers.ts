import type {
  Geometry,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon,
} from "geojson";
import { lengthMeters } from "../geo/area";
import type {
  UserProfile,
  SyncSnapshot,
  TenantClaims,
  TenantMembership,
} from "../types";
import type { AgroState, SelectableKind, StoreGet, StoreSet } from "./state";

export const OFFLINE_SNAPSHOT: SyncSnapshot = {
  state: "offline",
  pendingCount: 0,
  lastSyncedAt: null,
  lastPulledAt: null,
  lastError: null,
  target: null,
};

/** Profondità massima della pila undo/redo geometrico (per non crescere senza limite). */
export const MAX_GEOMETRY_HISTORY = 50;

/**
 * Profilo sintetico dalle claims correnti, usato come ripiego quando il profile
 * non è leggibile online (sblocco offline, o control plane non raggiungibile):
 * lo stato di licenza ricade su `licenzaAttiva` delle claims.
 */
export function profiloDaClaims(claims: TenantClaims): UserProfile {
  return {
    id: claims.tenantId,
    email: "",
    license_plan: "standard",
    license_status: claims.licenzaAttiva ? "active" : "inactive",
    updated_at: new Date().toISOString(),
  };
}

/**
 * Sola lettura (RBAC): l'utente corrente è in modalità read-only quando, per
 * l'azienda attiva, la sua membership (per email) ha ruolo `VIEWER`. Fonte di
 * verità del guard centralizzato delle mutazioni e — riusabile dall'UI — di
 * qualunque affordance read-only. Un ruolo non-VIEWER o l'assenza di membership
 * (es. Master Owner self-service) NON è read-only.
 */
export function isViewerReadOnly(args: {
  memberships: TenantMembership[];
  activeCompanyId: string | null;
  email: string | null;
}): boolean {
  if (!args.activeCompanyId || !args.email) return false;
  const email = args.email.trim().toLowerCase();
  const membership = args.memberships.find(
    (m) =>
      m.company_id === args.activeCompanyId &&
      m.deleted_at == null &&
      (m.status === "active" || m.status === "invited") &&
      m.email.trim().toLowerCase() === email,
  );
  return membership?.role === "VIEWER";
}

/** Email dell'utente corrente (sessione remota, ripiego sul profile). */
export function currentEmail(s: AgroState): string | null {
  return s.session?.user?.email ?? s.profile?.email ?? null;
}

/**
 * Guard centralizzato: SOLLEVA se l'utente attivo è un VIEWER (sola lettura).
 * Chiamato in testa a ogni mutazione di dominio dello store, così la regola RBAC
 * vale per OGNI entry-point (Quaderno, Harvest, geometrie, anagrafica…) senza
 * doverla replicare nei singoli componenti. Specchio client delle regole
 * di accesso server-side.
 */
export function assertWritable(get: StoreGet): void {
  const s = get();
  if (
    isViewerReadOnly({
      memberships: s.memberships,
      activeCompanyId: s.activeCompanyId,
      email: currentEmail(s),
    })
  ) {
    throw new Error(
      "Sola lettura: il tuo ruolo (Viewer) non consente di modificare i dati.",
    );
  }
}

/**
 * Persiste sul DAL una geometria per un elemento (appezzamento/infrastruttura/
 * POI), aggiorna lo store e notifica il sync; ritorna la geometria PRECEDENTE
 * (per l'undo) o null se l'elemento non esiste. La geometria viene normalizzata
 * (strip Z, anelli) dentro i metodi `upsert*` del DAL.
 */
export async function persistiGeometriaSuDal(
  get: StoreGet,
  set: StoreSet,
  kind: SelectableKind,
  id: string,
  geometry: Geometry,
): Promise<{ before: Geometry } | null> {
  const { dal, syncRouter } = get();
  if (!dal) return null;

  if (kind === "appezzamento") {
    const existing = get().plots.find((a) => a.id === id);
    if (!existing) return null;
    const before = existing.geometry;
    const record = await dal.upsertAppezzamento({
      ...existing,
      geometry: geometry as Polygon | MultiPolygon,
    });
    set((s) => ({
      plots: [...s.plots.filter((a) => a.id !== record.id), record],
    }));
    syncRouter?.notifyLocalWrite();
    return { before };
  }

  if (kind === "infrastruttura") {
    const existing = get().assets.find((a) => a.id === id);
    if (!existing) return null;
    const before = existing.geometry;
    const length_m =
      geometry.type === "LineString" || geometry.type === "MultiLineString"
        ? lengthMeters(geometry as LineString | MultiLineString)
        : existing.length_m;
    const record = await dal.upsertAsset({ ...existing, geometry, length_m });
    set((s) => ({
      assets: [...s.assets.filter((a) => a.id !== record.id), record],
    }));
    syncRouter?.notifyLocalWrite();
    return { before };
  }

  // POI = campionamento georeferenziato (Point).
  const existing = get().soilSamples.find((c) => c.id === id);
  if (!existing || geometry.type !== "Point") return null;
  const before = existing.sampling_position;
  const record = await dal.upsertCampionamento({ ...existing, sampling_position: geometry });
  set((s) => ({
    soilSamples: [...s.soilSamples.filter((c) => c.id !== record.id), record],
  }));
  syncRouter?.notifyLocalWrite();
  return { before };
}
