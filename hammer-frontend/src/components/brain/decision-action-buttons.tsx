"use client";

export type BrainDecisionAction = "approve" | "execute" | "dismiss" | "snooze" | "manual-review" | "reopen";

export function DecisionActionButtons({
  status,
  busy,
  onAction,
}: {
  status: string;
  busy: boolean;
  onAction: (action: BrainDecisionAction) => void;
}) {
  const canApprove = status === "OPEN" || status === "SNOOZED" || status === "FAILED";
  const canExecute = status === "APPROVED";
  const canManualReview = status === "OPEN" || status === "APPROVED" || status === "FAILED";
  const canSnooze = status === "OPEN" || status === "APPROVED" || status === "MANUAL_REVIEW";
  const canDismiss = !["EXECUTED", "DISMISSED", "EXPIRED"].includes(status);
  const canReopen = ["DISMISSED", "EXPIRED", "FAILED"].includes(status);

  const secondary = "rounded-md border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:text-[var(--color-text-soft)]";
  const primary = "rounded-md bg-[var(--color-info-700)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-info-600)] disabled:cursor-not-allowed disabled:bg-[var(--color-surface-alt)] disabled:text-[var(--color-text-soft)]";
  const success = "rounded-md bg-[var(--color-success-700)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-success-600)] disabled:cursor-not-allowed disabled:bg-[var(--color-surface-alt)] disabled:text-[var(--color-text-soft)]";
  const danger = "rounded-md border border-[var(--color-danger-200)] px-3 py-2 text-sm font-semibold text-[var(--color-danger-700)] transition-colors hover:bg-[var(--color-danger-50)] disabled:cursor-not-allowed disabled:text-[var(--color-text-soft)]";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={!canApprove || busy} className={primary} onClick={() => onAction("approve")}>Aprobar</button>
      <button type="button" disabled={!canExecute || busy} className={success} onClick={() => onAction("execute")}>Ejecutar</button>
      <button type="button" disabled={!canManualReview || busy} className={secondary} onClick={() => onAction("manual-review")}>Revisión manual</button>
      <button type="button" disabled={!canSnooze || busy} className={secondary} onClick={() => onAction("snooze")}>Posponer</button>
      <button type="button" disabled={!canDismiss || busy} className={danger} onClick={() => onAction("dismiss")}>Descartar</button>
      {canReopen ? <button type="button" disabled={busy} className={secondary} onClick={() => onAction("reopen")}>Reabrir</button> : null}
    </div>
  );
}
