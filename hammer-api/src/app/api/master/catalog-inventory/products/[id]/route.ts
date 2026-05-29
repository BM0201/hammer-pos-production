import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";
import { getCatalogInventoryProduct } from "@/modules/catalog-inventory/service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id } = await context.params;
    return ok(await getCatalogInventoryProduct(id));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
