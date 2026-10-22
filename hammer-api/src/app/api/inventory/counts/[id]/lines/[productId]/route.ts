import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { correctStockCountLine, canAccessStockCount } from "@/modules/inventory/stock-count-service";

export const maxDuration = 30;

const correctSchema = z.object({
  setTo: z.number().min(0).optional(),
  delta: z.number().optional(),
  clientEventId: z.string().min(1),
});

/** POST /api/inventory/counts/:id/lines/:productId — corrección (−1 o cantidad editada). Nunca baja de 0. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; productId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id, productId } = await params;
    const parsed = correctSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const stockCount = await prisma.stockCount.findUnique({ where: { id }, select: { branchId: true, assignedUserIds: true } });
    if (!stockCount) return fail("NOT_FOUND", "Conteo no encontrado.", 404);

    const isPrivileged = canInBranch(session, stockCount.branchId, CAPABILITIES.INVENTORY_COUNT_APPROVE);
    const canPerform = canInBranch(session, stockCount.branchId, CAPABILITIES.INVENTORY_COUNT_PERFORM);
    if (!(isPrivileged || canPerform) || !canAccessStockCount(stockCount, session!.userId, isPrivileged)) {
      return fail("FORBIDDEN", "No tenés acceso a este conteo.", 403);
    }

    const line = await correctStockCountLine({ stockCountId: id, productId, ...parsed.data, actorUserId: session!.userId, isPrivileged });
    return ok(line);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
