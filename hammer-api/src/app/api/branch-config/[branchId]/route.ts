export const dynamic = "force-dynamic";

import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { getBranchModuleConfig } from "@/modules/branch-config/service";
import { assertBranchAccess } from "@/modules/security/rbac-helpers";
import { ok } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";

export async function GET(_req: Request, { params }: { params: Promise<{ branchId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const { branchId } = await params;

    assertBranchAccess(session, branchId);

    const config = await getBranchModuleConfig(branchId);
    return ok(config);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
