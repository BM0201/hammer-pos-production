import assert from "node:assert/strict";
import test from "node:test";
import { computeFusionMemberGlobalCost } from "@/modules/catalog/stock-group-crud";

/**
 * "es para poner el precio... una nueva linea que sea costo global de
 * fusiones, para que se entienda y no exista problemas con el WAC,
 * basandose solo en eso" — el apartado Fusiones (Catálogo e Inventario)
 * muestra el costo de compra por presentación basado ÚNICAMENTE en
 * globalCost (nunca WAC, averageCost ni branchCost — esos son los que
 * generaron la confusión de sesiones anteriores). computeFusionMemberGlobalCost
 * es la lectura pura de esa regla — la contraparte de resolveGlobalCostWriteTarget
 * (catalog/service.ts), que es la escritura.
 */

test("Prueba LA QUE IMPORTA — canónico con globalCost 26, derivado factor 30 → 26 × 30 = 780, nada de WAC en el medio", () => {
  const result = computeFusionMemberGlobalCost({
    isCanonical: false,
    ownGlobalCost: null, // un derivado NUNCA tiene su propio costo — no se lee aunque existiera
    canonicalGlobalCost: 26,
    conversionFactor: 30,
  });
  assert.equal(result, 780);
});

test("canónico → devuelve su propio globalCost tal cual, sin multiplicar por factor", () => {
  const result = computeFusionMemberGlobalCost({
    isCanonical: true,
    ownGlobalCost: 26,
    canonicalGlobalCost: 26,
    conversionFactor: 1,
  });
  assert.equal(result, 26);
});

test("canónico sin costo cargado (null) → null, no cero — cero sería un costo real, null es 'nadie lo puso'", () => {
  const result = computeFusionMemberGlobalCost({ isCanonical: true, ownGlobalCost: null, canonicalGlobalCost: null, conversionFactor: 1 });
  assert.equal(result, null);
});

test("derivado cuando el canónico no tiene costo cargado → null (no se puede derivar de la nada)", () => {
  const result = computeFusionMemberGlobalCost({
    isCanonical: false,
    ownGlobalCost: null,
    canonicalGlobalCost: null,
    conversionFactor: 30,
  });
  assert.equal(result, null);
});

test("un derivado con ownGlobalCost propio (dato viejo/corrupto, no debería existir) se IGNORA — siempre gana canonicalGlobalCost × factor", () => {
  const result = computeFusionMemberGlobalCost({
    isCanonical: false,
    ownGlobalCost: 999, // basura que no debería estar ahí — la regla de "el derivado nunca guarda su costo" sigue firme
    canonicalGlobalCost: 26,
    conversionFactor: 30,
  });
  assert.equal(result, 780, "el campo propio del derivado se ignora siempre, exactamente la regla que corrigió el desfase 18.6× de arena");
});

test("caso real de arena: LATA (canónico) × 25 = METRO → 48 × 25 = 1200", () => {
  const result = computeFusionMemberGlobalCost({ isCanonical: false, ownGlobalCost: null, canonicalGlobalCost: 48, conversionFactor: 25 });
  assert.equal(result, 1200);
});

/**
 * "no trae el precio de venta como deberia ser... no hace los ajustes que
 * corresponde" (captura real: grupo ARENA, LATA con standardSalePrice
 * 1.00, METRO GRANDE mostrando "Precio general: C$1.00" también, margen
 * -58081.8%) — resolveEffectivePricing (effective-pricing.ts) NUNCA lee
 * el standardSalePrice propio de un derivado: su precio implícito es
 * SIEMPRE canonicalStandardSalePrice × factor (impliedFusionPrice), la
 * MISMA regla que el costo. computeFusionMemberGlobalCost es genérica —
 * no sabe si el número que recibe es costo o precio — así que listStockGroups
 * la reusa tal cual para standardSalePrice, en vez de leer el campo propio
 * de cada miembro (lo que producía el "C$1.00" fantasma en la captura).
 */
test("Prueba LA QUE IMPORTA (el caso real de la captura) — el precio implícito de un derivado es canonicalStandardSalePrice × factor, igual que el costo, no su propio campo", () => {
  // LATA con standardSalePrice=1.00 (el placeholder real de la captura),
  // METRO GRANDE con factor 40 → precio implícito 40, no el "1.00" que
  // mostraba antes (el campo propio del derivado, fantasma para el motor).
  const impliedPrice = computeFusionMemberGlobalCost({
    isCanonical: false,
    ownGlobalCost: 1, // standardSalePrice propio del derivado — se ignora, igual que su costo propio
    canonicalGlobalCost: 1, // standardSalePrice del canónico (LATA) — el placeholder real reportado
    conversionFactor: 40,
  });
  assert.equal(impliedPrice, 40, "el margen que se calcule con esto va a seguir siendo malo (LATA a C$1 es un placeholder real, no un bug) pero al menos matemáticamente correcto — antes ni siquiera hacía la multiplicación");
});

test("el canónico SÍ usa su propio standardSalePrice — es el que define el precio implícito de todo el grupo", () => {
  const price = computeFusionMemberGlobalCost({ isCanonical: true, ownGlobalCost: 35, canonicalGlobalCost: 35, conversionFactor: 1 });
  assert.equal(price, 35);
});
