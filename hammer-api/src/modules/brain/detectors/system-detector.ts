import { CashSessionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { riskScoreFor } from "@/modules/brain/scoring";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";
import { FUSION_PRESETS, matchFusionPreset } from "@/modules/inventory/unit-conversion";
import { getProductionRecommendationsForBranch } from "@/modules/production/production-recommendation-service";

function normalizeForRole(value: string) {
  return value.toUpperCase().replace(/\s+/g, " ").trim();
}

export async function detectSystemDecisions(ctx: BrainDetectorContext): Promise<BrainDecisionDraft[]> {
  const decisions: BrainDecisionDraft[] = [];

  const branches = await prisma.branch.findMany({
    where: { isActive: true, ...(ctx.branchId ? { id: ctx.branchId } : {}) },
    include: {
      physicalCashBoxes: { select: { id: true, code: true, isActive: true } },
      moduleConfig: true,
      printSettings: true,
    },
    take: 200,
  });

  for (const branch of branches) {
    if (branch.physicalCashBoxes.filter((box) => box.isActive).length === 0) {
      decisions.push({
        category: "SYSTEM",
        severity: "HIGH",
        title: `Sucursal sin caja fisica activa: ${branch.code}`,
        description: `${branch.name} no tiene cajas fisicas activas para cobro.`,
        recommendation: "Crear o reactivar una caja fisica antes de operar POS/caja.",
        branchId: branch.id,
        confidenceScore: 96,
        riskScore: riskScoreFor("HIGH", 96),
        proposedActionType: "REVIEW_BRANCH_SETUP",
        evidenceJson: { physicalCashBoxes: branch.physicalCashBoxes },
        sourceJson: { detector: "system-detector" },
        fingerprintParts: ["system", "branch-no-active-cash-box", branch.id],
      });
    }

    if (!branch.moduleConfig) {
      decisions.push({
        category: "SYSTEM",
        severity: "MEDIUM",
        title: `Sucursal sin configuracion de modulos: ${branch.code}`,
        description: `${branch.name} no tiene BranchModuleConfig.`,
        recommendation: "Revisar configuracion de modulos para evitar flujos incompletos.",
        branchId: branch.id,
        confidenceScore: 94,
        riskScore: riskScoreFor("MEDIUM", 94),
        proposedActionType: "REVIEW_SYSTEM_CONFIGURATION",
        evidenceJson: { branchId: branch.id },
        sourceJson: { detector: "system-detector" },
        fingerprintParts: ["system", "branch-no-module-config", branch.id],
      });
    }

    if (!branch.printSettings) {
      decisions.push({
        category: "SYSTEM",
        severity: "LOW",
        title: `Sucursal sin configuracion de impresion: ${branch.code}`,
        description: `${branch.name} no tiene PrintSettings.`,
        recommendation: "Configurar impresion para tickets, recibos y documentos operativos.",
        branchId: branch.id,
        confidenceScore: 92,
        riskScore: riskScoreFor("LOW", 92),
        proposedActionType: "REVIEW_SYSTEM_CONFIGURATION",
        evidenceJson: { branchId: branch.id },
        sourceJson: { detector: "system-detector" },
        fingerprintParts: ["system", "branch-no-print-settings", branch.id],
      });
    }
  }

  for (const branch of branches.slice(0, 20)) {
    const production = await getProductionRecommendationsForBranch({ branchId: branch.id });
    for (const recommendation of production.recommendations.slice(0, 10)) {
      const severity = recommendation.priority === "URGENT"
        ? "HIGH"
        : recommendation.recommendationType === "NOT_ENOUGH_INPUTS" || recommendation.recommendationType === "REVIEW_RECIPE"
          ? "MEDIUM"
          : "LOW";
      const firstInput = recommendation.inputSummary[0];
      const proposedActionType = recommendation.recommendationType === "PRODUCE_FROM_EXCESS"
        ? "PRODUCTION_OPPORTUNITY_FROM_EXCESS"
        : recommendation.recommendationType === "NOT_ENOUGH_INPUTS"
          ? "PRODUCTION_RECIPE_BLOCKED_BY_INPUTS"
          : recommendation.recommendationType === "REVIEW_RECIPE"
            ? "PRODUCTION_RECIPE_NEEDS_REVIEW"
            : "EXCESS_INPUT_CAN_SUPPLY_SHORTAGE";

      decisions.push({
        category: "INVENTORY",
        severity,
        title: `Produccion sugerida: ${recommendation.targetSku}`,
        description: recommendation.message,
        recommendation: recommendation.recommendationType === "NOT_ENOUGH_INPUTS"
          ? "Comprar insumos o revisar politica de reorden antes de producir."
          : "Crear un lote borrador desde la recomendacion y confirmar produccion manualmente.",
        branchId: recommendation.branchId,
        productId: recommendation.targetProductId,
        confidenceScore: 90,
        riskScore: riskScoreFor(severity, 90),
        proposedActionType,
        proposedActionJson: {
          nextBestAction: recommendation.recommendedActions.includes("CREATE_PRODUCTION_BATCH")
            ? "CREATE_PRODUCTION_BATCH"
            : recommendation.recommendedActions[0],
          endpoint: "/api/master/production/recommendations/create-batch",
          payload: {
            branchId: recommendation.branchId,
            recipeId: recommendation.recipeId,
            suggestedBatches: recommendation.suggestedBatches,
            targetProductId: recommendation.targetProductId,
          },
        },
        evidenceJson: {
          targetProductId: recommendation.targetProductId,
          targetProductName: recommendation.targetProductName,
          targetStockOnHand: recommendation.targetStockOnHand,
          targetShortageQty: recommendation.targetShortageQty,
          recipeId: recommendation.recipeId,
          recipeName: recommendation.recipeName,
          recipeType: recommendation.recipeType,
          recipeFamily: recommendation.recipeFamily,
          suggestedBatches: recommendation.suggestedBatches,
          expectedOutputQty: recommendation.expectedOutputQty,
          estimatedUnitCost: recommendation.estimatedUnitCost,
          excessInputProductId: firstInput?.productId ?? null,
          excessInputName: firstInput?.productName ?? null,
          excessQty: firstInput?.excessQty ?? null,
          warnings: recommendation.warnings,
        },
        sourceJson: { detector: "system-detector", rule: "production-recommendation" },
        fingerprintParts: ["production", "recommendation", recommendation.branchId, recommendation.targetProductId, recommendation.recipeId],
      });
    }
  }

  const openInactiveBoxes = await prisma.cashSession.findMany({
    where: {
      status: CashSessionStatus.OPEN,
      physicalCashBox: { isActive: false, ...(ctx.branchId ? { branchId: ctx.branchId } : {}) },
    },
    include: { physicalCashBox: { include: { branch: true } } },
    take: 50,
  });

  for (const session of openInactiveBoxes) {
    decisions.push({
      category: "SYSTEM",
      severity: "CRITICAL",
      title: `Caja inactiva con sesion abierta: ${session.physicalCashBox.code}`,
      description: `${session.physicalCashBox.branch.code} tiene una sesion abierta sobre una caja fisica inactiva.`,
      recommendation: "Cerrar/revisar la sesion y corregir la configuracion de la caja.",
      branchId: session.physicalCashBox.branchId,
      confidenceScore: 98,
      riskScore: riskScoreFor("CRITICAL", 98),
      proposedActionType: "REVIEW_SYSTEM_CONFIGURATION",
      evidenceJson: { cashSessionId: session.id, physicalCashBoxId: session.physicalCashBoxId, openedAt: session.openedAt },
      sourceJson: { detector: "system-detector" },
      fingerprintParts: ["system", "inactive-cash-box-open-session", session.id],
    });
  }

  // Día Operativo 360: un día ACTIVE de fecha pasada ya no es una condición
  // de alarma — el resolver lo barre solo en la próxima operación de la
  // sucursal (o el cron periódico, en minutos). No genera decisión de Brain.

  const ironProducts = await prisma.product.findMany({
    where: { isActive: true, name: { contains: "HIERRO" } },
    select: {
      id: true,
      sku: true,
      name: true,
      inventoryBalances: {
        where: ctx.branchId ? { branchId: ctx.branchId } : undefined,
        select: { branchId: true, quantityOnHand: true },
      },
      orderLines: {
        where: {
          createdAt: { gte: ctx.since },
          ...(ctx.branchId ? { saleOrder: { branchId: ctx.branchId } } : {}),
        },
        select: { id: true, quantity: true },
        take: 20,
      },
      stockGroupMemberships: {
        where: { isActive: true, stockGroup: { isActive: true } },
        select: { stockGroupId: true },
      },
    },
    take: 200,
  });

  const ironGroups = new Map<string, typeof ironProducts>();
  for (const product of ironProducts) {
    const preset = matchFusionPreset(product.name);
    if (!preset || !preset.key.startsWith("hierro_")) continue;
    const rows = ironGroups.get(preset.key) ?? [];
    rows.push(product);
    ironGroups.set(preset.key, rows);
  }

  for (const [presetKey, products] of ironGroups.entries()) {
    const preset = FUSION_PRESETS.find((p) => p.key === presetKey);
    if (!preset) continue;
    // Rol dentro del preset: el nombre del producto contiene la unidad base
    // (VARILLA) o la unidad de empaque (QUINTAL) — sin parseo de variantes de
    // presentacion (9V/STD/SEMI/MM): esa complejidad ya no aplica, el usuario
    // agrupa manualmente en el asistente (Fase 2.1).
    const varilla = products.find((product) => normalizeForRole(product.name).includes(preset.baseUnit));
    const quintal = products.find((product) => normalizeForRole(product.name).includes(preset.packageUnit));
    if (!varilla || !quintal) continue;

    const varillaGroupIds = new Set(varilla.stockGroupMemberships.map((item) => item.stockGroupId));
    const sharedGroupAlreadyExists = quintal.stockGroupMemberships.some((item) => varillaGroupIds.has(item.stockGroupId));
    if (sharedGroupAlreadyExists) continue;

    const productsWithStock = products.filter((product) => product.inventoryBalances.some((balance) => Number(balance.quantityOnHand) > 0));
    const recentSalesCount = products.reduce((sum, product) => sum + product.orderLines.length, 0);
    const severity = productsWithStock.length >= 2 || recentSalesCount >= 2 ? "CRITICAL" : "HIGH";

    decisions.push({
      category: "INVENTORY",
      severity,
      title: `Hierro sin stock compartido: ${preset.label}`,
      description: `${varilla.name} y ${quintal.name} representan el mismo inventario fisico, pero no comparten una fusion de stock.`,
      recommendation: `Crear fusion con base ${preset.baseUnit} y factor 1 ${preset.packageUnit} = ${preset.factor} ${preset.baseUnit} desde el asistente de Fusion de Inventario.`,
      branchId: ctx.branchId ?? null,
      productId: varilla.id,
      confidenceScore: 96,
      riskScore: riskScoreFor(severity, 96),
      proposedActionType: "IRON_UNIT_CONVERSION_REQUIRED",
      proposedActionJson: {
        uiPath: "/app/master/inventory-fusion",
        suggestedPresetKey: preset.key,
        suggestedMembers: [varilla.id, quintal.id],
      },
      evidenceJson: {
        presetKey: preset.key,
        baseUnit: preset.baseUnit,
        factor: preset.factor,
        products: products.map((product) => ({
          id: product.id,
          sku: product.sku,
          name: product.name,
          role: normalizeForRole(product.name).includes(preset.baseUnit) ? preset.baseUnit : preset.packageUnit,
          stockGroupIds: product.stockGroupMemberships.map((item) => item.stockGroupId),
          stockOnHand: product.inventoryBalances.map((balance) => ({
            branchId: balance.branchId,
            quantityOnHand: balance.quantityOnHand.toString(),
          })),
          recentSalesLines: product.orderLines.length,
        })),
      },
      sourceJson: { detector: "system-detector", rule: "iron-unit-conversion" },
      fingerprintParts: ["system", "iron-unit-conversion-required", ctx.branchId ?? "all", presetKey],
    });
  }

  const recipesMissingInputs = await prisma.productionRecipe.findMany({
    where: { isActive: true, inputs: { none: {} } },
    select: { id: true, code: true, name: true, finishedProductId: true },
    take: 50,
  });

  for (const recipe of recipesMissingInputs) {
    decisions.push({
      category: "INVENTORY",
      severity: "HIGH",
      title: `Receta sin insumos: ${recipe.code}`,
      description: `${recipe.name} esta activa, pero no tiene insumos configurados.`,
      recommendation: "Agregar insumos reales del catalogo o desactivar la receta.",
      productId: recipe.finishedProductId,
      confidenceScore: 98,
      riskScore: riskScoreFor("HIGH", 98),
      proposedActionType: "PRODUCTION_RECIPE_MISSING_COST",
      evidenceJson: { recipeId: recipe.id, code: recipe.code },
      sourceJson: { detector: "system-detector", rule: "production-recipe-missing-inputs" },
      fingerprintParts: ["production", "recipe-missing-inputs", recipe.id],
    });
  }

  const stuckSince = new Date(ctx.now.getTime() - 1000 * 60 * 60 * 24 * 3);
  const stuckBatches = await prisma.productionBatch.findMany({
    where: {
      status: "IN_PROGRESS",
      startedAt: { lt: stuckSince },
      ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
    },
    include: {
      recipe: { select: { name: true, code: true } },
      branch: { select: { code: true, name: true } },
    },
    take: 50,
  });

  for (const batch of stuckBatches) {
    decisions.push({
      category: "INVENTORY",
      severity: "MEDIUM",
      title: `Lote en proceso por revisar: ${batch.batchNumber}`,
      description: `${batch.recipe.name} lleva mas de 3 dias en proceso en ${batch.branch.code}.`,
      recommendation: "Confirmar avance, completar lote o cancelar si no se va a producir.",
      branchId: batch.branchId,
      confidenceScore: 92,
      riskScore: riskScoreFor("MEDIUM", 92),
      proposedActionType: "PRODUCTION_BATCH_STUCK",
      evidenceJson: { batchId: batch.id, batchNumber: batch.batchNumber, startedAt: batch.startedAt },
      sourceJson: { detector: "system-detector", rule: "production-batch-stuck" },
      fingerprintParts: ["production", "batch-stuck", batch.id],
    });
  }

  const belowCostBatches = await prisma.productionBatch.findMany({
    where: {
      status: "COMPLETED",
      unitCost: { gt: 0 },
      ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
    },
    include: {
      recipe: {
        include: {
          finishedProduct: {
            select: {
              id: true,
              sku: true,
              name: true,
              branchProductSettings: {
                select: { branchId: true, branchPrice: true },
              },
            },
          },
        },
      },
    },
    orderBy: { completedAt: "desc" },
    take: 100,
  });

  for (const batch of belowCostBatches) {
    const setting = batch.recipe.finishedProduct.branchProductSettings.find((item) => item.branchId === batch.branchId);
    // No fallback a standardSalePrice: sin precio de sucursal no se puede juzgar
    // "bajo costo" contra un valor de venta real.
    const effectivePrice = Number(setting?.branchPrice ?? 0);
    const unitCost = Number(batch.unitCost ?? 0);
    if (effectivePrice <= 0 || effectivePrice >= unitCost) continue;
    decisions.push({
      category: "INVENTORY",
      severity: "HIGH",
      title: `Producto terminado bajo costo: ${batch.recipe.finishedProduct.sku}`,
      description: `${batch.recipe.finishedProduct.name} tiene precio C$ ${effectivePrice.toFixed(2)} contra costo producido C$ ${unitCost.toFixed(2)}.`,
      recommendation: "Revisar precio con calculadora antes de vender el inventario producido.",
      branchId: batch.branchId,
      productId: batch.recipe.finishedProductId,
      confidenceScore: 94,
      riskScore: riskScoreFor("HIGH", 94),
      proposedActionType: "PRODUCTION_OUTPUT_PRICE_BELOW_COST",
      evidenceJson: { batchId: batch.id, batchNumber: batch.batchNumber, effectivePrice, unitCost },
      sourceJson: { detector: "system-detector", rule: "production-output-price-below-cost" },
      fingerprintParts: ["production", "output-price-below-cost", batch.branchId, batch.recipe.finishedProductId],
    });
  }

  return decisions;
}
