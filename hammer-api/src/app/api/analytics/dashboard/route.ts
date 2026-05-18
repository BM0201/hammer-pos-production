import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

/** GET /api/analytics/dashboard — analytics dashboard data */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    // ABC Distribution
    const abcDistribution = {
      A: await prisma.product.count({ where: { isActive: true, abcClassification: "A" } }),
      B: await prisma.product.count({ where: { isActive: true, abcClassification: "B" } }),
      C: await prisma.product.count({ where: { isActive: true, abcClassification: "C" } }),
      unclassified: await prisma.product.count({ where: { isActive: true, abcClassification: null } }),
    };

    // XYZ Distribution
    const xyzDistribution = {
      X: await prisma.product.count({ where: { isActive: true, xyzClassification: "X" } }),
      Y: await prisma.product.count({ where: { isActive: true, xyzClassification: "Y" } }),
      Z: await prisma.product.count({ where: { isActive: true, xyzClassification: "Z" } }),
      unclassified: await prisma.product.count({ where: { isActive: true, xyzClassification: null } }),
    };

    // Average rotation by class
    const avgRotationByClass: Record<string, number> = {};
    for (const cls of ["A", "B", "C"]) {
      const agg = await prisma.product.aggregate({
        _avg: { rotationIndex: true },
        where: { isActive: true, abcClassification: cls },
      });
      avgRotationByClass[cls] = Number(agg._avg.rotationIndex ?? 0);
    }

    // Low rotation products (top 10 by lowest rotation with some stock)
    const lowRotationProducts = await prisma.product.findMany({
      where: { isActive: true, rotationIndex: { not: null } },
      select: {
        id: true, sku: true, name: true,
        abcClassification: true, xyzClassification: true,
        rotationIndex: true, daysInStock: true, suggestedMargin: true,
      },
      orderBy: { rotationIndex: "asc" },
      take: 10,
    });

    // High value products (Class A sorted by sale price)
    const highValueProducts = await prisma.product.findMany({
      where: { isActive: true, abcClassification: "A" },
      select: {
        id: true, sku: true, name: true,
        standardSalePrice: true, rotationIndex: true,
        abcClassification: true, xyzClassification: true,
      },
      orderBy: { standardSalePrice: "desc" },
      take: 10,
    });

    // Products with high days in stock (>60 days)
    const staleProducts = await prisma.product.findMany({
      where: { isActive: true, daysInStock: { gt: 60 } },
      select: {
        id: true, sku: true, name: true,
        daysInStock: true, abcClassification: true,
        suggestedMargin: true,
      },
      orderBy: { daysInStock: "desc" },
      take: 10,
    });

    // Generate recommendations
    const recommendations: string[] = [];
    if (staleProducts.length > 0) {
      recommendations.push(`${staleProducts.length} productos con m\u00e1s de 60 d\u00edas en stock. Considere aplicar descuentos.`);
    }
    if (abcDistribution.unclassified > 0) {
      recommendations.push(`${abcDistribution.unclassified} productos sin clasificar. Ejecute la clasificaci\u00f3n ABC-XYZ.`);
    }
    const classC = await prisma.product.count({ where: { isActive: true, abcClassification: "C", daysInStock: { gt: 90 } } });
    if (classC > 0) {
      recommendations.push(`${classC} productos clase C con +90 d\u00edas en stock \u2014 candidatos a liquidaci\u00f3n.`);
    }

    return NextResponse.json({
      data: {
        abcDistribution,
        xyzDistribution,
        avgRotationByClass,
        lowRotationProducts,
        highValueProducts,
        staleProducts,
        recommendations,
      },
    });
  } catch (err: any) {
    return toHttpErrorResponse(err);
  }
}
