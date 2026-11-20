import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { isMaster } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { prisma } from "@/lib/prisma";
import { getOperationalWindowForNow } from "@/modules/operations/business-date";

/**
 * Lo que la pantalla Caja necesita con la caja cerrada:
 * - pendingDeclaration: caja cerrada hoy a mano y sin destino declarado; se
 *   vuelve a pedir aunque se haya recargado. Las auto-cerradas no entran
 *   (esas las declara la revisión de Master).
 * - lastCashFund: el sencillo contado en el último cierre declarado, para
 *   abrir con él. `note` trae el desglose por billetes y monedas.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const branchId = new URL(request.url).searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "Falta branchId.", 400);
    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.CASH_SESSION_OPERATE)) return fail("FORBIDDEN", "Forbidden", 403);

    const { start } = getOperationalWindowForNow();
    const [pending, lastDeclaration] = await Promise.all([
      prisma.cashSession.findFirst({
        where: {
          status: "CLOSED",
          autoClosedBySystem: false,
          closedAt: { gte: start },
          destinationDeclaration: null,
          physicalCashBox: { branchId },
        },
        select: { id: true, countedCashAmount: true },
        orderBy: { closedAt: "desc" },
      }),
      prisma.cashDestinationDeclaration.findFirst({
        where: { branchId, isAutoDefaulted: false },
        select: { retainCashFundPortion: true, notes: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return ok({
      pendingDeclaration: pending ? { cashSessionId: pending.id, countedAmount: Number(pending.countedCashAmount ?? 0) } : null,
      lastCashFund: lastDeclaration
        ? { amount: Number(lastDeclaration.retainCashFundPortion), note: lastDeclaration.notes, declaredAt: lastDeclaration.createdAt.toISOString() }
        : null,
    });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
