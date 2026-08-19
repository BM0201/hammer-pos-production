/**
 * Next.js Instrumentation Hook
 * 
 * Initializes server-side services when the Next.js server starts.
 * This file is automatically loaded by Next.js when the server starts.
 */

export async function register() {
  // Only start scheduler on the server (not during build or in edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCashClosureScheduler } = await import("@/modules/cash-closure/scheduler");
    startCashClosureScheduler();
    console.log("[Instrumentation] Cash closure scheduler initialized");
  }
}
