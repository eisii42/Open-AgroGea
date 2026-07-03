/**
 * Modulo 1 — Subscription Tier Schema (Quota & Seat Enforcement).
 *
 * Mappa RIGIDA dei vincoli di abbonamento AgroGea. Modulo PURO: nessuna
 * dipendenza da React/DB/store. È la fonte di verità dei limiti per piano,
 * consumata sia dal Company Creation Guard (creazione aziende) sia dal Seat
 * Enforcement Engine ({@link ../team/MembershipGuard}).
 *
 * Nota di terminologia: nello schema AgroGea la "singola azienda" è una riga di
 * `companies` (`company_id`); il `tenant_id` è invece il workspace dell'abbonato
 * master (`auth.uid()`). I limiti per-azienda della specifica si applicano quindi
 * per `company_id`.
 */

/** Ruolo di un membro all'interno di una singola azienda. */
export type TeamRole = "OWNER" | "MANAGER" | "VIEWER";

/** Elenco canonico dei ruoli (ordine di presentazione UI). */
export const TEAM_ROLES: readonly TeamRole[] = ["OWNER", "MANAGER", "VIEWER"];

/**
 * Piano di abbonamento che governa quote di aziende e posti (seat). Lineup
 * unico a 3 livelli — il multiutente è integrato qui dentro:
 *
 *   - `base`     — single user, 1 azienda.
 *   - `standard` — 5 aziende, piccolo team.
 *   - `plus`     — aziende illimitate, team ampio.
 *
 * Il tipo accetta anche stringhe arbitrarie (i valori legacy `free`/`flat_3`/
 * `professional`/`enterprise` vengono ricondotti dai {@link normalizePlan});
 * i piani non riconosciuti ripiegano sul livello conservativo `base`.
 */
export type SubscriptionPlan =
  | "base"
  | "standard"
  | "plus"
  | (string & {});

/** Vincoli numerici di un piano (aziende + posti per ruolo, per singola azienda). */
export interface PlanLimits {
  /** Numero massimo di aziende (workspace) creabili dall'abbonato. */
  max_companies: number;
  /** Posti OWNER per singola azienda (incluso l'abbonato principale). */
  max_owners_per_company: number;
  /** Posti MANAGER per singola azienda. */
  max_managers_per_company: number;
  /** Posti VIEWER per singola azienda. */
  max_viewers_per_company: number;
}

/**
 * Sentinella di "illimitato": le aziende del piano enterprise sono di fatto
 * senza limite. Trattata come soglia ({@link isUnlimited}) per evitare badge
 * "x/9999" e per non bloccare mai la creazione.
 */
export const UNLIMITED = 9999;

/**
 * Tabella RIGIDA dei vincoli per piano (lineup unico a 3 livelli).
 *
 * - `base`:     1 azienda; single user (owner 1, manager 0, viewer 0).
 * - `standard`: 5 aziende; per azienda owner 1, manager 1, viewer 2.
 * - `plus`:     aziende illimitate; per azienda owner 10, manager 2, viewer 3.
 */
export const PLAN_LIMITS: Record<string, PlanLimits> = {
  base: {
    max_companies: 1,
    max_owners_per_company: 1,
    max_managers_per_company: 0,
    max_viewers_per_company: 0,
  },
  standard: {
    max_companies: 5,
    max_owners_per_company: 1,
    max_managers_per_company: 1,
    max_viewers_per_company: 2,
  },
  plus: {
    max_companies: UNLIMITED,
    max_owners_per_company: 10,
    max_managers_per_company: 2,
    max_viewers_per_company: 3,
  },
};

/**
 * Riconduce i codici di piano legacy al lineup attuale (free→base,
 * flat_3/flat/professional→standard, enterprise→plus). I valori già correnti
 * passano invariati; gli sconosciuti ripiegano su `base` (conservativo).
 * Rende il client resiliente prima/durante la migrazione del control plane.
 */
export function normalizePlan(plan: string | null | undefined): SubscriptionPlan {
  switch (plan) {
    case "base":
    case "standard":
    case "plus":
      return plan;
    case "free":
      return "base";
    case "flat_3":
    case "flat":
    case "professional":
      return "standard";
    case "enterprise":
      return "plus";
    default:
      return "base";
  }
}

/** Risolve i {@link PlanLimits} di un piano (normalizzando i codici legacy). */
export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[normalizePlan(plan)];
}

/** Etichetta leggibile del piano per i messaggi utente. */
export function planLabel(plan: string | null | undefined): string {
  switch (normalizePlan(plan)) {
    case "base":
      return "Base";
    case "standard":
      return "Standard";
    case "plus":
      return "Plus";
    default:
      return plan ? String(plan) : "—";
  }
}

/** Numero massimo di posti per uno specifico ruolo nel piano. */
export function seatLimitForRole(
  plan: string | null | undefined,
  role: TeamRole,
): number {
  const limits = getPlanLimits(plan);
  switch (role) {
    case "OWNER":
      return limits.max_owners_per_company;
    case "MANAGER":
      return limits.max_managers_per_company;
    case "VIEWER":
      return limits.max_viewers_per_company;
  }
}

/** Numero massimo di aziende creabili dall'abbonato nel piano. */
export function companyLimit(plan: string | null | undefined): number {
  return getPlanLimits(plan).max_companies;
}

/** true se la soglia è "illimitata" (≥ {@link UNLIMITED}). */
export function isUnlimited(n: number): boolean {
  return n >= UNLIMITED;
}

/**
 * true se l'abbonato può creare un'altra azienda dato il conteggio di quelle
 * ATTIVE (non eliminate) già possedute.
 */
export function canCreateCompany(
  plan: string | null | undefined,
  currentActiveCompanies: number,
): boolean {
  return currentActiveCompanies < companyLimit(plan);
}

// ---------------------------------------------------------------------------
// Eccezione controllata di quota
// ---------------------------------------------------------------------------

/** Natura della quota saturata: creazione azienda vs posto collaboratore. */
export type QuotaKind = "company" | "seat";

/**
 * Eccezione CONTROLLATA sollevata quando una quota di piano è saturata. Porta un
 * `code` stabile (`QUOTA_EXCEEDED`) che la UI usa per attivare il modal di
 * upgrade invece di mostrare un errore generico.
 */
export class QuotaExceededError extends Error {
  /** Discriminante stabile per il riconoscimento lato UI. */
  readonly code = "QUOTA_EXCEEDED" as const;
  readonly kind: QuotaKind;
  readonly plan: string;
  /** Ruolo coinvolto quando `kind === "seat"`. */
  readonly role?: TeamRole;

  constructor(
    message: string,
    opts: { kind: QuotaKind; plan: string | null | undefined; role?: TeamRole },
  ) {
    super(message);
    this.name = "QuotaExceededError";
    this.kind = opts.kind;
    this.plan = opts.plan ?? "";
    this.role = opts.role;
  }
}

/** Type-guard robusto (resiste alla serializzazione che perde il prototipo). */
export function isQuotaError(e: unknown): e is QuotaExceededError {
  return (
    e instanceof QuotaExceededError ||
    (typeof e === "object" &&
      e !== null &&
      (e as { code?: unknown }).code === "QUOTA_EXCEEDED")
  );
}

/**
 * Verifica la quota aziende e SOLLEVA {@link QuotaExceededError} se saturata.
 * Backstop client-side del trigger DB `check_tenant_limit`: blocca la mutazione
 * (e il disegno) prima ancora dell'INSERT, attivando il modal di upgrade.
 */
export function assertCanCreateCompany(
  plan: string | null | undefined,
  currentActiveCompanies: number,
): void {
  if (canCreateCompany(plan, currentActiveCompanies)) return;
  const max = companyLimit(plan);
  throw new QuotaExceededError(
    `Limite aziende raggiunto per il piano ${planLabel(plan)} (Massimo ${max} ${
      max === 1 ? "azienda" : "aziende"
    }). Effettua l'upgrade della licenza.`,
    { kind: "company", plan },
  );
}
