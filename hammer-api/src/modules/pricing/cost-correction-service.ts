import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { getProductStockConversion, getProductStockConversionsBatch, resolveInventoryProductForMovement } from "@/modules/inventory/unit-conversion";
import { resolveGlobalCostWriteTarget, updateProduct } from "@/modules/catalog/service";
import { detectPackageCostAsUnitCost, maxPackageFactorForSanityCheck } from "@/modules/inventory/wac";
import { assertPriceApplicable, applySuggestedPriceTx } from "@/modules/pricing/service";
import { assertPriceNotBelowCost } from "@/modules/pricing/price-guard";
import { applyAlsoBranchPriceTx } from "@/modules/pricing/tray-service";
import { resolvePolicyForProduct } from "@/modules/pricing/category-policy-service";
import { buildCommercialIntelligenceForProduct } from "@/modules/pricing/commercial-intelligence";
import { calculatePricingSuggestion } from "@/modules/pricing/calculator";

/**
 * Parte D (prompt-completo-pendientes-2026-10.md) — "corregir costo y
 * precio (manual o automático) antes de aplicar". El problema real: costo
 * = precio exacto casi siempre es un ERROR DE CARGA (se tecleó el precio
 * en el campo del costo, o al revés) — lo correcto no es subir el precio,
 * es corregir el costo EN SU ORIGEN. Hoy no hay forma de hacerlo; esto la
 * agrega, auditada, sin tocar el historial de ventas ni el kardex.
 */

export type CostSourceField = "BRANCH" | "GLOBAL" | "GLOBAL_AVERAGE" | "WAC_ESTIMATE" | "LAST_PURCHASE" | "NONE";
export type CostCorrectionAction = "SET_BRANCH_COST" | "CLEAR_BRANCH_COST" | "SET_GLOBAL_COST" | "SET_AVERAGE_COST";

export type CostSuspicion = { code: "COST_EQUALS_PRICE" | "COST_FAR_FROM_PURCHASE" | "COST_FAR_FROM_OTHER_BRANCHES" | "PACKAGE_AS_UNIT"; message: string };

const RESPONSIBLE_FIELD_LABELS: Record<CostSourceField, string> = {
  BRANCH: "Costo de sucursal",
  GLOBAL: "Costo global",
  GLOBAL_AVERAGE: "Costo promedio",
  WAC_ESTIMATE: "Costo promedio ponderado (WAC)",
  LAST_PURCHASE: "Última compra",
  NONE: "Sin costo",
};

/** Pura — qué acciones tienen sentido según quién manda el costo hoy (tabla D.1.2). */
export function allowedCorrectionsFor(costSource: CostSourceField): CostCorrectionAction[] {
  const actions: CostCorrectionAction[] = ["SET_BRANCH_COST"];
  if (costSource === "BRANCH") actions.push("CLEAR_BRANCH_COST");
  if (costSource === "GLOBAL" || costSource === "NONE") actions.push("SET_GLOBAL_COST");
  if (costSource === "GLOBAL_AVERAGE" || costSource === "WAC_ESTIMATE") actions.push("SET_AVERAGE_COST");
  return actions;
}

export function suspectCostEqualsPrice(cost: number | null, price: number | null): CostSuspicion | null {
  if (cost === null || price === null || cost <= 0 || price <= 0) return null;
  if (Math.abs(cost - price) > 0.005) return null;
  return { code: "COST_EQUALS_PRICE", message: "Probable error de carga: el costo es igual al precio." };
}

export function suspectCostFarFromPurchase(cost: number | null, lastPurchaseCost: number | null): CostSuspicion | null {
  if (cost === null || lastPurchaseCost === null || lastPurchaseCost <= 0) return null;
  const deviation = Math.abs(cost - lastPurchaseCost) / lastPurchaseCost;
  if (deviation <= 0.4) return null;
  return { code: "COST_FAR_FROM_PURCHASE", message: `El costo difiere ${(deviation * 100).toFixed(0)}% de la última compra recibida (C$${lastPurchaseCost.toFixed(2)}).` };
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function suspectCostFarFromOtherBranches(cost: number | null, otherBranchCosts: number[]): CostSuspicion | null {
  if (cost === null || otherBranchCosts.length === 0) return null;
  const med = median([...otherBranchCosts].sort((a, b) => a - b));
  if (med === null || med <= 0) return null;
  const deviation = Math.abs(cost - med) / med;
  if (deviation <= 0.4) return null;
  return { code: "COST_FAR_FROM_OTHER_BRANCHES", message: `El costo difiere ${(deviation * 100).toFixed(0)}% de la mediana en otras sucursales (C$${med.toFixed(2)}).` };
}

/** Reusa el mismo criterio que bloquea movimientos de inventario (wac.ts), en modo "solo avisar" — no lanza, devuelve la sospecha. */
export function suspectPackageAsUnit(cost: number | null, existingWac: number | null, packageFactor: number | null): CostSuspicion | null {
  if (cost === null || existingWac === null || packageFactor === null) return null;
  try {
    detectPackageCostAsUnitCost({ inbound: true, baseMovementUnitCost: new Prisma.Decimal(cost), existingWac: new Prisma.Decimal(existingWac), packageFactor: new Prisma.Decimal(packageFactor) });
    return null;
  } catch {
    return { code: "PACKAGE_AS_UNIT", message: "El costo parece ser el del paquete completo, no el de una unidad." };
  }
}

/**
 * D.1.4 — versión batch de las dos sospechas que hacen `costLooksWrong` en
 * el detector (pricing-detector.ts recorre hasta ~1500 pares branch×product;
 * una consulta por fila sería el mismo anti-patrón que ya se arregló ahí
 * mismo para pricing/policy/commercial-intelligence). Deliberadamente NO
 * incluye COST_FAR_FROM_PURCHASE ni COST_FAR_FROM_OTHER_BRANCHES — esas dos
 * son para el panel de corrección (describeCostSource), no para excluir del
 * total en riesgo de la Bandeja.
 */
export async function computeCostSuspicionsBatch(
  db: CostCorrectionDbClient,
  pairs: Array<{ branchId: string; productId: string; cost: number | null; price: number | null }>,
): Promise<Map<string, CostSuspicion[]>> {
  const result = new Map<string, CostSuspicion[]>();
  const productIds = [...new Set(pairs.map((p) => p.productId))];
  if (productIds.length === 0) return result;

  const conversionByProduct = await getProductStockConversionsBatch(db, productIds);
  const canonicalGroupIds = [...new Set(
    [...conversionByProduct.entries()].filter(([, c]) => c.isCanonical).map(([, c]) => c.stockGroupId),
  )];

  const [siblings, wacRows] = await Promise.all([
    canonicalGroupIds.length > 0
      ? db.productStockGroupMember.findMany({ where: { stockGroupId: { in: canonicalGroupIds }, isActive: true, isCanonical: false }, select: { stockGroupId: true, conversionFactor: true } })
      : Promise.resolve([] as Array<{ stockGroupId: string; conversionFactor: Prisma.Decimal }>),
    db.inventoryBalance.groupBy({ by: ["productId"], where: { productId: { in: productIds } }, _max: { weightedAverageCost: true } }),
  ]);

  const factorsByGroup = new Map<string, Prisma.Decimal[]>();
  for (const sib of siblings) {
    if (!factorsByGroup.has(sib.stockGroupId)) factorsByGroup.set(sib.stockGroupId, []);
    factorsByGroup.get(sib.stockGroupId)!.push(sib.conversionFactor);
  }
  const packageFactorByGroup = new Map<string, Prisma.Decimal | null>();
  for (const [groupId, factors] of factorsByGroup) packageFactorByGroup.set(groupId, maxPackageFactorForSanityCheck(factors));

  const maxWacByProduct = new Map(wacRows.map((r) => [r.productId, r._max.weightedAverageCost === null ? null : Number(r._max.weightedAverageCost)]));

  for (const pair of pairs) {
    const key = `${pair.branchId}:${pair.productId}`;
    const suspicions: CostSuspicion[] = [];
    const equalsPrice = suspectCostEqualsPrice(pair.cost, pair.price);
    if (equalsPrice) suspicions.push(equalsPrice);

    const conversion = conversionByProduct.get(pair.productId);
    if (conversion?.isCanonical) {
      const packageFactor = packageFactorByGroup.get(conversion.stockGroupId) ?? null;
      if (packageFactor) {
        const referenceWac = maxWacByProduct.get(pair.productId) ?? null;
        const packageSuspicion = suspectPackageAsUnit(pair.cost, referenceWac, Number(packageFactor));
        if (packageSuspicion) suspicions.push(packageSuspicion);
      }
    }
    if (suspicions.length > 0) result.set(key, suspicions);
  }

  return result;
}

export type CostSourceDescription = {
  effectiveCost: number | null;
  costSource: CostSourceField;
  responsibleFieldLabel: string;
  history: {
    lastPurchase: { cost: number; date: string; supplierName: string | null } | null;
    otherBranchCosts: Array<{ branchId: string; branchName: string; cost: number }>;
    averageCost: number | null;
    globalCost: number | null;
    recentSaleCostSnapshots: Array<{ saleDate: string; cost: number }>;
    branchCostOrigin: { action: string; occurredAt: string; actorName: string | null } | null;
  };
  suspicions: CostSuspicion[];
  allowedCorrections: CostCorrectionAction[];
};

type CostCorrectionDbClient = typeof prisma | Prisma.TransactionClient;

export async function describeCostSource(productId: string, branchId: string, db: CostCorrectionDbClient = prisma): Promise<CostSourceDescription> {
  const [effective, product, otherSettings, lastPurchaseLine, recentSales, branchCostLog] = await Promise.all([
    getEffectiveProductPricing(db, { branchId, productId }),
    db.product.findUniqueOrThrow({ where: { id: productId }, select: { standardSalePrice: true, averageCost: true, globalCost: true, lastPurchaseCost: true } }),
    db.branchProductSetting.findMany({ where: { productId, branchId: { not: branchId }, branchCost: { not: null } }, include: { branch: { select: { id: true, name: true } } } }),
    db.purchaseOrderLine.findFirst({
      where: { productId, newGlobalCost: { not: null } },
      orderBy: { purchaseOrder: { createdAt: "desc" } },
      select: { finalUnitCost: true, unitCost: true, supplierNameSnapshot: true, purchaseOrder: { select: { createdAt: true } } },
    }),
    db.saleOrderLine.findMany({
      where: { productId, costSnapshot: { not: null }, saleOrder: { branchId, status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] } } },
      orderBy: { saleOrder: { createdAt: "desc" } },
      take: 5,
      select: { costSnapshot: true, saleOrder: { select: { createdAt: true } } },
    }),
    db.auditLog.findFirst({
      where: { entityType: "Product", entityId: productId, branchId, action: { in: ["OPENING_BALANCE_CREATE", "INVENTORY_IMPORT_EXECUTED", "INVENTORY_IMPORT_BULK_CATALOG"] } },
      orderBy: { occurredAt: "desc" },
      include: { actor: { select: { fullName: true, username: true } } },
    }),
  ]);

  const effectiveCost = effective.effectiveCost === null ? null : Number(effective.effectiveCost);
  const effectivePrice = effective.effectivePrice === null ? null : Number(effective.effectivePrice);
  const costSource = effective.costSource as CostSourceField;

  const branchCostResponsibleDate = branchCostLog ? ` (${branchCostLog.action === "OPENING_BALANCE_CREATE" ? "saldo inicial" : "importación"} del ${branchCostLog.occurredAt.toISOString().slice(0, 10)})` : "";
  const responsibleFieldLabel = costSource === "BRANCH" ? `${RESPONSIBLE_FIELD_LABELS.BRANCH}${branchCostResponsibleDate}` : RESPONSIBLE_FIELD_LABELS[costSource];

  const otherBranchCosts = otherSettings.map((s) => ({ branchId: s.branchId, branchName: s.branch.name, cost: Number(s.branchCost) }));

  const suspicions: CostSuspicion[] = [];
  const equalsPriceSuspicion = suspectCostEqualsPrice(effectiveCost, effectivePrice);
  if (equalsPriceSuspicion) suspicions.push(equalsPriceSuspicion);
  const lastPurchaseCostNum = lastPurchaseLine ? Number(lastPurchaseLine.finalUnitCost || lastPurchaseLine.unitCost) : (product.lastPurchaseCost === null ? null : Number(product.lastPurchaseCost));
  const farFromPurchase = suspectCostFarFromPurchase(effectiveCost, lastPurchaseCostNum);
  if (farFromPurchase) suspicions.push(farFromPurchase);
  const farFromBranches = suspectCostFarFromOtherBranches(effectiveCost, otherBranchCosts.map((b) => b.cost));
  if (farFromBranches) suspicions.push(farFromBranches);

  // PACKAGE_AS_UNIT — solo tiene sentido para el canónico de un grupo con presentaciones de escala real (mismo umbral que updateProduct/wac.ts).
  const conversion = await getProductStockConversion(db, productId);
  if (conversion?.isCanonical) {
    const siblings = await db.productStockGroupMember.findMany({ where: { stockGroupId: conversion.stockGroupId, isActive: true, isCanonical: false }, select: { conversionFactor: true } });
    const packageFactor = maxPackageFactorForSanityCheck(siblings.map((s) => s.conversionFactor));
    if (packageFactor) {
      const wacAgg = await db.inventoryBalance.aggregate({ where: { productId }, _max: { weightedAverageCost: true } });
      const referenceWac = wacAgg._max.weightedAverageCost === null ? null : Number(wacAgg._max.weightedAverageCost);
      const packageSuspicion = suspectPackageAsUnit(effectiveCost, referenceWac, Number(packageFactor));
      if (packageSuspicion) suspicions.push(packageSuspicion);
    }
  }

  return {
    effectiveCost,
    costSource,
    responsibleFieldLabel,
    history: {
      lastPurchase: lastPurchaseLine ? { cost: lastPurchaseCostNum!, date: lastPurchaseLine.purchaseOrder.createdAt.toISOString(), supplierName: lastPurchaseLine.supplierNameSnapshot } : null,
      otherBranchCosts,
      averageCost: product.averageCost === null ? null : Number(product.averageCost),
      globalCost: product.globalCost === null ? null : Number(product.globalCost),
      recentSaleCostSnapshots: recentSales.map((s) => ({ saleDate: s.saleOrder.createdAt.toISOString(), cost: Number(s.costSnapshot) })),
      branchCostOrigin: branchCostLog ? { action: branchCostLog.action, occurredAt: branchCostLog.occurredAt.toISOString(), actorName: branchCostLog.actor?.fullName ?? branchCostLog.actor?.username ?? null } : null,
    },
    suspicions,
    allowedCorrections: allowedCorrectionsFor(costSource),
  };
}

export type CorrectCostInput = {
  productId: string;
  branchId: string;
  action: CostCorrectionAction;
  newCost?: number;
  reason: string;
  actorUserId: string;
  allowHighUnitCost?: boolean;
};

export type CorrectCostResult = { effectiveCost: number | null; costSource: CostSourceField; previousValue: number | null; newValue: number | null };

/**
 * D.1.2 — corrige el campo RESPONSABLE, en su origen. "No reescribe
 * movimientos pasados ni ventas pasadas, solo el valor vigente hacia
 * adelante" — ninguna rama toca SaleOrderLine/InventoryMovement/kardex.
 *
 * SET_GLOBAL_COST es la única acción que NO participa de `tx`: delega en
 * updateProduct() (su propia transacción, con todas sus guardas de fusión/
 * paquete/precio-bajo-costo ya probadas) — abrir una transacción anidada
 * ahí arriesgaría más de lo que gana. Las demás acciones sí usan `tx`.
 */
export async function correctProductCostTx(tx: Prisma.TransactionClient, input: CorrectCostInput): Promise<CorrectCostResult> {
  if (input.reason.trim().length < 10) throw new Error("VALIDATION_ERROR: El motivo debe tener al menos 10 caracteres.");
  if (input.action !== "CLEAR_BRANCH_COST" && (input.newCost === undefined || input.newCost <= 0)) {
    throw new Error("VALIDATION_ERROR: El costo debe ser mayor a 0. 'No sé el costo' es Quitar costo de sucursal, no cero.");
  }

  const before = await describeCostSource(input.productId, input.branchId, tx);
  if (!before.allowedCorrections.includes(input.action)) {
    throw new Error(`VALIDATION_ERROR: ${input.action} no está disponible — el costo responsable hoy es ${before.responsibleFieldLabel}.`);
  }

  let newValue: number | null = null;

  if (input.action === "SET_BRANCH_COST") {
    const conversion = await getProductStockConversion(tx, input.productId);
    const target = resolveGlobalCostWriteTarget({ requestedProductId: input.productId, enteredCost: input.newCost!, conversion });
    newValue = target.costForTarget;
    await tx.$queryRaw`SELECT id FROM "BranchProductSetting" WHERE "branchId" = ${input.branchId} AND "productId" = ${target.targetProductId} FOR UPDATE`;
    await tx.branchProductSetting.upsert({
      where: { branchId_productId: { branchId: input.branchId, productId: target.targetProductId } },
      create: { branchId: input.branchId, productId: target.targetProductId, branchCost: new Prisma.Decimal(newValue) },
      update: { branchCost: new Prisma.Decimal(newValue) },
    });
  } else if (input.action === "CLEAR_BRANCH_COST") {
    const conversion = await getProductStockConversion(tx, input.productId);
    const targetProductId = conversion && !conversion.isCanonical ? conversion.canonicalProductId : input.productId;
    await tx.$queryRaw`SELECT id FROM "BranchProductSetting" WHERE "branchId" = ${input.branchId} AND "productId" = ${targetProductId} FOR UPDATE`;
    await tx.branchProductSetting.update({ where: { branchId_productId: { branchId: input.branchId, productId: targetProductId } }, data: { branchCost: null } });
  } else if (input.action === "SET_AVERAGE_COST") {
    if (before.costSource === "WAC_ESTIMATE") {
      const resolution = await resolveInventoryProductForMovement(tx, input.productId);
      await tx.$queryRaw`SELECT id FROM "InventoryBalance" WHERE "branchId" = ${input.branchId} AND "productId" = ${resolution.inventoryProductId} FOR UPDATE`;
      const balance = await tx.inventoryBalance.findUnique({ where: { branchId_productId: { branchId: input.branchId, productId: resolution.inventoryProductId } } });
      if (!balance) throw new Error("INVENTORY_BALANCE_NOT_FOUND");
      newValue = input.newCost!;
      await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: { weightedAverageCost: new Prisma.Decimal(newValue), inventoryValue: balance.quantityOnHand.mul(newValue) },
      });
    } else {
      // GLOBAL_AVERAGE — Product.averageCost, SIN tocar globalCost (corrección más angosta que SET_GLOBAL_COST).
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} FOR UPDATE`;
      newValue = input.newCost!;
      await tx.product.update({ where: { id: input.productId }, data: { averageCost: new Prisma.Decimal(newValue), costUpdatedAt: new Date(), costUpdatedByUserId: input.actorUserId } });
    }
  } else if (input.action === "SET_GLOBAL_COST") {
    newValue = input.newCost!;
    await updateProduct(input.productId, { globalCost: newValue, allowHighUnitCost: input.allowHighUnitCost, actorUserId: input.actorUserId });
  }

  const effective = await getEffectiveProductPricing(tx, { branchId: input.branchId, productId: input.productId });
  const effectiveCost = effective.effectiveCost === null ? null : Number(effective.effectiveCost);

  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "pricing",
      action: "PRODUCT_COST_CORRECTED",
      entityType: "Product",
      entityId: input.productId,
      metadataJson: {
        action: input.action,
        previousValue: before.effectiveCost,
        newValue,
        previousCostSource: before.costSource,
        reason: input.reason,
        suspicionsAtTimeOfCorrection: before.suspicions.map((s) => s.code),
        origin: "bandeja_precios",
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return { effectiveCost, costSource: effective.costSource as CostSourceField, previousValue: before.effectiveCost, newValue };
}

export type CorrectAndApplyItemInput = {
  decisionId: string;
  mode: "AUTO" | "MANUAL";
  /** MANUAL (o AUTO, si la decisión también trae un costo que corregir). */
  cost?: { action: CostCorrectionAction; value?: number };
  /** Si viene, se aplica tal cual (camino manual). */
  price?: number;
  /** Corregir solo el costo y dejar el precio como está. */
  keepPrice?: boolean;
  allowHighUnitCost?: boolean;
  /** "Aplicar el mismo precio en otras sucursales" — mismo mecanismo que la Bandeja (Parte C), reusado, no copiado. */
  alsoBranchIds?: string[];
};

export type CorrectAndApplyItemResult = {
  decisionId: string;
  costBefore: number | null;
  costAfter: number | null;
  priceBefore: number | null;
  priceAfter: number | null;
  alsoBranchResults: Array<{ branchId: string; previousPrice: number | null; newPrice: number }>;
  alsoBranchFailed: Array<{ branchId: string; reason: string }>;
};

/**
 * D.1.3 — "corregir costo y precio desde la Bandeja", en una transacción POR
 * DECISIÓN: corregir el costo si viene, recalcular el costo efectivo,
 * validar el precio final contra el costo NUEVO, aplicar el precio (manual/
 * automático/mantener), igualar en otras sucursales si se pidió, y cerrar la
 * decisión — condicionado a OPEN. Separada de la ruta HTTP (que solo valida
 * con Zod y abre la transacción) para poder probarla con un tx en memoria,
 * mismo patrón que applyOneTrayDecisionTx.
 */
export async function correctAndApplyTrayItemTx(
  tx: Prisma.TransactionClient,
  item: CorrectAndApplyItemInput,
  reason: string,
  actorUserId: string,
): Promise<CorrectAndApplyItemResult> {
  await tx.$queryRaw`SELECT id FROM "BrainDecision" WHERE id = ${item.decisionId} FOR UPDATE`;
  const decision = await tx.brainDecision.findUniqueOrThrow({ where: { id: item.decisionId } });
  if (decision.category !== "PRICING") throw new Error("DECISION_NOT_PRICING");
  if (decision.status !== "OPEN") throw new Error("ALREADY_PROCESSED");
  if (!decision.branchId || !decision.productId) throw new Error("DECISION_MISSING_SUGGESTED_PRICE");
  const { branchId, productId } = decision;

  const priceBeforeRaw = await getEffectiveProductPricing(tx, { branchId, productId });
  const priceBefore = priceBeforeRaw.effectivePrice === null ? null : Number(priceBeforeRaw.effectivePrice);

  // 1. Corregir el costo, si viene.
  let costBefore: number | null = priceBeforeRaw.effectiveCost === null ? null : Number(priceBeforeRaw.effectiveCost);
  let costAfter = costBefore;
  if (item.cost) {
    const correction = await correctProductCostTx(tx, {
      productId, branchId, action: item.cost.action, newCost: item.cost.value, reason, actorUserId, allowHighUnitCost: item.allowHighUnitCost,
    });
    costBefore = correction.previousValue;
    costAfter = correction.effectiveCost;
  }

  // 2. Recalcular el costo efectivo (ya lo trae correctProductCostTx; si no hubo corrección de costo, el valor de arriba sigue vigente).
  const effectiveNow = item.cost ? costAfter : costBefore;

  let priceAfter = priceBefore;
  let resolutionNote: string;

  if (item.keepPrice) {
    resolutionNote = costAfter !== costBefore
      ? `Costo C$ ${costBefore?.toFixed(2) ?? "—"} → C$ ${costAfter?.toFixed(2) ?? "—"} (${item.cost?.action ?? "sin cambio"}); precio sin cambio.`
      : "Precio sin cambio.";
  } else {
    let chosenPrice: number | undefined = item.mode === "MANUAL" ? item.price : undefined;
    if (chosenPrice === undefined && item.mode === "AUTO") {
      // D.1.4/1.3 — "el sugerido recalculado con el costo nuevo, no el viejo
      // de la decisión": la policy/clase ABC-XYZ no cambian por corregir un
      // costo, así que se leen tal cual (fuera de `tx`, igual que
      // marginForAppliedPrice en Parte C — una lectura de recomendación, no
      // una escritura, no necesita la misma atomicidad); lo único que debe
      // ser el valor FRESCO de este tx es effectiveNow.
      const [policy, commercial] = await Promise.all([
        resolvePolicyForProduct({ branchId, productId }, tx),
        buildCommercialIntelligenceForProduct({ branchId, productId }),
      ]);
      if (effectiveNow !== null && effectiveNow > 0) {
        const suggestion = calculatePricingSuggestion({
          mode: "ADVANCED",
          baseCost: effectiveNow,
          includeTaxInCost: false,
          monthlyOperatingExpenses: policy.categoryPolicy.monthlyExpenseAllocation,
          categoryMonthlyUnits: policy.categoryPolicy.estimatedMonthlyUnits,
          estimatedMonthlyUnits: policy.categoryPolicy.estimatedMonthlyUnits,
          expenseAllocationScope: "CATEGORY",
          marginPercent: commercial.recommendedMarginPercent,
          minProfitAmount: commercial.recommendedMinProfitAmount,
          roundingRule: policy.categoryPolicy.roundingRule as any,
        });
        chosenPrice = suggestion.suggestedPrice;
      }
    }
    if (chosenPrice === undefined) throw new Error("VALIDATION_ERROR: Sin precio para aplicar.");

    // 3. Validar el precio final contra el costo NUEVO.
    assertPriceNotBelowCost({ price: chosenPrice, cost: effectiveNow });
    const warnings = assertPriceApplicable({ suggestedPrice: chosenPrice, totalInternalCost: effectiveNow ?? undefined });

    // 4. Aplicar el precio.
    const applyResult = await applySuggestedPriceTx(tx, {
      productId, branchId, applyScope: "BRANCH", suggestedPrice: chosenPrice, effectiveCost: effectiveNow, actorUserId,
      reason: `${reason} (${item.mode === "AUTO" ? "automático" : "manual"})`,
    }, branchId, warnings);
    priceAfter = applyResult.newPrice;
    resolutionNote = `Costo ${costBefore !== costAfter ? `C$ ${costBefore?.toFixed(2) ?? "—"} → C$ ${costAfter?.toFixed(2) ?? "—"} (${item.cost?.action ?? "sin cambio"})` : "sin cambio"}; precio ${priceBefore !== priceAfter ? `C$ ${priceBefore?.toFixed(2) ?? "—"} → C$ ${priceAfter?.toFixed(2) ?? "—"}` : "sin cambio"}.`;
  }

  // alsoBranchIds — "aplicar el mismo precio en otras sucursales", mismo
  // mecanismo que la Bandeja (Parte C, applyAlsoBranchPriceTx): una falla en
  // una sucursal (p.ej. queda bajo su propio costo) no tumba las demás.
  const alsoBranchResults: CorrectAndApplyItemResult["alsoBranchResults"] = [];
  const alsoBranchFailed: CorrectAndApplyItemResult["alsoBranchFailed"] = [];
  if (!item.keepPrice && item.alsoBranchIds && item.alsoBranchIds.length > 0 && priceAfter !== null) {
    for (const otherBranchId of item.alsoBranchIds) {
      try {
        const result = await applyAlsoBranchPriceTx(tx, otherBranchId, productId, priceAfter, actorUserId);
        alsoBranchResults.push({ branchId: otherBranchId, previousPrice: result.previousPrice === null ? null : Number(result.previousPrice), newPrice: priceAfter });
      } catch (error) {
        alsoBranchFailed.push({ branchId: otherBranchId, reason: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
      }
    }
  }

  // 5. Cerrar la decisión, condicionado a OPEN.
  const updated = await tx.brainDecision.updateMany({
    where: { id: item.decisionId, status: "OPEN" },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedByUserId: actorUserId,
      resolutionSource: item.mode === "MANUAL" || item.cost ? "USER" : "EXECUTION",
      resolutionNote,
      executedEntityType: "Product",
      executedEntityId: productId,
    },
  });
  if (updated.count === 0) throw new Error("ALREADY_PROCESSED");

  await tx.brainDecisionActionLog.create({
    data: { decisionId: item.decisionId, actorUserId, action: "RESOLVED", note: resolutionNote, metadataJson: { source: "pricing-tray-correct", mode: item.mode } as unknown as Prisma.InputJsonValue },
  });

  return { decisionId: item.decisionId, costBefore, costAfter, priceBefore, priceAfter, alsoBranchResults, alsoBranchFailed };
}
