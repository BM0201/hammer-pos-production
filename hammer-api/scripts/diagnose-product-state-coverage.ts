/**
 * prompt-inventario-inicio-fix.md Commit 3 §1 — "consulta de solo lectura
 * en producción: filas de estado contra productos activos × sucursales
 * activas". Confirma o descarta la sospecha de que rebuild-product-state.ts
 * nunca corrió (o corrió parcial) — antes de decidir si hace falta otro
 * backfill.
 *
 * Solo lectura. Ejecutar con: npx tsx scripts/diagnose-product-state-coverage.ts
 */
import { prisma } from "@/lib/prisma";

async function main() {
  const [activeProducts, activeBranches, catalogStateRows, branchStateRows, expectedPairs] = await Promise.all([
    prisma.product.count({ where: { isActive: true } }),
    prisma.branch.count({ where: { isActive: true } }),
    prisma.productCatalogState.count(),
    prisma.productBranchState.count(),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM "Product" p CROSS JOIN "Branch" b
      WHERE p."isActive" = true AND b."isActive" = true
    `,
  ]);

  const expected = Number(expectedPairs[0].count);

  // Cuántos de los pares esperados (producto activo × sucursal activa)
  // tienen de verdad una fila en ProductBranchState — distinto de "cuántas
  // filas hay en total" (esa tabla puede tener filas de productos/sucursales
  // YA inactivos, que no cuentan para "cobertura" de lo que hoy importa).
  const [presentPairsRows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM "Product" p
      CROSS JOIN "Branch" b
      JOIN "ProductBranchState" pbs ON pbs."productId" = p.id AND pbs."branchId" = b.id
      WHERE p."isActive" = true AND b."isActive" = true
    `,
  ]);
  const presentPairs = Number(presentPairsRows[0].count);

  const presentCatalogRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count FROM "Product" p
    JOIN "ProductCatalogState" pcs ON pcs."productId" = p.id
    WHERE p."isActive" = true
  `;
  const presentCatalog = Number(presentCatalogRows[0].count);

  console.log(JSON.stringify({
    activeProducts,
    activeBranches,
    productBranchState: {
      expectedPairs: expected,
      presentPairs,
      missingPairs: expected - presentPairs,
      coveragePercent: expected > 0 ? Number(((presentPairs / expected) * 100).toFixed(2)) : null,
      totalRowsInTable: branchStateRows,
    },
    productCatalogState: {
      expectedRows: activeProducts,
      presentRows: presentCatalog,
      missingRows: activeProducts - presentCatalog,
      coveragePercent: activeProducts > 0 ? Number(((presentCatalog / activeProducts) * 100).toFixed(2)) : null,
      totalRowsInTable: catalogStateRows,
    },
  }, null, 2));
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
