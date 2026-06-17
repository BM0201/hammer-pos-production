"use client";

import { Wallet, AlertTriangle, CheckCircle2, Clock, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import type { CashSessionRow } from "@/components/operations/operational-day-summary";

function money(value: string | number | null | undefined) {
  return new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(Number(value ?? 0));
}

function diffColor(diff: number) {
  if (diff < 0) return "text-[var(--color-danger-700)] font-bold";
  if (diff === 0) return "text-[var(--color-success-700)] font-bold";
  return "text-[var(--color-warning-700)] font-bold";
}

// Mientras el día operativo está ABIERTO, tener una caja abierta es normal (operación en curso),
// no es un bloqueo ni un error. Solo cuando el día entra en cierre (CLOSING/CLOSED) una caja
// que sigue abierta se vuelve realmente urgente porque impide cerrar el día.
function dayIsClosing(dayStatus?: string) {
  return dayStatus === "CLOSING" || dayStatus === "CLOSED";
}

function sessionUrgency(session: CashSessionRow, dayStatus?: string): "hard" | "soft" | "ok" {
  if (session.status === "OPEN") return dayIsClosing(dayStatus) ? "hard" : "soft";
  if (session.status === "AUTO_CLOSED_PENDING_REVIEW") return "soft";
  return "ok";
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Abierta",
  CLOSED: "Cerrada",
  AUTO_CLOSED_PENDING_REVIEW: "Auto-cerrada pendiente",
  RECONCILING: "Reconciliando",
  RECONCILED: "Reconciliada",
};

const STATUS_BADGE: Record<string, "danger" | "warning" | "success" | "neutral"> = {
  OPEN: "danger",
  CLOSED: "success",
  AUTO_CLOSED_PENDING_REVIEW: "warning",
  RECONCILING: "warning",
  RECONCILED: "success",
};

const URGENCY_BORDER: Record<"hard" | "soft" | "ok", string> = {
  hard:  "border-[var(--color-danger-300)] bg-[color-mix(in_srgb,var(--color-danger-50)_20%,white)]",
  soft:  "border-[var(--color-warning-300)] bg-[color-mix(in_srgb,var(--color-warning-50)_20%,white)]",
  ok:    "border-[var(--color-border)] bg-[var(--color-surface-muted)]",
};

type Props = {
  sessions: CashSessionRow[];
  branchId?: string;
  /** Estado del día operativo. Determina si una caja abierta es normal (día OPEN) o urgente (día en cierre). */
  dayStatus?: string;
};

export function CashSessionStatusList({ sessions, branchId, dayStatus }: Props) {
  const closing = dayIsClosing(dayStatus);
  // Una caja abierta solo "requiere atención" cuando el día está en cierre.
  // Mientras el día está abierto, una caja abierta es operación normal en curso.
  const urgentCount = sessions.filter(
    (s) => (s.status === "OPEN" && closing) || s.status === "AUTO_CLOSED_PENDING_REVIEW",
  ).length;

  return (
    <div className="hm-module-card">
      <div className="hm-module-card-header">
        <div className="flex items-center gap-2">
          <Wallet className="text-[var(--color-text-muted)]" style={{ width: "1rem", height: "1rem" }} />
          <h2 className="text-sm font-bold text-[var(--color-text)]">Cajas del día</h2>
          <span className="hm-chip hm-chip-info text-xs">{sessions.length} sesión{sessions.length !== 1 ? "es" : ""}</span>
        </div>
        {urgentCount > 0 && (
          <span className="flex items-center gap-1 text-xs font-semibold text-[var(--color-danger-700)]">
            <AlertTriangle style={{ width: "0.875rem", height: "0.875rem" }} />
            {urgentCount} requieren atención
          </span>
        )}
      </div>

      <div className="p-4">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--color-border)] px-6 py-8 text-center">
            <Wallet className="text-[var(--color-text-muted)] opacity-30" style={{ width: "2rem", height: "2rem" }} />
            <p className="text-sm text-[var(--color-text-muted)]">No hay sesiones de caja en este día.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => {
              const urgency = sessionUrgency(session, dayStatus);
              const diff = Number(session.differenceAmount ?? 0);
              const Icon = urgency === "hard" ? AlertTriangle : urgency === "soft" ? Clock : CheckCircle2;
              const iconColor = urgency === "hard" ? "text-[var(--color-danger-600)]" : urgency === "soft" ? "text-[var(--color-warning-600)]" : "text-[var(--color-success-600)]";

              return (
                <div key={session.id} className={`rounded-xl border ${URGENCY_BORDER[urgency]} overflow-hidden`}>
                  {/* Header row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className={`flex-shrink-0 ${iconColor}`} style={{ width: "0.875rem", height: "0.875rem" }} />
                      <span className="font-semibold text-sm text-[var(--color-text)]">
                        {session.physicalCashBox?.code ?? "Caja"}
                        {session.physicalCashBox?.description && (
                          <span className="ml-1.5 text-xs text-[var(--color-text-muted)] font-normal">{session.physicalCashBox.description}</span>
                        )}
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        · {session.openedBy?.fullName ?? session.openedBy?.username ?? "usuario"}
                      </span>
                    </div>
                    <Badge
                      variant={
                        session.status === "OPEN" && !closing
                          ? "neutral"
                          : STATUS_BADGE[session.status] ?? "neutral"
                      }
                    >
                      {session.status === "OPEN" && !closing
                        ? "Abierta · en uso"
                        : STATUS_LABEL[session.status] ?? session.status}
                    </Badge>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-2 gap-0 border-t border-[var(--color-border)] divide-x divide-[var(--color-border)] sm:grid-cols-4">
                    {[
                      { label: "Apertura",  value: money(session.openingAmount) },
                      { label: "Esperado",  value: money(session.expectedCashAmount) },
                      { label: "Contado",   value: money(session.countedCashAmount) },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex flex-col gap-0.5 px-3 py-2">
                        <span className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">{label}</span>
                        <span className="text-xs font-semibold text-[var(--color-text-secondary)]">{value}</span>
                      </div>
                    ))}
                    <div className="flex flex-col gap-0.5 px-3 py-2">
                      <span className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">Diferencia</span>
                      <span className={`text-xs ${diffColor(diff)}`}>{money(diff)}</span>
                    </div>
                  </div>

                  {/* CTA for sessions requiring action */}
                  {session.status === "AUTO_CLOSED_PENDING_REVIEW" && (
                    <div className="flex items-center justify-between gap-2 border-t border-[var(--color-warning-200)] bg-[color-mix(in_srgb,var(--color-warning-50)_40%,white)] px-3.5 py-2">
                      <span className="text-xs text-[var(--color-warning-800)] font-medium">Esta caja fue auto-cerrada y requiere revisión manual.</span>
                      {branchId && (
                        <Link
                          href="/app/branch/cash"
                          className="flex items-center gap-1 text-xs font-semibold text-[var(--color-warning-700)] hover:text-[var(--color-warning-900)] transition-colors"
                        >
                          Ir a cajas <ArrowRight style={{ width: "0.75rem", height: "0.75rem" }} />
                        </Link>
                      )}
                    </div>
                  )}
                  {session.status === "OPEN" && closing && (
                    <div className="flex items-center justify-between gap-2 border-t border-[var(--color-danger-200)] bg-[color-mix(in_srgb,var(--color-danger-50)_30%,white)] px-3.5 py-2">
                      <span className="text-xs text-[var(--color-danger-800)] font-medium">Caja activa — debe cerrarse antes de cerrar el día.</span>
                      {branchId && (
                        <Link
                          href="/app/branch/cash"
                          className="flex items-center gap-1 text-xs font-semibold text-[var(--color-danger-700)] hover:text-[var(--color-danger-900)] transition-colors"
                        >
                          Ir a cajas <ArrowRight style={{ width: "0.75rem", height: "0.75rem" }} />
                        </Link>
                      )}
                    </div>
                  )}
                  {session.status === "OPEN" && !closing && (
                    <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3.5 py-2">
                      <span className="text-xs text-[var(--color-text-muted)] font-medium">Caja en uso — operación normal del día.</span>
                      {branchId && (
                        <Link
                          href="/app/branch/cash"
                          className="flex items-center gap-1 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
                        >
                          Ver caja <ArrowRight style={{ width: "0.75rem", height: "0.75rem" }} />
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
