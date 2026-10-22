import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { submitStockCount, canAccessStockCount } from "@/modules/inventory/stock-count-service";

export const maxDuration = 30;

/** POST /api/inventory/counts/:id/submit — OPEN → SUBMITTED. Ya no se puede editar. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const stockCount = await prisma.stockCount.findUnique({ where: { id }, select: { branchId: true, assignedUserIds: true } });
    if (!stockCount) return fail("NOT_FOUND", "Conteo no encontrado.", 404);

    const isPrivileged = canInBranch(session, stockCount.branchId, CAPABILITIES.INVENTORY_COUNT_APPROVE);
    const canPerform = canInBranch(session, stockCount.branchId, CAPABILITIES.INVENTORY_COUNT_PERFORM);
    if (!(isPrivileged || canPerform) || !canAccessStockCount(stockCount, session!.userId, isPrivileged)) {
      return fail("FORBIDDEN", "No tenés acceso a este conteo.", 403);
    }

    const result = await submitStockCount(id, session!.userId, isPrivileged);
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
