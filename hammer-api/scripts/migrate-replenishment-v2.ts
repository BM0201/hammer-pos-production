/**
 * Migración de datos — Reposición v2 (fusión de Motor 1 + Motor 2 en un solo motor).
 *
 * Qué hace:
 *  1. Reporte de divergencia: para cada StockReorderPolicy ACTIVA (que ahora es
 *     directamente el "override manual" del motor único — no se transforma, se
 *     reutiliza tal cual), compara su punto/objetivo manual contra lo que el modo
 *     AUTO (demanda real) habría calculado, ordenado por % de divergencia — para
 *     que un humano revise los casos extremos.
 *  2. Cierra toda ReorderAlert en OPEN → DISMISSED (el Motor 1 ya no genera alertas
 *     nuevas; las abiertas quedan huérfanas y confunden la UI histórica).
 *  3. Cierra todo ReorderSuggestionBatch en DRAFT → DISMISSED (el enum real
 *     ReorderSuggestionStatus solo tiene DRAFT/CONVERTED/DISMISSED — no existe un
 *     valor "DISCARDED" ni un estado "REVIEWED" para batches; se usa DISMISSED,
 *     adaptación respecto al prompt original).
 *  4. ReplenishmentDraft existentes NO se tocan — los campos nuevos de Fase 1.4
 *     (supplierId, estimatedUnitCost, addedManually) son todos opcionales/con
 *     default, así que los borradores viejos siguen siendo válidos tal cual.
 *
 * Idempotente: correrlo dos veces no duplica nada (solo actúa sobre registros en
 * estado OPEN/DRAFT, que quedan en un estado terminal la primera vez).
 *
 * Uso:
 *   npx tsx scripts/migrate-replenishment-v2.ts            # dry-run (solo reporta)
 *   npx tsx scripts/migrate-replenishment-v2.ts --apply     # ejecuta de verdad
 */
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { getReplenishmentRecommendations } from "@/modules/inventory/replenishment-service";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`${apply ? "[APLICANDO]" : "[DRY-RUN]"} Migración Reposición v2 — fusión de motores.\n`);

  /* 1. Reporte de divergencia */
  const activePolicies = await prisma.stockReorderPolicy.findMany({
    where: { isActive: true },
    include: {
      branch: { select: { id: true, code: true } },
      product: { select: { id: true, sku: true, name: true } },
    },
  });

  const autoRecommendationsByBranch = new Map<string, Awaited<ReturnType<typeof getReplenishmentRecommendations>>["recommendations"]>();
  for (const branchId of new Set(activePolicies.map((p) => p.branchId))) {
    const { recommendations } = await getReplenishmentRecommendations({ branchId });
    autoRecommendationsByBranch.set(branchId, recommendations);
  }

  type DivergenceRow = {
    branchCode: string;
    sku: string;
    name: string;
    manualReorderPoint: number;
    manualTarget: number;
    autoReorderPoint: number | null;
    autoTarget: number | null;
    divergencePercent: number | null;
  };

  const divergences: DivergenceRow[] = activePolicies.map((policy) => {
    const autoRecs = autoRecommendationsByBranch.get(policy.branchId) ?? [];
    const autoRec = autoRecs.find((r) => r.productId === policy.productId) ?? null;
    const manualTarget = Number(policy.targetQuantity) + Number(policy.safetyStock);
    const autoTarget = autoRec ? autoRec.targetStock : null;
    const divergencePercent = autoTarget && autoTarget > 0 ? (Math.abs(manualTarget - autoTarget) / autoTarget) * 100 : null;
    return {
      branchCode: policy.branch.code,
      sku: policy.product.sku,
      name: policy.product.name,
      manualReorderPoint: Number(policy.reorderPoint),
      manualTarget,
      autoReorderPoint: autoRec ? autoRec.reorderPoint : null,
      autoTarget,
      divergencePercent,
    };
  });
  divergences.sort((a, b) => (b.divergencePercent ?? -1) - (a.divergencePercent ?? -1));

  console.log(`Overrides manuales activos (StockReorderPolicy): ${activePolicies.length}.`);
  console.log("Se mantienen tal cual — son directamente el override del motor único, no requieren transformación de datos.\n");
  console.log("Reporte de divergencia (override manual vs. lo que el modo auto calcularía), ordenado por % de divergencia:\n");
  console.log("Sucursal | SKU | Producto | Punto manual | Objetivo manual | Punto auto | Objetivo auto | Divergencia");
  console.log("-".repeat(110));
  for (const row of divergences.slice(0, 50)) {
    const divergenceLabel = row.divergencePercent === null ? "—" : `${row.divergencePercent.toFixed(1)}%`;
    console.log(`${row.branchCode} | ${row.sku} | ${row.name} | ${row.manualReorderPoint} | ${row.manualTarget} | ${row.autoReorderPoint ?? "—"} | ${row.autoTarget ?? "—"} | ${divergenceLabel}`);
  }
  if (divergences.length > 50) console.log(`… y ${divergences.length - 50} fila(s) más omitidas del reporte impreso.`);

  /* 2. Alertas OPEN → DISMISSED */
  const openAlerts = await prisma.reorderAlert.findMany({
    where: { status: "OPEN" },
    select: { id: true, branchId: true, productId: true },
  });
  console.log(`\nAlertas OPEN a cerrar: ${openAlerts.length}.`);
  if (apply) {
    for (const alert of openAlerts) {
      await prisma.reorderAlert.update({ where: { id: alert.id }, data: { status: "DISMISSED", resolvedAt: new Date() } });
      await logAuditEvent({
        branchId: alert.branchId,
        module: "reorder",
        action: "MIGRATED_TO_REPLENISHMENT_V2",
        entityType: "ReorderAlert",
        entityId: alert.id,
        metadataJson: { reason: "Fusión de motores — Reposición v2", productId: alert.productId },
      });
    }
  }

  /* 3. Lotes DRAFT → DISMISSED */
  const draftBatches = await prisma.reorderSuggestionBatch.findMany({
    where: { status: "DRAFT" },
    select: { id: true, branchId: true },
  });
  console.log(`Lotes de sugerencias DRAFT a cerrar: ${draftBatches.length}.`);
  if (apply) {
    for (const batch of draftBatches) {
      await prisma.reorderSuggestionBatch.update({ where: { id: batch.id }, data: { status: "DISMISSED" } });
      await logAuditEvent({
        branchId: batch.branchId,
        module: "reorder",
        action: "MIGRATED_TO_REPLENISHMENT_V2",
        entityType: "ReorderSuggestionBatch",
        entityId: batch.id,
        metadataJson: { reason: "Fusión de motores — Reposición v2" },
      });
    }
  }

  /* 4. ReplenishmentDraft — solo reporte, no se tocan (cambio aditivo) */
  const activeDraftsCount = await prisma.replenishmentDraft.count({ where: { status: { in: ["DRAFT", "REVIEWED"] } } });
  console.log(`\nPlanes de reposición en borrador existentes: ${activeDraftsCount} — se conservan tal cual (los campos nuevos de Fase 1.4 son opcionales).`);

  console.log(`\n${apply ? "Migración aplicada." : "Nada fue modificado (dry-run). Ejecutar con --apply para aplicar de verdad."}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
