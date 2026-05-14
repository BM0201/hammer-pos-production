/**
 * Cash Closure Scheduler
 *
 * Default behavior:
 * - production: disabled unless ENABLE_CASH_CLOSURE_SCHEDULER=true
 * - non-production: enabled
 */

import { executeAutoClosureForAllBranches, isAfterAutoCloseTime } from "@/modules/cash-closure/service";

declare global {
  // eslint-disable-next-line no-var
  var __hammerCashClosureSchedulerRunning: boolean | undefined;
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastClosureDate: string | null = null;

function isSchedulerEnabled(): boolean {
  const raw = (process.env.ENABLE_CASH_CLOSURE_SCHEDULER ?? "").toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return process.env.NODE_ENV !== "production";
}

function getNicaraguaDateString(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Managua",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function checkAndClose(): Promise<void> {
  try {
    const todayStr = getNicaraguaDateString();

    if (lastClosureDate === todayStr) return;
    if (!isAfterAutoCloseTime()) return;

    console.log(`[CashClosure Scheduler] Triggering auto-closure for ${todayStr}`);
    const results = await executeAutoClosureForAllBranches();

    const newClosures = results.filter((r) => !r.alreadyClosed).length;
    if (newClosures > 0) {
      console.log(`[CashClosure Scheduler] Closed ${newClosures} branches for ${todayStr}`);
    }

    lastClosureDate = todayStr;
  } catch (error) {
    console.error("[CashClosure Scheduler] Error:", error);
  }
}

export function startCashClosureScheduler(): void {
  if (!isSchedulerEnabled()) {
    console.log("[CashClosure Scheduler] Disabled by environment configuration.");
    return;
  }

  if (globalThis.__hammerCashClosureSchedulerRunning || schedulerInterval) {
    return;
  }

  globalThis.__hammerCashClosureSchedulerRunning = true;
  console.log("[CashClosure Scheduler] Starting (checks every 60s, closes at 17:30 GMT-6)");

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
  console.log("[CashClosure Scheduler] Stopped");
}
