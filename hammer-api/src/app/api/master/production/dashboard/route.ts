import { managuaMonthStartUtc } from "@/modules/sales/realtime-sales-summary";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertProductionPermission } from "@/modules/auth/production-guard";
import { getProductionDashboard } from "@/modules/production/production-dashboard-service";
import { toHttpErrorResponse } from "@/lib/http";
import { fail, ok } from "@/lib/api/response";

/**
 * prompt-produccion-materiales.md Fase 3 — dashboard calculado en el
 * servidor, nunca en el cliente con "los últimos 80 lotes". Default: mes en
 * curso. branchId es opcional — sin él, agrega todas las sucursales.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await assertProductionPermission(session, "production.dashboard.view");

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId") || null;

    const now = new Date();
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");
    const from = fromRaw ? new Date(fromRaw) : managuaMonthStartUtc(now);
    const to = toRaw ? new Date(toRaw) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return fail("VALIDATION_ERROR", "Fecha inválida.", 400);
    }
    if (from.getTime() > to.getTime()) {
      return fail("VALIDATION_ERROR", "La fecha inicial no puede ser posterior a la final.", 400);
    }

    return ok(await getProductionDashboard({ branchId, from, to }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
