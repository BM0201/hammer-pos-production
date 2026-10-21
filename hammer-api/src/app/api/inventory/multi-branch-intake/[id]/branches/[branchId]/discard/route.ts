import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { discardMultiBranchIntakeBranch } from "@/modules/inventory/multi-branch-intake-service";

export const maxDuration = 60;

const discardSchema = z.object({
  reason: z.string().trim().min(1),
});

/**
 * POST /api/inventory/multi-branch-intake/[id]/branches/[branchId]/discard —
 * prompt-entrada-reintento-precio.md Commit 2 §3: marca una sucursal FAILED
 * como DISCARDED (solo si processedLines === 0 — si ya se aplicó algo, no
 * se puede descartar). Permisos: los mismos que crear una entrada
 * (INVENTORY_MOVEMENT_POST en esa sucursal).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; branchId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id, branchId } = await params;
    if (!canInBranch(session, branchId, CAPABILITIES.INVENTORY_MOVEMENT_POST)) {
      return fail("FORBIDDEN", "No tienes permiso para descartar el ingreso en esta sucursal.", 403);
    }

    const parsed = discardSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    await discardMultiBranchIntakeBranch({
      intakeId: id,
      branchId,
      reason: parsed.data.reason,
      actorUserId: session!.userId,
    });
    return ok({ discarded: true });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
