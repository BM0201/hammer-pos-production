/**
 * prompt-nomina-config.md Fase 3 — lógica pura del editor de reformas
 * legales y de las tasas servidas en los componentes de Planilla.
 *
 * Ejecutar: npm run test:unit:logic
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeIrBases, percentToRate, rateToPercent } from "@/components/payroll/legal-rates-editor";
import { segmentLabels } from "@/components/finance/payroll-composition-bar";
import { DEFAULT_LEGAL_RATES, DEFAULT_PAYROLL_RATES, type LegalRates } from "@/components/finance/payroll-calc";

describe("computeIrBases", () => {
  it("con la tabla actual (Ley 822) reproduce las bases exactas", () => {
    const brackets = [
      { from: 0, rate: 0.0 },
      { from: 100_000, rate: 0.15 },
      { from: 200_000, rate: 0.2 },
      { from: 350_000, rate: 0.25 },
      { from: 500_000, rate: 0.3 },
    ];
    assert.deepEqual(computeIrBases(brackets), [0, 0, 15_000, 45_000, 82_500]);
  });

  it("un solo tramo: base es siempre 0", () => {
    assert.deepEqual(computeIrBases([{ from: 0, rate: 0 }]), [0]);
  });

  it("recalcula en cascada si un tramo intermedio cambia de tasa", () => {
    const brackets = [
      { from: 0, rate: 0.0 },
      { from: 100_000, rate: 0.2 }, // antes 0.15
      { from: 200_000, rate: 0.2 },
    ];
    // base[1] = 0 + (100000-0)*0 = 0; base[2] = 0 + (200000-100000)*0.2 = 20000
    assert.deepEqual(computeIrBases(brackets), [0, 0, 20_000]);
  });
});

describe("percentToRate / rateToPercent", () => {
  it("22.5% <-> 0.225 sin error de redondeo", () => {
    const rate = percentToRate(22.5);
    assert.equal(rate, 0.225);
    assert.equal(rateToPercent(rate), 22.5);
  });

  it("7% <-> 0.07", () => {
    assert.equal(percentToRate(7), 0.07);
    assert.equal(rateToPercent(0.07), 7);
  });

  it("2% (INATEC) <-> 0.02", () => {
    assert.equal(percentToRate(2), 0.02);
    assert.equal(rateToPercent(0.02), 2);
  });

  it("21.5% <-> 0.215", () => {
    assert.equal(percentToRate(21.5), 0.215);
    assert.equal(rateToPercent(0.215), 21.5);
  });
});

describe("segmentLabels con legal personalizado", () => {
  it("una tasa INSS laboral nueva se refleja en el label de retenciones", () => {
    const customLegal: LegalRates = { ...DEFAULT_LEGAL_RATES, inssIntegralLaboral: 0.075 };
    const labels = segmentLabels({ ...DEFAULT_PAYROLL_RATES, legal: customLegal });
    assert.match(labels.ret, /7\.5%/);
  });

  it("un INATEC nuevo se refleja en el label de INATEC", () => {
    const customLegal: LegalRates = { ...DEFAULT_LEGAL_RATES, inatecRate: 0.03 };
    const labels = segmentLabels({ ...DEFAULT_PAYROLL_RATES, legal: customLegal });
    assert.match(labels.inatec, /3%/);
  });

  it("sin legal (undefined), usa DEFAULT_LEGAL_RATES — mismo label de siempre", () => {
    const labels = segmentLabels({ ...DEFAULT_PAYROLL_RATES, legal: undefined });
    assert.match(labels.inatec, /2%/);
  });
});
