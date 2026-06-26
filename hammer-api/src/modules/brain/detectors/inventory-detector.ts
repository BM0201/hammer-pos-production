import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { riskScoreFor, severityForInventoryGap } from "@/modules/brain/scoring";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";
import { parseWoodDimensions } from "@/modules/catalog/sku-generator";

function n(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

export async function detectInventoryDecisions(ctx: BrainDetectorContext): Promise<BrainDecisionDraft[]> {
  const decisions: BrainDecisionDraft[] = [];

  const [balances, products, recentLines, recentOpeningMovements] = await Promise.all([
    // H: filter inactive products so negative/zero-stock alerts are only for active items
    prisma.inventoryBalance.findMany({
      where: {
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
        product: { is: { isActive: true } },
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            standardSalePrice: true,
            isActive: true,
            branchProductSettings: { select: { branchId: true, branchCost: true } },
          },
        },
      },
      take: 500,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.product.findMany({
      where: { isActive: true, ...(ctx.branchId ? { inventoryBalances: { some: { branchId: ctx.branchId } } } : {}) },
      select: { id: true, sku: true, name: true, standardSalePrice: true, category: { select: { id: true, code: true, name: true } } },
      take: 500,
      orderBy: { name: "asc" },
    }),
    prisma.saleOrderLine.findMany({
      where: {
        saleOrder: {
          // J: use dateTo so DEEP_SCAN only counts sales within the specified range
          createdAt: { gte: ctx.since, lte: ctx.dateTo },
          ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
        },
      },
      select: { productId: true, quantity: true, saleOrder: { select: { branchId: true } } },
      take: 2000,
    }),
    prisma.inventoryMovement.findMany({
      where: {
        referenceType: "OPENING_BALANCE",
        createdAt: { gte: ctx.since },
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
      },
      select: { branchId: true, productId: true, unitCost: true, createdAt: true },
      take: 500,
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
  const recentOpeningWithoutCost = new Set(
    recentOpeningMovements
      .filter((movement) => n(movement.unitCost) <= 0)
      .map((movement) => `${movement.branchId}:${movement.productId}`),
  );

  for (const balance of balances) {
    const qty = n(balance.quantityOnHand);
    const wac = n(balance.weightedAverageCost);
    const sold = salesByBranchProduct.get(`${balance.branchId}:${balance.productId}`) ?? 0;
    const label = `${balance.product.sku} - ${balance.product.name}`;
    const branchLabel = `${balance.branch.code} - ${balance.branch.name}`;
    const branchCost = balance.product.branchProductSettings.find((setting) => setting.branchId === balance.branchId)?.branchCost ?? null;
    const hasEffectiveCost = wac > 0 || n(branchCost) > 0;

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

    if (!hasEffectiveCost && qty > 0) {
      decisions.push({
        category: "INVENTORY",
        severity: "MEDIUM",
        title: `Stock con costo efectivo faltante: ${label}`,
        description: `${branchLabel} tiene ${qty} unidades sin WAC ni costo de sucursal.`,
        recommendation: "Establecer costo de sucursal, cargar WAC inicial o calcular precio antes de vender.",
        branchId: balance.branchId,
        productId: balance.productId,
        confidenceScore: 0.9,
        riskScore: riskScoreFor("MEDIUM", 0.9),
        proposedActionType: "REVIEW_PRODUCT_COST",
        evidenceJson: { quantityOnHand: qty, weightedAverageCost: wac, branchCost: branchCost?.toString() ?? null },
        sourceJson: { detector: "inventory-detector" },
        fingerprintParts: ["inventory", "stock-exists-without-effective-cost", balance.branchId, balance.productId],
      });
    }

    if (recentOpeningWithoutCost.has(`${balance.branchId}:${balance.productId}`) && !hasEffectiveCost && qty > 0) {
      decisions.push({
        category: "INVENTORY",
        severity: "HIGH",
        title: `Carga inicial sin costo: ${label}`,
        description: `${branchLabel} recibio carga inicial reciente sin costo efectivo.`,
        recommendation: "Definir costo inicial o costo de sucursal y revisar precio/margen antes de vender.",
        branchId: balance.branchId,
        productId: balance.productId,
        confidenceScore: 0.92,
        riskScore: riskScoreFor("HIGH", 0.92),
        proposedActionType: "INITIAL_STOCK_WITHOUT_COST",
        evidenceJson: { quantityOnHand: qty, weightedAverageCost: wac, branchCost: branchCost?.toString() ?? null },
        sourceJson: { detector: "inventory-detector", rule: "opening-balance-without-cost" },
        fingerprintParts: ["inventory", "initial-stock-without-cost", balance.branchId, balance.productId],
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
    const categoryCode = product.category?.code?.toUpperCase() ?? "";
    const categoryName = product.category?.name?.toUpperCase() ?? "";
    const isWoodCategory = categoryCode.startsWith("MAD") || categoryName.includes("MADERA");
    const woodDimensions = parseWoodDimensions(product.name);
    const looksLikeWood = woodDimensions.subtype !== "OTRO" || (
      woodDimensions.thicknessInches !== undefined &&
      woodDimensions.widthInches !== undefined &&
      woodDimensions.lengthFeet !== undefined
    );

    if (isWoodCategory && !product.sku.toUpperCase().startsWith("MAD-")) {
      decisions.push({
        category: "INVENTORY",
        severity: "MEDIUM",
        title: `SKU de madera no coincide: ${product.sku}`,
        description: `${product.name} pertenece a Madera, pero su SKU no usa prefijo MAD.`,
        recommendation: "Revisar categoria y aplicar SKU sugerido desde Catalogo/Inventario si corresponde.",
        productId: product.id,
        confidenceScore: 0.82,
        riskScore: riskScoreFor("MEDIUM", 0.82),
        proposedActionType: "WOOD_CATEGORY_SKU_MISMATCH",
        evidenceJson: { sku: product.sku, category: product.category, detectedWood: woodDimensions },
        sourceJson: { detector: "inventory-detector", rule: "wood-category-sku-mismatch" },
        fingerprintParts: ["inventory", "wood-sku-mismatch", product.id],
      });
    }

    if (!isWoodCategory && looksLikeWood) {
      decisions.push({
        category: "INVENTORY",
        severity: "LOW",
        title: `Producto parece madera fuera de categoria: ${product.sku}`,
        description: `${product.name} tiene nombre/dimensiones de madera, pero no esta en categoria Madera.`,
        recommendation: "Validar categoria para que aparezca en el modulo de Madera y reciba reglas de SKU/precio correctas.",
        productId: product.id,
        confidenceScore: 0.72,
        riskScore: riskScoreFor("LOW", 0.72),
        proposedActionType: "WOOD_CATEGORY_SKU_MISMATCH",
        evidenceJson: { sku: product.sku, category: product.category, detectedWood: woodDimensions },
        sourceJson: { detector: "inventory-detector", rule: "wood-name-outside-category" },
        fingerprintParts: ["inventory", "wood-name-outside-category", product.id],
      });
    }

    if (n(product.standardSalePrice) <= 0) {
      decisions.push({
        category: "INVENTORY",
        severity: isWoodCategory ? "HIGH" : "HIGH",
        title: `${isWoodCategory ? "Madera" : "Producto"} sin precio: ${product.sku} - ${product.name}`,
        description: "Producto activo sin precio base de venta.",
        recommendation: "Definir precio antes de venderlo en POS para evitar ventas sin margen.",
        productId: product.id,
        confidenceScore: 0.96,
        riskScore: riskScoreFor("HIGH", 0.96),
        proposedActionType: isWoodCategory ? "WOOD_PRODUCT_WITHOUT_PRICE" : "REVIEW_PRODUCT_PRICE",
        evidenceJson: { sku: product.sku, standardSalePrice: n(product.standardSalePrice) },
        sourceJson: { detector: "inventory-detector" },
        fingerprintParts: ["inventory", isWoodCategory ? "wood-missing-price" : "missing-price", product.id],
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

  const woodDimensionGroups = new Map<string, typeof products>();
  for (const product of products) {
    const parsed = parseWoodDimensions(product.name);
    if (
      parsed.thicknessInches === undefined ||
      parsed.widthInches === undefined ||
      parsed.lengthFeet === undefined
    ) continue;
    const key = `${parsed.subtype ?? "OTRO"}:${parsed.thicknessInches}x${parsed.widthInches}x${parsed.lengthFeet}`;
    if (!woodDimensionGroups.has(key)) woodDimensionGroups.set(key, []);
    woodDimensionGroups.get(key)!.push(product);
  }

  for (const [dimensionKey, group] of woodDimensionGroups) {
    if (group.length < 2) continue;
    decisions.push({
      category: "INVENTORY",
      severity: "LOW",
      title: `Posible duplicado de madera: ${dimensionKey}`,
      description: `${group.length} productos comparten subtipo y dimensiones similares.`,
      recommendation: "Revisar si son productos distintos o consolidar para evitar duplicados en catalogo/inventario.",
      confidenceScore: 0.68,
      riskScore: riskScoreFor("LOW", 0.68),
      proposedActionType: "WOOD_DIMENSION_DUPLICATE_SUSPECT",
      evidenceJson: { dimensionKey, products: group.map((product) => ({ id: product.id, sku: product.sku, name: product.name })) },
      sourceJson: { detector: "inventory-detector", rule: "wood-dimension-duplicate" },
      fingerprintParts: ["inventory", "wood-dimension-duplicate", dimensionKey],
    });
  }

  return decisions;
}
