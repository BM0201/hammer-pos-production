"use client";

import { Zap } from "lucide-react";

export type BrainDecisionAction = "approve" | "execute" | "approve-and-execute" | "dismiss" | "snooze" | "manual-review" | "reopen";

const AUTO_EXECUTABLE_ACTIONS = new Set([
  "CREATE_PURCHASE_ORDER_DRAFT",
  "CREATE_TRANSFER_DRAFT",
  "CONVERT_REORDER_ALERT_TO_PURCHASE",
  "CONVERT_REORDER_ALERT_TO_TRANSFER",
  "RECALCULATE_CASH_SESSION",
  "REFRESH_OPERATIONAL_DAY",
]);

export function isAutoExecutable(proposedActionType?: string | null): boolean {
  return Boolean(proposedActionType && AUTO_EXECUTABLE_ACTIONS.has(proposedActionType));
}

export function DecisionActionButtons({
  status,
  proposedActionType,
  // K: actionMode from backend enrichDecision; falls back to local isAutoExecutable check
  actionMode,
  busy,
  onAction,
}: {
  status: string;
  proposedActionType?: string | null;
  actionMode?: "AUTO_EXECUTABLE" | "MANUAL_REVIEW" | string | null;
  busy: boolean;
  onAction: (action: BrainDecisionAction) => void;
}) {
  const isExecutable = actionMode === "AUTO_EXECUTABLE" || isAutoExecutable(proposedActionType);
  const canApprove = status === "OPEN" || status === "SNOOZED" || status === "FAILED" || status === "MANUAL_REVIEW";
  const canExecute = status === "APPROVED" && isExecutable;
  const canManualReview = status === "OPEN" || status === "APPROVED" || status === "FAILED";
  const canSnooze = status === "OPEN" || status === "APPROVED" || status === "MANUAL_REVIEW";
  const canDismiss = !["EXECUTED", "DISMISSED", "EXPIRED"].includes(status);
  // K: SNOOZED decisions can be explicitly reopened (e.g. urgent situation changed)
  const canReopen = ["DISMISSED", "EXPIRED", "FAILED", "SNOOZED"].includes(status);
  const canApproveAndExecute = canApprove && isExecutable;

  const secondary = "rounded-md border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:text-[var(--color-text-soft)]";
  const primary = "rounded-md bg-[var(--color-info-700)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-info-600)] disabled:cursor-not-allowed disabled:bg-[var(--color-surface-alt)] disabled:text-[var(--color-text-soft)]";
  const success = "rounded-md bg-[var(--color-success-700)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-success-600)] disabled:cursor-not-allowed disabled:bg-[var(--color-surface-alt)] disabled:text-[var(--color-text-soft)]";
  const combo = "inline-flex items-center gap-1.5 rounded-md bg-[var(--color-master-700,#4f46e5)] px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-master-600,#6366f1)] disabled:cursor-not-allowed disabled:bg-[var(--color-surface-alt)] disabled:text-[var(--color-text-soft)]";
  const danger = "rounded-md border border-[var(--color-danger-200)] px-3 py-2 text-sm font-semibold text-[var(--color-danger-700)] transition-colors hover:bg-[var(--color-danger-50)] disabled:cursor-not-allowed disabled:text-[var(--color-text-soft)]";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canApproveAndExecute ? (
        <button type="button" disabled={busy} className={combo} onClick={() => onAction("approve-and-execute")}>
          <Zap className="h-3.5 w-3.5" />
          Aprobar y Ejecutar
        </button>
      ) : (
        <button type="button" disabled={!canApprove || busy} className={primary} onClick={() => onAction("approve")}>
          Aprobar
        </button>
      )}
      {isExecutable ? (
        <button type="button" disabled={!canExecute || busy} className={success} onClick={() => onAction("execute")}>Ejecutar</button>
      ) : status === "APPROVED" ? (
        <span className="rounded-md border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2 text-sm font-semibold text-[var(--color-warning-700)]">Requiere acción manual</span>
      ) : null}
      <button type="button" disabled={!canManualReview || busy} className={secondary} onClick={() => onAction("manual-review")}>Revisión manual</button>
      <button type="button" disabled={!canSnooze || busy} className={secondary} onClick={() => onAction("snooze")}>Posponer</button>
      <button type="button" disabled={!canDismiss || busy} className={danger} onClick={() => onAction("dismiss")}>Descartar</button>
      {canReopen ? <button type="button" disabled={busy} className={secondary} onClick={() => onAction("reopen")}>Reabrir</button> : null}
    </div>
  );
}
