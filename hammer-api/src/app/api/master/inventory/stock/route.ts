import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { inventoryStockQuerySchema } from "@/modules/catalog-inventory/validators";
import { getInventoryStockMatrix } from "@/modules/catalog-inventory/inventory-list-service";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(request.url);
    const parsed = inventoryStockQuerySchema.safeParse({
      branchIds: searchParams.get("branchIds") ?? undefined,
      categoryId: searchParams.get("categoryId") ?? undefined,
      q: searchParams.get("q") ?? undefined,
    });
    if (!parsed.success) return fail("VALIDATION_ERROR", "Falta branchIds.", 400);

    return ok(await getInventoryStockMatrix(parsed.data));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
