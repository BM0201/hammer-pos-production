import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toApiErrorResponse } from "@/lib/api/errors";
import { fail } from "@/lib/api/response";

/**
 * POST /api/master/reorder/evaluate — DEPRECADO.
 * El Motor 1 (umbrales estáticos) fue migrado a Reposición v2.
 * Usa /app/master/replenishment — las señales se calculan en lectura, no hay "evaluar".
 */
export async function POST(req: NextRequest) {
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