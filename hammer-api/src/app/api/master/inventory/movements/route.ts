import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { parseListLimit } from "@/lib/api/list-limit";
import { inventoryMovementsQuerySchema } from "@/modules/catalog-inventory/validators";
import { listInventoryMovements } from "@/modules/catalog-inventory/inventory-list-service";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(request.url);
    const parsed = inventoryMovementsQuerySchema.safeParse({
      branchId: searchParams.get("branchId") ?? undefined,
      productId: searchParams.get("productId") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return fail("VALIDATION_ERROR", "Filtros invalidos.", 400);

    const limit = parseListLimit(searchParams.get("limit"), { default: 50, max: 100 });
    return ok(await listInventoryMovements({ ...parsed.data, limit }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
