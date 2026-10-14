import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { describeCostSource } from "@/modules/pricing/cost-correction-service";

/**
 * D · Fase 3 (prompt-completo-pendientes-2026-10.md) — "lo mismo fuera de la
 * Bandeja": GET /api/master/pricing/cost-source?productId=&branchId=, para
 * la ficha del producto y Precios vigentes, donde puede no haber ninguna
 * BrainDecision abierta que ancle el botón "Corregir costo" (a diferencia de
 * .../tray/[decisionId]/cost-source, que sí depende de una).
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session)) return fail("FORBIDDEN", "Solo Master puede ver el origen del costo.", 403);

    const url = new URL(request.url);
    const productId = url.searchParams.get("productId");
    const branchId = url.searchParams.get("branchId");
    if (!productId || !branchId) return fail("VALIDATION_ERROR", "productId y branchId son obligatorios.", 400);

    return ok(await describeCostSource(productId, branchId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
