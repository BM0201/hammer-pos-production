/**
 * Legacy Cash Closure Scheduler
 *
 * CashClosure no longer owns operational state. This scheduler is kept only as
 * a compatibility wrapper and delegates to CashSession auto-close:
 * - Monday-Friday 17:20 America/Managua
 * - Saturday 16:00 America/Managua
 * - Sunday disabled
 */

import { executeAutoClosureForAllBranches } from "@/modules/cash-closure/service";

declare global {
  // eslint-disable-next-line no-var
  var __hammerCashClosureSchedulerRunning: boolean | undefined;
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

function isSchedulerEnabled(): boolean {
  const raw = (process.env.ENABLE_CASH_CLOSURE_SCHEDULER ?? "").toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return process.env.NODE_ENV !== "production";
}

async function checkAndClose(): Promise<void> {
  try {
    const result = await executeAutoClosureForAllBranches();
    if (result.autoClosed > 0 || result.errors.length > 0) {
      console.log(
        `[CashClosure Legacy Scheduler] CashSession auto-close result: ${result.autoClosed} closed, ${result.errors.length} errors`,
      );
    }
  } catch (error) {
    console.error("[CashClosure Legacy Scheduler] Error:", error);
  }
}

export function startCashClosureScheduler(): void {
  if (!isSchedulerEnabled()) {
    console.log("[CashClosure Legacy Scheduler] Disabled by environment configuration.");
    return;
  }

  if (globalThis.__hammerCashClosureSchedulerRunning || schedulerInterval) {
    return;
  }

  globalThis.__hammerCashClosureSchedulerRunning = true;
  console.log("[CashClosure Legacy Scheduler] Starting as wrapper for CashSession auto-close.");

  void checkAndClose();
  schedulerInterval = setInterval(() => {
    void checkAndClose();
  }, 60_000);
}

export function stopCashClosureScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  globalThis.__hammerCashClosureSchedulerRunning = false;
  console.log("[CashClosure Legacy Scheduler] Stopped");
}
