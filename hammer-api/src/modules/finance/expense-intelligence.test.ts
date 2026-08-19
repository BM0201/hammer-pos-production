/**
 * Tests del presupuesto inteligente de gastos (expense-intelligence.ts).
 * Módulo puro: se validan las funciones REALES que consumen el endpoint de
 * historial y el aviso de montos atípicos al registrar gastos.
 *
 * Run: node --import tsx --test src/modules/finance/expense-intelligence.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkOutlier, computeCategoryStats, type ExpenseRecord } from "./expense-intelligence";

const rec = (amount: number, iso: string, description = "gasto"): ExpenseRecord => ({
  amount,
  date: new Date(iso),
  description,
});

describe("computeCategoryStats (historial por categoría)", () => {
  it("último gasto, promedio mensual y sugerido salen del historial real", () => {
    const stats = computeCategoryStats("UTILITIES", [
      rec(2400, "2026-05-10T00:00:00.000Z", "Luz mayo"),
      rec(2600, "2026-06-10T00:00:00.000Z", "Luz junio"),
      rec(2500, "2026-07-10T00:00:00.000Z", "Luz julio"),
    ]);
    assert.equal(stats.last?.amount, 2500);
    assert.equal(stats.last?.description, "Luz julio");
    assert.equal(stats.monthlyTotals.length, 3);
    assert.equal(stats.monthlyAverage, 2500); // (2400+2600+2500)/3
    // Sugerido = promedio + 10%, redondeado a la decena: 2750 → 2750.
    assert.equal(stats.suggestedBudget, 2750);
    assert.equal(stats.sampleSize, 3);
  });

  it("varios gastos del mismo mes se agregan al total mensual", () => {
    const stats = computeCategoryStats("FOOD", [
      rec(150, "2026-07-01T00:00:00.000Z"),
      rec(200, "2026-07-15T00:00:00.000Z"),
      rec(180, "2026-06-20T00:00:00.000Z"),
    ]);
    assert.deepEqual(stats.monthlyTotals, [
      { month: "2026-06", total: 180 },
      { month: "2026-07", total: 350 },
    ]);
    assert.equal(stats.monthlyAverage, 265); // (180+350)/2
  });

  it("sin historial: todo en cero y sin último gasto", () => {
    const stats = computeCategoryStats("RENT", []);
    assert.equal(stats.last, null);
    assert.equal(stats.monthlyAverage, 0);
    assert.equal(stats.suggestedBudget, 0);
  });
});

describe("checkOutlier (aviso de monto fuera de lo normal)", () => {
  const history = [
    rec(150, "2026-06-01T00:00:00.000Z"),
    rec(200, "2026-06-15T00:00:00.000Z"),
    rec(180, "2026-07-01T00:00:00.000Z"),
  ]; // típico ≈ 176.67, máximo 200 → umbral = max(353.33, 200) = 353.33

  it("un monto dentro del rango normal NO avisa", () => {
    const stats = computeCategoryStats("FOOD", history);
    assert.equal(checkOutlier(220, stats).isOutlier, false);
    assert.equal(checkOutlier(353, stats).isOutlier, false);
  });

  it("un monto muy por encima de lo típico SÍ avisa (con mensaje humano)", () => {
    const stats = computeCategoryStats("FOOD", history);
    const check = checkOutlier(900, stats);
    assert.equal(check.isOutlier, true);
    assert.ok(check.message?.includes("fuera de lo normal"));
    assert.ok(check.message?.includes("Se registró igual"));
    assert.equal(check.lastAmount, 180);
  });

  it("un gasto grande pero YA CONOCIDO no dispara aviso (el alquiler de siempre)", () => {
    // Alquiler: 8,000 cada mes → típico 8,000, máximo 8,000 → umbral 16,000.
    const stats = computeCategoryStats("RENT", [
      rec(8000, "2026-05-01T00:00:00.000Z"),
      rec(8000, "2026-06-01T00:00:00.000Z"),
      rec(8000, "2026-07-01T00:00:00.000Z"),
    ]);
    assert.equal(checkOutlier(8000, stats).isOutlier, false);
    assert.equal(checkOutlier(8500, stats).isOutlier, false);
    assert.equal(checkOutlier(17000, stats).isOutlier, true);
  });

  it("con poco historial (<3 registros) no se puede hablar de 'normal': no avisa", () => {
    const stats = computeCategoryStats("MAINTENANCE", [rec(500, "2026-07-01T00:00:00.000Z")]);
    assert.equal(checkOutlier(99999, stats).isOutlier, false);
  });
});
