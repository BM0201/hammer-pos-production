import { InventoryMovementType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { approvalService } from "@/modules/approvals/service";
import { isInboundMovement, recalculateWeightedAverage, WacValidationError } from "@/modules/inventory/wac";
import { APPROVAL_REQUEST_TYPES } from "@/modules/approvals/constants";
import {
  convertBaseQtyToSaleQty,
  convertBaseUnitCostToSaleUnitCost,
  convertSaleQtyToBaseQty,
  convertSaleUnitCostToBaseUnitCost,
  formatDualStock,
  getSharedInventoryBalance,
  resolveInventoryProductForMovement,
} from "@/modules/inventory/unit-conversion";

export const INVENTORY_ADJUSTMENT_APPROVAL_THRESHOLD = 25;

export async function listInventoryBalances(params: { branchId: string; productId?: string }) {
  const resolved = params.productId
    ? await resolveInventoryProductForMovement(prisma, params.productId)
    : null;
  return prisma.inventoryBalance.findMany({
    where: {
      branchId: params.branchId,
      ...(params.productId ? { productId: resolved?.inventoryProductId ?? params.productId } : {}),
    },
    include: { product: true, branch: true },
    orderBy: { product: { name: "asc" } },
  });
}

export async function listInventoryMovements(params: { branchId: string; productId?: string; limit?: number }) {
  return prisma.inventoryMovement.findMany({
    where: {
      branchId: params.branchId,
      ...(params.productId ? { productId: params.productId } : {}),
    },
    include: {
      product: {
        select: { id: true, sku: true, name: true },
      },
      branch: {
        select: { id: true, code: true, name: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 25,
  });
}

type InventoryMovementInput = {
  actorUserId: string;
  branchId: string;
  productId: string;
  movementType: InventoryMovementType;
  quantity: number;
  unitCost: number;
  referenceType: string;
  referenceId: string;
  notes?: string | null;
};

type ManualAdjustmentInput = {
  actorUserId: string;
  branchId: string;
  productId: string;
  adjustmentType: "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "PHYSICAL_COUNT" | "DAMAGE" | "RETURN" | "OTHER";
  quantity: number;
  unit?: string;
  reason: string;
  notes?: string | null;
};

type OpeningBalanceInput = {
  actorUserId: string;
  branchId: string;
  productId: string;
  quantity: number;
  unit?: string;
  unitCost?: number | null;
  costMode: "SET_WAC" | "SET_BRANCH_COST" | "QUANTITY_ONLY";
  salePrice?: number | null;
  priceMode: "SET_BRANCH_PRICE" | "SET_GLOBAL_PRICE" | "NO_PRICE_CHANGE";
  reason: string;
  notes?: string | null;
};

export async function createInventoryMovementTx(
  tx: Prisma.TransactionClient,
  input: InventoryMovementInput,
) {
  const movementQty = new Prisma.Decimal(input.quantity);
  const movementUnitCost = new Prisma.Decimal(input.unitCost);
  const inbound = isInboundMovement(input.movementType);
  const resolved = await resolveInventoryProductForMovement(tx, input.productId);
  const inventoryProductId = resolved.inventoryProductId;
  const baseMovementQty = resolved.conversion
    ? convertSaleQtyToBaseQty({ quantity: movementQty, conversionFactor: resolved.conversion.conversionFactor })
    : movementQty;
  const baseMovementUnitCost = resolved.conversion
    ? convertSaleUnitCostToBaseUnitCost({ saleUnitCost: movementUnitCost, conversionFactor: resolved.conversion.conversionFactor })
    : movementUnitCost;

  // ── WAC pre-validation (fail fast before touching the DB) ─────────
  if (baseMovementQty.lte(new Prisma.Decimal(0))) {
    throw new WacValidationError("INVALID_MOVEMENT_QUANTITY", "Quantity must be positive.");
  }
  if (baseMovementUnitCost.lt(new Prisma.Decimal(0))) {
    throw new WacValidationError("NEGATIVE_UNIT_COST", "Unit cost cannot be negative.");
  }
  if (inbound && baseMovementUnitCost.eq(new Prisma.Decimal(0))) {
    throw new WacValidationError("ZERO_COST_INBOUND", "Inbound movements require a positive unit cost.");
  }

  // Step 1: Ensure the balance row exists (idempotent upsert via Prisma).
  await tx.inventoryBalance.upsert({
    where: {
      branchId_productId: {
        branchId: input.branchId,
        productId: inventoryProductId,
      },
    },
    create: {
      branchId: input.branchId,
      productId: inventoryProductId,
      quantityOnHand: 0,
      weightedAverageCost: 0,
      inventoryValue: 0,
    },
    update: {},
  });

  // Step 2: Lock balance row to guarantee atomic stock/WAC updates under concurrency.
  await tx.$queryRaw`
    SELECT id
    FROM "InventoryBalance"
    WHERE "branchId" = ${input.branchId}
      AND "productId" = ${inventoryProductId}
    FOR UPDATE
  `;

  // Step 3: Read the current balance row after lock acquisition.
  const balance = await tx.inventoryBalance.findUnique({
    where: {
      branchId_productId: {
        branchId: input.branchId,
        productId: inventoryProductId,
      },
    },
  });

  if (!balance) {
    throw new Error("INVENTORY_BALANCE_NOT_FOUND");
  }

  const next = recalculateWeightedAverage({
    currentQty: balance.quantityOnHand,
    currentWac: balance.weightedAverageCost,
    movementQty: baseMovementQty,
    movementUnitCost: baseMovementUnitCost,
    inbound,
  });

  const movement = await tx.inventoryMovement.create({
    data: {
      branchId: input.branchId,
      productId: inventoryProductId,
      movementType: input.movementType,
      quantity: baseMovementQty,
      unitCost: baseMovementUnitCost,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      notes: input.notes,
    },
  });

  const updatedBalance = await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: {
      quantityOnHand: next.newQty,
      weightedAverageCost: next.newWac,
      inventoryValue: next.inventoryValue,
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "inventory",
      action: "INVENTORY_MOVEMENT_CREATE",
      entityType: "InventoryMovement",
      entityId: movement.id,
      metadataJson: {
        movementType: input.movementType,
        quantity: input.quantity,
        unitCost: input.unitCost,
        originalProductId: input.productId,
        inventoryProductId,
        unitConversion: resolved.conversion ? {
          stockGroupId: resolved.conversion.stockGroupId,
          stockGroupCode: resolved.conversion.stockGroupCode,
          saleUnit: resolved.conversion.saleUnit,
          baseUnit: resolved.conversion.baseUnit,
          saleQuantity: movementQty.toString(),
          baseQuantity: baseMovementQty.toString(),
          conversionFactor: resolved.conversion.conversionFactor.toString(),
          saleUnitCost: movementUnitCost.toString(),
          baseUnitCost: baseMovementUnitCost.toString(),
        } : null,
        balanceQty: updatedBalance.quantityOnHand.toString(),
        balanceWac: updatedBalance.weightedAverageCost.toString(),
      },
    },
  });

  return { movement, balance: updatedBalance };
}

export async function createInventoryMovement(input: InventoryMovementInput) {
  return prisma.$transaction((tx) => createInventoryMovementTx(tx, input));
}

export async function createManualInventoryAdjustment(input: ManualAdjustmentInput) {
  return prisma.$transaction(async (tx) => {
    const shared = await getSharedInventoryBalance(tx, { branchId: input.branchId, productId: input.productId });
    const conversion = shared.conversion;
    const selectedUnit = (input.unit ?? conversion?.saleUnit ?? "").toUpperCase();
    const isBaseUnitAdjustment = !!conversion && selectedUnit === conversion.baseUnit.toUpperCase();
    const currentBaseQty = shared.balance?.quantityOnHand ?? new Prisma.Decimal(0);
    const currentSaleQty = conversion
      ? convertBaseQtyToSaleQty({ baseQuantity: currentBaseQty, conversionFactor: conversion.conversionFactor })
      : currentBaseQty;
    const requestedQty = new Prisma.Decimal(input.quantity);
    const requestedBaseQty = conversion && !isBaseUnitAdjustment
      ? convertSaleQtyToBaseQty({ quantity: requestedQty, conversionFactor: conversion.conversionFactor })
      : requestedQty;

    let movementType: InventoryMovementType = "ADJUSTMENT_IN";
    let movementQty = requestedQty;
    let movementProductId = input.productId;

    if (input.adjustmentType === "ADJUSTMENT_OUT" || input.adjustmentType === "DAMAGE") {
      movementType = "ADJUSTMENT_OUT";
    } else if (input.adjustmentType === "RETURN") {
      movementType = "RETURN_IN";
    } else if (input.adjustmentType === "OTHER") {
      movementType = "ADJUSTMENT_IN";
    } else if (input.adjustmentType === "PHYSICAL_COUNT") {
      const desiredBaseQty = requestedBaseQty;
      const deltaBaseQty = desiredBaseQty.minus(currentBaseQty);
      if (deltaBaseQty.eq(0)) {
        return {
          ok: true,
          skipped: true,
          message: "El conteo coincide con el stock actual.",
          productId: input.productId,
          branchId: input.branchId,
          previousStock: Number(currentSaleQty),
          newStock: Number(currentSaleQty),
          sharedStock: conversion ? formatDualStock({
            baseQuantity: currentBaseQty,
            conversionFactor: conversion.conversionFactor,
            baseUnit: conversion.baseUnit,
            saleUnit: conversion.saleUnit,
          }) : null,
        };
      }
      movementType = deltaBaseQty.gt(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT";
      const deltaAbsBaseQty = deltaBaseQty.abs();
      movementQty = conversion && !isBaseUnitAdjustment
        ? convertBaseQtyToSaleQty({ baseQuantity: deltaAbsBaseQty, conversionFactor: conversion.conversionFactor })
        : deltaAbsBaseQty;
    }

    if (isBaseUnitAdjustment && conversion) {
      movementProductId = conversion.canonicalProductId;
      movementQty = input.adjustmentType === "PHYSICAL_COUNT" ? movementQty : requestedBaseQty;
    }

    const outboundBaseQty = movementType === "ADJUSTMENT_OUT"
      ? (isBaseUnitAdjustment ? movementQty : (conversion ? convertSaleQtyToBaseQty({ quantity: movementQty, conversionFactor: conversion.conversionFactor }) : movementQty))
      : new Prisma.Decimal(0);
    if (outboundBaseQty.gt(currentBaseQty)) {
      throw new Error("INSUFFICIENT_STOCK");
    }

    const baseWac = shared.balance?.weightedAverageCost ?? new Prisma.Decimal(0);
    const saleUnitCost = conversion && !isBaseUnitAdjustment
      ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: baseWac, conversionFactor: conversion.conversionFactor })
      : baseWac;
    const unitCost = isBaseUnitAdjustment && conversion
      ? convertSaleUnitCostToBaseUnitCost({ saleUnitCost, conversionFactor: conversion.conversionFactor })
      : saleUnitCost;
    if (isInboundMovement(movementType) && unitCost.lte(0)) {
      throw new Error("NO_EFFECTIVE_COST_FOR_MANUAL_ADJUSTMENT");
    }

    const movementResult = await createInventoryMovementTx(tx, {
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      productId: movementProductId,
      movementType,
      quantity: Number(movementQty),
      unitCost: Number(unitCost),
      referenceType: "MANUAL_ADJUSTMENT",
      referenceId: `MANUAL-${Date.now()}`,
      notes: `${input.reason}${input.notes ? ` - ${input.notes}` : ""}`,
    });

    const newBaseQty = movementResult.balance.quantityOnHand;
    const newSaleQty = conversion
      ? convertBaseQtyToSaleQty({ baseQuantity: newBaseQty, conversionFactor: conversion.conversionFactor })
      : newBaseQty;

    await logAuditEvent({
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "inventory",
      action: "MANUAL_INVENTORY_ADJUSTMENT",
      entityType: "Product",
      entityId: input.productId,
      metadataJson: {
        productId: input.productId,
        movementProductId,
        adjustmentType: input.adjustmentType,
        movementType,
        requestedQuantity: input.quantity,
        requestedUnit: input.unit ?? null,
        movementQuantity: movementQty.toString(),
        reason: input.reason,
        notes: input.notes ?? null,
        previousBaseStock: currentBaseQty.toString(),
        newBaseStock: newBaseQty.toString(),
        stockConversion: conversion ? {
          stockGroupId: conversion.stockGroupId,
          stockGroupCode: conversion.stockGroupCode,
          baseUnit: conversion.baseUnit,
          saleUnit: conversion.saleUnit,
          conversionFactor: conversion.conversionFactor.toString(),
        } : null,
      },
    });

    return {
      ok: true,
      movementId: movementResult.movement.id,
      productId: input.productId,
      branchId: input.branchId,
      movementType,
      previousStock: Number(currentSaleQty),
      newStock: Number(newSaleQty),
      previousBaseStock: Number(currentBaseQty),
      newBaseStock: Number(newBaseQty),
      sharedStock: conversion ? formatDualStock({
        baseQuantity: newBaseQty,
        conversionFactor: conversion.conversionFactor,
        baseUnit: conversion.baseUnit,
        saleUnit: conversion.saleUnit,
      }) : null,
    };
  });
}

export async function createOpeningBalance(input: OpeningBalanceInput) {
  return prisma.$transaction(async (tx) => {
    const shared = await getSharedInventoryBalance(tx, { branchId: input.branchId, productId: input.productId });
    const conversion = shared.conversion;
    const selectedUnit = (input.unit ?? conversion?.saleUnit ?? "").toUpperCase();
    const isBaseUnit = !!conversion && selectedUnit === conversion.baseUnit.toUpperCase();
    const currentBaseQty = shared.balance?.quantityOnHand ?? new Prisma.Decimal(0);
    const previousBaseWac = shared.balance?.weightedAverageCost ?? new Prisma.Decimal(0);
    const requestedQty = new Prisma.Decimal(input.quantity);
    const movementProductId = isBaseUnit && conversion ? conversion.canonicalProductId : input.productId;
    const movementQty = requestedQty;
    const baseQuantity = conversion && !isBaseUnit
      ? convertSaleQtyToBaseQty({ quantity: requestedQty, conversionFactor: conversion.conversionFactor })
      : requestedQty;

    const [product, existingSetting] = await Promise.all([
      tx.product.findUniqueOrThrow({
        where: { id: input.productId },
        select: { id: true, standardSalePrice: true },
      }),
      tx.branchProductSetting.findUnique({
        where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
        select: { branchCost: true, branchPrice: true },
      }),
    ]);

    const previousSaleUnitWac = conversion
      ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: previousBaseWac, conversionFactor: conversion.conversionFactor })
      : previousBaseWac;
    const previousEffectiveCost = existingSetting?.branchCost ?? (previousSaleUnitWac.gt(0) ? previousSaleUnitWac : null);
    const previousEffectivePrice = existingSetting?.branchPrice ?? product.standardSalePrice;

    let unitCost = previousSaleUnitWac;
    if (input.costMode === "SET_WAC" || input.costMode === "SET_BRANCH_COST") {
      unitCost = new Prisma.Decimal(input.unitCost ?? 0);
    }
    if (input.costMode === "QUANTITY_ONLY" && unitCost.lte(0)) {
      unitCost = new Prisma.Decimal(0);
    }

    let movementResult: Awaited<ReturnType<typeof createInventoryMovementTx>> | null = null;
    if (input.costMode === "SET_WAC") {
      movementResult = await createInventoryMovementTx(tx, {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        productId: movementProductId,
        movementType: "ADJUSTMENT_IN",
        quantity: Number(movementQty),
        unitCost: Number(unitCost),
        referenceType: "OPENING_BALANCE",
        referenceId: `OPENING-${Date.now()}`,
        notes: `${input.reason}${input.notes ? ` - ${input.notes}` : ""}`,
      });
    } else {
      const inventoryProductId = shared.inventoryProductId;
      await tx.inventoryBalance.upsert({
        where: { branchId_productId: { branchId: input.branchId, productId: inventoryProductId } },
        create: {
          branchId: input.branchId,
          productId: inventoryProductId,
          quantityOnHand: 0,
          weightedAverageCost: shared.balance?.weightedAverageCost ?? 0,
          inventoryValue: 0,
        },
        update: {},
      });
      await tx.$queryRaw`
        SELECT id
        FROM "InventoryBalance"
        WHERE "branchId" = ${input.branchId}
          AND "productId" = ${inventoryProductId}
        FOR UPDATE
      `;
      const balance = await tx.inventoryBalance.findUnique({
        where: { branchId_productId: { branchId: input.branchId, productId: inventoryProductId } },
      });
      if (!balance) throw new Error("INVENTORY_BALANCE_NOT_FOUND");
      const nextQty = balance.quantityOnHand.plus(baseQuantity);
      const nextWac = balance.weightedAverageCost;
      const movement = await tx.inventoryMovement.create({
        data: {
          branchId: input.branchId,
          productId: inventoryProductId,
          movementType: "ADJUSTMENT_IN",
          quantity: baseQuantity,
          unitCost: nextWac,
          referenceType: "OPENING_BALANCE",
          referenceId: `OPENING-${Date.now()}`,
          notes: `${input.reason}${input.notes ? ` - ${input.notes}` : ""}`,
        },
      });
      const updatedBalance = await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: {
          quantityOnHand: nextQty,
          inventoryValue: nextQty.mul(nextWac),
        },
      });
      movementResult = { movement, balance: updatedBalance };
    }

    if (input.costMode === "SET_BRANCH_COST") {
      await tx.branchProductSetting.upsert({
        where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
        create: {
          branchId: input.branchId,
          productId: input.productId,
          branchCost: unitCost,
        },
        update: { branchCost: unitCost },
      });
    }

    const salePrice = input.salePrice === null || input.salePrice === undefined
      ? null
      : new Prisma.Decimal(input.salePrice);
    if (input.priceMode === "SET_BRANCH_PRICE" && salePrice) {
      await tx.branchProductSetting.upsert({
        where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
        create: {
          branchId: input.branchId,
          productId: input.productId,
          branchPrice: salePrice,
        },
        update: { branchPrice: salePrice },
      });
    }
    if (input.priceMode === "SET_GLOBAL_PRICE" && salePrice) {
      await tx.product.update({
        where: { id: input.productId },
        data: { standardSalePrice: salePrice },
      });
    }

    const refreshedSetting = await tx.branchProductSetting.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      select: { branchCost: true, branchPrice: true },
    });
    const refreshedProduct = input.priceMode === "SET_GLOBAL_PRICE" && salePrice
      ? { standardSalePrice: salePrice }
      : product;
    const newBaseWac = movementResult.balance.weightedAverageCost;
    const newSaleUnitWac = conversion
      ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: newBaseWac, conversionFactor: conversion.conversionFactor })
      : newBaseWac;
    const newEffectiveCost = refreshedSetting?.branchCost ?? (newSaleUnitWac.gt(0) ? newSaleUnitWac : null);
    const newEffectivePrice = refreshedSetting?.branchPrice ?? refreshedProduct.standardSalePrice;

    const newBaseQty = movementResult.balance.quantityOnHand;
    const newSaleQty = conversion
      ? convertBaseQtyToSaleQty({ baseQuantity: newBaseQty, conversionFactor: conversion.conversionFactor })
      : newBaseQty;

    await logAuditEvent({
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "inventory",
      action: "OPENING_BALANCE_CREATE",
      entityType: "Product",
      entityId: input.productId,
      metadataJson: {
        productId: input.productId,
        branchId: input.branchId,
        inventoryProductId: shared.inventoryProductId,
        movementId: movementResult.movement.id,
        oldStock: currentBaseQty.toString(),
        newStock: newBaseQty.toString(),
        quantityBase: baseQuantity.toString(),
        quantity: input.quantity,
        unit: input.unit ?? null,
        oldCost: previousEffectiveCost?.toString() ?? null,
        newCost: newEffectiveCost?.toString() ?? null,
        oldWac: previousBaseWac.toString(),
        newWac: newBaseWac.toString(),
        costMode: input.costMode,
        oldPrice: previousEffectivePrice.toString(),
        newPrice: newEffectivePrice.toString(),
        priceMode: input.priceMode,
        salePrice: input.salePrice ?? null,
        reason: input.reason,
        notes: input.notes ?? null,
        stockConversion: conversion ? {
          stockGroupId: conversion.stockGroupId,
          stockGroupCode: conversion.stockGroupCode,
          baseUnit: conversion.baseUnit,
          saleUnit: conversion.saleUnit,
          conversionFactor: conversion.conversionFactor.toString(),
        } : null,
      },
    });

    return {
      ok: true,
      movementId: movementResult.movement.id,
      productId: input.productId,
      branchId: input.branchId,
      movementType: "ADJUSTMENT_IN",
      referenceType: "OPENING_BALANCE",
      costMode: input.costMode,
      priceMode: input.priceMode,
      previousBaseStock: Number(currentBaseQty),
      newBaseStock: Number(newBaseQty),
      quantityBase: Number(baseQuantity),
      newStock: Number(newSaleQty),
      oldCost: previousEffectiveCost === null ? null : Number(previousEffectiveCost),
      newCost: newEffectiveCost === null ? null : Number(newEffectiveCost),
      oldPrice: Number(previousEffectivePrice),
      newPrice: Number(newEffectivePrice),
      weightedAverageCost: movementResult.balance.weightedAverageCost.toString(),
      sharedStock: conversion ? formatDualStock({
        baseQuantity: newBaseQty,
        conversionFactor: conversion.conversionFactor,
        baseUnit: conversion.baseUnit,
        saleUnit: conversion.saleUnit,
      }) : null,
    };
  });
}
export async function requestStockAdjustment(input: {
  actorUserId: string;
  branchId: string;
  productId: string;
  desiredQuantity: number;
  reason: string;
  currentQuantity?: number;
  adjustmentDelta?: number;
}) {
  const result = await approvalService.createRequest({
    branchId: input.branchId,
    requestedByUserId: input.actorUserId,
    referenceType: "STOCK_ADJUSTMENT",
    referenceId: input.productId,
    reason: input.reason,
    type: APPROVAL_REQUEST_TYPES.STOCK_ADJUSTMENT,
    payloadJson: {
      desiredQuantity: input.desiredQuantity,
      currentQuantity: input.currentQuantity,
      adjustmentDelta: input.adjustmentDelta,
    },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "inventory",
    action: "STOCK_ADJUSTMENT_REQUESTED",
    entityType: "ApprovalRequest",
    entityId: result.requestId,
    metadataJson: {
      productId: input.productId,
      desiredQuantity: input.desiredQuantity,
      currentQuantity: input.currentQuantity,
      adjustmentDelta: input.adjustmentDelta,
      reason: input.reason,
      approvalStatus: "REQUESTED",
    },
  });

  return {
    status: "REQUESTED",
    requestId: result.requestId,
    message: "Solicitud enviada.",
    created: result.created,
  } as const;
}


