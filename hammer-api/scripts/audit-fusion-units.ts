/**
 * Audita TODAS las fusiones activas buscando el defecto de "fusión ciega a
 * unidades": dos o más miembros con la misma unidad de venta, o unidad de
 * venta idéntica al baseUnit del grupo en un miembro derivado. En ese estado
 * el asistente rotula todas las filas igual ("1 UNIDAD = __ UNIDAD"), el
 * usuario no puede distinguir qué está editando, y los factores cargados no
 * son confiables. Solo lee — no escribe nada.
 *
 * Uso: npx tsx scripts/audit-fusion-units.ts
 */
import { prisma } from "@/lib/prisma";
import { findDuplicateFactors, findUnitCollisions, normalizePresentationUnit } from "@/modules/catalog/presentation-units";

async function main() {
  const groups = await prisma.productStockGroup.findMany({
    where: { isActive: true },
    include: {
      products: {
        where: { isActive: true },
        include: { product: { select: { sku: true, name: true } } },
        orderBy: { isCanonical: "desc" },
      },
    },
    orderBy: { code: "asc" },
  });

  console.log(`Auditando ${groups.length} fusión(es) activa(s).\n`);

  let flaggedGroups = 0;

  for (const group of groups) {
    const members = group.products.map((m) => ({
      productId: m.productId,
      sku: m.product.sku,
      productName: m.product.name,
      saleUnit: m.saleUnit,
      conversionFactor: Number(m.conversionFactor),
      isCanonical: m.isCanonical,
    }));

    const unitCollisions = findUnitCollisions(members);
    // La quinta condición del bug: un derivado con la misma unidad que el
    // baseUnit del grupo (no necesariamente colisiona ENTRE derivados, pero
    // sí contra la base — igual de ciego para el usuario).
    const derivedMatchingBase = members.filter(
      (m) => !m.isCanonical && normalizePresentationUnit(m.saleUnit) === normalizePresentationUnit(group.baseUnit),
    );
    const duplicateFactors = findDuplicateFactors(members);

    const hasIssues = unitCollisions.length > 0 || derivedMatchingBase.length > 0 || duplicateFactors.length > 0;
    if (hasIssues) flaggedGroups++;

    console.log(`${hasIssues ? "⚠" : "✓"} ${group.code} — ${group.name} (baseUnit: ${group.baseUnit})`);
    for (const m of members) {
      console.log(
        `    ${m.sku} · ${m.productName} · saleUnit=${m.saleUnit} · factor=${m.conversionFactor} · ${m.isCanonical ? "CANONICAL" : "derivado"}`,
      );
    }
    if (unitCollisions.length > 0) {
      for (const c of unitCollisions) {
        console.log(`    !! COLISIÓN DE UNIDAD "${c.unit}": ${c.productIds.length} miembros comparten esta unidad de venta.`);
      }
    }
    if (derivedMatchingBase.length > 0) {
      console.log(`    !! DERIVADO = BASE: ${derivedMatchingBase.map((m) => m.sku).join(", ")} usa la misma unidad que el baseUnit del grupo ("${group.baseUnit}").`);
    }
    if (duplicateFactors.length > 0) {
      for (const d of duplicateFactors) {
        console.log(`    !! FACTOR DUPLICADO ${d.factor}: ${d.productIds.length} derivados comparten este factor entre sí.`);
      }
    }
    console.log("");
  }

  console.log("-".repeat(80));
  console.log(`Fusiones con algún defecto: ${flaggedGroups} de ${groups.length}.`);
  console.log("Esta lista es la que hay que recargar manualmente en la Fase 4 — ningún número se adivina.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
