import assert from "node:assert/strict";
import test from "node:test";
import { evaluateExecutedDecisions } from "@/modules/brain/outcomes";

/**
 * prompt-brain-centro-decisiones.md Fase 1.7 — "evaluateExecutedDecisions
 * encuentra decisiones ejecutadas por Brain". Antes era estructuralmente
 * inalcanzable: runBrainDecision/executeBrainDecision ya no crean un
 * BrainDecisionOutcome placeholder al ejecutar, así que `outcomes: {
 * none: {} }` ahora sí puede ser verdadero para algo recién ejecutado.
 */

function createFakeDb(decisions: Array<Record<string, unknown>>) {
  const outcomesCreated: Array<Record<string, unknown>> = [];
  const db = {
    brainDecision: {
      findMany: async () => decisions,
    },
    saleOrderLine: {
      aggregate: async () => ({ _sum: { quantity: 0 } }),
    },
    brainDecisionOutcome: {
      create: async ({ data }: { data: Record<string, unknown> }) => { outcomesCreated.push(data); return data; },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { db, outcomesCreated };
}

test("LA QUE IMPORTA — evaluateExecutedDecisions encuentra decisiones EXECUTED sin outcome todavía y les crea uno", async () => {
  const { db, outcomesCreated } = createFakeDb([
    { id: "d1", category: "PRICING", productId: null, branchId: "b1", impactAmount: 500, resolvedAt: new Date("2026-01-01") },
  ]);

  const result = await evaluateExecutedDecisions({ now: new Date("2026-02-01") }, db);

  assert.equal(result.scanned, 1);
  assert.equal(result.created, 1);
  assert.equal(outcomesCreated.length, 1);
  assert.equal(outcomesCreated[0].decisionId, "d1");
  assert.equal(outcomesCreated[0].outcomeType, "INITIAL_REVIEW");
});

test("sin categoría REORDER ni productId, successScore queda null — no se inventa un 50", async () => {
  const { db, outcomesCreated } = createFakeDb([
    { id: "d1", category: "PRICING", productId: null, branchId: "b1", impactAmount: 100, resolvedAt: new Date("2026-01-01") },
  ]);
  await evaluateExecutedDecisions({ now: new Date("2026-02-01") }, db);
  assert.equal(outcomesCreated[0].successScore, null);
});

test("REORDER con unidades vendidas después sí calcula un successScore real", async () => {
  const outcomesCreated: Array<Record<string, unknown>> = [];
  const db = {
    brainDecision: { findMany: async () => [{ id: "d1", category: "REORDER", productId: "p1", branchId: "b1", impactAmount: 200, resolvedAt: new Date("2026-01-01") }] },
    saleOrderLine: { aggregate: async () => ({ _sum: { quantity: 10 } }) },
    brainDecisionOutcome: { create: async ({ data }: { data: Record<string, unknown> }) => { outcomesCreated.push(data); return data; } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  await evaluateExecutedDecisions({ now: new Date("2026-02-01") }, db);
  assert.equal(outcomesCreated[0].actualImpact, 10);
  assert.ok((outcomesCreated[0].successScore as number) > 0);
});
