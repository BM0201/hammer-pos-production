import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { bootstrapCategoryPoliciesSchema } from "@/modules/pricing/validators";
import { createDefaultPoliciesForBranch } from "@/modules/pricing/category-policy-service";

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const parsed = bootstrapCategoryPoliciesSchema.safeParse(await req.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido", 400, parsed.error.flatten());
    return ok(await createDefaultPoliciesForBranch({ branchId: parsed.data.branchId, actorUserId: session.userId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
