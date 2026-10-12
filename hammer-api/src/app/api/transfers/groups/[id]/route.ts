import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";
import { getTransferGroup } from "@/modules/transfers/group-service";

/** GET /api/transfers/groups/[id] — matriz producto × destino con el estado de cada traslado. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { id } = await params;
    return ok(await getTransferGroup(id));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
