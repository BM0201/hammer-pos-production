import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { openStockPackage } from "@/modules/inventory/service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      branchId?: string;
      packageProductId?: string | null;
      actualUnits?: number | null;
      reason?: string | null;
    };

    if (!body.branchId) {
      throw new Error("VALIDATION_ERROR: branchId es obligatorio.");
    }

    return ok(await openStockPackage({
      actorUserId: session.userId,
      branchId: body.branchId,
      stockGroupId: id,
      packageProductId: body.packageProductId ?? null,
      actualUnits: body.actualUnits ?? null,
      reason: body.reason ?? null,
    }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
