import { PurchaseOrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { createInventoryMovementTx } from "@/modules/inventory/service";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { resolvePolicyForProduct } from "@/modules/pricing/category-policy-service";
import {
  convertBaseQtyToSaleQty,
  convertBaseUnitCostToSaleUnitCost,
  convertSaleQtyToBaseQty,
  getSharedInventoryBalance,
  resolveInventoryProductForMovement,
} from "@/modules/inventory/unit-conversion";

/* ── Helpers ── */
function generateOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PO-${ts}-${rand}`;
}

type PurchaseTaxTreatment = "INCLUDE_IN_COST" | "SEPARATE_CREDIT";

type ReceivePurchaseOrderInput = {
  branchId?: string;
  receivedAt?: string;
  items?: {
    productId: string;
    purchaseOrderLineId?: string;
    quantityReceived: number;
    unitCost?: number;
    allocatedFreightPerUnit?: number;
    allocatedOtherChargesPerUnit?: number;
    notes?: string;
  }[];
  freightAmount?: number;
  otherChargesAmount?: number;
  updateBranchCost?: boolean;
  createPriceReviewAlerts?: boolean;
  allowOverReceive?: boolean;
  notes?: string;
};
type ReceivePurchaseOrderItem = NonNullable<ReceivePurchaseOrderInput["items"]>[number];

function money(value: number) {
  return Math.round(value * 10000) / 10000;
}

function nonNegative(value: unknown, fallback = 0) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function positive(value: unknown, fallback = 0) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function marginPercent(price: number | null, cost: number | null) {
  if (price === null || cost === null || price <= 0) return null;
  return ((price - cost) / price) * 100;
}

function normalizeTaxTreatment(value: unknown): PurchaseTaxTreatment {
  return value === "SEPARATE_CREDIT" ? "SEPARATE_CREDIT" : "INCLUDE_IN_COST";
}

/* ── List ── */
export async function listPurchaseOrders(params?: { status?: PurchaseOrderStatus }) {
  return prisma.purchaseOrder.findMany({
    where: params?.status ? { status: params.status } : undefined,
    include: {
      branch: true,
      createdBy: { select: { id: true, username: true, fullName: true } },
      lines: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/* ── Get by ID ── */
export async function getPurchaseOrder(id: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      branch: true,
      createdBy: { select: { id: true, username: true, fullName: true } },
      lines: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
    },
  });
  if (!po) throw new Error("NOT_FOUND");
  return po;
}

/* ── Create ── */
type CreatePOInput = {
  userId: string;
  branchId: string;
  supplier?: string;
  notes?: string;
  purchaseTaxTreatment?: string;
  freightAmount?: number;
  otherChargesAmount?: number;
  globalDiscountAmount?: number;
  lines: {
    productId: string;
    quantity: number;
    unitCost?: number;
    unitCostBeforeTax?: number;
    taxRate?: number;
    unitTaxAmount?: number;
  }[];
};

export async function createPurchaseOrder(input: CreatePOInput) {
  if (!input.lines.length) throw new Error("INVALID_INPUT: Debe agregar al menos una línea");
  if (!input.branchId) throw new Error("INVALID_INPUT: branchId es requerido");
  if (!input.userId) throw new Error("INVALID_INPUT: userId es requerido");

  // Validate each line
  for (const l of input.lines) {
    if (!l.productId) throw new Error("INVALID_INPUT: productId es requerido en cada línea");
    if (typeof l.quantity !== "number" || l.quantity <= 0) throw new Error("INVALID_INPUT: Cantidad debe ser un número positivo");
    const unitCostBeforeTax = l.unitCostBeforeTax ?? l.unitCost;
    if (typeof unitCostBeforeTax !== "number" || unitCostBeforeTax < 0) throw new Error("INVALID_INPUT: Costo unitario no puede ser negativo");
  }

  const purchaseTaxTreatment = normalizeTaxTreatment(input.purchaseTaxTreatment);
  const freightAmount = nonNegative(input.freightAmount);
  const otherChargesAmount = nonNegative(input.otherChargesAmount);
  const globalDiscountAmount = nonNegative(input.globalDiscountAmount);

  const rawLines = input.lines.map((l) => {
    const quantity = nonNegative(l.quantity);
    const unitCostBeforeTax = nonNegative(l.unitCostBeforeTax ?? l.unitCost);
    const taxRate = nonNegative(l.taxRate, 15);
    const unitTaxAmount = l.unitTaxAmount !== undefined ? nonNegative(l.unitTaxAmount) : money(unitCostBeforeTax * (taxRate / 100));
    const subtotalBeforeTax = money(quantity * unitCostBeforeTax);
    return { ...l, quantity, unitCostBeforeTax, taxRate, unitTaxAmount, subtotalBeforeTax };
  });

  const subtotalBeforeTaxNumber = money(rawLines.reduce((acc, l) => acc + l.subtotalBeforeTax, 0));
  const taxAmountNumber = money(rawLines.reduce((acc, l) => acc + l.quantity * l.unitTaxAmount, 0));
  const totalPaidNumber = money(subtotalBeforeTaxNumber + taxAmountNumber + freightAmount + otherChargesAmount - globalDiscountAmount);
  if (totalPaidNumber < 0) throw new Error("INVALID_INPUT: El descuento global no puede superar el total de la factura");

  const totalAllocationBase = subtotalBeforeTaxNumber > 0
    ? subtotalBeforeTaxNumber
    : rawLines.reduce((acc, l) => acc + l.quantity, 0);

  const lines = rawLines.map((l) => {
    const allocationWeight = totalAllocationBase > 0
      ? (subtotalBeforeTaxNumber > 0 ? l.subtotalBeforeTax : l.quantity) / totalAllocationBase
      : 0;
    const allocatedFreightPerUnit = l.quantity > 0 ? money((freightAmount * allocationWeight) / l.quantity) : 0;
    const allocatedOtherChargesPerUnit = l.quantity > 0 ? money((otherChargesAmount * allocationWeight) / l.quantity) : 0;
    const allocatedDiscountPerUnit = l.quantity > 0 ? money((globalDiscountAmount * allocationWeight) / l.quantity) : 0;
    const costWithTax = money(l.unitCostBeforeTax + l.unitTaxAmount);
    const finalUnitCost = money(
      l.unitCostBeforeTax
      + (purchaseTaxTreatment === "INCLUDE_IN_COST" ? l.unitTaxAmount : 0)
      + allocatedFreightPerUnit
      + allocatedOtherChargesPerUnit
      - allocatedDiscountPerUnit,
    );
    if (finalUnitCost < 0) throw new Error("INVALID_INPUT: El costo final no puede ser negativo");

    return {
      productId: l.productId,
      quantity: new Prisma.Decimal(l.quantity),
      unitCost: new Prisma.Decimal(finalUnitCost),
      unitCostBeforeTax: new Prisma.Decimal(l.unitCostBeforeTax),
      taxRate: new Prisma.Decimal(l.taxRate),
      unitTaxAmount: new Prisma.Decimal(l.unitTaxAmount),
      costWithTax: new Prisma.Decimal(costWithTax),
      allocatedFreightPerUnit: new Prisma.Decimal(allocatedFreightPerUnit),
      allocatedOtherChargesPerUnit: new Prisma.Decimal(allocatedOtherChargesPerUnit),
      allocatedDiscountPerUnit: new Prisma.Decimal(allocatedDiscountPerUnit),
      finalUnitCost: new Prisma.Decimal(finalUnitCost),
      subtotal: new Prisma.Decimal(l.quantity).mul(new Prisma.Decimal(finalUnitCost)),
    };
  });

  const total = new Prisma.Decimal(totalPaidNumber);

  const po = await prisma.purchaseOrder.create({
    data: {
      orderNumber: generateOrderNumber(),
      supplier: input.supplier || null,
      notes: input.notes || null,
      branchId: input.branchId,
      userId: input.userId,
      total,
      subtotalBeforeTax: new Prisma.Decimal(subtotalBeforeTaxNumber),
      taxAmount: new Prisma.Decimal(taxAmountNumber),
      freightAmount: new Prisma.Decimal(freightAmount),
      otherChargesAmount: new Prisma.Decimal(otherChargesAmount),
      globalDiscountAmount: new Prisma.Decimal(globalDiscountAmount),
      purchaseTaxTreatment,
      lines: {
        create: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          unitCostBeforeTax: l.unitCostBeforeTax,
          taxRate: l.taxRate,
          unitTaxAmount: l.unitTaxAmount,
          costWithTax: l.costWithTax,
          allocatedFreightPerUnit: l.allocatedFreightPerUnit,
          allocatedOtherChargesPerUnit: l.allocatedOtherChargesPerUnit,
          allocatedDiscountPerUnit: l.allocatedDiscountPerUnit,
          finalUnitCost: l.finalUnitCost,
          subtotal: l.subtotal,
        })),
      },
    },
    include: {
      lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
      branch: true,
    },
  });

  await logAuditEvent({
    actorUserId: input.userId,
    branchId: input.branchId,
    module: "purchase-orders",
    action: "PURCHASE_ORDER_CREATED",
    entityType: "PurchaseOrder",
    entityId: po.id,
    metadataJson: {
      orderNumber: po.orderNumber,
      total: total.toString(),
      subtotalBeforeTax: subtotalBeforeTaxNumber,
      taxAmount: taxAmountNumber,
      purchaseTaxTreatment,
      linesCount: lines.length,
    },
  });

  return po;
}

/* ── Approve (adds to inventory) ── */
export async function approvePurchaseOrder(id: string, userId: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, branch: true },
  });

  if (!po) throw new Error("NOT_FOUND");
  if (po.status !== "DRAFT") throw new Error("INVALID_INPUT: Solo se pueden aprobar pedidos en estado BORRADOR");

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.purchaseOrder.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "APPROVED" },
    });
    if (updated.count === 0) {
      throw new Error("INVALID_INPUT: El pedido ya no esta en estado BORRADOR");
    }

    return tx.purchaseOrder.findUniqueOrThrow({ where: { id } });
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: po.branchId,
    module: "purchase-orders",
    action: "PURCHASE_ORDER_APPROVED",
    entityType: "PurchaseOrder",
    entityId: po.id,
    metadataJson: {
      orderNumber: po.orderNumber,
      total: po.total.toString(),
      linesCount: po.lines.length,
      branchCode: po.branch.code,
      previousStatus: po.status,
      newStatus: "APPROVED",
      approvedAt: new Date().toISOString(),
    },
  });

  return result;
}

export async function receivePurchaseOrder(id: string, userId: string, input: ReceivePurchaseOrderInput = {}) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, branch: true },
  });

  if (!po) throw new Error("NOT_FOUND");
  if (po.status === "RECEIVED") throw new Error("INVALID_INPUT: Este pedido ya fue recibido completamente");
  if (po.status !== "APPROVED") throw new Error("INVALID_INPUT: Solo se pueden recibir pedidos en estado APROBADO");
  if (input.branchId && input.branchId !== po.branchId) throw new Error("INVALID_INPUT: La sucursal de recepcion no coincide con el pedido");

  const lineStockResolutions = await Promise.all(po.lines.map(async (line) => ({
    lineId: line.id,
    productId: line.productId,
    ...(await resolveInventoryProductForMovement(prisma, line.productId)),
  })));
  const stockResolutionByProductId = new Map(lineStockResolutions.map((row) => [row.productId, row]));
  const stockResolutionByLineId = new Map(lineStockResolutions.map((row) => [row.lineId, row]));
  const inventoryProductIds = Array.from(new Set(lineStockResolutions.map((row) => row.inventoryProductId)));

  const previousMovements = await prisma.inventoryMovement.groupBy({
    by: ["productId"],
    where: { referenceType: "PurchaseOrder", referenceId: po.id, movementType: "PURCHASE_IN", productId: { in: inventoryProductIds } },
    _sum: { quantity: true },
  });
  const receivedByProduct = new Map(previousMovements.map((row) => [row.productId, Number(row._sum.quantity ?? 0)]));
  const requestedByProduct = new Map(po.lines.map((line) => {
    const resolution = stockResolutionByLineId.get(line.id);
    const requestedBaseQty = resolution?.conversion
      ? Number(convertSaleQtyToBaseQty({ quantity: line.quantity, conversionFactor: resolution.conversion.conversionFactor }))
      : Number(line.quantity);
    return [line.productId, requestedBaseQty];
  }));
  const pendingByProduct = new Map(po.lines.map((line) => {
    const resolution = stockResolutionByLineId.get(line.id);
    const receivedBaseQty = receivedByProduct.get(resolution?.inventoryProductId ?? line.productId) ?? 0;
    const pendingBaseQty = (requestedByProduct.get(line.productId) ?? 0) - receivedBaseQty;
    const pendingSaleQty = resolution?.conversion
      ? Number(convertBaseQtyToSaleQty({ baseQuantity: pendingBaseQty, conversionFactor: resolution.conversion.conversionFactor }))
      : pendingBaseQty;
    return [line.productId, pendingSaleQty];
  }));
  const defaultItems: ReceivePurchaseOrderItem[] = po.lines
    .map((line) => ({ productId: line.productId, purchaseOrderLineId: line.id, quantityReceived: pendingByProduct.get(line.productId) ?? 0 }))
    .filter((item) => item.quantityReceived > 0);
  const requestedItems: ReceivePurchaseOrderItem[] = input.items?.length ? input.items : defaultItems;
  if (requestedItems.length === 0) throw new Error("INVALID_INPUT: No hay cantidades pendientes por recibir");

  const totalReceiveQty = requestedItems.reduce((sum, item) => sum + positive(item.quantityReceived), 0);
  const freightPerUnit = totalReceiveQty > 0 ? nonNegative(input.freightAmount) / totalReceiveQty : 0;
  const otherPerUnit = totalReceiveQty > 0 ? nonNegative(input.otherChargesAmount) / totalReceiveQty : 0;
  const warnings: string[] = [];

  const result = await prisma.$transaction(async (tx) => {
    const receivedLines = [];

    for (const item of requestedItems) {
      const line = po.lines.find((candidate) => candidate.productId === item.productId || candidate.id === item.purchaseOrderLineId);
      if (!line) throw new Error(`INVALID_INPUT: Producto ${item.productId} no pertenece al pedido`);
      const qtyReceived = positive(item.quantityReceived);
      if (qtyReceived <= 0) throw new Error("INVALID_INPUT: quantityReceived debe ser mayor que 0");
      const pendingQty = pendingByProduct.get(line.productId) ?? 0;
      if (pendingQty <= 0) throw new Error(`INVALID_INPUT: ${line.product.name} no tiene cantidad pendiente por recibir`);
      if (qtyReceived > pendingQty && !input.allowOverReceive) {
        throw new Error(`INVALID_INPUT: No se puede recibir mas de lo pendiente para ${line.product.name}. Pendiente: ${pendingQty}`);
      }

      const shared = await getSharedInventoryBalance(tx, { branchId: po.branchId, productId: line.productId });
      const previousBalance = shared.balance;
      const previousStock = Number(previousBalance?.quantityOnHand ?? 0);
      const previousWac = previousBalance
        ? Number(shared.conversion
          ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: previousBalance.weightedAverageCost, conversionFactor: shared.conversion.conversionFactor })
          : previousBalance.weightedAverageCost)
        : null;
      const baseUnitCost = item.unitCost ?? Number(line.unitCostBeforeTax ?? line.unitCost);
      const finalUnitCost = money(baseUnitCost + (item.allocatedFreightPerUnit ?? freightPerUnit) + (item.allocatedOtherChargesPerUnit ?? otherPerUnit));
      const lineWarnings: string[] = [];

      const movementResult = await createInventoryMovementTx(tx, {
        actorUserId: userId,
        branchId: po.branchId,
        productId: line.productId,
        movementType: "PURCHASE_IN",
        quantity: qtyReceived,
        unitCost: finalUnitCost,
        referenceType: "PurchaseOrder",
        referenceId: po.id,
        notes: item.notes ?? input.notes ?? `Recepcion pedido de compra ${po.orderNumber}`,
      });

      if (input.updateBranchCost) {
        const branchCost = stockResolutionByProductId.get(line.productId)?.conversion
          ? convertBaseUnitCostToSaleUnitCost({
              baseUnitCost: movementResult.balance.weightedAverageCost,
              conversionFactor: stockResolutionByProductId.get(line.productId)!.conversion!.conversionFactor,
            })
          : movementResult.balance.weightedAverageCost;
        await tx.branchProductSetting.upsert({
          where: { branchId_productId: { branchId: po.branchId, productId: line.productId } },
          create: { branchId: po.branchId, productId: line.productId, branchCost },
          update: { branchCost },
        });
      }

      const pricing = await getEffectiveProductPricing(tx, { branchId: po.branchId, productId: line.productId });
      const policy = await resolvePolicyForProduct({ branchId: po.branchId, productId: line.productId });
      const effectivePrice = Number(pricing.effectivePrice);
      const effectiveCost = pricing.effectiveCost === null ? null : Number(pricing.effectiveCost);
      const margin = marginPercent(effectivePrice, effectiveCost);
      let priceReviewRequired = false;
      const oldCost = previousWac ?? 0;
      const costIncreasePercent = oldCost > 0 ? ((finalUnitCost - oldCost) / oldCost) * 100 : 0;
      if (effectiveCost !== null && effectivePrice < effectiveCost) {
        priceReviewRequired = true;
        lineWarnings.push("Precio efectivo debajo del costo efectivo; revisar precio de venta.");
      }
      if (margin !== null && margin < policy.categoryPolicy.minMarginPercent) {
        priceReviewRequired = true;
        lineWarnings.push("Margen real debajo del minimo de categoria; revisar precio de venta.");
      }
      if (costIncreasePercent > 10) {
        priceReviewRequired = true;
        lineWarnings.push(`El costo recibido subio ${costIncreasePercent.toFixed(1)}%. Revisar precio de venta antes de vender.`);
      }
      warnings.push(...lineWarnings);

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          branchId: po.branchId,
          module: "purchase-orders",
          action: "PURCHASE_ORDER_LINE_RECEIVED",
          entityType: "PurchaseOrderLine",
          entityId: line.id,
          metadataJson: {
            productId: line.productId,
            inventoryProductId: stockResolutionByProductId.get(line.productId)?.inventoryProductId ?? line.productId,
            oldQty: previousStock,
            receivedQty: qtyReceived,
            newQty: movementResult.balance.quantityOnHand.toString(),
            oldWac: previousWac,
            finalUnitCost,
            newWac: movementResult.balance.weightedAverageCost.toString(),
            priceReviewRequired,
            warnings: lineWarnings,
          },
        },
      });

      receivedLines.push({
        productId: line.productId,
        quantityReceived: qtyReceived,
        finalUnitCost,
        previousStock,
        newStock: Number(movementResult.balance.quantityOnHand),
        previousWeightedAverageCost: previousWac,
        newWeightedAverageCost: Number(movementResult.balance.weightedAverageCost),
        priceReviewRequired,
        warnings: lineWarnings,
      });
    }

    const movementTotals = await tx.inventoryMovement.groupBy({
      by: ["productId"],
      where: { referenceType: "PurchaseOrder", referenceId: po.id, movementType: "PURCHASE_IN", productId: { in: inventoryProductIds } },
      _sum: { quantity: true },
    });
    const totalReceivedByProduct = new Map(movementTotals.map((row) => [row.productId, Number(row._sum.quantity ?? 0)]));
    const fullyReceived = po.lines.every((line) => {
      const resolution = stockResolutionByLineId.get(line.id);
      const requestedBaseQty = requestedByProduct.get(line.productId) ?? Number(line.quantity);
      return (totalReceivedByProduct.get(resolution?.inventoryProductId ?? line.productId) ?? 0) >= requestedBaseQty;
    });
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: fullyReceived ? "RECEIVED" : "APPROVED" },
    });

    return {
      ok: true,
      purchaseOrderId: po.id,
      statusAfter: fullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED",
      receivedLines,
      warnings,
    };
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: po.branchId,
    module: "purchase-orders",
    action: "PURCHASE_ORDER_RECEIVED",
    entityType: "PurchaseOrder",
    entityId: po.id,
    metadataJson: {
      orderNumber: po.orderNumber,
      total: po.total.toString(),
      linesCount: result.receivedLines.length,
      branchCode: po.branch.code,
      statusAfter: result.statusAfter,
      warnings: result.warnings,
    },
  });

  return result;
}

/* ── Cancel ── */
export async function cancelPurchaseOrder(id: string, userId: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      lines: true,
    },
  });
  if (!po) throw new Error("NOT_FOUND");
  if (!["DRAFT", "APPROVED"].includes(po.status)) throw new Error("INVALID_INPUT: Solo se pueden cancelar pedidos en borrador o aprobados");
  const receivedMovements = await prisma.inventoryMovement.count({
    where: { referenceType: "PurchaseOrder", referenceId: po.id, movementType: "PURCHASE_IN" },
  });

  const result = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: po.branchId,
    module: "purchase-orders",
    action: "PURCHASE_ORDER_CANCELLED",
    entityType: "PurchaseOrder",
    entityId: po.id,
    metadataJson: {
      orderNumber: po.orderNumber,
      branchId: po.branchId,
      branchCode: po.branch.code,
      supplier: po.supplier,
      total: po.total.toString(),
      linesCount: po.lines.length,
      cancelledByUserId: userId,
      previousStatus: po.status,
      newStatus: "CANCELLED",
      receivedMovements,
      warning: receivedMovements > 0 ? "Pedido con recepciones parciales; se cancela solo el pendiente." : null,
    },
  });

  return result;
}
