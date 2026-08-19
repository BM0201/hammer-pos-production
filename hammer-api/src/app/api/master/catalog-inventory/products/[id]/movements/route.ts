import { InventoryMovementType } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { listInventoryMovementsPaginated } from "@/modules/inventory/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const movementType = searchParams.get("movementType") as InventoryMovementType | null;
    if (movementType && !Object.values(InventoryMovementType).includes(movementType)) {
      return fail("VALIDATION_ERROR", "Invalid movementType", 400);
    }

    return ok(await listInventoryMovementsPaginated({
      productId: id,
      branchId: searchParams.get("branchId") ?? undefined,
      movementType: movementType ?? undefined,
      page: Number(searchParams.get("page") ?? 1),
      limit: Number(searchParams.get("limit") ?? 30),
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
