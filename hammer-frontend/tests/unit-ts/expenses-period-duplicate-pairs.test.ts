import assert from "node:assert/strict";
import test from "node:test";
import { findDuplicatePairs } from "@/components/finance/expenses-period-panel";
import type { ExpenseLedgerRow } from "@/components/finance/expenses-period.types";

function row(overrides: Partial<ExpenseLedgerRow> = {}): ExpenseLedgerRow {
  return {
    id: "row-1", date: "2026-10-08T18:41:00.000Z", branchId: "branch-1", branchCode: "RIV", branchName: "Rivas",
    category: "OTHER", conceptId: null, conceptName: null, description: "arena (12 metros)", payee: null,
    receiptNumber: null, receiptPhotoUrl: null, expenseId: null, amount: 5640, source: "CAJA", registeredBy: null, approvedBy: null, reference: null,
    ...overrides,
  };
}

/** prompt-caja-gastos-pos-cobro.md Commit 3 — caso real del dueño: arena ×2 el mismo día en RIV. */
test("mismo monto, misma sucursal, dentro de 24h → par de posible duplicado", () => {
  const pairs = findDuplicatePairs([
    row({ id: "a", date: "2026-10-08T14:41:00.000Z" }),
    row({ id: "b", date: "2026-10-08T16:48:00.000Z", description: "viaje de arena" }),
  ]);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].a.id, pairs[0].b.id], ["a", "b"]);
});

test("sucursales distintas no son duplicado", () => {
  const pairs = findDuplicatePairs([row({ id: "a", branchId: "branch-1" }), row({ id: "b", branchId: "branch-2" })]);
  assert.equal(pairs.length, 0);
});

test("monto fuera de ±1% no es duplicado", () => {
  const pairs = findDuplicatePairs([row({ id: "a", amount: 5640 }), row({ id: "b", amount: 6000 })]);
  assert.equal(pairs.length, 0);
});

test("más de 24h aparte no es duplicado", () => {
  const pairs = findDuplicatePairs([
    row({ id: "a", date: "2026-10-07T10:00:00.000Z" }),
    row({ id: "b", date: "2026-10-08T18:00:00.000Z" }),
  ]);
  assert.equal(pairs.length, 0);
});

test("fuente DEVENGADO nunca entra", () => {
  const pairs = findDuplicatePairs([row({ id: "a", source: "DEVENGADO" }), row({ id: "b" })]);
  assert.equal(pairs.length, 0);
});
