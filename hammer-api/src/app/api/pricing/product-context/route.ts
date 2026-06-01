import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getProductPricingContext } from "@/modules/pricing/service";

export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("productId");
    const branchId = searchParams.get("branchId");
    if (!productId || !branchId) {
      return fail("VALIDATION_ERROR", "productId y branchId son requeridos", 400);
    }

    return ok(await getProductPricingContext({ productId, branchId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
