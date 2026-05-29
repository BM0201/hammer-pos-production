import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toApiErrorResponse } from "@/lib/api/errors";
import { created } from "@/lib/api/response";
import { convertAlertToTransfer } from "@/modules/reorder/service";

type Params = { params: Promise<{ id: string }> };

/** POST /api/master/reorder/alerts/:id/convert-transfer — convert alert to Transfer */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    const { id } = await params;
    const result = await convertAlertToTransfer(id, session!.userId);

    return created(result);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}