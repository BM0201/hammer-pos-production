/**
 * Limpieza de unidades de medida: deja todo el catálogo en el mismo
 * vocabulario que ya usan las fusiones (presentation-units.ts →
 * canonicalizePresentationUnit). Solo cambia ETIQUETAS — ninguna cantidad,
 * factor ni costo:
 *
 *   1. Product.unit de productos SIN fusión: abreviaturas viejas a la
 *      palabra completa (UN → UNIDAD, LB → LIBRA, M → METRO...) y
 *      mayúsculas/tildes uniformes.
 *   2. Fusiones: la unidad de venta de cada miembro normalizada igual
 *      (LB → LIBRA), y Product.unit de cada miembro igual a su unidad de
 *      venta (había productos "UNIDAD" que se venden por "QUINTAL"). Va por
 *      updateStockGroup — la misma función del modal "Editar fusión" — para
 *      respetar validateMembers y dejar rastro en AuditLog. El rebuild que
 *      dispara es un no-op numérico: no cambia ningún factor.
 *
 * Sin --apply solo muestra lo que cambiaría.
 *
 * Uso: npx tsx scripts/normalize-product-units.ts            (vista previa)
 *      npx tsx scripts/normalize-product-units.ts --apply    (aplica)
 */
import { prisma } from "@/lib/prisma";
import { canonicalizePresentationUnit, findUnitCollisions } from "@/modules/catalog/presentation-units";
import { updateStockGroup } from "@/modules/catalog/stock-group-crud";
import { logAuditEvent } from "@/modules/audit/service";

const APPLY = process.argv.includes("--apply");
const ACTOR_USER_ID = "c19e6a8c3d64n470a1c3xghv"; // MASTER master@hammer.app — mismo actor que los otros scripts de arreglo

async function main() {
  console.log(APPLY ? "== APLICANDO ==\n" : "== VISTA PREVIA (nada se escribe; correr con --apply para aplicar) ==\n");

  // ── 2. Fusiones (primero: definen la unidad de sus miembros) ──
  const groups = await prisma.productStockGroup.findMany({
    where: { isActive: true },
    include: { products: { where: { isActive: true }, include: { product: { select: { sku: true, name: true, unit: true } } } } },
    orderBy: { code: "asc" },
  });
  const memberIds = new Set(groups.flatMap((g) => g.products.map((m) => m.productId)));

  let groupsToFix = 0;
  for (const group of groups) {
    const members = group.products.map((m) => ({
      productId: m.productId,
      saleUnit: canonicalizePresentationUnit(m.saleUnit),
      conversionFactor: Number(m.conversionFactor),
      isCanonical: m.isCanonical,
      isPackagePresentation: m.isPackagePresentation,
    }));
    const changes = group.products.flatMap((m) => {
      const next = canonicalizePresentationUnit(m.saleUnit);
      const out: string[] = [];
      if (next !== m.saleUnit) out.push(`se vende por ${m.saleUnit} → ${next}`);
      if (m.product.unit !== next) out.push(`unidad del producto ${m.product.unit} → ${next}`);
      return out.length ? [`   ${m.product.sku} ${m.product.name}: ${out.join(", ")}`] : [];
    });
    if (changes.length === 0) continue;

    const collisions = findUnitCollisions(members);
    if (collisions.length > 0) {
      console.log(`!! ${group.code} (${group.name}): se OMITE — normalizada, ${collisions[0].unit} quedaría repetida. Corregir a mano en Presentaciones.`);
      continue;
    }
    groupsToFix += 1;
    console.log(`Fusión ${group.code} (${group.name}):\n${changes.join("\n")}`);
    if (APPLY) {
      await updateStockGroup(group.id, { members }, ACTOR_USER_ID);
      console.log("   ✓ aplicado");
    }
  }
  console.log(`\nFusiones a corregir: ${groupsToFix} de ${groups.length}.\n`);

  // ── 1. Productos sin fusión ──
  const rows = await prisma.$queryRaw<Array<{ unit: string; n: number }>>`
    SELECT unit, COUNT(*)::int AS n FROM "Product" GROUP BY unit ORDER BY n DESC`;
  let productsToFix = 0;
  for (const row of rows) {
    const next = canonicalizePresentationUnit(row.unit);
    if (next === row.unit) continue;
    const where = { unit: row.unit, id: { notIn: [...memberIds] } };
    const count = await prisma.product.count({ where });
    if (count === 0) continue;
    productsToFix += count;
    console.log(`Productos "${row.unit}" → "${next}": ${count}`);
    if (APPLY) {
      await prisma.product.updateMany({ where, data: { unit: next } });
      await logAuditEvent({
        actorUserId: ACTOR_USER_ID,
        module: "catalog",
        action: "PRODUCT_UNIT_NORMALIZED",
        entityType: "Product",
        entityId: `unit:${row.unit}`,
        metadataJson: { from: row.unit, to: next, count, script: "normalize-product-units.ts" },
      });
      console.log("   ✓ aplicado");
    }
  }
  console.log(`\nProductos sin fusión a corregir: ${productsToFix}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
