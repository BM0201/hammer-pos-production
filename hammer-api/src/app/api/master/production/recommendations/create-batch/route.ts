import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertProductionPermission } from "@/modules/auth/production-guard";
import { createProductionDraftFromRecommendation } from "@/modules/production/production-recommendation-service";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { created, validationFail } from "@/lib/api/response";

const createRecommendedBatchSchema = z.object({
  branchId: z.string().cuid(),
  recipeId: z.string().cuid(),
  suggestedBatches: z.number().positive(),
  targetProductId: z.string().cuid(),
  notes: z.string().max(1000).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    await assertProductionPermission(session, "production.batches.create");

    const parsed = createRecommendedBatchSchema.safeParse(await request.json());
    if (!parsed.success) return validationFail(parsed.error.issues);

    const batch = await createProductionDraftFromRecommendation({
      ...parsed.data,
      actorUserId: session.userId,
    });
    return created(batch);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
