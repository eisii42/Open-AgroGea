import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isViewerReadOnly,
  type TenantMembership,
  useAgroStore,
} from "../packages/agro-core/src/index";

/**
 * Guard centralizzato RBAC: un utente con ruolo VIEWER per l'azienda attiva è in
 * sola reading e NON deve poter mutare il dominio dallo store (specchio client
 * del layer RLS). Si testa sia la funzione pura `isViewerReadOnly` sia il blocco
 * effettivo di una mutazione dello store.
 */

const COMPANY = "company-1";

function membership(
  partial: Partial<TenantMembership> & Pick<TenantMembership, "role" | "email">,
): TenantMembership {
  const ts = "2026-06-28T00:00:00.000Z";
  return {
    id: partial.id ?? `m-${Math.random().toString(36).slice(2)}`,
    tenant_id: partial.tenant_id ?? "tenant-1",
    company_id: partial.company_id ?? COMPANY,
    email: partial.email,
    role: partial.role,
    status: partial.status ?? "active",
    invited_at: partial.invited_at ?? null,
    joined_at: partial.joined_at ?? null,
    created_at: partial.created_at ?? ts,
    updated_at: partial.updated_at ?? ts,
    deleted_at: partial.deleted_at ?? null,
  };
}

describe("isViewerReadOnly — decisione pura", () => {
  it("VIEWER dell'azienda attiva ⇒ read-only", () => {
    assert.equal(
      isViewerReadOnly({
        memberships: [membership({ role: "VIEWER", email: "v@x.it" })],
        activeCompanyId: COMPANY,
        email: "v@x.it",
      }),
      true,
    );
  });

  it("OWNER/MANAGER ⇒ NON read-only", () => {
    for (const role of ["OWNER", "MANAGER"] as const) {
      assert.equal(
        isViewerReadOnly({
          memberships: [membership({ role, email: "u@x.it" })],
          activeCompanyId: COMPANY,
          email: "u@x.it",
        }),
        false,
      );
    }
  });

  it("match email case-insensitive", () => {
    assert.equal(
      isViewerReadOnly({
        memberships: [membership({ role: "VIEWER", email: "Mario@X.IT" })],
        activeCompanyId: COMPANY,
        email: "mario@x.it",
      }),
      true,
    );
  });

  it("VIEWER ma di un'altra company ⇒ NON read-only", () => {
    assert.equal(
      isViewerReadOnly({
        memberships: [
          membership({ role: "VIEWER", email: "v@x.it", company_id: "altra" }),
        ],
        activeCompanyId: COMPANY,
        email: "v@x.it",
      }),
      false,
    );
  });

  it("posto VIEWER revocato/eliminato non conta", () => {
    assert.equal(
      isViewerReadOnly({
        memberships: [
          membership({ role: "VIEWER", email: "v@x.it", deleted_at: "2026-06-28T01:00:00Z" }),
        ],
        activeCompanyId: COMPANY,
        email: "v@x.it",
      }),
      false,
    );
  });

  it("senza company attiva o senza email ⇒ NON read-only (Master/self-service)", () => {
    const m = [membership({ role: "VIEWER", email: "v@x.it" })];
    assert.equal(isViewerReadOnly({ memberships: m, activeCompanyId: null, email: "v@x.it" }), false);
    assert.equal(isViewerReadOnly({ memberships: m, activeCompanyId: COMPANY, email: null }), false);
  });
});

describe("store — guard centralizzato sulle mutazioni", () => {
  it("un VIEWER viene RESPINTO da una mutazione di dominio", async () => {
    useAgroStore.setState({
      activeCompanyId: COMPANY,
      memberships: [membership({ role: "VIEWER", email: "viewer@x.it" })],
      session: { user: { email: "viewer@x.it" } } as never,
      profile: null,
    });
    await assert.rejects(
      () => useAgroStore.getState().updateCompany({ business_name: "Hack" }),
      /sola reading/i,
    );
  });

  it("un OWNER NON viene bloccato dal guard read-only", async () => {
    useAgroStore.setState({
      activeCompanyId: COMPANY,
      memberships: [membership({ role: "OWNER", email: "owner@x.it" })],
      session: { user: { email: "owner@x.it" } } as never,
      profile: null,
    });
    // Senza DAL la mutazione fallisce con un ALTRO errore (company non attiva):
    // l'importante è che NON sia il blocco read-only.
    await assert.rejects(
      () => useAgroStore.getState().updateCompany({ business_name: "Ok" }),
      (e: unknown) => e instanceof Error && !/sola reading/i.test(e.message),
    );
  });
});
