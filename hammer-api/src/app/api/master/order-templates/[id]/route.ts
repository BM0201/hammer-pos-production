import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { updateOrderTemplate, deleteOrderTemplate } from "@/modules/purchase-orders/order-template-service";

const lineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive(),
  overrides: z.record(z.string(), z.number().min(0)).optional(),
  unitCost: z.number().min(0).optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  isActive: z.boolean().optional(),
  branchIds: z.array(z.string().min(1)).optional(),
  lines: z.array(lineSchema).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    return ok(await updateOrderTemplate(id, parsed.data));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await params;
    await deleteOrderTemplate(id);
    return ok({ deleted: true });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
