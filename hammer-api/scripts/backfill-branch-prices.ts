/**
 * Backfill de precios por sucursal (Fase 0 de la migracion "precio de venta obligatorio por sucursal").
 *
 * Para cada producto activo y cada sucursal activa, si no existe BranchProductSetting.branchPrice,
 * lo crea/actualiza con el valor de Product.standardSalePrice (precio semilla historico).
 *
 * Uso:
 *   npx tsx scripts/backfill-branch-prices.ts            # ejecuta el backfill
 *   npx tsx scripts/backfill-branch-prices.ts --dry-run   # solo reporta cuantos registros afectaria
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const [products, branches] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, sku: true, standardSalePrice: true },
    }),
    prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, code: true },
    }),
  ]);

  const existingSettings = await prisma.branchProductSetting.findMany({
    where: { productId: { in: products.map((p) => p.id) } },
    select: { productId: true, branchId: true, branchPrice: true },
  });
  const settingByKey = new Map(existingSettings.map((s) => [`${s.branchId}:${s.productId}`, s]));

  let created = 0;
  let updated = 0;
  const perBranch = new Map<string, number>();

  for (const product of products) {
    for (const branch of branches) {
      const key = `${branch.id}:${product.id}`;
      const existing = settingByKey.get(key);
      if (existing && existing.branchPrice !== null) continue;

      if (!dryRun) {
        await prisma.branchProductSetting.upsert({
          where: { branchId_productId: { branchId: branch.id, productId: product.id } },
          create: { branchId: branch.id, productId: product.id, branchPrice: product.standardSalePrice },
          update: { branchPrice: product.standardSalePrice },
        });
      }

      if (existing) updated += 1;
      else created += 1;
      perBranch.set(branch.code, (perBranch.get(branch.code) ?? 0) + 1);
    }
  }

  console.log(`${dryRun ? "[DRY RUN] " : ""}Backfill de precios por sucursal completado.`);
  console.log(`Productos activos: ${products.length}. Sucursales activas: ${branches.length}.`);
  console.log(`BranchProductSetting creados: ${created}. Actualizados (branchPrice era null): ${updated}.`);
  console.log("Por sucursal:", Object.fromEntries(perBranch));

  const remainingMissing = await prisma.product.findMany({
    where: {
      isActive: true,
      branchProductSettings: {
        none: {},
      },
    },
    select: { id: true, sku: true },
  });

  const allSettingsAfter = dryRun
    ? existingSettings
    : await prisma.branchProductSetting.findMany({
        where: { productId: { in: products.map((p) => p.id) } },
        select: { productId: true, branchId: true, branchPrice: true },
      });

  const missingCount = dryRun
    ? products.length * branches.length - existingSettings.filter((s) => s.branchPrice !== null).length
    : products.reduce((sum, product) => {
        const missingBranches = branches.filter((branch) => {
          const setting = allSettingsAfter.find((s) => s.productId === product.id && s.branchId === branch.id);
          return !setting || setting.branchPrice === null;
        });
        return sum + missingBranches.length;
      }, 0);

  console.log(`Productos activos sin ningun BranchProductSetting: ${remainingMissing.length}`);
  console.log(`Pares producto+sucursal activa que quedarian sin precio: ${missingCount}`);

  if (!dryRun && missingCount > 0) {
    console.warn("ADVERTENCIA: quedaron pares producto+sucursal sin precio tras el backfill. Revisa antes de continuar a la Fase 1.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
