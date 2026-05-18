import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { receiveTransfer } from "@/modules/transfers/service";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await params;
    const result = await receiveTransfer(id, session.userId);
    return ok(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
