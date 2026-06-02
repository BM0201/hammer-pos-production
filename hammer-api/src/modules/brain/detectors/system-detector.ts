import { CashSessionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { riskScoreFor } from "@/modules/brain/scoring";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";
import {
  detectIronSaleUnit,
  getIronBarsPerQuintal,
  ironStockGroupCode,
} from "@/modules/inventory/unit-conversion";

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

  const staleOperationalDays = await prisma.operationalDay.findMany({
    where: {
      status: "OPEN",
      ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
      businessDate: { lt: new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), ctx.now.getUTCDate())) },
    },
    include: { branch: true },
    take: 50,
  });

  for (const day of staleOperationalDays) {
    const severity = day.openCashSessionsCount > 0 || day.autoClosedPendingReviewCount > 0 ? "HIGH" : "MEDIUM";
    decisions.push({
      category: "SYSTEM",
      severity,
      title: `Dia operativo sin cerrar: ${day.branch.code}`,
      description: `${day.branch.name} mantiene abierto un dia operativo anterior.`,
      recommendation: "Revisar cajas, pagos, despacho y cerrar el dia operativo con checklist.",
      branchId: day.branchId,
      confidenceScore: 95,
      riskScore: riskScoreFor(severity, 95),
      proposedActionType: "REVIEW_OPERATIONAL_DAY",
      evidenceJson: {
        operationalDayId: day.id,
        businessDate: day.businessDate,
        openCashSessionsCount: day.openCashSessionsCount,
        autoClosedPendingReviewCount: day.autoClosedPendingReviewCount,
        pendingDispatchCount: day.pendingDispatchCount,
      },
      sourceJson: { detector: "system-detector" },
      fingerprintParts: ["system", "operational-day-not-closed", day.branchId, day.businessDate.toISOString()],
    });
  }

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
    const groupCode = ironStockGroupCode(product.name);
    const saleUnit = detectIronSaleUnit(product.name);
    if (!groupCode || !saleUnit || !getIronBarsPerQuintal(product.name)) continue;
    const rows = ironGroups.get(groupCode) ?? [];
    rows.push(product);
    ironGroups.set(groupCode, rows);
  }

  for (const [groupCode, products] of ironGroups.entries()) {
    const varilla = products.find((product) => detectIronSaleUnit(product.name) === "VARILLA");
    const quintal = products.find((product) => detectIronSaleUnit(product.name) === "QUINTAL");
    const barsPerQuintal = getIronBarsPerQuintal(products[0]?.name ?? "") ?? 0;
    if (!varilla || !quintal || barsPerQuintal <= 0) continue;

    const varillaGroupIds = new Set(varilla.stockGroupMemberships.map((item) => item.stockGroupId));
    const sharedGroupAlreadyExists = quintal.stockGroupMemberships.some((item) => varillaGroupIds.has(item.stockGroupId));
    if (sharedGroupAlreadyExists) continue;

    const productsWithStock = products.filter((product) => product.inventoryBalances.some((balance) => Number(balance.quantityOnHand) > 0));
    const recentSalesCount = products.reduce((sum, product) => sum + product.orderLines.length, 0);
    const severity = productsWithStock.length >= 2 || recentSalesCount >= 2 ? "CRITICAL" : "HIGH";

    decisions.push({
      category: "INVENTORY",
      severity,
      title: `Hierro sin stock compartido: ${groupCode}`,
      description: `${varilla.name} y ${quintal.name} representan el mismo inventario fisico, pero no comparten ProductStockGroup.`,
      recommendation: `Crear grupo de stock con base VARILLA y factor 1 QUINTAL = ${barsPerQuintal} VARILLA. Usar /api/catalog/stock-groups/bootstrap-iron con apply=true tras revisar el dry-run.`,
      branchId: ctx.branchId ?? null,
      productId: varilla.id,
      confidenceScore: 96,
      riskScore: riskScoreFor(severity, 96),
      proposedActionType: "IRON_UNIT_CONVERSION_REQUIRED",
      proposedActionJson: {
        endpoint: "/api/catalog/stock-groups/bootstrap-iron",
        method: "POST",
        dryRunPayload: { apply: false },
        applyPayload: { apply: true },
      },
      evidenceJson: {
        groupCode,
        baseUnit: "VARILLA",
        barsPerQuintal,
        products: products.map((product) => ({
          id: product.id,
          sku: product.sku,
          name: product.name,
          saleUnit: detectIronSaleUnit(product.name),
          stockGroupIds: product.stockGroupMemberships.map((item) => item.stockGroupId),
          stockOnHand: product.inventoryBalances.map((balance) => ({
            branchId: balance.branchId,
            quantityOnHand: balance.quantityOnHand.toString(),
          })),
          recentSalesLines: product.orderLines.length,
        })),
      },
      sourceJson: { detector: "system-detector", rule: "iron-unit-conversion" },
      fingerprintParts: ["system", "iron-unit-conversion-required", ctx.branchId ?? "all", groupCode],
    });
  }

  return decisions;
}
