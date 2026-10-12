import assert from "node:assert/strict";
import test from "node:test";
import { groupsNeedingItemLoad } from "@/lib/brain-ui";

/** prompt-completo-pendientes-2026-10.md Parte A · Commit 2.1 — grupos críticos ya no se abren vacíos. */

test("groupsNeedingItemLoad — pide los expandidos que todavía no tienen filas cargadas", () => {
  const result = groupsNeedingItemLoad(["A", "B", "C"], new Set(["B"]));
  assert.deepEqual(result, ["A", "C"]);
});

test("LA QUE IMPORTA — un grupo crítico recién auto-expandido (sin filas cargadas) se pide", () => {
  const result = groupsNeedingItemLoad(["REVIEW_PRICE_BELOW_COST"], new Set());
  assert.deepEqual(result, ["REVIEW_PRICE_BELOW_COST"]);
});

test("LA QUE IMPORTA — después de un load() que vació itemsByType, lo que seguía expandido se vuelve a pedir", () => {
  // itemsByType quedó vacío (load() lo resetea) pero expandedTypes no cambió.
  const result = groupsNeedingItemLoad(["REVIEW_PURCHASE_ORDER"], new Set());
  assert.deepEqual(result, ["REVIEW_PURCHASE_ORDER"]);
});

test("un grupo expandido que YA tiene filas no se vuelve a pedir", () => {
  const result = groupsNeedingItemLoad(["A"], new Set(["A"]));
  assert.deepEqual(result, []);
});

test("sin nada expandido, no pide nada", () => {
  assert.deepEqual(groupsNeedingItemLoad([], new Set()), []);
});
