import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { rejectStockCount } from "@/modules/inventory/stock-count-service";

export const maxDuration = 30;

const rejectSchema = z.object({ note: z.string().trim().min(1) });

/** POST /api/inventory/counts/:id/reject — Master/Owner/SystemAdmin. El motivo es obligatorio. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const parsed = rejectSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "El motivo es obligatorio.", 400, parsed.error.flatten());

    const stockCount = await prisma.stockCount.findUnique({ where: { id }, select: { branchId: true } });
    if (!stockCount) return fail("NOT_FOUND", "Conteo no encontrado.", 404);

    if (!canInBranch(session, stockCount.branchId, CAPABILITIES.INVENTORY_COUNT_APPROVE)) {
      return fail("FORBIDDEN", "No tenés permiso para rechazar conteos en esta sucursal.", 403);
    }

    const result = await rejectStockCount(id, parsed.data.note, session!.userId);
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
