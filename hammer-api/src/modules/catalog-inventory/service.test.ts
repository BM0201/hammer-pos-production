import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { computeHasNoPrice, resolveCostScope, computeEffectiveCostFields, computeStockSummary } from "@/modules/catalog-inventory/service";

/**
 * Parte A (prompt-precios-vigentes-catalogo.md) — ESTE ES EL TEST QUE
 * IMPORTA: Array.every sobre un arreglo vacío da true, así que un producto
 * SIN ninguna fila BranchProductSetting (el caso normal: sigue el precio
 * general en todas las sucursales) quedaba marcado "sin precio". La
 * condición vieja tampoco miraba standardSalePrice — el precio general que
 * effective-pricing.ts resuelve como STANDARD.
 */

test("Test 1 (LA QUE IMPORTA) — standardSalePrice > 0 y CERO BranchProductSetting → hasNoPrice false", () => {
  assert.equal(computeHasNoPrice(100, []), false, "sigue el precio general — no está sin precio");
});

test("Test 2 — sin standardSalePrice y sin ningún branchPrice → hasNoPrice true", () => {
  assert.equal(computeHasNoPrice(0, [0, 0]), true);
  assert.equal(computeHasNoPrice(0, []), true, "también sin ninguna fila de sucursal");
});

test("Test 3 — sin standardSalePrice pero con branchPrice en una sucursal → hasNoPrice false", () => {
  assert.equal(computeHasNoPrice(0, [0, 150, 0]), false, "una sola sucursal con precio propio alcanza");
});

test("standardSalePrice > 0 Y branchPrice en alguna sucursal → sigue false (caso normal doble)", () => {
  assert.equal(computeHasNoPrice(100, [0, 90]), false);
});

/**
 * docs/COSTO-UNA-FUENTE.md, ciclo de blindaje — resolveCostScope,
 * computeEffectiveCostFields y computeStockSummary son las funciones
 * PURAS y exportadas que getCatalogInventoryCenter llama de verdad
 * (líneas 155/310 de service.ts) — no una reimplementación de mano acá.
 * getCatalogInventoryCenter en sí no se prueba de punta a punta: usa
 * `prisma` importado directo (sin cliente inyectable) y este repo no
 * corre contra una base de datos real en test (sin DATABASE_URL); mismo
 * límite ya documentado en cost-convergence.test.ts. Lo que SÍ se puede
 * y se prueba acá es exactamente la lógica que causó el bug: la
 * sucursal de costo nunca debe caer a branches[0].
 */

const BRANCHES = [
  { id: "branch-1", name: "Rivas" },
  { id: "branch-2", name: "Managua" },
];

test("Test 1 (LA QUE IMPORTA) — sin branchId, costScope es NETWORK y effectiveCost/hasNoCost NO leen el costo de branches[0]", () => {
  const { costBranchId, costScope } = resolveCostScope(undefined, BRANCHES);
  assert.equal(costScope, "NETWORK");
  assert.equal(costBranchId, null);

  // El bug real: computeEffectiveCostFields recibía costBranchId=null pero
  // ANTES la orquestación ya había resuelto costBranchId a branches[0] y
  // le pasaba un costo real. Acá se simula ese costo real (lo que
  // branches[0] SÍ tendría resuelto) y se confirma que, con costBranchId
  // null, igual sale null — nunca ese número, nunca 0 de relleno.
  const costoQueBranchesCeroSiTendria = new Prisma.Decimal(742.14);
  const { effectiveCost, hasNoCost } = computeEffectiveCostFields(costBranchId, costoQueBranchesCeroSiTendria);
  assert.equal(effectiveCost, null, "sin sucursal elegida, el costo de branches[0] NUNCA debe aparecer");
  assert.equal(hasNoCost, false, "hasNoCost NUNCA true por ausencia de sucursal — no es una conclusión que se pueda sacar sin haber consultado ninguna");
});

test("Test 2 — sin branchId, el stock total sigue sumando todas las sucursales (computeStockSummary no depende de costBranchId)", () => {
  const balances = [
    { quantityOnHand: new Prisma.Decimal(30), inventoryValue: new Prisma.Decimal(300) },
    { quantityOnHand: new Prisma.Decimal(70), inventoryValue: new Prisma.Decimal(700) },
  ];
  const { totalStock, totalValue, branchesWithStock } = computeStockSummary(balances);
  assert.equal(totalStock, 100, "suma de todas las sucursales, con o sin sucursal elegida");
  assert.equal(totalValue, 1000);
  assert.equal(branchesWithStock, 2);
});

test("Test 3 — con branchId, costScope es BRANCH y costBranchId es igual al pedido", () => {
  const { costBranchId, costScope, costBranchName } = resolveCostScope("branch-2", BRANCHES);
  assert.equal(costScope, "BRANCH");
  assert.equal(costBranchId, "branch-2");
  assert.equal(costBranchName, "Managua");
});

test("Test 4 (LA QUE PRUEBA QUE EL FALLBACK MURIÓ) — con branchId de una sucursal que NO es branches[0], el costo es el de ESA sucursal", () => {
  // branches[0] es branch-1 (Rivas) — se pide branch-2 (Managua) a propósito.
  const { costBranchId } = resolveCostScope("branch-2", BRANCHES);
  assert.equal(costBranchId, "branch-2", "no cae a branches[0] (branch-1)");
  assert.notEqual(costBranchId, BRANCHES[0].id);

  // Simula un mapa de pricing con costos DISTINTOS por sucursal — si el
  // fallback existiera, esto devolvería el costo de branch-1 (999) en vez
  // del de branch-2 (55), pedido explícito.
  const pricingByKey = new Map<string, Prisma.Decimal>([
    [`branch-1:prod-1`, new Prisma.Decimal(999)],
    [`branch-2:prod-1`, new Prisma.Decimal(55)],
  ]);
  const { effectiveCost } = computeEffectiveCostFields(costBranchId, pricingByKey.get(`${costBranchId}:prod-1`));
  assert.equal(effectiveCost, 55, "el costo de branch-2, NO el de branches[0] (branch-1, que hubiera dado 999)");
});

test("Test 5 — branches vacío no rompe y devuelve NETWORK", () => {
  const { costBranchId, costScope, costBranchName } = resolveCostScope(undefined, []);
  assert.equal(costScope, "NETWORK");
  assert.equal(costBranchId, null);
  assert.equal(costBranchName, null);
});

test("branches vacío con un branchId pedido igual no rompe (costBranchName cae a null, no truena buscando en un arreglo vacío)", () => {
  const { costBranchId, costScope, costBranchName } = resolveCostScope("branch-fantasma", []);
  assert.equal(costScope, "BRANCH");
  assert.equal(costBranchId, "branch-fantasma");
  assert.equal(costBranchName, null);
});

/**
 * "Test de forma de respuesta" — la clase de bug de este ciclo no fue un
 * cálculo distinto, fue que la respuesta llevaba DOS costos y la
 * pantalla leía el equivocado. Acá se prueba que la fila (effectiveCost,
 * vía computeEffectiveCostFields) y branchEffectivePricing[] (el array
 * por sucursal) NO PUEDEN divergir porque los dos leen literalmente el
 * mismo pricing.effectiveCost del mismo branchPricingByKey.get(...) —
 * verificado en el código fuente real: service.ts:155 (fila) y
 * service.ts:401/404 (branchEffectivePricing), misma clave
 * `${branchId}:${productId}`, misma transformación
 * `pricing?.effectiveCost != null ? Number(pricing.effectiveCost) : null`.
 * Antes de este ciclo, la fila usaba una cascada DISTINTA
 * (resolveCatalogDisplayCost, sin branchCost) — eso sí podía divergir, y
 * fue exactamente el bug reportado (LATA: input mostraba branchCost,
 * calificaba con baseCost).
 */
test("forma de respuesta: effectiveCost de la fila y branchEffectivePricing[].effectiveCost derivan del MISMO valor crudo — no pueden mostrar dos costos distintos", () => {
  const rawPricingEffectiveCost = new Prisma.Decimal(463.75);

  // La transformación que aplica la fila (computeEffectiveCostFields).
  const { effectiveCost: rowEffectiveCost } = computeEffectiveCostFields("branch-1", rawPricingEffectiveCost);

  // La MISMA transformación que aplica branchEffectivePricing[] en
  // getCatalogInventoryCenter (service.ts:404) — replicada acá solo para
  // comparar, no reimplementada como lógica de negocio nueva.
  const branchEntryEffectiveCost = rawPricingEffectiveCost != null ? Number(rawPricingEffectiveCost) : null;

  assert.equal(rowEffectiveCost, branchEntryEffectiveCost, "misma fuente cruda, mismo número — nunca dos costos distintos en una fila");
});
