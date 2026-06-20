import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { updateReplenishmentDraftItem } from "@/modules/inventory/replenishment-draft-service";

const patchSchema = z.object({
  finalQuantity: z.number().min(0).nullable().optional(),
  status: z
    .enum([
      "PENDING_REVIEW",
      "APPROVED",
      "IGNORED",
      "QUANTITY_EDITED",
      "MANUAL_REVIEW_REQUIRED",
    ])
    .optional(),
  notes: z.string().max(500).optional(),
  recommendedSource: z
    .enum(["CENTRAL", "OTHER_BRANCH", "SUPPLIER", "PRODUCTION", "DO_NOT_REPLENISH", "MANUAL_REVIEW"])
    .optional(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ draftId: string; itemId: string }> }
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const { draftId, itemId } = await context.params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload inválido", 400);

    const updated = await updateReplenishmentDraftItem(draftId, itemId, parsed.data, session.userId);
    return ok(updated);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
