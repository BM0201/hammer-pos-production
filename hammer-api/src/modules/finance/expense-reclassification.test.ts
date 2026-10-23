import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { reclassifyExpenseCategory, convertExpenseToCashPurchase } from "@/modules/finance/expense-reclassification";

function decimal(value: number) {
  return new Prisma.Decimal(value);
}

function buildFakeDb(opts: {
  expense: Record<string, unknown>;
  movement?: Record<string, unknown>;
  concepts?: Array<{ id: string; category: string }>;
}) {
  const expenses = new Map<string, Record<string, unknown>>([[opts.expense.id as string, { ...opts.expense }]]);
  const movements = new Map<string, Record<string, unknown>>(opts.movement ? [[opts.movement.id as string, { ...opts.movement }]] : []);
  const purchases: Array<Record<string, unknown>> = [];
  const auditLogs: Array<Record<string, unknown>> = [];
  const concepts = opts.concepts ?? [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    operatingExpense: {
      findUnique: async ({ where }: { where: { id: string } }) => (expenses.has(where.id) ? { ...expenses.get(where.id) } : null),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = expenses.get(where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return { ...row };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const row = expenses.get(where.id);
        expenses.delete(where.id);
        return row;
      },
    },
    expenseConcept: {
      findUnique: async ({ where }: { where: { id: string } }) => concepts.find((c) => c.id === where.id) ?? null,
    },
    cashMovement: {
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = movements.get(where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return { ...row };
      },
    },
    cashPurchase: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `purchase-${purchases.length + 1}`, ...data };
        purchases.push(row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => { auditLogs.push(data); return data; },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };

  return { db, getExpenses: () => [...expenses.values()], getMovements: () => [...movements.values()], getPurchases: () => purchases, getAuditLogs: () => auditLogs };
}

test("reclassifyExpenseCategory cambia solo category/conceptId, nunca monto/fecha/cashMovementId", async () => {
  const { db, getExpenses, getAuditLogs } = buildFakeDb({
    expense: { id: "exp-1", branchId: "branch-1", category: "OTHER", description: "arena", amount: decimal(5640), effectiveFrom: new Date("2026-10-08"), cashMovementId: "mv-1", conceptId: null, receiptPhotoUrl: null },
  });

  const result = await reclassifyExpenseCategory("exp-1", { category: "SUPPLIES", conceptId: null }, "user-1", db);

  assert.equal(result.category, "SUPPLIES");
  const stored = getExpenses()[0];
  assert.equal(stored.amount.toString(), "5640");
  assert.equal(stored.cashMovementId, "mv-1");
  assert.deepEqual((stored.effectiveFrom as Date).toISOString(), new Date("2026-10-08").toISOString());
  assert.equal(getAuditLogs()[0].action, "EXPENSE_RECLASSIFIED");
});

test("reclassifyExpenseCategory rechaza un concepto que no corresponde a la categoría nueva", async () => {
  const { db } = buildFakeDb({
    expense: { id: "exp-1", branchId: "branch-1", category: "OTHER", description: "x", amount: decimal(100), effectiveFrom: new Date(), cashMovementId: null, conceptId: null, receiptPhotoUrl: null },
    concepts: [{ id: "concept-transport", category: "TRANSPORT" }],
  });

  await assert.rejects(
    () => reclassifyExpenseCategory("exp-1", { category: "SUPPLIES", conceptId: "concept-transport" }, "user-1", db),
    /el concepto no corresponde/,
  );
});

test("convertExpenseToCashPurchase crea CashPurchase, borra el OperatingExpense y pasa el movimiento a PURCHASE_OUT", async () => {
  const { db, getExpenses, getMovements, getPurchases, getAuditLogs } = buildFakeDb({
    expense: { id: "exp-1", branchId: "branch-1", category: "OTHER", description: "arena (12 metros)", amount: decimal(5640), effectiveFrom: new Date(), cashMovementId: "mv-1", conceptId: null, receiptPhotoUrl: null },
    movement: { id: "mv-1", type: "EXPENSE_OUT", amount: decimal(5640) },
  });

  const purchase = await convertExpenseToCashPurchase("exp-1", { kind: "GOODS", supplierName: "Ferretería X" }, "user-1", db);

  assert.equal(purchase.amount.toString(), "5640");
  assert.equal(getExpenses().length, 0, "el OperatingExpense debe desaparecer — ya no cuenta como gasto operativo");
  assert.equal(getMovements()[0].type, "PURCHASE_OUT");
  assert.equal(getPurchases().length, 1);
  assert.equal(getAuditLogs()[0].action, "EXPENSE_CONVERTED_TO_CASH_PURCHASE");
});

test("convertExpenseToCashPurchase rechaza un gasto sin movimiento de caja vinculado", async () => {
  const { db } = buildFakeDb({
    expense: { id: "exp-1", branchId: "branch-1", category: "OTHER", description: "x", amount: decimal(100), effectiveFrom: new Date(), cashMovementId: null, conceptId: null, receiptPhotoUrl: null },
  });

  await assert.rejects(
    () => convertExpenseToCashPurchase("exp-1", { kind: "GOODS" }, "user-1", db),
    /no está ligado a un movimiento de caja/,
  );
});
