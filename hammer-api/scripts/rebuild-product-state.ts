/**
 * prompt-inventario-v3.md Fase 1 — backfill de ProductBranchState/
 * ProductCatalogState: recorre TODO el catálogo activo, en tandas, y llama
 * a refreshProductStateTx (el mismo escritor que usan todas las
 * operaciones reales) — nunca reimplementa el cálculo acá.
 *
 * Escribe de verdad (no es de solo lectura) — pero solo CREA/ACTUALIZA las
 * 2 tablas nuevas de este doc; no toca ningún dato existente.
 *
 * Uso: npx tsx scripts/rebuild-product-state.ts [tamañoDeTanda=200]
 */
import { prisma } from "@/lib/prisma";
import { refreshProductStateTx } from "@/modules/catalog-inventory/product-state-service";

async function main() {
  const batchSize = Number(process.argv[2] ?? 200) || 200;

  const products = await prisma.product.findMany({ where: { isActive: true }, select: { id: true } });
  const productIds = products.map((p) => p.id);
  console.log(`${productIds.length} producto(s) activo(s) a reconstruir, en tandas de ${batchSize}.`);

  let done = 0;
  const t0 = Date.now();
  for (let i = 0; i < productIds.length; i += batchSize) {
    const batch = productIds.slice(i, i + batchSize);
    await refreshProductStateTx(prisma, batch);
    done += batch.length;
    console.log(`  ${done}/${productIds.length}`);
  }

  const elapsedMs = Date.now() - t0;
  console.log(`\nListo en ${elapsedMs} ms.`);

  const [branchStateCount, catalogStateCount] = await Promise.all([
    prisma.productBranchState.count(),
    prisma.productCatalogState.count(),
  ]);
  console.log(`ProductBranchState: ${branchStateCount} fila(s). ProductCatalogState: ${catalogStateCount} fila(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
