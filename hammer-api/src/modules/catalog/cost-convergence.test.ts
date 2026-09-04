import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { getEffectiveProductPricingBatch, resolveCostChain, resolveFusionMemberCost } from "@/modules/catalog/effective-pricing";

/**
 * docs/COSTO-UNA-FUENTE.md, Parte D — "el entregable más importante del
 * ciclo": para el MISMO producto y la MISMA sucursal, todas las pantallas
 * que muestran un costo tienen que devolver el mismo número.
 *
 * Por qué este archivo prueba `getEffectiveProductPricingBatch` (y, para
 * fusión, `resolveCostChain`+`resolveFusionMemberCost` directo) en vez de
 * ejecutar de punta a punta cada endpoint: ninguno de los módulos de
 * abajo acepta un cliente de base de datos inyectable (a diferencia de
 * `getEffectiveProductPricingBatch`, diseñado para eso — ver
 * `effective-pricing.test.ts` → `createCountingFakeDb`) y este repo no
 * corre contra una base de datos real en test (sin DATABASE_URL en este
 * entorno; toda la suite existente es de funciones puras o con Prisma
 * simulado). Lo verificable sin DB, y lo que de verdad importa, es que
 * NINGUNO de los cinco reimplementa su propia cascada — todos delegan en
 * la MISMA función:
 *
 *   - catalog-inventory/service.ts → getCatalogInventoryCenter (Catálogo
 *     e Inventario): llama a getEffectiveProductPricingBatch directo
 *     (línea ~372, desde docs/COSTO-UNA-FUENTE.md Parte B.1+B.2).
 *   - pricing/current-prices-service.ts (Precios vigentes): llama a
 *     getEffectiveProductPricingBatch directo (línea 2 del import, su
 *     propio comentario: "el mismo motor que cobra el POS").
 *   - brain/detectors/pricing-detector.ts (Bandeja de precios): llama a
 *     getEffectiveProductPricingBatch directo (línea 96).
 *   - sales/service.ts (motor de venta): llama a getEffectiveProductPricing
 *     directo (líneas 276, 454) — la versión no-batch, misma función
 *     resolveEffectivePricing por dentro.
 *   - catalog/stock-group-crud.ts → listStockGroups (Fusiones): desde la
 *     Parte B.3, llama a resolveCostChain + resolveFusionMemberCost
 *     directo (sin getEffectiveProductPricingBatch porque Fusiones no
 *     tiene branchId — no hay una sola sucursal a la que atribuirle
 *     branchCost, ver docs/COSTO-UNA-FUENTE.md #7). Los tests de fusión
 *     de acá prueban ESOS DOS PRIMITIVOS con los mismos datos crudos que
 *     alimentan a getEffectiveProductPricingBatch, y confirman que el
 *     número coincide — la prueba real de que Fusiones y el resto de las
 *     pantallas convergen aunque tomen caminos de código distintos.
 *
 * Si alguna de esas cinco líneas cambiara para reimplementar su propia
 * cascada, ESTE archivo no lo detectaría solo — pero
 * docs/COSTO-UNA-FUENTE.md Parte C (grep de conversionFactor sobre algo
 * de costo) sí, y debe repetirse si se toca cualquiera de esos módulos.
 */

function d(v: number | null) {
  return v === null ? null : new Prisma.Decimal(v);
}

const BRANCH_ID = "branch-rivas";

type FakeProduct = { id: string; standardSalePrice: Prisma.Decimal; globalCost: Prisma.Decimal | null; averageCost: Prisma.Decimal | null; lastPurchaseCost: Prisma.Decimal | null };
type FakeSetting = { branchId: string; productId: string; branchPrice: Prisma.Decimal | null; branchCost: Prisma.Decimal | null };
type FakeBalance = { branchId: string; productId: string; weightedAverageCost: Prisma.Decimal | null };
type FakeMember = {
  productId: string;
  stockGroupId: string;
  saleUnit: string;
  conversionFactor: Prisma.Decimal;
  isCanonical: boolean;
  stockGroup: {
    code: string;
    name: string;
    baseUnit: string;
    packageUnit: string | null;
    conversionFactorToBase: Prisma.Decimal | null;
    tracksPackages: boolean;
    approximateFactor: boolean;
    minimumClosedPackageReserve: Prisma.Decimal;
    autoOpenForUnitSale: boolean;
    products: Array<{ productId: string; isCanonical: boolean; conversionFactor: Prisma.Decimal }>;
  };
};

// ── Escenario único, compartido por todos los casos — un producto suelto
// con WAC, uno suelto con branchCost, y una fusión ARENA (LATA canónico
// + dos derivados con factores distintos), cada uno con "trampas" en sus
// propios campos de costo que un motor incorrecto tomaría por error. ──

const PRODUCTS: FakeProduct[] = [
  { id: "prod-suelto-wac", standardSalePrice: d(100)!, globalCost: null, averageCost: null, lastPurchaseCost: null },
  // Trampas: globalCost/averageCost altos que NO deben ganar — branchCost manda.
  { id: "prod-suelto-branchcost", standardSalePrice: d(100)!, globalCost: d(200), averageCost: d(200), lastPurchaseCost: d(200) },
  { id: "prod-lata", standardSalePrice: d(30)!, globalCost: null, averageCost: null, lastPurchaseCost: null },
  // Trampa clásica (el bug real de arena): un globalCost de relleno tecleado a mano en el derivado.
  { id: "prod-metro-40", standardSalePrice: d(650)!, globalCost: d(1), averageCost: null, lastPurchaseCost: null },
  { id: "prod-metro-44", standardSalePrice: d(700)!, globalCost: d(999), averageCost: null, lastPurchaseCost: null },
  { id: "prod-sin-costo", standardSalePrice: d(50)!, globalCost: null, averageCost: null, lastPurchaseCost: null },
];

const SETTINGS: FakeSetting[] = [
  { branchId: BRANCH_ID, productId: "prod-suelto-branchcost", branchPrice: null, branchCost: d(55) },
  { branchId: BRANCH_ID, productId: "prod-lata", branchPrice: null, branchCost: d(20) },
];

const BALANCES: FakeBalance[] = [
  { branchId: BRANCH_ID, productId: "prod-suelto-wac", weightedAverageCost: d(80) },
  // Trampa: WAC alto que branchCost debe ganarle.
  { branchId: BRANCH_ID, productId: "prod-suelto-branchcost", weightedAverageCost: d(999) },
  // El balance de la LATA (canónico) es el que consultan tanto la LATA como sus derivados —
  // otra trampa: si esto ganara sobre branchCost, el caso 3 fallaría.
  { branchId: BRANCH_ID, productId: "prod-lata", weightedAverageCost: d(999) },
];

const ARENA_GROUP_PRODUCTS = [
  { productId: "prod-lata", isCanonical: true, conversionFactor: d(1)! },
  { productId: "prod-metro-40", isCanonical: false, conversionFactor: d(40)! },
  { productId: "prod-metro-44", isCanonical: false, conversionFactor: d(44)! },
];

function makeMember(productId: string, isCanonical: boolean, conversionFactor: Prisma.Decimal): FakeMember {
  return {
    productId,
    stockGroupId: "group-arena",
    saleUnit: isCanonical ? "LATA" : "METRO",
    conversionFactor,
    isCanonical,
    stockGroup: {
      code: "ARENA",
      name: "Arena",
      baseUnit: "LATA",
      packageUnit: null,
      conversionFactorToBase: null,
      tracksPackages: false,
      approximateFactor: false,
      minimumClosedPackageReserve: d(1)!,
      autoOpenForUnitSale: false,
      products: ARENA_GROUP_PRODUCTS,
    },
  };
}

const MEMBERS: FakeMember[] = [
  makeMember("prod-lata", true, d(1)!),
  makeMember("prod-metro-40", false, d(40)!),
  makeMember("prod-metro-44", false, d(44)!),
];

function createFakeDb() {
  return {
    productStockGroupMember: { findMany: async () => MEMBERS },
    product: { findMany: async () => PRODUCTS },
    branchProductSetting: { findMany: async () => SETTINGS },
    inventoryBalance: { findMany: async () => BALANCES },
    // prompt-wac-desactivar.md — getEffectiveProductPricingBatch ahora
    // también lee isWacDrivesCostChainEnabled(db). Este archivo predata el
    // flag y cada caso (los "trampa" de WAC alto que debe ganar/perder)
    // asume WAC activo — value:"true" preserva esa intención original.
    systemSetting: { findUnique: async () => ({ value: "true" }) },
  } as unknown as Prisma.TransactionClient;
}

async function effectiveCostFor(productId: string): Promise<number | null> {
  const result = await getEffectiveProductPricingBatch(createFakeDb(), [{ branchId: BRANCH_ID, productId }]);
  const pricing = result.get(`${BRANCH_ID}:${productId}`);
  return pricing?.effectiveCost != null ? pricing.effectiveCost.toNumber() : null;
}

test("Caso 1: producto suelto SIN branchCost → cae al WAC (80), no a null", async () => {
  const cost = await effectiveCostFor("prod-suelto-wac");
  assert.equal(cost, 80);
});

test("Caso 2: producto suelto CON branchCost → el branchCost (55) gana, NO el WAC (999, trampa) ni averageCost/globalCost/lastPurchaseCost (200, trampa)", async () => {
  const cost = await effectiveCostFor("prod-suelto-branchcost");
  assert.equal(cost, 55);
  assert.notEqual(cost, 999);
  assert.notEqual(cost, 200);
});

test("Caso 3: canónico de fusión con branchCost → el branchCost (20) gana, no el WAC (999, trampa)", async () => {
  const cost = await effectiveCostFor("prod-lata");
  assert.equal(cost, 20);
});

test("Caso 4: derivado con factor 40 → canónico(20) × 40 = 800, ignorando su propio globalCost=1 (trampa, el bug real de arena)", async () => {
  const cost = await effectiveCostFor("prod-metro-40");
  assert.equal(cost, 800);
  assert.notEqual(cost, 1);
});

test("Caso 5: derivado con factor 44 → canónico(20) × 44 = 880, un número DISTINTO al de factor 40 (si dieran igual, el factor no se estaría aplicando)", async () => {
  const cost40 = await effectiveCostFor("prod-metro-40");
  const cost44 = await effectiveCostFor("prod-metro-44");
  assert.equal(cost44, 880);
  assert.notEqual(cost44, cost40);
});

test("Caso 6: producto sin ningún costo (ni branchCost, ni WAC, ni averageCost, ni globalCost, ni lastPurchaseCost) → null, NO cero", async () => {
  const result = await getEffectiveProductPricingBatch(createFakeDb(), [{ branchId: BRANCH_ID, productId: "prod-sin-costo" }]);
  const pricing = result.get(`${BRANCH_ID}:prod-sin-costo`);
  assert.equal(pricing?.effectiveCost, null);
  assert.equal(pricing?.costSource, "NONE");
  assert.notEqual(pricing?.effectiveCost, 0);
});

/* ── Convergencia real entre caminos de código distintos ──
   getEffectiveProductPricingBatch (batch, branchId-aware) vs
   resolveCostChain+resolveFusionMemberCost directo (el camino que usa
   Fusiones desde la Parte B.3, sin branchId) — mismos datos crudos,
   mismo número. Si Fusiones reimplementara su propia cascada, esto
   fallaría. */
for (const { label, productId, factor, expected } of [
  { label: "canónico (factor 1)", productId: "prod-lata", factor: d(1)!, expected: 20 },
  { label: "derivado factor 40", productId: "prod-metro-40", factor: d(40)!, expected: 800 },
  { label: "derivado factor 44", productId: "prod-metro-44", factor: d(44)!, expected: 880 },
]) {
  test(`Convergencia Fusiones vs motor de venta — ${label}: mismo número por los dos caminos`, async () => {
    const batchCost = await effectiveCostFor(productId);

    // El mismo camino que stock-group-crud.ts::listStockGroups toma para
    // Fusiones: costo del CANÓNICO (branchCost de la LATA en esta
    // sucursal, exactamente lo que Fusiones agrega entre sucursales en
    // producción) × factor de este miembro.
    const canonicalCost = resolveCostChain({
      branchCost: d(20), // el branchCost de la LATA en BRANCH_ID
      averageCost: null,
      globalCost: null,
      lastPurchaseCost: null,
      weightedAverageCost: null,
    }, true).cost;
    const fusionCost = resolveFusionMemberCost(canonicalCost, factor);

    assert.equal(batchCost, expected);
    assert.equal(fusionCost?.toNumber(), expected);
    assert.equal(batchCost, fusionCost?.toNumber(), `Catálogo/Precios vigentes/Bandeja/POS dan ${batchCost} pero Fusiones daría ${fusionCost?.toNumber()} — no convergen`);
  });
}
