/**
 * Fase 0 (prompt-motor-precios-lote-herencia-gobierno.md): antes de este fix,
 * applySuggestedPrice escribía branchPrice sin lastPriceUpdateAt ni
 * priceUpdatedByUserId. La Fase 1 (bandeja de precios) necesita esa fecha
 * para detectar COST_CHANGED_PRICE_STALE — un BranchProductSetting con
 * branchPrice pero sin lastPriceUpdateAt es "ciego" para esa señal: no hay
 * forma de saber si el precio quedó viejo desde acá.
 *
 * SOLO LEE, no escribe nada. NO inventa fechas retroactivas — asignar una
 * fecha fabricada le mentiría a la Fase 1 sobre cuándo se fijó ese precio.
 *
 * Uso:
 *   npx tsx scripts/report-prices-missing-update-date.ts
 */
import { prisma } from "@/lib/prisma";

function money(v: unknown): string {
  const n = Number((v as { toString?: () => string })?.toString?.() ?? v ?? 0);
  return `C$${(Math.round(n * 100) / 100).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const [blind, total] = await Promise.all([
    prisma.branchProductSetting.findMany({
      where: { branchPrice: { not: null }, lastPriceUpdateAt: null },
      select: {
        id: true,
        branchPrice: true,
        priceSource: true,
        branch: { select: { code: true, name: true } },
        product: { select: { sku: true, name: true } },
      },
      orderBy: [{ branch: { code: "asc" } }, { product: { sku: "asc" } }],
    }),
    prisma.branchProductSetting.count({ where: { branchPrice: { not: null } } }),
  ]);

  console.log(`\n=== Precios de sucursal sin fecha de actualización (Fase 0) ===\n`);
  console.log(`Con branchPrice fijado: ${total}`);
  console.log(`Sin lastPriceUpdateAt (ciegos para la bandeja de la Fase 1): ${blind.length}\n`);

  if (blind.length === 0) {
    console.log("Ninguno. Todos los precios de sucursal tienen fecha de actualización.\n");
    await prisma.$disconnect();
    return;
  }

  const byBranch = new Map<string, { count: number }>();
  const bySource = new Map<string, number>();
  console.log("  Sucursal | SKU        | Producto                       | Precio       | priceSource");
  for (const row of blind) {
    const branchLabel = row.branch.code;
    byBranch.set(branchLabel, { count: (byBranch.get(branchLabel)?.count ?? 0) + 1 });
    const source = row.priceSource ?? "(null)";
    bySource.set(source, (bySource.get(source) ?? 0) + 1);
    console.log(
      `  ${branchLabel.padEnd(8)} | ${row.product.sku.padEnd(10)} | ${row.product.name.slice(0, 30).padEnd(30)} | ${money(row.branchPrice).padStart(12)} | ${source}`,
    );
  }

  console.log(`\nPor sucursal:`);
  for (const [code, b] of byBranch) console.log(`  ${code.padEnd(8)} | ${b.count} producto(s)`);

  console.log(`\nPor priceSource:`);
  for (const [source, count] of bySource) console.log(`  ${source.padEnd(14)} | ${count} producto(s)`);

  console.log(
    `\n${blind.length} de ${total} precios de sucursal (${((blind.length / total) * 100).toFixed(1)}%) arrancan ciegos para la bandeja de precios.`,
  );
  console.log("No se inventó ninguna fecha — quedan como están hasta que se les fije un precio de nuevo por un camino que sí registre la fecha.\n");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
