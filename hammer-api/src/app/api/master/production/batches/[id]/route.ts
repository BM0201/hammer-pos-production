import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertProductionPermission } from "@/modules/auth/production-guard";
import { getBatchById, updateBatch } from "@/modules/production/service";
import { updateBatchSchema } from "@/modules/production/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, validationFail } from "@/lib/api/response";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await assertProductionPermission(session, "production.batches.view");

    const { id } = await context.params;
    const batch = await getBatchById(id);
    return ok(batch);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    await assertProductionPermission(session, "production.batches.create");

    const { id } = await context.params;
    const parsed = updateBatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return validationFail(parsed.error.issues);
    }

    const batch = await updateBatch(id, { ...parsed.data, actorUserId: session.userId });
    return ok(batch);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
