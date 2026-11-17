/** Ingresar un viaje al inventario: vista previa (antes → después) y confirmación atómica. */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { calculateReconciliation, roundMoney, type TimberPriceGroup } from "./calculator";
import { getPricingConfig } from "./pricing-config";
import { assignTripCodeTx } from "./trips";
import {
  applyTimberCostsTx,
  currentBranchSellingPrice,
  findWoodIdentity,
  resolveTimberProductIdentityTx,
  resolveTripSellingPrice,
  timberCatalogName,
} from "./catalog-link";
import { createInventoryMovementTx } from "@/modules/inventory/service";

type ResolvedLineForInjection = {
  lineId: string;
  dimensions: { thickness: number; width: number; length: number };
  priceGroup: TimberPriceGroup;
  varaLength: number;
  pieces: number;
  boardFeet: number;
  productId: string | null;
  timberProductId: string | null;
  isNewProduct: boolean;
  productName: string;
  sku: string | null;
  costPerPiece: number;
  pricePerInch: number;
  recalculatedSellingPrice: number;
};

/** Resuelve, SIN escribir nada, la identidad (existente o "nuevo") de cada línea. */
async function resolveLinesForInjectionReadOnly(
  trip: Prisma.TimberTripGetPayload<{ include: { lines: true } }>,
): Promise<ResolvedLineForInjection[]> {
  const resolved: ResolvedLineForInjection[] = [];
  for (const line of trip.lines) {
    if (line.pieces <= 0) continue;
    const { product, timberProductId } = await findWoodIdentity(prisma, line);
    const productId = product?.id ?? null;

    const costPerPiece = line.calculatedCostPerPiece.gt(0)
      ? line.calculatedCostPerPiece.toNumber()
      : line.pieces > 0
        ? line.calculatedCostFeet.toNumber() / line.pieces
        : 0;

    resolved.push({
      lineId: line.id,
      dimensions: { thickness: line.thicknessIn, width: line.widthIn, length: line.lengthIn },
      priceGroup: line.priceGroup as TimberPriceGroup,
      varaLength: line.varaLength,
      pieces: line.pieces,
      boardFeet: line.calculatedFeet.div(line.pieces).toNumber(),
      productId,
      timberProductId,
      isNewProduct: productId === null,
      productName: product?.name ?? timberCatalogName(line.thicknessIn, line.widthIn, line.varaLength),
      sku: product?.sku ?? null,
      costPerPiece,
      pricePerInch: line.calculatedSalePricePerPiece.div(line.thicknessIn * line.widthIn * line.varaLength || 1).toNumber(),
      recalculatedSellingPrice: line.calculatedSalePricePerPiece.toNumber(),
    });
  }
  return resolved;
}

export type TimberInjectionLinePreview = {
  lineId: string;
  dimensions: { thickness: number; width: number; length: number };
  isNewProduct: boolean;
  productId: string | null;
  /** Producto del catálogo que recibe el stock (o el nombre con el que se creará). */
  productName: string;
  sku: string | null;
  piecesToAdd: number;
  costPerPiece: { before: number | null; after: number };
  wac: { before: number | null; after: number };
  branchCost: { before: number | null; after: number };
  sellingPrice: { before: number | null; after: number };
};

export type TimberInjectionPreview = {
  tripId: string;
  tripCode: string;
  pricePolicy: string;
  lines: TimberInjectionLinePreview[];
  hash: string;
};

/**
 * Madera v2 Fase 2.4 — preview de inyección: por línea, el par ANTES → DESPUÉS de costo
 * unitario, WAC (proyectado con la misma fórmula que usa recalculateWeightedAverage), costo de
 * sucursal y precio de venta, SIN escribir nada. confirmTimberTrip exige el hash de este preview
 * para aplicar — si el inventario cambió entre medias, el hash no coincide y rechaza.
 */
export async function getTimberTripInjectionPreview(id: string): Promise<TimberInjectionPreview> {
  const trip = await prisma.timberTrip.findUnique({ where: { id }, include: { lines: true } });
  if (!trip) throw new Error("TIMBER_TRIP_NOT_FOUND");

  const marginConfig = await getPricingConfig(trip.destinationBranchId);
  const resolvedLines = await resolveLinesForInjectionReadOnly(trip);

  const lines: TimberInjectionLinePreview[] = [];
  for (const line of resolvedLines) {
    const [timberProductBefore, productBefore, balanceBefore, branchSettingBefore] = await Promise.all([
      line.timberProductId ? prisma.timberProduct.findUnique({ where: { id: line.timberProductId } }) : null,
      line.productId ? prisma.product.findUnique({ where: { id: line.productId } }) : null,
      line.productId
        ? prisma.inventoryBalance.findUnique({ where: { branchId_productId: { branchId: trip.destinationBranchId, productId: line.productId } } })
        : null,
      line.productId
        ? prisma.branchProductSetting.findUnique({ where: { branchId_productId: { branchId: trip.destinationBranchId, productId: line.productId } } })
        : null,
    ]);

    const qohActual = balanceBefore?.quantityOnHand.toNumber() ?? 0;
    const wacActual = balanceBefore?.weightedAverageCost.toNumber() ?? 0;
    const wacAfter = (qohActual * wacActual + line.pieces * line.costPerPiece) / (qohActual + line.pieces || 1);

    const current = {
      branchPrice: branchSettingBefore?.branchPrice?.toNumber() ?? null,
      standardSalePrice: productBefore?.standardSalePrice.toNumber() ?? null,
      sellingPrice: timberProductBefore?.sellingPrice.toNumber() ?? null,
    };
    const sellingPriceAfter = resolveTripSellingPrice({
      pricePolicy: trip.pricePolicy,
      recalculatedSellingPrice: line.recalculatedSellingPrice,
      current,
      costPerPiece: line.costPerPiece,
      targetMarginPercent: marginConfig.targetMarginPercent,
      targetMarginRoundingMultiple: marginConfig.targetMarginRoundingMultiple,
    });

    lines.push({
      lineId: line.lineId,
      dimensions: line.dimensions,
      isNewProduct: line.isNewProduct,
      productId: line.productId,
      productName: line.productName,
      sku: line.sku,
      piecesToAdd: line.pieces,
      costPerPiece: { before: timberProductBefore?.baseCost.toNumber() ?? null, after: line.costPerPiece },
      wac: { before: balanceBefore ? wacActual : null, after: roundMoney(wacAfter) },
      branchCost: { before: branchSettingBefore?.branchCost?.toNumber() ?? null, after: line.costPerPiece },
      // "antes" = el precio vigente EN la sucursal destino (lo que se pisa), no el general.
      sellingPrice: { before: currentBranchSellingPrice(current), after: sellingPriceAfter },
    });
  }

  // Sin lineId: updateTimberTrip borra y recrea las líneas en cada guardado
  // (ids nuevos), y la pantalla guarda justo antes de confirmar — con el id
  // en el hash, confirmar desde la UI daba "preview viejo" siempre.
  const hash = createHash("sha256").update(JSON.stringify(lines.map(({ lineId: _lineId, ...rest }) => rest))).digest("hex");
  return { tripId: trip.id, tripCode: trip.tripCode, pricePolicy: trip.pricePolicy, lines, hash };
}

/** Alguna medida queda vendiéndose bajo su costo con el precio que deja la política del viaje. */
export function hasNegativeMarginInPreview(lines: Array<Pick<TimberInjectionLinePreview, "costPerPiece" | "sellingPrice">>): boolean {
  return lines.some((line) => line.sellingPrice.after < line.costPerPiece.after);
}

/**
 * Confirm a timber trip and inject all its lines into the destination branch inventory.
 *
 * This is the single step the user expects from the "Confirmar e insertar en inventario"
 * action: a DRAFT/CUBICADO trip is validated, every line is resolved to a (Product +
 * TimberProduct), costs/prices are ALWAYS written via applyTimberCostsTx (Madera v2 Fase 2 —
 * fixes the bug where they froze at the first trip's values), a TIMBER_INTAKE_IN inventory
 * movement is created for each line, and the trip transitions to TRANSFERRED. Everything runs
 * inside one transaction so it is all-or-nothing.
 *
 * Requires the hash of a freshly-generated injection preview (Fase 2.4) — "nadie inyecta sin
 * ver". If the trip's reconciliation is out of tolerance, requires explicit acknowledgment too.
 */
export async function confirmTimberTrip(
  id: string,
  userId?: string,
  options: { expectedHash?: string; acknowledgeReconciliation?: boolean; marginOverrideReason?: string } = {},
) {
  const trip = await prisma.timberTrip.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!trip) throw new Error("TIMBER_TRIP_NOT_FOUND");
  if (trip.status !== "DRAFT" && trip.status !== "CUBICADO") {
    throw new Error("TRIP_CANNOT_BE_CONFIRMED");
  }
  if (trip.lines.length === 0) {
    throw new Error("TRIP_HAS_NO_LINES");
  }
  // A positive landed cost per board foot is required so inbound inventory movements have a real cost.
  // Y un costo de la MADERA > 0: solo con gastos (flete, etc.) el costo aterrizado salía > 0 sin costo de compra.
  if (trip.woodTripTotalCost.lte(0) || trip.landedCostPerFoot.lte(0)) {
    throw new Error("TRIP_REQUIRES_COST");
  }

  const config = await getPricingConfig(trip.destinationBranchId);
  const reconciliation = calculateReconciliation(
    trip.totalFeet.toNumber(),
    trip.invoicedFeet != null ? trip.invoicedFeet.toNumber() : null,
    config.reconciliationTolerancePercent,
  );
  if (reconciliation.status === "REVIEW" && !options.acknowledgeReconciliation) {
    throw new Error("RECONCILIATION_REQUIRES_ACK");
  }

  if (!options.expectedHash) {
    throw new Error("INJECTION_PREVIEW_REQUIRED");
  }
  const freshPreview = await getTimberTripInjectionPreview(id);
  if (freshPreview.hash !== options.expectedHash) {
    throw new Error("INJECTION_PREVIEW_STALE");
  }

  // Madera v2 Fase 3 — margen negativo en CUALQUIER línea bloquea la confirmación salvo
  // override explícito con motivo (queda auditado). Margen bajo el objetivo NUNCA bloquea
  // por sí solo — eso es solo un aviso visible en el frontend (Fase 5).
  // Con el precio que deja la POLÍTICA del viaje (el de la vista previa), no el
  // calculado por pulgada: "margen objetivo" nunca queda bajo costo y pedía motivo igual.
  const hasNegativeMarginLine = hasNegativeMarginInPreview(freshPreview.lines);
  if (config.blockNegativeMargin && hasNegativeMarginLine && !options.marginOverrideReason?.trim()) {
    throw new Error("NEGATIVE_MARGIN_REQUIRES_OVERRIDE");
  }

  return prisma.$transaction(async (tx) => {
    // Mismo candado que updateTimberTrip/cancelTimberTrip: serializa confirmar
    // contra el autoguardado. Si el viaje cambió desde que se leyó arriba (un
    // autoguardado entró en medio), las líneas de `trip` ya no son las reales.
    await tx.$queryRaw`SELECT id FROM "TimberTrip" WHERE id = ${id} FOR UPDATE`;
    const locked = await tx.timberTrip.findUniqueOrThrow({ where: { id }, select: { status: true, updatedAt: true } });
    if (locked.status !== "DRAFT" && locked.status !== "CUBICADO") throw new Error("TRIP_ALREADY_CONFIRMED");
    if (locked.updatedAt.getTime() !== trip.updatedAt.getTime()) throw new Error("INJECTION_PREVIEW_STALE");

    const tripCode = await assignTripCodeTx(tx, id);

    // updateGlobalPrice: solo si el precio sale de la config GLOBAL por
    // pulgada — un override de sucursal o un margen sobre el costo de ESTE
    // viaje es un precio de esa sucursal, no el respaldo de las demás.
    const updateGlobalPrice = trip.pricePolicy === "RECALC_FROM_PRICE_PER_INCH" && !config.isBranchOverride;

    for (const line of trip.lines) {
      if (line.pieces <= 0) continue;
      const { productId, timberProductId } = await resolveTimberProductIdentityTx(tx, line);

      // Unit cost per piece — fall back to cost/feet ÷ pieces when not pre-computed.
      const unitCost = line.calculatedCostPerPiece.gt(0)
        ? line.calculatedCostPerPiece.toNumber()
        : line.pieces > 0
          ? line.calculatedCostFeet.toNumber() / line.pieces
          : 0;

      // Madera v2 Fase 2 — SIEMPRE actualiza costos/precios, exista o no el producto.
      await applyTimberCostsTx(tx, {
        actorUserId: userId,
        branchId: trip.destinationBranchId,
        productId,
        timberProductId,
        priceGroup: line.priceGroup as TimberPriceGroup,
        boardFeet: line.calculatedFeet.div(line.pieces).toNumber(),
        pricePerInch: line.calculatedSalePricePerPiece.div((line.thicknessIn * line.widthIn * line.varaLength) || 1).toNumber(),
        varaLength: line.varaLength,
        costPerPiece: unitCost,
        recalculatedSellingPrice: line.calculatedSalePricePerPiece.toNumber(),
        pricePolicy: trip.pricePolicy,
        targetMarginPercent: config.targetMarginPercent,
        targetMarginRoundingMultiple: config.targetMarginRoundingMultiple,
        updateGlobalPrice,
      });

      await createInventoryMovementTx(tx, {
        actorUserId: userId ?? "SYSTEM",
        branchId: trip.destinationBranchId,
        productId,
        movementType: "TIMBER_INTAKE_IN",
        quantity: line.pieces,
        unitCost,
        referenceType: "TIMBER_TRIP",
        referenceId: trip.id,
        notes: `Viaje de madera ${tripCode} — ${line.thicknessIn}"×${line.widthIn}"×${line.lengthIn} pies`,
      });

      // Link the line to the resolved product for traceability.
      if (line.timberProductId !== timberProductId) {
        await tx.timberTripLine.update({
          where: { id: line.id },
          data: { timberProductId },
        });
      }
    }

    // Auditoría 2026-07-22 (ALTO Madera): el status se validaba ANTES de abrir
    // la transacción y la transición final usaba un update plano — un doble
    // clic o un retry concurrente podían pasar ambos el chequeo inicial e
    // inyectar el mismo viaje dos veces en inventario. Opción A (mismo patrón
    // que executeSaleReturn/executeSaleCancellation): updateMany guardado por
    // status dentro de la misma transacción — si otro request ya confirmó
    // este viaje, count=0 y se revierte TODO lo de esta transacción
    // (incluidos los movimientos de inventario ya creados arriba).
    const transition = await tx.timberTrip.updateMany({
      where: { id, status: { in: ["DRAFT", "CUBICADO"] } },
      data: {
        status: "TRANSFERRED",
        confirmedById: userId,
        confirmedAt: new Date(),
        reconciliationAcknowledged: reconciliation.status === "REVIEW" ? true : trip.reconciliationAcknowledged,
        marginOverrideReason: hasNegativeMarginLine ? options.marginOverrideReason?.trim() : trip.marginOverrideReason,
      },
    });
    if (transition.count === 0) {
      throw new Error("TRIP_ALREADY_CONFIRMED");
    }
    const updated = await tx.timberTrip.findUniqueOrThrow({
      where: { id },
      include: { lines: true, destinationBranch: true },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        branchId: trip.destinationBranchId,
        module: "timber",
        action: "TIMBER_TRIP_CONFIRMED_AND_INJECTED",
        entityType: "TimberTrip",
        entityId: trip.id,
        metadataJson: {
          tripCode,
          totalPieces: trip.totalPieces,
          totalFeet: trip.totalFeet.toString(),
          totalCost: trip.totalCost.toString(),
          landedCostPerFoot: trip.landedCostPerFoot.toString(),
          linesInjected: trip.lines.length,
          reconciliationStatus: reconciliation.status,
          reconciliationAcknowledged: reconciliation.status === "REVIEW",
          hasNegativeMarginLine,
          marginOverrideReason: hasNegativeMarginLine ? options.marginOverrideReason?.trim() ?? null : null,
        },
      },
    });

    // Mismo shape que getTimberTrip/updateTimberTrip (`reconciliation` ya
    // calculado arriba en esta función) — evita que un futuro consumidor de
    // este trip caiga en el mismo `trip.reconciliation.status` sobre undefined.
    return { ...updated, reconciliation };
    // El default de 5 s no alcanza: la hoja real trae ~50 medidas y cada una son ~20 consultas.
  }, { timeout: 60000, maxWait: 10000 });
}
