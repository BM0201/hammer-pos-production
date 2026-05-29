import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { calculateSuggestedPriceForProduct } from "@/modules/pricing/service";
import { ok, fail } from "@/lib/api/response";

/**
 * GET /api/pricing/suggested?branchId=xxx&purchaseCostPerUnit=400&productId=xxx
 * Calculate suggested price for a product.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId");
    const purchaseCost = searchParams.get("purchaseCostPerUnit");
    const productId = searchParams.get("productId") || undefined;

    if (!branchId || !purchaseCost) {
      return fail("VALIDATION_ERROR", "branchId y purchaseCostPerUnit son requeridos", 400);
    }

    const cost = parseFloat(purchaseCost);
    if (isNaN(cost) || cost < 0) {
      return fail("VALIDATION_ERROR", "purchaseCostPerUnit debe ser un número >= 0", 400);
    }

    const result = await calculateSuggestedPriceForProduct({
      branchId,
      purchaseCostPerUnit: cost,
      productId,
      actorUserId: session.userId,
    });

    return ok({
      purchaseCost: Number(result.purchaseCost),
      operatingExpensePerUnit: Number(result.operatingExpensePerUnit),
      totalCostPerUnit: Number(result.totalCostPerUnit),
      marginPercent: Number(result.marginPercent),
      suggestedPrice: Number(result.suggestedPrice),
      totalMonthlyExpenses: Number(result.totalMonthlyExpenses),
      estimatedMonthlyUnits: Number(result.estimatedMonthlyUnits),
      configExists: result.configExists,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INVALID_")) {
      return fail("VALIDATION_ERROR", error.message, 400);
    }
    return toHttpErrorResponse(error);
  }
}
