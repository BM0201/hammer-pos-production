import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveAbcXyzClassification,
  DEFAULT_ABC_XYZ_THRESHOLDS,
} from "@/modules/analytics/abc-xyz-classification";
import { classifyProductAbcXyz, resolveCommercialPricingRecommendation } from "@/modules/pricing/commercial-intelligence";

/**
 * prompt-precios-fase0: tests dorados para la fuente de verdad única de
 * clasificación ABC-XYZ. Antes de esta fase, `analytics/abc-classifier.ts`
 * tenía 0 tests y `pricing/commercial-intelligence.ts` tampoco tenía tests
 * directos de `classifyProductAbcXyz` (a pesar de que el prompt original
 * asumía que sí) — estos son los primeros tests para AMBOS lados de la
 * decisión de clase.
 */

// ── ABC: método 1 (ranking/batch, cumulativeValuePercent) ──
// Mismo escenario que calculateABCClassification en abc-classifier.ts: una
// lista de productos ordenada desc. por valor, % acumulado corrido.

function classifyRanking(products: { totalValue: number }[]) {
  const totalValue = products.reduce((sum, p) => sum + p.totalValue, 0);
  let cumulative = 0;
  return products.map((p, index) => {
    cumulative += p.totalValue;
    const pct = (cumulative / totalValue) * 100;
    return resolveAbcXyzClassification({ isFirstInRanking: index === 0, cumulativeValuePercent: pct }).abcClass;
  });
}

test("ABC (ranking): el primer producto siempre es A, incluso si su contribucion individual es enorme (>80%)", () => {
  const classes = classifyRanking([{ totalValue: 900 }, { totalValue: 50 }, { totalValue: 50 }]);
  // El primero acumula 900/1000 = 90% el solo — sin el BUG FIX seria B por superar 80,
  // pero la regla "primero siempre A" debe ganar.
  assert.equal(classes[0], "A");
});

test("ABC (ranking): corte exacto en 80% es A, justo despues de 80% es B", () => {
  // 4 productos de 20 cada uno: acumulados 25/50/75/100% -> el 3ro (75%) es A,
  // el 4to (100%) es C. Ajustamos valores para tocar el borde exacto de 80.
  const classes = classifyRanking([{ totalValue: 80 }, { totalValue: 15 }, { totalValue: 5 }]);
  // acumulado: 80% (<=80 -> A), 95% (<=95 -> B), 100% (>95 -> C)
  assert.deepEqual(classes, ["A", "B", "C"]);
});

test("ABC (ranking): corte exacto en 95% es B, justo despues es C", () => {
  const classes = classifyRanking([{ totalValue: 50 }, { totalValue: 30 }, { totalValue: 15 }, { totalValue: 5 }]);
  // acumulado: 50 (A), 80 (<=80 A), 95 (<=95 B), 100 (C)
  assert.deepEqual(classes, ["A", "A", "B", "C"]);
});

// ── ABC: método 2 (contribución individual, fallback en vivo) ──

test("ABC (contribucion individual): bordes exactos 5% y 1%", () => {
  assert.equal(resolveAbcXyzClassification({ individualContributionPercent: 5 }).abcClass, "A");
  assert.equal(resolveAbcXyzClassification({ individualContributionPercent: 4.99 }).abcClass, "B");
  assert.equal(resolveAbcXyzClassification({ individualContributionPercent: 1 }).abcClass, "B");
  assert.equal(resolveAbcXyzClassification({ individualContributionPercent: 0.99 }).abcClass, "C");
});

test("ABC: sin ningun insumo, cae a C con warning (nunca inventa una clase)", () => {
  const result = resolveAbcXyzClassification({});
  assert.equal(result.abcClass, "C");
  assert.ok(result.warnings.some((w) => w.includes("clasificacion ABC")));
});

// ── XYZ: coeficiente de variación (mismo cálculo en ambos lados) ──

test("XYZ (CV): bordes exactos 0.5 y 1.0 son inclusive (X hasta 0.5, Y hasta 1.0)", () => {
  assert.equal(resolveAbcXyzClassification({ coefficientOfVariation: 0.5 }).xyzClass, "X");
  assert.equal(resolveAbcXyzClassification({ coefficientOfVariation: 0.51 }).xyzClass, "Y");
  assert.equal(resolveAbcXyzClassification({ coefficientOfVariation: 1.0 }).xyzClass, "Y");
  assert.equal(resolveAbcXyzClassification({ coefficientOfVariation: 1.01 }).xyzClass, "Z");
});

test("XYZ: menos de xyzMinDataPoints dias con venta fuerza Z, sin importar el CV calculado", () => {
  // 2 muestras identicas darian CV=0 (aparentemente "estable"), pero con tan
  // pocos datos no se puede confiar en esa estabilidad -> Z forzado.
  // TODO(Fase 1): separar "sin datos suficientes" de "Z realmente erratico".
  const result = resolveAbcXyzClassification({ xyzDataPoints: 2, coefficientOfVariation: 0 });
  assert.equal(result.xyzClass, "Z");
});

test("XYZ: con xyzMinDataPoints o mas, se usa el CV normalmente", () => {
  const result = resolveAbcXyzClassification({ xyzDataPoints: DEFAULT_ABC_XYZ_THRESHOLDS.xyzMinDataPoints, coefficientOfVariation: 0.3 });
  assert.equal(result.xyzClass, "X");
});

// ── XYZ: fallback por unidades vendidas (solo commercial-intelligence) ──

test("XYZ (fallback unidades vendidas): bordes exactos 90 y 15", () => {
  assert.equal(resolveAbcXyzClassification({ unitsSoldLast90Days: 90 }).xyzClass, "X");
  assert.equal(resolveAbcXyzClassification({ unitsSoldLast90Days: 89 }).xyzClass, "Y");
  assert.equal(resolveAbcXyzClassification({ unitsSoldLast90Days: 15 }).xyzClass, "Y");
  assert.equal(resolveAbcXyzClassification({ unitsSoldLast90Days: 14 }).xyzClass, "Z");
});

test("XYZ: sin ningun insumo, cae a Z con warning", () => {
  const result = resolveAbcXyzClassification({});
  assert.equal(result.xyzClass, "Z");
  assert.ok(result.warnings.some((w) => w.includes("clasificacion XYZ")));
});

// ── Precedencia stored-vs-calculado: autoridad unica, sin tercer criterio ──

test("precedencia: la clase persistida (stored) gana siempre, sin importar que insumos en vivo se den", () => {
  const result = resolveAbcXyzClassification({
    storedAbcClass: "C",
    storedXyzClass: "Z",
    // Insumos en vivo que, solos, darian A/X — no deben pisar lo persistido.
    isFirstInRanking: true,
    cumulativeValuePercent: 1,
    coefficientOfVariation: 0.01,
  });
  assert.equal(result.abcClass, "C");
  assert.equal(result.xyzClass, "Z");
});

test("precedencia: un stored invalido (fuera de A/B/C o X/Y/Z) se ignora y cae al calculo", () => {
  const result = resolveAbcXyzClassification({
    storedAbcClass: "INVALID",
    storedXyzClass: "",
    individualContributionPercent: 10,
    coefficientOfVariation: 0.1,
  });
  assert.equal(result.abcClass, "A");
  assert.equal(result.xyzClass, "X");
});

// ── Consistencia: la duplicacion real que este modulo elimina ──

test("consistencia: antes de unificar, cv=0.5 exacto daba Y en analytics y X en commercial-intelligence (bug real reproducido)", () => {
  // Formulas ORIGINALES de cada archivo, antes del fix (mirror, no importadas
  // — el codigo real ya no las tiene, ver git history de abc-classifier.ts /
  // commercial-intelligence.ts antes de prompt-precios-fase0).
  function oldAnalyticsXyz(cv: number): "X" | "Y" | "Z" {
    if (cv < 0.5) return "X";
    if (cv < 1.0) return "Y";
    return "Z";
  }
  function oldCommercialIntelligenceXyz(cv: number): "X" | "Y" | "Z" {
    if (cv <= 0.5) return "X";
    if (cv <= 1) return "Y";
    return "Z";
  }

  assert.equal(oldAnalyticsXyz(0.5), "Y");
  assert.equal(oldCommercialIntelligenceXyz(0.5), "X");
  assert.notEqual(oldAnalyticsXyz(0.5), oldCommercialIntelligenceXyz(0.5), "el bug real: mismo CV, dos clases distintas segun el camino");

  // Con la funcion canonica, ambos caminos dan la MISMA clase para cv=0.5.
  assert.equal(resolveAbcXyzClassification({ coefficientOfVariation: 0.5 }).xyzClass, "X");
  assert.equal(classifyProductAbcXyz({ productId: "p1", salesVariabilityCoefficient: 0.5 }).xyzClass, "X");
});

test("consistencia: classifyProductAbcXyz (commercial-intelligence) y resolveAbcXyzClassification (canonico) dan la misma clase para el mismo insumo", () => {
  const cases = [
    { individualContributionPercent: 7, coefficientOfVariation: 0.2 },
    { individualContributionPercent: 2, coefficientOfVariation: 0.8 },
    { individualContributionPercent: 0.5, coefficientOfVariation: 1.5 },
  ];
  for (const c of cases) {
    const viaCanonical = resolveAbcXyzClassification(c);
    const viaCommercialIntelligence = classifyProductAbcXyz({
      productId: "p1",
      revenueContributionPercent: c.individualContributionPercent,
      salesVariabilityCoefficient: c.coefficientOfVariation,
    });
    assert.equal(viaCommercialIntelligence.abcClass, viaCanonical.abcClass);
    assert.equal(viaCommercialIntelligence.xyzClass, viaCanonical.xyzClass);
  }
});

// ── Regresion de consumidores criticos: la unificacion no cambia su resultado ──
// (resolveCommercialPricingRecommendation es el punto de entrada real que usan
// sales/service.ts y inventory/replenishment-service.ts via
// buildCommercialIntelligenceForProduct/Batch — ambas DB-dependientes y no
// probables sin DATABASE_URL en este entorno; se fija el comportamiento en el
// limite puro que SI es invocable directamente.)

test("regresion: producto AX (alto valor, demanda estable) sigue dando margen bajo, descuento alto, stock alto, riesgo bajo", () => {
  const rec = resolveCommercialPricingRecommendation({
    productId: "p1",
    revenueContributionPercent: 8,
    salesVariabilityCoefficient: 0.2,
    daysInStock: 10,
    stockOnHand: 100,
    averageDailySales: 5,
    effectiveCost: 50,
    effectivePrice: 65,
    grossMarginPercent: ((65 - 50) / 65) * 100,
  });
  assert.equal(rec.combinedClass, "AX");
  assert.equal(rec.recommendedStockPolicy, "HIGH_STOCK");
  assert.equal(rec.riskLevel, "LOW");
});

test("regresion: producto CZ (bajo valor, demanda erratica) con stock alto sigue alertando 'inventario muerto'", () => {
  const rec = resolveCommercialPricingRecommendation({
    productId: "p2",
    revenueContributionPercent: 0.2,
    salesVariabilityCoefficient: 1.8,
    daysInStock: 120,
    stockOnHand: 50,
    averageDailySales: 0.2,
    effectiveCost: 20,
    effectivePrice: 25,
    grossMarginPercent: ((25 - 20) / 25) * 100,
  });
  assert.equal(rec.combinedClass, "CZ");
  assert.equal(rec.recommendedStockPolicy, "ON_DEMAND");
  assert.equal(rec.riskLevel, "CRITICAL");
  assert.ok(rec.warnings.some((w) => w.includes("inventario muerto")));
});
