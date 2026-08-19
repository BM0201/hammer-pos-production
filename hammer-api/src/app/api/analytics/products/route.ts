import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { calculateDynamicPrice } from "@/modules/analytics/dynamic-pricing";
import { ok } from "@/lib/api/response";

/** GET /api/analytics/products — list products with analytics */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const url = new URL(req.url);
    const abcClass = url.searchParams.get("abcClass") ?? undefined;
    const xyzClass = url.searchParams.get("xyzClass") ?? undefined;
    const branchId = url.searchParams.get("branchId") ?? undefined;
    const withPricing = url.searchParams.get("withPricing") === "true";
    const takeParam = parseInt(url.searchParams.get("take") ?? "50", 10);
    const take = Number.isFinite(takeParam) ? Math.min(Math.max(takeParam, 1), 200) : 50;

    const where: any = { isActive: true };
    if (abcClass) where.abcClassification = abcClass;
    if (xyzClass) where.xyzClassification = xyzClass;

    const products = await prisma.product.findMany({
      where,
      select: {
        id: true,
        sku: true,
        name: true,
        standardSalePrice: true,
        abcClassification: true,
        xyzClassification: true,
        rotationIndex: true,
        averageDailySales: true,
        daysInStock: true,
        suggestedMargin: true,
        lastClassificationAt: true,
        category: { select: { name: true } },
      },
      take,
      orderBy: [{ abcClassification: "asc" }, { name: "asc" }],
    });

    // Optionally include dynamic pricing (fetched in parallel instead of sequentially)
    const enriched = products.map((p) => ({ ...p, dynamicPrice: null as any }));
    if (withPricing) {
      const prices = await Promise.all(
        enriched.map((p) => calculateDynamicPrice(p.id, branchId).catch(() => null)),
      );
      prices.forEach((price, i) => { enriched[i].dynamicPrice = price; });
    }

    return ok(enriched);
  } catch (err: any) {
    return toHttpErrorResponse(err);
  }
}
