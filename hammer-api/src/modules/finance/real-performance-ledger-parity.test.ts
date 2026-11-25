import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { computeRealPerformance } from "@/modules/finance/service";
import { getExpenseLedger } from "@/modules/finance/expense-ledger";

/**
 * prompt-gastos-semana-quincena.md Fase 2.2 — "Refactor obligatorio:
 * computeRealPerformance pasa a sumar desde el libro." Esta es la prueba
 * que lo confirma: con datos fake de TODAS las fuentes (caja, banco,
 * retenido, comisión de tarjeta, planilla), el total de gastos reales de
 * computeRealPerformance tiene que ser EXACTAMENTE la suma de las filas que
 * getExpenseLedger devuelve para el mismo período — porque ahora es
 * literalmente la misma consulta, no dos que podrían desincronizarse.
 */
function decimal(value: number) {
  return new Prisma.Decimal(value);
}

const BRANCH_1 = { id: "branch-1", code: "MSY", name: "Masaya" };
const START = new Date("2026-10-01T06:00:00Z");
const END = new Date("2026-11-01T06:00:00Z");

function buildFakeDb(extraCash: Array<{ id: string; amount: number; category: string }> = []) {
  const cashMovements = [
    ...extraCash.map((e) => ({
      id: e.id, amount: decimal(e.amount), createdAt: new Date("2026-10-09T12:00:00Z"), reason: e.category,
      createdByUserId: "user-1", approvedByUserId: null,
      cashSession: { physicalCashBox: { branchId: "branch-1" } },
      operatingExpense: { category: e.category, description: e.category, payee: null, receiptNumber: null, conceptId: null, concept: null },
    })),
    {
      id: "cm-1", amount: decimal(300), createdAt: new Date("2026-10-06T12:00:00Z"), reason: "Limpieza",
      createdByUserId: "user-1", approvedByUserId: null,
      cashSession: { physicalCashBox: { branchId: "branch-1" } },
      operatingExpense: { category: "MAINTENANCE", description: "Limpieza", payee: null, receiptNumber: null, conceptId: null, concept: null },
    },
  ];
  const treasuryEntries = [
    {
      id: "te-1", amount: decimal(500), occurredAt: new Date("2026-10-07T12:00:00Z"),
      expensePaymentId: null, purchaseOrderId: null, entryType: "EXPENSE",
      counterpartyName: "Agua potable", reference: null, createdByUserId: "user-1",
      account: { branchId: "branch-1", type: "BANK" },
    },
    {
      id: "te-2", amount: decimal(85), occurredAt: new Date("2026-10-08T12:00:00Z"),
      expensePaymentId: null, purchaseOrderId: null, entryType: "CARD_FEE",
      counterpartyName: null, reference: null, createdByUserId: "user-1",
      account: { branchId: null, type: "BANK" },
    },
  ];
  const payrollDisbursements = [
    {
      id: "pd-1", amount: decimal(5000), paidAt: new Date("2026-10-15T12:00:00Z"), branchId: "branch-1", paidByUserId: "user-1",
      employee: { fullName: "Juan Gómez" },
      payrollLine: { netPay: decimal(10000), employerCost: decimal(13500) },
    },
  ];

  const db = {
    branch: { findMany: async () => [BRANCH_1] },
    user: { findMany: async () => [{ id: "user-1", fullName: "Ana Pérez" }] },
    cashMovement: { findMany: async () => cashMovements },
    treasuryEntry: {
      findMany: async () => treasuryEntries,
      aggregate: async () => ({ _sum: { amount: null } }),
    },
    operatingExpense: { findMany: async () => [] },
    payrollDisbursement: { findMany: async () => payrollDisbursements },
    payrollRun: { findMany: async () => [] },
    payment: { findMany: async () => [] },
    refund: { findMany: async () => [] },
    inventoryMovement: { findMany: async () => [] },
    purchaseOrder: { findMany: async () => [] },
    cashSession: {
      findMany: async () => [
        { id: "cs-1", closedAt: new Date("2026-10-20T23:00:00Z"), differenceAmount: decimal(120), physicalCashBox: { code: "CAJA-1", branchId: "branch-1" }, closedBy: { fullName: "Ana Pérez", username: "ana" } },
        { id: "cs-2", closedAt: new Date("2026-10-21T23:00:00Z"), differenceAmount: decimal(-50), physicalCashBox: { code: "CAJA-1", branchId: "branch-1" }, closedBy: { fullName: "Ana Pérez", username: "ana" } },
      ],
    },
  };

  return db as never;
}

test("LA QUE IMPORTA — computeRealPerformance.operatingExpenses === suma del libro (misma fuente, no dos números distintos)", async () => {
  const db = buildFakeDb();

  const ledger = await getExpenseLedger({ start: START, end: END, branchId: null, basis: "PAID" }, db);
  const ledgerTotal = ledger.rows.reduce((sum, row) => sum + row.amount, 0);

  const performance = await computeRealPerformance(null, START, END, { monthlyTotal: 0 }, db);

  // 300 (caja) + 500 (banco) + 85 (comisión tarjeta, línea propia cardFees)
  // + 5000*(13500/10000)=6750 (planilla a costo empresa) = 7635.
  assert.ok(Math.abs(ledgerTotal - 7635) < 0.01, "sanity check del fixture");
  assert.ok(Math.abs(performance.operatingExpenses - ledgerTotal) < 0.01, "computeRealPerformance debe sumar EXACTAMENTE lo mismo que el libro");
});

test("sobrante de caja: entra como ingreso aparte — no toca gastos, sí la utilidad", async () => {
  const performance = await computeRealPerformance(null, START, END, { monthlyTotal: 0 }, buildFakeDb());
  assert.equal(performance.cashOverages, 120);
  assert.equal(performance.cashOverageItems.length, 1);
  assert.equal(performance.cashOverageItems[0].branchCode, "MSY");
  assert.ok(Math.abs(performance.operatingProfit - (performance.grossProfit - performance.operatingExpenses + 120 - 50)) < 0.01);
  assert.equal(performance.byBranch[0].cashOverages, 120);
});

test("faltante de caja: resta a la utilidad, en positivo y con su caja para revisar", async () => {
  const performance = await computeRealPerformance(null, START, END, { monthlyTotal: 0 }, buildFakeDb());
  assert.equal(performance.cashShortages, 50);
  assert.equal(performance.cashShortageItems[0].amount, 50);
  assert.equal(performance.byBranch[0].cashShortages, 50);
});

test("comisión de tarjeta: línea propia y, sin sucursal, en la fila Central — las sucursales + Central suman el total", async () => {
  const performance = await computeRealPerformance(null, START, END, { monthlyTotal: 0 }, buildFakeDb());
  assert.equal(performance.cardFees, 85);
  assert.equal(performance.bankExpenses, 500);
  assert.equal(performance.central.cardFees, 85);
  const branchesPlusCentral = performance.byBranch.reduce((s, b) => s + b.operatingExpenses, 0) + performance.central.operatingExpenses;
  assert.ok(Math.abs(branchesPlusCentral - performance.operatingExpenses) < 0.01);
});

test("equipo y gastos personales del dueño: salen en el libro, pero NO restan de la utilidad operativa", async () => {
  const db = buildFakeDb([{ id: "cm-eq", amount: 1000, category: "EQUIPMENT" }, { id: "cm-own", amount: 310, category: "OWNER_PERSONAL" }]);
  const ledger = await getExpenseLedger({ start: START, end: END, branchId: null, basis: "PAID" }, db);
  const ledgerTotal = ledger.rows.reduce((sum, row) => sum + row.amount, 0);
  const performance = await computeRealPerformance(null, START, END, { monthlyTotal: 0 }, db);
  assert.deepEqual(performance.outsideOperation, { equipment: 1000, ownerPersonal: 310, total: 1310 });
  assert.ok(Math.abs(performance.operatingExpenses - 7635) < 0.01, "el gasto operativo no cambia");
  assert.ok(Math.abs(performance.operatingExpenses + performance.outsideOperation.total - ledgerTotal) < 0.01, "operativo + fuera de la operación = todo el libro");
});
