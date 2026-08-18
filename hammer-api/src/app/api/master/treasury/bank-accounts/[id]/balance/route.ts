import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getTreasuryAccountBalance } from "@/modules/treasury/service";

/** Saldo real de la cuenta (prompt-libro-mayor-tesoreria.md §2.3) = apertura + IN - OUT del libro mayor. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bankAccountId } = await params;
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    return ok(await getTreasuryAccountBalance(bankAccountId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
