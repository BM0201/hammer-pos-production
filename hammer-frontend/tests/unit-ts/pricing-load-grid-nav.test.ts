import assert from "node:assert/strict";
import test from "node:test";
import { nextGridRowIndex } from "@/lib/pricing-load-grid-nav";

test("Enter/ArrowDown bajan una fila", () => {
  assert.equal(nextGridRowIndex(0, 5, "Enter"), 1);
  assert.equal(nextGridRowIndex(0, 5, "ArrowDown"), 1);
});

test("ArrowUp sube una fila", () => {
  assert.equal(nextGridRowIndex(2, 5, "ArrowUp"), 1);
});

test("LA QUE IMPORTA — en la última fila, Enter/ArrowDown no mueven nada (null, no da la vuelta a la fila 0)", () => {
  assert.equal(nextGridRowIndex(4, 5, "Enter"), null);
  assert.equal(nextGridRowIndex(4, 5, "ArrowDown"), null);
});

test("en la primera fila, ArrowUp no mueve nada", () => {
  assert.equal(nextGridRowIndex(0, 5, "ArrowUp"), null);
});

test("grilla vacía: cualquier tecla devuelve null", () => {
  assert.equal(nextGridRowIndex(0, 0, "Enter"), null);
  assert.equal(nextGridRowIndex(0, 0, "ArrowUp"), null);
});
