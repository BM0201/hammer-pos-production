/**
 * Diagnostico puntual: reporte de "solo sube X varillas en vez de X*factor"
 * al usar Carga inicial de inventario sobre un producto fusionado (hierro).
 *
 * Busca productos por nombre/SKU (parcial, insensible a mayusculas) y para
 * cada uno imprime EXACTAMENTE lo que createOpeningBalanceTx/
 * createInventoryMovementTx ven al resolver su conversion de fusion —
 * reusa getProductStockConversion, la funcion real de produccion, no una
 * copia. Si imprime "SIN FUSION (conversion = null)" para un producto que
 * el usuario espera fusionado, ese es el origen exacto del bug: el sistema
 * trata la cantidad ingresada como si ya estuviera en unidad base, sin
 * aplicar ningun factor.
 *
 * Solo lee — no escribe nada.
 * Uso: npx tsx scripts/diagnose-opening-balance-bug.ts "1/4"
 *      npx tsx scripts/diagnose-opening-balance-bug.ts "hierro"
 */
import { prisma } from "@/lib/prisma";
import { getProductStockConversion } from "@/modules/inventory/unit-conversion";

async function main() {
  const term = process.argv[2];
  if (!term) {
    console.error('Uso: npx tsx scripts/diagnose-opening-balance-bug.ts "<termino de busqueda>"');
    process.exit(1);
  }

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { sku: { contains: term, mode: "insensitive" } },
      ],
    },
    select: { id: true, sku: true, name: true, unit: true },
    orderBy: { name: "asc" },
  });

  console.log(`${products.length} producto(s) activo(s) coinciden con "${term}".\n`);

  for (const product of products) {
    console.log(`── ${product.sku} · ${product.name} (unit propio del Product: "${product.unit}") ──`);
    const conversion = await getProductStockConversion(prisma, product.id);
    if (!conversion) {
      console.log("   !! SIN FUSION (conversion = null) — este producto NO tiene ProductStockGroupMember activo.");
      console.log("      Cualquier cantidad que se cargue aqui se escribe TAL CUAL, sin multiplicar por ningun factor.");
    } else {
      console.log(`   Grupo: ${conversion.stockGroupCode} — ${conversion.stockGroupName}`);
      console.log(`   baseUnit=${conversion.baseUnit} · packageUnit=${conversion.packageUnit ?? "-"} · tracksPackages=${conversion.tracksPackages}`);
      console.log(`   este miembro: saleUnit=${conversion.saleUnit} · conversionFactor=${conversion.conversionFactor} · isCanonical=${conversion.isCanonical} · isPackagePresentation=${conversion.isPackagePresentation}`);
      console.log(`   conversionFactorToBase (grupo, usado para empaques)=${conversion.conversionFactorToBase ?? "(usa conversionFactor)"}`);
      console.log(`   canonicalProductId=${conversion.canonicalProductId}`);

      // Todos los miembros del mismo grupo, para ver el cuadro completo.
      const siblings = await prisma.productStockGroupMember.findMany({
        where: { stockGroupId: conversion.stockGroupId },
        include: { product: { select: { sku: true, name: true } } },
        orderBy: [{ isCanonical: "desc" }, { conversionFactor: "asc" }],
      });
      console.log("   Miembros del grupo:");
      for (const m of siblings) {
        console.log(
          `     ${m.isActive ? " " : "(INACTIVO) "}${m.product.sku} · ${m.product.name} · saleUnit=${m.saleUnit} · factor=${m.conversionFactor} · ${m.isCanonical ? "CANONICAL" : "derivado"} · isPackagePresentation=${m.isPackagePresentation}`,
        );
      }
    }
    console.log("");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
