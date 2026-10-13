import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { getPricingCalibration } from "@/modules/pricing/calibration-service";

/**
 * C.3 (prompt-completo-pendientes-2026-10.md) — GET
 * /api/master/pricing/calibration?branchId: margen realmente vendido por
 * categoría (90 días, p25/mediana/p75) y cuántos productos caerían en la
 * Bandeja con cada umbral candidato. Solo lectura — no cambia nada.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_EDIT_GLOBAL)) {
      return fail("FORBIDDEN", "No tienes permiso para ver la calibración de precios.", 403);
    }

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es requerido.", 400);

    return ok(await getPricingCalibration({ branchId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
