import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getTreasuryPosition } from "@/modules/treasury/service";

/** Pantalla 6.1 — dónde está la plata ahora, agrupada por tipo de cuenta y moneda. */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const branchId = new URL(request.url).searchParams.get("branchId");
    return ok(await getTreasuryPosition(branchId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
