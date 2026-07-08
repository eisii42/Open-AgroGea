/**
 * Modulo 3 — Seat Enforcement Engine (MembershipGuard).
 *
 * Servizio PURO di gestione dei posti (seat) del team per singola company.
 * Valida gli inviti in `tenant_memberships` contro i limiti del piano
 * ({@link ../auth/subscription-limits}) e produce i contatori per i badge UE.
 * Nessuna dipendenza da React/DB: opera su array di membership già caricati,
 * così è interamente unit-testabile.
 *
 * Mappa terminologica con la specifica: ciò che la specifica chiama "tenant_id
 * della singola azienda" qui è `company_id` (riga di `companies`). Il
 * `tenant_id` resta il workspace dell'abbonato master.
 */

import type {
  MembershipStatus,
  TenantMembership,
} from "../types";
import {
  QuotaExceededError,
  type TeamRole,
  TEAM_ROLES,
  isUnlimited,
  planLabel,
  seatLimitForRole,
} from "./subscription-limits";

// Il tipo canonico del posto collaboratore vive in `@agrogea/core`
// (`tenant_memberships`, sincronizzato): qui è importato per l'engine e i suoi
// test. `import type` ⇒ zero costo a runtime (i moduli puri non caricano il
// barrel del core).

/** Stati che OCCUPANO un posto (un invito pendente conta come occupato). */
const OCCUPIES_SEAT: ReadonlySet<MembershipStatus> = new Set<MembershipStatus>([
  "active",
  "invited",
]);

/** Normalizza un'email per i confronti (case/whitespace-insensitive). */
function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Conta i posti OCCUPATI per un ruolo in una specifica company. */
export function countSeats(
  memberships: TenantMembership[],
  companyId: string,
  role: TeamRole,
): number {
  return memberships.filter(
    (m) =>
      m.company_id === companyId &&
      m.role === role &&
      OCCUPIES_SEAT.has(m.status),
  ).length;
}

/** Esito di una valutazione d'invito (per banner e abilitazione UI). */
export interface InviteDecision {
  allowed: boolean;
  /** Messaggio leggibile quando `allowed === false`. */
  reason?: string;
  /** Posti già occupati per quel ruolo nell'azienda. */
  used: number;
  /** Posti massimi del ruolo nel piano. */
  max: number;
}

/** Richiesta d'invito da valutare. */
export interface InviteRequest {
  plan: string | null | undefined;
  companyId: string;
  role: TeamRole;
  /** Stato corrente dei membri (di tutte le companies: viene filtrato per company). */
  memberships: TenantMembership[];
}

/**
 * Messaggio di quota esaurita allineato alla specifica per ruolo. I testi di
 * MANAGER (Professional) e VIEWER (Enterprise) corrispondono letteralmente alla
 * specifica; OWNER usa la stessa forma per coerenza.
 */
export function seatExhaustedMessage(
  plan: string | null | undefined,
  role: TeamRole,
  max: number,
): string {
  const label = planLabel(plan);
  switch (role) {
    case "MANAGER":
      return `Quota Manager raggiunta per questa company (Massimo ${max} per company nel piano ${label})`;
    case "VIEWER":
      return `Quota Viewer esaurita per questa company (Massimo ${max} per company nel piano ${label})`;
    case "OWNER":
      return `Quota Owner raggiunta per questa company (Massimo ${max} per company nel piano ${label})`;
  }
}

/**
 * Valuta se un invito è ammesso, SENZA sollevare eccezioni (per pilotare la UI:
 * disabilitare il pulsante, mostrare il messaggio). Un posto "illimitato" è
 * sempre concesso.
 */
export function evaluateInvite(req: InviteRequest): InviteDecision {
  const max = seatLimitForRole(req.plan, req.role);
  const used = countSeats(req.memberships, req.companyId, req.role);
  if (isUnlimited(max)) return { allowed: true, used, max };
  if (max <= 0) {
    return {
      allowed: false,
      reason: seatExhaustedMessage(req.plan, req.role, max),
      used,
      max,
    };
  }
  if (used >= max) {
    return {
      allowed: false,
      reason: seatExhaustedMessage(req.plan, req.role, max),
      used,
      max,
    };
  }
  return { allowed: true, used, max };
}

/**
 * Variante imperativa: valida l'invito e SOLLEVA {@link QuotaExceededError} se la
 * quota del ruolo per quell'azienda è saturata. È il punto d'ingresso del
 * servizio invocato dal form del team prima di scrivere in `tenant_memberships`.
 */
export function assertCanInvite(req: InviteRequest): InviteDecision {
  const decision = evaluateInvite(req);
  if (!decision.allowed) {
    throw new QuotaExceededError(
      decision.reason ?? "Quota posti esaurita per questa company.",
      { kind: "seat", plan: req.plan, role: req.role },
    );
  }
  return decision;
}

/** Riepilogo dei posti di un ruolo per i badge contatori della UI. */
export interface SeatUsage {
  role: TeamRole;
  used: number;
  max: number;
  /** true se il posto è saturo (`used >= max`) e NON illimitato. */
  saturated: boolean;
  /** true se il ruolo è illimitato nel piano. */
  unlimited: boolean;
}

/** Calcola l'uso dei posti per OGNI ruolo in una specifica company. */
export function seatUsageForCompany(
  plan: string | null | undefined,
  companyId: string,
  memberships: TenantMembership[],
): SeatUsage[] {
  return TEAM_ROLES.map((role) => {
    const max = seatLimitForRole(plan, role);
    const used = countSeats(memberships, companyId, role);
    const unlimited = isUnlimited(max);
    return {
      role,
      used,
      max,
      unlimited,
      saturated: !unlimited && used >= max,
    };
  });
}

// ---------------------------------------------------------------------------
// Read-only / ruolo dell'utente corrente
// ---------------------------------------------------------------------------

/** Ruolo dell'utente (per email) in una specifica company, o null se esterno. */
export function roleInCompany(
  memberships: TenantMembership[],
  companyId: string,
  email: string | null | undefined,
): TeamRole | null {
  if (!email) return null;
  const target = normEmail(email);
  const m = memberships.find(
    (x) =>
      x.company_id === companyId &&
      OCCUPIES_SEAT.has(x.status) &&
      normEmail(x.email) === target,
  );
  return m?.role ?? null;
}

/**
 * true se il ruolo è di sola lettura. I VIEWER non possono mutare nulla: l'UI
 * (Command Center, mappa, Field Attributes di GeoLibre) va configurata
 * read-only. Un ruolo `null` (abbonato master / self-service senza membership)
 * NON è read-only: l'owner mantiene pieni poteri.
 */
export function isReadOnlyRole(role: TeamRole | null | undefined): boolean {
  return role === "VIEWER";
}
