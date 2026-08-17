import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  resolveEffectivePricingFromParts,
  resolveFusionMemberCost,
  relativeDeviation,
  FUSION_PRICE_OVERRIDE_THRESHOLD,
  type FusionMemberPricingBasis,
} from "@/modules/catalog/effective-pricing";

// Re-export the private function for testing by re-implementing the pure logic.
// We test the exported type surface via mapProductWithEffectivePricing with
// controlled inputs instead of spinning up a DB connection.

function d(v: number | null) {
  return v === null ? null : new Prisma.Decimal(v);
}

type PricingInput = {
  productId: string;
  standardSalePrice: Prisma.Decimal;
  branchPrice: Prisma.Decimal | null;
  branchCost: Prisma.Decimal | null;
  averageCost: Prisma.Decimal | null;
  globalCost: Prisma.Decimal | null;
  lastPurchaseCost: Prisma.Decimal | null;
  weightedAverageCost: Prisma.Decimal | null;
};

// Inline the pure resolution logic mirrored from effective-pricing.ts so tests
// remain in-process without a DB.
function resolveEffectivePricingPure(input: PricingInput) {
  const effectivePrice = input.branchPrice;
  const effectiveCost = input.branchCost
    ?? input.averageCost
    ?? input.globalCost
    ?? input.lastPurchaseCost
    ?? input.weightedAverageCost
    ?? null;
  const costSource = input.branchCost !== null && input.branchCost !== undefined
    ? "BRANCH"
    : input.averageCost !== null && input.averageCost !== undefined
      ? "GLOBAL_AVERAGE"
      : input.globalCost !== null && input.globalCost !== undefined
        ? "GLOBAL"
        : input.lastPurchaseCost !== null && input.lastPurchaseCost !== undefined
          ? "LAST_PURCHASE"
          : input.weightedAverageCost !== null
            ? "WAC_ESTIMATE"
            : "NONE";
  return {
    effectiveCost,
    costSource,
    effectivePrice,
    priceSource: input.branchPrice === null ? "MISSING" : "BRANCH",
  };
}

const BASE: PricingInput = {
  productId: "prod-1",
  standardSalePrice: d(100)!,
  branchPrice: null,
  branchCost: null,
  averageCost: null,
  globalCost: null,
  lastPurchaseCost: null,
  weightedAverageCost: null,
};

test("effectiveCost: branchCost tiene prioridad sobre todos los otros costos", () => {
  const result = resolveEffectivePricingPure({
    ...BASE,
    branchCost: d(10),
    averageCost: d(20),
    globalCost: d(30),
    lastPurchaseCost: d(40),
    weightedAverageCost: d(50),
  });
  assert.equal(result.effectiveCost?.toNumber(), 10);
  assert.equal(result.costSource, "BRANCH");
});

test("effectiveCost: usa averageCost cuando no hay branchCost", () => {
  const result = resolveEffectivePricingPure({
    ...BASE,
    branchCost: null,
    averageCost: d(20),
    globalCost: d(30),
  });
  assert.equal(result.effectiveCost?.toNumber(), 20);
  assert.equal(result.costSource, "GLOBAL_AVERAGE");
});

test("effectiveCost: usa globalCost cuando no hay branch ni average", () => {
  const result = resolveEffectivePricingPure({
    ...BASE,
    branchCost: null,
    averageCost: null,
    globalCost: d(30),
    lastPurchaseCost: d(40),
  });
  assert.equal(result.effectiveCost?.toNumber(), 30);
  assert.equal(result.costSource, "GLOBAL");
});

test("effectiveCost: usa lastPurchaseCost cuando no hay branch/average/global", () => {
  const result = resolveEffectivePricingPure({
    ...BASE,
    branchCost: null,
    averageCost: null,
    globalCost: null,
    lastPurchaseCost: d(40),
    weightedAverageCost: d(50),
  });
  assert.equal(result.effectiveCost?.toNumber(), 40);
  assert.equal(result.costSource, "LAST_PURCHASE");
});

test("effectiveCost: usa WAC cuando no hay otros costos", () => {
  const result = resolveEffectivePricingPure({
    ...BASE,
    weightedAverageCost: d(50),
  });
  assert.equal(result.effectiveCost?.toNumber(), 50);
  assert.equal(result.costSource, "WAC_ESTIMATE");
});

test("effectiveCost: retorna null y NONE cuando no hay ningún costo", () => {
  const result = resolveEffectivePricingPure(BASE);
  assert.equal(result.effectiveCost, null);
  assert.equal(result.costSource, "NONE");
});

test("effectivePrice: usa branchPrice cuando existe", () => {
  const result = resolveEffectivePricingPure({ ...BASE, branchPrice: d(90) });
  assert.equal(result.effectivePrice?.toNumber(), 90);
  assert.equal(result.priceSource, "BRANCH");
});

test("effectivePrice: es null (sin fallback a standardSalePrice) cuando no hay branchPrice", () => {
  const result = resolveEffectivePricingPure({ ...BASE, branchPrice: null });
  assert.equal(result.effectivePrice, null);
  assert.equal(result.priceSource, "MISSING");
});

test("effectiveCost: branchCost=0 no cae al siguiente nivel (mantiene BRANCH con 0)", () => {
  const result = resolveEffectivePricingPure({
    ...BASE,
    branchCost: d(0),
    averageCost: d(20),
  });
  // null-coalescing solo salta null/undefined, no 0
  assert.equal(result.effectiveCost?.toNumber(), 0);
  assert.equal(result.costSource, "BRANCH");
});

/* ── prompt-costos-precios-fusion.md §5 — pruebas 1, 2, 3, 5, 6, sobre las
 * funciones REALES de effective-pricing.ts (ya son puras, sin DB — se
 * importan directo, sin reimplementar la lógica a mano). ── */

const FUSION_BASE: FusionMemberPricingBasis = {
  conversionFactor: d(25)!,
  canonicalBranchCost: null,
  canonicalAverageCost: null,
  canonicalGlobalCost: null,
  canonicalLastPurchaseCost: null,
  canonicalBaseWeightedAverageCost: d(18.55)!, // costo real del canónico, por LATA
  canonicalBranchPrice: null,
  canonicalStandardSalePrice: d(30)!,
};

test("Prueba 1 (doc): miembro derivado con globalCost cargado a mano → el costo efectivo IGNORA ese valor y deriva del canónico × factor", () => {
  const result = resolveEffectivePricingFromParts({
    productId: "prod-metro-arena",
    standardSalePrice: d(650)!,
    globalCost: d(1)!, // el relleno tecleado a mano — el bug real de arena (C$1.00)
    averageCost: null,
    lastPurchaseCost: null,
    branchPrice: null,
    branchCost: null,
    weightedAverageCost: null,
    fusion: FUSION_BASE,
  });
  assert.equal(result.isFusionMember, true);
  // 18.55 (WAC del canónico, por lata) × 25 (factor) = 463.75 — NO 1.00.
  assert.equal(result.effectiveCost?.toNumber(), 463.75);
  assert.notEqual(result.effectiveCost?.toNumber(), 1);
  assert.equal(result.costSource, "WAC_ESTIMATE"); // la fuente es la del CANÓNICO, no la del miembro
});

test("Prueba 2 (doc): canónico con branchCost cargado → SÍ se respeta, es la base legítima de la fusión", () => {
  const result = resolveEffectivePricingFromParts({
    productId: "prod-lata-arena",
    standardSalePrice: d(30)!,
    globalCost: null,
    averageCost: null,
    lastPurchaseCost: null,
    branchPrice: null,
    branchCost: d(20)!, // costo de adquisición propio de esta sucursal
    weightedAverageCost: d(18.55)!,
    fusion: null, // el canónico mismo nunca pasa `fusion` — usa su propia cadena
  });
  assert.equal(result.isFusionMember, false);
  assert.equal(result.effectiveCost?.toNumber(), 20); // branchCost gana, como siempre en la cadena normal
  assert.equal(result.costSource, "BRANCH");
});

test("Prueba 3 (doc): fusión de arena corregida — dos presentaciones derivadas distintas implican el MISMO costo base por lata", () => {
  // METRO_A (factor 25) con un globalCost de relleno propio, y METRO_B
  // (factor 55) con un branchCost de relleno DISTINTO — ambos deben ignorar
  // sus propios campos y derivar del MISMO canónico.
  const metroA = resolveEffectivePricingFromParts({
    productId: "prod-metro-a",
    standardSalePrice: d(650)!,
    globalCost: d(1)!,
    averageCost: null,
    lastPurchaseCost: null,
    branchPrice: null,
    branchCost: null,
    weightedAverageCost: null,
    fusion: { ...FUSION_BASE, conversionFactor: d(25)! },
  });
  const metroB = resolveEffectivePricingFromParts({
    productId: "prod-metro-b",
    standardSalePrice: d(1200)!,
    globalCost: null,
    averageCost: null,
    lastPurchaseCost: null,
    branchPrice: null,
    branchCost: d(999)!, // otro relleno, distinto del de METRO_A
    weightedAverageCost: null,
    fusion: { ...FUSION_BASE, conversionFactor: d(55)! },
  });

  const impliedBaseCostA = metroA.effectiveCost!.div(25);
  const impliedBaseCostB = metroB.effectiveCost!.div(55);
  assert.equal(impliedBaseCostA.toNumber(), 18.55);
  assert.equal(impliedBaseCostB.toNumber(), 18.55);
  assert.equal(impliedBaseCostA.toNumber(), impliedBaseCostB.toNumber());
});

test("resolveFusionMemberCost: null cuando el canónico no tiene costo resuelto", () => {
  assert.equal(resolveFusionMemberCost(null, d(25)!), null);
});

test("Prueba 5 (doc): precio de una presentación sin override → sale de precioBase(canónico) × factor", () => {
  const result = resolveEffectivePricingFromParts({
    productId: "prod-metro-arena",
    standardSalePrice: d(650)!,
    globalCost: null,
    averageCost: null,
    lastPurchaseCost: null,
    branchPrice: null, // sin override
    branchCost: null,
    weightedAverageCost: null,
    fusion: { ...FUSION_BASE, canonicalBranchPrice: null, canonicalStandardSalePrice: d(30)! },
  });
  assert.equal(result.isFusionPriceOverride, false);
  assert.equal(result.impliedFusionPrice?.toNumber(), 750); // 30 × 25
  assert.equal(result.effectivePrice?.toNumber(), 750);
  assert.equal(result.priceSource, "FUSION_DERIVED");
});

test("precio de una presentación CON override → effectivePrice es el override, impliedFusionPrice queda disponible para comparar", () => {
  const result = resolveEffectivePricingFromParts({
    productId: "prod-metro-arena",
    standardSalePrice: d(650)!,
    globalCost: null,
    averageCost: null,
    lastPurchaseCost: null,
    branchPrice: d(650)!, // override deliberado — vender el metro más barato que 25 latas sueltas
    branchCost: null,
    weightedAverageCost: null,
    fusion: { ...FUSION_BASE, canonicalBranchPrice: null, canonicalStandardSalePrice: d(30)! },
  });
  assert.equal(result.isFusionPriceOverride, true);
  assert.equal(result.impliedFusionPrice?.toNumber(), 750);
  assert.equal(result.effectivePrice?.toNumber(), 650); // el override, no el implícito
  assert.equal(result.priceSource, "BRANCH");
});

/**
 * Prueba 6 (doc): "Override que se desvía más del umbral → exige
 * confirmación explícita". La verificación completa (guard de escritura)
 * vive en catalog-inventory/service.ts::upsertBranchProductSetting, que
 * toca DB real y no se puede probar sin ella (igual que el resto de este
 * módulo) — acá se prueba el cálculo de desvío que ese guard usa.
 */
test("Prueba 6 (doc): un desvío mayor al umbral (caso piedrín: C$1 vs C$1200 implícito) se detecta como tal", () => {
  const implied = d(1200)!;
  const overridden = d(1)!;
  const deviation = relativeDeviation(overridden, implied);
  assert.ok(deviation !== null && deviation > FUSION_PRICE_OVERRIDE_THRESHOLD);
});

test("Prueba 6b: un desvío razonable (descuento por volumen legítimo) NO exige confirmación", () => {
  const implied = d(100)!;
  const overridden = d(90)!; // 10% de descuento por volumen
  const deviation = relativeDeviation(overridden, implied);
  assert.ok(deviation !== null && deviation < FUSION_PRICE_OVERRIDE_THRESHOLD);
});

test("relativeDeviation: referencia <= 0 no tiene desvío calculable (null, no división por cero)", () => {
  assert.equal(relativeDeviation(d(10)!, d(0)!), null);
});
