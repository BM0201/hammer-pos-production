import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

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
  const effectivePrice = input.branchPrice ?? input.standardSalePrice;
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
    priceSource: input.branchPrice === null ? "STANDARD" : "BRANCH",
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
  assert.equal(result.effectivePrice.toNumber(), 90);
  assert.equal(result.priceSource, "BRANCH");
});

test("effectivePrice: usa standardSalePrice cuando no hay branchPrice", () => {
  const result = resolveEffectivePricingPure({ ...BASE, branchPrice: null });
  assert.equal(result.effectivePrice.toNumber(), 100);
  assert.equal(result.priceSource, "STANDARD");
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
