import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { reopenStockCount } from "@/modules/inventory/stock-count-service";

export const maxDuration = 30;

/** POST /api/inventory/counts/:id/reopen — "Devolver para corregir": SUBMITTED → OPEN, el contador vuelve a verlo. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const stockCount = await prisma.stockCount.findUnique({ where: { id }, select: { branchId: true } });
    if (!stockCount) return fail("NOT_FOUND", "Conteo no encontrado.", 404);

    if (!canInBranch(session, stockCount.branchId, CAPABILITIES.INVENTORY_COUNT_APPROVE)) {
      return fail("FORBIDDEN", "No tenés permiso para devolver conteos en esta sucursal.", 403);
    }

    const result = await reopenStockCount(id, session!.userId);
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
