import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { getStockCountForViewer, canAccessStockCount } from "@/modules/inventory/stock-count-service";

export const maxDuration = 30;

/** GET /api/inventory/counts/:id — para el contador, sin systemBaseAtLastScan si blind=true; para Master, todo. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { id } = await params;
    const stockCount = await prisma.stockCount.findUnique({ where: { id }, select: { branchId: true, assignedUserIds: true } });
    if (!stockCount) return fail("NOT_FOUND", "Conteo no encontrado.", 404);

    const isPrivileged = canInBranch(session, stockCount.branchId, CAPABILITIES.INVENTORY_COUNT_APPROVE);
    const canPerform = canInBranch(session, stockCount.branchId, CAPABILITIES.INVENTORY_COUNT_PERFORM);
    if (!canAccessStockCount(stockCount, session!.userId, isPrivileged) || !(isPrivileged || canPerform)) {
      return fail("FORBIDDEN", "No tenés acceso a este conteo.", 403);
    }

    return ok(await getStockCountForViewer(id, { isPrivileged }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
