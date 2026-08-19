import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toApiErrorResponse } from "@/lib/api/errors";
import { fail } from "@/lib/api/response";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/master/reorder/batches/:id/convert — DEPRECADO.
 * Migrado a Reposición v2: el Plan reemplaza a los lotes de sugerencias.
 */
export async function POST(req: NextRequest, _ctx: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    return fail("GONE", "Migrado a Reposición v2 — usa /app/master/replenishment", 410);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}