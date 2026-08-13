/**
 * Chequeo puntual antes de corregir ARENA_2 y PIEDRIN_3: a diferencia del
 * fix de hierro/clavo (solo etiqueta), aca tambien cambia el VALOR del
 * conversionFactor (5 -> 25/55), asi que hay que ver si los derivados ya
 * tienen saldo propio antes de tocar nada — si lo tienen, el rebuild
 * multiplicaria ese saldo por el factor NUEVO, no el viejo.
 *
 * Solo lee. Uso: npx tsx scripts/check-arena-piedrin-balances.ts
 */
import { prisma } from "@/lib/prisma";

async function main() {
  const groups = await prisma.productStockGroup.findMany({
    where: { code: { in: ["ARENA_2", "PIEDRIN_3"] } },
    include: { products: { where: { isActive: true }, include: { product: { select: { sku: true, name: true } } } } },
  });

  for (const g of groups) {
    console.log(`\n${g.code} — ${g.name}`);
    for (const m of g.products) {
      const balances = await prisma.inventoryBalance.findMany({
        where: { productId: m.productId },
        include: { branch: { select: { code: true } } },
      });
      const nonZero = balances.filter((b) => Number(b.quantityOnHand) !== 0);
      const status = nonZero.length === 0
        ? "balance = 0 en todas las sucursales"
        : nonZero.map((b) => `${b.branch.code}=${b.quantityOnHand}`).join(", ");
      console.log(`  ${m.product.sku} (${m.product.name}) saleUnit=${m.saleUnit} factor=${m.conversionFactor} ${m.isCanonical ? "CANONICAL" : "derivado"} -> ${status}`);
    }
  }

  // Tambien: verificar si el producto CAMION existe y si tiene saldo, aunque
  // no vaya a entrar a la fusion (el usuario confirmo que no tiene factor fijo).
  const camion = await prisma.product.findFirst({
    where: { name: { contains: "CAMION DE PIEDRIN COMERCIAL", mode: "insensitive" } },
    select: { id: true, sku: true, name: true },
  });
  if (camion) {
    const balances = await prisma.inventoryBalance.findMany({ where: { productId: camion.id }, include: { branch: { select: { code: true } } } });
    console.log(`\nCAMION DE PIEDRIN COMERCIAL: ${camion.sku} -> ${balances.map((b) => `${b.branch.code}=${b.quantityOnHand}`).join(", ") || "sin balances"}`);
  } else {
    console.log("\nCAMION DE PIEDRIN COMERCIAL: no encontrado en el catalogo.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
