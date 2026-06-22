import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertMaster } from "@/modules/security/rbac-helpers";
import { executeAutoClosureForAllBranches } from "@/modules/cash-closure/service";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";

// POST: Manually trigger auto-closure (MASTER/SYSTEM_ADMIN only)
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    assertMaster(session);

    const results = await executeAutoClosureForAllBranches();
    return ok(results);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
