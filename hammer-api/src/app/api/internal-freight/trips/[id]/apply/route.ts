import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { applyInternalFreightTrip } from "@/modules/internal-freight/service";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const { id } = await params;
    return ok(await applyInternalFreightTrip(id, session.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
