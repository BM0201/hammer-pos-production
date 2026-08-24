import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { isMaster } from "@/modules/rbac/guards";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { prisma } from "@/lib/prisma";
import { getCashSessionDestinationSummary } from "@/modules/treasury/cash-monitor";

/**
 * Resumen del módulo "Destino del efectivo" — la caja de ESA sesión.
 * Permiso: CASH_SESSION_OPERATE (mismo que operar la sesión), NO
 * TREASURY_VIEW_BRANCH — CASHIER no la tiene, y dársela abriría la
 * tesorería completa de la sucursal para exponer solo el dinero de su
 * propia caja.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: cashSessionId } = await params;
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const cashSession = await prisma.cashSession.findUniqueOrThrow({
      where: { id: cashSessionId },
      include: { physicalCashBox: true },
    });
    const branchId = cashSession.physicalCashBox.branchId;

    if (!canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPERATE)) return fail("FORBIDDEN", "Forbidden", 403);
    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.CASH_SESSION_OPERATE)) return fail("FORBIDDEN", "Forbidden", 403);

    return ok(await getCashSessionDestinationSummary(cashSessionId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
