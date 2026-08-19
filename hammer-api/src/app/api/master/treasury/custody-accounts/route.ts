import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { listCustodyAccountsWithBalance } from "@/modules/treasury/service";

/** Pantalla 4 (Confirmación) — cuentas de custodia con saldo: lo que está "en tránsito" esperando confirmarse. */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const branchId = new URL(request.url).searchParams.get("branchId");
    return ok(await listCustodyAccountsWithBalance(branchId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
