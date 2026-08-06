import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertProductionPermission } from "@/modules/auth/production-guard";
import { getBatches, createBatch } from "@/modules/production/service";
import { createBatchSchema } from "@/modules/production/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, validationFail } from "@/lib/api/response";
import type { ProductionBatchStatus } from "@prisma/client";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await assertProductionPermission(session, "production.batches.view");

    const url = new URL(request.url);
    const status = url.searchParams.get("status") as ProductionBatchStatus | null;
    const branchId = url.searchParams.get("branchId") ?? undefined;
    const recipeId = url.searchParams.get("recipeId") ?? undefined;
    const limit = url.searchParams.get("limit");

    const batches = await getBatches({
      status: status ?? undefined,
      branchId,
      recipeId,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return ok(batches);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    await assertProductionPermission(session, "production.batches.create");

    const parsed = createBatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return validationFail(parsed.error.issues);
    }

    const batch = await createBatch({ ...parsed.data, actorUserId: session.userId });
    return created(batch);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
