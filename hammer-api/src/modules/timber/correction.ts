/** Corregir un viaje YA ingresado: dentro de las 24 h, solo Master, por diferencia contra lo que el viaje ya metió. */
import { prisma } from "@/lib/prisma";
import { calculateReconciliation, type TimberPriceGroup } from "./calculator";
import { buildTimberTripRecalc, tripCorrectableUntil } from "./trips";
import { applyTimberCostsTx, currentBranchSellingPrice, resolveTimberProductIdentityTx } from "./catalog-link";
import type { UpdateTimberTripInput } from "./validators";
import { createInventoryMovementTx } from "@/modules/inventory/service";
import { isInboundMovement } from "@/modules/inventory/wac";

/** Efecto en inventario de una medida del viaje, en piezas con signo. */
export type TripStockEffect = { productId: string; pieces: number; unitCost: number };

/**
 * Lo que tiene que moverse para que el inventario quede como si el viaje se hubiera ingresado
 * ya corregido: por producto, piezas nuevas − piezas netas que el viaje ya metió (ingreso y
 * correcciones anteriores). Por diferencia y no "sacar todo y volver a meter": si se vendió
 * parte, solo falla la medida a la que se le quitan más piezas de las que quedan.
 */
export function planTripCorrection(prior: TripStockEffect[], next: TripStockEffect[]): TripStockEffect[] {
  const net = new Map<string, TripStockEffect>();
  for (const effect of prior) {
    const current = net.get(effect.productId);
    net.set(effect.productId, { productId: effect.productId, pieces: (current?.pieces ?? 0) - effect.pieces, unitCost: current?.unitCost ?? effect.unitCost });
  }
  for (const effect of next) {
    const current = net.get(effect.productId);
    // El costo nuevo manda; una medida que sale del viaje se retira con su costo de entrada.
    net.set(effect.productId, { productId: effect.productId, pieces: (current?.pieces ?? 0) + effect.pieces, unitCost: effect.unitCost });
  }
  return [...net.values()].filter((delta) => delta.pieces !== 0);
}

/** "Ya se vendió": dice qué medida y cuántas quedan, en vez del INSUFFICIENT_STOCK genérico. */
export function tripCorrectionStockError(productName: string, toRemove: number, available: number) {
  const plural = (count: number) => `${count} pieza${count === 1 ? "" : "s"}`;
  return Object.assign(
    new Error(
      `No se puede quitar ${plural(toRemove)} de ${productName}: solo quedan ${plural(available)} en bodega (el resto ya se vendió o se movió). ` +
        `Dejá al menos ${plural(toRemove - available)} más en esa medida.`,
    ),
    { code: "TRIP_CORRECTION_STOCK_SOLD" },
  );
}

/** Igual que al ingresar: alguna medida queda vendiéndose bajo su costo → hay que escribir el motivo. */
export function tripCorrectionNegativeMarginError(lines: Array<{ productName: string; costPerPiece: number; sellingPrice: number }>) {
  const money = (value: number) => `C$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const detail = lines.map((line) => `${line.productName} queda a ${money(line.sellingPrice)} con costo ${money(line.costPerPiece)}`).join("; ");
  return Object.assign(new Error(`Al menos una medida queda vendiéndose bajo su costo: ${detail}. Escribí el motivo para guardar igual, o cambiá la política de precio.`), {
    code: "NEGATIVE_MARGIN_REQUIRES_OVERRIDE",
  });
}

/**
 * Corrige un viaje YA ingresado dentro de las 24 h del ingreso. En una sola transacción:
 * recalcula el viaje con los cambios, vuelve a escribir costo/precio de cada medida con la
 * política del viaje (igual que al ingresar) y ajusta el inventario por la diferencia contra lo
 * que el viaje ya había metido. Conserva número, estado y hora de ingreso (el plazo no se
 * reinicia con cada corrección). Queda en la bitácora con el antes → después.
 */
export async function correctTimberTrip(
  id: string,
  userId: string,
  input: UpdateTimberTripInput,
  options: { marginOverrideReason?: string } = {},
  now: Date = new Date(),
) {
  const marginOverrideReason = options.marginOverrideReason?.trim() || null;
  const existing = await prisma.timberTrip.findUnique({ where: { id }, include: { lines: true } });
  if (!existing) throw new Error("TIMBER_TRIP_NOT_FOUND");
  if (existing.status !== "TRANSFERRED") throw new Error("TRIP_NOT_CORRECTABLE");
  if (!tripCorrectableUntil(existing, now)) throw new Error("TRIP_CORRECTION_WINDOW_CLOSED");

  const { calc, data, pricing: config } = await buildTimberTripRecalc(existing, input);
  if (!calc.lines.some((line) => line.pieces > 0)) throw new Error("TRIP_HAS_NO_LINES");
  if (calc.totals.woodTripTotalCost <= 0 || calc.totals.landedCostPerFoot <= 0) throw new Error("TRIP_REQUIRES_COST");

  return prisma.$transaction(async (tx) => {
    // Mismo candado que confirmar/editar: dos correcciones a la vez no se pisan.
    await tx.$queryRaw`SELECT id FROM "TimberTrip" WHERE id = ${id} FOR UPDATE`;
    const locked = await tx.timberTrip.findUniqueOrThrow({ where: { id }, select: { status: true, updatedAt: true } });
    if (locked.status !== "TRANSFERRED") throw new Error("TRIP_NOT_CORRECTABLE");
    if (locked.updatedAt.getTime() !== existing.updatedAt.getTime()) throw new Error("TRIP_CHANGED_WHILE_CORRECTING");

    const priorMovements = await tx.inventoryMovement.findMany({
      where: { referenceType: "TIMBER_TRIP", referenceId: id },
      select: { productId: true, inputProductId: true, inputQuantity: true, quantity: true, unitCost: true, movementType: true },
    });
    const prior: TripStockEffect[] = priorMovements.map((movement) => {
      const pieces = (movement.inputQuantity ?? movement.quantity).toNumber();
      return {
        productId: movement.inputProductId ?? movement.productId,
        pieces: isInboundMovement(movement.movementType) ? pieces : -pieces,
        unitCost: movement.unitCost.toNumber(),
      };
    });

    await tx.timberTripLine.deleteMany({ where: { tripId: id } });
    const updated = await tx.timberTrip.update({ where: { id }, data, include: { lines: true, destinationBranch: true } });

    const updateGlobalPrice = updated.pricePolicy === "RECALC_FROM_PRICE_PER_INCH" && !config.isBranchOverride;
    const next: TripStockEffect[] = [];
    const belowCost: Array<{ productId: string; costPerPiece: number; sellingPrice: number }> = [];
    for (const line of updated.lines) {
      if (line.pieces <= 0) continue;
      const { productId, timberProductId } = await resolveTimberProductIdentityTx(tx, line);
      const unitCost = line.calculatedCostPerPiece.gt(0) ? line.calculatedCostPerPiece.toNumber() : line.calculatedCostFeet.toNumber() / line.pieces;
      const { after } = await applyTimberCostsTx(tx, {
        actorUserId: userId,
        branchId: updated.destinationBranchId,
        productId,
        timberProductId,
        priceGroup: line.priceGroup as TimberPriceGroup,
        boardFeet: line.calculatedFeet.div(line.pieces).toNumber(),
        pricePerInch: line.calculatedSalePricePerPiece.div((line.thicknessIn * line.widthIn * line.varaLength) || 1).toNumber(),
        varaLength: line.varaLength,
        costPerPiece: unitCost,
        recalculatedSellingPrice: line.calculatedSalePricePerPiece.toNumber(),
        pricePolicy: updated.pricePolicy,
        targetMarginPercent: config.targetMarginPercent,
        targetMarginRoundingMultiple: config.targetMarginRoundingMultiple,
        updateGlobalPrice,
      });
      await tx.timberTripLine.update({ where: { id: line.id }, data: { timberProductId } });
      next.push({ productId, pieces: line.pieces, unitCost });
      const sellingPrice = currentBranchSellingPrice(after);
      if (sellingPrice !== null && sellingPrice < unitCost) belowCost.push({ productId, costPerPiece: unitCost, sellingPrice });
    }

    // Misma regla que confirmar: margen negativo solo pasa con motivo escrito (queda en el viaje y la bitácora).
    if (config.blockNegativeMargin && belowCost.length > 0 && !marginOverrideReason) {
      const names = new Map((await tx.product.findMany({ where: { id: { in: belowCost.map((l) => l.productId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
      throw tripCorrectionNegativeMarginError(belowCost.map((l) => ({ ...l, productName: names.get(l.productId) ?? l.productId })));
    }
    const finalTrip = belowCost.length > 0
      ? await tx.timberTrip.update({ where: { id }, data: { marginOverrideReason }, include: { lines: true, destinationBranch: true } })
      : updated;

    const deltas = planTripCorrection(prior, next);
    for (const delta of deltas) {
      const productName = async () => (await tx.product.findUniqueOrThrow({ where: { id: delta.productId }, select: { name: true } })).name;
      if (delta.pieces < 0) {
        const balance = await tx.inventoryBalance.findUnique({
          where: { branchId_productId: { branchId: updated.destinationBranchId, productId: delta.productId } },
          select: { quantityOnHand: true },
        });
        const available = balance?.quantityOnHand.toNumber() ?? 0;
        if (available < -delta.pieces) throw tripCorrectionStockError(await productName(), -delta.pieces, available);
      }
      try {
        await createInventoryMovementTx(tx, {
          actorUserId: userId,
          branchId: updated.destinationBranchId,
          productId: delta.productId,
          // Sube: entrada de madera que suma. Baja: corrección que resta del ingreso del viaje (no un ajuste de conteo).
          movementType: delta.pieces > 0 ? "TIMBER_INTAKE_IN" : "TIMBER_INTAKE_CORRECTION_OUT",
          quantity: Math.abs(delta.pieces),
          unitCost: delta.unitCost,
          referenceType: "TIMBER_TRIP",
          referenceId: id,
          notes: `Corrección del viaje de madera ${updated.tripCode} (${delta.pieces > 0 ? "+" : ""}${delta.pieces} piezas)`,
        });
      } catch (error) {
        // Producto en una fusión: el saldo de arriba no es el del grupo. Mismo mensaje claro.
        if (error instanceof Error && error.message.startsWith("INSUFFICIENT_")) {
          throw tripCorrectionStockError(await productName(), -delta.pieces, 0);
        }
        throw error;
      }
    }

    const snapshot = (trip: typeof existing) => ({
      totalPieces: trip.totalPieces,
      totalFeet: trip.totalFeet.toString(),
      woodTripTotalCost: trip.woodTripTotalCost.toString(),
      tripExpensesTotal: trip.tripExpensesTotal.toString(),
      landedCostPerFoot: trip.landedCostPerFoot.toString(),
      lines: trip.lines.map((l) => ({ thickness: l.thicknessIn, width: l.widthIn, length: l.lengthIn, pieces: l.pieces })),
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        branchId: updated.destinationBranchId,
        module: "timber",
        action: "TIMBER_TRIP_CORRECTED",
        entityType: "TimberTrip",
        entityId: id,
        metadataJson: {
          tripCode: updated.tripCode,
          before: snapshot(existing),
          after: snapshot(updated),
          stockDeltas: deltas,
          belowCostLines: belowCost,
          marginOverrideReason: belowCost.length > 0 ? marginOverrideReason : null,
        },
      },
    });

    // Mismo shape que getTimberTrip/confirmTimberTrip: `reconciliation` siempre presente.
    const reconciliation = calculateReconciliation(
      updated.totalFeet.toNumber(),
      updated.invoicedFeet != null ? updated.invoicedFeet.toNumber() : null,
      config.reconciliationTolerancePercent,
    );
    return { ...finalTrip, reconciliation, correctableUntil: tripCorrectableUntil(finalTrip, now) };
    // Igual que confirmar: la hoja real trae ~50 medidas y cada una son ~20 consultas.
  }, { timeout: 60000, maxWait: 10000 });
}
