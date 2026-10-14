import { Prisma, PrismaClient, MultiBranchIntakeKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getProductStockConversionsBatch, calculateSharedStockChange } from "@/modules/inventory/unit-conversion";
import { getEffectiveProductPricingBatch } from "@/modules/catalog/effective-pricing";
import { recalculateWeightedAverage, WacValidationError } from "@/modules/inventory/wac";
import { normalizeIntakeKind, stockModeForKind, type NormalizedIntakeKind } from "@/modules/inventory/multi-branch-intake-service";
import { validateIntakeLine, type IntakeValidationMessage, type IntakeLineStatus } from "@/modules/inventory/intake-validation";

/**
 * Fase 1 (prompt-entrada-inventario.md) — "vista previa real": el mismo
 * motor que el movimiento real (calculateSharedStockChange,
 * recalculateWeightedAverage — createOpeningBalanceTx/createInventoryMovementTx
 * usan exactamente estas dos funciones puras), pero SIN escribir nada, y
 * TODO en consultas por lote (nunca una por línea×sucursal).
 */

export type PreviewRequestLine = {
  productId: string;
  /** null = el campo todavía está vacío (no escribir como 0). */
  quantity: number | null;
  overrides?: Record<string, number | null>;
  unitCost?: number | null;
  salePrice?: number | null;
  unit?: string;
};

export type PreviewRequest = {
  kind: MultiBranchIntakeKind;
  branchIds: string[];
  lines: PreviewRequestLine[];
};

export type PreviewCell = {
  productId: string;
  branchId: string;
  currentQty: number;
  finalQty: number;
  delta: number;
  currentWac: number | null;
  newWac: number | null;
  lastPurchaseCost: number | null;
  lastPurchaseDate: string | null;
  status: IntakeLineStatus;
  messages: IntakeValidationMessage[];
};

export type PreviewBranchTotals = { units: number; value: number | null; wacChanges: number };

export type PreviewResult = {
  cells: PreviewCell[];
  totals: Record<string, PreviewBranchTotals>;
};

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function quantityForBranch(line: PreviewRequestLine, branchId: string): number | null {
  if (line.overrides && branchId in line.overrides) return line.overrides[branchId];
  return line.quantity;
}

export async function previewIntake(input: PreviewRequest, db: PrismaClient = prisma): Promise<PreviewResult> {
  const kind = normalizeIntakeKind(input.kind);
  const stockMode = stockModeForKind(kind);
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const branchIds = input.branchIds;
  const pairs = productIds.flatMap((productId) => branchIds.map((branchId) => ({ branchId, productId })));

  const [
    conversionByProductId,
    pricingByKey,
    products,
    pendingPOs,
    purchaseQuantityHistory,
  ] = await Promise.all([
    getProductStockConversionsBatch(db, productIds),
    getEffectiveProductPricingBatch(db, pairs),
    // lastPurchaseCost/costUpdatedAt ya son GLOBALES (por producto, no por
    // sucursal) en todo el resto del sistema — purchase-orders/service.ts los
    // actualiza así en cada recepción; no hay "última compra por sucursal"
    // en ningún otro lado, así que inventar uno acá sería divergir sin razón.
    db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, isActive: true, lastPurchaseCost: true, costUpdatedAt: true } }),
    db.purchaseOrder.findMany({
      where: { branchId: { in: branchIds }, status: "APPROVED", lines: { some: { productId: { in: productIds } } } },
      select: { id: true, orderNumber: true, branchId: true, lines: { where: { productId: { in: productIds } }, select: { productId: true } } },
    }),
    // Única pieza sin equivalente ya existente: "compra típica" (mediana de
    // cantidad), por sucursal — la demanda normal de una sucursal no tiene
    // por qué parecerse a la de otra.
    db.purchaseOrderLine.findMany({
      where: { productId: { in: productIds }, purchaseOrder: { branchId: { in: branchIds } } },
      select: { productId: true, quantity: true, purchaseOrder: { select: { branchId: true } } },
    }),
  ]);

  const canonicalProductIds = [...new Set(productIds.map((id) => conversionByProductId.get(id)?.canonicalProductId ?? id))];
  const balances = await db.inventoryBalance.findMany({
    where: { productId: { in: canonicalProductIds }, branchId: { in: branchIds } },
    select: { branchId: true, productId: true, quantityOnHand: true, weightedAverageCost: true },
  });
  const balanceByKey = new Map(balances.map((b) => [`${b.branchId}:${b.productId}`, b]));
  const productById = new Map(products.map((p) => [p.id, p]));

  // OC pendiente: una por (branchId, productId) — la primera que aparezca alcanza para avisar.
  const pendingPoByKey = new Map<string, { poId: string; orderNumber: string }>();
  for (const po of pendingPOs) {
    for (const line of po.lines) {
      const key = `${po.branchId}:${line.productId}`;
      if (!pendingPoByKey.has(key)) pendingPoByKey.set(key, { poId: po.id, orderNumber: po.orderNumber });
    }
  }

  // "Compra típica" (mediana de cantidad), por (branchId, productId).
  const quantitiesByKey = new Map<string, number[]>();
  for (const line of purchaseQuantityHistory) {
    const key = `${line.purchaseOrder.branchId}:${line.productId}`;
    if (!quantitiesByKey.has(key)) quantitiesByKey.set(key, []);
    quantitiesByKey.get(key)!.push(Number(line.quantity));
  }
  const typicalQuantityByKey = new Map<string, number | null>();
  for (const [key, qtys] of quantitiesByKey) typicalQuantityByKey.set(key, median([...qtys].sort((a, b) => a - b)));

  const cells: PreviewCell[] = [];
  const totals: Record<string, PreviewBranchTotals> = Object.fromEntries(branchIds.map((id) => [id, { units: 0, value: 0, wacChanges: 0 }]));
  const anyCostMissingByBranch: Record<string, boolean> = Object.fromEntries(branchIds.map((id) => [id, false]));

  for (const line of input.lines) {
    const conversion = conversionByProductId.get(line.productId);
    const canonicalProductId = conversion?.canonicalProductId ?? line.productId;
    const isBaseUnit = !!conversion && (line.unit ?? conversion.saleUnit).toUpperCase() === conversion.baseUnit.toUpperCase();
    const factor = conversion?.conversionFactor ?? new Prisma.Decimal(1);

    for (const branchId of branchIds) {
      const key = `${branchId}:${line.productId}`;
      const resolvedQty = quantityForBranch(line, branchId);
      const balance = balanceByKey.get(`${branchId}:${canonicalProductId}`);
      const currentBaseQty = balance?.quantityOnHand ?? new Prisma.Decimal(0);
      const currentBaseWac = balance?.weightedAverageCost ?? new Prisma.Decimal(0);

      let finalQty = Number(currentBaseQty);
      let delta = 0;
      let newWacBase: Prisma.Decimal | null = null;
      if (resolvedQty !== null) {
        const stockChange = calculateSharedStockChange({ currentBaseQuantity: currentBaseQty, enteredQuantity: resolvedQty, conversionFactor: factor, isBaseUnit, mode: stockMode });
        finalQty = Number(stockChange.finalBaseQty);
        delta = Number(stockChange.deltaBaseQty);

        const hasCost = line.unitCost !== null && line.unitCost !== undefined && line.unitCost > 0;
        if (kind !== "PHYSICAL_COUNT" && hasCost && stockChange.deltaBaseQty.gt(0)) {
          try {
            // Mismo cómputo que createInventoryMovementTx (composición no EXPLICIT):
            // baseMovementQty = convertSaleQtyToBaseQty(qty, factor) — acá, directo desde
            // el delta ya en base (equivalente exacto, sin round-trip) — y
            // baseMovementUnitCost = convertSaleUnitCostToBaseUnitCost(costo, factor) = costo/factor.
            const baseUnitCost = conversion ? new Prisma.Decimal(line.unitCost!).div(factor) : new Prisma.Decimal(line.unitCost!);
            newWacBase = recalculateWeightedAverage({ currentQty: currentBaseQty, currentWac: currentBaseWac, movementQty: stockChange.deltaBaseQty.abs(), movementUnitCost: baseUnitCost, inbound: true }).newWac;
          } catch (error) {
            if (!(error instanceof WacValidationError)) throw error;
          }
        }
      }

      const effective = pricingByKey.get(key);
      const currentEffectiveCost = effective?.effectiveCost !== null && effective?.effectiveCost !== undefined ? Number(effective.effectiveCost) : null;
      const product = productById.get(line.productId);
      const lastPurchaseCost = product?.lastPurchaseCost !== null && product?.lastPurchaseCost !== undefined ? Number(product.lastPurchaseCost) : null;
      const lastPurchaseDate = lastPurchaseCost !== null ? (product?.costUpdatedAt?.toISOString() ?? null) : null;
      const pendingPO = pendingPoByKey.get(key) ?? null;
      const isActive = product?.isActive ?? false;
      const isDerivedMember = !!conversion && !conversion.isCanonical;

      const validation = validateIntakeLine({
        kind,
        quantity: resolvedQty,
        currentQty: Number(currentBaseQty),
        enteredCost: line.unitCost ?? null,
        currentEffectiveCost,
        lastPurchaseCost,
        newPrice: line.salePrice ?? null,
        productBlocked: !isActive ? { reason: "Producto inactivo." } : isDerivedMember ? { reason: "Producto unificado — entrá la carga por el producto principal." } : null,
        pendingPurchaseOrder: pendingPO,
        typicalPurchaseQuantity: typicalQuantityByKey.get(key) ?? null,
      });

      cells.push({
        productId: line.productId,
        branchId,
        currentQty: Number(currentBaseQty),
        finalQty,
        delta,
        currentWac: currentBaseWac.gt(0) ? Number(currentBaseWac) : null,
        newWac: newWacBase !== null ? Number(newWacBase) : null,
        lastPurchaseCost,
        lastPurchaseDate,
        status: validation.status,
        messages: validation.messages,
      });

      if (validation.status !== "ERROR" && resolvedQty !== null && delta !== 0) {
        totals[branchId].units += Math.abs(delta);
        const costForValue = line.unitCost ?? currentEffectiveCost;
        if (costForValue !== null && costForValue > 0) {
          totals[branchId].value = (totals[branchId].value ?? 0) + Math.abs(delta) * costForValue;
        } else {
          anyCostMissingByBranch[branchId] = true;
        }
        if (newWacBase !== null) totals[branchId].wacChanges += 1;
      }
    }
  }

  for (const branchId of branchIds) {
    if (anyCostMissingByBranch[branchId]) totals[branchId].value = null;
  }

  return { cells, totals };
}
