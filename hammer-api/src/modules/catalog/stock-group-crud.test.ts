import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { computeFusionMemberGlobalCost, aggregateWeightedAverageCost } from "@/modules/catalog/stock-group-crud";
import { resolveCostChain, resolveFusionMemberCost } from "@/modules/catalog/effective-pricing";

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

/**
 * "las cosas no se ejecutan bien... revisa completo todo" — captura real:
 * grupo ARENA, "Precios y costos" (RIV) mostraba Costo de compra 742.14 y
 * margen -14.2% ("Precio bajo costo"), mientras "Fusiones" mostraba Costo
 * global 470 y margen +20.5% para el MISMO producto (METRO DE ARENA 100P
 * GRANDES) — dos costos y dos márgenes contradictorios. La causa:
 * resolveCostChain (Precios y costos, Brain, POS) prioriza el WAC real de
 * compras SOBRE globalCost — decisión histórica ya establecida ("el WAC
 * real gana sobre el relleno") — pero Fusiones calculaba el margen SOLO
 * con globalCost, ignorando que el WAC ya lo había superado.
 * aggregateWeightedAverageCost es la pieza nueva: el WAC de red (todas
 * las sucursales, ponderado por cantidad) que ahora alimenta
 * effectiveCost — el número real con el que Fusiones calcula el margen.
 */
test("aggregateWeightedAverageCost: promedio ponderado por cantidad entre sucursales — no un promedio simple", () => {
  const result = aggregateWeightedAverageCost([
    { quantityOnHand: 100, weightedAverageCost: 10 },
    { quantityOnHand: 300, weightedAverageCost: 20 },
  ]);
  // (100×10 + 300×20) / 400 = 7000/400 = 17.5 — no (10+20)/2=15
  assert.equal(result, 17.5);
});

test("aggregateWeightedAverageCost: sin ninguna existencia (cantidad total 0) → null, no NaN ni cero", () => {
  assert.equal(aggregateWeightedAverageCost([]), null);
  assert.equal(aggregateWeightedAverageCost([{ quantityOnHand: 0, weightedAverageCost: 50 }]), null);
});

test("Prueba LA QUE IMPORTA (el caso real de la captura) — resolveCostChain + resolveFusionMemberCost (el motor real, docs/COSTO-UNA-FUENTE.md) dan un costo distinto y MAYOR que globalCost cuando hay WAC real de compras", () => {
  // LATA con globalCost=11.75 (lo que se editó en Fusiones) pero un WAC
  // real de compras de 18.55/lata (mayor — compras recientes más caras) —
  // el mismo escenario reportado: 18.55 × 40 ≈ 742, no 11.75 × 40 = 470.
  // Migrado de resolveCatalogDisplayCost (borrada, docs/COSTO-UNA-FUENTE.md
  // Parte B.5) a los dos primitivos que la reemplazan — misma regla,
  // misma expectativa.
  const canonicalCost = resolveCostChain({
    branchCost: null,
    averageCost: new Prisma.Decimal(11.75),
    globalCost: new Prisma.Decimal(11.75),
    lastPurchaseCost: new Prisma.Decimal(11.75),
    weightedAverageCost: new Prisma.Decimal(18.55),
  }, true).cost;
  const effectiveCost = resolveFusionMemberCost(canonicalCost, new Prisma.Decimal(40));
  assert.ok(effectiveCost !== null && Math.abs(Number(effectiveCost) - 742) < 1, `el WAC real (18.55) debe ganar sobre globalCost (11.75) — dio ${effectiveCost?.toString()}`);
  assert.notEqual(Number(effectiveCost), 11.75 * 40, "si esto diera 470, Fusiones seguiría mostrando el margen falso reportado");
});
