import { Prisma, PaymentStatus } from "@prisma/client";
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
// Devoluciones que reingresan inventario VENDIBLE: reducen el costo de ventas.
// RETURN_IN_DAMAGED queda fuera a propósito: esa mercadería ya no es vendible,
// su costo permanece consumido (merma) — regla contable correcta.
const SELLABLE_RETURN_IN_TYPES = ["RETURN_IN", "LOOSE_UNIT_RETURN_IN"] as const;

function num(value: Prisma.Decimal | number | null | undefined): number {
  return Number(value ?? 0);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Auditoría 2026-07-22 (ALTO Finanzas, resuelto): reportes de meses ya
 * cerrados cambiaban retroactivamente al anular una venta que cruza el
 * corte de mes. Causa: el filtro de pagos usaba el status ACTUAL
 * (payment.status=POSTED, saleOrder.status≠CANCELLED) en vez del estado
 * "vigente al cierre del período" — así que cancelar en julio una venta de
 * junio hacía desaparecer esa venta de un reporte de junio vuelto a generar
 * en agosto, aunque en junio (cuando cerró ese período) la venta seguía
 * siendo válida.
 *
 * Decisión de diseño (igual que la práctica contable estándar: un período
 * cerrado no se reabre — la reversión se asienta en el período en que
 * ocurre, no reescribiendo el original): un pago cuenta para el período
 * [start, end) si seguía POSTED, o si se anuló pero la anulación
 * (SaleOrder.cancelledAt, sellado en cancelSaleOrder) ocurrió DESPUÉS de
 * que ese período cerrara. Esto no requiere migración: cancelledAt ya
 * existe y se sella en la misma transacción que voidea el pago.
 *
 * El lado del costo (COGS) ya era correcto sin tocar nada: cogsOut/
 * cogsReturned se calculan por la fecha REAL del InventoryMovement
 * (SALE_OUT en el mes de la venta, RETURN_IN en el mes de la anulación),
 * sin ningún filtro de status — por eso nunca cambia retroactivamente.
 */
export function paymentValidAsOfPeriodEnd(end: Date, branchId: string | null): Prisma.PaymentWhereInput {
  return {
    saleOrder: branchId ? { branchId } : {},
    OR: [
      { status: PaymentStatus.POSTED },
      { status: PaymentStatus.VOIDED, saleOrder: { cancelledAt: { gte: end } } },
    ],
  };
}

/**
 * Límites del mes contable en hora de Managua (UTC-6, Nicaragua no usa DST):
 * medianoche Managua del día 1 = 06:00 UTC. Antes se cortaba en medianoche UTC,
 * lo que empujaba las ventas de 6pm-12am Managua del último día al mes siguiente.
 */
function managuaMonthRangeUtc(year: number, month: number) {
  return {
    start: new Date(Date.UTC(year, month - 1, 1, 6)),
    end: new Date(Date.UTC(year, month, 1, 6)),
  };
}

/** Año/mes "actuales" según el calendario de Managua (no el del servidor). */
function managuaNowParts(now: Date = new Date()) {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Managua", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const [year, month] = ymd.split("-").map(Number);
  return { year, month };
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
    grossSales: number;
    refunds: number;
    netSales: number;
    cogs: number;
    grossProfit: number;
    grossMarginPercent: number | null;
    /** Gastos pagados desde caja de sucursal en el período (luz, agua, compras del momento…), sin planilla. */
    cashExpenses: number;
    /**
     * Costo EMPRESA de la planilla desembolsada (PAID) en el período: el neto
     * pagado escalado a employerCost (incluye retenciones, INSS patronal,
     * INATEC y provisiones). Línea propia — ver computeRealPerformance.
     */
    payrollPaid: number;
    /** Total de gastos REALES del período = cashExpenses + payrollPaid. */
    operatingExpenses: number;
    /** Presupuesto mensual configurado (OperatingExpense) — referencia, no se resta. */
    expensesBudgetMonthly: number;
    operatingProfit: number;
    estimatedNetProfit: number;
    byBranch: Array<{
      branchId: string;
      branchCode: string | null;
      branchName: string | null;
      grossSales: number;
      refunds: number;
      netSales: number;
      cogs: number;
      grossProfit: number;
      grossMarginPercent: number | null;
      cashExpenses: number;
      payrollPaid: number;
      operatingExpenses: number;
      operatingProfit: number;
    }>;
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
    // La valorización potencial sigue usando standardSalePrice como estimacion cuando
    // no hay precio de sucursal (reporte de valorizacion, no precio de venta real).
    // El contador "sin precio" en cambio debe reflejar precio de sucursal genuino,
    // igual que el resto del sistema tras quitar el fallback global de venta.
    const branchPrice = branchPriceByKey.get(`${row.productId}:${row.branchId}`);
    const effectivePrice = branchPrice ?? Math.max(0, num(row.product.standardSalePrice));
    potentialRevenue += qty * effectivePrice;
    if (branchPrice === undefined) productsNoPrice.add(row.productId);
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

/**
 * Gastos operativos configurados VIGENTES en el período: total mensual, por
 * categoría y por sucursal. Sin el filtro de vigencia, un gasto de nómina de
 * mayo (effectiveTo puntual) seguiría sumando en el presupuesto de julio.
 */
async function computeOperatingExpenses(branchId: string | null, start: Date, end: Date) {
  const where: Prisma.OperatingExpenseWhereInput = {
    isActive: true,
    ...(branchId ? { branchId } : {}),
    effectiveFrom: { lt: end },
    // Cubre recurrentes sin fecha de fin y gastos puntuales (ej. nómina) con
    // effectiveTo del día de pago.
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }],
  };
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
  // scheduledDate es una fecha pura (medianoche UTC): límites en UTC explícito.
  // Antes usaba `new Date(year, month-1, 1)` = zona horaria DEL SERVIDOR, con
  // resultados distintos entre local y Vercel.
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
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
 *  grossProfit − (cashExpenses + payrollPaid).
 *
 * CRITERIO PLANILLA (sin doble conteo):
 *  - La planilla entra como LÍNEA PROPIA valorada a costo EMPRESA (employerCost:
 *    bruto + INSS patronal + INATEC + provisiones), no al neto desembolsado ni al
 *    grossSalary. Como los desembolsos registran el NETO (mitades del netPay),
 *    cada desembolso pagado se escala por employerCost/netPay de su PayrollLine.
 *  - Del lado caja se excluye TODO egreso vinculado a planilla: los EXPENSE_OUT
 *    de desembolsos (payrollDisbursements: none) y los EXPENSE_OUT de partidas de
 *    OperatingExpense categorizadas PAYROLL pagadas desde caja. Así la nómina no
 *    se cuenta dos veces (una por la línea de planilla y otra como gasto de caja).
 */
/**
 * Convierte un desembolso de planilla PAGADO (registrado al NETO) a costo
 * EMPRESA, escalando por employerCost/netPay de su PayrollLine. Si la línea
 * no tiene neto (>0) — p. ej. datos históricos — se usa el monto pagado tal cual.
 */
function payrollEmployerCostPaid(d: {
  amount: Prisma.Decimal;
  payrollLine: { netPay: Prisma.Decimal; employerCost: Prisma.Decimal } | null;
}): number {
  const paidNet = num(d.amount);
  const lineNet = num(d.payrollLine?.netPay);
  const lineCost = num(d.payrollLine?.employerCost);
  if (lineNet <= 0 || lineCost <= 0) return paidNet;
  return paidNet * (lineCost / lineNet);
}

async function computeRealPerformance(
  branchId: string | null,
  start: Date,
  end: Date,
  operatingExpenses: { monthlyTotal: number },
) {
  const branchFilter = branchId ? { branchId } : {};
  const [payments, refunds, movements, branches, cashExpenseMovs, payrollDisbursed] = await Promise.all([
    prisma.payment.findMany({
      where: {
        paidAt: { gte: start, lt: end },
        ...paymentValidAsOfPeriodEnd(end, branchId),
      },
      select: { amount: true, saleOrder: { select: { branchId: true } } },
    }),
    prisma.refund.findMany({
      where: { ...branchFilter, status: "POSTED", postedAt: { gte: start, lt: end } },
      select: { amount: true, branchId: true },
    }),
    prisma.inventoryMovement.findMany({
      where: {
        ...branchFilter,
        movementType: { in: [...SALE_OUT_TYPES, ...SELLABLE_RETURN_IN_TYPES] },
        createdAt: { gte: start, lt: end },
      },
      select: { quantity: true, unitCost: true, movementType: true, branchId: true },
    }),
    prisma.branch.findMany({ select: { id: true, code: true, name: true } }),
    // Gastos REALES pagados desde caja de sucursal (luz, agua, aceite, compras
    // del momento…). Se excluyen los EXPENSE_OUT vinculados a desembolsos de
    // planilla Y los de partidas OperatingExpense categorizadas PAYROLL: la
    // planilla se cuenta aparte (a costo empresa) para no doble-contarla.
    prisma.cashMovement.findMany({
      where: {
        type: "EXPENSE_OUT",
        createdAt: { gte: start, lt: end },
        payrollDisbursements: { none: {} },
        operatingExpense: { isNot: { category: "PAYROLL" } },
        ...(branchId ? { cashSession: { physicalCashBox: { branchId } } } : {}),
      },
      select: { amount: true, cashSession: { select: { physicalCashBox: { select: { branchId: true } } } } },
    }),
    // Planilla realmente desembolsada en el período (independiente de si salió
    // por caja de sucursal o la pagó Master por otro medio). Se trae la línea
    // para escalar el neto pagado a costo empresa (ver criterio arriba).
    prisma.payrollDisbursement.findMany({
      where: { status: "PAID", paidAt: { gte: start, lt: end }, ...(branchId ? { branchId } : {}) },
      select: { amount: true, branchId: true, payrollLine: { select: { netPay: true, employerCost: true } } },
    }),
  ]);

  const branchMeta = new Map(branches.map((b) => [b.id, { code: b.code, name: b.name }]));

  type BranchAcc = {
    grossSales: number; refunds: number; cogsOut: number; cogsReturned: number;
    cashExpenses: number; payrollPaid: number;
  };
  const perBranch = new Map<string, BranchAcc>();
  const acc = (id: string): BranchAcc => {
    let entry = perBranch.get(id);
    if (!entry) {
      entry = { grossSales: 0, refunds: 0, cogsOut: 0, cogsReturned: 0, cashExpenses: 0, payrollPaid: 0 };
      perBranch.set(id, entry);
    }
    return entry;
  };

  for (const p of payments) acc(p.saleOrder.branchId).grossSales += num(p.amount);
  for (const r of refunds) acc(r.branchId).refunds += num(r.amount);
  for (const m of movements) {
    const cost = num(m.quantity) * num(m.unitCost);
    if ((SALE_OUT_TYPES as readonly string[]).includes(m.movementType)) acc(m.branchId).cogsOut += cost;
    else acc(m.branchId).cogsReturned += cost;
  }
  for (const e of cashExpenseMovs) acc(e.cashSession.physicalCashBox.branchId).cashExpenses += num(e.amount);
  for (const d of payrollDisbursed) acc(d.branchId).payrollPaid += payrollEmployerCostPaid(d);

  const byBranch = [...perBranch.entries()]
    .map(([id, b]) => {
      const netSales = b.grossSales - b.refunds;
      const cogs = b.cogsOut - b.cogsReturned;
      const grossProfit = netSales - cogs;
      const realExpenses = b.cashExpenses + b.payrollPaid;
      return {
        branchId: id,
        branchCode: branchMeta.get(id)?.code ?? null,
        branchName: branchMeta.get(id)?.name ?? null,
        grossSales: round2(b.grossSales),
        refunds: round2(b.refunds),
        netSales: round2(netSales),
        cogs: round2(cogs),
        grossProfit: round2(grossProfit),
        grossMarginPercent: netSales > 0 ? Math.round((grossProfit / netSales) * 1000) / 10 : null,
        cashExpenses: round2(b.cashExpenses),
        payrollPaid: round2(b.payrollPaid),
        operatingExpenses: round2(realExpenses),
        operatingProfit: round2(grossProfit - realExpenses),
      };
    })
    .sort((a, b) => b.netSales - a.netSales);

  const grossSales = byBranch.reduce((s, b) => s + b.grossSales, 0);
  const refundsTotal = byBranch.reduce((s, b) => s + b.refunds, 0);
  const netSales = grossSales - refundsTotal;
  const cogs = byBranch.reduce((s, b) => s + b.cogs, 0);
  const grossProfit = netSales - cogs;
  const grossMarginPercent = netSales > 0 ? Math.round((grossProfit / netSales) * 1000) / 10 : null;
  const cashExpenses = byBranch.reduce((s, b) => s + b.cashExpenses, 0);
  const payrollPaid = byBranch.reduce((s, b) => s + b.payrollPaid, 0);
  const realExpenses = cashExpenses + payrollPaid;
  const operatingProfit = grossProfit - realExpenses;

  return {
    grossSales: round2(grossSales),
    refunds: round2(refundsTotal),
    netSales: round2(netSales),
    cogs: round2(cogs),
    grossProfit: round2(grossProfit),
    grossMarginPercent,
    cashExpenses: round2(cashExpenses),
    payrollPaid: round2(payrollPaid),
    operatingExpenses: round2(realExpenses),
    expensesBudgetMonthly: round2(operatingExpenses.monthlyTotal),
    operatingProfit: round2(operatingProfit),
    // Sin impuestos modelados: la utilidad neta estimada = utilidad operativa.
    estimatedNetProfit: round2(operatingProfit),
    byBranch,
  };
}

export async function getFinanceSummary(input: FinanceSummaryInput = {}): Promise<FinanceSummary> {
  const branchId = input.branchId ?? null;
  const nowParts = managuaNowParts();
  const year = input.year ?? nowParts.year;
  const month = input.month ?? nowParts.month;
  const { start, end } = managuaMonthRangeUtc(year, month);

  const [inventoryProjection, operatingExpenses, payroll] = await Promise.all([
    computeInventoryProjection(branchId),
    computeOperatingExpenses(branchId, start, end),
    computePayroll(branchId, year, month),
  ]);

  const realPerformance = await computeRealPerformance(branchId, start, end, operatingExpenses);

  return {
    period: { year, month, start: start.toISOString(), end: end.toISOString() },
    branchId,
    inventoryProjection,
    operatingExpenses,
    payroll,
    realPerformance,
  };
}

/* ══════════════════════════════════════════════════════
 *  TRAYECTORIA MES A MES (paquete financiero ejecutivo)
 * ══════════════════════════════════════════════════════ */

export type FinanceTrendPoint = {
  year: number;
  month: number; // 1-12
  grossSales: number;
  refunds: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number | null;
  cashExpenses: number;
  payrollPaid: number;
  operatingProfit: number;
};

/** Índice de mes absoluto (año*12 + mes-1) del instante, en calendario Managua. */
function managuaMonthIndex(d: Date): number {
  // UTC-6 fijo (Nicaragua no usa DST): restar 6h y leer el calendario UTC.
  const shifted = new Date(d.getTime() - 6 * 3_600_000);
  return shifted.getUTCFullYear() * 12 + shifted.getUTCMonth();
}

/**
 * Serie mensual del desempeño REAL (mismas reglas contables que
 * computeRealPerformance, todo base caja) para los últimos `months` meses
 * incluyendo el actual. UNA pasada de 5 queries sobre el rango completo,
 * bucketeada por mes Managua — no una consulta por mes.
 */
export async function getFinanceTrend(input: { branchId?: string | null; months?: number } = {}) {
  const branchId = input.branchId ?? null;
  const months = Math.min(12, Math.max(1, input.months ?? 6));
  const nowParts = managuaNowParts();
  const endIdx = nowParts.year * 12 + (nowParts.month - 1);
  const startIdx = endIdx - (months - 1);
  const { start } = managuaMonthRangeUtc(Math.floor(startIdx / 12), (startIdx % 12) + 1);
  const { end } = managuaMonthRangeUtc(nowParts.year, nowParts.month);

  const branchFilter = branchId ? { branchId } : {};
  const [payments, refunds, movements, cashExpenseMovs, payrollDisbursed] = await Promise.all([
    prisma.payment.findMany({
      where: {
        paidAt: { gte: start, lt: end },
        ...paymentValidAsOfPeriodEnd(end, branchId),
      },
      select: { amount: true, paidAt: true },
    }),
    prisma.refund.findMany({
      where: { ...branchFilter, status: "POSTED", postedAt: { gte: start, lt: end } },
      select: { amount: true, postedAt: true },
    }),
    prisma.inventoryMovement.findMany({
      where: {
        ...branchFilter,
        movementType: { in: [...SALE_OUT_TYPES, ...SELLABLE_RETURN_IN_TYPES] },
        createdAt: { gte: start, lt: end },
      },
      select: { quantity: true, unitCost: true, movementType: true, createdAt: true },
    }),
    // Mismas exclusiones de planilla que computeRealPerformance (criterio único).
    prisma.cashMovement.findMany({
      where: {
        type: "EXPENSE_OUT",
        createdAt: { gte: start, lt: end },
        payrollDisbursements: { none: {} },
        operatingExpense: { isNot: { category: "PAYROLL" } },
        ...(branchId ? { cashSession: { physicalCashBox: { branchId } } } : {}),
      },
      select: { amount: true, createdAt: true },
    }),
    prisma.payrollDisbursement.findMany({
      where: { status: "PAID", paidAt: { gte: start, lt: end }, ...(branchId ? { branchId } : {}) },
      select: { amount: true, paidAt: true, payrollLine: { select: { netPay: true, employerCost: true } } },
    }),
  ]);

  type Acc = { grossSales: number; refunds: number; cogsOut: number; cogsReturned: number; cashExpenses: number; payrollPaid: number };
  const buckets = new Map<number, Acc>();
  // Pre-crear todos los meses para que la serie no tenga huecos (meses sin ventas = 0).
  for (let idx = startIdx; idx <= endIdx; idx++) {
    buckets.set(idx, { grossSales: 0, refunds: 0, cogsOut: 0, cogsReturned: 0, cashExpenses: 0, payrollPaid: 0 });
  }
  const at = (d: Date | null): Acc | undefined => (d ? buckets.get(managuaMonthIndex(d)) : undefined);

  for (const p of payments) { const b = at(p.paidAt); if (b) b.grossSales += num(p.amount); }
  for (const r of refunds) { const b = at(r.postedAt); if (b) b.refunds += num(r.amount); }
  for (const m of movements) {
    const b = at(m.createdAt);
    if (!b) continue;
    const cost = num(m.quantity) * num(m.unitCost);
    if ((SALE_OUT_TYPES as readonly string[]).includes(m.movementType)) b.cogsOut += cost;
    else b.cogsReturned += cost;
  }
  for (const e of cashExpenseMovs) { const b = at(e.createdAt); if (b) b.cashExpenses += num(e.amount); }
  for (const d of payrollDisbursed) { const b = at(d.paidAt); if (b) b.payrollPaid += payrollEmployerCostPaid(d); }

  const points: FinanceTrendPoint[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, b]) => {
      const netSales = b.grossSales - b.refunds;
      const cogs = b.cogsOut - b.cogsReturned;
      const grossProfit = netSales - cogs;
      const operatingProfit = grossProfit - b.cashExpenses - b.payrollPaid;
      return {
        year: Math.floor(idx / 12),
        month: (idx % 12) + 1,
        grossSales: round2(b.grossSales),
        refunds: round2(b.refunds),
        netSales: round2(netSales),
        cogs: round2(cogs),
        grossProfit: round2(grossProfit),
        grossMarginPercent: netSales > 0 ? Math.round((grossProfit / netSales) * 1000) / 10 : null,
        cashExpenses: round2(b.cashExpenses),
        payrollPaid: round2(b.payrollPaid),
        operatingProfit: round2(operatingProfit),
      };
    });

  return { branchId, months, points };
}
