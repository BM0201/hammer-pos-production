import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { fetchTreasuryExpenseEntries } from "@/modules/finance/service";

/**
 * prompt-tesoreria-cerrar-circuito.md H-2/H-3 — computeRealPerformance/
 * getFinanceTrend solo veían CashMovement EXPENSE_OUT (gaveta abierta); un
 * pago desde cuenta bancaria o un gasto pagado con efectivo retenido bajaban
 * el saldo de tesorería sin bajar nunca la utilidad. fetchTreasuryExpenseEntries
 * es la pieza que cierra ese hueco — con un `db` inyectable (default: el
 * singleton `prisma`) para poder probarla con un fake sin base de datos real,
 * mismo patrón que production/service.ts::getInputWacTx de esta misma sesión.
 */

function createFakeDb(fixtures: {
  entries: Array<{
    amount: number;
    occurredAt: Date;
    expensePaymentId: string | null;
    branchId: string | null;
    accountType: "BANK" | "SAFE";
  }>;
  expenses?: Array<{ id: string; category: string; isActive: boolean }>;
}) {
  const db = {
    treasuryEntry: {
      findMany: async () =>
        fixtures.entries.map((e) => ({
          amount: new Prisma.Decimal(e.amount),
          occurredAt: e.occurredAt,
          expensePaymentId: e.expensePaymentId,
          account: { branchId: e.branchId, type: e.accountType },
        })),
    },
    operatingExpense: {
      findMany: async () => fixtures.expenses ?? [],
    },
  };
  return db as unknown as Prisma.TransactionClient;
}

const D = (isoDay: string) => new Date(`${isoDay}T12:00:00Z`);
const RANGE = { start: new Date("2026-09-01T06:00:00Z"), end: new Date("2026-10-01T06:00:00Z") };

test("un pago desde cuenta bancaria (sin expensePaymentId) cuenta como BANK", async () => {
  const db = createFakeDb({
    entries: [{ amount: 500, occurredAt: D("2026-09-10"), expensePaymentId: null, branchId: "branch-1", accountType: "BANK" }],
  });
  const result = await fetchTreasuryExpenseEntries("branch-1", RANGE.start, RANGE.end, db);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "BANK");
  assert.equal(result[0].amount, 500);
  assert.equal(result[0].branchId, "branch-1");
});

test("un gasto pagado con efectivo retenido (cuenta SAFE) cuenta como RETAINED_CASH", async () => {
  const db = createFakeDb({
    entries: [{ amount: 300, occurredAt: D("2026-09-10"), expensePaymentId: "exp-1", branchId: "branch-1", accountType: "SAFE" }],
    expenses: [{ id: "exp-1", category: "UTILITIES", isActive: true }],
  });
  const result = await fetchTreasuryExpenseEntries("branch-1", RANGE.start, RANGE.end, db);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "RETAINED_CASH");
  assert.equal(result[0].amount, 300);
});

test("LA QUE IMPORTA — un gasto de categoría PAYROLL pagado por banco/retenido NO cuenta (entra por su línea propia a costo empresa)", async () => {
  const db = createFakeDb({
    entries: [{ amount: 1000, occurredAt: D("2026-09-10"), expensePaymentId: "exp-payroll", branchId: "branch-1", accountType: "BANK" }],
    expenses: [{ id: "exp-payroll", category: "PAYROLL", isActive: true }],
  });
  const result = await fetchTreasuryExpenseEntries("branch-1", RANGE.start, RANGE.end, db);
  assert.equal(result.length, 0, "PAYROLL se excluye para no doble-contarla contra payrollPaid");
});

test("LA QUE IMPORTA — un gasto de efectivo retenido ANULADO (OperatingExpense.isActive=false) NO cuenta", async () => {
  const db = createFakeDb({
    entries: [{ amount: 700, occurredAt: D("2026-09-10"), expensePaymentId: "exp-voided", branchId: "branch-1", accountType: "SAFE" }],
    expenses: [{ id: "exp-voided", category: "UTILITIES", isActive: false }],
  });
  const result = await fetchTreasuryExpenseEntries("branch-1", RANGE.start, RANGE.end, db);
  assert.equal(result.length, 0, "voidRetainedCashExpense apaga isActive — un gasto anulado no debe seguir bajando la utilidad");
});

test("un OperatingExpense huérfano (expensePaymentId sin fila encontrada) se deja pasar — no se inventa una exclusión sin evidencia", async () => {
  const db = createFakeDb({
    entries: [{ amount: 400, occurredAt: D("2026-09-10"), expensePaymentId: "exp-missing", branchId: "branch-1", accountType: "BANK" }],
    expenses: [],
  });
  const result = await fetchTreasuryExpenseEntries("branch-1", RANGE.start, RANGE.end, db);
  assert.equal(result.length, 1);
});

test("una cuenta bancaria central (branchId null) se deja sin atribuir a ninguna sucursal, pero sí cuenta", async () => {
  const db = createFakeDb({
    entries: [{ amount: 250, occurredAt: D("2026-09-10"), expensePaymentId: null, branchId: null, accountType: "BANK" }],
  });
  const result = await fetchTreasuryExpenseEntries(null, RANGE.start, RANGE.end, db);
  assert.equal(result.length, 1);
  assert.equal(result[0].branchId, null);
  assert.equal(result[0].amount, 250);
});

test("varios gastos: banco, retenido, planilla excluida y anulado excluido — solo pasan los dos primeros", async () => {
  const db = createFakeDb({
    entries: [
      { amount: 100, occurredAt: D("2026-09-05"), expensePaymentId: null, branchId: "branch-1", accountType: "BANK" },
      { amount: 200, occurredAt: D("2026-09-06"), expensePaymentId: "exp-ok", branchId: "branch-1", accountType: "SAFE" },
      { amount: 900, occurredAt: D("2026-09-07"), expensePaymentId: "exp-payroll", branchId: "branch-1", accountType: "BANK" },
      { amount: 300, occurredAt: D("2026-09-08"), expensePaymentId: "exp-voided", branchId: "branch-1", accountType: "SAFE" },
    ],
    expenses: [
      { id: "exp-ok", category: "UTILITIES", isActive: true },
      { id: "exp-payroll", category: "PAYROLL", isActive: true },
      { id: "exp-voided", category: "MAINTENANCE", isActive: false },
    ],
  });
  const result = await fetchTreasuryExpenseEntries("branch-1", RANGE.start, RANGE.end, db);
  assert.equal(result.length, 2);
  assert.equal(result.reduce((s, e) => s + e.amount, 0), 300, "100 (banco) + 200 (retenido) = 300 — planilla y anulado quedan fuera");
});
