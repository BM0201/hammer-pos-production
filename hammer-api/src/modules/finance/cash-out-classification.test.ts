import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  classifyCashOutAsExpense,
  dismissCashOutAsNotExpense,
  listUnclassifiedCashOuts,
} from "@/modules/finance/cash-out-classification";
import { cashMovementsNetTotal } from "@/modules/cash-session/expected-cash";

function decimal(value: number) {
  return new Prisma.Decimal(value);
}

const BRANCH_1 = { id: "branch-1", code: "MSY", name: "Masaya" };

function buildFakeDb(movement: {
  id: string;
  type: string;
  amount: number;
  reason: string;
  createdAt: Date;
  reviewedAt?: Date | null;
  operatingExpense?: { id: string } | null;
  cashSessionId?: string;
}) {
  const rows = new Map<string, Record<string, unknown>>([
    [movement.id, {
      id: movement.id,
      type: movement.type,
      amount: decimal(movement.amount),
      reason: movement.reason,
      createdAt: movement.createdAt,
      reviewedAt: movement.reviewedAt ?? null,
      reviewedByUserId: null,
      reviewNote: null,
      cashSessionId: movement.cashSessionId ?? "session-1",
      operatingExpense: movement.operatingExpense ?? null,
      cashSession: { physicalCashBox: { branchId: "branch-1", branch: BRANCH_1 } },
      createdBy: { fullName: "Ana Pérez" },
    }],
  ]);
  const expenses: Array<Record<string, unknown>> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- $transaction se refiere a `db` dentro de su propio literal.
  const db: any = {
    cashMovement: {
      findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
      findMany: async ({ where }: { where: Record<string, any> }) => {
        return [...rows.values()].filter((r) => {
          if (where.type && r.type !== where.type) return false;
          if (where.reviewedAt === null && r.reviewedAt !== null) return false;
          if (where.createdAt) {
            const d = r.createdAt as Date;
            if (d < where.createdAt.gte || d >= where.createdAt.lt) return false;
          }
          return true;
        });
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.get(where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    expenseConcept: { findUnique: async () => null },
    operatingExpense: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const expense = { id: `oe-${expenses.length + 1}`, ...data };
        expenses.push(expense);
        const linked = rows.get(data.cashMovementId as string);
        if (linked) linked.operatingExpense = { id: expense.id };
        return expense;
      },
    },
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
  };
  return { db: db as never, expenses, rows };
}

test("classifyCashOutAsExpense — liga un OperatingExpense PAID y vuelve EXPENSE_OUT el movimiento", async () => {
  const { db, expenses, rows } = buildFakeDb({ id: "cm-1", type: "CASH_OUT", amount: 2000, reason: "Retiro", createdAt: new Date("2026-10-05T12:00:00Z") });

  const expense = await classifyCashOutAsExpense("cm-1", { category: "OTHER", payee: "Ferretería X", receiptNumber: "R-99" }, "user-1", db);

  assert.equal((expense as { kind: string }).kind, "PAID");
  assert.equal((expense as { cashMovementId: string }).cashMovementId, "cm-1");
  assert.equal(expenses.length, 1);
  assert.equal(rows.get("cm-1")!.type, "EXPENSE_OUT", "el movimiento debe pasar a EXPENSE_OUT para que el libro lo cuente");
});

test("LA QUE IMPORTA — CASH_OUT y EXPENSE_OUT restan lo MISMO del efectivo esperado (clasificar no mueve el arqueo)", () => {
  const asCashOut = cashMovementsNetTotal([{ type: "CASH_OUT" as never, amount: 2000 }]);
  const asExpenseOut = cashMovementsNetTotal([{ type: "EXPENSE_OUT" as never, amount: 2000 }]);
  assert.equal(asCashOut, asExpenseOut, "cambiar el type de CASH_OUT a EXPENSE_OUT no debe alterar el efectivo esperado de la sesión");
});

test("LA QUE IMPORTA — clasificar dos veces el mismo movimiento falla con CONFLICT (409)", async () => {
  const { db } = buildFakeDb({ id: "cm-1", type: "CASH_OUT", amount: 500, reason: "Retiro", createdAt: new Date("2026-10-05T12:00:00Z") });

  await classifyCashOutAsExpense("cm-1", { category: "OTHER" }, "user-1", db);
  await assert.rejects(
    () => classifyCashOutAsExpense("cm-1", { category: "OTHER" }, "user-1", db),
    /VALIDATION_ERROR: solo se pueden clasificar retiros/,
    "ya no es CASH_OUT (ahora EXPENSE_OUT) — la segunda llamada debe rechazarse",
  );
});

test("classifyCashOutAsExpense — un movimiento ya clasificado (operatingExpense vinculado) rechaza con CONFLICT", async () => {
  const { db } = buildFakeDb({
    id: "cm-1", type: "CASH_OUT", amount: 500, reason: "Retiro", createdAt: new Date("2026-10-05T12:00:00Z"),
    operatingExpense: { id: "oe-existing" },
  });
  await assert.rejects(() => classifyCashOutAsExpense("cm-1", { category: "OTHER" }, "user-1", db), /CONFLICT: este retiro ya se clasificó/);
});

test("classifyCashOutAsExpense — un movimiento que no es CASH_OUT rechaza", async () => {
  const { db } = buildFakeDb({ id: "cm-1", type: "EXPENSE_OUT", amount: 500, reason: "Gasto", createdAt: new Date("2026-10-05T12:00:00Z") });
  await assert.rejects(() => classifyCashOutAsExpense("cm-1", { category: "OTHER" }, "user-1", db), /VALIDATION_ERROR/);
});

test("dismissCashOutAsNotExpense — marca revisado sin tocar type ni monto", async () => {
  const { db, rows } = buildFakeDb({ id: "cm-1", type: "CASH_OUT", amount: 1500, reason: "Retiro del dueño", createdAt: new Date("2026-10-05T12:00:00Z") });

  const updated = await dismissCashOutAsNotExpense("cm-1", "Era retiro del dueño, confirmado con él", "user-1", db);

  assert.ok(updated.reviewedAt);
  assert.equal(rows.get("cm-1")!.type, "CASH_OUT", "no es un gasto — el type NO debe cambiar");
  assert.equal(Number(rows.get("cm-1")!.amount), 1500);
});

test("dismissCashOutAsNotExpense — motivo muy corto falla", async () => {
  const { db } = buildFakeDb({ id: "cm-1", type: "CASH_OUT", amount: 500, reason: "Retiro", createdAt: new Date("2026-10-05T12:00:00Z") });
  await assert.rejects(() => dismissCashOutAsNotExpense("cm-1", "ok", "user-1", db), /VALIDATION_ERROR/);
});

test("dismissCashOutAsNotExpense — un movimiento ya revisado rechaza con CONFLICT", async () => {
  const { db } = buildFakeDb({
    id: "cm-1", type: "CASH_OUT", amount: 500, reason: "Retiro", createdAt: new Date("2026-10-05T12:00:00Z"),
    reviewedAt: new Date("2026-10-06T10:00:00Z"),
  });
  await assert.rejects(() => dismissCashOutAsNotExpense("cm-1", "motivo válido", "user-1", db), /CONFLICT: este retiro ya se marcó/);
});

test("LA QUE IMPORTA — listUnclassifiedCashOuts no trae uno recién descartado con 'No es gasto'", async () => {
  const { db } = buildFakeDb({
    id: "cm-1", type: "CASH_OUT", amount: 500, reason: "Retiro", createdAt: new Date("2026-10-05T12:00:00Z"),
    reviewedAt: new Date("2026-10-06T10:00:00Z"),
  });
  const rows = await listUnclassifiedCashOuts({ start: new Date("2026-10-01T06:00:00Z"), end: new Date("2026-11-01T06:00:00Z"), branchId: null }, db);
  assert.equal(rows.length, 0, "ya revisado — no debe aparecer en la lista para clasificar");
});

test("listUnclassifiedCashOuts — uno sin revisar sí aparece", async () => {
  const { db } = buildFakeDb({ id: "cm-1", type: "CASH_OUT", amount: 500, reason: "Retiro", createdAt: new Date("2026-10-05T12:00:00Z") });
  const rows = await listUnclassifiedCashOuts({ start: new Date("2026-10-01T06:00:00Z"), end: new Date("2026-11-01T06:00:00Z"), branchId: null }, db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 500);
  assert.equal(rows[0].branchCode, "MSY");
});
