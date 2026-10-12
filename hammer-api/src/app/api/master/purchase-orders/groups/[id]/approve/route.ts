import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";
import { approvePurchaseOrderGroup } from "@/modules/purchase-orders/group-service";

/** POST /api/master/purchase-orders/groups/[id]/approve — aprueba cada orden DRAFT, una transacción por orden. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await params;
    return ok(await approvePurchaseOrderGroup(id, session!.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
