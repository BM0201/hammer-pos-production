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

    // For products in a stock group, the balance is stored on the CANONICAL product.
    // Look up group membership so we can resolve each product to its canonical.
    const members = await prisma.productStockGroupMember.findMany({
      where: { productId: { in: ids } },
      select: { productId: true, stockGroupId: true, conversionFactor: true },
    });

    // For each group found, look up the canonical member
    const groupIds = [...new Set(members.map((m) => m.stockGroupId))];
    const canonicals = groupIds.length > 0
      ? await prisma.productStockGroupMember.findMany({
          where: { stockGroupId: { in: groupIds }, isCanonical: true },
          select: { stockGroupId: true, productId: true },
        })
      : [];

    const canonicalByGroup = new Map(canonicals.map((c) => [c.stockGroupId, c.productId]));

    // Map each requested productId → { canonicalId, conversionFactor }
    const groupMap = new Map<string, { canonicalId: string; factor: number }>();
    for (const member of members) {
      const canonicalId = canonicalByGroup.get(member.stockGroupId);
      if (canonicalId) {
        groupMap.set(member.productId, {
          canonicalId,
          factor: Number(member.conversionFactor),
        });
      }
    }

    // Collect unique canonical (or own) product IDs to query
    const lookupIds = [...new Set(ids.map((id) => groupMap.get(id)?.canonicalId ?? id))];

    const rows = await prisma.inventoryBalance.groupBy({
      by: ["productId"],
      where: { productId: { in: lookupIds } },
      _sum: { quantityOnHand: true },
    });

    const data = ids.map((productId) => {
      const mapping = groupMap.get(productId);
      const lookupId = mapping?.canonicalId ?? productId;
      const factor = mapping?.factor ?? 1;
      const row = rows.find((r) => r.productId === lookupId);
      const baseQty = Number(row?._sum.quantityOnHand ?? 0);
      // Convert canonical base units → this product's own units
      const totalQty = factor > 1 ? baseQty / factor : baseQty;
      return { productId, totalQty };
    });

    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
