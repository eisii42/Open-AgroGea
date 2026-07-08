import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCanCreateCompany,
  canCreateCompany,
  companyLimit,
  getPlanLimits,
  isQuotaError,
  normalizePlan,
  PLAN_LIMITS,
  QuotaExceededError,
  seatLimitForRole,
  UNLIMITED,
} from "../packages/agro-core/src/team/subscription-limits";
import {
  assertCanInvite,
  countSeats,
  evaluateInvite,
  isReadOnlyRole,
  roleInCompany,
  seatUsageForCompany,
  type TenantMembership,
} from "../packages/agro-core/src/team/membership-guard";

const COMPANY = "company-1";
const OTHER_COMPANY = "company-2";
const TENANT = "tenant-master";

/** Costruttore di membership di test (tipo canonico `tenant_memberships`). */
function member(
  partial: Partial<TenantMembership> & Pick<TenantMembership, "role">,
): TenantMembership {
  const ts = "2026-06-28T00:00:00.000Z";
  return {
    id: partial.id ?? `m-${Math.random().toString(36).slice(2)}`,
    tenant_id: partial.tenant_id ?? TENANT,
    company_id: partial.company_id ?? COMPANY,
    email: partial.email ?? "user@example.com",
    role: partial.role,
    status: partial.status ?? "active",
    invited_at: partial.invited_at ?? null,
    joined_at: partial.joined_at ?? null,
    created_at: partial.created_at ?? ts,
    updated_at: partial.updated_at ?? ts,
    deleted_at: partial.deleted_at ?? null,
  };
}

/** Genera N viewer attivi con email distinte. */
function viewers(n: number): TenantMembership[] {
  return Array.from({ length: n }, (_, i) =>
    member({ role: "VIEWER", email: `v${i}@x.it` }),
  );
}

// ---------------------------------------------------------------------------
// Modulo 1 — Subscription Tier Schema (lineup unico base/standard/plus)
// ---------------------------------------------------------------------------

describe("subscription-limits / schema dei piani", () => {
  it("base: 1 company, single user", () => {
    assert.deepEqual(PLAN_LIMITS.base, {
      max_companies: 1,
      max_owners_per_company: 1,
      max_managers_per_company: 0,
      max_viewers_per_company: 0,
    });
  });

  it("standard: 5 companies, owner 1, manager 1, viewer 2", () => {
    assert.deepEqual(PLAN_LIMITS.standard, {
      max_companies: 5,
      max_owners_per_company: 1,
      max_managers_per_company: 1,
      max_viewers_per_company: 2,
    });
  });

  it("plus: companies illimitate, owner 10, manager 2, viewer 3", () => {
    assert.deepEqual(PLAN_LIMITS.plus, {
      max_companies: UNLIMITED,
      max_owners_per_company: 10,
      max_managers_per_company: 2,
      max_viewers_per_company: 3,
    });
  });

  it("normalizePlan riconduce i codici legacy al nuovo lineup", () => {
    assert.equal(normalizePlan("free"), "base");
    assert.equal(normalizePlan("flat_3"), "standard");
    assert.equal(normalizePlan("professional"), "standard");
    assert.equal(normalizePlan("enterprise"), "plus");
    assert.equal(normalizePlan("base"), "base");
    assert.equal(normalizePlan("xyz"), "base");
    assert.equal(normalizePlan(null), "base");
  });

  it("getPlanLimits normalizza i codici legacy (enterprise → plus)", () => {
    assert.deepEqual(getPlanLimits("enterprise"), PLAN_LIMITS.plus);
    assert.deepEqual(getPlanLimits("flat_3"), PLAN_LIMITS.standard);
    assert.deepEqual(getPlanLimits("ignoto"), PLAN_LIMITS.base);
  });

  it("seatLimitForRole mappa i posti per ruolo del piano", () => {
    assert.equal(seatLimitForRole("standard", "MANAGER"), 1);
    assert.equal(seatLimitForRole("standard", "VIEWER"), 2);
    assert.equal(seatLimitForRole("plus", "OWNER"), 10);
    assert.equal(seatLimitForRole("plus", "VIEWER"), 3);
    assert.equal(seatLimitForRole("plus", "MANAGER"), 2);
    assert.equal(seatLimitForRole("base", "MANAGER"), 0);
  });

  it("companyLimit espone il massimo companies del piano", () => {
    assert.equal(companyLimit("base"), 1);
    assert.equal(companyLimit("standard"), 5);
    assert.equal(companyLimit("plus"), UNLIMITED);
  });
});

// ---------------------------------------------------------------------------
// Modulo 2 — Company Creation Guard
// ---------------------------------------------------------------------------

describe("Company Creation Guard / quota companies", () => {
  it("standard consente fino a 5 companies", () => {
    assert.equal(canCreateCompany("standard", 4), true);
    assert.equal(canCreateCompany("standard", 5), false);
  });

  it("base consente una sola azienda", () => {
    assert.equal(canCreateCompany("base", 0), true);
    assert.equal(canCreateCompany("base", 1), false);
  });

  it("assertCanCreateCompany respinge la sesta company nel piano standard", () => {
    assert.doesNotThrow(() => assertCanCreateCompany("standard", 4));
    assert.throws(
      () => assertCanCreateCompany("standard", 5),
      (e: unknown) =>
        e instanceof QuotaExceededError &&
        e.kind === "company" &&
        isQuotaError(e) &&
        /Massimo 5/.test(e.message),
    );
  });

  it("plus non blocca mai la creazione (illimitato)", () => {
    assert.equal(canCreateCompany("plus", 100), true);
    assert.doesNotThrow(() => assertCanCreateCompany("plus", 9998));
  });
});

// ---------------------------------------------------------------------------
// Modulo 3 — Seat Enforcement Engine (MembershipGuard)
// ---------------------------------------------------------------------------

describe("MembershipGuard / conteggio posti", () => {
  it("conta solo i posti occupati (active|invited) della stessa company e ruolo", () => {
    const memberships = [
      member({ role: "MANAGER", status: "active" }),
      member({ role: "MANAGER", status: "invited" }),
      member({ role: "MANAGER", status: "revoked" }), // non conta
      member({ role: "VIEWER", status: "active" }), // ruolo diverso
      member({ role: "MANAGER", company_id: OTHER_COMPANY }), // altra company
    ];
    assert.equal(countSeats(memberships, COMPANY, "MANAGER"), 2);
    assert.equal(countSeats(memberships, COMPANY, "VIEWER"), 1);
  });
});

describe("MembershipGuard / inviti respinti oltre la quota per azienda", () => {
  it("MANAGER nel piano standard: il secondo invito è respinto", () => {
    const memberships = [member({ role: "MANAGER", status: "active" })];
    const decision = evaluateInvite({
      plan: "standard",
      companyId: COMPANY,
      role: "MANAGER",
      memberships,
    });
    assert.equal(decision.allowed, false);
    assert.equal(
      decision.reason,
      "Quota Manager raggiunta per questa company (Massimo 1 per company nel piano Standard)",
    );
    assert.throws(
      () =>
        assertCanInvite({
          plan: "standard",
          companyId: COMPANY,
          role: "MANAGER",
          memberships,
        }),
      (e: unknown) =>
        e instanceof QuotaExceededError &&
        e.kind === "seat" &&
        e.role === "MANAGER",
    );
  });

  it("VIEWER nel piano standard: ammessi 2, respinto il 3°", () => {
    assert.equal(
      evaluateInvite({
        plan: "standard",
        companyId: COMPANY,
        role: "VIEWER",
        memberships: viewers(1),
      }).allowed,
      true,
    );
    assert.equal(
      evaluateInvite({
        plan: "standard",
        companyId: COMPANY,
        role: "VIEWER",
        memberships: viewers(2),
      }).allowed,
      false,
    );
  });

  it("VIEWER nel piano plus: il quarto invito è respinto", () => {
    const decision = evaluateInvite({
      plan: "plus",
      companyId: COMPANY,
      role: "VIEWER",
      memberships: viewers(3),
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.used, 3);
    assert.equal(decision.max, 3);
    assert.equal(
      decision.reason,
      "Quota Viewer esaurita per questa company (Massimo 3 per company nel piano Plus)",
    );
  });

  it("OWNER nel piano plus: ammessi fino a 10, respinto l'11°", () => {
    const tenOwners = Array.from({ length: 10 }, (_, i) =>
      member({ role: "OWNER", email: `o${i}@x.it` }),
    );
    assert.equal(
      evaluateInvite({
        plan: "plus",
        companyId: COMPANY,
        role: "OWNER",
        memberships: tenOwners.slice(0, 9),
      }).allowed,
      true,
    );
    assert.equal(
      evaluateInvite({
        plan: "plus",
        companyId: COMPANY,
        role: "OWNER",
        memberships: tenOwners,
      }).allowed,
      false,
    );
  });

  it("MANAGER nel piano base: nessun posto (max 0) → sempre respinto", () => {
    const decision = evaluateInvite({
      plan: "base",
      companyId: COMPANY,
      role: "MANAGER",
      memberships: [],
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.max, 0);
  });

  it("il limite è PER AZIENDA: i posti di un'altra company non contano", () => {
    const memberships = [
      member({ role: "MANAGER", company_id: OTHER_COMPANY }),
    ];
    assert.equal(
      evaluateInvite({
        plan: "standard",
        companyId: COMPANY,
        role: "MANAGER",
        memberships,
      }).allowed,
      true,
    );
  });
});

describe("MembershipGuard / badge contatori e read-only", () => {
  it("seatUsageForCompany produce used/max per ruolo (plus)", () => {
    const memberships = [
      member({ role: "OWNER", email: "master@x.it" }),
      member({ role: "VIEWER", email: "v1@x.it" }),
    ];
    const usage = seatUsageForCompany("plus", COMPANY, memberships);
    const owner = usage.find((u) => u.role === "OWNER");
    const viewer = usage.find((u) => u.role === "VIEWER");
    assert.deepEqual(
      { used: owner?.used, max: owner?.max, saturated: owner?.saturated },
      { used: 1, max: 10, saturated: false },
    );
    assert.deepEqual(
      { used: viewer?.used, max: viewer?.max, saturated: viewer?.saturated },
      { used: 1, max: 3, saturated: false },
    );
  });

  it("roleInCompany risolve il ruolo per email (case-insensitive) e isReadOnlyRole marca i VIEWER", () => {
    const memberships = [
      member({ role: "VIEWER", email: "Mario.Rossi@Example.IT" }),
    ];
    assert.equal(
      roleInCompany(memberships, COMPANY, "mario.rossi@example.it"),
      "VIEWER",
    );
    assert.equal(roleInCompany(memberships, COMPANY, "altro@x.it"), null);
    assert.equal(isReadOnlyRole("VIEWER"), true);
    assert.equal(isReadOnlyRole("OWNER"), false);
    assert.equal(isReadOnlyRole(null), false);
  });
});
