import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { getCurrentPrices } from "@/modules/pricing/current-prices-service";
import { getEffectiveProductPricingBatch } from "@/modules/catalog/effective-pricing";

/**
 * Parte B (prompt-precios-vigentes-catalogo.md) — getCurrentPrices usa
 * effective-pricing.ts para precio Y costo (getEffectiveProductPricingBatch)
 * — el mismo motor que el POS, Brain y la Bandeja, no una segunda
 * resolución. `db` es inyectable en TODA la cadena (getCurrentPrices,
 * getEffectiveProductPricingBatch, resolvePolicyForProductBatch) — acá se
 * le da un fake en memoria que filtra arrays fijos, sin base de datos real.
 *
 * prompt-precios-costos-una-sola-fuente.md — hasta este cambio el costo
 * salía de resolveCatalogDisplayCostBatch (costo de RED, sin branchCost):
 * un producto con costo propio de esta sucursal (branchCost) mostraba el
 * costo de red en vez del suyo — la misma clase de divergencia reportada
 * en "Precios y costos", solo que acá pasaba inadvertida por ser de solo
 * lectura. Test 7b es la prueba directa de que ahora sí se respeta.
 */

const BRANCH = "branch-1";
const CAT_CEMENTO = "cat-cemento";
const CAT_ARENA = "cat-arena";

type FakeProduct = { id: string; sku: string; name: string; standardSalePrice: Prisma.Decimal; categoryId: string; isActive: boolean; averageCost: Prisma.Decimal | null; globalCost: Prisma.Decimal | null; lastPurchaseCost: Prisma.Decimal | null; category: { code: string; name: string } };
type FakeSetting = { productId: string; branchId: string; branchPrice: Prisma.Decimal | null; branchCost: Prisma.Decimal | null; priceExceptionReason: string | null; priceExceptionAt: Date | null; lastPriceUpdateAt: Date | null };
type FakeBalance = { productId: string; branchId: string; weightedAverageCost: Prisma.Decimal | null; quantityOnHand: Prisma.Decimal };
type FakeStockMember = { productId: string; isActive: boolean; isCanonical: boolean; conversionFactor: Prisma.Decimal; saleUnit: string; stockGroupId: string; stockGroup: { code: string; name: string; baseUnit: string; packageUnit: string | null; conversionFactorToBase: Prisma.Decimal | null; tracksPackages: boolean; approximateFactor: boolean; minimumClosedPackageReserve: Prisma.Decimal; autoOpenForUnitSale: boolean; isActive: boolean; products: Array<{ productId: string; isCanonical: boolean; conversionFactor: Prisma.Decimal }> }; isPackagePresentation: boolean };
type FakePolicy = { branchId: string; categoryId: string; minMarginPercent: Prisma.Decimal; targetMarginPercent: Prisma.Decimal; minProfitAmount: Prisma.Decimal; maxDiscountPercent: Prisma.Decimal; estimatedMonthlyUnits: Prisma.Decimal; estimatedMonthlySalesValue: Prisma.Decimal | null; monthlyExpenseAllocation: Prisma.Decimal; stockPolicy: string; priceMode: string; roundingRule: string; isActive: boolean; notes: string | null; category: { code: string; name: string } };

function d(n: number) {
  return new Prisma.Decimal(n);
}

function inArray(where: Record<string, unknown> | undefined, key: string, value: string): boolean {
  if (!where || where[key] === undefined) return true;
  const clause = where[key] as { in?: string[] } | string;
  if (typeof clause === "string") return clause === value;
  return !clause.in || clause.in.includes(value);
}

function makeFakeDb(fixtures: {
  products: FakeProduct[];
  settings: FakeSetting[];
  balances: FakeBalance[];
  stockMembers: FakeStockMember[];
  policies: FakePolicy[];
}) {
  return {
    product: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) => {
        return fixtures.products.filter((p) => {
          if (where?.isActive !== undefined && p.isActive !== where.isActive) return false;
          if (!inArray(where, "id", p.id)) return false;
          if (where?.categoryId !== undefined && typeof where.categoryId === "string" && p.categoryId !== where.categoryId) return false;
          return true;
        });
      },
    },
    productStockGroupMember: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) => {
        return fixtures.stockMembers.filter((m) => inArray(where, "productId", m.productId) && m.isActive);
      },
    },
    inventoryBalance: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) => {
        return fixtures.balances.filter((b) => {
          if (where?.branchId !== undefined && typeof where.branchId === "string" && b.branchId !== where.branchId) return false;
          if (!inArray(where, "productId", b.productId)) return false;
          return true;
        });
      },
    },
    branchProductSetting: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) => {
        return fixtures.settings.filter((s) => {
          if (where?.branchId !== undefined && typeof where.branchId === "string" && s.branchId !== where.branchId) return false;
          if (!inArray(where, "productId", s.productId)) return false;
          return true;
        });
      },
    },
    branchCategoryPricingPolicy: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) => {
        return fixtures.policies.filter((p) => inArray(where, "branchId", p.branchId) && inArray(where, "categoryId", p.categoryId));
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function baseFixtures() {
  const products: FakeProduct[] = [
    // P1 — sin BranchProductSetting: sigue el general (STANDARD).
    { id: "p1", sku: "SKU-1", name: "Cemento gris", standardSalePrice: d(100), categoryId: CAT_CEMENTO, isActive: true, averageCost: d(70), globalCost: null, lastPurchaseCost: null, category: { code: "CEM", name: "Cemento" } },
    // P2 — con BranchProductSetting: precio propio (BRANCH), con motivo.
    { id: "p2", sku: "SKU-2", name: "Cemento blanco", standardSalePrice: d(0), categoryId: CAT_CEMENTO, isActive: true, averageCost: d(100), globalCost: null, lastPurchaseCost: null, category: { code: "CEM", name: "Cemento" } },
    // P3 — sin standardSalePrice, sin branchPrice, sin costo: MISSING de verdad.
    { id: "p3", sku: "SKU-3", name: "Producto sin precio", standardSalePrice: d(0), categoryId: CAT_ARENA, isActive: true, averageCost: null, globalCost: null, lastPurchaseCost: null, category: { code: "ARE", name: "Arena" } },
    // P-canonical — la LATA de arena (fusión).
    { id: "p-canonical", sku: "SKU-LATA", name: "Arena (lata)", standardSalePrice: d(50), categoryId: CAT_ARENA, isActive: true, averageCost: null, globalCost: null, lastPurchaseCost: null, category: { code: "ARE", name: "Arena" } },
    // P4 — el METRO derivado de la fusión (factor 25 respecto de la lata).
    { id: "p4", sku: "SKU-METRO", name: "Arena (metro)", standardSalePrice: d(0), categoryId: CAT_ARENA, isActive: true, averageCost: d(999) /* debe ignorarse — la fusión usa el canónico */, globalCost: null, lastPurchaseCost: null, category: { code: "ARE", name: "Arena" } },
    // P5 — costo de RED (averageCost) 100, pero ESTA sucursal declaró su
    // propio branchCost (60, un flete/proveedor distinto). El caso real
    // reportado (LATA en Rivas): el costo de red no es el que aplica acá.
    { id: "p5", sku: "SKU-5", name: "Cemento con costo propio de sucursal", standardSalePrice: d(90), categoryId: CAT_CEMENTO, isActive: true, averageCost: d(100), globalCost: null, lastPurchaseCost: null, category: { code: "CEM", name: "Cemento" } },
  ];

  const settings: FakeSetting[] = [
    { productId: "p2", branchId: BRANCH, branchPrice: d(150), branchCost: null, priceExceptionReason: "Flete alto en esta sucursal", priceExceptionAt: new Date("2026-08-01"), lastPriceUpdateAt: new Date("2026-08-01") },
    { productId: "p5", branchId: BRANCH, branchPrice: null, branchCost: d(60), priceExceptionReason: null, priceExceptionAt: null, lastPriceUpdateAt: null },
  ];

  const balances: FakeBalance[] = [
    // WAC de la LATA (canónico) en esta sucursal: C$18.55 — el metro deriva 18.55 × 25.
    { productId: "p-canonical", branchId: BRANCH, weightedAverageCost: d(18.55), quantityOnHand: d(40) },
    { productId: "p1", branchId: BRANCH, weightedAverageCost: null, quantityOnHand: d(10) },
  ];

  const stockGroupChildren = [
    { productId: "p-canonical", isCanonical: true, conversionFactor: d(1) },
    { productId: "p4", isCanonical: false, conversionFactor: d(25) },
  ];
  const sharedStockGroup = {
    code: "ARENA-GRP", name: "Arena", baseUnit: "lata", packageUnit: null,
    conversionFactorToBase: null, tracksPackages: false, approximateFactor: false,
    minimumClosedPackageReserve: d(0), autoOpenForUnitSale: false, isActive: true,
    products: stockGroupChildren,
  };
  const stockMembers: FakeStockMember[] = [
    { productId: "p-canonical", isActive: true, isCanonical: true, conversionFactor: d(1), saleUnit: "lata", stockGroupId: "sg-arena", stockGroup: sharedStockGroup, isPackagePresentation: false },
    { productId: "p4", isActive: true, isCanonical: false, conversionFactor: d(25), saleUnit: "metro", stockGroupId: "sg-arena", stockGroup: sharedStockGroup, isPackagePresentation: false },
  ];

  const policies: FakePolicy[] = [
    { branchId: BRANCH, categoryId: CAT_CEMENTO, minMarginPercent: d(20), targetMarginPercent: d(30), minProfitAmount: d(0), maxDiscountPercent: d(0), estimatedMonthlyUnits: d(1), estimatedMonthlySalesValue: null, monthlyExpenseAllocation: d(0), stockPolicy: "NORMAL", priceMode: "CATEGORY", roundingRule: "NONE", isActive: true, notes: null, category: { code: "CEM", name: "Cemento" } },
  ];

  return { products, settings, balances, stockMembers, policies };
}

test("Test 4 — producto sin branchPrice → priceSource STANDARD y effectivePrice igual a standardSalePrice", async () => {
  const db = makeFakeDb(baseFixtures());
  const result = await getCurrentPrices({ branchId: BRANCH }, db);
  const p1 = result.rows.find((r) => r.productId === "p1")!;
  assert.equal(p1.priceSource, "STANDARD");
  assert.equal(p1.effectivePrice, 100);
});

test("Test 5 — producto con branchPrice → BRANCH, y trae el motivo de la excepción", async () => {
  const db = makeFakeDb(baseFixtures());
  const result = await getCurrentPrices({ branchId: BRANCH }, db);
  const p2 = result.rows.find((r) => r.productId === "p2")!;
  assert.equal(p2.priceSource, "BRANCH");
  assert.equal(p2.effectivePrice, 150);
  assert.equal(p2.priceExceptionReason, "Flete alto en esta sucursal");
});

test("Test 6 — sin precio en ningún nivel → MISSING y marginPercent null (NO cero)", async () => {
  const db = makeFakeDb(baseFixtures());
  const result = await getCurrentPrices({ branchId: BRANCH }, db);
  const p3 = result.rows.find((r) => r.productId === "p3")!;
  assert.equal(p3.priceSource, "MISSING");
  assert.equal(p3.effectivePrice, null);
  assert.equal(p3.marginPercent, null, "null, no 0 — cero es un margen, null es 'no se puede calcular'");
});

test("Test 7 — el effectiveCost del derivado de fusión (arena) coincide con getEffectiveProductPricingBatch para el mismo producto y sucursal", async () => {
  const db = makeFakeDb(baseFixtures());
  const result = await getCurrentPrices({ branchId: BRANCH }, db);
  const p4 = result.rows.find((r) => r.productId === "p4")!;

  const directPricing = await getEffectiveProductPricingBatch(db, [{ branchId: BRANCH, productId: "p4" }]);
  const direct = directPricing.get(`${BRANCH}:p4`)!;
  assert.equal(p4.effectiveCost, Number(direct.effectiveCost));
  // WAC de la lata (18.55) × factor del metro (25) = 463.75 — el mismo cruce
  // de WAC + factor de conversión que el prompt pide contrastar a mano.
  assert.equal(p4.effectiveCost, 18.55 * 25);
  assert.equal(p4.priceSource, "FUSION_DERIVED");
});

test("Test 7b (LA QUE IMPORTA) — un producto con branchCost propio de esta sucursal usa ESE costo, no el promedio de red (el caso real: LATA en Rivas)", async () => {
  const db = makeFakeDb(baseFixtures());
  const result = await getCurrentPrices({ branchId: BRANCH }, db);
  const p5 = result.rows.find((r) => r.productId === "p5")!;
  assert.equal(p5.effectiveCost, 60, "branchCost (60) gana sobre averageCost de red (100) — antes de este fix mostraba 100");
  // precio 90, costo 60 → margen positivo (33.3%). Con el costo de red (100)
  // hubiera dado margen NEGATIVO (-11.1%) — exactamente el tipo de lectura
  // equivocada que reportó el bug de LATA.
  assert.ok(Math.abs((p5.marginPercent ?? 0) - 33.33) < 0.1);
});

test("Test 8 — byPriceSource suma igual que total", async () => {
  const db = makeFakeDb(baseFixtures());
  const result = await getCurrentPrices({ branchId: BRANCH }, db);
  const { byPriceSource, total } = result.totals;
  assert.equal(byPriceSource.BRANCH + byPriceSource.STANDARD + byPriceSource.FUSION_DERIVED + byPriceSource.MISSING, total);
  assert.equal(total, 6, "p1, p2, p3, p-canonical, p4, p5");
});

test("belowPolicy: p1 (margen (100-70)/100=30%) está POR ENCIMA del mínimo de Cemento (20%) — no debe marcarse", async () => {
  const db = makeFakeDb(baseFixtures());
  const result = await getCurrentPrices({ branchId: BRANCH }, db);
  const p1 = result.rows.find((r) => r.productId === "p1")!;
  assert.equal(p1.marginPercent, 30);
  assert.equal(p1.minMarginPercent, 20);
  assert.equal(p1.belowPolicy, false);
});

test("filtro priceSource: MISSING devuelve exactamente los que no se pueden vender (p3), sin tocar totals (que sigue siendo de toda la consulta)", async () => {
  const db = makeFakeDb(baseFixtures());
  const result = await getCurrentPrices({ branchId: BRANCH, priceSource: "MISSING" }, db);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].productId, "p3");
  assert.equal(result.totals.total, 6, "totals sigue siendo de la consulta completa, no de la página filtrada");
  assert.equal(result.pagination.total, 1, "la paginación sí refleja el filtro de priceSource");
});

test("missingCostCount cuenta p3 (sin ningún costo)", async () => {
  const db = makeFakeDb(baseFixtures());
  const result = await getCurrentPrices({ branchId: BRANCH }, db);
  assert.equal(result.totals.missingCostCount, 1);
});

test("categoryId filtra el universo de la consulta (Arena: p3, p-canonical, p4)", async () => {
  const db = makeFakeDb(baseFixtures());
  const result = await getCurrentPrices({ branchId: BRANCH, categoryId: CAT_ARENA }, db);
  assert.equal(result.totals.total, 3);
});

test("C.2: el derivado de fusión trae el producto canónico para el tooltip", async () => {
  const db = makeFakeDb(baseFixtures());
  const result = await getCurrentPrices({ branchId: BRANCH }, db);
  const p4 = result.rows.find((r) => r.productId === "p4")!;
  assert.equal(p4.canonicalProductLabel, "SKU-LATA · Arena (lata)");
  const p1 = result.rows.find((r) => r.productId === "p1")!;
  assert.equal(p1.canonicalProductLabel, null, "un producto sin fusión no trae canónico");
});

test("sort=marginAsc pone primero el peor margen y al final los que no tienen margen calculable", async () => {
  const db = makeFakeDb(baseFixtures());
  const result = await getCurrentPrices({ branchId: BRANCH, sort: "marginAsc" }, db);
  const last = result.rows[result.rows.length - 1];
  assert.equal(last.marginPercent, null, "los sin margen calculable van al final, no primero");
});
