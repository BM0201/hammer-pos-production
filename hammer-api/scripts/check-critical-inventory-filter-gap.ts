import { prisma } from "@/lib/prisma";
import { excludeDerivedStockGroupMembers } from "@/modules/catalog/service";

/**
 * Diagnóstico de seguimiento — investiga las 11 filas donde el helper
 * (excludeDerivedStockGroupMembers) y el filtro literal del pedido
 * divergen: el helper las CUENTA (membresía o stockGroup inactivos), el
 * literal las EXCLUYE (solo mira isCanonical, ignora isActive).
 */
async function main() {
  const baseWhere = { quantityOnHand: { lte: 5 } } as const;

  const heldByHelper = await prisma.inventoryBalance.findMany({
    where: { ...baseWhere, product: { isActive: true, ...excludeDerivedStockGroupMembers() } },
    select: {
      branchId: true,
      productId: true,
      quantityOnHand: true,
      product: {
        select: {
          sku: true,
          name: true,
          stockGroupMemberships: {
            select: { isCanonical: true, isActive: true, stockGroupId: true, stockGroup: { select: { code: true, isActive: true } } },
          },
        },
      },
    },
  });

  const heldByLiteral = await prisma.inventoryBalance.findMany({
    where: { ...baseWhere, product: { isActive: true, stockGroupMemberships: { none: { isCanonical: false } } } },
    select: { branchId: true, productId: true },
  });
  const literalKeys = new Set(heldByLiteral.map((b) => `${b.branchId}:${b.productId}`));

  const onlyInHelper = heldByHelper.filter((b) => !literalKeys.has(`${b.branchId}:${b.productId}`));

  console.log(`Filas que el helper cuenta pero el filtro literal excluye: ${onlyInHelper.length}`);
  for (const row of onlyInHelper) {
    console.log(`- ${row.product.sku} (${row.product.name}) qty=${row.quantityOnHand}`);
    for (const m of row.product.stockGroupMemberships) {
      console.log(`    membership: isCanonical=${m.isCanonical} isActive=${m.isActive} stockGroup=${m.stockGroup.code} stockGroup.isActive=${m.stockGroup.isActive}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
