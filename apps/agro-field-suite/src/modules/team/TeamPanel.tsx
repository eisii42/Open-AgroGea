import { useAgroStore } from "@agrogea/core";
import { Button, Input, Label, cn } from "@geolibre/ui";
import { Crown, Eye, ShieldCheck, UserPlus, Users } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isQuotaError,
  type TeamRole,
  TEAM_ROLES,
} from "@agrogea/core";
import type { SeatUsage } from "@agrogea/core";
import {
  ensurePrincipalOwner,
  inviteMember,
  revokeMembership,
  useCompanyMemberships,
  useInviteDecision,
  useSeatUsage,
} from "@agrogea/core";

/** Etichette ed icone per ruolo (badge contatori + select). */
const ROLE_META: Record<TeamRole, { label: string; plural: string; Icon: typeof Crown }> = {
  OWNER: { label: "Owner", plural: "Owners", Icon: Crown },
  MANAGER: { label: "Manager", plural: "Managers", Icon: ShieldCheck },
  VIEWER: { label: "Viewer", plural: "Viewers", Icon: Eye },
};

/**
 * Modulo 4 — Pannello gestione team del Data Command Center. Mostra i badge
 * contatori dei posti per l'azienda selezionata (es. Enterprise: `Owners 1/2`,
 * `Viewers 0/3`) e un form d'invito il cui ruolo/pulsante si disabilita quando
 * la quota specifica è saturata. In sola lettura (VIEWER) l'intero pannello è
 * inerte.
 */
export function TeamPanel({ readOnly = false }: { readOnly?: boolean }) {
  const { t } = useTranslation();
  const companyId = useAgroStore((s) => s.activeCompanyId);
  const plan = useAgroStore((s) => s.profile?.license_plan ?? null);

  const seats = useSeatUsage(plan, companyId);
  const memberships = useCompanyMemberships(companyId);

  // L'abbonato principale occupa un posto OWNER dell'azienda: registrandolo
  // (idempotente, per le companies legacy) i contatori partono da "Owners 1/…" e
  // gli inviti sono validati sui posti residui.
  useEffect(() => {
    if (companyId) void ensurePrincipalOwner(companyId);
  }, [companyId]);

  if (!companyId) return null;

  return (
    <section className="rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--sh-1)]">
      <div className="mb-3 flex items-center gap-2">
        <Users size={16} className="text-[var(--accent)]" />
        <h3 className="text-[15px] font-semibold">{t("teamPanel.title")}</h3>
        <span className="ml-auto rounded-full bg-[var(--panel-2)] px-2 py-0.5 text-[11px] text-[var(--ink-3)]">
          {t("teamPanel.plan", { plan: plan ?? "—" })}
        </span>
      </div>

      {/* Badge contatori per ruolo. */}
      <div className="flex flex-wrap gap-2">
        {seats.map((seat) => (
          <SeatBadge key={seat.role} seat={seat} />
        ))}
      </div>

      {/* Form d'invito (role-gated). In sola lettura l'intero blocco sparisce. */}
      {readOnly ? (
        <p className="mt-4 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-xs text-[var(--ink-3)]">
          {t("teamPanel.readOnlyNotice")}
        </p>
      ) : (
        <InviteForm plan={plan} companyId={companyId} seats={seats} />
      )}

      {/* Elenco membri (occupanti). */}
      {memberships.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {memberships
            .filter((m) => m.status !== "revoked")
            .map((m) => {
              const meta = ROLE_META[m.role];
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-[var(--r-2)] bg-[var(--panel-2)] px-3 py-2 text-[13px]"
                >
                  <meta.Icon size={14} className="text-[var(--ink-3)]" />
                  <span className="flex-1 truncate">{m.email}</span>
                  <span className="text-[var(--ink-4)]">{meta.label}</span>
                  {m.status === "invited" && (
                    <span className="rounded-full bg-[var(--warn-l)] px-1.5 text-[10px] text-[var(--warn)]">
                      {t("teamPanel.invited")}
                    </span>
                  )}
                  {!readOnly && m.role !== "OWNER" && (
                    <button
                      type="button"
                      onClick={() => void revokeMembership(m.id)}
                      className="text-[11px] text-[var(--danger)] hover:underline"
                    >
                      {t("teamPanel.remove")}
                    </button>
                  )}
                </li>
              );
            })}
        </ul>
      )}
    </section>
  );
}

/** Badge contatore di un singolo ruolo (es. "Owners 1/2"). */
function SeatBadge({ seat }: { seat: SeatUsage }) {
  const { t } = useTranslation();
  const meta = ROLE_META[seat.role];
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        seat.saturated
          ? "border-[var(--warn)] bg-[var(--warn-l)] text-[var(--warn)]"
          : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--ink-2)]",
      )}
      title={t("teamPanel.seatUsage", {
        plural: meta.plural,
        used: seat.used,
        max: seat.unlimited ? t("teamPanel.unlimited") : seat.max,
      })}
    >
      <meta.Icon size={13} />
      {meta.plural}
      <span className="agro-num">
        {seat.used}/{seat.unlimited ? "∞" : seat.max}
      </span>
    </span>
  );
}

/** Form d'invito collaboratore con select ruolo e disabilitazione su quota. */
function InviteForm({
  plan,
  companyId,
  seats,
}: {
  plan: string | null;
  companyId: string;
  seats: SeatUsage[];
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("MANAGER");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Ruoli con almeno un posto previsto dal piano: gli altri non sono invitabili.
  const availableRoles = useMemo(
    () => TEAM_ROLES.filter((r) => seats.find((s) => s.role === r)?.max !== 0),
    [seats],
  );

  // Se il ruolo selezionato non è più disponibile (cambio piano/azienda), si
  // ripiega sul primo invitabile.
  useEffect(() => {
    if (availableRoles.length > 0 && !availableRoles.includes(role)) {
      setRole(availableRoles[0]);
    }
  }, [availableRoles, role]);

  // Valutazione reattiva del ruolo selezionato (abilita/disabilita il submit).
  const decision = useInviteDecision(plan, companyId, role);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setOkMsg(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError(t("teamPanel.invalidEmail"));
      return;
    }
    setBusy(true);
    try {
      await inviteMember({ plan, companyId, email: trimmed, role });
      setOkMsg(
        t("teamPanel.inviteSent", { email: trimmed, role: ROLE_META[role].label }),
      );
      setEmail("");
    } catch (e) {
      // Eccezione controllata di quota → messaggio specifico per ruolo/azienda.
      setError(
        isQuotaError(e) ? e.message : e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  }

  if (availableRoles.length === 0) {
    return (
      <p className="mt-4 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-xs text-[var(--ink-3)]">
        {t("teamPanel.noSeatsForPlan")}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-2">
      <Label htmlFor="team-email">{t("teamPanel.inviteCollaborator")}</Label>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          id="team-email"
          type="email"
          placeholder={t("teamPanel.emailPlaceholder")}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          className="min-w-[200px] flex-1"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as TeamRole)}
          aria-label={t("teamPanel.role")}
          className="min-h-[var(--touch-min)] rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 text-sm"
        >
          {availableRoles.map((r) => {
            const seat = seats.find((s) => s.role === r);
            const saturated = seat?.saturated ?? false;
            return (
              <option key={r} value={r} disabled={saturated}>
                {ROLE_META[r].label}
                {seat && !seat.unlimited ? ` (${seat.used}/${seat.max})` : ""}
                {saturated ? ` — ${t("teamPanel.exhausted")}` : ""}
              </option>
            );
          })}
        </select>
        <Button
          type="submit"
          disabled={!decision.allowed || busy}
          className="min-h-[var(--touch-min)]"
        >
          <UserPlus size={15} className="mr-1.5" />
          {busy
            ? t("teamPanel.sending")
            : decision.allowed
              ? t("teamPanel.invite")
              : t("teamPanel.quotaExhausted")}
        </Button>
      </div>

      {!decision.allowed && decision.reason && (
        <p className="text-xs font-medium text-[var(--warn)]">{decision.reason}</p>
      )}
      {error && (
        <p role="alert" className="text-xs font-medium text-[var(--danger)]">
          {error}
        </p>
      )}
      {okMsg && (
        <p className="text-xs font-medium text-[var(--accent)]">{okMsg}</p>
      )}
    </form>
  );
}
