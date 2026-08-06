import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CASH_TOLERANCE_CONFIG,
  normalizeCashToleranceConfig,
  resolveCashToleranceForBranch,
} from "@/modules/operations/cash-tolerance-config";

/**
 * Día Operativo v2 Fase 3 — el número mágico `Math.abs(cashDifferenceTotal) > 100`
 * estaba hardcodeado en dos lugares (buildChecklist, la creación de la decisión
 * de Brain al cerrar). Managua y Masaya manejan volúmenes distintos y merecen
 * tolerancias distintas — ahora es config por sucursal con default global.
 */

test("Test tolerancia: sin config, usa el default global (100)", () => {
  const config = normalizeCashToleranceConfig(null);
  assert.equal(config.defaultToleranceAmount, 100);
  assert.equal(resolveCashToleranceForBranch(config, "branch-msy"), 100);
});

test("Test tolerancia: MSY=100 y MGA=250 cambian qué diferencia dispara advertencia", () => {
  const config = normalizeCashToleranceConfig({
    defaultToleranceAmount: 100,
    byBranch: { "branch-msy": 100, "branch-mga": 250 },
  });

  assert.equal(resolveCashToleranceForBranch(config, "branch-msy"), 100);
  assert.equal(resolveCashToleranceForBranch(config, "branch-mga"), 250);

  // Una diferencia de C$180: dispara advertencia en MSY (100), no en MGA (250).
  const difference = 180;
  assert.ok(Math.abs(difference) > resolveCashToleranceForBranch(config, "branch-msy"), "MSY: 180 > 100 dispara advertencia");
  assert.ok(Math.abs(difference) <= resolveCashToleranceForBranch(config, "branch-mga"), "MGA: 180 <= 250 no dispara advertencia");
});

test("Test tolerancia: sucursal sin override cae al default global", () => {
  const config = normalizeCashToleranceConfig({ defaultToleranceAmount: 150, byBranch: { "branch-mga": 250 } });
  assert.equal(resolveCashToleranceForBranch(config, "branch-other"), 150);
});

test("Test tolerancia: normalización descarta valores inválidos (negativos, no numéricos)", () => {
  const config = normalizeCashToleranceConfig({
    defaultToleranceAmount: -50,
    byBranch: { "branch-a": -10, "branch-b": 200, "branch-c": Number.NaN as unknown as number },
  });
  assert.equal(config.defaultToleranceAmount, DEFAULT_CASH_TOLERANCE_CONFIG.defaultToleranceAmount, "negativo cae al default");
  assert.equal(config.byBranch["branch-a"], undefined, "override negativo se descarta");
  assert.equal(config.byBranch["branch-b"], 200, "override válido se conserva");
  assert.equal(config.byBranch["branch-c"], undefined, "NaN se descarta");
});
