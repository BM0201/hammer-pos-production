import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { isMaster } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { updateSaleOrderNotes } from "@/modules/sales/service";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  notes: z.string().max(1000).nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    if (!canInAnyAssignedBranch(session, CAPABILITIES.SALES_DRAFT_MANAGE)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const { id } = await params;
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Datos inválidos", 400);

    const order = await prisma.saleOrder.findUnique({
      where: { id },
      select: { branchId: true },
    });
    if (!order) return fail("NOT_FOUND", "Orden no encontrada", 404);

    if (!isMaster(session) && !canInBranch(session, order.branchId, CAPABILITIES.SALES_DRAFT_MANAGE)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const updated = await updateSaleOrderNotes({
      saleOrderId: id,
      notes: parsed.data.notes ?? null,
      actorUserId: session.userId,
    });

    return ok(updated);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
