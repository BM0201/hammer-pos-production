import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { describeCostSource } from "@/modules/pricing/cost-correction-service";

/**
 * D.2 (prompt-completo-pendientes-2026-10.md) — GET
 * /api/master/pricing/tray/[decisionId]/cost-source: "de dónde sale el
 * costo" para la hoja "Revisar y aplicar" (tarjeta por producto). Ruta
 * propia y no parte de .../context — ese ya depende de tray-service.ts, que
 * a su vez depende de este módulo (applyAlsoBranchPriceTx); meterlo ahí
 * crearía un ciclo de imports.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ decisionId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session)) return fail("FORBIDDEN", "Solo Master puede ver el origen del costo.", 403);

    const { decisionId } = await params;
    const decision = await prisma.brainDecision.findUniqueOrThrow({ where: { id: decisionId } });
    if (decision.category !== "PRICING") return fail("DECISION_NOT_PRICING", "La decisión no es de precios.", 400);
    if (!decision.branchId || !decision.productId) return fail("DECISION_MISSING_SUGGESTED_PRICE", "La decisión no tiene producto/sucursal.", 400);

    return ok(await describeCostSource(decision.productId, decision.branchId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
