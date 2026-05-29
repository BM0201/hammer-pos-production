import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertProductionPermission } from "@/modules/auth/production-guard";
import { calculateCost } from "@/modules/production/service";
import { calculateCostSchema } from "@/modules/production/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, validationFail } from "@/lib/api/response";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    await assertProductionPermission(session, "production.cost.view");

    const parsed = calculateCostSchema.safeParse(await request.json());
    if (!parsed.success) {
      return validationFail(parsed.error.issues);
    }

    const result = await calculateCost(parsed.data);
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
