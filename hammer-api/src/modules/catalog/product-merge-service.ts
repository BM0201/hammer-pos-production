import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createInventoryMovementTx } from "@/modules/inventory/service";
import { normalizeManualSku } from "@/modules/catalog/sku-generator";

/**
 * prompt-codigos-y-duplicados.md Fase 3 — unificar productos duplicados.
 * "No unificar productos reales en producción para probar." / "Ante la
 * duda, bloquear: una unificación que no se puede hacer limpia no se hace,
 * se explica por qué." — por eso el motor separa SIEMPRE preview (solo
 * lectura, puede llamarse las veces que haga falta) de mergeProducts
 * (ejecuta, una sola vez, con lock+CAS igual que el resto de esta sesión).
 *
 * B (mergedProductId) NUNCA se borra: queda isActive=false y
 * mergedIntoProductId apuntando a A (survivingProductId). Su historial de
 * ventas/movimientos/etc. se queda intacto apuntándole a ÉL — es un hecho
 * que ocurrió cuando B todavía era su propio producto, reescribirlo sería
 * mentir sobre el pasado. Lo único que de verdad se MUEVE a A es lo que
 * sigue siendo accionable hacia adelante (políticas, alertas, recetas,
 * borradores) y el stock físico (vía movimientos nuevos, no un ajuste
 * directo al balance).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type MergeRelationPolicyKind =
  | "MOVE"
  | "CHOOSE"
  | "CLOSE"
  | "BLOCK"
  | "BLOCK_IF_OPEN"
  | "STOCK_TRANSFER"
  | "CONDITION_STOCK_TRANSFER"
  | "UNIQUE_REDIRECT"
  | "BARCODE_TRANSFER";

type MergeRelationPolicyEntry = { kind: MergeRelationPolicyKind; label: string };

/**
 * UNA entrada por cada relación de Product que representa datos del
 * NEGOCIO (no la contabilidad de la fusión en sí — category es el propio
 * FK de A/B, nunca "un hijo" que mover; mergedInto/mergedFrom/mergesAsSurvivor/
 * mergeAsMerged son la fusión misma). product-merge-service.test.ts cruza
 * esto contra Prisma.dmmf para que una relación NUEVA que alguien agregue a
 * schema.prisma algún día no quede silenciosamente sin decidir qué hacer
 * con ella al fusionar.
 *
 * - MOVE: se reasigna el FK a A sin condición — configuración futura, sin
 *   riesgo de choque de unicidad.
 * - CHOOSE: hay una restricción @@unique que compartir con A (ej. por
 *   sucursal) — la fila de A gana si choca, la de B se mueve si no.
 * - CLOSE: se queda intacta apuntando a B — es un hecho histórico (venta,
 *   movimiento, análisis, consumo de producción) que ocurrió cuando B
 *   todavía existía como su propio producto.
 * - BLOCK / BLOCK_IF_OPEN: la fusión no se ejecuta si hay algo acá (ver
 *   checkBlockers).
 * - STOCK_TRANSFER / CONDITION_STOCK_TRANSFER / UNIQUE_REDIRECT /
 *   BARCODE_TRANSFER: lógica a medida (no una reasignación genérica de FK),
 *   documentada en mergeProductsTx.
 */
export const MERGE_RELATION_POLICY: Record<string, MergeRelationPolicyEntry> = {
  inventoryBalances: { kind: "STOCK_TRANSFER", label: "Existencias" },
  inventoryConditionBalances: { kind: "CONDITION_STOCK_TRANSFER", label: "Existencias por condición (dañados)" },
  inventoryMovements: { kind: "CLOSE", label: "Movimientos de inventario (Kardex)" },
  orderLines: { kind: "CLOSE", label: "Líneas de venta" },
  saleReturnItems: { kind: "CLOSE", label: "Devoluciones" },
  transferLines: { kind: "CLOSE", label: "Traslados" },
  internalFreightLines: { kind: "CLOSE", label: "Viajes de flete interno" },
  purchaseOrderLines: { kind: "BLOCK_IF_OPEN", label: "Órdenes de compra" },
  timberProduct: { kind: "UNIQUE_REDIRECT", label: "Configuración de madera" },
  productPricings: { kind: "CLOSE", label: "Historial de cálculo de precios" },
  branchProductSettings: { kind: "CHOOSE", label: "Configuración por sucursal" },
  productAnalytics: { kind: "CLOSE", label: "Analítica de ventas" },
  reorderPolicies: { kind: "CHOOSE", label: "Políticas de reposición" },
  reorderAlerts: { kind: "MOVE", label: "Alertas de reposición" },
  reorderSuggestionLines: { kind: "MOVE", label: "Líneas de sugerencia de reposición" },
  stockGroupMemberships: { kind: "BLOCK", label: "Membresía de fusión de inventario" },
  recipesAsOutput: { kind: "MOVE", label: "Recetas donde es el producto terminado" },
  recipesAsInput: { kind: "MOVE", label: "Recetas donde es insumo" },
  batchInputs: { kind: "CLOSE", label: "Consumo de lotes de producción" },
  recipesAsSecondGrade: { kind: "MOVE", label: "Recetas donde es el producto de segunda" },
  brainDecisions: { kind: "CLOSE", label: "Decisiones del Brain" },
  replenishmentDraftItems: { kind: "MOVE", label: "Borradores de reposición" },
  priceUpdateLines: { kind: "CLOSE", label: "Líneas de carga de precios" },
  barcodes: { kind: "BARCODE_TRANSFER", label: "Códigos de barra" },
};

/**
 * Relaciones de Product que NO son datos de negocio a decidir: category es
 * el propio FK que Product ya tiene (A se queda con el suyo, el de B no
 * importa); las otras 4 son la fusión en sí (el campo/tabla que ESTE
 * módulo escribe, no algo preexistente que fusionar). product-merge-
 * service.test.ts las excluye explícitamente al cruzar contra el DMMF.
 */
export const MERGE_POLICY_EXCLUDED_RELATIONS = ["category", "mergedInto", "mergedFrom", "mergesAsSurvivor", "mergeAsMerged"];

/** relación → {delegate de Prisma, campo FK} — para el MOVE/CHOOSE/CLOSE genérico y sus conteos en el preview. */
const RELATION_FK: Record<string, { delegate: string; fk: string }> = {
  inventoryMovements: { delegate: "inventoryMovement", fk: "productId" },
  orderLines: { delegate: "saleOrderLine", fk: "productId" },
  saleReturnItems: { delegate: "saleReturnItem", fk: "productId" },
  transferLines: { delegate: "transferLine", fk: "productId" },
  internalFreightLines: { delegate: "internalFreightTripLine", fk: "productId" },
  purchaseOrderLines: { delegate: "purchaseOrderLine", fk: "productId" },
  productPricings: { delegate: "productPricing", fk: "productId" },
  branchProductSettings: { delegate: "branchProductSetting", fk: "productId" },
  productAnalytics: { delegate: "productAnalytics", fk: "productId" },
  reorderPolicies: { delegate: "stockReorderPolicy", fk: "productId" },
  reorderAlerts: { delegate: "reorderAlert", fk: "productId" },
  reorderSuggestionLines: { delegate: "reorderSuggestionLine", fk: "productId" },
  recipesAsOutput: { delegate: "productionRecipe", fk: "finishedProductId" },
  recipesAsInput: { delegate: "productionRecipeInput", fk: "inputProductId" },
  batchInputs: { delegate: "productionBatchInput", fk: "inputProductId" },
  recipesAsSecondGrade: { delegate: "productionRecipe", fk: "secondGradeProductId" },
  brainDecisions: { delegate: "brainDecision", fk: "productId" },
  replenishmentDraftItems: { delegate: "replenishmentDraftItem", fk: "productId" },
  priceUpdateLines: { delegate: "priceUpdateLine", fk: "productId" },
};
/** Relaciones CHOOSE y su clave de conflicto compartida con A (además de productId). */
const CHOOSE_CONFLICT_KEY: Record<string, string> = {
  branchProductSettings: "branchId",
  reorderPolicies: "branchId",
};

export type MergeBlocker = { code: string; message: string };
export type MergeWarning = { code: string; message: string };
export type MergePlanLine = { relation: string; label: string; kind: MergeRelationPolicyKind; count: number; conflictCount?: number };

export type MergePreview = {
  survivingProductId: string;
  mergedProductId: string;
  survivingSku: string;
  survivingName: string;
  mergedSku: string;
  mergedName: string;
  blockers: MergeBlocker[];
  warnings: MergeWarning[];
  plan: MergePlanLine[];
  canExecute: boolean;
};

async function loadMergeCandidates(db: Db, survivingProductId: string, mergedProductId: string) {
  if (survivingProductId === mergedProductId) {
    throw new Error("VALIDATION_ERROR: un producto no se puede fusionar consigo mismo.");
  }
  const [survivor, merged] = await Promise.all([
    db.product.findUnique({ where: { id: survivingProductId }, select: { id: true, sku: true, name: true, unit: true, isActive: true, mergedIntoProductId: true } }),
    db.product.findUnique({ where: { id: mergedProductId }, select: { id: true, sku: true, name: true, unit: true, isActive: true, mergedIntoProductId: true } }),
  ]);
  if (!survivor) throw new Error("NOT_FOUND: el producto principal no existe.");
  if (!merged) throw new Error("NOT_FOUND: el producto a fusionar no existe.");
  return { survivor, merged };
}

/**
 * Vista previa, de solo lectura — puede llamarse cuantas veces haga falta
 * sin efecto alguno. Cuenta cada relación de B bajo su política, calcula
 * bloqueos (nunca se pueden pasar por alto) y avisos (cuentan qué se
 * perdería/movería, para que la decisión de ejecutar sea informada).
 */
export async function previewMerge(
  input: { survivingProductId: string; mergedProductId: string; confirmUnitMismatch?: boolean },
  db: Db = prisma,
): Promise<MergePreview> {
  const { survivor, merged } = await loadMergeCandidates(db, input.survivingProductId, input.mergedProductId);

  const blockers: MergeBlocker[] = [];
  const warnings: MergeWarning[] = [];
  const plan: MergePlanLine[] = [];

  if (merged.mergedIntoProductId) {
    blockers.push({ code: "ALREADY_MERGED", message: `${merged.name} ya fue fusionado anteriormente.` });
  }
  if (!merged.isActive && !merged.mergedIntoProductId) {
    warnings.push({ code: "MERGED_PRODUCT_INACTIVE", message: `${merged.name} ya está inactivo — se fusiona igual, no cambia nada sobre eso.` });
  }

  // Unidad distinta: "ante la duda, bloquear" salvo confirmación explícita
  // de quien ve los dos productos y decide que las cantidades SÍ son
  // comparables 1:1 (no hay fusión de stock-group de por medio: eso ya se
  // bloquea aparte, abajo).
  if (survivor.unit !== merged.unit && !input.confirmUnitMismatch) {
    blockers.push({
      code: "UNIT_MISMATCH",
      message: `Unidad distinta: ${survivor.sku} usa "${survivor.unit}", ${merged.sku} usa "${merged.unit}". Confirmá que las cantidades son equivalentes antes de continuar.`,
    });
  }

  // stockGroupMemberships — bloqueo incondicional: la fusión de presentaciones
  // (Caja/Unidad/Libra) ya resuelve "mismo material, otra escala" con su
  // propio factor; mezclar los dos mecanismos sobre el mismo producto es
  // ambigüedad que un humano tiene que desenredar primero, no este motor.
  const [survivorInGroup, mergedInGroup] = await Promise.all([
    db.productStockGroupMember.count({ where: { productId: survivor.id, isActive: true, stockGroup: { isActive: true } } }),
    db.productStockGroupMember.count({ where: { productId: merged.id, isActive: true, stockGroup: { isActive: true } } }),
  ]);
  const stockGroupCount = survivorInGroup + mergedInGroup;
  if (stockGroupCount > 0) {
    blockers.push({ code: "STOCK_GROUP_MEMBER", message: "Uno de los dos productos es parte de una fusión de presentaciones (Inventario → Fusiones). Resolvé esa fusión antes de unificar productos." });
  }
  plan.push({ relation: "stockGroupMemberships", label: MERGE_RELATION_POLICY.stockGroupMemberships.label, kind: "BLOCK", count: stockGroupCount });

  // purchaseOrderLines — bloqueo si hay una PO de B todavía DRAFT/APPROVED
  // (en curso); las ya RECEIVED/CANCELLED son historial, se mueven igual
  // que el resto de las líneas MOVE (no tienen por qué quedarse huérfanas
  // de un producto inactivo en un reporte de compras futuro).
  const [openPoCount, totalPoCount] = await Promise.all([
    db.purchaseOrderLine.count({ where: { productId: merged.id, purchaseOrder: { status: { in: ["DRAFT", "APPROVED"] } } } }),
    db.purchaseOrderLine.count({ where: { productId: merged.id } }),
  ]);
  if (openPoCount > 0) {
    blockers.push({ code: "OPEN_PURCHASE_ORDER", message: `${merged.name} tiene ${openPoCount} línea(s) en una orden de compra todavía abierta (borrador o aprobada).` });
  }
  plan.push({ relation: "purchaseOrderLines", label: MERGE_RELATION_POLICY.purchaseOrderLines.label, kind: "BLOCK_IF_OPEN", count: totalPoCount });

  // timberProduct — to-one inverso de un @unique: si AMBOS tienen uno, no
  // hay forma limpia de elegir cuál config de madera sobrevive sin perder
  // la otra en silencio — se bloquea y se explica por qué.
  const [survivorTimber, mergedTimber] = await Promise.all([
    db.timberProduct.findUnique({ where: { productId: survivor.id }, select: { id: true } }),
    db.timberProduct.findUnique({ where: { productId: merged.id }, select: { id: true } }),
  ]);
  if (survivorTimber && mergedTimber) {
    blockers.push({ code: "TIMBER_CONFIG_CONFLICT", message: "Los dos productos tienen su propia configuración de madera — no se puede elegir cuál sobrevive automáticamente." });
  }
  plan.push({ relation: "timberProduct", label: MERGE_RELATION_POLICY.timberProduct.label, kind: "UNIQUE_REDIRECT", count: mergedTimber ? 1 : 0 });

  // Stock físico — cuántas sucursales de B tienen balance (para el aviso,
  // el conteo real de UNIDADES vive en el preview de cada sucursal, no acá).
  const mergedBalances = await db.inventoryBalance.findMany({ where: { productId: merged.id }, select: { quantityOnHand: true } });
  plan.push({ relation: "inventoryBalances", label: MERGE_RELATION_POLICY.inventoryBalances.label, kind: "STOCK_TRANSFER", count: mergedBalances.length });
  const mergedConditionBalances = await db.inventoryConditionBalance.findMany({ where: { productId: merged.id }, select: { quantity: true } });
  plan.push({ relation: "inventoryConditionBalances", label: MERGE_RELATION_POLICY.inventoryConditionBalances.label, kind: "CONDITION_STOCK_TRANSFER", count: mergedConditionBalances.length });

  // barcodes
  const barcodeCount = await db.productBarcode.count({ where: { productId: merged.id } });
  plan.push({ relation: "barcodes", label: MERGE_RELATION_POLICY.barcodes.label, kind: "BARCODE_TRANSFER", count: barcodeCount });

  // Genéricas MOVE/CHOOSE/CLOSE
  for (const [relation, entry] of Object.entries(MERGE_RELATION_POLICY)) {
    if (relation === "purchaseOrderLines") continue; // ya contada arriba (BLOCK_IF_OPEN tiene su propio conteo open/total)
    const fkEntry = RELATION_FK[relation];
    if (!fkEntry) continue; // ya cubiertas arriba (bespoke)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (db as any)[fkEntry.delegate];
    const count: number = await delegate.count({ where: { [fkEntry.fk]: merged.id } });
    let conflictCount: number | undefined;
    const conflictKey = CHOOSE_CONFLICT_KEY[relation];
    if (entry.kind === "CHOOSE" && conflictKey && count > 0) {
      const mergedRows: Array<Record<string, unknown>> = await delegate.findMany({ where: { [fkEntry.fk]: merged.id }, select: { [conflictKey]: true } });
      const keys = mergedRows.map((row) => row[conflictKey]);
      const resolvedConflictCount: number = keys.length > 0
        ? await delegate.count({ where: { [fkEntry.fk]: survivor.id, [conflictKey]: { in: keys } } })
        : 0;
      conflictCount = resolvedConflictCount;
      if (resolvedConflictCount > 0) {
        warnings.push({ code: `${relation.toUpperCase()}_CONFLICT`, message: `${resolvedConflictCount} de ${entry.label.toLowerCase()} de ${merged.name} ya existen para ${survivor.name} en la misma sucursal — se descartan las de ${merged.name}.` });
      }
    }
    plan.push({ relation, label: entry.label, kind: entry.kind, count, conflictCount });
  }

  const canExecute = blockers.length === 0;
  return {
    survivingProductId: survivor.id,
    mergedProductId: merged.id,
    survivingSku: survivor.sku,
    survivingName: survivor.name,
    mergedSku: merged.sku,
    mergedName: merged.name,
    blockers,
    warnings,
    plan,
    canExecute,
  };
}

/**
 * Ejecuta la fusión. Vuelve a correr previewMerge DENTRO de la transacción
 * (nunca confía en un preview pedido antes — el estado pudo cambiar) y
 * bloquea ambas filas de Product (FOR UPDATE, ordenadas por id para evitar
 * deadlock con una fusión concurrente en sentido contrario) antes de
 * decidir nada. confirmedMergedSku es la confirmación "escribí el SKU de
 * B" — un 400 si no coincide, para que ejecutar una fusión real nunca sea
 * un solo click sin releer qué se está por hacer.
 */
export async function mergeProductsTx(
  tx: Prisma.TransactionClient,
  input: {
    survivingProductId: string;
    mergedProductId: string;
    confirmedMergedSku: string;
    confirmUnitMismatch?: boolean;
    reason?: string;
    actorUserId: string;
  },
) {
  const ids = [input.survivingProductId, input.mergedProductId].sort();
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id IN (${ids[0]}, ${ids[1]}) ORDER BY id FOR UPDATE`;

  const preview = await previewMerge({ survivingProductId: input.survivingProductId, mergedProductId: input.mergedProductId, confirmUnitMismatch: input.confirmUnitMismatch }, tx);
  if (!preview.canExecute) {
    throw new Error(`MERGE_BLOCKED: ${preview.blockers.map((b) => b.message).join(" ")}`);
  }
  if (normalizeManualSku(input.confirmedMergedSku) !== normalizeManualSku(preview.mergedSku)) {
    throw new Error("VALIDATION_ERROR: el SKU de confirmación no coincide con el del producto a fusionar.");
  }

  const survivingProductId = preview.survivingProductId;
  const mergedProductId = preview.mergedProductId;

  // ── Stock físico: por cada sucursal donde B tiene balance, sale de B con
  // PRODUCT_MERGE_OUT y entra a A con PRODUCT_MERGE_IN al MISMO costo (el
  // WAC vivo de B en esa sucursal) — createInventoryMovementTx recalcula el
  // WAC de A exactamente como lo haría un ADJUSTMENT_IN cualquiera. ──
  const mergedBalances = await tx.inventoryBalance.findMany({ where: { productId: mergedProductId } });
  for (const balance of mergedBalances) {
    const qty = balance.quantityOnHand;
    if (qty.lte(0)) continue;
    const unitCost = balance.weightedAverageCost.gt(0) ? balance.weightedAverageCost : new Prisma.Decimal(0.01);
    await createInventoryMovementTx(tx, {
      actorUserId: input.actorUserId,
      branchId: balance.branchId,
      productId: mergedProductId,
      movementType: "PRODUCT_MERGE_OUT",
      quantity: Number(qty),
      unitCost: Number(unitCost),
      referenceType: "PRODUCT_MERGE",
      referenceId: mergedProductId,
      notes: `Unificado en ${preview.survivingSku}`,
      allowHighUnitCost: true,
      allowLargeWacJump: true,
    });
    await createInventoryMovementTx(tx, {
      actorUserId: input.actorUserId,
      branchId: balance.branchId,
      productId: survivingProductId,
      movementType: "PRODUCT_MERGE_IN",
      quantity: Number(qty),
      unitCost: Number(unitCost),
      referenceType: "PRODUCT_MERGE",
      referenceId: survivingProductId,
      notes: `Recibido de ${preview.mergedSku} (unificación)`,
      allowHighUnitCost: true,
      allowLargeWacJump: true,
    });
  }

  // ── Existencias por condición (dañados) — solo cantidad, sin costo: suma
  // directa a la fila de A (crea si no existía), vacía la de B. ──
  const mergedConditionBalances = await tx.inventoryConditionBalance.findMany({ where: { productId: mergedProductId } });
  for (const row of mergedConditionBalances) {
    if (row.quantity.lte(0)) continue;
    await tx.inventoryConditionBalance.upsert({
      where: { branchId_productId_condition: { branchId: row.branchId, productId: survivingProductId, condition: row.condition } },
      create: { branchId: row.branchId, productId: survivingProductId, condition: row.condition, quantity: row.quantity },
      update: { quantity: { increment: row.quantity } },
    });
    await tx.inventoryConditionBalance.update({ where: { id: row.id }, data: { quantity: 0 } });
  }

  // ── Códigos de barra — todos los de B pasan a A; si A no tenía ninguno,
  // el más viejo de los recién movidos se vuelve su principal. ──
  const mergedBarcodes = await tx.productBarcode.findMany({ where: { productId: mergedProductId }, orderBy: { createdAt: "asc" } });
  if (mergedBarcodes.length > 0) {
    await tx.productBarcode.updateMany({ where: { productId: mergedProductId }, data: { productId: survivingProductId, isPrimary: false } });
    const survivorHasPrimary = await tx.productBarcode.findFirst({ where: { productId: survivingProductId, isPrimary: true } });
    if (!survivorHasPrimary) {
      const oldest = mergedBarcodes[0];
      await tx.productBarcode.update({ where: { id: oldest.id }, data: { isPrimary: true } });
      await tx.product.update({ where: { id: survivingProductId }, data: { barcode: oldest.code } });
    }
  }

  // ── timberProduct — solo puede haber uno de los dos (el preview ya
  // bloqueó si ambos tenían); si era el de B, se redirige a A. ──
  const mergedTimber = await tx.timberProduct.findUnique({ where: { productId: mergedProductId } });
  if (mergedTimber) {
    await tx.timberProduct.update({ where: { id: mergedTimber.id }, data: { productId: survivingProductId } });
  }

  // ── Genéricas MOVE/CHOOSE/CLOSE ──
  for (const [relation, entry] of Object.entries(MERGE_RELATION_POLICY)) {
    const fkEntry = RELATION_FK[relation];
    if (!fkEntry) continue;
    if (entry.kind === "CLOSE") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (tx as any)[fkEntry.delegate];
    const conflictKey = CHOOSE_CONFLICT_KEY[relation];
    if (entry.kind === "CHOOSE" && conflictKey) {
      const survivorRows: Array<Record<string, unknown>> = await delegate.findMany({ where: { [fkEntry.fk]: survivingProductId }, select: { [conflictKey]: true } });
      const takenKeys = survivorRows.map((row) => row[conflictKey]);
      await delegate.updateMany({
        where: { [fkEntry.fk]: mergedProductId, ...(takenKeys.length > 0 ? { [conflictKey]: { notIn: takenKeys } } : {}) },
        data: { [fkEntry.fk]: survivingProductId },
      });
      // Las que SÍ chocan se quedan en B (ya se avisó en el preview) — B
      // queda inactivo, no vuelven a aparecer en ninguna pantalla activa.
    } else {
      await delegate.updateMany({ where: { [fkEntry.fk]: mergedProductId }, data: { [fkEntry.fk]: survivingProductId } });
    }
  }

  // ── Cierre: B queda inactivo y redirigido; el registro de auditoría ──
  await tx.product.update({ where: { id: mergedProductId }, data: { isActive: false, mergedIntoProductId: survivingProductId } });

  const merge = await tx.productMerge.create({
    data: {
      survivingProductId,
      mergedProductId,
      survivingSku: preview.survivingSku,
      survivingName: preview.survivingName,
      mergedSku: preview.mergedSku,
      mergedName: preview.mergedName,
      reason: input.reason ?? null,
      planJson: preview.plan as unknown as Prisma.InputJsonValue,
      executedByUserId: input.actorUserId,
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      module: "catalog",
      action: "PRODUCT_MERGED",
      entityType: "Product",
      entityId: survivingProductId,
      metadataJson: {
        mergeId: merge.id,
        survivingSku: preview.survivingSku,
        mergedSku: preview.mergedSku,
        mergedProductId,
        reason: input.reason ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  return merge;
}

export async function mergeProducts(
  input: {
    survivingProductId: string;
    mergedProductId: string;
    confirmedMergedSku: string;
    confirmUnitMismatch?: boolean;
    reason?: string;
    actorUserId: string;
  },
) {
  return prisma.$transaction((tx) => mergeProductsTx(tx, input));
}

export async function listProductMerges(survivingProductId: string, db: Db = prisma) {
  return db.productMerge.findMany({ where: { survivingProductId }, orderBy: { executedAt: "desc" } });
}
