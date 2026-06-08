import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { prisma } from "@/lib/prisma";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";

type SuggestionResult = {
  suggestedAbcClassification: "A" | "B" | "C" | null;
  suggestedXyzClassification: "X" | "Y" | "Z" | null;
  suggestionStatus: "READY" | "INSUFFICIENT_DATA";
  suggestionReason: string | null;
};

function calculateAbcFromShare(share: number) {
  if (share <= 0.8) return "A";
  if (share <= 0.95) return "B";
  return "C";
}

function calculateXyzFromCv(cv: number) {
  if (cv < 0.5) return "X";
  if (cv < 1) return "Y";
  return "Z";
}

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const now = new Date();
    const endDate = new Date(now.getTime());
    const startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const products = await prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        sku: true,
        name: true,
        categoryId: true,
        category: { select: { name: true } },
        unit: true,
        standardSalePrice: true,
        abcClassification: true,
        xyzClassification: true,
        rotationIndex: true,
        averageDailySales: true,
        daysInStock: true,
        suggestedMargin: true,
        lastClassificationAt: true,
      },
      orderBy: { name: "asc" },
    });

    const salesValueByProduct = await prisma.saleOrderLine.groupBy({
      by: ["productId"],
      _sum: {
        lineSubtotal: true,
      },
      _count: {
        _all: true,
      },
      where: {
        saleOrder: {
          status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
          createdAt: { gte: startDate, lte: endDate },
        },
      },
    });

    const movementRows = await prisma.inventoryMovement.findMany({
      where: {
        movementType: "SALE_OUT",
        createdAt: { gte: startDate, lte: endDate },
      },
      select: {
        productId: true,
        quantity: true,
        createdAt: true,
      },
    });

    const totalSalesValue = salesValueByProduct.reduce(
      (sum, row) => sum + Number(row._sum?.lineSubtotal ?? 0),
      0,
    );

    const sortedSales = salesValueByProduct
      .map((row) => ({
        productId: row.productId,
        totalValue: Number(row._sum?.lineSubtotal ?? 0),
        totalLines: typeof row._count === "object" ? (row._count._all ?? 0) : 0,
      }))
      .sort((a, b) => b.totalValue - a.totalValue);

    let cumulativeSalesValue = 0;
    const abcSuggestionByProduct = new Map<
      string,
      { suggestedAbcClassification: "A" | "B" | "C"; totalLines: number }
    >();
    for (const row of sortedSales) {
      cumulativeSalesValue += row.totalValue;
      const share = totalSalesValue > 0 ? cumulativeSalesValue / totalSalesValue : 0;
      abcSuggestionByProduct.set(row.productId, {
        suggestedAbcClassification: calculateAbcFromShare(share),
        totalLines: row.totalLines,
      });
    }

    const dailySalesByProduct = new Map<string, Map<string, number>>();
    for (const row of movementRows) {
      const dateKey = row.createdAt.toISOString().slice(0, 10);
      if (!dailySalesByProduct.has(row.productId)) {
        dailySalesByProduct.set(row.productId, new Map());
      }
      const productDaily = dailySalesByProduct.get(row.productId)!;
      productDaily.set(dateKey, (productDaily.get(dateKey) ?? 0) + Number(row.quantity));
    }

    const xyzSuggestionByProduct = new Map<
      string,
      { suggestedXyzClassification: "X" | "Y" | "Z"; sampleDays: number }
    >();
    for (const [productId, valuesMap] of dailySalesByProduct) {
      const values = Array.from(valuesMap.values());
      if (values.length < 7) continue;
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      if (mean <= 0) continue;
      const variance =
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
      const stddev = Math.sqrt(variance);
      const cv = stddev / mean;

      xyzSuggestionByProduct.set(productId, {
        suggestedXyzClassification: calculateXyzFromCv(cv),
        sampleDays: values.length,
      });
    }

    const withSuggestions = products.map((product) => {
      const abcSuggestion = abcSuggestionByProduct.get(product.id);
      const xyzSuggestion = xyzSuggestionByProduct.get(product.id);

      const reasons: string[] = [];
      if (!abcSuggestion) reasons.push("ventas de 90 días insuficientes para ABC");
      if (abcSuggestion && abcSuggestion.totalLines < 3) {
        reasons.push("pocas líneas de venta para ABC");
      }
      if (!xyzSuggestion) reasons.push("menos de 7 días con demanda para XYZ");

      const suggestion: SuggestionResult =
        abcSuggestion && xyzSuggestion && abcSuggestion.totalLines >= 3
          ? {
              suggestedAbcClassification: abcSuggestion.suggestedAbcClassification,
              suggestedXyzClassification: xyzSuggestion.suggestedXyzClassification,
              suggestionStatus: "READY",
              suggestionReason: null,
            }
          : {
              suggestedAbcClassification:
                abcSuggestion && abcSuggestion.totalLines >= 3
                  ? abcSuggestion.suggestedAbcClassification
                  : null,
              suggestedXyzClassification: xyzSuggestion
                ? xyzSuggestion.suggestedXyzClassification
                : null,
              suggestionStatus: "INSUFFICIENT_DATA",
              suggestionReason: reasons.join("; ") || "historial insuficiente",
            };

      const hasApplied = Boolean(product.abcClassification && product.xyzClassification);
      const hasSuggestion = Boolean(
        suggestion.suggestedAbcClassification && suggestion.suggestedXyzClassification,
      );
      const isManualOverride =
        hasApplied &&
        hasSuggestion &&
        (product.abcClassification !== suggestion.suggestedAbcClassification ||
          product.xyzClassification !== suggestion.suggestedXyzClassification);

      return {
        ...product,
        ...suggestion,
        isManualOverride,
      };
    });

    // Calculate summary stats
    const stats = {
      total: withSuggestions.length,
      classified: withSuggestions.filter(p => p.abcClassification && p.xyzClassification).length,
      unclassified: withSuggestions.filter(p => !p.abcClassification || !p.xyzClassification).length,
      byAbc: {
        A: withSuggestions.filter(p => p.abcClassification === "A").length,
        B: withSuggestions.filter(p => p.abcClassification === "B").length,
        C: withSuggestions.filter(p => p.abcClassification === "C").length,
      },
      byXyz: {
        X: withSuggestions.filter(p => p.xyzClassification === "X").length,
        Y: withSuggestions.filter(p => p.xyzClassification === "Y").length,
        Z: withSuggestions.filter(p => p.xyzClassification === "Z").length,
      },
    };

    return ok({ products: withSuggestions, stats });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
