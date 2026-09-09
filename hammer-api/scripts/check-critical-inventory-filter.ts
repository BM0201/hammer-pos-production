import { prisma } from "@/lib/prisma";
import { excludeDerivedStockGroupMembers, derivedStockGroupMemberFilter } from "@/modules/catalog/service";

/**
 * prompt-inventario-critico-fusion.md — diagnóstico de SOLO LECTURA antes
 * de tocar getBranchAdminDashboardSummary (dashboard/service.ts). Compara
 * el conteo actual de prisma.inventoryBalance.count({ quantityOnHand: {
 * lte: 5 } }) contra dos versiones filtradas:
 *   - "helper" — usa excludeDerivedStockGroupMembers() (catalog/service.ts),
 *     el filtro YA establecido y reusado en finance/service.ts y
 *     reports/service.ts para exactamente este propósito ("alertas de
 *     reposición", según su propio doc comment). Exige, además de
 *     isCanonical:false, que la membresía y el stockGroup estén activos.
 *   - "literal" — el filtro tal cual lo propuso el pedido
 *     (stockGroupMemberships: { none: { isCanonical: false } }, sin mirar
 *     isActive de la membresía/grupo), para confirmar si diverge del
 *     helper en los datos reales.
 */
async function main() {
  const baseWhere = { quantityOnHand: { lte: 5 } } as const;

  const total = await prisma.inventoryBalance.count({ where: baseWhere });

  const excludedInactive = await prisma.inventoryBalance.count({
    where: { ...baseWhere, product: { isActive: false } },
  });

  const excludedDerivedAmongActive = await prisma.inventoryBalance.count({
    where: {
      ...baseWhere,
      product: { isActive: true, ...derivedStockGroupMemberFilter() },
    },
  });

  const newTotalHelper = await prisma.inventoryBalance.count({
    where: {
      ...baseWhere,
      product: { isActive: true, ...excludeDerivedStockGroupMembers() },
    },
  });

  const newTotalLiteral = await prisma.inventoryBalance.count({
    where: {
      ...baseWhere,
      product: { isActive: true, stockGroupMemberships: { none: { isCanonical: false } } },
    },
  });

  console.log(`Total actual (quantityOnHand <= 5, sin filtro):        ${total}`);
  console.log(`  Excluidos por product.isActive = false:              ${excludedInactive}`);
  console.log(`  Excluidos por ser miembro derivado no-canónico:      ${excludedDerivedAmongActive}`);
  console.log(`  (suma de exclusiones):                               ${excludedInactive + excludedDerivedAmongActive}`);
  console.log(`Total con excludeDerivedStockGroupMembers() (helper):  ${newTotalHelper}`);
  console.log(`Total con el filtro literal del pedido:                ${newTotalLiteral}`);
  console.log(`Chequeo: total - exclusiones == newTotalHelper?        ${total - excludedInactive - excludedDerivedAmongActive === newTotalHelper}`);
  console.log(`¿Helper y literal dan el mismo número?                 ${newTotalHelper === newTotalLiteral}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
