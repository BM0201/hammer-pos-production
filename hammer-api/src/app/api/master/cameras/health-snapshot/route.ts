import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { prisma } from "@/lib/prisma";

/**
 * Contador del sidebar (prompt §4.2) — consume el snapshot ligero, nunca
 * el estado en vivo: se renderiza en cada carga de página. Mismo patrón
 * que ReplenishmentSignalSnapshot.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const branchId = new URL(request.url).searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es obligatorio.", 400);
    if (!hasBranchAccess(session, branchId)) return fail("FORBIDDEN", "Forbidden", 403);
    if (!canInBranch(session, branchId, CAPABILITIES.MASTER_CAMERAS_VIEW)) return fail("FORBIDDEN", "Forbidden", 403);

    const snapshot = await prisma.cameraHealthSnapshot.findUnique({ where: { branchId } });
    return ok({
      failingCount: snapshot?.failingCount ?? 0,
      unknownCount: snapshot?.unknownCount ?? 0,
      generatedAt: snapshot?.generatedAt ?? null,
    });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
