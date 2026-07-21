import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { refreshReplenishmentSignalSnapshot } from "@/modules/inventory/replenishment-service";

const bodySchema = z.object({ branchId: z.string().cuid() });

/** POST /api/master/replenishment/refresh-signals — refresh manual del snapshot (Reposición v2, Fase 1.5) */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload inválido", 400);

    const summary = await refreshReplenishmentSignalSnapshot(parsed.data.branchId);
    return ok(summary);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
