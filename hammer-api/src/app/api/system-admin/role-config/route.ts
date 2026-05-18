import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertSystemAdmin } from "@/modules/auth/access";
import { listBranchRoleConfigs, updateBranchRoleConfig } from "@/modules/system-admin/service";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";

const VALID_BRANCH_ROLES = ["BRANCH_ADMIN", "SALES", "CASHIER", "WAREHOUSE"] as const;

const updateRoleConfigSchema = z.object({
  branchId: z.string().cuid(),
  role: z.enum(VALID_BRANCH_ROLES),
  enabled: z.boolean(),
});

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertSystemAdmin(session);
    const data = await listBranchRoleConfigs();
    return ok(data);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertSystemAdmin(session);

    const parsed = updateRoleConfigSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return validationFail(parsed.error.flatten());
    }

    const data = await updateBranchRoleConfig({
      branchId: parsed.data.branchId,
      role: parsed.data.role,
      enabled: parsed.data.enabled,
      actorUserId: session.userId,
    });
    return ok(data);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
