import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { calculateTimber, DEFAULT_PRICING, type TimberPricing } from "@/modules/timber/calculator";
import { getPricingConfig } from "@/modules/timber/service";
import { calculateTimberSchema } from "@/modules/timber/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { z } from "zod";
import { requireCsrf } from "@/modules/security/csrf";

/**
 * POST /api/timber/calculate
 * Calculate timber pricing without saving to DB.
 * Supports custom pricing overrides.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const body = await request.json();
    const parsed = calculateTimberSchema.parse(body);

    // Use stored pricing config, but allow overrides from request
    const storedPricing = await getPricingConfig();
    const pricing: TimberPricing = {
      costPerFoot: parsed.costPerFoot ?? storedPricing.costPerFoot,
      pricePerInchTabla: parsed.pricePerInchTabla ?? storedPricing.pricePerInchTabla,
      pricePerInchTablilla: parsed.pricePerInchTablilla ?? storedPricing.pricePerInchTablilla,
      pricePerInchCuadro: parsed.pricePerInchCuadro ?? storedPricing.pricePerInchCuadro,
    };

    const calc = calculateTimber(
      { thickness: parsed.thickness, width: parsed.width, length: parsed.length },
      pricing,
    );

    const quantity = parsed.quantity;
    const totalBoardFeet = calc.boardFeet * quantity;
    const totalBaseCost = calc.baseCost * quantity;
    const totalSellingPrice = calc.sellingPrice * quantity;
    const totalProfit = calc.profitPerPiece * quantity;

    return NextResponse.json({
      perPiece: calc,
      quantity,
      pricing,
      totals: {
        boardFeet: Math.round(totalBoardFeet * 10000) / 10000,
        baseCost: Math.round(totalBaseCost * 100) / 100,
        sellingPrice: Math.round(totalSellingPrice * 100) / 100,
        profit: Math.round(totalProfit * 100) / 100,
      },
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Validación fallida", details: err.errors }, { status: 422 });
    }
    return toHttpErrorResponse(err);
  }
}
