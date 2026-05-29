import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { riskScoreFor, severityForInventoryGap } from "@/modules/brain/scoring";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";

function n(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

export async function detectInventoryDecisions(ctx: BrainDetectorContext): Promise<BrainDecisionDraft[]> {
  const decisions: BrainDecisionDraft[] = [];

  const [balances, products, recentLines] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where: ctx.branchId ? { branchId: ctx.branchId } : {},
      include: {
        branch: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, sku: true, name: true, standardSalePrice: true, isActive: true } },
      },
      take: 500,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.product.findMany({
      where: { isActive: true, ...(ctx.branchId ? { inventoryBalances: { some: { branchId: ctx.branchId } } } : {}) },
      select: { id: true, sku: true, name: true, standardSalePrice: true },
      take: 500,
      orderBy: { name: "asc" },
    }),
    prisma.saleOrderLine.findMany({
      where: {
        saleOrder: {
          createdAt: { gte: ctx.since },
          ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
        },
      },
      select: { productId: true, quantity: true, saleOrder: { select: { branchId: true } } },
      take: 2000,
    }),
  ]);

  const salesByBranchProduct = new Map<string, number>();
  const salesByProduct = new Map<string, number>();
  for (const line of recentLines) {
    const qty = n(line.quantity);
    salesByProduct.set(line.productId, (salesByProduct.get(line.productId) ?? 0) + qty);
    const key = `${line.saleOrder.branchId}:${line.productId}`;
    salesByBranchProduct.set(key, (salesByBranchProduct.get(key) ?? 0) + qty);
  }

  const balanceProductIds = new Set(balances.map((b) => b.productId));

  for (const balance of balances) {
    const qty = n(balance.quantityOnHand);
    const wac = n(balance.weightedAverageCost);
    const sold = salesByBranchProduct.get(`${balance.branchId}:${balance.productId}`) ?? 0;
    const label = `${balance.product.sku} - ${balance.product.name}`;
    const branchLabel = `${balance.branch.code} - ${balance.branch.name}`;

    if (qty < 0) {
      decisions.push({
        category: "INVENTORY",
        severity: "CRITICAL",
        title: `Stock negativo: ${label}`,
        description: `${branchLabel} tiene ${qty} unidades en inventario para un producto activo.`,
        recommendation: "Revisar movimientos, ventas recientes y conteo fisico. Ajustar inventario solo despues de validar la causa.",
        branchId: balance.branchId,
        productId: balance.productId,
        confidenceScore: 0.95,
        riskScore: riskScoreFor("CRITICAL", 0.95),
        proposedActionType: "REVIEW_INVENTORY_MOVEMENTS",
        evidenceJson: { sku: balance.product.sku, branch: branchLabel, quantityOnHand: qty, weightedAverageCost: wac },
        sourceJson: { detector: "inventory-detector", balanceId: balance.id },
        fingerprintParts: ["inventory", "negative-stock", balance.branchId, balance.productId],
      });
    }

    if (qty === 0 && sold > 0) {
      decisions.push({
        category: "INVENTORY",
        severity: "HIGH",
        title: `Stock cero con ventas recientes: ${label}`,
        description: `${branchLabel} vendio ${sold} unidades en los ultimos ${ctx.days} dias, pero ahora esta en cero.`,
        recommendation: "Evaluar reposicion o transferencia desde otra sucursal antes de perder ventas.",
        branchId: balance.branchId,
        productId: balance.productId,
        confidenceScore: 0.86,
        impactAmount: sold * Math.max(n(balance.product.standardSalePrice), wac),
        riskScore: riskScoreFor("HIGH", 0.86),
        proposedActionType: "REVIEW_REORDER_OR_TRANSFER",
        evidenceJson: { branch: branchLabel, recentUnitsSold: sold, quantityOnHand: qty },
        sourceJson: { detector: "inventory-detector" },
        fingerprintParts: ["inventory", "zero-with-sales", balance.branchId, balance.productId],
      });
    }

    if (wac <= 0 && qty > 0) {
      decisions.push({
        category: "INVENTORY",
        severity: "MEDIUM",
        title: `Inventario sin costo: ${label}`,
        description: `${branchLabel} tiene ${qty} unidades con costo promedio cero.`,
        recommendation: "Actualizar costo mediante compra, ajuste controlado o correccion de importacion para recuperar margen real.",
        branchId: balance.branchId,
        productId: balance.productId,
        confidenceScore: 0.9,
        riskScore: riskScoreFor("MEDIUM", 0.9),
        proposedActionType: "REVIEW_PRODUCT_COST",
        evidenceJson: { quantityOnHand: qty, weightedAverageCost: wac },
        sourceJson: { detector: "inventory-detector" },
        fingerprintParts: ["inventory", "zero-cost", balance.branchId, balance.productId],
      });
    }

    if (qty >= 50 && sold <= 1) {
      decisions.push({
        category: "INVENTORY",
        severity: "LOW",
        title: `Inventario alto con baja rotacion: ${label}`,
        description: `${branchLabel} conserva ${qty} unidades y solo registra ${sold} vendidas en ${ctx.days} dias.`,
        recommendation: "Revisar precio, exhibicion o transferir excedente a sucursales con mas movimiento.",
        branchId: balance.branchId,
        productId: balance.productId,
        confidenceScore: 0.72,
        impactAmount: qty * wac,
        riskScore: riskScoreFor("LOW", 0.72),
        proposedActionType: "REVIEW_DISCOUNT_OR_TRANSFER",
        evidenceJson: { quantityOnHand: qty, recentUnitsSold: sold, inventoryValue: n(balance.inventoryValue) },
        sourceJson: { detector: "inventory-detector" },
        fingerprintParts: ["inventory", "high-stock-low-rotation", balance.branchId, balance.productId],
      });
    }

    if (qty > 0 && qty <= Math.max(3, sold / 7) && sold >= 10) {
      const severity = severityForInventoryGap(qty, sold / 7);
      decisions.push({
        category: "INVENTORY",
        severity,
        title: `Inventario bajo con alta rotacion: ${label}`,
        description: `${branchLabel} vendio ${sold} unidades en ${ctx.days} dias y solo quedan ${qty}.`,
        recommendation: "Priorizar reposicion o transferencia para sostener disponibilidad en POS.",
        branchId: balance.branchId,
        productId: balance.productId,
        confidenceScore: 0.82,
        impactAmount: sold * n(balance.product.standardSalePrice),
        riskScore: riskScoreFor(severity, 0.82),
        proposedActionType: "REVIEW_REORDER_OR_TRANSFER",
        evidenceJson: { quantityOnHand: qty, recentUnitsSold: sold },
        sourceJson: { detector: "inventory-detector" },
        fingerprintParts: ["inventory", "low-stock-high-rotation", balance.branchId, balance.productId],
      });
    }
  }

  for (const product of products) {
    if (n(product.standardSalePrice) <= 0) {
      decisions.push({
        category: "INVENTORY",
        severity: "HIGH",
        title: `Producto sin precio: ${product.sku} - ${product.name}`,
        description: "Producto activo sin precio base de venta.",
        recommendation: "Definir precio antes de venderlo en POS para evitar ventas sin margen.",
        productId: product.id,
        confidenceScore: 0.96,
        riskScore: riskScoreFor("HIGH", 0.96),
        proposedActionType: "REVIEW_PRODUCT_PRICE",
        evidenceJson: { sku: product.sku, standardSalePrice: n(product.standardSalePrice) },
        sourceJson: { detector: "inventory-detector" },
        fingerprintParts: ["inventory", "missing-price", product.id],
      });
    }

    if (!balanceProductIds.has(product.id) && (salesByProduct.get(product.id) ?? 0) === 0) {
      decisions.push({
        category: "INVENTORY",
        severity: "INFO",
        title: `SKU sin inventario registrado: ${product.sku}`,
        description: `${product.name} no tiene existencias registradas en ninguna sucursal.`,
        recommendation: "Confirmar si debe seguir disponible o cargar inventario inicial por sucursal.",
        productId: product.id,
        confidenceScore: 0.8,
        riskScore: riskScoreFor("INFO", 0.8),
        proposedActionType: "REVIEW_INITIAL_INVENTORY",
        evidenceJson: { sku: product.sku },
        sourceJson: { detector: "inventory-detector" },
        fingerprintParts: ["inventory", "no-balance", product.id],
      });
    }
  }

  return decisions;
}
