import assert from "node:assert/strict";
import test from "node:test";
import { parseListLimit } from "@/lib/api/list-limit";

test("sin limit (null/undefined/vacio): usa el default", () => {
  assert.equal(parseListLimit(null, { default: 50 }), 50);
  assert.equal(parseListLimit(undefined, { default: 50 }), 50);
  assert.equal(parseListLimit("", { default: 50 }), 50);
  assert.equal(parseListLimit("   ", { default: 50 }), 50);
});

test("limit valido dentro del tope: se respeta", () => {
  assert.equal(parseListLimit("25", { default: 50 }), 25);
  assert.equal(parseListLimit("1", { default: 50 }), 1);
});

test("limit negativo o cero: usa el default (nunca 0 ni negativo)", () => {
  assert.equal(parseListLimit("-5", { default: 50 }), 50);
  assert.equal(parseListLimit("0", { default: 50 }), 50);
});

test("limit no numerico (texto): usa el default, no revienta", () => {
  assert.equal(parseListLimit("abc", { default: 50 }), 50);
  assert.equal(parseListLimit("NaN", { default: 50 }), 50);
  assert.equal(parseListLimit("12abc", { default: 50 }), 50);
});

test("limit por encima del tope: se acota al max (default 200)", () => {
  assert.equal(parseListLimit("999999", { default: 50 }), 200);
  assert.equal(parseListLimit("500", { default: 50, max: 100 }), 100);
});

test("limit decimal: se trunca hacia abajo", () => {
  assert.equal(parseListLimit("25.9", { default: 50 }), 25);
});

test("max personalizado por ruta se respeta", () => {
  assert.equal(parseListLimit("40", { default: 10, max: 30 }), 30);
  assert.equal(parseListLimit("5", { default: 10, max: 30 }), 5);
});
