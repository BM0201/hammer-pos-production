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
  DEFAULT_MINIMUM_CLOSED_PACKAGE_RESERVE,
  formatDualStock,
  calculateSharedStockChange,
  getSharedInventoryBalance,
  resolveInventoryProductForMovement,
} from "@/modules/inventory/unit-conversion";

export const INVENTORY_ADJUSTMENT_APPROVAL_THRESHOLD = 25;

export async function listInventoryBalances(params: { branchId: string; productId?: string }) {
  const resolved = params.productId
    ? await resolveInventoryProductForMovement(prisma, params.productId)
    : null;
  const balances = await prisma.inventoryBalance.findMany({
    where: {
      branchId: params.branchId,
      ...(params.productId ? { productId: resolved?.inventoryProductId ?? params.productId } : {}),
    },
    include: { product: true, branch: true },
    orderBy: { product: { name: "asc" } },
  });

  if (!params.productId || !resolved?.conversion) return balances;

  return balances.map((balance) => {
    const sharedStock = formatDualStock({
      baseQuantity: balance.quantityOnHand,
      conversionFactor: resolved.conversion!.conversionFactor,
      baseUnit: resolved.conversion!.baseUnit,
      saleUnit: resolved.conversion!.saleUnit,
      closedPackageQuantity: balance.closedPackageQuantity,
      looseUnitQuantity: balance.looseUnitQuantity,
      packageUnit: resolved.conversion!.packageUnit,
      tracksPackages: resolved.conversion!.tracksPackages,
      minimumClosedPackageReserve: resolved.conversion!.minimumClosedPackageReserve,
      autoOpenForUnitSale: resolved.conversion!.autoOpenForUnitSale,
    });

    return {
      ...balance,
      availableBaseStock: sharedStock.baseQuantity,
      availableSaleStock: sharedStock.saleQuantity,
      baseUnit: sharedStock.baseUnit,
      saleUnit: sharedStock.saleUnit,
      sharedStock,
    };
  });
}

export type InventoryMovementPaginationParams = {
  page?: number;
  limit?: number;
  branchId?: string;
  productId?: string;
  movementType?: InventoryMovementType;
  dateFrom?: string | Date;
  dateTo?: string | Date;
  search?: string;
};

export function clampInventoryMovementPagination(input: { page?: number; limit?: number }) {
  const page = Math.max(1, Math.trunc(input.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 30) || 30));
  return { page, limit, skip: (page - 1) * limit };
}

function endOfDay(date: Date) {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

export async function listInventoryMovementsPaginated(params: InventoryMovementPaginationParams) {
  const resolved = params.productId
    ? await resolveInventoryProductForMovement(prisma, params.productId)
    : null;
  const { page, limit, skip } = clampInventoryMovementPagination(params);
  const dateFrom = params.dateFrom ? new Date(params.dateFrom) : null;
  const dateTo = params.dateTo ? endOfDay(new Date(params.dateTo)) : null;
  const search = params.search?.trim();
  const where: Prisma.InventoryMovementWhereInput = {
    ...(params.branchId ? { branchId: params.branchId } : {}),
    ...(params.productId ? { productId: resolved?.inventoryProductId ?? params.productId } : {}),
    ...(params.movementType ? { movementType: params.movementType } : {}),
    ...((dateFrom || dateTo) ? {
      createdAt: {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      },
    } : {}),
    ...(search ? {
      OR: [
        { referenceType: { contains: search, mode: "insensitive" } },
        { referenceId: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
        { product: { sku: { contains: search, mode: "insensitive" } } },
        { product: { name: { contains: search, mode: "insensitive" } } },
        { branch: { code: { contains: search, mode: "insensitive" } } },
        { branch: { name: { contains: search, mode: "insensitive" } } },
      ],
    } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      include: {
        product: {
          select: { id: true, sku: true, name: true },
        },
        branch: {
          select: { id: true, code: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.inventoryMovement.count({ where }),
  ]);

  return {
    rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function listInventoryMovements(params: { branchId: string; productId?: string; limit?: number }) {
  const result = await listInventoryMovementsPaginated({
    branchId: params.branchId,
    productId: params.productId,
    limit: params.limit ?? 25,
    page: 1,
  });
  return result.rows;
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

type ConsumeSharedStockForSaleInput = {
  branchId: string;
  productId: string;
  quantity: Prisma.Decimal | number | string;
  unit?: string | null;
  saleOrderId?: string | null;
  paymentId?: string | null;
  userId: string;
  referenceType?: string;
  referenceId?: string;
  notes?: string | null;
};

export class InventoryStockError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InventoryStockError";
    this.code = code;
  }
}

type OpenPackageInput = {
  actorUserId: string;
  branchId: string;
  stockGroupId: string;
  packageProductId?: string | null;
  actualUnits?: number | null;
  reason?: string | null;
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
  stockMode: "SET_PHYSICAL_STOCK" | "ADD_TO_STOCK" | "ADD_OPENING_STOCK";
  unitCost?: number | null;
  costMode: "SET_WAC" | "SET_BRANCH_COST" | "QUANTITY_ONLY";
  salePrice?: number | null;
  priceMode: "SET_BRANCH_PRICE" | "SET_GLOBAL_PRICE" | "NO_PRICE_CHANGE";
  reason: string;
  notes?: string | null;
};

type OpeningBalanceTxOptions = {
  referenceType?: string;
  referenceId?: string;
  auditAction?: string;
  createNoopMovement?: boolean;
  skipLineAudit?: boolean;
  bulkReference?: string;
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
  const tracksPackages = Boolean(resolved.conversion?.tracksPackages);
  const packageFactor = new Prisma.Decimal(
    resolved.conversion?.conversionFactorToBase
      ?? resolved.conversion?.conversionFactor
      ?? 1,
  );
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
      closedPackageQuantity: 0,
      looseUnitQuantity: 0,
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

  let closedPackageBefore: Prisma.Decimal | null = null;
  let closedPackageAfter: Prisma.Decimal | null = null;
  let looseUnitBefore: Prisma.Decimal | null = null;
  let looseUnitAfter: Prisma.Decimal | null = null;
  let equivalentBaseBefore: Prisma.Decimal | null = null;
  let equivalentBaseAfter: Prisma.Decimal | null = null;
  let effectiveMovementType = input.movementType;
  let effectiveQuantityOnHand = next.newQty;

  if (tracksPackages && resolved.conversion) {
    closedPackageBefore = balance.closedPackageQuantity;
    looseUnitBefore = balance.looseUnitQuantity;
    equivalentBaseBefore = balance.quantityOnHand;
    closedPackageAfter = closedPackageBefore;
    looseUnitAfter = looseUnitBefore;

    if (inbound) {
      if (resolved.conversion.isPackagePresentation) {
        closedPackageAfter = closedPackageAfter.add(movementQty);
        effectiveMovementType = input.movementType === "PURCHASE_IN" ? "PACKAGE_IN" : input.movementType;
      } else {
        looseUnitAfter = looseUnitAfter.add(baseMovementQty);
        effectiveMovementType = input.movementType === "RETURN_IN" ? "LOOSE_UNIT_RETURN_IN" : input.movementType;
      }
    } else if (resolved.conversion.isPackagePresentation) {
      if (closedPackageBefore.lt(movementQty)) {
        throw new Error("INSUFFICIENT_CLOSED_PACKAGE_STOCK");
      }
      closedPackageAfter = closedPackageAfter.sub(movementQty);
      effectiveMovementType = input.movementType === "SALE_OUT" ? "PACKAGE_SALE_OUT" : input.movementType;
    } else {
      if (looseUnitBefore.lt(baseMovementQty)) {
        throw new Error("INSUFFICIENT_LOOSE_UNIT_STOCK");
      }
      looseUnitAfter = looseUnitAfter.sub(baseMovementQty);
      effectiveMovementType = input.movementType === "SALE_OUT" ? "LOOSE_UNIT_SALE_OUT" : input.movementType;
    }

    equivalentBaseAfter = closedPackageAfter.mul(packageFactor).add(looseUnitAfter);
    effectiveQuantityOnHand = equivalentBaseAfter;
  }

  const movement = await tx.inventoryMovement.create({
    data: {
      branchId: input.branchId,
      productId: inventoryProductId,
      movementType: effectiveMovementType,
      quantity: baseMovementQty,
      unitCost: baseMovementUnitCost,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      notes: input.notes,
      inputProductId: input.productId,
      inputQuantity: movementQty,
      inputUnit: resolved.conversion?.saleUnit ?? null,
      packageUnit: resolved.conversion?.packageUnit ?? null,
      baseUnit: resolved.conversion?.baseUnit ?? null,
      conversionFactorSnapshot: resolved.conversion?.conversionFactor ?? null,
      closedPackageBefore,
      closedPackageAfter,
      looseUnitBefore,
      looseUnitAfter,
      equivalentBaseBefore,
      equivalentBaseAfter,
      reason: input.notes ?? null,
      userId: input.actorUserId,
    },
  });

  const updatedBalance = await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: {
      quantityOnHand: effectiveQuantityOnHand,
      ...(tracksPackages && closedPackageAfter && looseUnitAfter ? {
        closedPackageQuantity: closedPackageAfter,
        looseUnitQuantity: looseUnitAfter,
      } : {}),
      weightedAverageCost: next.newWac,
      inventoryValue: effectiveQuantityOnHand.mul(next.newWac),
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

export async function consumeSharedStockForSaleTx(
  tx: Prisma.TransactionClient,
  input: ConsumeSharedStockForSaleInput,
) {
  const requestedQty = new Prisma.Decimal(input.quantity);
  if (requestedQty.lte(0)) {
    throw new WacValidationError("INVALID_MOVEMENT_QUANTITY", "Quantity must be positive.");
  }

  const resolved = await resolveInventoryProductForMovement(tx, input.productId);
  const conversion = resolved.conversion;
  const referenceType = input.referenceType ?? "SALE";
  const referenceId = input.referenceId ?? input.saleOrderId ?? input.paymentId ?? `SALE-${Date.now()}`;

  if (!conversion?.tracksPackages) {
    const shared = await getSharedInventoryBalance(tx, { branchId: input.branchId, productId: input.productId });
    const currentWac = shared.balance?.weightedAverageCost ?? new Prisma.Decimal(0);
    const result = await createInventoryMovementTx(tx, {
      actorUserId: input.userId,
      branchId: input.branchId,
      productId: input.productId,
      movementType: InventoryMovementType.SALE_OUT,
      quantity: Number(requestedQty),
      unitCost: Number(currentWac),
      referenceType,
      referenceId,
      notes: input.notes ?? null,
    });
    return { movements: [result.movement], balance: result.balance };
  }

  if (conversion.isPackagePresentation) {
    const shared = await getSharedInventoryBalance(tx, { branchId: input.branchId, productId: input.productId });
    const currentWac = shared.balance?.weightedAverageCost ?? new Prisma.Decimal(0);
    const result = await createInventoryMovementTx(tx, {
      actorUserId: input.userId,
      branchId: input.branchId,
      productId: input.productId,
      movementType: InventoryMovementType.SALE_OUT,
      quantity: Number(requestedQty),
      unitCost: Number(currentWac),
      referenceType,
      referenceId,
      notes: input.notes ?? null,
    });
    return { movements: [result.movement], balance: result.balance };
  }

  const factor = new Prisma.Decimal(conversion.conversionFactorToBase ?? conversion.conversionFactor);
  const reserve = new Prisma.Decimal(conversion.minimumClosedPackageReserve ?? DEFAULT_MINIMUM_CLOSED_PACKAGE_RESERVE);
  if (factor.lte(0)) {
    throw new Error("VALIDATION_ERROR: El factor de empaque debe ser mayor que 0.");
  }

  await tx.inventoryBalance.upsert({
    where: {
      branchId_productId: {
        branchId: input.branchId,
        productId: resolved.inventoryProductId,
      },
    },
    create: {
      branchId: input.branchId,
      productId: resolved.inventoryProductId,
      quantityOnHand: 0,
      closedPackageQuantity: 0,
      looseUnitQuantity: 0,
      weightedAverageCost: 0,
      inventoryValue: 0,
    },
    update: {},
  });

  await tx.$queryRaw`
    SELECT id
    FROM "InventoryBalance"
    WHERE "branchId" = ${input.branchId}
      AND "productId" = ${resolved.inventoryProductId}
    FOR UPDATE
  `;

  const balance = await tx.inventoryBalance.findUnique({
    where: {
      branchId_productId: {
        branchId: input.branchId,
        productId: resolved.inventoryProductId,
      },
    },
  });
  if (!balance) throw new Error("INVENTORY_BALANCE_NOT_FOUND");

  const deficit = requestedQty.sub(balance.looseUnitQuantity);
  const autoOpenMovements = [];

  if (deficit.gt(0)) {
    const maxOpenablePackages = Prisma.Decimal.max(0, balance.closedPackageQuantity.sub(reserve));
    const packagesToOpen = new Prisma.Decimal(Math.ceil(Number(deficit.div(factor))));

    if (!conversion.autoOpenForUnitSale || packagesToOpen.gt(maxOpenablePackages)) {
      throw new InventoryStockError(
        "INSUFFICIENT_LOOSE_AND_RESERVED_PACKAGE_STOCK",
        "No hay suficientes unidades sueltas y no se puede abrir el ultimo kilo/caja cerrado.",
      );
    }

    const packageMember = await tx.productStockGroupMember.findFirst({
      where: {
        stockGroupId: conversion.stockGroupId,
        isActive: true,
        isPackagePresentation: true,
      },
      select: { productId: true },
    });

    let closed = balance.closedPackageQuantity;
    let loose = balance.looseUnitQuantity;
    let equivalent = balance.quantityOnHand;
    for (let index = 0; index < Number(packagesToOpen); index += 1) {
      const closedBefore = closed;
      const looseBefore = loose;
      const equivalentBefore = equivalent;
      const closedAfter = closedBefore.sub(1);
      const looseAfter = looseBefore.add(factor);
      const equivalentAfter = closedAfter.mul(factor).add(looseAfter);

      const movement = await tx.inventoryMovement.create({
        data: {
          branchId: input.branchId,
          productId: resolved.inventoryProductId,
          movementType: "PACKAGE_AUTO_OPENED",
          quantity: new Prisma.Decimal(1),
          unitCost: balance.weightedAverageCost,
          referenceType,
          referenceId,
          notes: "Apertura automatica para venta unitaria",
          inputProductId: packageMember?.productId ?? input.productId,
          inputQuantity: new Prisma.Decimal(1),
          inputUnit: conversion.packageUnit,
          packageUnit: conversion.packageUnit,
          baseUnit: conversion.baseUnit,
          conversionFactorSnapshot: factor,
          estimatedUnits: factor,
          actualUnits: factor,
          closedPackageBefore: closedBefore,
          closedPackageAfter: closedAfter,
          looseUnitBefore: looseBefore,
          looseUnitAfter: looseAfter,
          equivalentBaseBefore: equivalentBefore,
          equivalentBaseAfter: equivalentAfter,
          reason: "AUTO_OPEN_FOR_UNIT_SALE",
          userId: input.userId,
        },
      });
      autoOpenMovements.push(movement);
      closed = closedAfter;
      loose = looseAfter;
      equivalent = equivalentAfter;
    }

    await tx.inventoryBalance.update({
      where: { id: balance.id },
      data: {
        closedPackageQuantity: closed,
        looseUnitQuantity: loose,
        quantityOnHand: equivalent,
        inventoryValue: equivalent.mul(balance.weightedAverageCost),
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.userId,
        branchId: input.branchId,
        module: "inventory",
        action: "PACKAGE_AUTO_OPENED",
        entityType: "ProductStockGroup",
        entityId: conversion.stockGroupId,
        metadataJson: {
          reason: "AUTO_OPEN_FOR_UNIT_SALE",
          branchId: input.branchId,
          stockGroupId: conversion.stockGroupId,
          closedPackageProductId: packageMember?.productId ?? null,
          looseUnitProductId: conversion.canonicalProductId,
          packageUnit: conversion.packageUnit,
          baseUnit: conversion.baseUnit,
          conversionFactorSnapshot: factor.toString(),
          estimatedUnits: factor.mul(packagesToOpen).toString(),
          actualUnits: factor.mul(packagesToOpen).toString(),
          closedBefore: balance.closedPackageQuantity.toString(),
          closedAfter: closed.toString(),
          looseBefore: balance.looseUnitQuantity.toString(),
          looseAfter: loose.toString(),
          equivalentBefore: balance.quantityOnHand.toString(),
          equivalentAfter: equivalent.toString(),
          saleOrderId: input.saleOrderId ?? null,
          paymentId: input.paymentId ?? null,
          userId: input.userId,
          movementIds: autoOpenMovements.map((movement) => movement.id),
        },
      },
    });
  }

  const refreshed = await tx.inventoryBalance.findUnique({
    where: {
      branchId_productId: {
        branchId: input.branchId,
        productId: resolved.inventoryProductId,
      },
    },
  });
  const currentWac = refreshed?.weightedAverageCost ?? balance.weightedAverageCost;
  const saleResult = await createInventoryMovementTx(tx, {
    actorUserId: input.userId,
    branchId: input.branchId,
    productId: input.productId,
    movementType: InventoryMovementType.SALE_OUT,
    quantity: Number(requestedQty),
    unitCost: Number(currentWac),
    referenceType,
    referenceId,
    notes: input.notes ?? null,
  });

  return { movements: [...autoOpenMovements, saleResult.movement], balance: saleResult.balance };
}

export async function openStockPackage(input: OpenPackageInput) {
  return prisma.$transaction(async (tx) => {
    const group = await tx.productStockGroup.findUnique({
      where: { id: input.stockGroupId },
      include: {
        products: {
          where: { isActive: true },
          include: { product: { select: { id: true, sku: true, name: true } } },
          orderBy: [{ isCanonical: "desc" }, { conversionFactor: "asc" }],
        },
      },
    });
    if (!group || !group.isActive) throw new Error("NOT_FOUND: Grupo de stock no encontrado.");
    if (!group.tracksPackages || !group.packageUnit || !group.conversionFactorToBase) {
      throw new Error("VALIDATION_ERROR: Este grupo no maneja stock cerrado/suelto.");
    }

    const canonical = group.products.find((member) => member.isCanonical)
      ?? group.products.find((member) => new Prisma.Decimal(member.conversionFactor).eq(1));
    const packageMember = input.packageProductId
      ? group.products.find((member) => member.productId === input.packageProductId)
      : group.products.find((member) => member.isPackagePresentation) ?? group.products.find((member) => !member.isCanonical);
    if (!canonical || !packageMember) {
      throw new Error("VALIDATION_ERROR: El grupo requiere producto base y presentacion cerrada.");
    }

    const estimatedUnits = group.conversionFactorToBase;
    const actualUnits = new Prisma.Decimal(input.actualUnits ?? Number(estimatedUnits));
    if (actualUnits.lte(0)) {
      throw new Error("VALIDATION_ERROR: Las unidades reales deben ser mayores que 0.");
    }

    await tx.inventoryBalance.upsert({
      where: { branchId_productId: { branchId: input.branchId, productId: canonical.productId } },
      create: {
        branchId: input.branchId,
        productId: canonical.productId,
        quantityOnHand: 0,
        closedPackageQuantity: 0,
        looseUnitQuantity: 0,
        weightedAverageCost: 0,
        inventoryValue: 0,
      },
      update: {},
    });
    await tx.$queryRaw`
      SELECT id
      FROM "InventoryBalance"
      WHERE "branchId" = ${input.branchId}
        AND "productId" = ${canonical.productId}
      FOR UPDATE
    `;

    const balance = await tx.inventoryBalance.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: canonical.productId } },
    });
    if (!balance) throw new Error("INVENTORY_BALANCE_NOT_FOUND");
    if (balance.closedPackageQuantity.lt(1)) {
      throw new Error("INSUFFICIENT_CLOSED_PACKAGE_STOCK");
    }

    const closedPackageBefore = balance.closedPackageQuantity;
    const looseUnitBefore = balance.looseUnitQuantity;
    const equivalentBaseBefore = balance.quantityOnHand;
    const closedPackageAfter = closedPackageBefore.sub(1);
    const looseUnitAfter = looseUnitBefore.add(actualUnits);
    const equivalentBaseAfter = closedPackageAfter.mul(estimatedUnits).add(looseUnitAfter);
    const reason = input.reason?.trim() || "Apertura para venta unitaria";

    const movement = await tx.inventoryMovement.create({
      data: {
        branchId: input.branchId,
        productId: canonical.productId,
        movementType: "PACKAGE_OPENED",
        quantity: new Prisma.Decimal(1),
        unitCost: balance.weightedAverageCost,
        referenceType: "PACKAGE_OPENING",
        referenceId: `OPEN-PACKAGE-${Date.now()}`,
        notes: reason,
        inputProductId: packageMember.productId,
        inputQuantity: new Prisma.Decimal(1),
        inputUnit: group.packageUnit,
        packageUnit: group.packageUnit,
        baseUnit: group.baseUnit,
        conversionFactorSnapshot: estimatedUnits,
        estimatedUnits,
        actualUnits,
        closedPackageBefore,
        closedPackageAfter,
        looseUnitBefore,
        looseUnitAfter,
        equivalentBaseBefore,
        equivalentBaseAfter,
        reason,
        userId: input.actorUserId,
      },
    });

    const updatedBalance = await tx.inventoryBalance.update({
      where: { id: balance.id },
      data: {
        closedPackageQuantity: closedPackageAfter,
        looseUnitQuantity: looseUnitAfter,
        quantityOnHand: equivalentBaseAfter,
        inventoryValue: equivalentBaseAfter.mul(balance.weightedAverageCost),
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        module: "inventory",
        action: "PACKAGE_OPENED",
        entityType: "ProductStockGroup",
        entityId: group.id,
        metadataJson: {
          stockGroupId: group.id,
          packageProductId: packageMember.productId,
          canonicalProductId: canonical.productId,
          packageUnit: group.packageUnit,
          baseUnit: group.baseUnit,
          estimatedUnits: estimatedUnits.toString(),
          actualUnits: actualUnits.toString(),
          closedPackageBefore: closedPackageBefore.toString(),
          closedPackageAfter: closedPackageAfter.toString(),
          looseUnitBefore: looseUnitBefore.toString(),
          looseUnitAfter: looseUnitAfter.toString(),
          equivalentBaseBefore: equivalentBaseBefore.toString(),
          equivalentBaseAfter: equivalentBaseAfter.toString(),
          reason,
        },
      },
    });

    return {
      ok: true,
      movementId: movement.id,
      branchId: input.branchId,
      stockGroupId: group.id,
      packageProductId: packageMember.productId,
      baseProductId: canonical.productId,
      packageUnit: group.packageUnit,
      baseUnit: group.baseUnit,
      estimatedUnits: Number(estimatedUnits),
      actualUnits: Number(actualUnits),
      closedPackageQuantity: Number(updatedBalance.closedPackageQuantity),
      looseUnitQuantity: Number(updatedBalance.looseUnitQuantity),
      equivalentBaseQuantity: Number(updatedBalance.quantityOnHand),
    };
  });
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

async function createOpeningBalanceTx(
  tx: Prisma.TransactionClient,
  input: OpeningBalanceInput,
  options: OpeningBalanceTxOptions = {},
) {
    const shared = await getSharedInventoryBalance(tx, { branchId: input.branchId, productId: input.productId });
    const conversion = shared.conversion;
    const selectedUnit = (input.unit ?? conversion?.saleUnit ?? "").toUpperCase();
    const isBaseUnit = !!conversion && selectedUnit === conversion.baseUnit.toUpperCase();
    const currentBaseQty = shared.balance?.quantityOnHand ?? new Prisma.Decimal(0);
    const previousBaseWac = shared.balance?.weightedAverageCost ?? new Prisma.Decimal(0);
    const requestedQty = new Prisma.Decimal(input.quantity);
    const movementProductId = isBaseUnit && conversion ? conversion.canonicalProductId : input.productId;
    const stockChange = calculateSharedStockChange({
      currentBaseQuantity: currentBaseQty,
      enteredQuantity: requestedQty,
      conversionFactor: conversion?.conversionFactor ?? 1,
      isBaseUnit,
      mode: input.stockMode,
    });
    const baseQuantity = stockChange.enteredBaseQty;
    const baseDelta = stockChange.deltaBaseQty;
    const movementBaseQty = baseDelta.abs();
    const movementQty = stockChange.movementQuantity;
    const movementType = baseDelta.lt(0) ? "ADJUSTMENT_OUT" : "ADJUSTMENT_IN";

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

    const referenceType = options.referenceType ?? "OPENING_BALANCE";
    const referenceId = options.referenceId ?? `OPENING-${Date.now()}`;
    let movementResult: any = null;
    if (baseDelta.eq(0)) {
      const balance = await tx.inventoryBalance.upsert({
        where: { branchId_productId: { branchId: input.branchId, productId: shared.inventoryProductId } },
        create: {
          branchId: input.branchId,
          productId: shared.inventoryProductId,
          quantityOnHand: currentBaseQty,
          weightedAverageCost: previousBaseWac,
          inventoryValue: currentBaseQty.mul(previousBaseWac),
        },
        update: {},
      });
      const movement = options.createNoopMovement === false
        ? null
        : await tx.inventoryMovement.create({
            data: {
              branchId: input.branchId,
              productId: shared.inventoryProductId,
              movementType: "ADJUSTMENT_IN",
              quantity: new Prisma.Decimal(0),
              unitCost: previousBaseWac,
              referenceType,
              referenceId,
              notes: `Sin cambio de stock - ${input.reason}${input.notes ? ` - ${input.notes}` : ""}`,
            },
          });
      movementResult = { movement, balance };
    } else if (input.costMode === "SET_WAC") {
      movementResult = await createInventoryMovementTx(tx, {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        productId: movementProductId,
        movementType,
        quantity: Number(movementQty),
        unitCost: Number(unitCost),
        referenceType,
        referenceId,
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
      const nextQty = input.stockMode === "SET_PHYSICAL_STOCK"
        ? baseQuantity
        : balance.quantityOnHand.plus(baseQuantity);
      const nextWac = balance.weightedAverageCost;
      const movement = await tx.inventoryMovement.create({
        data: {
          branchId: input.branchId,
          productId: inventoryProductId,
          movementType,
          quantity: movementBaseQty,
          unitCost: nextWac,
          referenceType,
          referenceId,
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

    if (!options.skipLineAudit) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: input.branchId,
          module: "inventory",
          action: options.auditAction ?? "OPENING_BALANCE_CREATE",
          entityType: "Product",
          entityId: input.productId,
          metadataJson: {
        productId: input.productId,
        branchId: input.branchId,
        inventoryProductId: shared.inventoryProductId,
        movementId: movementResult.movement?.id ?? null,
        bulkReference: options.bulkReference ?? null,
        oldStock: currentBaseQty.toString(),
        newStock: newBaseQty.toString(),
        quantityBase: baseQuantity.toString(),
        stockMode: input.stockMode,
        adjustmentBaseDelta: baseDelta.toString(),
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
        },
      });
    }

    return {
      ok: true,
      movementId: movementResult.movement?.id ?? null,
      productId: input.productId,
      inventoryProductId: shared.inventoryProductId,
      branchId: input.branchId,
      movementType,
      referenceType,
      referenceId,
      costMode: input.costMode,
      priceMode: input.priceMode,
      previousBaseStock: Number(currentBaseQty),
      newBaseStock: Number(newBaseQty),
      quantityBase: Number(baseQuantity),
      stockMode: input.stockMode,
      adjustmentBaseDelta: Number(baseDelta),
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
      stockConversion: conversion ? {
        stockGroupId: conversion.stockGroupId,
        stockGroupCode: conversion.stockGroupCode,
        baseUnit: conversion.baseUnit,
        saleUnit: conversion.saleUnit,
        conversionFactor: conversion.conversionFactor.toString(),
        saleQuantity: input.quantity,
        baseQuantity: Number(baseQuantity),
      } : null,
    };
}

export async function createOpeningBalance(input: OpeningBalanceInput) {
  return prisma.$transaction((tx) => createOpeningBalanceTx(tx, input, { createNoopMovement: true }));
}

export async function createOpeningBalanceBulk(input: {
  actorUserId: string;
  branchId: string;
  mode: "SET_PHYSICAL_STOCK" | "ADD_OPENING_STOCK";
  reason: string;
  notes?: string | null;
  lines: Array<{
    productId: string;
    quantity: number;
    unit?: string;
    unitCost?: number | null;
    costMode: "SET_WAC" | "SET_BRANCH_COST" | "QUANTITY_ONLY";
    salePrice?: number | null;
    priceMode: "SET_BRANCH_PRICE" | "SET_GLOBAL_PRICE" | "NO_PRICE_CHANGE";
    notes?: string | null;
  }>;
}) {
  const batchReference = `OPENING-BULK-${Date.now()}`;
  return prisma.$transaction(async (tx) => {
    const lines = [];
    for (let index = 0; index < input.lines.length; index += 1) {
      const line = input.lines[index];
      const result = await createOpeningBalanceTx(tx, {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        productId: line.productId,
        quantity: line.quantity,
        unit: line.unit,
        stockMode: input.mode,
        unitCost: line.unitCost,
        costMode: line.costMode,
        salePrice: line.salePrice,
        priceMode: line.priceMode,
        reason: input.reason,
        notes: [line.notes, input.notes].filter(Boolean).join(" - ") || null,
      }, {
        referenceType: "OPENING_BALANCE_BULK",
        referenceId: `${batchReference}-${index + 1}`,
        createNoopMovement: false,
        skipLineAudit: true,
        bulkReference: batchReference,
      });
      lines.push(result);
    }

    const processed = lines.filter((line) => line.movementId !== null).length;
    const skipped = lines.length - processed;
    const summary = {
      totalProducts: lines.length,
      totalInventoryValue: lines.reduce((sum, line) => sum + (Number(line.newBaseStock) * Number(line.weightedAverageCost)), 0),
      productsWithoutCost: lines.filter((line) => line.newCost === null || line.newCost <= 0).length,
      productsWithoutPrice: lines.filter((line) => line.newPrice === null || line.newPrice <= 0).length,
      productsBelowCost: lines.filter((line) => line.newCost !== null && line.newPrice < line.newCost).length,
      lowMarginProducts: lines.filter((line) => {
        if (line.newCost === null || line.newPrice <= 0 || line.newPrice < line.newCost) return false;
        const margin = ((line.newPrice - line.newCost) / line.newPrice) * 100;
        return margin < 20;
      }).length,
    };

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        module: "inventory",
        action: "OPENING_BALANCE_BULK_CREATE",
        entityType: "InventoryMovement",
        entityId: batchReference,
        metadataJson: {
          batchReference,
          mode: input.mode,
          reason: input.reason,
          notes: input.notes ?? null,
          lineCount: input.lines.length,
          processed,
          skipped,
          productIds: input.lines.map((line) => line.productId),
          summary,
          changes: lines.map((line) => ({
            productId: line.productId,
            inventoryProductId: line.inventoryProductId,
            movementId: line.movementId,
            previousBaseStock: line.previousBaseStock,
            newBaseStock: line.newBaseStock,
            adjustmentBaseDelta: line.adjustmentBaseDelta,
            movementType: line.movementType,
            stockConversion: line.stockConversion,
          })),
        },
      },
    });

    return {
      ok: true,
      batchReference,
      processed,
      skipped,
      summary,
      lines,
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
