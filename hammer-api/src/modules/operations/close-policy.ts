const HARD_CLOSE_BLOCKER_KEYS = new Set(["open_cash_sessions", "auto_closed_pending_review", "pending_payments"]);

export function isHardOperationalDayCloseBlocker(key: string) {
  return HARD_CLOSE_BLOCKER_KEYS.has(key);
}
