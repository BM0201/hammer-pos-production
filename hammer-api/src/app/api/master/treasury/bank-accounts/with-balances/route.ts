import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { listBankAccountsWithBalances } from "@/modules/treasury/service";

/**
 * Panel de Bancos (§5) — saldo esperado por cuenta. Separado del GET
 * general de /bank-accounts (ese lo usa cualquiera para el selector de
 * transferencia en el cobro; los saldos son información financiera,
 * Master-only).
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const branchId = new URL(request.url).searchParams.get("branchId");
    return ok(await listBankAccountsWithBalances(branchId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
