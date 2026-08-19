/**
 * Chequeo puntual, de un solo uso: antes de corregir la colision de unidad
 * en los 13 grupos HIERRO/CLAVO, verifica si los productos DERIVADOS
 * (HIERRO, KILO) ya tienen saldo propio acumulado por el bug. Si lo tienen,
 * corregir la etiqueta dispara rebuildStockGroupBalancesTx, que fusiona ese
 * saldo hacia el canonico multiplicandolo por el factor — eso SI cambia
 * cantidades reales, no solo la etiqueta.
 *
 * Solo lee. Uso: npx tsx scripts/check-hierro-clavo-balances.ts
 */
import { prisma } from "@/lib/prisma";

const CODES = [
  "HIERRO_1_2_12V", "HIERRO_1_2_STD", "HIERRO_1_4_5_5MM", "HIERRO_1_4_6MM",
  "HIERRO_3_8_9V", "HIERRO_3_8_MM", "HIERRO_3_8_STD",
  "CLAVO_ACERO_1_1_2_3", "CLAVO_ACERO_1_3", "CLAVO_ACERO_2_1_2_3",
  "CLAVO_ACERO_2_3", "CLAVO_ACERO_3_3", "CLAVO_ACERO_4_3",
];

async function main() {
  const groups = await prisma.productStockGroup.findMany({
    where: { code: { in: CODES } },
    include: { products: { where: { isActive: true }, include: { product: { select: { sku: true, name: true } } } } },
    orderBy: { code: "asc" },
  });
  console.log(`Grupos encontrados: ${groups.length} de ${CODES.length}\n`);

  for (const g of groups) {
    const derived = g.products.filter((m) => !m.isCanonical);
    for (const m of derived) {
      const balances = await prisma.inventoryBalance.findMany({
        where: { productId: m.productId },
        include: { branch: { select: { code: true } } },
      });
      const nonZero = balances.filter((b) => Number(b.quantityOnHand) !== 0);
      const status = nonZero.length === 0
        ? "balance = 0 en todas las sucursales"
        : nonZero.map((b) => `${b.branch.code}=${b.quantityOnHand}`).join(", ");
      console.log(`${g.code} . ${m.product.sku} (${m.product.name}) saleUnit=${m.saleUnit} factor=${m.conversionFactor} -> ${status}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
