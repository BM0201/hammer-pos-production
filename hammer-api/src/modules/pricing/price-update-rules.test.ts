import assert from "node:assert/strict";
import test from "node:test";
import { computeBulkPrice, classifyLine } from "@/modules/pricing/price-update-rules";

/**
 * prompt-carga-precios.md Fase 1 — computeBulkPrice (una por regla, con
 * redondeo y costo nulo) y classifyLine (bloqueos y avisos), ambas puras.
 */

test("computeBulkPrice — FIXED: usa el precio tal cual, con redondeo", () => {
  const result = computeBulkPrice({ costSnapshot: 100, currentPriceSnapshot: 150 }, { kind: "FIXED", price: 199.4, rounding: "NEAREST_1" });
  assert.equal(result.warning, null);
  assert.equal(result.price?.toNumber(), 199);
});

test("computeBulkPrice — FIXED: precio <= 0 da aviso, sin precio", () => {
  const result = computeBulkPrice({ costSnapshot: 100, currentPriceSnapshot: 150 }, { kind: "FIXED", price: 0 });
  assert.equal(result.price, null);
  assert.ok(result.warning);
});

test("computeBulkPrice — PERCENT_ON_PRICE: +8% sobre el precio vigente", () => {
  const result = computeBulkPrice({ costSnapshot: 100, currentPriceSnapshot: 150 }, { kind: "PERCENT_ON_PRICE", percent: 8 });
  assert.equal(result.warning, null);
  assert.equal(result.price?.toNumber(), 162);
});

test("computeBulkPrice — PERCENT_ON_PRICE: sin precio vigente -> sin precio y con aviso", () => {
  const result = computeBulkPrice({ costSnapshot: 100, currentPriceSnapshot: null }, { kind: "PERCENT_ON_PRICE", percent: 8 });
  assert.equal(result.price, null);
  assert.ok(result.warning);
});

test("computeBulkPrice — MARKUP_ON_COST: costo + 25% de margen de markup", () => {
  const result = computeBulkPrice({ costSnapshot: 100, currentPriceSnapshot: 150 }, { kind: "MARKUP_ON_COST", percent: 25 });
  assert.equal(result.warning, null);
  assert.equal(result.price?.toNumber(), 125);
});

test("computeBulkPrice — MARKUP_ON_COST: costo nulo -> sin precio y con aviso", () => {
  const result = computeBulkPrice({ costSnapshot: null, currentPriceSnapshot: 150 }, { kind: "MARKUP_ON_COST", percent: 25 });
  assert.equal(result.price, null);
  assert.ok(result.warning);
});

test("computeBulkPrice — MARKUP_ON_COST: costo <= 0 -> sin precio y con aviso", () => {
  const result = computeBulkPrice({ costSnapshot: 0, currentPriceSnapshot: 150 }, { kind: "MARKUP_ON_COST", percent: 25 });
  assert.equal(result.price, null);
  assert.ok(result.warning);
});

test("computeBulkPrice — TARGET_MARGIN: 30% de margen objetivo sobre costo 70 -> precio 100", () => {
  const result = computeBulkPrice({ costSnapshot: 70, currentPriceSnapshot: 90 }, { kind: "TARGET_MARGIN", percent: 30 });
  assert.equal(result.warning, null);
  assert.equal(result.price?.toNumber(), 100);
});

test("computeBulkPrice — TARGET_MARGIN: costo nulo -> sin precio y con aviso", () => {
  const result = computeBulkPrice({ costSnapshot: null, currentPriceSnapshot: 90 }, { kind: "TARGET_MARGIN", percent: 30 });
  assert.equal(result.price, null);
  assert.ok(result.warning);
});

test("computeBulkPrice — TARGET_MARGIN: margen >= 100% es inválido (división por cero/negativa)", () => {
  const result = computeBulkPrice({ costSnapshot: 70, currentPriceSnapshot: 90 }, { kind: "TARGET_MARGIN", percent: 100 });
  assert.equal(result.price, null);
  assert.ok(result.warning);
});

test("computeBulkPrice — el redondeo (applyRounding, calculator.ts) se aplica al resultado de la regla", () => {
  // 100 * 1.20 = 120 -> ENDING_99 redondea HACIA ARRIBA a la "...99" más
  // cercana que no quede por debajo del valor (ver roundEnding en
  // calculator.ts): 120 -> 199, no 119.99.
  const result = computeBulkPrice({ costSnapshot: 100, currentPriceSnapshot: 150 }, { kind: "MARKUP_ON_COST", percent: 20, rounding: "ENDING_99" });
  assert.equal(result.price?.toNumber(), 199);
});

test("classifyLine — sin precio nuevo: SKIPPED", () => {
  const result = classifyLine(
    { newPrice: null, costSnapshot: 100, currentPriceSnapshot: 150, priceSourceSnapshot: "BRANCH", productIsActive: true },
    { minMarginPercent: 15 },
  );
  assert.equal(result.status, "SKIPPED");
});

test("classifyLine — sin precio nuevo PERO producto inactivo: BLOCKED gana sobre SKIPPED (createDraft puede detectarlo sin precio)", () => {
  const result = classifyLine(
    { newPrice: null, costSnapshot: 100, currentPriceSnapshot: 150, priceSourceSnapshot: "BRANCH", productIsActive: false },
    { minMarginPercent: 15 },
  );
  assert.equal(result.status, "BLOCKED");
});

test("classifyLine — producto inactivo: BLOCKED", () => {
  const result = classifyLine(
    { newPrice: 200, costSnapshot: 100, currentPriceSnapshot: 150, priceSourceSnapshot: "BRANCH", productIsActive: false },
    { minMarginPercent: 15 },
  );
  assert.equal(result.status, "BLOCKED");
});

test("classifyLine — LA QUE IMPORTA — precio nuevo bajo el costo efectivo: BLOCKED", () => {
  const result = classifyLine(
    { newPrice: 90, costSnapshot: 100, currentPriceSnapshot: 150, priceSourceSnapshot: "BRANCH", productIsActive: true },
    { minMarginPercent: 15 },
  );
  assert.equal(result.status, "BLOCKED");
  assert.match((result as { reason: string }).reason, /menor que el costo/);
});

test("classifyLine — precio nuevo <= 0: BLOCKED", () => {
  const result = classifyLine(
    { newPrice: 0, costSnapshot: 100, currentPriceSnapshot: 150, priceSourceSnapshot: "BRANCH", productIsActive: true },
    { minMarginPercent: 15 },
  );
  assert.equal(result.status, "BLOCKED");
});

test("classifyLine — LA QUE IMPORTA — origen FUSION_DERIVED: BLOCKED, incluso con precio y costo válidos", () => {
  const result = classifyLine(
    { newPrice: 200, costSnapshot: 100, currentPriceSnapshot: 150, priceSourceSnapshot: "FUSION_DERIVED", productIsActive: true },
    { minMarginPercent: 15 },
  );
  assert.equal(result.status, "BLOCKED");
  assert.match((result as { reason: string }).reason, /fusión/);
});

test("classifyLine — LA QUE IMPORTA — margen nuevo bajo el mínimo de categoría: PENDING con aviso", () => {
  // costo 100, precio 110 -> margen ~9%, mínimo de política 15%
  const result = classifyLine(
    { newPrice: 110, costSnapshot: 100, currentPriceSnapshot: 150, priceSourceSnapshot: "BRANCH", productIsActive: true },
    { minMarginPercent: 15 },
  );
  assert.equal(result.status, "PENDING");
  if (result.status === "PENDING") {
    assert.ok(result.warnings.some((w) => w.includes("Margen nuevo")));
  }
});

test("classifyLine — destino GENERAL (minMarginPercent null): no avisa por margen de categoría", () => {
  const result = classifyLine(
    { newPrice: 110, costSnapshot: 100, currentPriceSnapshot: 150, priceSourceSnapshot: "STANDARD", productIsActive: true },
    { minMarginPercent: null },
  );
  assert.equal(result.status, "PENDING");
  if (result.status === "PENDING") {
    assert.ok(!result.warnings.some((w) => w.includes("categoría")));
  }
});

test("classifyLine — LA QUE IMPORTA — salto > 30% contra el precio vigente: PENDING con aviso", () => {
  const result = classifyLine(
    { newPrice: 200, costSnapshot: 100, currentPriceSnapshot: 150, priceSourceSnapshot: "BRANCH", productIsActive: true },
    { minMarginPercent: 15 },
  );
  assert.equal(result.status, "PENDING");
  if (result.status === "PENDING") {
    assert.ok(result.warnings.some((w) => w.includes("Cambio de")));
  }
});

test("classifyLine — producto sin costo: PENDING con aviso de 'sin costo', sin margen calculado", () => {
  const result = classifyLine(
    { newPrice: 150, costSnapshot: null, currentPriceSnapshot: 150, priceSourceSnapshot: "MISSING", productIsActive: true },
    { minMarginPercent: 15 },
  );
  assert.equal(result.status, "PENDING");
  if (result.status === "PENDING") {
    assert.equal(result.marginNew, null);
    assert.ok(result.warnings.some((w) => w.includes("sin costo")));
  }
});

test("classifyLine — todo normal, sin saltos ni margen bajo: PENDING sin avisos", () => {
  const result = classifyLine(
    { newPrice: 155, costSnapshot: 100, currentPriceSnapshot: 150, priceSourceSnapshot: "BRANCH", productIsActive: true },
    { minMarginPercent: 15 },
  );
  assert.equal(result.status, "PENDING");
  if (result.status === "PENDING") {
    assert.equal(result.warnings.length, 0);
  }
});
