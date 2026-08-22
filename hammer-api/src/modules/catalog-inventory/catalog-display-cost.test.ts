import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { resolveCatalogDisplayCost } from "./service";

/**
 * Estos tests cubren el BUG reportado: en las fusiones de costo sobre precio
 * (ej. ARENA), el catálogo "precios y costos" mostraba un costo distinto al que
 * el motor de venta usa realmente, porque IGNORABA el WAC (costo promedio
 * ponderado). Al comprar arena por CAMIONADA y AJUSTAR el stock físico (en
 * latas) se actualiza el WAC del canónico (LATA), pero NO
 * averageCost/globalCost/lastPurchaseCost (solo las recepciones de OC lo hacen).
 *
 * resolveCatalogDisplayCost debe priorizar: WAC(>0) > averageCost > globalCost >
 * lastPurchaseCost, escalando por factor para los miembros derivados, quedando
 * coherente con modules/catalog/effective-pricing.ts → resolveCostChain.
 */

const d = (v: number) => new Prisma.Decimal(v);

test("usa el WAC con prioridad sobre averageCost/globalCost/lastPurchaseCost", () => {
  // WAC real 18.55/lata; los campos propios están viejos (5) → gana el WAC.
  const cost = resolveCatalogDisplayCost({
    wac: 18.55,
    averageCost: d(5),
    globalCost: d(1),
    lastPurchaseCost: d(2),
  });
  assert.equal(cost, 18.55);
});

test("ARENA derivada: costo = WAC del canónico (LATA) × factor", () => {
  // Canónico LATA con WAC 18.55/lata; METRO GRANDE = 25 latas, METRO PEQUEÑA = 55.
  const metroGrande = resolveCatalogDisplayCost({
    wac: 18.55, // WAC base (por lata) del canónico
    averageCost: 0, // costo global del canónico (respaldo), aún sin recepción de OC
    globalCost: undefined,
    lastPurchaseCost: undefined,
    factor: 25,
  });
  assert.equal(metroGrande, 18.55 * 25);

  const metroPequena = resolveCatalogDisplayCost({
    wac: 18.55,
    averageCost: 0,
    globalCost: undefined,
    lastPurchaseCost: undefined,
    factor: 55,
  });
  assert.equal(metroPequena, 18.55 * 55);
});

test("un WAC de 0 significa 'no sé' y se ignora (cae al costo propio)", () => {
  const cost = resolveCatalogDisplayCost({
    wac: 0,
    averageCost: d(7.5),
    globalCost: d(1),
    lastPurchaseCost: d(2),
  });
  assert.equal(cost, 7.5);
});

test("sin WAC (null) usa la cadena averageCost > globalCost > lastPurchaseCost", () => {
  assert.equal(
    resolveCatalogDisplayCost({ wac: null, averageCost: d(9), globalCost: d(3), lastPurchaseCost: d(4) }),
    9,
  );
  assert.equal(
    resolveCatalogDisplayCost({ wac: null, averageCost: null, globalCost: d(3), lastPurchaseCost: d(4) }),
    3,
  );
  assert.equal(
    resolveCatalogDisplayCost({ wac: null, averageCost: null, globalCost: null, lastPurchaseCost: d(4) }),
    4,
  );
});

test("sin ningún costo devuelve 0 (marca 'sin costo')", () => {
  const cost = resolveCatalogDisplayCost({
    wac: null,
    averageCost: null,
    globalCost: null,
    lastPurchaseCost: null,
  });
  assert.equal(cost, 0);
});

test("derivado con WAC del canónico marca costo > 0 (ya no figura 'sin costo')", () => {
  // Antes: METRO derivaba de sus propios campos (0) → aparecía como 'sin costo'
  // aunque la LATA tuviera WAC. Ahora el WAC del canónico lo salva.
  const cost = resolveCatalogDisplayCost({
    wac: 18.55,
    averageCost: 0,
    globalCost: undefined,
    lastPurchaseCost: undefined,
    factor: 25,
  });
  assert.ok(cost > 0);
});

test("factor no finito o ausente se trata como 1", () => {
  assert.equal(
    resolveCatalogDisplayCost({ wac: 10, averageCost: null, globalCost: null, lastPurchaseCost: null }),
    10,
  );
  assert.equal(
    resolveCatalogDisplayCost({ wac: 10, averageCost: null, globalCost: null, lastPurchaseCost: null, factor: Number.NaN }),
    10,
  );
});
