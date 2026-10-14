import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { getMultiBranchIntake, continueMultiBranchIntake } from "@/modules/inventory/multi-branch-intake-service";

export const maxDuration = 60;

/**
 * Fase 1 (prompt-entrada-inventario.md) — POST
 * /api/inventory/multi-branch-intake/[id]/continue: retoma las sucursales
 * PENDING/IN_PROGRESS (el presupuesto de tiempo se agotó antes de
 * terminarlas) desde donde quedaron — nunca reprocesa una tanda ya
 * confirmada. Distinto de /retry (ese es para sucursales que YA
 * terminaron en FAILED).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const intake = await getMultiBranchIntake(id);
    const deniedBranches = intake.branches.filter((b) => (b.status === "PENDING" || b.status === "IN_PROGRESS") && !canInBranch(session, b.branchId, CAPABILITIES.INVENTORY_MOVEMENT_POST));
    if (deniedBranches.length > 0) {
      return fail("FORBIDDEN", `No tienes permiso para continuar en: ${deniedBranches.map((b) => b.branch.name).join(", ")}.`, 403);
    }

    return ok(await continueMultiBranchIntake(id, session!.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
