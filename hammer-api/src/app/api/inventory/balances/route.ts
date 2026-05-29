import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertBranchAccess } from "@/modules/auth/access";
import { listInventoryBalances } from "@/modules/inventory/service";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    const productId = searchParams.get("productId") ?? undefined;

    if (!branchId) {
      return fail("VALIDATION_ERROR", "branchId is required", 400);
    }

    assertBranchAccess(session, branchId);
    const data = await listInventoryBalances({ branchId, productId });
    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
