import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getTreasuryAccountLedger } from "@/modules/treasury/service";

/** Pantalla 6.3 — fecha · concepto · movimiento · saldo, con saldo corriente. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");
    const range = fromRaw || toRaw
      ? { from: fromRaw ? new Date(fromRaw) : undefined, to: toRaw ? new Date(toRaw) : undefined }
      : undefined;

    return ok(await getTreasuryAccountLedger(id, range));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
