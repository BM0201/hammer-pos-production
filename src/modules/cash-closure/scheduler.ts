/**
 * Cash Closure Scheduler
 * 
 * Runs a check every minute. At 5:30 PM Nicaragua time (GMT-6),
 * triggers automatic closure for all active branches.
 * 
 * This runs as a background interval when the Next.js server starts.
 */

import { executeAutoClosureForAllBranches, isAfterAutoCloseTime } from "@/modules/cash-closure/service";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastClosureDate: string | null = null;

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

    // Only close once per day
    if (lastClosureDate === todayStr) {
      return;
    }

    if (!isAfterAutoCloseTime()) {
      return;
    }

    console.log(`[CashClosure Scheduler] Triggering auto-closure for ${todayStr}`);
    const results = await executeAutoClosureForAllBranches();

    let newClosures = 0;
    for (const r of results) {
      if (!r.alreadyClosed) newClosures++;
    }

    if (newClosures > 0) {
      console.log(`[CashClosure Scheduler] Closed ${newClosures} branches for ${todayStr}`);
    }

    lastClosureDate = todayStr;
  } catch (error) {
    console.error("[CashClosure Scheduler] Error:", error);
  }
}

export function startCashClosureScheduler(): void {
  if (schedulerInterval) {
    return; // Already running
  }

  console.log("[CashClosure Scheduler] Starting (checks every 60s, closes at 17:30 GMT-6)");

  // Run initial check
  checkAndClose();

  // Check every 60 seconds
  schedulerInterval = setInterval(checkAndClose, 60_000);
}

export function stopCashClosureScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[CashClosure Scheduler] Stopped");
  }
}
