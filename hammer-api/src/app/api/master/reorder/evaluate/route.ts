import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { evaluateReorderNeeds } from "@/modules/reorder/service";
import { evaluateParamsSchema } from "@/modules/reorder/validators";

/** POST /api/master/reorder/evaluate — run reorder evaluation scan */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    const body = await req.json().catch(() => ({}));
    const params = evaluateParamsSchema.parse(body);
    const result = await evaluateReorderNeeds(params);

    return ok(result);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}