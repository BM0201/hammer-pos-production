import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Fusión de Inventario v2, Fase 1.5 — verificador de salud permanente.
 *
 * Chequeo BARATO (solo balances actuales, sin reconstruir historial de
 * movimientos — eso lo hace scripts/verify-stock-groups.ts, que es la
 * herramienta de auditoría profunda, no el hook post-operación):
 *  1. Balances no-cero en miembros DERIVADOS (deberían estar en cero).
 *  2. Invariante cerrado/suelto (tracksPackages): quantityOnHand del
 *     canónico == closedPackageQuantity × factor + looseUnitQuantity.
 */

type DbClient = PrismaClient | Prisma.TransactionClient;

const EPSILON = new Prisma.Decimal("0.01");

export type StockGroupHealthIssue = {
  branchId: string;
  kind: "DERIVED_NONZERO" | "INVARIANT";
  detail: string;
  expected: string;
  actual: string;
  diff: string;
};

export type StockGroupHealthResult = {
  stockGroupId: string;
  stockGroupCode: string;
  healthy: boolean;
  issues: StockGroupHealthIssue[];
};

export async function checkStockGroupHealth(
  db: DbClient,
  input: { stockGroupId: string; branchId?: string },
): Promise<StockGroupHealthResult> {
  const group = await db.productStockGroup.findUnique({
    where: { id: input.stockGroupId },
    include: {
      products: {
        where: { isActive: true },
        select: { productId: true, isCanonical: true, conversionFactor: true, isPackagePresentation: true },
      },
    },
  });
  if (!group) {
    return { stockGroupId: input.stockGroupId, stockGroupCode: "", healthy: true, issues: [] };
  }

  const canonical = group.products.find((m) => m.isCanonical);
  if (!canonical) {
    return { stockGroupId: group.id, stockGroupCode: group.code, healthy: true, issues: [] };
  }
  const derived = group.products.filter((m) => !m.isCanonical);
  const allProductIds = group.products.map((m) => m.productId);

  const packageMember = group.tracksPackages
    ? group.products.find((m) => m.isPackagePresentation && !m.isCanonical) ?? derived[0]
    : null;
  const factor = group.tracksPackages
    ? new Prisma.Decimal(group.conversionFactorToBase ?? packageMember?.conversionFactor ?? 1)
    : null;

  const balances = await db.inventoryBalance.findMany({
    where: {
      productId: { in: allProductIds },
      ...(input.branchId ? { branchId: input.branchId } : {}),
    },
  });
  const byBranchProduct = new Map(balances.map((b) => [`${b.branchId}:${b.productId}`, b]));
  const branchIds = [...new Set(balances.map((b) => b.branchId))];

  const issues: StockGroupHealthIssue[] = [];

  for (const branchId of branchIds) {
    for (const member of derived) {
      const balance = byBranchProduct.get(`${branchId}:${member.productId}`);
      if (!balance) continue;
      const nonZero = balance.quantityOnHand.abs().gt(EPSILON)
        || balance.closedPackageQuantity.abs().gt(EPSILON)
        || balance.looseUnitQuantity.abs().gt(EPSILON);
      if (nonZero) {
        issues.push({
          branchId,
          kind: "DERIVED_NONZERO",
          detail: `miembro derivado ${member.productId} debería estar en cero`,
          expected: "0",
          actual: `qty=${balance.quantityOnHand.toString()} closed=${balance.closedPackageQuantity.toString()} loose=${balance.looseUnitQuantity.toString()}`,
          diff: balance.quantityOnHand.toString(),
        });
      }
    }

    if (group.tracksPackages && factor) {
      const canonicalBalance = byBranchProduct.get(`${branchId}:${canonical.productId}`);
      if (canonicalBalance) {
        const expectedQty = canonicalBalance.closedPackageQuantity.mul(factor).add(canonicalBalance.looseUnitQuantity);
        const diff = canonicalBalance.quantityOnHand.sub(expectedQty);
        if (diff.abs().gt(EPSILON)) {
          issues.push({
            branchId,
            kind: "INVARIANT",
            detail: "quantityOnHand != closedPackageQuantity*factor + looseUnitQuantity",
            expected: expectedQty.toString(),
            actual: canonicalBalance.quantityOnHand.toString(),
            diff: diff.toString(),
          });
        }
      }
    }
  }

  return { stockGroupId: group.id, stockGroupCode: group.code, healthy: issues.length === 0, issues };
}
