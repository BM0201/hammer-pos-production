import assert from "node:assert/strict";
import test from "node:test";
import { getBranchExposureStatus } from "@/modules/treasury/service";

/**
 * PASO 2 (prompt-vigilancia-tesoreria-generalizacion.md) — cashExpensesExceedRetained
 * (treasury/exposure.ts::computeOutstandingAwaitingDeposit, sin tocar ese
 * cálculo) ya se auditaba en un AuditLog que nadie revisa. Ahora también
 * dispara raiseCashDiscrepancy (discrepancy-signals.ts) — a diferencia del
 * depósito (un evento único), getBranchExposureStatus se llama desde un GET
 * y puede recalcular la MISMA situación muchas veces: el fingerprint debe
 * ser estable para que abrir el panel dos veces actualice la misma
 * decisión (upsert) en vez de duplicarla.
 *
 * getBranchExposureStatus/getActiveRetainedCashExpenses reciben un `db`
 * inyectable (mismo patrón que findSafeAccountForBranch, ya existente en
 * este archivo) — acá se les da un fake en memoria, sin base de datos real.
 */

const BRANCH_ID = "branch-1";

function buildFakeDb(opts: {
  declaredAmount: number;
  depositedAmount: number;
  cashExpenseAmounts: Array<{ amount: number; occurredAt: Date }>;
}) {
  const brainDecisions: Array<Record<string, unknown>> = [];
  // Mutable — un test puede reasignar cashExpenses.list entre dos llamadas
  // al MISMO db para simular que la situación cambió entre dos GET.
  const cashExpenses = { list: opts.cashExpenseAmounts };

  const db = {
    cashDestinationDeclaration: {
      findMany: async () => (opts.declaredAmount > 0 ? [{ createdAt: new Date("2026-01-01"), retainAwaitingDepositPortion: opts.declaredAmount }] : []),
    },
    bankDeposit: {
      findMany: async () => (opts.depositedAmount > 0 ? [{ depositedAt: new Date("2026-01-05"), amount: opts.depositedAmount }] : []),
    },
    treasuryEntry: {
      findMany: async () => cashExpenses.list.map((e, i) => ({ occurredAt: e.occurredAt, amount: e.amount, expensePaymentId: `expense-${i}` })),
    },
    operatingExpense: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id })), // todos activos
    },
    brainDecision: {
      upsert: async ({ where, create, update }: { where: { fingerprint: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = brainDecisions.find((d) => d.fingerprint === where.fingerprint);
        if (existing) {
          Object.assign(existing, update);
          return { id: existing.id, ...existing };
        }
        const row = { id: `decision-${brainDecisions.length + 1}`, ...create };
        brainDecisions.push(row);
        return row;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { db, brainDecisions, cashExpenses };
}

test("gastos con efectivo retenido superan lo declarado → crea REVIEW_CASH_EXPENSES_EXCEED_RETAINED con los datos correctos", async () => {
  const { db, brainDecisions } = buildFakeDb({
    declaredAmount: 1000,
    depositedAmount: 0,
    cashExpenseAmounts: [{ amount: 1500, occurredAt: new Date("2026-02-01") }],
  });

  const result = await getBranchExposureStatus(BRANCH_ID, null, new Date("2026-02-10"), db);

  assert.equal(result.cashExpensesExceedRetained, true);
  assert.equal(brainDecisions.length, 1);

  const decision = brainDecisions[0];
  assert.equal(decision.category, "CASH");
  assert.equal(decision.severity, "HIGH");
  assert.equal(decision.proposedActionType, "REVIEW_CASH_EXPENSES_EXCEED_RETAINED");
  assert.equal(decision.branchId, BRANCH_ID);
  assert.match(decision.description as string, /C\$1500\.00/);
  assert.match(decision.description as string, /C\$1000\.00/);
  assert.match(decision.description as string, /C\$500\.00/);

  const evidence = decision.evidenceJson as Record<string, unknown>;
  assert.equal(evidence.totalDeclared, 1000);
  assert.equal(evidence.totalDeposited, 0);
  assert.equal(evidence.totalCashExpenses, 1500);
  assert.equal(evidence.afterDeposits, 1000);
  assert.equal(evidence.excessAmount, 500);
});

test("gastos con efectivo retenido NO superan lo declarado → no crea nada", async () => {
  const { db, brainDecisions } = buildFakeDb({
    declaredAmount: 1000,
    depositedAmount: 0,
    cashExpenseAmounts: [{ amount: 400, occurredAt: new Date("2026-02-01") }],
  });

  const result = await getBranchExposureStatus(BRANCH_ID, null, new Date("2026-02-10"), db);

  assert.equal(result.cashExpensesExceedRetained, false);
  assert.equal(brainDecisions.length, 0);
});

test("sin ningún gasto retenido → no crea nada", async () => {
  const { db, brainDecisions } = buildFakeDb({ declaredAmount: 1000, depositedAmount: 0, cashExpenseAmounts: [] });
  await getBranchExposureStatus(BRANCH_ID, null, new Date("2026-02-10"), db);
  assert.equal(brainDecisions.length, 0);
});

test("llamar dos veces con la MISMA situación (mismo GET recalculado) → upsert actualiza, no duplica", async () => {
  const { db, brainDecisions } = buildFakeDb({
    declaredAmount: 1000,
    depositedAmount: 0,
    cashExpenseAmounts: [{ amount: 1500, occurredAt: new Date("2026-02-01") }],
  });

  await getBranchExposureStatus(BRANCH_ID, null, new Date("2026-02-10"), db);
  await getBranchExposureStatus(BRANCH_ID, null, new Date("2026-02-11"), db); // "abrir el panel dos veces"

  assert.equal(brainDecisions.length, 1, "la segunda llamada actualiza la misma fila (mismo fingerprint), no crea otra");
});

test("la situación empeora entre dos llamadas (mismo gasto más antiguo, más gastos encima) → mismo fingerprint, evidenceJson se refresca", async () => {
  const { db, brainDecisions, cashExpenses } = buildFakeDb({
    declaredAmount: 1000,
    depositedAmount: 0,
    cashExpenseAmounts: [{ amount: 1500, occurredAt: new Date("2026-02-01") }],
  });
  await getBranchExposureStatus(BRANCH_ID, null, new Date("2026-02-10"), db);
  assert.equal((brainDecisions[0].evidenceJson as Record<string, unknown>).excessAmount, 500);

  // Un segundo gasto más, mismo gasto MÁS ANTIGUO (2026-02-01) — el
  // fingerprint no cambia, pero el monto sí debe reflejar el nuevo total.
  cashExpenses.list = [{ amount: 1500, occurredAt: new Date("2026-02-01") }, { amount: 300, occurredAt: new Date("2026-02-05") }];
  await getBranchExposureStatus(BRANCH_ID, null, new Date("2026-02-12"), db);

  assert.equal(brainDecisions.length, 1, "sigue siendo la misma decisión — el gasto más antiguo no cambió");
  assert.equal((brainDecisions[0].evidenceJson as Record<string, unknown>).excessAmount, 800, "800 = 1500+300 - 1000, los números se refrescan");
});
