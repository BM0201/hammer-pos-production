import assert from "node:assert/strict";
import test from "node:test";
import { projectThresholdReach, detectBelowTypicalCash, computeCashIndicatorState } from "@/modules/treasury/cash-monitor";

/**
 * prompt-indicador-efectivo-inteligente.md §8 — pruebas sobre las
 * funciones PURAS del indicador (sin DB): la proyección, la detección de
 * lo raro, y los estados. Los casos que dependen de datos reales
 * (getBranchCashPosition, sendCashOutToCustody) usan el prisma global —
 * mismo criterio del resto del módulo treasury, no se fake-tx-testean.
 */

// ── §3 · Estados ────────────────────────────────────────────────────────

test("Prueba 5 (doc): 27,800 acumulados sobre umbral 30,000 → APPROACHING", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 27_800, inTransitAmount: 0, thresholdAmount: 30_000, maxDaysHolding: 5, daysSinceOldestRetained: 1,
  });
  assert.equal(state, "APPROACHING");
});

test("Prueba 6 (doc): 31,000 sobre el mismo umbral → READY", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 31_000, inTransitAmount: 0, thresholdAmount: 30_000, maxDaysHolding: 5, daysSinceOldestRetained: 1,
  });
  assert.equal(state, "READY");
});

test("Prueba 7 (doc): 8,450 acumulados, umbral 25,000, 1 día → ACCUMULATING, sin ámbar", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 8_450, inTransitAmount: 0, thresholdAmount: 25_000, maxDaysHolding: 5, daysSinceOldestRetained: 1,
  });
  assert.equal(state, "ACCUMULATING");
});

test("Prueba 8 (doc): nada más allá del fondo → CLEAR", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 0, inTransitAmount: 0, thresholdAmount: 25_000, maxDaysHolding: 5, daysSinceOldestRetained: 0,
  });
  assert.equal(state, "CLEAR");
});

test("estado IN_TRANSIT_ONLY: nada acumulado, pero hay algo en tránsito", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 0, inTransitAmount: 15_000, thresholdAmount: 25_000, maxDaysHolding: 5, daysSinceOldestRetained: 0,
  });
  assert.equal(state, "IN_TRANSIT_ONLY");
});

test("sin política configurada (thresholdAmount null) → ACCUMULATING neutro, no inventa un umbral", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 500_000, inTransitAmount: 0, thresholdAmount: null, maxDaysHolding: null, daysSinceOldestRetained: 40,
  });
  assert.equal(state, "ACCUMULATING");
});

test("el doble del umbral → CRITICAL, sin importar los días", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 60_000, inTransitAmount: 0, thresholdAmount: 30_000, maxDaysHolding: 30, daysSinceOldestRetained: 1,
  });
  assert.equal(state, "CRITICAL");
});

test("supera maxDaysHolding sin llegar al umbral → OVERDUE (escala en el tiempo, no de golpe)", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 10_000, inTransitAmount: 0, thresholdAmount: 30_000, maxDaysHolding: 5, daysSinceOldestRetained: 6,
  });
  assert.equal(state, "OVERDUE");
});

// ── §2.2 · Proyección ───────────────────────────────────────────────────

test("Prueba 9 (doc): menos de dos semanas de historia → sin proyección (confidence LOW, fechas null)", () => {
  const projection = projectThresholdReach({
    currentAmount: 10_000, thresholdAmount: 30_000,
    dailyCashByWeekday: { 0: 1000, 1: 2000, 2: 2000, 3: 2000, 4: 2000, 5: 2000, 6: 1500 },
    weeksOfHistory: 1,
  });
  assert.equal(projection.confidence, "LOW");
  assert.equal(projection.earliestDate, null);
  assert.equal(projection.likelyDate, null);
});

test("Prueba 10 (doc): proyección visible → siempre incluye su base", () => {
  const projection = projectThresholdReach({
    currentAmount: 10_000, thresholdAmount: 15_000,
    dailyCashByWeekday: { 0: 1000, 1: 2000, 2: 2000, 3: 2000, 4: 2000, 5: 2000, 6: 1500 },
    weeksOfHistory: 4,
    now: new Date("2026-08-17T12:00:00Z"), // lunes
  });
  assert.match(projection.basis, /promedio de las últimas 4 semanas/);
  assert.notEqual(projection.likelyDate, null);
});

test("Prueba 11 (doc): un sábado no proyecta con el promedio de los martes — camina día por día con la tasa de CADA día", () => {
  // Martes cobra fuerte (5000), el resto de la semana casi nada (10).
  const rates = { 0: 10, 1: 10, 2: 5000, 3: 10, 4: 10, 5: 10, 6: 10 };
  // Arranca un lunes (2026-08-17) — el próximo martes es 2026-08-18, un solo día después.
  const projection = projectThresholdReach({
    currentAmount: 0, thresholdAmount: 4000,
    dailyCashByWeekday: rates,
    weeksOfHistory: 4,
    now: new Date("2026-08-17T12:00:00Z"),
  });
  assert.notEqual(projection.likelyDate, null);
  // Si usara un promedio plano ((10*6+5000)/7 ≈ 724), tres días ya alcanzarían
  // los 4000 — pero caminando día por día, el lunes (10) no alcanza y hace
  // falta llegar al martes (día siguiente) para sumar los 5000 reales.
  assert.equal(projection.likelyDate!.getUTCDay(), 2, "debe caer en martes, el único día que realmente cobra fuerte");
});

test("ya alcanzó el umbral → proyección HIGH, earliest=likely=ahora", () => {
  const now = new Date("2026-08-17T12:00:00Z");
  const projection = projectThresholdReach({
    currentAmount: 35_000, thresholdAmount: 30_000,
    dailyCashByWeekday: { 0: 1000, 1: 2000, 2: 2000, 3: 2000, 4: 2000, 5: 2000, 6: 1500 },
    weeksOfHistory: 4,
    now,
  });
  assert.equal(projection.confidence, "HIGH");
  assert.equal(projection.earliestDate?.getTime(), now.getTime());
  assert.equal(projection.likelyDate?.getTime(), now.getTime());
});

test("sin desvío por día de semana → el rango colapsa a un punto (earliest === likely), no se inventa variabilidad", () => {
  const projection = projectThresholdReach({
    currentAmount: 0, thresholdAmount: 2000,
    dailyCashByWeekday: { 0: 1000, 1: 1000, 2: 1000, 3: 1000, 4: 1000, 5: 1000, 6: 1000 },
    weeksOfHistory: 4,
    now: new Date("2026-08-17T12:00:00Z"),
  });
  assert.equal(projection.earliestDate?.getTime(), projection.likelyDate?.getTime());
});

test("con desvío por día de semana → earliest llega antes o igual que likely, nunca después", () => {
  const projection = projectThresholdReach({
    currentAmount: 0, thresholdAmount: 5000,
    dailyCashByWeekday: { 0: 500, 1: 500, 2: 500, 3: 500, 4: 500, 5: 500, 6: 500 },
    dailyCashStddevByWeekday: { 0: 300, 1: 300, 2: 300, 3: 300, 4: 300, 5: 300, 6: 300 },
    weeksOfHistory: 4,
    now: new Date("2026-08-17T12:00:00Z"),
  });
  assert.notEqual(projection.earliestDate, null);
  assert.notEqual(projection.likelyDate, null);
  assert.ok(projection.earliestDate!.getTime() <= projection.likelyDate!.getTime());
});

// ── §2.3 · Lo raro ──────────────────────────────────────────────────────

test("cobro de hoy muy por debajo de lo típico para ese día (>2 desviaciones) → detecta la anomalía", () => {
  const anomaly = detectBelowTypicalCash({
    todayAmount: 500, weekday: 2, meanForWeekday: 5000, stddevForWeekday: 1000, samplesForWeekday: 8,
  });
  assert.notEqual(anomaly, null);
  assert.match(anomaly!.message, /martes típico/);
});

test("cobro de hoy dentro de dos desviaciones → sin anomalía", () => {
  const anomaly = detectBelowTypicalCash({
    todayAmount: 4200, weekday: 2, meanForWeekday: 5000, stddevForWeekday: 1000, samplesForWeekday: 8,
  });
  assert.equal(anomaly, null);
});

test("con poca historia para ese día de semana (menos de 3 muestras) → no se aventura a decir 'típico'", () => {
  const anomaly = detectBelowTypicalCash({
    todayAmount: 100, weekday: 2, meanForWeekday: 5000, stddevForWeekday: 1000, samplesForWeekday: 2,
  });
  assert.equal(anomaly, null);
});
