import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getTreasuryEntriesByAccount } from "@/modules/treasury/cash-monitor";

/**
 * §5 del doc — entradas por cuenta en un rango, desglosadas por entryType:
 * no es lo mismo que entren depósitos de sucursal que transferencias de
 * clientes, son dos flujos distintos.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");
    if (!fromRaw || !toRaw) return fail("VALIDATION_ERROR", "from y to son obligatorios.", 400);
    const branchId = url.searchParams.get("branchId");

    return ok(await getTreasuryEntriesByAccount({ from: new Date(fromRaw), to: new Date(toRaw), branchId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
