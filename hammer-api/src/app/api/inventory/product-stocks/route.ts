import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const ids = (searchParams.get("productIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) return ok([]);

    // For products in a stock group, the balance lives on the CANONICAL product.
    // Only consider active memberships in active groups to avoid stale data.
    const members = await prisma.productStockGroupMember.findMany({
      where: {
        productId: { in: ids },
        isActive: true,
        stockGroup: { isActive: true },
      },
      select: {
        productId: true,
        stockGroupId: true,
        conversionFactor: true,
        isPackagePresentation: true,
        stockGroup: {
          select: {
            tracksPackages: true,
            conversionFactorToBase: true,
          },
        },
      },
    });

    // For each group found, look up the canonical member (must also be active in an active group)
    const groupIds = [...new Set(members.map((m) => m.stockGroupId))];
    const canonicals =
      groupIds.length > 0
        ? await prisma.productStockGroupMember.findMany({
            where: {
              stockGroupId: { in: groupIds },
              isCanonical: true,
              isActive: true,
              stockGroup: { isActive: true },
            },
            select: { stockGroupId: true, productId: true },
          })
        : [];

    const canonicalByGroup = new Map(canonicals.map((c) => [c.stockGroupId, c.productId]));

    type GroupMapping = {
      canonicalId: string;
      factor: number;
      isPackagePresentation: boolean;
      stockGroupId: string;
      tracksPackages: boolean;
    };
    const groupMap = new Map<string, GroupMapping>();
    for (const member of members) {
      const canonicalId = canonicalByGroup.get(member.stockGroupId);
      if (canonicalId) {
        groupMap.set(member.productId, {
          canonicalId,
          factor: Number(member.conversionFactor),
          isPackagePresentation: member.isPackagePresentation,
          stockGroupId: member.stockGroupId,
          tracksPackages: member.stockGroup.tracksPackages,
        });
      }
    }

    const lookupIds = [...new Set(ids.map((id) => groupMap.get(id)?.canonicalId ?? id))];

    const rows = await prisma.inventoryBalance.groupBy({
      by: ["productId"],
      where: { productId: { in: lookupIds } },
      _sum: {
        quantityOnHand: true,
        closedPackageQuantity: true,
        looseUnitQuantity: true,
      },
    });

    const data = ids.map((productId) => {
      const mapping = groupMap.get(productId);
      const lookupId = mapping?.canonicalId ?? productId;
      const factor = mapping?.factor ?? 1;
      const row = rows.find((r) => r.productId === lookupId);
      const baseQty = Number(row?._sum.quantityOnHand ?? 0);
      const totalQty = factor > 1 ? baseQty / factor : baseQty;

      const base: Record<string, unknown> = { productId, totalQty };

      if (mapping?.tracksPackages) {
        base.baseQty = baseQty;
        base.saleQty = totalQty;
        base.closedPackageQuantity = Number(row?._sum.closedPackageQuantity ?? 0);
        base.looseUnitQuantity = Number(row?._sum.looseUnitQuantity ?? 0);
        base.isPackagePresentation = mapping.isPackagePresentation;
        base.stockGroupId = mapping.stockGroupId;
      }

      return base;
    });

    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
