import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { evaluatePriceDeviationFromFusion, PRODUCT_PRICE_DEVIATION_THRESHOLD } from "@/modules/catalog/service";
import { resolveEffectivePricingFromParts } from "@/modules/catalog/effective-pricing";
import type { FusionMemberPricingBasis } from "@/modules/catalog/effective-pricing";
import { Prisma } from "@prisma/client";

/**
 * "que el precio de venta no se mueva solo. Ninguna escritura de precio
 * puede propagarse a otros productos sin que alguien lo confirme" — Parte
 * A. Sin DATABASE_URL en este entorno (constante en toda la sesión),
 * updateProduct en sí (usa `prisma` global directo, no un `tx` inyectable
 * como createInventoryMovementTx) no se puede probar de punta a punta acá.
 * Se prueban dos cosas SÍ verificables sin DB:
 *   - Estructural: el código YA NO tiene con qué redirigir el precio (el
 *     bloque `priceRedirect`/`canonicalPriceFields` no existe más), y el
 *     redirect de costo SIGUE intacto (regresión de la Parte protegida).
 *   - Pura: evaluatePriceDeviationFromFusion, la función que decide el
 *     aviso A.2/A.3, extraída de updateProduct exactamente por esto.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICE_SRC = readFileSync(resolve(__dirname, "service.ts"), "utf8");

function d(n: number) {
  return new Prisma.Decimal(n);
}

const FUSION_BASE: FusionMemberPricingBasis = {
  conversionFactor: d(25),
  canonicalBranchCost: null,
  canonicalAverageCost: null,
  canonicalGlobalCost: null,
  canonicalLastPurchaseCost: null,
  canonicalBaseWeightedAverageCost: d(18.55),
  canonicalBranchPrice: null,
  canonicalStandardSalePrice: d(30),
};

test("1. ESTE ES EL TEST QUE IMPORTA — el código ya no tiene ningún mecanismo para redirigir standardSalePrice al canónico", () => {
  assert.ok(!SERVICE_SRC.includes("priceRedirect"), "el bloque priceRedirect debe estar eliminado por completo (Parte A.1)");
  assert.ok(!SERVICE_SRC.includes("canonicalPriceFields"), "ya no debe existir ninguna escritura de standardSalePrice hacia el canónico");
  // La escritura al producto SOLICITADO ya no depende de si hubo redirect —
  // standardSalePriceForRequested se resuelve solo con input.standardSalePrice.
  assert.match(
    SERVICE_SRC,
    /const standardSalePriceForRequested = input\.standardSalePrice === undefined\s*\n\s*\? undefined\s*\n\s*: new Prisma\.Decimal\(input\.standardSalePrice\);/,
    "standardSalePrice debe escribirse siempre en el producto solicitado, sin condicionar a redirect",
  );
});

test("2. Dos presentaciones derivadas de la misma fusión, con precios propios distintos, resuelven precios efectivos independientes (no se contaminan entre sí)", () => {
  const metro100 = resolveEffectivePricingFromParts({
    productId: "metro-100p",
    standardSalePrice: d(650), // precio propio de ESTA presentación
    globalCost: null, averageCost: null, lastPurchaseCost: null,
    branchPrice: null, branchCost: null, weightedAverageCost: null,
    fusion: { ...FUSION_BASE, conversionFactor: d(25) },
  });
  const metro220 = resolveEffectivePricingFromParts({
    productId: "metro-220p",
    standardSalePrice: d(1450), // precio propio DISTINTO de la otra presentación
    globalCost: null, averageCost: null, lastPurchaseCost: null,
    branchPrice: null, branchCost: null, weightedAverageCost: null,
    fusion: { ...FUSION_BASE, conversionFactor: d(55) },
  });
  assert.equal(metro100.effectivePrice?.toNumber(), 650);
  assert.equal(metro220.effectivePrice?.toNumber(), 1450);
  assert.notEqual(metro100.effectivePrice?.toNumber(), metro220.effectivePrice?.toNumber());
});

test("9. Los tres miembros de un grupo de fusión (ARENA_2), con precios propios distintos, mantienen esos precios sin importar el orden en que se lean — ninguno se contamina con el de otro", () => {
  const canonical = resolveEffectivePricingFromParts({
    productId: "lata-arena-2",
    standardSalePrice: d(35), // el canónico usa su propia cadena, no `fusion`
    globalCost: null, averageCost: null, lastPurchaseCost: null,
    branchPrice: null, branchCost: null, weightedAverageCost: null,
    fusion: null,
  });
  const metroA = resolveEffectivePricingFromParts({
    productId: "metro-a-arena-2",
    standardSalePrice: d(650),
    globalCost: null, averageCost: null, lastPurchaseCost: null,
    branchPrice: null, branchCost: null, weightedAverageCost: null,
    fusion: { ...FUSION_BASE, conversionFactor: d(25), canonicalStandardSalePrice: d(35) },
  });
  const metroB = resolveEffectivePricingFromParts({
    productId: "metro-b-arena-2",
    standardSalePrice: d(1900),
    globalCost: null, averageCost: null, lastPurchaseCost: null,
    branchPrice: null, branchCost: null, weightedAverageCost: null,
    fusion: { ...FUSION_BASE, conversionFactor: d(55), canonicalStandardSalePrice: d(35) },
  });
  assert.equal(canonical.effectivePrice?.toNumber(), 35);
  assert.equal(metroA.effectivePrice?.toNumber(), 650);
  assert.equal(metroB.effectivePrice?.toNumber(), 1900);
  const prices = [canonical.effectivePrice?.toNumber(), metroA.effectivePrice?.toNumber(), metroB.effectivePrice?.toNumber()];
  assert.equal(new Set(prices).size, 3, "los tres deben quedar distintos entre sí — ninguno se pisó con el de otro");
});

test("3. Regresión protegida — editar globalCost en un derivado SIGUE redirigiendo al canónico (NO se tocó esa parte)", () => {
  assert.ok(SERVICE_SRC.includes("resolveGlobalCostWriteTarget"), "el redirect de costo debe seguir existiendo");
  assert.match(
    SERVICE_SRC,
    /if \(input\.globalCost !== undefined && input\.globalCost !== null\) \{\s*\n\s*const resolved = resolveGlobalCostWriteTarget/,
    "globalCost debe seguir pasando por resolveGlobalCostWriteTarget exactamente como antes",
  );
  // Y la escritura al producto solicitado sigue condicionada a costRedirect
  // (a diferencia de standardSalePrice, que ya no lo está — test 1).
  assert.match(SERVICE_SRC, /const globalCostFields = costRedirect\s*\n\s*\?/);
});

/**
 * Tests 4, 5, 6 — evaluatePriceDeviationFromFusion, la pieza pura extraída
 * del guard A.2/A.3 (mismo principio que detectExcessiveWacJump).
 */
test("4. Precio con más de 15% de desvío respecto del implícito → deviates=true, mensaje PRICE_DEVIATES_FROM_FUSION", () => {
  // Implícito: 30 × 25 = 750. Entrado: 650 → desvío = |650-750|/750 = 13.3%... hace falta más.
  // METRO 100P real de la sesión: costo 18.55×40≈742, precio 650 vs implícito
  // (30×40=1200) — desvío enorme, el caso real reportado.
  const result = evaluatePriceDeviationFromFusion({
    enteredPrice: 650,
    canonicalStandardSalePrice: 30,
    conversionFactor: 40,
    effectiveCost: null,
  });
  assert.equal(result.impliedPrice, 1200);
  assert.ok(result.deviationPercent! > PRODUCT_PRICE_DEVIATION_THRESHOLD * 100);
  assert.equal(result.deviates, true);
  assert.ok(result.message?.startsWith("PRICE_DEVIATES_FROM_FUSION:"));
  assert.ok(result.message?.includes("1200.00"));
  assert.ok(result.message?.includes("650.00"));
});

test("desvío por debajo del 15% → deviates=false, no hay mensaje (descuento por volumen normal, no exige confirmación)", () => {
  const result = evaluatePriceDeviationFromFusion({
    enteredPrice: 700, // implícito 750 → 6.7% de desvío
    canonicalStandardSalePrice: 30,
    conversionFactor: 25,
    effectiveCost: null,
  });
  assert.equal(result.deviates, false);
  assert.equal(result.message, null);
});

test("5. Con confirmed=true (el flag de confirmación) → deviates=false aunque el desvío sea enorme, se aplica sin bloquear", () => {
  const result = evaluatePriceDeviationFromFusion({
    enteredPrice: 1,
    canonicalStandardSalePrice: 30,
    conversionFactor: 40, // implícito 1200, entrado 1 — desvío casi total
    effectiveCost: null,
    confirmed: true,
  });
  assert.equal(result.deviates, false, "confirmed=true es el reintento explícito — mismo patrón que allowLargeWacJump/overridePriceConfirmed");
});

test("6. Precio bajo el costo efectivo → el mensaje incluye la pérdida por unidad, con los montos exactos", () => {
  // El caso real de la captura: METRO 100P, costo efectivo 742.14, precio
  // tecleado 650 → pierde 92.14 por metro.
  const result = evaluatePriceDeviationFromFusion({
    enteredPrice: 650,
    canonicalStandardSalePrice: 30,
    conversionFactor: 40, // implícito 1200 — dispara el desvío igual
    effectiveCost: 742.14,
  });
  assert.equal(result.deviates, true);
  assert.ok(result.message?.includes("perdés C$92.14"), `debe decir la pérdida por unidad — mensaje real: ${result.message}`);
  assert.ok(result.message?.includes("A C$650.00"));
  assert.ok(result.message?.includes("costo C$742.14"));
});

test("precio bajo el costo, pero SIN desvío de fusión (precio ~= implícito) → no dispara el aviso (A.2 y A.3 comparten el mismo gate de desvío)", () => {
  // El implícito YA está bajo costo (el canónico mismo está mal fijado) —
  // esto no es un caso que A.2/A.3 cubran (esa comparación es harina de
  // otro costal — assertPriceNotBelowCost, sin tocar); acá solo se
  // confirma que sin desvío >15%, este guard específico no interviene.
  const result = evaluatePriceDeviationFromFusion({
    enteredPrice: 1195,
    canonicalStandardSalePrice: 30,
    conversionFactor: 40, // implícito 1200, entrado 1195 → 0.4% de desvío
    effectiveCost: 1400, // igual está bajo costo, pero no es asunto de este guard
  });
  assert.equal(result.deviates, false);
});
