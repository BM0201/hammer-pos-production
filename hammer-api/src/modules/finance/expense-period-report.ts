import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { OPERATIONAL_TIMEZONE, businessDateFromInstant } from "@/modules/operations/business-date";
import { resolvePeriod, type PeriodKind, type PeriodRange, type ResolvedPeriod } from "@/modules/finance/periods";
import {
  getExpenseLedger,
  accrueRecurring,
  type ExpenseLedgerRow,
  type ExpenseLedgerSource,
} from "@/modules/finance/expense-ledger";
import { computeRealPerformance } from "@/modules/finance/service";
import { computeCategoryStats, type CategoryStats, type ExpenseRecord } from "@/modules/finance/expense-intelligence";
import {
  buildCategorySwingAlerts,
  buildNoReceiptAlert,
  buildOutlierAlerts,
  buildUnclassifiedCashOutAlert,
  buildUnclassifiedCategoryAlert,
  type ExpensePeriodAlert,
} from "@/modules/finance/expense-alerts";

type DbClient = PrismaClient | Prisma.TransactionClient;

function num(value: Prisma.Decimal | number | null | undefined): number {
  return Number(value ?? 0);
}
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type ExpensePeriodBasis = "PAID" | "ACCRUED";

export type ExpensePeriodReportInput = {
  kind: PeriodKind;
  anchorDate?: Date;
  custom?: { from: Date; to: Date };
  branchId: string | null;
  basis: ExpensePeriodBasis;
  rowsLimit: number;
  rowsOffset: number;
  rowsFilter?: { category?: string; source?: ExpenseLedgerSource; conceptId?: string; text?: string };
  noReceiptThreshold?: number;
  /** Meses de historial para la detección de montos atípicos (default 6, igual que /api/finance/expense-history). */
  outlierHistoryMonths?: number;
};

type CategoryConcept = { conceptId: string | null; conceptName: string | null; total: number };
export type CategoryBreakdown = {
  category: string;
  total: number;
  previousTotal: number;
  average4: number;
  deltaPercent: number | null;
  budgetProrated: number;
  budgetExecutedPercent: number | null;
  byConcept: CategoryConcept[];
};

export type ExpensePeriodReport = {
  period: ResolvedPeriod;
  basis: ExpensePeriodBasis;
  branchId: string | null;
  totals: {
    expenseTotal: number;
    netSales: number;
    cogs: number;
    grossProfit: number;
    operatingProfit: number;
    expenseToSalesPercent: number | null;
  };
  byCategory: CategoryBreakdown[];
  byBranch: Array<{ branchId: string | null; branchCode: string | null; branchName: string | null; total: number }>;
  bySource: Array<{ source: ExpenseLedgerSource; total: number }>;
  byDay: Array<{ date: string; total: number; byCategory: Record<string, number> }>;
  comparison: { previousTotal: number; average4Total: number };
  budget: { totalProrated: number; executedPercent: number | null };
  payroll: {
    netPaid: number;
    inssPatronal: number;
    inatec: number;
    provisions: number;
    pending: number;
    halvesPaid: string[];
  } | null;
  alerts: ExpensePeriodAlert[];
  informative: {
    purchasesPaid: number;
    internalFreightCost: number;
    internalFreightOverlapWarning: string | null;
  };
  rows: { items: ExpenseLedgerRow[]; total: number; limit: number; offset: number };
};

function sumRows(rows: ExpenseLedgerRow[]): number {
  return round2(rows.reduce((s, r) => s + r.amount, 0));
}

function categoryTotalsOf(rows: ExpenseLedgerRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.category, round2((map.get(r.category) ?? 0) + r.amount));
  return map;
}

async function fetchCategoryTotals(db: DbClient, range: PeriodRange, branchId: string | null, basis: ExpensePeriodBasis): Promise<Map<string, number>> {
  const { rows } = await getExpenseLedger({ start: range.start, end: range.end, branchId, basis }, db);
  return categoryTotalsOf(rows);
}

/** La misma lógica que resolvePeriod().previous, pero partiendo de un PeriodRange suelto (no de un ResolvedPeriod) — para poder "caminar hacia atrás" N períodos. */
function previousRangeOf(kind: PeriodKind, range: PeriodRange): PeriodRange {
  if (kind === "CUSTOM") {
    const toInclusive = new Date(range.end.getTime() - 24 * 60 * 60 * 1000);
    return resolvePeriod(kind, range.start, { from: range.start, to: toInclusive }).previous;
  }
  return resolvePeriod(kind, range.start).previous;
}

function walkBackRanges(kind: PeriodKind, startFrom: PeriodRange, count: number): PeriodRange[] {
  const ranges: PeriodRange[] = [];
  let cur = startFrom;
  for (let i = 0; i < count; i++) {
    ranges.push(cur);
    cur = previousRangeOf(kind, cur);
  }
  return ranges;
}

function groupByBranch(rows: ExpenseLedgerRow[]): ExpensePeriodReport["byBranch"] {
  const map = new Map<string, { branchId: string | null; branchCode: string | null; branchName: string | null; total: number }>();
  for (const r of rows) {
    const key = r.branchId ?? "__none__";
    let entry = map.get(key);
    if (!entry) {
      entry = { branchId: r.branchId, branchCode: r.branchCode, branchName: r.branchName, total: 0 };
      map.set(key, entry);
    }
    entry.total = round2(entry.total + r.amount);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function groupBySource(rows: ExpenseLedgerRow[]): ExpensePeriodReport["bySource"] {
  const map = new Map<ExpenseLedgerSource, number>();
  for (const r of rows) map.set(r.source, round2((map.get(r.source) ?? 0) + r.amount));
  return [...map.entries()].map(([source, total]) => ({ source, total })).sort((a, b) => b.total - a.total);
}

function groupByDay(rows: ExpenseLedgerRow[]): ExpensePeriodReport["byDay"] {
  const map = new Map<string, { total: number; byCategory: Record<string, number> }>();
  for (const r of rows) {
    const bd = businessDateFromInstant(r.date, OPERATIONAL_TIMEZONE);
    const key = bd.toISOString().slice(0, 10);
    let entry = map.get(key);
    if (!entry) {
      entry = { total: 0, byCategory: {} };
      map.set(key, entry);
    }
    entry.total = round2(entry.total + r.amount);
    entry.byCategory[r.category] = round2((entry.byCategory[r.category] ?? 0) + r.amount);
  }
  return [...map.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
}

function groupByCategoryWithBudget(
  currentRows: ExpenseLedgerRow[],
  previousByCategory: Map<string, number>,
  average4ByCategory: Map<string, number>,
  budgetByCategory: Map<string, number>,
): CategoryBreakdown[] {
  const byCategory = new Map<string, { total: number; concepts: Map<string, CategoryConcept> }>();
  for (const r of currentRows) {
    let entry = byCategory.get(r.category);
    if (!entry) {
      entry = { total: 0, concepts: new Map() };
      byCategory.set(r.category, entry);
    }
    entry.total = round2(entry.total + r.amount);
    const conceptKey = r.conceptId ?? `__none__`;
    let concept = entry.concepts.get(conceptKey);
    if (!concept) {
      concept = { conceptId: r.conceptId, conceptName: r.conceptName, total: 0 };
      entry.concepts.set(conceptKey, concept);
    }
    concept.total = round2(concept.total + r.amount);
  }

  // Categorías con presupuesto pero sin NINGÚN gasto real en el período (ej.
  // alquiler aún no pagado) también deben aparecer, con total=0.
  for (const category of budgetByCategory.keys()) {
    if (!byCategory.has(category)) byCategory.set(category, { total: 0, concepts: new Map() });
  }

  return [...byCategory.entries()]
    .map(([category, v]) => {
      const previousTotal = previousByCategory.get(category) ?? 0;
      const average4 = average4ByCategory.get(category) ?? 0;
      const budgetProrated = budgetByCategory.get(category) ?? 0;
      const delta = v.total - average4;
      return {
        category,
        total: v.total,
        previousTotal,
        average4,
        deltaPercent: average4 > 0 ? round2((delta / average4) * 100) : null,
        budgetProrated: round2(budgetProrated),
        budgetExecutedPercent: budgetProrated > 0 ? round2((v.total / budgetProrated) * 100) : null,
        byConcept: [...v.concepts.values()].sort((a, b) => b.total - a.total),
      };
    })
    .sort((a, b) => b.total - a.total);
}

/** Historial trailing (OperatingExpense pagados desde caja, igual criterio que /api/finance/expense-history) para la detección de montos atípicos. */
async function fetchOutlierStats(db: DbClient, branchId: string | null, beforeDate: Date, months: number): Promise<Map<string, CategoryStats>> {
  const since = new Date(beforeDate);
  since.setUTCMonth(since.getUTCMonth() - months);
  const rows = await db.operatingExpense.findMany({
    where: {
      category: { not: "PAYROLL" },
      cashMovementId: { not: null },
      effectiveFrom: { gte: since, lt: beforeDate },
      ...(branchId ? { branchId } : {}),
    },
    select: { category: true, amount: true, effectiveFrom: true, description: true },
  });
  const byCategory = new Map<string, ExpenseRecord[]>();
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push({ amount: num(row.amount), date: row.effectiveFrom, description: row.description });
    byCategory.set(row.category, list);
  }
  return new Map([...byCategory.entries()].map(([category, records]) => [category, computeCategoryStats(category, records)]));
}

async function fetchPayrollBlock(db: DbClient, start: Date, end: Date, branchId: string | null): Promise<ExpensePeriodReport["payroll"]> {
  const branchFilter = branchId ? { branchId } : {};
  const [paid, pendingAgg] = await Promise.all([
    db.payrollDisbursement.findMany({
      where: { scheduledDate: { gte: start, lt: end }, status: "PAID", ...branchFilter },
      select: { amount: true, period: true, payrollLineId: true },
    }),
    db.payrollDisbursement.aggregate({
      where: { scheduledDate: { gte: start, lt: end }, status: "PENDING", ...branchFilter },
      _sum: { amount: true },
    }),
  ]);

  const pending = num(pendingAgg._sum.amount);
  if (paid.length === 0 && pending <= 0) return null;

  const netPaid = paid.reduce((s, d) => s + num(d.amount), 0);
  const lineIds = [...new Set(paid.map((d) => d.payrollLineId))];
  const lines = lineIds.length > 0
    ? await db.payrollLine.findMany({ where: { id: { in: lineIds } }, select: { inssPatronal: true, inatec: true, provisions: true } })
    : [];
  const halvesPaid = [...new Set(paid.map((d) => d.period as string))];

  return {
    netPaid: round2(netPaid),
    inssPatronal: round2(lines.reduce((s, l) => s + num(l.inssPatronal), 0)),
    inatec: round2(lines.reduce((s, l) => s + num(l.inatec), 0)),
    provisions: round2(lines.reduce((s, l) => s + num(l.provisions), 0)),
    pending: round2(pending),
    halvesPaid,
  };
}

/**
 * prompt-gastos-semana-quincena.md Fase 2.4 — verificación empírica pedida
 * por el doc: ¿el costo de InternalFreightTrip (combustible/mantenimiento/
 * chofer/ayudante) también se registra como gasto de caja o tesorería?
 *
 * Revisado el código (internal-freight/service.ts y sus rutas): los montos
 * de InternalFreightTrip (fuelCost/maintenanceCost/driverCost/helperCost/
 * otherCost/totalTripCost) NO se leen en ningún otro módulo del backend, y
 * el servicio de fletes internos nunca escribe un CashMovement, TreasuryEntry
 * ni OperatingExpense — es decir, a nivel de CÓDIGO no hay ningún vínculo ni
 * doble registro automático entre un viaje de flete interno y el libro de
 * gastos. Por eso se puede ofrecer el total informativo sin inflar el total
 * de gastos operativos.
 *
 * Esto NO descarta que un operador registre el mismo recibo de combustible
 * dos veces a mano (una vez como gasto de caja, otra como costo de un viaje)
 * — es un riesgo de proceso, no uno que el código cause o pueda detectar por
 * sí solo, así que se deja como advertencia junto al dato, no como bloqueo.
 */
async function fetchInternalFreightInformative(db: DbClient, start: Date, end: Date, branchId: string | null): Promise<{ cost: number; warning: string | null }> {
  const agg = await db.internalFreightTrip.aggregate({
    where: {
      status: { in: ["CALCULATED", "APPLIED"] },
      tripDate: { gte: start, lt: end },
      ...(branchId ? { route: { OR: [{ originBranchId: branchId }, { destinationBranchId: branchId }] } } : {}),
    },
    _sum: { totalTripCost: true },
  });
  const cost = round2(num(agg._sum.totalTripCost));
  return {
    cost,
    warning: cost > 0
      ? "El sistema no vincula el costo de fletes internos con ningún gasto de caja/tesorería (no hay doble conteo automático). Si alguien ya registró el mismo combustible como gasto de caja, sí se duplicaría — verifícalo a mano antes de incluir este monto en el total."
      : null,
  };
}

export async function getExpensePeriodReport(input: ExpensePeriodReportInput, db: DbClient = prisma): Promise<ExpensePeriodReport> {
  const period = resolvePeriod(input.kind, input.anchorDate, input.custom);
  const branchId = input.branchId;
  const basis = input.basis;

  const trailingRanges = walkBackRanges(input.kind, period.previous, 4);

  const [
    { rows: currentRows },
    trailingCategoryTotals,
    budgetRows,
    performance,
    payroll,
    outlierStats,
    freightInformative,
    cashOutAgg,
  ] = await Promise.all([
    getExpenseLedger({ start: period.start, end: period.end, branchId, basis }, db),
    Promise.all(trailingRanges.map((r) => fetchCategoryTotals(db, r, branchId, basis))),
    accrueRecurring(db, { start: period.start, end: period.end, branchId }),
    computeRealPerformance(branchId, period.start, period.end, { monthlyTotal: 0 }, db),
    fetchPayrollBlock(db, period.start, period.end, branchId),
    fetchOutlierStats(db, branchId, period.start, input.outlierHistoryMonths ?? 6),
    fetchInternalFreightInformative(db, period.start, period.end, branchId),
    db.cashMovement.aggregate({
      where: {
        type: "CASH_OUT",
        createdAt: { gte: period.start, lt: period.end },
        ...(branchId ? { cashSession: { physicalCashBox: { branchId } } } : {}),
      },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  const expenseTotal = sumRows(currentRows);
  const currentCategoryTotals = categoryTotalsOf(currentRows);
  const previousCategoryTotals = trailingCategoryTotals[0] ?? new Map<string, number>();
  const previousTotal = round2([...previousCategoryTotals.values()].reduce((s, v) => s + v, 0));

  const average4ByCategory = new Map<string, number>();
  const allTrailingCategories = new Set<string>(trailingCategoryTotals.flatMap((m) => [...m.keys()]));
  for (const category of allTrailingCategories) {
    const sum = trailingCategoryTotals.reduce((s, m) => s + (m.get(category) ?? 0), 0);
    average4ByCategory.set(category, round2(sum / trailingCategoryTotals.length));
  }
  const average4Total = round2([...average4ByCategory.values()].reduce((s, v) => s + v, 0));

  const budgetByCategory = categoryTotalsOf(budgetRows);
  const budgetTotalProrated = round2([...budgetByCategory.values()].reduce((s, v) => s + v, 0));

  const byCategory = groupByCategoryWithBudget(currentRows, previousCategoryTotals, average4ByCategory, budgetByCategory);
  const byBranch = groupByBranch(currentRows);
  const bySource = groupBySource(currentRows);
  const byDay = groupByDay(currentRows);

  const grossProfit = performance.grossProfit;
  const operatingProfit = round2(grossProfit - expenseTotal);

  const alerts: ExpensePeriodAlert[] = [
    ...buildCategorySwingAlerts(currentCategoryTotals, average4ByCategory),
    ...buildOutlierAlerts(currentRows, outlierStats),
    ...[buildNoReceiptAlert(currentRows, input.noReceiptThreshold)].filter((a): a is ExpensePeriodAlert => a !== null),
    ...[buildUnclassifiedCashOutAlert(round2(num(cashOutAgg._sum.amount)), cashOutAgg._count)].filter((a): a is ExpensePeriodAlert => a !== null),
    ...[buildUnclassifiedCategoryAlert(currentCategoryTotals)].filter((a): a is ExpensePeriodAlert => a !== null),
  ];

  const filter = input.rowsFilter;
  const text = filter?.text?.trim().toLowerCase();
  const filteredRows = currentRows.filter((r) => {
    if (filter?.category && r.category !== filter.category) return false;
    if (filter?.source && r.source !== filter.source) return false;
    if (filter?.conceptId && r.conceptId !== filter.conceptId) return false;
    if (text && !`${r.description} ${r.payee ?? ""} ${r.conceptName ?? ""}`.toLowerCase().includes(text)) return false;
    return true;
  });
  const sortedRows = filteredRows.sort((a, b) => b.date.getTime() - a.date.getTime());
  const pagedRows = sortedRows.slice(input.rowsOffset, input.rowsOffset + input.rowsLimit);

  return {
    period,
    basis,
    branchId,
    totals: {
      expenseTotal,
      netSales: performance.netSales,
      cogs: performance.cogs,
      grossProfit,
      operatingProfit,
      expenseToSalesPercent: performance.netSales > 0 ? round2((expenseTotal / performance.netSales) * 100) : null,
    },
    byCategory,
    byBranch,
    bySource,
    byDay,
    comparison: { previousTotal, average4Total },
    budget: {
      totalProrated: budgetTotalProrated,
      executedPercent: budgetTotalProrated > 0 ? round2((expenseTotal / budgetTotalProrated) * 100) : null,
    },
    payroll,
    alerts,
    informative: {
      purchasesPaid: performance.purchasesPaid,
      internalFreightCost: freightInformative.cost,
      internalFreightOverlapWarning: freightInformative.warning,
    },
    rows: { items: pagedRows, total: sortedRows.length, limit: input.rowsLimit, offset: input.rowsOffset },
  };
}
