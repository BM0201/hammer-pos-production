import { InventoryMovementType, Prisma, PrismaClient } from "@prisma/client";
import { recalculateWeightedAverage } from "@/modules/inventory/wac";
import { resolveInventoryProductForMovement } from "@/modules/inventory/unit-conversion";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * "que el WAC deje de moverse sin que nadie lo decida, y poder ver de
 * dónde salió cada valor" — PARTE A. wac.ts:recalculateWeightedAverage es
 * correcto y NO se toca; lo que faltaba era reproducir, movimiento por
 * movimiento, la misma cuenta que ya hace createInventoryMovementTx en
 * producción, para poder AUDITAR el resultado en vez de confiar a ciegas.
 *
 * Clasificación explícita de InventoryMovementType para la reconstrucción
 * — NO es la misma clasificación que reports/movement-groups.ts (esa
 * agrupa el reporte de Movimientos; esta decide si un movimiento tocó
 * weightedAverageCost/quantityOnHand o no). Verificada contra el código
 * real que crea cada tipo, no adivinada:
 *  - PACKAGE_IN / LOOSE_UNIT_RETURN_IN: inventory/service.ts las usa como
 *    la etiqueta "efectiva" de PURCHASE_IN/RETURN_IN cuando la composición
 *    es PACKAGES/LOOSE — mismo efecto en el WAC que su original.
 *  - PACKAGE_SALE_OUT / LOOSE_UNIT_SALE_OUT: mismo caso para SALE_OUT.
 *  - PACKAGE_OPENED / PACKAGE_AUTO_OPENED / PACKAGE_CLOSED: reconversión
 *    cerrado↔suelto — createInventoryMovementTx las escribe SIN tocar
 *    weightedAverageCost y sin cambiar la cantidad equivalente neta.
 *    Replayarlas como entrada o salida corrompería la reconstrucción, así
 *    que se EXCLUYEN.
 *  - RETURN_IN_DAMAGED: sales-returns/service.ts la escribe contra
 *    InventoryConditionBalance (bodega de dañados), nunca contra el
 *    InventoryBalance/WAC normal — se EXCLUYE.
 *  - LOOSE_ADJUSTMENT / PACKAGE_ADJUSTMENT: no se crean en ningún flujo
 *    actual (verificado con grep, mismo hallazgo que movement-groups.ts)
 *    — se EXCLUYEN en vez de adivinar su efecto.
 */
const WAC_REPLAY_INBOUND = new Set<InventoryMovementType>([
  "PURCHASE_IN",
  "RETURN_IN",
  "ADJUSTMENT_IN",
  "TRANSFER_IN",
  "TIMBER_INTAKE_IN",
  "PRODUCTION_OUTPUT",
  "PRODUCTION_REVERSAL_IN",
  "PACKAGE_IN",
  "LOOSE_UNIT_RETURN_IN",
]);

const WAC_REPLAY_OUTBOUND = new Set<InventoryMovementType>([
  "SALE_OUT",
  "RETURN_OUT",
  "ADJUSTMENT_OUT",
  "TRANSFER_OUT",
  "PRODUCTION_CONSUME",
  "PRODUCTION_WASTE",
  "PRODUCTION_REVERSAL_OUT",
  "PACKAGE_SALE_OUT",
  "LOOSE_UNIT_SALE_OUT",
]);

export type WacHistoryMovementInput = {
  id: string;
  createdAt: Date;
  movementType: string;
  referenceType: string;
  referenceId: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  conversionFactorSnapshot: Prisma.Decimal | null;
  inputUnit: string | null;
  inputQuantity: Prisma.Decimal | null;
  userId: string | null;
  notes: string | null;
};

export type WacHistoryRow = {
  movementId: string;
  createdAt: Date;
  movementType: string;
  referenceType: string;
  referenceId: string;
  quantity: number;
  unitCost: number;
  conversionFactorSnapshot: number | null;
  inputUnit: string | null;
  inputQuantity: number | null;
  wacBefore: number;
  wacAfter: number;
  wacDelta: number;
  wacDeltaPercent: number | null;
  actorUserId: string | null;
  notes: string | null;
  /** true para PACKAGE_OPENED/PACKAGE_AUTO_OPENED/PACKAGE_CLOSED/RETURN_IN_DAMAGED — no participaron del WAC, se muestran igual en la línea de tiempo pero sin efecto. */
  excludedFromReplay: boolean;
};

export type WacHistoryReconstruction = {
  rows: WacHistoryRow[];
  reconstructedWac: number;
  reconstructedQty: number;
};

/**
 * Pura, testeable sin base de datos — reproduce paso a paso la MISMA
 * cuenta que createInventoryMovementTx, con recalculateWeightedAverage,
 * sobre una lista de movimientos ya ordenada por createdAt ascendente.
 */
export function reconstructWacHistory(movements: WacHistoryMovementInput[]): WacHistoryReconstruction {
  let currentQty = new Prisma.Decimal(0);
  let currentWac = new Prisma.Decimal(0);
  const rows: WacHistoryRow[] = [];

  for (const m of movements) {
    const isInbound = WAC_REPLAY_INBOUND.has(m.movementType as InventoryMovementType);
    const isOutbound = WAC_REPLAY_OUTBOUND.has(m.movementType as InventoryMovementType);

    const baseFields = {
      movementId: m.id,
      createdAt: m.createdAt,
      movementType: m.movementType,
      referenceType: m.referenceType,
      referenceId: m.referenceId,
      quantity: Number(m.quantity),
      unitCost: Number(m.unitCost),
      conversionFactorSnapshot: m.conversionFactorSnapshot !== null ? Number(m.conversionFactorSnapshot) : null,
      inputUnit: m.inputUnit,
      inputQuantity: m.inputQuantity !== null ? Number(m.inputQuantity) : null,
      actorUserId: m.userId,
      notes: m.notes,
    };

    if (!isInbound && !isOutbound) {
      rows.push({
        ...baseFields,
        wacBefore: Number(currentWac),
        wacAfter: Number(currentWac),
        wacDelta: 0,
        wacDeltaPercent: 0,
        excludedFromReplay: true,
      });
      continue;
    }

    const wacBefore = currentWac;

    // Reversión EXPLICIT con costo 0 (venta legado sin costo registrado):
    // restaura cantidad SIN tocar el WAC — mismo caso especial que
    // zeroCostExplicitRestore en createInventoryMovementTx.
    const zeroCostRestore = isInbound && m.unitCost.eq(0);

    let next: { newQty: Prisma.Decimal; newWac: Prisma.Decimal };
    if (zeroCostRestore) {
      next = { newQty: currentQty.add(m.quantity), newWac: currentWac };
    } else {
      try {
        next = recalculateWeightedAverage({
          currentQty,
          currentWac,
          movementQty: m.quantity,
          movementUnitCost: m.unitCost,
          inbound: isInbound,
        });
      } catch {
        // Un movimiento inconsistente con el estado reconstruido hasta acá
        // (p.ej. una salida mayor al saldo reconstruido) no debe tumbar
        // todo el reporte — se preserva el estado previo y se marca la
        // fila como excluida para que quede visible, no oculta.
        rows.push({
          ...baseFields,
          wacBefore: Number(wacBefore),
          wacAfter: Number(wacBefore),
          wacDelta: 0,
          wacDeltaPercent: 0,
          excludedFromReplay: true,
        });
        continue;
      }
    }

    currentQty = next.newQty;
    currentWac = next.newWac;

    const wacDelta = currentWac.sub(wacBefore);
    const wacDeltaPercent = wacBefore.gt(0) ? wacDelta.div(wacBefore).mul(100) : null;

    rows.push({
      ...baseFields,
      wacBefore: Number(wacBefore),
      wacAfter: Number(currentWac),
      wacDelta: Number(wacDelta),
      wacDeltaPercent: wacDeltaPercent !== null ? Number(wacDeltaPercent) : null,
      excludedFromReplay: false,
    });
  }

  return { rows, reconstructedWac: Number(currentWac), reconstructedQty: Number(currentQty) };
}

export class WacHistoryNotFoundError extends Error {
  constructor() {
    super("PRODUCT_NOT_FOUND");
    this.name = "WacHistoryNotFoundError";
  }
}

/**
 * Cara con base de datos — resuelve fusión (A.2), trae los movimientos
 * reales y el balance actual, reconstruye, y devuelve la discrepancia
 * explícita si `reconstructed` no coincide con `stored`. Epsilon de 0.01
 * para la comparación: la misma aritmética Decimal no garantiza igualdad
 * bit-a-bit tras muchas divisiones encadenadas, pero cualquier diferencia
 * real (una escritura fuera del historial) es órdenes de magnitud mayor.
 */
export async function getWacHistory(db: DbClient, input: { productId: string; branchId: string }) {
  const resolved = await resolveInventoryProductForMovement(db, input.productId);
  const canonicalProductId = resolved.inventoryProductId;
  const isDerived = canonicalProductId !== input.productId;

  const [movements, balance, canonicalProduct, requestedProduct] = await Promise.all([
    db.inventoryMovement.findMany({
      where: { branchId: input.branchId, productId: canonicalProductId },
      orderBy: { createdAt: "asc" },
    }),
    db.inventoryBalance.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: canonicalProductId } },
    }),
    db.product.findUnique({ where: { id: canonicalProductId }, select: { id: true, sku: true, name: true } }),
    isDerived
      ? db.product.findUnique({ where: { id: input.productId }, select: { id: true, sku: true, name: true } })
      : Promise.resolve(null),
  ]);

  if (!canonicalProduct) throw new WacHistoryNotFoundError();

  const userIds = [...new Set(movements.map((m) => m.userId).filter((id): id is string => !!id))];
  const actors = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, fullName: true } })
    : [];
  const actorNameById = new Map(actors.map((a) => [a.id, a.fullName || a.username]));

  const { rows, reconstructedWac, reconstructedQty } = reconstructWacHistory(movements);
  const rowsWithActor = rows.map((row) => ({
    ...row,
    actorName: row.actorUserId ? actorNameById.get(row.actorUserId) ?? null : null,
  }));

  const stored = Number(balance?.weightedAverageCost ?? 0);
  const matches = Math.abs(reconstructedWac - stored) < 0.01;

  const breakdownByReferenceType: Record<string, number> = {};
  for (const row of rows) {
    if (row.excludedFromReplay) continue;
    breakdownByReferenceType[row.referenceType] = (breakdownByReferenceType[row.referenceType] ?? 0) + 1;
  }

  const conversionFactor = isDerived && resolved.conversion ? Number(resolved.conversion.conversionFactor) : null;

  return {
    productId: input.productId,
    branchId: input.branchId,
    requestedSku: requestedProduct?.sku ?? null,
    requestedName: requestedProduct?.name ?? null,
    isDerived,
    canonicalProductId: isDerived ? canonicalProductId : null,
    canonicalSku: isDerived ? canonicalProduct.sku : null,
    canonicalName: isDerived ? canonicalProduct.name : null,
    conversionFactor,
    fusionNote: isDerived
      ? `El costo vive en ${canonicalProduct.sku}; esta presentación lo multiplica por ${conversionFactor}.`
      : null,
    currentWac: stored,
    movementCount: rows.filter((r) => !r.excludedFromReplay).length,
    breakdownByReferenceType,
    rows: rowsWithActor,
    reconstructed: reconstructedWac,
    reconstructedQty,
    stored,
    matches,
  };
}
