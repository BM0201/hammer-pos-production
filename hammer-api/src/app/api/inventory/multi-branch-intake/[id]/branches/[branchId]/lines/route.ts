import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { updateMultiBranchIntakeBranchLines } from "@/modules/inventory/multi-branch-intake-service";

export const maxDuration = 60;

const lineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().min(0),
  unitCost: z.number().min(0).optional(),
  salePrice: z.number().positive().optional(),
  unit: z.string().optional(),
  confirmHighCost: z.boolean().optional(),
});

const updateSchema = z.object({
  lines: z.array(lineSchema).min(1),
  expectedRevision: z.number().int().min(0),
});

/**
 * PUT /api/inventory/multi-branch-intake/[id]/branches/[branchId]/lines —
 * prompt-entrada-reintento-precio.md Commit 2 §3: corrige las líneas
 * pendientes de UNA sucursal que falló (FAILED), antes de reintentar.
 * Permisos: los mismos que crear una entrada (INVENTORY_MOVEMENT_POST en
 * esa sucursal).
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string; branchId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id, branchId } = await params;
    if (!canInBranch(session, branchId, CAPABILITIES.INVENTORY_MOVEMENT_POST)) {
      return fail("FORBIDDEN", "No tienes permiso para editar el ingreso en esta sucursal.", 403);
    }

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const result = await updateMultiBranchIntakeBranchLines({
      intakeId: id,
      branchId,
      lines: parsed.data.lines,
      expectedRevision: parsed.data.expectedRevision,
      actorUserId: session!.userId,
    });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
