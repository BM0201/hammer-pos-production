import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { listActiveBranchMembers } from "@/modules/treasury/service";

/**
 * Selector de personas para la declaración de destino del efectivo
 * (correccion-destino-y-pantalla-cobro.md §1: "entrega en persona" /
 * "quién lleva el depósito"). No existía ningún endpoint por sucursal para
 * esto — los que había eran todos Master-only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: branchId } = await params;
    const session = await getCurrentSession();
    assertAuthenticated(session);

    if (!hasBranchAccess(session, branchId)) return fail("FORBIDDEN", "Forbidden", 403);

    return ok(await listActiveBranchMembers(branchId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
