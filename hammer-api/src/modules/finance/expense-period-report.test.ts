import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { getExpensePeriodReport } from "@/modules/finance/expense-period-report";

/**
 * prompt-gastos-semana-quincena.md Fase 2.4 — GET .../expenses/period.
 * Fake-db en memoria que SÍ respeta las ventanas de fecha de cada
 * `where` (a diferencia de los fakes más simples de Fase 2.2/2.3): este
 * reporte dispara la MISMA consulta varias veces con rangos distintos
 * (período actual + 4 anteriores para la comparación), así que si el
 * fake ignorara la fecha, "el período anterior" devolvería los mismos
 * datos que el actual y todas las comparaciones saldrían en cero.
 */
function decimal(value: number) {
  return new Prisma.Decimal(value);
}

const BRANCH_1 = { id: "branch-1", code: "MSY", name: "Masaya" };
const USER_1 = { id: "user-1", fullName: "Ana Pérez" };

type Row = Record<string, unknown> & { createdAt?: Date; occurredAt?: Date; paidAt?: Date; scheduledDate?: Date; tripDate?: Date };

function inWindow(row: Row, field: string, gte: Date, lt: Date): boolean {
  const value = row[field] as Date | undefined;
  if (!value) return false;
  return value.getTime() >= gte.getTime() && value.getTime() < lt.getTime();
}

function buildFakeDb(opts: {
  cashMovements?: Row[];
  treasuryEntries?: Row[];
  operatingExpenses?: Row[];
  payrollDisbursements?: Row[];
  payrollRuns?: Row[];
  payrollLines?: Row[];
  cashOutMovements?: Row[];
  pendingPayroll?: number;
  internalFreightTotal?: number;
}) {
  const operatingExpenses = opts.operatingExpenses ?? [];

  return {
    branch: { findMany: async () => [BRANCH_1] },
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => [USER_1].filter((u) => where.id.in.includes(u.id)),
    },
    cashMovement: {
      findMany: async ({ where }: { where: { createdAt: { gte: Date; lt: Date } } }) =>
        (opts.cashMovements ?? []).filter((m) => inWindow(m, "createdAt", where.createdAt.gte, where.createdAt.lt)),
      aggregate: async ({ where }: { where: { createdAt: { gte: Date; lt: Date } } }) => {
        const matches = (opts.cashOutMovements ?? []).filter((m) => inWindow(m, "createdAt", where.createdAt.gte, where.createdAt.lt));
        const sum = matches.reduce((s, m) => s + Number(m.amount), 0);
        return { _sum: { amount: matches.length > 0 ? decimal(sum) : null }, _count: matches.length };
      },
    },
    treasuryEntry: {
      findMany: async ({ where }: { where: { occurredAt: { gte: Date; lt: Date } } }) =>
        (opts.treasuryEntries ?? []).filter((e) => inWindow(e, "occurredAt", where.occurredAt.gte, where.occurredAt.lt)),
      aggregate: async () => ({ _sum: { amount: null } }),
    },
    operatingExpense: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.id && typeof where.id === "object" && "in" in (where.id as object)) {
          const ids = (where.id as { in: string[] }).in;
          return operatingExpenses.filter((e) => ids.includes(e.id as string));
        }
        if (where.kind === "RECURRING") {
          return operatingExpenses.filter((e) => e.kind === "RECURRING" && e.isActive !== false);
        }
        // Historial para detección de atípicos (fetchOutlierStats): sin uso en estos tests.
        return [];
      },
    },
    payrollDisbursement: {
      // getExpenseLedger (loadPayrollPaidRows) filtra por `paidAt` (cuándo salió la plata);
      // fetchPayrollBlock filtra por `scheduledDate` (la fecha OFICIAL de pago, la quincena
      // calendario) — a propósito son filtros distintos, el fake respeta el que venga.
      findMany: async ({ where }: { where: { scheduledDate?: { gte: Date; lt: Date }; paidAt?: { gte: Date; lt: Date }; status: string } }) => {
        if (where.status !== "PAID") return [];
        const field = where.scheduledDate ? "scheduledDate" : "paidAt";
        const range = where.scheduledDate ?? where.paidAt!;
        return (opts.payrollDisbursements ?? []).filter((d) => inWindow(d, field, range.gte, range.lt));
      },
      aggregate: async ({ where }: { where: { scheduledDate: { gte: Date; lt: Date } } }) => {
        const pending = opts.pendingPayroll ?? 0;
        // Simplificación: el pendiente del fixture se asume dentro del período que se está probando.
        void where;
        return { _sum: { amount: pending > 0 ? decimal(pending) : null } };
      },
    },
    payrollLine: { findMany: async () => opts.payrollLines ?? [] },
    payrollRun: { findMany: async () => opts.payrollRuns ?? [] },
    internalFreightTrip: { aggregate: async () => ({ _sum: { totalTripCost: decimal(opts.internalFreightTotal ?? 0) } }) },
    payment: { findMany: async () => [] },
    refund: { findMany: async () => [] },
    inventoryMovement: { findMany: async () => [] },
    purchaseOrder: { findMany: async () => [] },
  } as never;
}

function cashExpense(opts: { id: string; amount: number; createdAt: Date; category: string; conceptId?: string | null; receiptNumber?: string | null }) {
  return {
    id: opts.id, amount: decimal(opts.amount), createdAt: opts.createdAt, reason: opts.category,
    createdByUserId: "user-1", approvedByUserId: null,
    cashSession: { physicalCashBox: { branchId: "branch-1" } },
    operatingExpense: {
      category: opts.category, description: opts.category, payee: null,
      receiptNumber: opts.receiptNumber ?? "R-1", conceptId: opts.conceptId ?? null, concept: null,
    },
  };
}

test("Fase 2.4 — alquiler: PAID muestra el pago real, ACCRUED lo prorratea, y el presupuesto se calcula igual en ambos", async () => {
  const rent = { id: "oe-rent", kind: "RECURRING", isActive: true, branchId: "branch-1", category: "RENT", description: "Alquiler", amount: decimal(31000), conceptId: null, concept: null };

  const dbPaid = buildFakeDb({
    operatingExpenses: [rent],
    cashMovements: [cashExpense({ id: "cm-rent", amount: 31000, createdAt: new Date("2026-10-05T12:00:00Z"), category: "RENT" })],
  });
  const paidReport = await getExpensePeriodReport(
    { kind: "MONTH", anchorDate: new Date("2026-10-10T12:00:00Z"), branchId: "branch-1", basis: "PAID", rowsLimit: 50, rowsOffset: 0 },
    dbPaid,
  );
  const rentPaid = paidReport.byCategory.find((c) => c.category === "RENT");
  assert.ok(rentPaid);
  assert.equal(rentPaid!.total, 31000, "octubre tiene 31 días: el presupuesto prorrateado es el monto completo");
  assert.equal(rentPaid!.budgetProrated, 31000);
  assert.equal(rentPaid!.budgetExecutedPercent, 100);

  const dbAccrued = buildFakeDb({ operatingExpenses: [rent] });
  const accruedReport = await getExpensePeriodReport(
    { kind: "MONTH", anchorDate: new Date("2026-10-10T12:00:00Z"), branchId: "branch-1", basis: "ACCRUED", rowsLimit: 50, rowsOffset: 0 },
    dbAccrued,
  );
  const rentAccrued = accruedReport.byCategory.find((c) => c.category === "RENT");
  assert.ok(rentAccrued);
  assert.equal(rentAccrued!.total, 31000, "sin ningún pago real, el devengado prorratea el mes completo (31/31 días)");
  assert.equal(rentAccrued!.budgetProrated, 31000, "el presupuesto es el mismo monto prorrateado en ambas bases — no depende de si ya se pagó");
});

test("Fase 2.4 — planilla: aparece en el bloque payroll cuando el período toca un día de pago", async () => {
  const db = buildFakeDb({
    payrollDisbursements: [{
      id: "pd-1", amount: decimal(5000), scheduledDate: new Date("2026-10-15T00:00:00Z"), paidAt: new Date("2026-10-15T12:00:00Z"),
      branchId: "branch-1", period: "FIRST_HALF", payrollLineId: "line-1", paidByUserId: "user-1",
      employee: { fullName: "Juan Gómez" },
      payrollLine: { netPay: decimal(5000), employerCost: decimal(6750) },
    }],
    payrollLines: [{ id: "line-1", inssPatronal: decimal(800), inatec: decimal(100), provisions: decimal(300) }],
  });
  const report = await getExpensePeriodReport(
    { kind: "QUINCENA", anchorDate: new Date("2026-10-10T12:00:00Z"), branchId: "branch-1", basis: "PAID", rowsLimit: 50, rowsOffset: 0 },
    db,
  );
  assert.ok(report.payroll);
  assert.equal(report.payroll!.netPaid, 5000);
  assert.equal(report.payroll!.inssPatronal, 800);
  assert.deepEqual(report.payroll!.halvesPaid, ["FIRST_HALF"]);
});

test("Fase 2.4 — payroll es null cuando el período no toca ningún día de pago", async () => {
  const db = buildFakeDb({});
  const report = await getExpensePeriodReport(
    { kind: "WEEK", anchorDate: new Date("2026-10-06T12:00:00Z"), branchId: "branch-1", basis: "PAID", rowsLimit: 50, rowsOffset: 0 },
    db,
  );
  assert.equal(report.payroll, null);
});

test("Fase 2.4 — comparación: el total del período anterior y el promedio de 4 no mezclan los datos del período actual", async () => {
  const db = buildFakeDb({
    cashMovements: [
      cashExpense({ id: "cm-oct", amount: 1000, createdAt: new Date("2026-10-05T12:00:00Z"), category: "UTILITIES" }),
      cashExpense({ id: "cm-sep", amount: 400, createdAt: new Date("2026-09-05T12:00:00Z"), category: "UTILITIES" }),
      cashExpense({ id: "cm-aug", amount: 300, createdAt: new Date("2026-08-05T12:00:00Z"), category: "UTILITIES" }),
    ],
  });
  const report = await getExpensePeriodReport(
    { kind: "MONTH", anchorDate: new Date("2026-10-10T12:00:00Z"), branchId: "branch-1", basis: "PAID", rowsLimit: 50, rowsOffset: 0 },
    db,
  );
  assert.equal(report.totals.expenseTotal, 1000, "octubre no debe incluir los gastos de septiembre/agosto");
  assert.equal(report.comparison.previousTotal, 400, "septiembre (el período anterior) es solo su propio gasto");
  // promedio de 4 períodos anteriores (sep,ago,jul,jun) = (400+300+0+0)/4 = 175.
  assert.equal(report.comparison.average4Total, 175);
});

test("Fase 2.4 — alertas: una categoría que se dispara vs su promedio aparece, una estable no", async () => {
  const db = buildFakeDb({
    cashMovements: [
      cashExpense({ id: "cm-cur", amount: 3000, createdAt: new Date("2026-10-05T12:00:00Z"), category: "MAINTENANCE" }),
      cashExpense({ id: "cm-prev1", amount: 500, createdAt: new Date("2026-09-05T12:00:00Z"), category: "MAINTENANCE" }),
      cashExpense({ id: "cm-prev2", amount: 500, createdAt: new Date("2026-08-05T12:00:00Z"), category: "MAINTENANCE" }),
      // FOOD se mantiene estable mes a mes — no debería generar alerta de categoría.
      cashExpense({ id: "cm-food-cur", amount: 1000, createdAt: new Date("2026-10-06T12:00:00Z"), category: "FOOD" }),
      cashExpense({ id: "cm-food-prev1", amount: 980, createdAt: new Date("2026-09-06T12:00:00Z"), category: "FOOD" }),
      cashExpense({ id: "cm-food-prev2", amount: 1020, createdAt: new Date("2026-08-06T12:00:00Z"), category: "FOOD" }),
    ],
  });
  const report = await getExpensePeriodReport(
    { kind: "MONTH", anchorDate: new Date("2026-10-10T12:00:00Z"), branchId: "branch-1", basis: "PAID", rowsLimit: 50, rowsOffset: 0 },
    db,
  );
  const swings = report.alerts.filter((a) => a.code === "CATEGORY_SWING");
  assert.ok(swings.some((a) => a.category === "MAINTENANCE"), "mantenimiento se disparó vs su promedio — debe alertar");
  assert.ok(!swings.some((a) => a.category === "FOOD"), "alimentación se mantuvo estable — no debe alertar");
});

test("Fase 2.4 — CASH_OUT sin clasificar: aparece en alertas y NO suma al total de gastos", async () => {
  const db = buildFakeDb({
    cashMovements: [cashExpense({ id: "cm-1", amount: 300, createdAt: new Date("2026-10-05T12:00:00Z"), category: "MAINTENANCE" })],
    cashOutMovements: [{ id: "co-1", amount: decimal(2000), createdAt: new Date("2026-10-06T12:00:00Z") }],
  });
  const report = await getExpensePeriodReport(
    { kind: "MONTH", anchorDate: new Date("2026-10-10T12:00:00Z"), branchId: "branch-1", basis: "PAID", rowsLimit: 50, rowsOffset: 0 },
    db,
  );
  assert.equal(report.totals.expenseTotal, 300, "el CASH_OUT genérico no es un gasto reconocido — no debe sumar al total");
  const cashOutAlert = report.alerts.find((a) => a.code === "UNCLASSIFIED_CASH_OUT");
  assert.ok(cashOutAlert, "debe avisar que hay un CASH_OUT sin clasificar en el período");
  assert.match(cashOutAlert!.message, /2,000\.00/);
});
