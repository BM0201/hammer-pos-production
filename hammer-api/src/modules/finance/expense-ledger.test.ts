import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { getExpenseLedger } from "@/modules/finance/expense-ledger";

/**
 * prompt-gastos-semana-quincena.md Fase 2.2/2.3 — libro único de gastos.
 * Fake-db en memoria cubriendo las 3 fuentes (caja, tesorería, planilla) +
 * el modo ACCRUED (planilla y recurrentes prorrateados por días).
 */
function decimal(value: number) {
  return new Prisma.Decimal(value);
}

const BRANCH_1 = { id: "branch-1", code: "MSY", name: "Masaya" };
const USER_1 = { id: "user-1", fullName: "Ana Pérez" };

function buildFakeDb(opts: {
  cashMovements?: Array<Record<string, unknown>>;
  treasuryEntries?: Array<Record<string, unknown>>;
  operatingExpenses?: Array<Record<string, unknown>>;
  payrollDisbursements?: Array<Record<string, unknown>>;
  payrollRuns?: Array<Record<string, unknown>>;
}) {
  const operatingExpenses = opts.operatingExpenses ?? [];

  return {
    branch: { findMany: async () => [BRANCH_1] },
    user: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => [USER_1].filter((u) => where.id.in.includes(u.id)) },
    cashMovement: {
      findMany: async () => opts.cashMovements ?? [],
    },
    treasuryEntry: {
      findMany: async () => opts.treasuryEntries ?? [],
    },
    operatingExpense: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.id && typeof where.id === "object" && "in" in (where.id as object)) {
          const ids = (where.id as { in: string[] }).in;
          return operatingExpenses.filter((e) => ids.includes(e.id as string));
        }
        // Consulta de RECURRING (accrueRecurring)
        return operatingExpenses.filter((e) => e.kind === "RECURRING" && e.isActive !== false);
      },
    },
    payrollDisbursement: { findMany: async () => opts.payrollDisbursements ?? [] },
    payrollRun: { findMany: async () => opts.payrollRuns ?? [] },
  } as never;
}

test("getExpenseLedger — PAID: una fila de CAJA con OperatingExpense vinculado, normalizada", async () => {
  const db = buildFakeDb({
    cashMovements: [
      {
        id: "cm-1", amount: decimal(300), createdAt: new Date("2026-10-06T12:00:00Z"), reason: "Limpieza",
        createdByUserId: "user-1", approvedByUserId: null,
        cashSession: { physicalCashBox: { branchId: "branch-1" } },
        operatingExpense: { category: "MAINTENANCE", description: "Limpieza de local", payee: "Doña Rosa", receiptNumber: "R-001", conceptId: "c-1", concept: { name: "Limpieza" } },
      },
    ],
  });

  const { rows } = await getExpenseLedger({ start: new Date("2026-10-01T06:00:00Z"), end: new Date("2026-11-01T06:00:00Z"), branchId: null, basis: "PAID" }, db);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "CAJA");
  assert.equal(rows[0].category, "MAINTENANCE");
  assert.equal(rows[0].conceptName, "Limpieza");
  assert.equal(rows[0].payee, "Doña Rosa");
  assert.equal(rows[0].receiptNumber, "R-001");
  assert.equal(rows[0].amount, 300);
  assert.equal(rows[0].registeredBy, "Ana Pérez");
  assert.equal(rows[0].branchCode, "MSY");
});

test("getExpenseLedger — un EXPENSE_OUT sin OperatingExpense vinculado: categoría 'Sin clasificar'", async () => {
  const db = buildFakeDb({
    cashMovements: [
      {
        id: "cm-2", amount: decimal(150), createdAt: new Date("2026-10-06T12:00:00Z"), reason: "Gasto sin registrar",
        createdByUserId: "user-1", approvedByUserId: null,
        cashSession: { physicalCashBox: { branchId: "branch-1" } },
        operatingExpense: null,
      },
    ],
  });

  const { rows } = await getExpenseLedger({ start: new Date("2026-10-01T06:00:00Z"), end: new Date("2026-11-01T06:00:00Z"), branchId: null, basis: "PAID" }, db);

  assert.equal(rows[0].category, "UNCLASSIFIED");
  assert.equal(rows[0].description, "Gasto sin registrar");
});

test("getExpenseLedger — PAID: fila de TESORERÍA (banco) con comisión de tarjeta identificada por su propia fuente", async () => {
  const db = buildFakeDb({
    treasuryEntries: [
      {
        id: "te-1", amount: decimal(85), occurredAt: new Date("2026-10-06T12:00:00Z"),
        expensePaymentId: null, purchaseOrderId: null, entryType: "CARD_FEE",
        counterpartyName: "Adquirente", reference: null, createdByUserId: "user-1",
        account: { branchId: null, type: "BANK" },
      },
      {
        id: "te-2", amount: decimal(500), occurredAt: new Date("2026-10-07T12:00:00Z"),
        expensePaymentId: null, purchaseOrderId: null, entryType: "EXPENSE",
        counterpartyName: null, reference: "pago agua", createdByUserId: "user-1",
        account: { branchId: "branch-1", type: "SAFE" },
      },
    ],
  });

  const { rows } = await getExpenseLedger({ start: new Date("2026-10-01T06:00:00Z"), end: new Date("2026-11-01T06:00:00Z"), branchId: null, basis: "PAID" }, db);

  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.id === "te-1")?.source, "COMISION_TARJETA");
  assert.equal(rows.find((r) => r.id === "te-2")?.source, "EFECTIVO_RETENIDO");
});

test("getExpenseLedger — PAID: un pago ligado a una orden de compra NO entra al libro", async () => {
  const db = buildFakeDb({
    treasuryEntries: [
      {
        id: "te-po", amount: decimal(9999), occurredAt: new Date("2026-10-06T12:00:00Z"),
        expensePaymentId: null, purchaseOrderId: "po-1", entryType: "SUPPLIER_PAYMENT",
        counterpartyName: "Proveedor X", reference: null, createdByUserId: "user-1",
        account: { branchId: "branch-1", type: "BANK" },
      },
    ],
  });

  const { rows } = await getExpenseLedger({ start: new Date("2026-10-01T06:00:00Z"), end: new Date("2026-11-01T06:00:00Z"), branchId: null, basis: "PAID" }, db);
  assert.equal(rows.length, 0);
});

test("getExpenseLedger — PAID: fila de PLANILLA a costo empresa (no al neto pagado)", async () => {
  const db = buildFakeDb({
    payrollDisbursements: [
      {
        id: "pd-1", amount: decimal(5000), paidAt: new Date("2026-10-15T12:00:00Z"), branchId: "branch-1", paidByUserId: "user-1",
        employee: { fullName: "Juan Gómez" },
        payrollLine: { netPay: decimal(10000), employerCost: decimal(13500) },
      },
    ],
  });

  const { rows } = await getExpenseLedger({ start: new Date("2026-10-01T06:00:00Z"), end: new Date("2026-11-01T06:00:00Z"), branchId: null, basis: "PAID" }, db);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "PLANILLA");
  // 5000 * (13500/10000) = 6750 — escalado a costo empresa, no el neto de la mitad.
  assert.equal(rows[0].amount, 6750);
});

test("LA QUE IMPORTA — ACCRUED: planilla POSTED del mes se prorratea por días del período, no por desembolso", async () => {
  const db = buildFakeDb({
    payrollRuns: [{ id: "run-1", branchId: "branch-1", totalEmployerCost: decimal(31000) }],
  });

  // Quincena 1-15 de un mes de 31 días → 15/31 del costo total.
  const { rows } = await getExpenseLedger({ start: new Date("2026-10-01T06:00:00Z"), end: new Date("2026-10-16T06:00:00Z"), branchId: null, basis: "ACCRUED" }, db);

  const payrollRow = rows.find((r) => r.source === "DEVENGADO" && r.category === "PAYROLL");
  assert.ok(payrollRow);
  assert.ok(Math.abs(payrollRow!.amount - 31000 * (15 / 31)) < 0.01);
});

test("LA QUE IMPORTA — ACCRUED: un RECURRING se prorratea SOLO si no hay un PAID de la misma categoría+concepto en el período", async () => {
  const db = buildFakeDb({
    operatingExpenses: [
      { id: "oe-rent", kind: "RECURRING", isActive: true, branchId: "branch-1", category: "RENT", description: "Alquiler local", amount: decimal(15500), conceptId: null, concept: null },
    ],
  });

  // 1-15 de un mes de 31 días → 15/31 del alquiler mensual.
  const { rows } = await getExpenseLedger({ start: new Date("2026-10-01T06:00:00Z"), end: new Date("2026-10-16T06:00:00Z"), branchId: null, basis: "ACCRUED" }, db);

  const rentRow = rows.find((r) => r.category === "RENT");
  assert.ok(rentRow);
  assert.equal(rentRow!.source, "DEVENGADO");
  assert.ok(Math.abs(rentRow!.amount - 15500 * (15 / 31)) < 0.01);
  assert.match(rentRow!.explanation ?? "", /15\/31/);
});

test("LA QUE IMPORTA — ACCRUED: si YA hay un pago real (misma categoría+concepto) en el período, NO se duplica con el prorrateo", async () => {
  const db = buildFakeDb({
    operatingExpenses: [
      { id: "oe-rent", kind: "RECURRING", isActive: true, branchId: "branch-1", category: "RENT", description: "Alquiler local", amount: decimal(15500), conceptId: null, concept: null },
    ],
    cashMovements: [
      {
        id: "cm-rent-paid", amount: decimal(15500), createdAt: new Date("2026-10-03T12:00:00Z"), reason: "Pago alquiler",
        createdByUserId: "user-1", approvedByUserId: null,
        cashSession: { physicalCashBox: { branchId: "branch-1" } },
        operatingExpense: { category: "RENT", description: "Alquiler local pagado", payee: "Arrendador", receiptNumber: null, conceptId: null, concept: null },
      },
    ],
  });

  const { rows } = await getExpenseLedger({ start: new Date("2026-10-01T06:00:00Z"), end: new Date("2026-10-16T06:00:00Z"), branchId: null, basis: "ACCRUED" }, db);

  const rentRows = rows.filter((r) => r.category === "RENT");
  assert.equal(rentRows.length, 1, "solo la fila pagada — el prorrateo se salta porque ya hay un PAID de RENT en el período");
  assert.equal(rentRows[0].source, "CAJA");
});
