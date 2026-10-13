import assert from "node:assert/strict";
import test from "node:test";
import { isPriceStaleAgainstCost, isReviewStillValid, evaluateBranchCostAgainstReference, escalateForTopMover, unitLossForMarginDecision } from "@/modules/brain/detectors/pricing-detector";

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
 * Parte C.3 (prompt-completo-pendientes-2026-10.md) — "la política sugiere
 * y el dueño decide, y esa decisión se respeta": priceReviewedAt cuenta
 * como "alguien ya lo revisó", igual que lastPriceUpdateAt.
 */
test("LA QUE IMPORTA — priceReviewedAt POSTERIOR al cambio de costo también apaga la señal (mantener precio cuenta como revisión)", () => {
  assert.equal(
    isPriceStaleAgainstCost({
      branchPrice: 150,
      costUpdatedAt: new Date("2026-08-01T00:00:00Z"),
      lastPriceUpdateAt: null,
      priceReviewedAt: new Date("2026-08-10T00:00:00Z"),
    }),
    false,
  );
});

test("priceReviewedAt ANTERIOR al cambio de costo no apaga nada — la revisión ya quedó vieja", () => {
  assert.equal(
    isPriceStaleAgainstCost({
      branchPrice: 150,
      costUpdatedAt: new Date("2026-08-20T00:00:00Z"),
      lastPriceUpdateAt: null,
      priceReviewedAt: new Date("2026-08-10T00:00:00Z"),
    }),
    true,
  );
});

test("se usa el MÁS RECIENTE entre lastPriceUpdateAt y priceReviewedAt", () => {
  assert.equal(
    isPriceStaleAgainstCost({
      branchPrice: 150,
      costUpdatedAt: new Date("2026-08-15T00:00:00Z"),
      lastPriceUpdateAt: new Date("2026-08-01T00:00:00Z"), // viejo
      priceReviewedAt: new Date("2026-08-20T00:00:00Z"), // más reciente, posterior al costo
    }),
    false,
    "priceReviewedAt (20) es posterior al cambio de costo (15), aunque lastPriceUpdateAt (01) no lo sea",
  );
});

/**
 * Parte C.3 — isReviewStillValid decide si "mantener precio" sigue
 * respetándose: mismo precio, mismo costo dentro de tolerancia.
 */
test("LA QUE IMPORTA — isReviewStillValid: mismo precio y costo dentro de tolerancia → sigue vigente", () => {
  assert.equal(
    isReviewStillValid({
      priceReviewedAt: new Date("2026-08-10T00:00:00Z"),
      priceReviewedPrice: 100,
      priceReviewedCost: 70,
      effectivePrice: 100,
      effectiveCost: 71, // 1.4% de cambio, dentro de 3%
      reviewCostTolerancePercent: 3,
    }),
    true,
  );
});

test("LA QUE IMPORTA — isReviewStillValid: el costo se movió MÁS que la tolerancia → ya no vale", () => {
  assert.equal(
    isReviewStillValid({
      priceReviewedAt: new Date("2026-08-10T00:00:00Z"),
      priceReviewedPrice: 100,
      priceReviewedCost: 70,
      effectivePrice: 100,
      effectiveCost: 80, // 14% de cambio, más que 3%
      reviewCostTolerancePercent: 3,
    }),
    false,
  );
});

test("isReviewStillValid: el precio efectivo cambió desde la revisión → ya no vale (alguien lo tocó)", () => {
  assert.equal(
    isReviewStillValid({
      priceReviewedAt: new Date("2026-08-10T00:00:00Z"),
      priceReviewedPrice: 100,
      priceReviewedCost: 70,
      effectivePrice: 105,
      effectiveCost: 70,
      reviewCostTolerancePercent: 3,
    }),
    false,
  );
});

test("isReviewStillValid: sin revisión previa (priceReviewedAt null) → nunca vale", () => {
  assert.equal(
    isReviewStillValid({
      priceReviewedAt: null,
      priceReviewedPrice: null,
      priceReviewedCost: null,
      effectivePrice: 100,
      effectiveCost: 70,
      reviewCostTolerancePercent: 3,
    }),
    false,
  );
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

/**
 * D.1.4 (prompt-completo-pendientes-2026-10.md) — "impacto honesto".
 * unitLossForMarginDecision reemplaza el "precio − costo" de antes, que daba
 * CERO exactamente en el caso más obvio de ganancia perdida (precio = costo).
 */

test("LA QUE IMPORTA — precio = costo (margen 0%) ya NO da impacto cero: hay ganancia que se deja de ganar frente al mínimo de política", () => {
  const unitLoss = unitLossForMarginDecision({ isBelowCost: false, price: 100, cost: 100, minMarginPercent: 20 });
  // priceAtMinMargin = 100 / (1 - 0.20) = 125; impacto = 125 - 100 = 25.
  assert.equal(unitLoss, 25);
});

test("bajo el costo: sigue siendo stock × (costo − precio), sin cambios", () => {
  assert.equal(unitLossForMarginDecision({ isBelowCost: true, price: 80, cost: 100, minMarginPercent: 20 }), 20);
});

test("margen bajo el mínimo pero el precio ya cubre el costo: ganancia que se deja de ganar frente al precio al mínimo, no precio − costo", () => {
  // costo 100, precio 110 (10% de margen, bajo el mínimo del 20%).
  // Antes: unitLoss = precio - costo = 10 (subestima la brecha real).
  // Ahora: priceAtMinMargin = 100 / 0.8 = 125; impacto = 125 - 110 = 15.
  const unitLoss = unitLossForMarginDecision({ isBelowCost: false, price: 110, cost: 100, minMarginPercent: 20 });
  assert.equal(unitLoss, 15);
});

test("precio ya en o sobre el mínimo de política no debería llamarse con este caso, pero el piso en 0 lo deja inofensivo", () => {
  // precio 130 ya da 23.1% de margen, sobre el mínimo del 20% — si por algún
  // motivo se llamara igual, Math.max(0, ...) no produce un impacto negativo.
  const unitLoss = unitLossForMarginDecision({ isBelowCost: false, price: 130, cost: 100, minMarginPercent: 20 });
  assert.equal(unitLoss, 0);
});
