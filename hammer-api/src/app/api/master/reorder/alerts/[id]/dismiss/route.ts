import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { dismissAlert } from "@/modules/reorder/service";

type Params = { params: Promise<{ id: string }> };

/** POST /api/master/reorder/alerts/:id/dismiss — dismiss an open alert */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    const { id } = await params;
    const alert = await dismissAlert(id, session!.userId);

    return ok(alert);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}