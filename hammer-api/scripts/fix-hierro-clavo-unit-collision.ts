/**
 * Corrige la colision de unidad ("UNIDAD" repetida entre canonico y derivado)
 * en los 13 grupos HIERRO/CLAVO que el diagnostico confirmo. Renombra SOLO
 * la unidad de venta del miembro derivado que colisiona — factor, canonico,
 * y todo lo demas queda intacto. El nombre nuevo sale del propio nombre del
 * producto (ej. "HIERRO DE 1/4 5.5MM" -> QUINTAL, "KILO CLAVO ACERO 1\"" ->
 * KILO), no se adivina nada nuevo.
 *
 * Va por updateStockGroup (la misma funcion que usa el modal "Editar" de
 * Fusion de Inventario) para respetar validateMembers y dejar rastro en
 * AuditLog — no toca la tabla directo.
 *
 * Verificado antes de correr: los 13 productos derivados tienen balance = 0
 * en todas las sucursales, asi que el rebuild que dispara updateStockGroup
 * es un no-op numerico aqui (ver scripts/check-hierro-clavo-balances.ts).
 *
 * Uso: npx tsx scripts/fix-hierro-clavo-unit-collision.ts
 */
import { prisma } from "@/lib/prisma";
import { updateStockGroup, type StockGroupMemberInput } from "@/modules/catalog/stock-group-crud";

const ACTOR_USER_ID = "c19e6a8c3d64n470a1c3xghv"; // MASTER master@hammer.app — unico admin activo

const FIXES: Record<string, string> = {
  HIERRO_1_2_12V: "QUINTAL",
  HIERRO_1_2_STD: "QUINTAL",
  HIERRO_1_4_5_5MM: "QUINTAL",
  HIERRO_1_4_6MM: "QUINTAL",
  HIERRO_3_8_9V: "QUINTAL",
  HIERRO_3_8_MM: "QUINTAL",
  HIERRO_3_8_STD: "QUINTAL",
  CLAVO_ACERO_1_1_2_3: "KILO",
  CLAVO_ACERO_1_3: "KILO",
  CLAVO_ACERO_2_1_2_3: "KILO",
  CLAVO_ACERO_2_3: "KILO",
  CLAVO_ACERO_3_3: "KILO",
  CLAVO_ACERO_4_3: "KILO",
};

async function main() {
  const groups = await prisma.productStockGroup.findMany({
    where: { code: { in: Object.keys(FIXES) } },
    include: { products: { where: { isActive: true }, include: { product: { select: { sku: true, name: true } } } } },
    orderBy: { code: "asc" },
  });

  console.log(`Corrigiendo ${groups.length} de ${Object.keys(FIXES).length} grupos esperados.\n`);

  for (const group of groups) {
    const targetUnit = FIXES[group.code];
    // El miembro a renombrar es el UNICO no-canonico cuya unidad colisiona
    // con el canonico (para HIERRO/CLAVO siempre hay exactamente uno: el
    // "KILO"/"HIERRO" con saleUnit=UNIDAD; el de LB, si existe, ya esta bien).
    const canonical = group.products.find((m) => m.isCanonical);
    if (!canonical) {
      console.log(`!! ${group.code}: sin canonico activo, se omite.`);
      continue;
    }
    const target = group.products.find((m) => !m.isCanonical && m.saleUnit.toUpperCase() === canonical.saleUnit.toUpperCase());
    if (!target) {
      console.log(`!! ${group.code}: no se encontro un derivado colisionando con "${canonical.saleUnit}", se omite (revisar a mano).`);
      continue;
    }

    const members: StockGroupMemberInput[] = group.products.map((m) => ({
      productId: m.productId,
      saleUnit: m.productId === target.productId ? targetUnit : m.saleUnit,
      conversionFactor: Number(m.conversionFactor),
      isCanonical: m.isCanonical,
      isPackagePresentation: m.isPackagePresentation,
    }));

    await updateStockGroup(group.id, { members }, ACTOR_USER_ID);
    console.log(`OK ${group.code}: ${target.product.sku} (${target.product.name}) "${target.saleUnit}" -> "${targetUnit}"`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
