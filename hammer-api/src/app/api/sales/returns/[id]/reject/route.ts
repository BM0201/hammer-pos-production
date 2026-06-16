import { ok, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { requireCsrf } from "@/modules/security/csrf";
import { rejectSaleReturn } from "@/modules/sales-returns/service";
import { rejectSaleReturnSchema } from "@/modules/sales-returns/validators";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);
    const parsed = rejectSaleReturnSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationFail(parsed.error.flatten());
    const { id } = await context.params;
    return ok(await rejectSaleReturn(id, parsed.data.reason, {
      userId: session.userId,
      roleCode: session.roleCode,
      globalRoles: session.globalRoles as string[],
    }));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
