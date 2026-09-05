import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { getPricingTray, type PricingTrayReason } from "@/modules/pricing/tray-service";

const VALID_REASONS: readonly PricingTrayReason[] = ["BELOW_COST", "MARGIN_POLICY", "COST_STALE", "NO_COST"];

/**
 * §1.3 (prompt-motor-precios-lote-herencia-gobierno.md) — bandeja de
 * revisión de precios. Lee BrainDecision (category PRICING, status OPEN)
 * que ya trae el precio sugerido calculado; no recalcula nada.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_VIEW)) {
      return fail("FORBIDDEN", "No tienes permiso para ver la bandeja de precios.", 403);
    }

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId") ?? undefined;
    const categoryId = url.searchParams.get("categoryId") ?? undefined;
    const severity = url.searchParams.get("severity") ?? undefined;
    const reasonParam = url.searchParams.get("reason") ?? undefined;
    if (reasonParam && !VALID_REASONS.includes(reasonParam as PricingTrayReason)) {
      return fail("VALIDATION_ERROR", "reason invalido.", 400);
    }

    const result = await getPricingTray({
      branchId,
      categoryId,
      severity,
      reason: reasonParam as PricingTrayReason | undefined,
    });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
