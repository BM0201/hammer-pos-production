export const dynamic = "force-dynamic";

import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertOwner } from "@/modules/security/rbac-helpers";
import { listBranchModuleConfigs, upsertBranchModuleConfig, bulkUpdateBranchModuleConfigs } from "@/modules/branch-config/service";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, validationFail } from "@/lib/api/response";
import { toApiErrorResponse, parseJsonBody } from "@/lib/api/errors";

const singleUpdateSchema = z.object({
  branchId: z.string().cuid(),
  enableCashier: z.boolean(),
  enableDispatch: z.boolean(),
});

const bulkUpdateSchema = z.object({
  branchIds: z.array(z.string().cuid()).min(1),
  enableCashier: z.boolean(),
  enableDispatch: z.boolean(),
});

const updateSchema = z.union([bulkUpdateSchema, singleUpdateSchema]);

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertOwner(session);
    const configs = await listBranchModuleConfigs();
    return ok(configs);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertOwner(session);

    const body = await request.json();

    // Bulk update
    if (Array.isArray(body?.branchIds)) {
      const parsed = bulkUpdateSchema.safeParse(body);
      if (!parsed.success) return validationFail(parsed.error.flatten());
      const results = await bulkUpdateBranchModuleConfigs({
        branchIds: parsed.data.branchIds,
        enableCashier: parsed.data.enableCashier,
        enableDispatch: parsed.data.enableDispatch,
        actorUserId: session.userId,
      });
      return ok({ updated: results.length });
    }

    // Single update
    const parsed = singleUpdateSchema.safeParse(body);
    if (!parsed.success) return validationFail(parsed.error.flatten());
    const result = await upsertBranchModuleConfig({
      branchId: parsed.data.branchId,
      enableCashier: parsed.data.enableCashier,
      enableDispatch: parsed.data.enableDispatch,
      actorUserId: session.userId,
    });
    return ok(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
