import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { buildGlobalCostUpdateFields, resolveGlobalCostWriteTarget } from "@/modules/catalog/service";

/**
 * prompt-precios-costos-una-sola-fuente.md (LATA: input muestra 25, el
 * margen se calcula con ~39.5) — resolveCatalogDisplayCost Y resolveCostChain
 * (effective-pricing.ts) priorizan averageCost SOBRE globalCost cuando
 * averageCost no es null. updateProduct (edición manual de "Costo de
 * compra") escribía SOLO globalCost — para cualquier producto que alguna
 * vez recibió una compra real (updateGlobalProductCostForReceiptTx deja
 * averageCost != null), la edición manual quedaba tapada para siempre:
 * se guarda, el input muestra el valor nuevo, pero el costo efectivo
 * seguía calculando con el averageCost viejo en TODA la app. Esta prueba
 * es la que confirma que el hueco está cerrado.
 */

const ACTOR = "user-1";
const NOW = new Date("2026-08-31T12:00:00.000Z");

test("Prueba LA QUE IMPORTA — editar globalCost también escribe averageCost al mismo valor", () => {
  const fields = buildGlobalCostUpdateFields({ globalCost: 25, actorUserId: ACTOR, now: NOW });
  assert.equal(fields.globalCost?.toString(), "25");
  assert.equal(fields.averageCost?.toString(), "25", "sin esto, un averageCost viejo (de una compra real anterior) sigue ganando en resolveCatalogDisplayCost/resolveCostChain y la edición queda invisible");
  assert.equal(fields.globalCost?.toString(), fields.averageCost?.toString(), "mismo invariante que updateGlobalProductCostForReceiptTx: globalCost y averageCost son el mismo número siempre");
});

test("globalCost undefined (campo no tocado en este PATCH) → los cinco campos quedan undefined, no se sobreescribe nada", () => {
  const fields = buildGlobalCostUpdateFields({ globalCost: undefined, actorUserId: ACTOR, now: NOW });
  assert.equal(fields.globalCost, undefined);
  assert.equal(fields.averageCost, undefined);
  assert.equal(fields.costUpdatedAt, undefined);
  assert.equal(fields.costUpdatedByUserId, undefined);
  assert.equal(fields.costSource, undefined);
});

test("globalCost null (limpiar el costo) → averageCost también se limpia a null, costSource null (no GLOBAL)", () => {
  const fields = buildGlobalCostUpdateFields({ globalCost: null, actorUserId: ACTOR, now: NOW });
  assert.equal(fields.globalCost, null);
  assert.equal(fields.averageCost, null);
  assert.equal(fields.costSource, null);
  assert.ok(fields.costUpdatedAt instanceof Date, "costUpdatedAt sigue registrando CUÁNDO se limpió, aunque el valor sea null");
});

test("costUpdatedAt/costUpdatedByUserId/costSource se completan igual que antes", () => {
  const fields = buildGlobalCostUpdateFields({ globalCost: 80, actorUserId: ACTOR, now: NOW });
  assert.equal(fields.costUpdatedAt, NOW);
  assert.equal(fields.costUpdatedByUserId, ACTOR);
  assert.equal(fields.costSource, "GLOBAL");
});

test("el valor devuelto es un Prisma.Decimal utilizable, no un number crudo", () => {
  const fields = buildGlobalCostUpdateFields({ globalCost: 39.5, actorUserId: ACTOR, now: NOW });
  assert.ok(fields.globalCost instanceof Prisma.Decimal);
  assert.ok(fields.averageCost instanceof Prisma.Decimal);
});

/**
 * "el ultimo costo que se meta es el que gana en las fusiones... con las
 * derivadas y la factorización equivalente al producto se ajuste" — antes,
 * editar el costo de un miembro DERIVADO rechazaba con
 * FUSION_COST_WRITE_NOT_ALLOWED sin más, obligando a convertir a mano y
 * escribir el resultado en el canónico, en otra pantalla — exactamente el
 * tipo de conversión manual que originó los datos mal cargados de piedrín
 * y arena esta sesión. resolveGlobalCostWriteTarget decide la redirección.
 */
const CANONICAL_ID = "prod-varilla";
const QUINTAL_ID = "prod-quintal";

test("Prueba LA QUE IMPORTA (el ejemplo del usuario) — 1 quintal = 30 varillas, escribir 780 en el quintal redirige a escribir 26 en la varilla (canónico)", () => {
  const result = resolveGlobalCostWriteTarget({
    requestedProductId: QUINTAL_ID,
    enteredCost: 780,
    conversion: { isCanonical: false, canonicalProductId: CANONICAL_ID, conversionFactor: new Prisma.Decimal(30) },
  });
  assert.equal(result.redirected, true);
  assert.equal(result.targetProductId, CANONICAL_ID, "el costo real vive en el canónico, nunca en el derivado — eso no cambia");
  assert.equal(result.costForTarget, 26, "780 / 30 = 26 — la conversión exacta que antes había que hacer a mano");
});

test("editar el CANÓNICO directo → sin redirección, el costo se escribe donde se pidió (comportamiento de siempre)", () => {
  const result = resolveGlobalCostWriteTarget({
    requestedProductId: CANONICAL_ID,
    enteredCost: 26,
    conversion: { isCanonical: true, canonicalProductId: CANONICAL_ID, conversionFactor: new Prisma.Decimal(1) },
  });
  assert.equal(result.redirected, false);
  assert.equal(result.targetProductId, CANONICAL_ID);
  assert.equal(result.costForTarget, 26);
});

test("producto sin fusión (conversion null) → sin redirección, igual que un producto suelto de siempre", () => {
  const result = resolveGlobalCostWriteTarget({ requestedProductId: "prod-suelto", enteredCost: 50, conversion: null });
  assert.equal(result.redirected, false);
  assert.equal(result.targetProductId, "prod-suelto");
  assert.equal(result.costForTarget, 50);
});

test("factor de conversión inválido (0, negativo, o no numérico) → rechaza en vez de dividir por cero o guardar basura", () => {
  for (const badFactor of [0, -5, NaN]) {
    assert.throws(
      () => resolveGlobalCostWriteTarget({
        requestedProductId: QUINTAL_ID,
        enteredCost: 780,
        conversion: { isCanonical: false, canonicalProductId: CANONICAL_ID, conversionFactor: badFactor },
      }),
      /VALIDATION_ERROR/,
    );
  }
});

test("NO es 'el último valor tal cual gana' — reabriría el desfase 18.6× de arena. El valor SIEMPRE se convierte por el factor antes de aplicarse", () => {
  // Caso arena real: LATA (canónico) × 25 = METRO. Si alguien mete 1200 en
  // el METRO, el canónico NO puede terminar en 1200 (eso sería el bug de
  // fondo otra vez) — tiene que terminar en 48 (1200/25), la lata real.
  const result = resolveGlobalCostWriteTarget({
    requestedProductId: "prod-metro",
    enteredCost: 1200,
    conversion: { isCanonical: false, canonicalProductId: "prod-lata", conversionFactor: new Prisma.Decimal(25) },
  });
  assert.equal(result.costForTarget, 48);
  assert.notEqual(result.costForTarget, 1200, "el valor crudo nunca debe terminar pisando el costo del canónico sin convertir");
});
