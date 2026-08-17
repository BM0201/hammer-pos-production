import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decomposeRetainedAmount, computeExposureAlert } from "./decomposition";

describe("decomposeRetainedAmount", () => {
  it("Test 9 del doc: Retener C$215,000 con fondo C$15,000 -> esperando depósito 200,000", () => {
    const d = decomposeRetainedAmount(215000, 15000);
    assert.equal(d.cashFundPortion, 15000);
    assert.equal(d.awaitingDepositPortion, 200000);
  });

  it("Test 10 del doc: sin fondo configurado (null) -> todo cuenta como esperando depósito", () => {
    const d = decomposeRetainedAmount(215000, null);
    assert.equal(d.cashFundPortion, 0);
    assert.equal(d.awaitingDepositPortion, 215000);
  });

  it("sin fondo configurado (undefined) -> mismo comportamiento que null", () => {
    const d = decomposeRetainedAmount(50000, undefined);
    assert.equal(d.cashFundPortion, 0);
    assert.equal(d.awaitingDepositPortion, 50000);
  });

  it("retenido menor que el fondo configurado -> el fondo se ajusta hacia abajo, nunca negativo", () => {
    const d = decomposeRetainedAmount(10000, 15000);
    assert.equal(d.cashFundPortion, 10000);
    assert.equal(d.awaitingDepositPortion, 0);
  });

  it("retenido en cero -> ambas porciones en cero", () => {
    const d = decomposeRetainedAmount(0, 15000);
    assert.equal(d.cashFundPortion, 0);
    assert.equal(d.awaitingDepositPortion, 0);
  });

  it("las dos porciones siempre suman el total retenido", () => {
    const d = decomposeRetainedAmount(123456.78, 15000);
    assert.equal(Math.round((d.cashFundPortion + d.awaitingDepositPortion) * 100) / 100, 123456.78);
  });

  it("monto negativo -> error, no un resultado silencioso", () => {
    assert.throws(() => decomposeRetainedAmount(-100, 15000), /INVALID_RETAIN_AMOUNT/);
  });
});

describe("computeExposureAlert — informa, nunca bloquea", () => {
  it("sin umbral configurado -> nunca excede, aunque el monto/días sean grandes", () => {
    const result = computeExposureAlert(400000, 6, null);
    assert.equal(result.exceeds, false);
  });

  it("con umbral: C$50,000 dos días (ejemplo 'normal' del doc) no excede un umbral de 100,000/3", () => {
    const threshold = { maxAmount: 100000, maxBusinessDays: 3 };
    const result = computeExposureAlert(50000, 2, threshold);
    assert.equal(result.exceeds, false);
  });

  it("con umbral: C$400,000 seis días (ejemplo 'otra cosa' del doc) sí excede ese mismo umbral", () => {
    const threshold = { maxAmount: 100000, maxBusinessDays: 3 };
    const result = computeExposureAlert(400000, 6, threshold);
    assert.equal(result.exceeds, true);
  });

  it("excede monto pero no días -> no dispara (cruzado, no un solo eje)", () => {
    const threshold = { maxAmount: 100000, maxBusinessDays: 3 };
    const result = computeExposureAlert(500000, 1, threshold);
    assert.equal(result.exceeds, false);
  });

  it("excede días pero no monto -> no dispara", () => {
    const threshold = { maxAmount: 100000, maxBusinessDays: 3 };
    const result = computeExposureAlert(1000, 10, threshold);
    assert.equal(result.exceeds, false);
  });

  it("nunca lanza ni bloquea — siempre devuelve un resultado informativo", () => {
    assert.doesNotThrow(() => computeExposureAlert(999999, 999, { maxAmount: 1, maxBusinessDays: 1 }));
  });
});
