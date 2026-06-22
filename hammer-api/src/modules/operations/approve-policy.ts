// Bloqueadores duros: nunca se pueden forzar (ni siquiera con forceApprove + nota).
const HARD_APPROVE_BLOCKER_KEYS = new Set([
  "OPEN_OR_UNREVIEWED_CASH_SESSION",
  "PENDING_PAYMENT_ORDER", // ventas de contado sin cobrar (no crédito — ver crédito legítimo)
]);

export function isHardApproveBlocker(code: string): boolean {
  return HARD_APPROVE_BLOCKER_KEYS.has(code);
}
