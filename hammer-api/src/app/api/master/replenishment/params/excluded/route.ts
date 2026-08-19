import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { setReplenishmentExcluded } from "@/modules/inventory/replenishment-params-service";

const bodySchema = z.object({
  branchId: z.string().cuid(),
  productId: z.string().cuid(),
  excluded: z.boolean(),
});

/** POST /api/master/replenishment/params/excluded — activa/desactiva modo Excluido (Reposición v2) */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload inválido", 400);

    return ok(await setReplenishmentExcluded({ ...parsed.data, actorUserId: session.userId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
