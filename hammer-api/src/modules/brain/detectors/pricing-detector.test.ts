import assert from "node:assert/strict";
import test from "node:test";
import { isPriceStaleAgainstCost, evaluateBranchCostAgainstReference, escalateForTopMover } from "@/modules/brain/detectors/pricing-detector";

/**
 * Fase 1.2 (prompt-motor-precios-lote-herencia-gobierno.md) — la señal
 * COST_CHANGED_PRICE_STALE evita que un producto se venda meses al precio
 * viejo después de una compra que subió el costo.
 *
 * detectPricingDecisions hace consultas batch contra prisma real (sin `db`
 * inyectable) — no hay forma honesta de probar la función completa sin base
 * de datos. isPriceStaleAgainstCost es la condición pura que decide si esta
 * señal dispara, aislada exactamente para poder probarla sin DB, mismo
 * principio que isLateSyncIntoClosedDay/classifyTenderForLedger en otros
 * módulos de esta sesión.
 */

test("Prueba 6 — costUpdatedAt posterior a lastPriceUpdateAt genera la señal", () => {
  assert.equal(
    isPriceStaleAgainstCost({
      branchPrice: 150,
      costUpdatedAt: new Date("2026-08-20T00:00:00Z"),
      lastPriceUpdateAt: new Date("2026-08-10T00:00:00Z"),
    }),
    true,
  );
});

test("Prueba 7 — lastPriceUpdateAt null con branchPrice presente también la genera", () => {
  assert.equal(
    isPriceStaleAgainstCost({ branchPrice: 150, costUpdatedAt: new Date("2026-08-20T00:00:00Z"), lastPriceUpdateAt: null }),
    true,
  );
});

test("Prueba 8 — costo actualizado ANTES del último precio no genera nada", () => {
  assert.equal(
    isPriceStaleAgainstCost({
      branchPrice: 150,
      costUpdatedAt: new Date("2026-08-01T00:00:00Z"),
      lastPriceUpdateAt: new Date("2026-08-10T00:00:00Z"),
    }),
    false,
  );
});

test("sin branchPrice fijado, no hay 'última vez que se fijó el precio' que comparar — no dispara", () => {
  assert.equal(
    isPriceStaleAgainstCost({ branchPrice: null, costUpdatedAt: new Date("2026-08-20T00:00:00Z"), lastPriceUpdateAt: null }),
    false,
  );
});

test("sin costUpdatedAt (nunca se registró el costo), no hay nada que comparar — no dispara", () => {
  assert.equal(isPriceStaleAgainstCost({ branchPrice: 150, costUpdatedAt: null, lastPriceUpdateAt: null }), false);
});

/**
 * Parte A (prompt-huecos-fase1-fase3-despliegue.md) — REVIEW_BRANCH_COST_PRICE
 * dispara con branchCost >= price, y branchCost es un override manual sin la
 * trazabilidad de effectiveCost. La causa más común no es un producto mal
 * preciado, es un costo mal tecleado (un punto decimal corrido) — el motor
 * calcula fielmente un precio sugerido absurdo sobre esa basura, y esa fila
 * sube al tope de la bandeja ordenada por impacto, a un checkbox de
 * aplicarse. evaluateBranchCostAgainstReference es la condición pura que
 * decide si el costo "se ve mal" contra los costos de referencia del
 * producto (averageCost/lastPurchaseCost), umbral 2× deliberadamente
 * grueso.
 */

test("Prueba 1 (LA QUE IMPORTA) — branchCost más de 2× el averageCost → costLooksWrong true", () => {
  const result = evaluateBranchCostAgainstReference({ branchCost: 4500, averageCost: 450, lastPurchaseCost: null });
  assert.equal(result.costLooksWrong, true);
  assert.equal(result.referenceCost, 450);
  assert.equal(result.referenceSource, "averageCost");
});

test("Prueba 2 — branchCost levemente sobre el precio, cerca del averageCost → costLooksWrong false, aplicable normal", () => {
  // 520 vs 450 de referencia — cerca, no un orden de magnitud de diferencia.
  const result = evaluateBranchCostAgainstReference({ branchCost: 520, averageCost: 450, lastPurchaseCost: null });
  assert.equal(result.costLooksWrong, false);
});

test("Prueba 3 — producto sin averageCost ni lastPurchaseCost → costLooksWrong false (sin base de comparación no se puede afirmar que esté mal)", () => {
  const result = evaluateBranchCostAgainstReference({ branchCost: 4500, averageCost: null, lastPurchaseCost: null });
  assert.equal(result.costLooksWrong, false);
  assert.equal(result.referenceCost, null);
  assert.equal(result.referenceSource, null);
});

test("sin averageCost pero con lastPurchaseCost, usa lastPurchaseCost como referencia", () => {
  const result = evaluateBranchCostAgainstReference({ branchCost: 4500, averageCost: null, lastPurchaseCost: 400 });
  assert.equal(result.costLooksWrong, true);
  assert.equal(result.referenceSource, "lastPurchaseCost");
});

test("exactamente 2× no dispara — el umbral es estrictamente mayor que, no mayor o igual", () => {
  const result = evaluateBranchCostAgainstReference({ branchCost: 900, averageCost: 450, lastPurchaseCost: null });
  assert.equal(result.costLooksWrong, false);
});

test("referenceCost en 0 no se usa como base (evita división/comparación sin sentido)", () => {
  const result = evaluateBranchCostAgainstReference({ branchCost: 4500, averageCost: 0, lastPurchaseCost: null });
  assert.equal(result.costLooksWrong, false);
});

/**
 * prompt-precios-vigilancia-movimiento.md — "que se vigile bien... pero
 * sobre todo lo que más se mueve": un producto clase A (el que más se
 * mueve, commercial-intelligence.ts) escala un escalón de severidad y sube
 * confidenceScore — ambos alimentan priorityScoreFor (brain/scoring.ts) al
 * persistir, así que esto reordena la Bandeja sin tocar esa función
 * genérica ni el ORDER BY de tray-service.ts (ya ordena por priorityScore desc).
 */

test("escalateForTopMover: producto que NO es clase A no cambia nada", () => {
  const result = escalateForTopMover("MEDIUM", false, 0.8);
  assert.equal(result.severity, "MEDIUM");
  assert.equal(result.confidenceScore, 0.8);
});

test("escalateForTopMover: clase A sube un escalón de severidad (MEDIUM → HIGH)", () => {
  const result = escalateForTopMover("MEDIUM", true, 0.8);
  assert.equal(result.severity, "HIGH");
});

test("escalateForTopMover: clase A en HIGH sube a CRITICAL", () => {
  const result = escalateForTopMover("HIGH", true, 0.8);
  assert.equal(result.severity, "CRITICAL");
});

test("escalateForTopMover: ya en CRITICAL no sube más allá (tope)", () => {
  const result = escalateForTopMover("CRITICAL", true, 0.8);
  assert.equal(result.severity, "CRITICAL");
});

test("escalateForTopMover: clase A sube confidenceScore (+0.12), sin pasar de 0.98", () => {
  const low = escalateForTopMover("LOW", true, 0.65);
  assert.equal(low.confidenceScore, 0.77);
  const high = escalateForTopMover("MEDIUM", true, 0.95);
  assert.equal(high.confidenceScore, 0.98, "tope en 0.98, no 1.07");
});
