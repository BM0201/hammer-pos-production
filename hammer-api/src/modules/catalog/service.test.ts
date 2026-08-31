import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { buildGlobalCostUpdateFields } from "@/modules/catalog/service";

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
