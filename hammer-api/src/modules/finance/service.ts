import { Prisma, PaymentStatus, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { excludeDerivedStockGroupMembers } from "@/modules/catalog/service";

/**
 * Servicio central de Finanzas & Contabilidad.
 *
 * Fuente ÚNICA y oficial de las métricas financieras que antes vivían dispersas
 * (proyección comercial del inventario en catalog-inventory, gastos, planilla,
 * desempeño real). Inventario ya no es responsable del cálculo de venta potencial
 * ni del margen bruto: eso vive aquí.
 */

const SALE_OUT_TYPES = ["SALE_OUT", "PACKAGE_SALE_OUT", "LOOSE_UNIT_SALE_OUT"] as const;

function num(value: Prisma.Decimal | number | null | undefined): number {
  return Number(value ?? 0);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type FinanceSummaryInput = {
  branchId?: string | null;
  year?: number;
  month?: number; // 1-12
};

export type FinanceSummary = {
  period: { year: number; month: number; start: string; end: string };
  branchId: string | null;
  inventoryProjection: {
    inventoryValue: number;
    potentialRevenue: number;
    potentialGrossProfit: number;
    potentialGrossMarginPercent: number | null;
    productsWithoutPrice: number;
    productsWithoutCost: number;
  };
  operatingExpenses: {
    monthlyTotal: number;
    periodTotal: number;
    byCategory: Array<{ category: string; amount: number }>;
    byBranch: Array<{ branchId: string; branchCode: string | null; amount: number }>;
  };
  payroll: {
    payrollTotal: number;
    employerCostTotal: number;
    pendingPayrollTotal: number;
  };
  realPerformance: {
    netSales: number;
    cogs: number;
    grossProfit: number;
    grossMarginPercent: number | null;
    operatingExpenses: number;
    operatingProfit: number;
    estimatedNetProfit: number;
  };
};

/**
 * Proyección comercial del inventario (NO es utilidad real): valor a costo vs valor
 * de venta potencial y margen bruto potencial. Excluye miembros derivados de fusiones
 * (su stock vive en el canónico) para no doblar el conteo.
 */
async function computeInventoryProjection(branchId?: string | null) {
  // excludeDerivedStockGroupMembers() devuelve { NOT: {...} } → se aplica al product
  // para no contar los miembros derivados de una fusión (su stock vive en el canónico).
  const balanceWhere: Prisma.InventoryBalanceWhereInput = {
    ...(branchId ? { branchId } : {}),
    product: { isActive: true, ...excludeDerivedStockGroupMembers() },
  };

  const [balances, settings] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where: balanceWhere,
      select: {
        branchId: true,
        productId: true,
        quantityOnHand: true,
        inventoryValue: true,
        weightedAverageCost: true,
        product: { select: { standardSalePrice: true } },
      },
    }),
    prisma.branchProductSetting.findMany({
      where: { ...(branchId ? { branchId } : {}), branchPrice: { not: null } },
      select: { branchId: true, productId: true, branchPrice: true },
    }),
  ]);

  const branchPriceByKey = new Map<string, number>();
  for (const s of settings) {
    const bp = num(s.branchPrice);
    if (bp > 0) branchPriceByKey.set(`${s.productId}:${s.branchId}`, bp);
  }

  let inventoryValue = 0;
  let potentialRevenue = 0;
  const productsNoPrice = new Set<string>();
  const productsNoCost = new Set<string>();

  for (const row of balances) {
    const qty = Math.max(0, num(row.quantityOnHand));
    inventoryValue += num(row.inventoryValue);
    const effectivePrice =
      branchPriceByKey.get(`${row.productId}:${row.branchId}`) ?? Math.max(0, num(row.product.standardSalePrice));
    potentialRevenue += qty * effectivePrice;
    if (effectivePrice <= 0) productsNoPrice.add(row.productId);
    if (qty > 0 && num(row.weightedAverageCost) <= 0) productsNoCost.add(row.productId);
  }

  const potentialGrossProfit = potentialRevenue - inventoryValue;
  const potentialGrossMarginPercent =
    potentialRevenue > 0 ? Math.round((potentialGrossProfit / potentialRevenue) * 1000) / 10 : null;

  return {
    inventoryValue: round2(inventoryValue),
    potentialRevenue: round2(potentialRevenue),
    potentialGrossProfit: round2(potentialGrossProfit),
    potentialGrossMarginPercent,
    productsWithoutPrice: productsNoPrice.size,
    productsWithoutCost: productsNoCost.size,
  };
}

/** Gastos operativos: total mensual configurado, por categoría y por sucursal. */
async function computeOperatingExpenses(branchId?: string | null) {
  const where: Prisma.OperatingExpenseWhereInput = { isActive: true, ...(branchId ? { branchId } : {}) };
  const [byCategoryRaw, byBranchRaw, branches] = await Promise.all([
    prisma.operatingExpense.groupBy({ by: ["category"], where, _sum: { amount: true } }),
    prisma.operatingExpense.groupBy({ by: ["branchId"], where, _sum: { amount: true } }),
    prisma.branch.findMany({ select: { id: true, code: true } }),
  ]);
  const branchCode = new Map(branches.map((b) => [b.id, b.code]));
  const monthlyTotal = byCategoryRaw.reduce((sum, r) => sum + num(r._sum.amount), 0);

  return {
    monthlyTotal: round2(monthlyTotal),
    // Gasto recurrente mensual = gasto del periodo (los OperatingExpense son mensuales).
    periodTotal: round2(monthlyTotal),
    byCategory: byCategoryRaw
      .map((r) => ({ category: r.category as string, amount: round2(num(r._sum.amount)) }))
      .sort((a, b) => b.amount - a.amount),
    byBranch: byBranchRaw
      .map((r) => ({ branchId: r.branchId, branchCode: branchCode.get(r.branchId) ?? null, amount: round2(num(r._sum.amount)) }))
      .sort((a, b) => b.amount - a.amount),
  };
}

/** Planilla: desembolsos pagados en el período y pendientes por pagar. */
async function computePayroll(branchId: string | null, year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const disbWhere: Prisma.PayrollDisbursementWhereInput = {
    scheduledDate: { gte: start, lt: end },
    ...(branchId ? { branchId } : {}),
  };
  const [paid, pending, employerCost] = await Promise.all([
    prisma.payrollDisbursement.aggregate({
      where: { ...disbWhere, status: "PAID" },
      _sum: { amount: true },
    }),
    prisma.payrollDisbursement.aggregate({
      where: { ...disbWhere, status: "PENDING" },
      _sum: { amount: true },
    }),
    // Costo patronal: de la corrida completa POSTED, no se desembolsa en mitades
    prisma.payrollRun.aggregate({
      where: { year, month, status: "POSTED", ...(branchId ? { branchId } : {}) },
      _sum: { totalEmployerCost: true },
    }),
  ]);
  return {
    payrollTotal: round2(num(paid._sum.amount)),
    employerCostTotal: round2(num(employerCost._sum.totalEmployerCost)),
    pendingPayrollTotal: round2(num(pending._sum.amount)),
  };
}

/**
 * Desempeño REAL del periodo (utilidad de verdad, no proyección):
 *  netSales = pagos POSTED del periodo; cogs = costo de los movimientos de salida por
 *  venta (cantidad × costo base); grossProfit = netSales − cogs; operatingProfit =
 *  grossProfit − gastos operativos (que ya incluyen la planilla auto-generada).
 */
async function computeRealPerformance(
  branchId: string | null,
  start: Date,
  end: Date,
  operatingExpensesPeriodTotal: number,
) {
  const branchFilter = branchId ? { branchId } : {};
  const [payments, saleMovements] = await Promise.all([
    prisma.payment.aggregate({
      where: {
        status: PaymentStatus.POSTED,
        paidAt: { gte: start, lt: end },
        saleOrder: { ...(branchId ? { branchId } : {}), status: { not: SaleOrderStatus.CANCELLED } },
      },
      _sum: { amount: true },
    }),
    prisma.inventoryMovement.findMany({
      where: { ...branchFilter, movementType: { in: [...SALE_OUT_TYPES] }, createdAt: { gte: start, lt: end } },
      select: { quantity: true, unitCost: true },
    }),
  ]);

  const netSales = num(payments._sum.amount);
  const cogs = saleMovements.reduce((sum, m) => sum + num(m.quantity) * num(m.unitCost), 0);
  const grossProfit = netSales - cogs;
  const grossMarginPercent = netSales > 0 ? Math.round((grossProfit / netSales) * 1000) / 10 : null;
  const operatingProfit = grossProfit - operatingExpensesPeriodTotal;

  return {
    netSales: round2(netSales),
    cogs: round2(cogs),
    grossProfit: round2(grossProfit),
    grossMarginPercent,
    operatingExpenses: round2(operatingExpensesPeriodTotal),
    operatingProfit: round2(operatingProfit),
    // Sin impuestos modelados: la utilidad neta estimada = utilidad operativa.
    estimatedNetProfit: round2(operatingProfit),
  };
}

export async function getFinanceSummary(input: FinanceSummaryInput = {}): Promise<FinanceSummary> {
  const branchId = input.branchId ?? null;
  const now = new Date();
  const year = input.year ?? now.getUTCFullYear();
  const month = input.month ?? now.getUTCMonth() + 1;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  const [inventoryProjection, operatingExpenses, payroll] = await Promise.all([
    computeInventoryProjection(branchId),
    computeOperatingExpenses(branchId),
    computePayroll(branchId, year, month),
  ]);

  const realPerformance = await computeRealPerformance(branchId, start, end, operatingExpenses.periodTotal);

  return {
    period: { year, month, start: start.toISOString(), end: end.toISOString() },
    branchId,
    inventoryProjection,
    operatingExpenses,
    payroll,
    realPerformance,
  };
}
