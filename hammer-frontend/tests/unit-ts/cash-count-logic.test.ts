/**
 * Conteo de cierre de caja (cash-count.tsx): total por billetes y diferencia
 * contra lo esperado, en centavos para que 0.10 + 0.20 no deje basura.
 *
 * Ejecutar: npm run test:unit:logic
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countDifference, describeDenominations, sumDenominations, usdEquivalent } from "@/components/cash-session/cash-count";

describe("sumDenominations", () => {
  it("suma cantidad × valor e ignora vacíos, negativos y basura", () => {
    assert.equal(sumDenominations({ "1000": "2", "100": "3", "10": "", "5": "-4", "1": "abc" }), 2300);
  });
  it("cuenta monedas sin error de coma flotante", () => {
    assert.equal(sumDenominations({ "0.25": "3", "0.5": "1" }), 1.25);
  });
  it("con lista propia solo cuenta esas denominaciones (los dólares aparte)", () => {
    assert.equal(sumDenominations({ "100": "1", "20": "2", "2": "1" }, [100, 50, 20, 10, 5, 2, 1]), 142);
    assert.equal(sumDenominations({ "1000": "1", "50": "2" }, [50, 20, 10]), 100);
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

describe("usdEquivalent", () => {
  it("dólares × tipo de cambio, redondeado a centavos", () => {
    assert.equal(usdEquivalent(45, 36.6), 1647);
    assert.equal(usdEquivalent(1, 36.6243), 36.62);
  });
  it("sin tipo de cambio no inventa equivalencia", () => {
    assert.equal(usdEquivalent(45, null), null);
    assert.equal(usdEquivalent(45, 0), null);
  });
});

describe("describeDenominations", () => {
  it("lista solo lo contado, de mayor a menor", () => {
    assert.equal(describeDenominations({ "1": "20", "50": "5", "10": "20", "5": "" }), "5 × C$50, 20 × C$10, 20 × C$1");
  });
  it("monedas de centavo con ¢", () => {
    assert.equal(describeDenominations({ "0.5": "4" }), "4 × 50¢");
  });
  it("dólares con US$", () => {
    assert.equal(describeDenominations({ "20": "2", "5": "1" }, [100, 50, 20, 10, 5, 2, 1], "USD"), "2 × US$20, 1 × US$5");
  });
});
