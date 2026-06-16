import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { calculatePricingSuggestionForBranch, calculateSuggestedPriceForProduct } from "@/modules/pricing/service";
import { pricingSuggestionPayloadSchema } from "@/modules/pricing/validators";
import { requireCsrf } from "@/modules/security/csrf";
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

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(req, session);

    const parsed = pricingSuggestionPayloadSchema.safeParse(await req.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Payload invalido", 400, parsed.error.flatten());
    }

    const body = parsed.data;
    const result = await calculatePricingSuggestionForBranch({
      branchId: body.branchId,
      productId: body.productId,
      actorUserId: session.userId,
      mode: body.mode,
      baseCost: body.baseCost ?? body.purchaseCostPerUnit ?? 0,
      taxPercent: body.taxPercent,
      includeTaxInCost: body.includeTaxInCost,
      purchaseFreightPerUnit: body.purchaseFreightPerUnit,
      otherCostPerUnit: body.otherCostPerUnit,
      shrinkagePercent: body.shrinkagePercent,
      monthlyOperatingExpenses: body.monthlyOperatingExpenses ?? body.totalMonthlyExpenses,
      estimatedMonthlyUnits: body.estimatedMonthlyUnits,
      expenseAllocationScope: body.expenseAllocationScope,
      manualOperatingExpensePerUnit: body.manualOperatingExpensePerUnit,
      branchMonthlyUnits: body.branchMonthlyUnits,
      categoryMonthlyUnits: body.categoryMonthlyUnits,
      productMonthlyUnits: body.productMonthlyUnits,
      expenseScopeLabel: body.expenseScopeLabel,
      prorateMethod: body.prorateMethod ?? body.prorationMethod,
      estimatedMonthlySalesValue: body.estimatedMonthlySalesValue,
      productMonthlySalesValue: body.productMonthlySalesValue,
      estimatedMonthlyUnitsForThisProduct: body.estimatedMonthlyUnitsForThisProduct,
      marginPercent: body.marginPercent ?? body.desiredMarginPercent ?? 30,
      minProfitAmount: body.minProfitAmount,
      marketMinPrice: body.marketMinPrice,
      marketMaxPrice: body.marketMaxPrice,
      roundingRule: body.roundingRule,
      useCategoryPolicy: body.useCategoryPolicy,
      forcePolicyValues: body.forcePolicyValues,
      useCommercialIntelligence: body.useCommercialIntelligence,
      forceCommercialValues: body.forceCommercialValues,
    });

    return ok(result);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INVALID_")) {
      return fail("VALIDATION_ERROR", error.message, 400);
    }
    return toHttpErrorResponse(error);
  }
}
