/**
 * Hook del team (Modulo 3/4) sopra il core store. I posti collaboratore vivono
 * ora in `tenant_memberships` (persistiti su PGlite e sincronizzati via outbox):
 * il core `useAgroStore` è la fonte di verità, questi hook compongono l'engine
 * PURO ({@link MembershipGuard}) sui dati idratati. L'identità dell'utente
 * corrente è la sessione del control plane.
 */

import { useAgroStore } from "../store";
import type { TenantMembership } from "../types";
import { useMemo } from "react";
import {
  assertCanInvite,
  evaluateInvite,
  type InviteDecision,
  isReadOnlyRole,
  roleInCompany,
  type SeatUsage,
  seatUsageForCompany,
} from "./membership-guard";
import type { TeamRole } from "./subscription-limits";

/** Email dell'utente autenticato (sessione cloud, con ripiego sul profile). */
function getCurrentEmail(): string | null {
  const s = useAgroStore.getState();
  return s.session?.user?.email ?? s.profile?.email ?? null;
}

/** Membership (non eliminate) di una specifica company. */
export function useCompanyMemberships(
  companyId: string | null,
): TenantMembership[] {
  const memberships = useAgroStore((s) => s.memberships);
  return useMemo(
    () =>
      companyId
        ? memberships.filter(
            (m) => m.company_id === companyId && m.deleted_at == null,
          )
        : [],
    [memberships, companyId],
  );
}

/** Contatori posti per ruolo dell'azienda (per i badge della UI). */
export function useSeatUsage(
  plan: string | null | undefined,
  companyId: string | null,
): SeatUsage[] {
  const memberships = useAgroStore((s) => s.memberships);
  return useMemo(
    () => (companyId ? seatUsageForCompany(plan, companyId, memberships) : []),
    [plan, companyId, memberships],
  );
}

/** Valutazione (non bloccante) di un invito per pilotare l'abilitazione UI. */
export function useInviteDecision(
  plan: string | null | undefined,
  companyId: string | null,
  role: TeamRole,
): InviteDecision {
  const memberships = useAgroStore((s) => s.memberships);
  return useMemo(
    () =>
      companyId
        ? evaluateInvite({ plan, companyId, role, memberships })
        : { allowed: false, used: 0, max: 0 },
    [plan, companyId, role, memberships],
  );
}

/** Ruolo dell'utente corrente in una specifica company (o null se esterno/owner). */
export function useCurrentRole(companyId: string | null): TeamRole | null {
  const memberships = useAgroStore((s) => s.memberships);
  const email = useAgroStore(
    (s) => s.session?.user?.email ?? s.profile?.email ?? null,
  );
  return useMemo(
    () => (companyId ? roleInCompany(memberships, companyId, email) : null),
    [memberships, companyId, email],
  );
}

/**
 * true se l'utente corrente è in SOLA LETTURA nell'azienda data (ruolo VIEWER):
 * l'intera interfaccia (Command Center, mappa, Field Attributes) va configurata
 * read-only e le mutazioni disattivate.
 */
export function useReadOnly(companyId: string | null): boolean {
  const role = useCurrentRole(companyId);
  return isReadOnlyRole(role);
}

// ---------------------------------------------------------------------------
// Azioni (persistono via core store → DAL → outbox)
// ---------------------------------------------------------------------------

/**
 * Invita un collaboratore: valida la quota del ruolo per l'azienda (solleva
 * {@link QuotaExceededError} se saturata) e, se ammesso, persiste la membership
 * con stato `invited`. La verifica usa lo stato corrente del core store.
 */
export async function inviteMember(input: {
  plan: string | null | undefined;
  companyId: string;
  email: string;
  role: TeamRole;
}): Promise<void> {
  const memberships = useAgroStore.getState().memberships;
  assertCanInvite({
    plan: input.plan,
    companyId: input.companyId,
    role: input.role,
    memberships,
  });
  await useAgroStore.getState().saveMembership({
    company_id: input.companyId,
    email: input.email.trim(),
    role: input.role,
    status: "invited",
    invited_at: new Date().toISOString(),
    joined_at: null,
  });
}

/** Revoca (libera il posto) una membership: soft-delete sincronizzato. */
export async function revokeMembership(id: string): Promise<void> {
  await useAgroStore.getState().deleteMembership(id);
}

/**
 * Garantisce il posto OWNER dell'abbonato principale per un'azienda (legacy
 * senza riga owner). Idempotente lato store.
 */
export async function ensurePrincipalOwner(companyId: string): Promise<void> {
  const email = getCurrentEmail();
  if (!email) return;
  await useAgroStore.getState().ensureOwnerMembership(companyId, email);
}
