import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { bootstrapIronStockGroups } from "@/modules/catalog/stock-groups";

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const payload = await req.json().catch(() => ({}));
    const apply = payload?.apply === true;
    if (payload?.apply !== undefined && typeof payload.apply !== "boolean") {
      return fail("VALIDATION_ERROR", "apply debe ser boolean.", 400);
    }

    return ok(await bootstrapIronStockGroups({ actorUserId: session.userId, apply }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
