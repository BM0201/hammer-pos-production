import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { inventoryOverviewQuerySchema } from "@/modules/catalog-inventory/validators";
import { getInventoryDailyFlow } from "@/modules/catalog-inventory/inventory-list-service";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(request.url);
    const parsed = inventoryOverviewQuerySchema.safeParse({ branchId: searchParams.get("branchId") ?? undefined });
    // getInventoryDailyFlow todavía no tiene variante "toda la red" (el
    // doc no la pide para Commit 1) — branchId sigue siendo obligatorio
    // acá aunque el schema compartido ahora lo permita omitir.
    if (!parsed.success || !parsed.data.branchId) return fail("VALIDATION_ERROR", "Falta branchId.", 400);

    return ok(await getInventoryDailyFlow(parsed.data.branchId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
