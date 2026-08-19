import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { addManualItemToPlan } from "@/modules/inventory/replenishment-draft-service";

const bodySchema = z.object({
  branchId: z.string().cuid(),
  productId: z.string().cuid(),
  quantity: z.number().positive(),
  source: z.enum(["TRANSFER", "PRODUCTION", "PURCHASE"]),
  sourceBranchId: z.string().cuid().optional(),
  supplierId: z.string().cuid().optional(),
});

/** POST /api/master/replenishment/drafts/add-manual-item — agrega un producto al plan a mano (Reposición v2, Fase 1.4) */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload inválido", 400);

    const draft = await addManualItemToPlan({ ...parsed.data, actorUserId: session.userId });
    return ok(draft, 201);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
