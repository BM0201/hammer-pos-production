import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { getMultiBranchIntake, retryMultiBranchIntake } from "@/modules/inventory/multi-branch-intake-service";

export const maxDuration = 60;

/** POST /api/inventory/multi-branch-intake/[id]/retry — reprocesa SOLO las sucursales FAILED. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const intake = await getMultiBranchIntake(id);
    const deniedBranches = intake.branches.filter((b) => b.status === "FAILED" && !canInBranch(session, b.branchId, CAPABILITIES.INVENTORY_MOVEMENT_POST));
    if (deniedBranches.length > 0) {
      return fail("FORBIDDEN", `No tienes permiso para reintentar en: ${deniedBranches.map((b) => b.branch.name).join(", ")}.`, 403);
    }

    return ok(await retryMultiBranchIntake(id, session!.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
