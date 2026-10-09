/**
 * prompt-gastos-semana-quincena.md Fase 3 — tipos del frontend que reflejan
 * ExpensePeriodReport (hammer-api/src/modules/finance/expense-period-report.ts).
 * GET /api/master/finance/expenses/period.
 */
import { CATEGORY_LABELS } from "@/components/expenses/expense-manager.types";

export type PeriodKind = "DAY" | "WEEK" | "QUINCENA" | "MONTH" | "CUSTOM";
export type ExpensePeriodBasis = "PAID" | "ACCRUED";
export type ExpenseLedgerSource = "CAJA" | "EFECTIVO_RETENIDO" | "BANCO" | "COMISION_TARJETA" | "PLANILLA" | "DEVENGADO";

export type PeriodRange = { start: string; end: string; label: string };
export type ResolvedPeriod = PeriodRange & { kind: PeriodKind; previous: PeriodRange; next: PeriodRange };

export type ExpenseLedgerRow = {
  id: string;
  date: string;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  category: string;
  conceptId: string | null;
  conceptName: string | null;
  description: string;
  payee: string | null;
  receiptNumber: string | null;
  amount: number;
  source: ExpenseLedgerSource;
  registeredBy: string | null;
  approvedBy: string | null;
  reference: { type: string; id: string; href: string | null } | null;
  explanation?: string;
};

export type CategoryConcept = { conceptId: string | null; conceptName: string | null; total: number };
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

export type ExpensePeriodAlert = {
  code: string;
  message: string;
  category: string | null;
  href: string | null;
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

export type ExpenseConceptRow = { id: string; category: string; name: string; isActive: boolean; sortOrder: number };

export const SOURCE_LABELS: Record<ExpenseLedgerSource, string> = {
  CAJA: "Caja",
  EFECTIVO_RETENIDO: "Efectivo retenido",
  BANCO: "Banco",
  COMISION_TARJETA: "Comisión de tarjeta",
  PLANILLA: "Planilla",
  DEVENGADO: "Devengado (estimado)",
};

export const PERIOD_KIND_LABELS: Record<PeriodKind, string> = {
  DAY: "Día",
  WEEK: "Semana",
  QUINCENA: "Quincena",
  MONTH: "Mes",
  CUSTOM: "Rango",
};

/**
 * CATEGORY_LABELS (expense-manager.types.ts) solo cubre las categorías
 * REALES del enum ExpenseCategory — a propósito, porque alimenta el
 * selector de "crear gasto" (nunca se debe poder elegir "Sin clasificar"
 * ahí). El libro único sí puede traer esa categoría de respaldo
 * (getExpenseLedger la usa cuando un gasto no tiene OperatingExpense
 * vinculado) — esta función es solo para MOSTRARLA, nunca para armar un
 * selector de categorías.
 */
export function ledgerCategoryLabel(category: string): string {
  if (category === "UNCLASSIFIED") return "Sin clasificar";
  return CATEGORY_LABELS[category] ?? category;
}
