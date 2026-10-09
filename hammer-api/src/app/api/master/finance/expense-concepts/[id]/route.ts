import { z } from "zod";
import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { isMaster, hasCapabilityInAnyAssignedBranch } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { updateExpenseConcept } from "@/modules/finance/expense-concepts";

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

/** PATCH /api/master/finance/expense-concepts/[id] — renombrar, activar/desactivar o reordenar. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session) && !hasCapabilityInAnyAssignedBranch(session!, CAPABILITIES.FINANCE_MANAGE_EXPENSES)) {
      return fail("FORBIDDEN", "No tienes permiso para administrar gastos.", 403);
    }

    const { id } = await params;
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    return ok(await updateExpenseConcept(id, parsed.data));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
