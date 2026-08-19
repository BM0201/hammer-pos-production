import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { getUserProductionPermissions } from "@/modules/auth/production-guard";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";

/**
 * GET /api/master/production/permissions
 * Returns the current user's effective production permissions.
 * Used by frontend to conditionally show/hide UI elements.
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const permissions = await getUserProductionPermissions(session);
    return ok(permissions);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
