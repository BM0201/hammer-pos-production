import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertProductionPermission } from "@/modules/auth/production-guard";
import { getProductionDashboard } from "@/modules/production/production-dashboard-service";
import { toHttpErrorResponse } from "@/lib/http";
import { fail, ok } from "@/lib/api/response";

/** Primer día del mes en curso, 00:00 America/Managua, en UTC — mismo patrón que treasury/deposit-summary. */
function firstOfMonthUtc(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Managua", year: "numeric", month: "2-digit" })
    .format(now)
    .split("-")
    .map(Number);
  const [year, month] = parts;
  return new Date(Date.UTC(year, month - 1, 1, 6, 0, 0, 0)); // Managua 00:00 → 06:00 UTC
}

/**
 * prompt-produccion-materiales.md Fase 3 — dashboard calculado en el
 * servidor, nunca en el cliente con "los últimos 80 lotes". Default: mes en
 * curso.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await assertProductionPermission(session, "production.dashboard.view");

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es obligatorio.", 400);

    const now = new Date();
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");
    const from = fromRaw ? new Date(fromRaw) : firstOfMonthUtc(now);
    const to = toRaw ? new Date(toRaw) : now;

    return ok(await getProductionDashboard({ branchId, from, to }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
