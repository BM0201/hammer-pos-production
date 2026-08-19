import { Prisma, PrismaClient } from "@prisma/client";
import { findDuplicateFactors, findUnitCollisions } from "@/modules/catalog/presentation-units";

/**
 * Fusión de Inventario v2, Fase 1.5 — verificador de salud permanente.
 *
 * Chequeo BARATO (solo balances actuales, sin reconstruir historial de
 * movimientos — eso lo hace scripts/verify-stock-groups.ts, que es la
 * herramienta de auditoría profunda, no el hook post-operación):
 *  1. Balances no-cero en miembros DERIVADOS (deberían estar en cero).
 *  2. Invariante cerrado/suelto (tracksPackages): quantityOnHand del
 *     canónico == closedPackageQuantity × factor + looseUnitQuantity.
 *  3. Colisión de unidad de venta entre presentaciones (UNIT_COLLISION).
 *  4. Factores duplicados entre derivados (DUPLICATE_FACTOR).
 */

type DbClient = PrismaClient | Prisma.TransactionClient;

const EPSILON = new Prisma.Decimal("0.01");

export type StockGroupHealthIssue = {
  /** null para chequeos de DEFINICIÓN del grupo (UNIT_COLLISION, DUPLICATE_FACTOR) — no dependen de sucursal. */
  branchId: string | null;
  kind: "DERIVED_NONZERO" | "INVARIANT" | "UNIT_COLLISION" | "DUPLICATE_FACTOR";
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
        select: { productId: true, isCanonical: true, conversionFactor: true, isPackagePresentation: true, saleUnit: true },
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

  // Sin fallback a derived[0]: con fusión triple (3+ miembros) eso agarraría
  // cualquier suelto alternativo como si fuera el empaque. La validación de
  // escritura ya garantiza exactamente un isPackagePresentation.
  const packageMember = group.tracksPackages
    ? group.products.find((m) => m.isPackagePresentation && !m.isCanonical) ?? null
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

  // Chequeos de definición del grupo — no dependen de saldos ni de sucursal.
  // Un grupo con dos presentaciones en la misma unidad no es "inconsistente
  // en una sucursal": está mal definido en todas. Se reportan una sola vez.
  const memberUnits = group.products.map((m) => ({ productId: m.productId, saleUnit: m.saleUnit }));
  for (const collision of findUnitCollisions(memberUnits)) {
    issues.push({
      branchId: null,
      kind: "UNIT_COLLISION",
      detail: `${collision.productIds.length} presentaciones comparten la unidad "${collision.unit}"`,
      expected: "una unidad de venta distinta por presentación",
      actual: collision.productIds.join(", "),
      diff: collision.unit,
    });
  }
  for (const dup of findDuplicateFactors(group.products.map((m) => ({
    productId: m.productId,
    conversionFactor: Number(m.conversionFactor),
    isCanonical: m.isCanonical,
  })))) {
    issues.push({
      branchId: null,
      kind: "DUPLICATE_FACTOR",
      detail: `${dup.productIds.length} presentaciones derivadas comparten el factor ${dup.factor}`,
      expected: "un factor propio por presentación",
      actual: dup.productIds.join(", "),
      diff: String(dup.factor),
    });
  }

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
