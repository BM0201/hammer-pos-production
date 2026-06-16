import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { buildPurchaseDraftFromRecommendations } from "@/modules/inventory/replenishment-service";

const schema = z.object({
  branchId: z.string().min(1),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().positive(),
    supplierId: z.string().optional(),
  })).min(1),
  notes: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido", 400, parsed.error.flatten());
    return ok(await buildPurchaseDraftFromRecommendations({ ...parsed.data, actorUserId: session.userId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
