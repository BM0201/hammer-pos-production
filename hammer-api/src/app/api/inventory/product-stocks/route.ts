import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

/** Pluralización simple ES: vocal final → +S, consonante → +ES. */
function pluralize(unit: string, qty: number): string {
  const u = (unit ?? "").trim();
  if (!u || qty === 1) return u;
  return /[AEIOUaeiou]$/.test(u) ? `${u}S` : `${u}ES`;
}

function fmt(n: number): string {
  return String(Number(n.toFixed(4)));
}

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
        saleUnit: true,
        isCanonical: true,
        isPackagePresentation: true,
        stockGroup: {
          select: {
            tracksPackages: true,
            conversionFactorToBase: true,
            baseUnit: true,
            packageUnit: true,
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
      isCanonical: boolean;
      stockGroupId: string;
      tracksPackages: boolean;
      baseUnit: string;
      saleUnit: string;
      packageUnit: string | null;
    };
    const groupMap = new Map<string, GroupMapping>();
    for (const member of members) {
      const canonicalId = canonicalByGroup.get(member.stockGroupId);
      if (canonicalId) {
        groupMap.set(member.productId, {
          canonicalId,
          factor: Number(member.conversionFactor),
          isPackagePresentation: member.isPackagePresentation,
          isCanonical: member.isCanonical,
          stockGroupId: member.stockGroupId,
          tracksPackages: member.stockGroup.tracksPackages,
          baseUnit: member.stockGroup.baseUnit,
          saleUnit: member.saleUnit,
          packageUnit: member.stockGroup.packageUnit,
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
      const saleQty = factor > 1 ? baseQty / factor : baseQty;

      // `totalQty` se mantiene por compatibilidad con consumidores existentes.
      const base: Record<string, unknown> = { productId, totalQty: saleQty };

      if (mapping) {
        const baseUnit = mapping.baseUnit;
        const saleUnit = mapping.saleUnit;
        base.canonicalProductId = mapping.canonicalId;
        base.stockGroupId = mapping.stockGroupId;
        base.baseQty = baseQty;
        base.saleQty = saleQty;
        base.baseUnit = baseUnit;
        base.saleUnit = saleUnit;
        base.conversionFactor = factor;
        base.isCanonical = mapping.isCanonical;
        base.isPackagePresentation = mapping.isPackagePresentation;

        if (mapping.tracksPackages) {
          const closed = Number(row?._sum.closedPackageQuantity ?? 0);
          const loose = Number(row?._sum.looseUnitQuantity ?? 0);
          base.closedPackageQuantity = closed;
          base.looseUnitQuantity = loose;
          const pkgUnit = mapping.packageUnit ?? saleUnit;
          base.displayText = `${fmt(closed)} ${pluralize(pkgUnit, closed)} + ${fmt(loose)} ${pluralize(baseUnit, loose)}`;
        } else if (factor > 1) {
          // Derivado de equivalencia (ej. QUINTAL): "8 QUINTALES / 112 VARILLAS"
          base.displayText = `${fmt(saleQty)} ${pluralize(saleUnit, saleQty)} / ${fmt(baseQty)} ${pluralize(baseUnit, baseQty)}`;
        } else {
          // Canónico (ej. VARILLA): "112 VARILLAS"
          base.displayText = `${fmt(baseQty)} ${pluralize(baseUnit, baseQty)}`;
        }
      }

      return base;
    });

    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
