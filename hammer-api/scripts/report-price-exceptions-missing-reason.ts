/**
 * Parte B.3 (prompt-huecos-fase1-fase3-despliegue.md): antes de este fix,
 * upsertBranchProductSetting (el editor de catálogo) escribía branchPrice
 * sin priceExceptionReason ni priceExceptionAt — la deuda que este script
 * reporta es exactamente ese hueco.
 *
 * SOLO LEE, no escribe nada. NO inventa motivos ni marca nada como
 * "heredado" — no se sabe cuáles de estas excepciones fueron deliberadas.
 * La salida es para que Master decida cuáles limpiar con follow-standard
 * (volver al precio general) y cuáles justificar (agregar el motivo desde
 * la ficha del producto).
 *
 * Uso:
 *   npx tsx scripts/report-price-exceptions-missing-reason.ts
 */
import { prisma } from "@/lib/prisma";

function money(v: unknown): string {
  const n = Number((v as { toString?: () => string })?.toString?.() ?? v ?? 0);
  return `C$${(Math.round(n * 100) / 100).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

async function main() {
  const rows = await prisma.branchProductSetting.findMany({
    where: { branchPrice: { not: null }, priceExceptionReason: null },
    select: {
      id: true,
      branchPrice: true,
      lastPriceUpdateAt: true,
      branch: { select: { code: true, name: true } },
      product: { select: { sku: true, name: true, standardSalePrice: true } },
    },
    orderBy: [{ branch: { code: "asc" } }, { product: { sku: "asc" } }],
  });

  console.log(`\n=== Excepciones de precio sin motivo registrado (Parte B) ===\n`);

  if (rows.length === 0) {
    console.log("Ninguna. Todos los precios de sucursal fijados tienen un motivo declarado.\n");
    await prisma.$disconnect();
    return;
  }

  console.log(`Encontradas: ${rows.length}\n`);
  console.log("  Sucursal | SKU        | Producto                       | Precio sucursal | Precio general | Última actualización");
  const byBranch = new Map<string, number>();
  for (const row of rows) {
    byBranch.set(row.branch.code, (byBranch.get(row.branch.code) ?? 0) + 1);
    console.log(
      `  ${row.branch.code.padEnd(8)} | ${row.product.sku.padEnd(10)} | ${row.product.name.slice(0, 30).padEnd(30)} | ${money(row.branchPrice).padStart(15)} | ${money(row.product.standardSalePrice).padStart(14)} | ${fmtDate(row.lastPriceUpdateAt)}`,
    );
  }

  console.log(`\nPor sucursal:`);
  for (const [code, count] of byBranch) console.log(`  ${code.padEnd(8)} | ${count} producto(s)`);

  console.log(`\nTOTAL: ${rows.length} excepción(es) de precio sin motivo registrado.`);
  console.log("Master: para cada una, agregá el motivo desde la ficha del producto, o volvé al precio general con follow-standard si no fue deliberada.\n");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
