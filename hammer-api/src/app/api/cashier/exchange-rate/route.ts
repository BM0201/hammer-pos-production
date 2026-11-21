import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { canInAnyAssignedBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { getLatestUsdToNioRate } from "@/modules/treasury/service";

/** Tipo de cambio USD→NIO vigente para cobrar en dólares (solo la tasa; la fija Master en Tesorería). */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPERATE)) return fail("FORBIDDEN", "Forbidden", 403);
    return ok({ usdToNioRate: await getLatestUsdToNioRate() });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
