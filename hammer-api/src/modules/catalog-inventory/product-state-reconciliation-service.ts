import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { refreshProductStateTx, discoverRelevantPairs } from "@/modules/catalog-inventory/product-state-service";
import { makeDecisionFingerprint, riskScoreFor, priorityScoreFor } from "@/modules/brain/scoring";

/**
 * prompt-inventario-v3.md Fase 1 — las dos tareas nocturnas que el doc pide
 * para ProductBranchState (cron cleanup):
 *
 * 1. reconcileSales90dTx: units90d/revenue90d NUNCA se recalculan en cada
 *    venta (el incremento, product-state-service.ts, es una suma barata) —
 *    acá sí se recalculan DE VERDAD desde SaleOrderLine (90 días, mismo
 *    patrón/ventana que analytics/abc-classifier.ts), corrigiendo cualquier
 *    desvío (devoluciones, anulaciones, la ventana que envejece).
 *
 * 2. compareProductStateSample: toma una muestra al azar, vuelve a correr
 *    refreshProductStateTx para esas filas EXACTAS (el mismo escritor de
 *    siempre — no una segunda implementación del cálculo) y compara
 *    antes/después. Si algo cambió, es que esa fila estaba vieja — alguna
 *    escritura real no la refrescó (o su try/catch se comió un error de
 *    verdad). Doble función: detecta Y cura en el mismo golpe.
 */

const SALE_STATUSES = ["PAID", "DISPATCH_PENDING", "DISPATCHED"] as const;
const RECONCILE_WINDOW_DAYS = 90;

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export async function reconcileSales90dTx(db: PrismaClient = prisma): Promise<{ rowsUpdated: number }> {
  const since = new Date(Date.now() - RECONCILE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const sales = await db.saleOrderLine.groupBy({
    by: ["productId", "branchId"],
    _sum: { quantity: true, lineSubtotal: true },
    where: {
      branchId: { not: null },
      saleOrder: { status: { in: [...SALE_STATUSES] }, createdAt: { gte: since } },
    },
  });

  let rowsUpdated = 0;
  for (const row of sales) {
    if (!row.branchId) continue;
    await db.productBranchState.upsert({
      where: { productId_branchId: { productId: row.productId, branchId: row.branchId } },
      create: {
        productId: row.productId,
        branchId: row.branchId,
        units90d: new Prisma.Decimal(decimalToNumber(row._sum.quantity)),
        revenue90d: new Prisma.Decimal(decimalToNumber(row._sum.lineSubtotal)),
      },
      update: {
        units90d: new Prisma.Decimal(decimalToNumber(row._sum.quantity)),
        revenue90d: new Prisma.Decimal(decimalToNumber(row._sum.lineSubtotal)),
      },
    });
    rowsUpdated += 1;
  }

  // Filas con ventas hace más de 90 días (ya fuera de la ventana) y que
  // nadie tocó esta noche quedan con un units90d/revenue90d viejo si no se
  // ponen en 0 explícitamente — groupBy de arriba solo trae las que SÍ
  // vendieron en la ventana.
  const staleRows = await db.productBranchState.findMany({
    where: {
      OR: [{ units90d: { gt: 0 } }, { revenue90d: { gt: 0 } }],
    },
    select: { productId: true, branchId: true },
  });
  const soldKeys = new Set(sales.filter((s) => s.branchId).map((s) => `${s.productId}:${s.branchId}`));
  for (const row of staleRows) {
    const key = `${row.productId}:${row.branchId}`;
    if (soldKeys.has(key)) continue;
    await db.productBranchState.update({
      where: { productId_branchId: { productId: row.productId, branchId: row.branchId } },
      data: { units90d: new Prisma.Decimal(0), revenue90d: new Prisma.Decimal(0) },
    });
    rowsUpdated += 1;
  }

  return { rowsUpdated };
}

export type ProductStateDriftFinding = {
  productId: string;
  branchId: string;
  field: string;
  before: string;
  after: string;
};

/**
 * Muestra al azar de ProductBranchState, re-refrescada con el mismo
 * escritor de siempre — compara los campos que SÍ debería recalcular
 * (todo salvo units90d/revenue90d, que este sample no toca a propósito).
 */
export async function compareProductStateSample(sampleSize = 200, db: PrismaClient = prisma): Promise<{ sampled: number; drifted: ProductStateDriftFinding[] }> {
  const sample = await db.$queryRaw<Array<{ productId: string; branchId: string; quantityOnHand: Prisma.Decimal; effectiveCost: Prisma.Decimal | null; effectivePrice: Prisma.Decimal | null; marginPercent: Prisma.Decimal | null; stockStatus: string; reorderPoint: Prisma.Decimal | null }>>`
    SELECT "productId", "branchId", "quantityOnHand", "effectiveCost", "effectivePrice", "marginPercent", "stockStatus"::text, "reorderPoint"
    FROM "ProductBranchState"
    ORDER BY random()
    LIMIT ${sampleSize}
  `;
  if (sample.length === 0) return { sampled: 0, drifted: [] };

  const before = new Map(sample.map((row) => [`${row.productId}:${row.branchId}`, row]));

  for (const row of sample) {
    await refreshProductStateTx(db, [row.productId], [row.branchId]);
  }

  const after = await db.productBranchState.findMany({
    where: { OR: sample.map((row) => ({ productId: row.productId, branchId: row.branchId })) },
    select: { productId: true, branchId: true, quantityOnHand: true, effectiveCost: true, effectivePrice: true, marginPercent: true, stockStatus: true, reorderPoint: true },
  });

  const drifted: ProductStateDriftFinding[] = [];
  const FIELDS = ["quantityOnHand", "effectiveCost", "effectivePrice", "marginPercent", "stockStatus", "reorderPoint"] as const;
  for (const afterRow of after) {
    const key = `${afterRow.productId}:${afterRow.branchId}`;
    const beforeRow = before.get(key);
    if (!beforeRow) continue;
    for (const field of FIELDS) {
      const beforeValue = beforeRow[field];
      const afterValue = afterRow[field];
      const beforeStr = beforeValue instanceof Prisma.Decimal ? beforeValue.toString() : String(beforeValue ?? "null");
      const afterStr = afterValue instanceof Prisma.Decimal ? afterValue.toString() : String(afterValue ?? "null");
      if (beforeStr !== afterStr) {
        drifted.push({ productId: afterRow.productId, branchId: afterRow.branchId, field, before: beforeStr, after: afterStr });
      }
    }
  }

  if (drifted.length > 0) {
    await raiseProductStateDriftDecision(drifted, sample.length, db);
  }

  return { sampled: sample.length, drifted };
}

async function raiseProductStateDriftDecision(drifted: ProductStateDriftFinding[], sampleSize: number, db: PrismaClient): Promise<void> {
  const confidenceScore = 0.95;
  const severity = "LOW" as const;
  const riskScore = riskScoreFor(severity, confidenceScore);
  const priorityScore = priorityScoreFor({ severity, riskScore, confidenceScore, impactAmount: 0 });
  const fingerprint = makeDecisionFingerprint(["PRODUCT_STATE_DRIFT", new Date().toISOString().slice(0, 10)]);

  const affectedProductIds = [...new Set(drifted.map((d) => d.productId))];

  await db.brainDecision.upsert({
    where: { fingerprint },
    create: {
      fingerprint,
      category: "SYSTEM",
      severity,
      title: `Estado de inventario desactualizado en ${affectedProductIds.length} producto(s)`,
      description: `La comparación nocturna de ProductBranchState encontró ${drifted.length} campo(s) desactualizados de una muestra de ${sampleSize} filas — alguna escritura no refrescó el estado precalculado a tiempo.`,
      recommendation: "Ya se corrigió solo al detectarlo (el muestreo vuelve a escribir la fila). Si esto se repite seguido, hay un escritor sin conectar a refreshProductStateTx.",
      branchId: null,
      confidenceScore: new Prisma.Decimal(confidenceScore),
      impactAmount: new Prisma.Decimal(0),
      riskScore: new Prisma.Decimal(riskScore),
      priorityScore: new Prisma.Decimal(priorityScore),
      proposedActionType: "REVIEW_PRODUCT_STATE_DRIFT",
      evidenceJson: { sampleSize, driftCount: drifted.length, findings: drifted.slice(0, 50) } as Prisma.InputJsonValue,
      sourceJson: { source: "cron cleanup — compareProductStateSample" } as Prisma.InputJsonValue,
    },
    update: {
      status: "OPEN",
      lastDetectedAt: new Date(),
      evidenceJson: { sampleSize, driftCount: drifted.length, findings: drifted.slice(0, 50) } as Prisma.InputJsonValue,
    },
  });
}

/**
 * prompt-inventario-inicio-fix.md Commit 3 §2 — "el cron diario
 * reconstruye SOLO los pares faltantes, por tandas". Diagnóstico de
 * producción (2026-10-20) confirmó 0 faltantes reales (ver reporte en el
 * cierre del doc) — esta función queda corriendo igual, de forma
 * preventiva, para el día que un producto/sucursal nuevo quede sin su
 * estado por lo que sea (caída a mitad de una escritura, etc.), sin
 * esperar a que alguien lo note en Inicio.
 *
 * "Faltante" = exactamente lo que discoverRelevantPairs ya considera
 * relevante (señal real en InventoryBalance/BranchProductSetting/
 * StockReorderPolicy) y que todavía no tiene fila en ProductBranchState —
 * nunca "todo producto × toda sucursal" (ver nota de coverage en
 * inventory-list-service.ts: no todos los productos están en todas las
 * sucursales, y eso no es un hueco). ProductCatalogState se arregla gratis
 * cuando refreshProductStateTx corre para esos productos; los que no
 * tienen NINGUNA señal en ninguna sucursal (nunca tocados) igual reciben
 * su ProductCatalogState vacío al final de cada tanda.
 */
export async function backfillMissingProductStatesTx(db: PrismaClient = prisma, batchSize = 200): Promise<{ productsChecked: number; branchPairsBackfilled: number; catalogStatesBackfilled: number }> {
  const activeProducts = await db.product.findMany({ where: { isActive: true }, select: { id: true } });
  const activeProductIds = activeProducts.map((p) => p.id);

  let branchPairsBackfilled = 0;
  let catalogStatesBackfilled = 0;

  for (let i = 0; i < activeProductIds.length; i += batchSize) {
    const batchIds = activeProductIds.slice(i, i + batchSize);

    // Secuencial a propósito (ver nota en discoverRelevantPairs, product-state-service.ts).
    const existingCatalogStates = await db.productCatalogState.findMany({ where: { productId: { in: batchIds } }, select: { productId: true } });
    const existingCatalogSet = new Set(existingCatalogStates.map((s) => s.productId));
    const missingCatalogIds = batchIds.filter((id) => !existingCatalogSet.has(id));

    const signalPairs = await discoverRelevantPairs(db, batchIds);
    const existingBranchStates = await db.productBranchState.findMany({ where: { productId: { in: batchIds } }, select: { productId: true, branchId: true } });
    const existingBranchSet = new Set(existingBranchStates.map((s) => `${s.productId}:${s.branchId}`));
    const missingPairs = signalPairs.filter((pair) => !existingBranchSet.has(`${pair.productId}:${pair.branchId}`));

    const missingByBranch = new Map<string, string[]>();
    for (const pair of missingPairs) {
      const list = missingByBranch.get(pair.branchId) ?? [];
      list.push(pair.productId);
      missingByBranch.set(pair.branchId, list);
    }
    for (const [branchId, productIds] of missingByBranch) {
      await refreshProductStateTx(db, productIds, [branchId]);
      branchPairsBackfilled += productIds.length;
    }

    // Productos sin ProductCatalogState que YA se arreglaron arriba (su
    // branchId faltante era de este mismo batch) no necesitan otra pasada.
    const idsHandledByBranchPass = new Set(missingPairs.map((p) => p.productId));
    const stillMissingCatalogIds = missingCatalogIds.filter((id) => !idsHandledByBranchPass.has(id));
    if (stillMissingCatalogIds.length > 0) {
      await refreshProductStateTx(db, stillMissingCatalogIds);
    }
    catalogStatesBackfilled += missingCatalogIds.length;
  }

  return { productsChecked: activeProductIds.length, branchPairsBackfilled, catalogStatesBackfilled };
}
