import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { inventoryOverviewQuerySchema } from "@/modules/catalog-inventory/validators";
import { getInventoryNavCounts } from "@/modules/catalog-inventory/inventory-list-service";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(request.url);
    const parsed = inventoryOverviewQuerySchema.safeParse({ branchId: searchParams.get("branchId") ?? undefined });
    if (!parsed.success) return fail("VALIDATION_ERROR", "branchId invalido.", 400);

    return ok(await getInventoryNavCounts(parsed.data.branchId ?? null));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
