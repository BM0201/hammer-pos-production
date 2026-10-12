import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";
import { resolveOrderTemplateForUse } from "@/modules/purchase-orders/order-template-service";

/** GET /api/master/order-templates/[id]/resolve — "Usar plantilla": esqueleto filtrado contra el catálogo vigente, nunca los costos guardados. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { id } = await params;
    return ok(await resolveOrderTemplateForUse(id));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
