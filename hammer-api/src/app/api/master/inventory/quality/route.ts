import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";
import { getInventoryQualityCounts } from "@/modules/catalog-inventory/inventory-list-service";

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    return ok(await getInventoryQualityCounts());
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
