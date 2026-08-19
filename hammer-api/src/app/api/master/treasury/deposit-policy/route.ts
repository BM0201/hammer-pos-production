import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { setBranchDepositPolicySchema } from "@/modules/treasury/validators";
import { setBranchDepositPolicy, listBranchDepositPolicies } from "@/modules/treasury/cash-monitor";

/** Umbral y días máximos por sucursal — sin esto, el indicador no calcula estado ni proyección para ella. */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    return ok(await listBranchDepositPolicies());
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es obligatorio.", 400);

    const parsed = setBranchDepositPolicySchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const policy = await setBranchDepositPolicy({ branchId, ...parsed.data, actorUserId: session.userId });
    return ok(policy);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
