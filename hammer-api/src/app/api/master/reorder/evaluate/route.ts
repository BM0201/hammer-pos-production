import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
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

    return NextResponse.json({ data: result });
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
