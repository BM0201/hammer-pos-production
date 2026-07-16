/**
 * Tests del reparto quincenal del neto (biweekly-split.ts).
 *
 * Importa la función REAL que usa generateDisbursementsForRun — antes este
 * archivo era un espejo del 50/50 y por eso no atrapó el bug de repartir el
 * INSS entre las dos quincenas (el INSS se cobra UNA vez al mes).
 *
 * Run: node --import tsx --test src/modules/payroll/payroll-disbursement.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitNetPayBiweekly } from "./biweekly-split";

describe("splitNetPayBiweekly (deducciones mensuales en la 2ª quincena)", () => {
  it("caso Harry: salario 12,000, INSS 456.37 → 1ª = 6,000.00 y 2ª = 5,543.63", () => {
    // El bug reportado: el 50/50 daba 5,771.82/5,771.81 (media deducción
    // escondida en cada quincena). La regla correcta descuenta el INSS
    // completo UNA vez, en la 2ª quincena.
    const net = 12_000 - 456.37; // 11,543.63
    const r = splitNetPayBiweekly(12_000, net);
    assert.equal(r.firstHalf, 6_000);
    assert.equal(r.secondHalf, 5_543.63); // 6,000 − 456.37 ✓ (la resta del usuario)
    assert.equal(Math.round((r.firstHalf + r.secondHalf) * 100) / 100, net);
  });

  it("caso Marvin: salario 9,500, INSS 456.37 → 1ª = 4,750.00 y 2ª = 4,293.63", () => {
    const net = 9_500 - 456.37;
    const r = splitNetPayBiweekly(9_500, net);
    assert.equal(r.firstHalf, 4_750);
    assert.equal(r.secondHalf, 4_293.63);
  });

  it("préstamos y demás deducciones también caen en la 2ª quincena", () => {
    // 12,000 − 456.37 INSS − 500 préstamo = 11,043.63.
    const r = splitNetPayBiweekly(12_000, 11_043.63);
    assert.equal(r.firstHalf, 6_000);
    assert.equal(r.secondHalf, 5_043.63);
  });

  it("si las deducciones superan medio salario, la 1ª se recorta y la 2ª nunca es negativa", () => {
    // Neto 4,000 con salario 12,000 (deducciones enormes): 1ª = 4,000, 2ª = 0.
    const r = splitNetPayBiweekly(12_000, 4_000);
    assert.equal(r.firstHalf, 4_000);
    assert.equal(r.secondHalf, 0);
  });

  it("la suma siempre cuadra al centavo (residuo en la 2ª)", () => {
    const r = splitNetPayBiweekly(10_001, 9_544.64);
    assert.equal(Math.round((r.firstHalf + r.secondHalf) * 100) / 100, 9_544.64);
  });

  it("neto cero (0 días trabajados) → ambas quincenas en 0", () => {
    const r = splitNetPayBiweekly(0, 0);
    assert.equal(r.firstHalf, 0);
    assert.equal(r.secondHalf, 0);
  });
});
