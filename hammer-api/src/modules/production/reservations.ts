import { Prisma } from "@prisma/client";
import { getProductStockConversion, getSharedInventoryBalance, convertSaleQtyToBaseQty } from "@/modules/inventory/unit-conversion";

/**
 * Producción v2 Fase 2 — reserva de insumos al planificar un lote.
 *
 * No existía ningún mecanismo de reserva de stock en el proyecto (se
 * verificó: ni ventas ni traslados apartan inventario) — este es nuevo,
 * deliberadamente mínimo: un campo `reservedQuantity` en ProductionBatchInput
 * (unidad de venta del insumo) que getProductionReservedBaseQtyTx sabe leer
 * y convertir a unidades base para que el resto del sistema (POS, otros
 * lotes) vea el stock reservado como no disponible.
 *
 * Vive en su propio módulo (no en inventory/service.ts) para evitar un
 * import circular: inventory/service.ts necesita leer la reserva, pero
 * production/service.ts ya importa de inventory/service.ts.
 */

export type ReservationResult = {
  inputProductId: string;
  requestedQuantity: number;
  reservedQuantity: number;
  shortfall: number;
};

/**
 * Reserva lo disponible de cada insumo del lote (hasta su plannedQuantity).
 * El faltante NO bloquea — se reserva lo que hay y se reporta el shortfall
 * para que el llamador decida (advertencia + oferta de reposición).
 */
export async function reserveBatchInputsTx(
  tx: Prisma.TransactionClient,
  input: { batchId: string; branchId: string },
): Promise<ReservationResult[]> {
  const batchInputs = await tx.productionBatchInput.findMany({
    where: { batchId: input.batchId },
    select: { id: true, inputProductId: true, plannedQuantity: true, reservedQuantity: true },
  });

  const results: ReservationResult[] = [];
  for (const bi of batchInputs) {
    const shared = await getSharedInventoryBalance(tx, { branchId: input.branchId, productId: bi.inputProductId });
    const conversion = shared.conversion;
    const physicalBaseQty = shared.balance?.quantityOnHand ?? new Prisma.Decimal(0);
    const alreadyReservedBaseQty = conversion
      ? convertSaleQtyToBaseQty({ quantity: bi.reservedQuantity, conversionFactor: conversion.conversionFactor })
      : new Prisma.Decimal(bi.reservedQuantity);
    // Reservado por OTROS lotes (excluyendo este) — sin restarlo, dos lotes
    // podrían reservar el mismo stock físico dos veces, ya que reservar no
    // toca InventoryBalance.quantityOnHand.
    const reservedByOthersBaseQty = await getProductionReservedBaseQtyTx(tx, {
      branchId: input.branchId,
      productId: bi.inputProductId,
      excludeBatchId: input.batchId,
    });
    // Stock libre = lo físico − lo que otros lotes ya apartaron + lo que ESTE
    // input ya tenía reservado (para poder re-planificar sin que la reserva
    // propia cuente como "no disponible" contra sí misma).
    const freeBaseQty = Prisma.Decimal.max(0, physicalBaseQty.sub(reservedByOthersBaseQty)).add(alreadyReservedBaseQty);
    const plannedBaseQty = conversion
      ? convertSaleQtyToBaseQty({ quantity: bi.plannedQuantity, conversionFactor: conversion.conversionFactor })
      : new Prisma.Decimal(bi.plannedQuantity);

    const reservedBaseQty = Prisma.Decimal.min(freeBaseQty, plannedBaseQty);
    const reservedSaleQty = conversion
      ? reservedBaseQty.div(conversion.conversionFactor)
      : reservedBaseQty;

    await tx.productionBatchInput.update({
      where: { id: bi.id },
      data: { reservedQuantity: reservedSaleQty },
    });

    const shortfallSaleQty = new Prisma.Decimal(bi.plannedQuantity).sub(reservedSaleQty);
    results.push({
      inputProductId: bi.inputProductId,
      requestedQuantity: Number(bi.plannedQuantity),
      reservedQuantity: Number(reservedSaleQty),
      shortfall: shortfallSaleQty.gt(0) ? Number(shortfallSaleQty) : 0,
    });
  }
  return results;
}

/** Libera toda reserva activa del lote (cancelar) o la consume (completar). */
export async function releaseBatchInputsTx(tx: Prisma.TransactionClient, batchId: string): Promise<void> {
  await tx.productionBatchInput.updateMany({
    where: { batchId },
    data: { reservedQuantity: 0 },
  });
}

/**
 * Total reservado (por otros lotes PLANNED/IN_PROGRESS) de un insumo en una
 * sucursal, en unidades BASE — para restar de la disponibilidad de venta/traslado.
 */
export async function getProductionReservedBaseQtyTx(
  tx: Prisma.TransactionClient,
  input: { branchId: string; productId: string; excludeBatchId?: string },
): Promise<Prisma.Decimal> {
  const rows = await tx.productionBatchInput.findMany({
    where: {
      inputProductId: input.productId,
      reservedQuantity: { gt: 0 },
      batch: {
        branchId: input.branchId,
        status: { in: ["PLANNED", "IN_PROGRESS"] },
        ...(input.excludeBatchId ? { id: { not: input.excludeBatchId } } : {}),
      },
    },
    select: { reservedQuantity: true },
  });
  if (rows.length === 0) return new Prisma.Decimal(0);
  const totalSaleUnits = rows.reduce((sum, r) => sum.add(r.reservedQuantity), new Prisma.Decimal(0));
  const conversion = await getProductStockConversion(tx, input.productId);
  return conversion
    ? convertSaleQtyToBaseQty({ quantity: totalSaleUnits, conversionFactor: conversion.conversionFactor })
    : totalSaleUnits;
}
