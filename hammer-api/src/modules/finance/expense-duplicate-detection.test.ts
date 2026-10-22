import assert from "node:assert/strict";
import test from "node:test";
import { findPossibleDuplicate, type ExpenseDuplicateCandidate } from "@/modules/finance/expense-duplicate-detection";

const NOW = new Date("2026-10-08T20:48:00Z");

function candidate(overrides: Partial<ExpenseDuplicateCandidate> = {}): ExpenseDuplicateCandidate {
  return {
    id: "exp-1",
    category: "OTHER",
    description: "arena (12 metros)",
    amount: 5640,
    createdAt: new Date("2026-10-08T18:41:00Z"),
    ...overrides,
  };
}

test("mismo monto, misma categoría, dentro de 24h → duplicado (caso real: arena ×2 el mismo día)", () => {
  const result = findPossibleDuplicate(
    { category: "OTHER", description: "viaje de arena", amount: 5640, now: NOW },
    [candidate()],
  );
  assert.ok(result);
  assert.equal(result!.id, "exp-1");
});

test("monto dentro de ±1% sigue contando como posible duplicado", () => {
  const result = findPossibleDuplicate(
    { category: "OTHER", description: "arena (12 metros)", amount: 5650, now: NOW }, // 5650 vs 5640 ≈ 0.18%
    [candidate()],
  );
  assert.ok(result);
});

test("monto fuera de ±1% no es duplicado", () => {
  const result = findPossibleDuplicate(
    { category: "OTHER", description: "arena (12 metros)", amount: 6000, now: NOW },
    [candidate()],
  );
  assert.equal(result, null);
});

test("más de 24h no es duplicado", () => {
  const result = findPossibleDuplicate(
    { category: "OTHER", description: "arena (12 metros)", amount: 5640, now: NOW },
    [candidate({ createdAt: new Date("2026-10-07T18:00:00Z") })],
  );
  assert.equal(result, null);
});

test("misma sucursal/monto/ventana pero categoría Y descripción distintas no es duplicado", () => {
  const result = findPossibleDuplicate(
    { category: "TRANSPORT", description: "pasaje al banco", now: NOW, amount: 100 },
    [candidate({ category: "FOOD", description: "almuerzo del equipo", amount: 100 })],
  );
  assert.equal(result, null);
});

test("categoría distinta pero descripción parecida sigue marcando duplicado", () => {
  const result = findPossibleDuplicate(
    { category: "TRANSPORT", description: "pasaje al banco urgente", now: NOW, amount: 100 },
    [candidate({ category: "OTHER", description: "pasaje al banco", amount: 100, createdAt: new Date("2026-10-08T10:00:00Z") })],
  );
  assert.ok(result);
});

test("sin candidatos → null", () => {
  assert.equal(findPossibleDuplicate({ category: "OTHER", description: "algo", amount: 100, now: NOW }, []), null);
});
