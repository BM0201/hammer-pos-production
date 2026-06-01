import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { listBranchCategoryPricingPolicies, upsertCategoryPricingPolicy } from "@/modules/pricing/category-policy-service";
import { upsertCategoryPricingPolicySchema } from "@/modules/pricing/validators";

export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const branchId = new URL(req.url).searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es requerido", 400);
    return ok(await listBranchCategoryPricingPolicies({ branchId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const parsed = upsertCategoryPricingPolicySchema.safeParse(await req.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido", 400, parsed.error.flatten());
    return ok(await upsertCategoryPricingPolicy(parsed.data, session.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
