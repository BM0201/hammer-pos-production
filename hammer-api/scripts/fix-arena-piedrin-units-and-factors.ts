/**
 * Fase 4 (arena + piedrin): corrige la colision de unidad ("UNIDAD" en los 3
 * miembros de cada grupo) Y el conversionFactor real de los dos derivados
 * "METRO" de cada grupo, confirmado por el usuario:
 *
 *   - 4 paladas = 1 lata (constante)
 *   - "100P GRANDE": 100 paladas / metro -> 100/4 = 25 latas / metro
 *   - "220P PEQUEÑA"/"220 PALADAS": 220 paladas / metro -> 220/4 = 55 latas / metro
 *
 * Etiquetas: canonico UNIDAD -> LATA; derivados -> METRO GRANDE / METRO PEQUEÑA.
 * CAMION DE PIEDRIN COMERCIAL queda fuera de la fusion (se vende por metro
 * cubico o peso, sin factor fijo) — no se toca.
 *
 * Verificado antes de correr: los 4 productos derivados tienen balance = 0
 * en todas las sucursales (ver scripts/check-arena-piedrin-balances.ts), asi
 * que cambiar el factor 5 -> 25/55 no arrastra ninguna cantidad real.
 *
 * Va por updateStockGroup (misma funcion que el modal "Editar") — respeta
 * validateMembers y deja rastro en AuditLog.
 *
 * Uso: npx tsx scripts/fix-arena-piedrin-units-and-factors.ts
 */
import { prisma } from "@/lib/prisma";
import { updateStockGroup, type StockGroupMemberInput } from "@/modules/catalog/stock-group-crud";

const ACTOR_USER_ID = "c19e6a8c3d64n470a1c3xghv"; // MASTER master@hammer.app

type Fix = { newSaleUnit: string; newFactor?: number };

// Por SKU: que etiqueta y (si aplica) que factor nuevo le corresponde.
const FIXES: Record<string, Fix> = {
  // ARENA_2
  "AGG-ARE-STD-0002": { newSaleUnit: "LATA" }, // canonico, factor se mantiene en 1
  "AGG-ARE-150P-0001": { newSaleUnit: "METRO GRANDE", newFactor: 25 },
  "AGG-ARE-280P-0001": { newSaleUnit: "METRO PEQUEÑA", newFactor: 55 },
  // PIEDRIN_3
  "AGG-LAT-STD-0002": { newSaleUnit: "LATA" }, // canonico, factor se mantiene en 1
  "AGG-MET-150P-0001": { newSaleUnit: "METRO GRANDE", newFactor: 25 },
  "AGG-PAL-STD-0001": { newSaleUnit: "METRO PEQUEÑA", newFactor: 55 },
};

async function main() {
  const groups = await prisma.productStockGroup.findMany({
    where: { code: { in: ["ARENA_2", "PIEDRIN_3"] } },
    include: { products: { where: { isActive: true }, include: { product: { select: { sku: true, name: true } } } } },
    orderBy: { code: "asc" },
  });

  for (const group of groups) {
    const members: StockGroupMemberInput[] = group.products.map((m) => {
      const fix = FIXES[m.product.sku];
      if (!fix) throw new Error(`Sin fix definido para ${m.product.sku} en ${group.code} — abortando.`);
      return {
        productId: m.productId,
        saleUnit: fix.newSaleUnit,
        conversionFactor: fix.newFactor ?? Number(m.conversionFactor),
        isCanonical: m.isCanonical,
        isPackagePresentation: m.isPackagePresentation,
      };
    });

    await updateStockGroup(group.id, { members }, ACTOR_USER_ID);
    console.log(`OK ${group.code}:`);
    for (const m of group.products) {
      const fix = FIXES[m.product.sku]!;
      console.log(`   ${m.product.sku} (${m.product.name}) "${m.saleUnit}"->"${fix.newSaleUnit}" factor ${m.conversionFactor}->${fix.newFactor ?? m.conversionFactor}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
