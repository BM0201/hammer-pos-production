import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { getPricingTrayDecisionContext } from "@/modules/pricing/tray-context-service";

/**
 * C.2 (prompt-completo-pendientes-2026-10.md) — GET
 * /api/master/pricing/tray/[decisionId]/context: todas las referencias de
 * precio, ventas de 90 días, margen realizado, precios en otras
 * sucursales, historial de cambios y la última revisión, para explicar
 * (y decidir) una fila de la Bandeja.
 */
export async function GET(request: Request, { params }: { params: Promise<{ decisionId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_EDIT_GLOBAL)) {
      return fail("FORBIDDEN", "No tienes permiso para ver la bandeja de precios.", 403);
    }

    const { decisionId } = await params;
    return ok(await getPricingTrayDecisionContext(decisionId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
