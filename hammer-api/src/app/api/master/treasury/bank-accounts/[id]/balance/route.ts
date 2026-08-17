import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getBankAccountExpectedBalance } from "@/modules/treasury/service";

/** Saldo esperado (§2.2) = depósitos confirmados + transferencias recibidas a esa cuenta. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bankAccountId } = await params;
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    return ok(await getBankAccountExpectedBalance(bankAccountId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
