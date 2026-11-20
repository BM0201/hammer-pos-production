/**
 * Conteo de cierre de caja (cash-count.tsx): total por billetes y diferencia
 * contra lo esperado, en centavos para que 0.10 + 0.20 no deje basura.
 *
 * Ejecutar: npm run test:unit:logic
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countDifference, sumDenominations } from "@/components/cash-session/cash-count";

describe("sumDenominations", () => {
  it("suma cantidad × valor e ignora vacíos, negativos y basura", () => {
    assert.equal(sumDenominations({ "1000": "2", "100": "3", "10": "", "5": "-4", "1": "abc" }), 2300);
  });
  it("cuenta monedas sin error de coma flotante", () => {
    assert.equal(sumDenominations({ "0.1": "3", "0.25": "1", "0.5": "1" }), 1.05);
  });
});

describe("countDifference", () => {
  it("cuadra en 0, sobra en positivo, falta en negativo", () => {
    assert.equal(countDifference(18450.5, 18450.5), 0);
    assert.equal(countDifference(0.3, 0.1 + 0.2), 0);
    assert.equal(countDifference(18500, 18450.5), 49.5);
    assert.equal(countDifference(18400, 18450.5), -50.5);
  });
});
