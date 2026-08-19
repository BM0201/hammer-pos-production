import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { checkStockGroupPricingHealth } from "@/modules/catalog/fusion-pricing-health";

/**
 * prompt-costos-precios-fusion.md §5 — pruebas 7, 8, 9 sobre
 * checkStockGroupPricingHealth. Fake tx en memoria modelando UN grupo
 * "ARENA" (canónico LATA factor 1 + dos derivados METRO_A factor 25 y
 * METRO_B factor 55) en UNA sucursal — mismo patrón que
 * stock-group-repair.test.ts, pero con los métodos que además necesita
 * getEffectiveProductPricingBatch (product/branchProductSetting/
 * productStockGroupMember) porque este chequeo sí resuelve precio/costo
 * efectivo, no solo balances.
 */
const STOCK_GROUP_ID = "group-arena";
const BRANCH_ID = "branch-mga";
const CANONICAL_ID = "prod-lata-arena";
const METRO_A_ID = "prod-metro-arena-a"; // factor 25
const METRO_B_ID = "prod-metro-arena-b"; // factor 55

type ProductRow = { id: string; standardSalePrice: Prisma.Decimal; globalCost: Prisma.Decimal | null; averageCost: Prisma.Decimal | null; lastPurchaseCost: Prisma.Decimal | null };
type SettingRow = { branchId: string; productId: string; branchCost: Prisma.Decimal | null; branchPrice: Prisma.Decimal | null };
type BalanceRow = { branchId: string; productId: string; quantityOnHand: Prisma.Decimal; weightedAverageCost: Prisma.Decimal };

function createArenaFakeDb(input: {
  products: Record<string, Partial<ProductRow>>;
  settings?: Partial<SettingRow>[];
  canonicalBalance: { quantityOnHand: number; weightedAverageCost: number };
}) {
  const members = [
    { productId: CANONICAL_ID, conversionFactor: new Prisma.Decimal(1), isCanonical: true },
    { productId: METRO_A_ID, conversionFactor: new Prisma.Decimal(25), isCanonical: false },
    { productId: METRO_B_ID, conversionFactor: new Prisma.Decimal(55), isCanonical: false },
  ];

  const products: ProductRow[] = members.map((m) => ({
    id: m.productId,
    // Default realista (30, no 0): un miembro DERIVADO sin override deriva su
    // precio implícito de precioBase(canónico) × factor — con
    // standardSalePrice=0 el canónico "sin precio propio" produciría un
    // impliedFusionPrice=0 artificial que dispararía UNSELLABLE en CUALQUIER
    // escenario, sin relación con lo que el test realmente quiere probar.
    standardSalePrice: new Prisma.Decimal(input.products[m.productId]?.standardSalePrice ?? 30),
    globalCost: input.products[m.productId]?.globalCost ?? null,
    averageCost: input.products[m.productId]?.averageCost ?? null,
    lastPurchaseCost: input.products[m.productId]?.lastPurchaseCost ?? null,
  }));

  const settings: SettingRow[] = (input.settings ?? []).map((s) => ({
    branchId: s.branchId ?? BRANCH_ID,
    productId: s.productId!,
    branchCost: s.branchCost ?? null,
    branchPrice: s.branchPrice ?? null,
  }));

  const balances: BalanceRow[] = [
    { branchId: BRANCH_ID, productId: CANONICAL_ID, quantityOnHand: new Prisma.Decimal(input.canonicalBalance.quantityOnHand), weightedAverageCost: new Prisma.Decimal(input.canonicalBalance.weightedAverageCost) },
  ];

  const memberRow = (productId: string) => {
    const m = members.find((x) => x.productId === productId);
    if (!m) return null;
    return { ...m, saleUnit: productId, isPackagePresentation: false, isActive: true };
  };

  const db = {
    productStockGroup: {
      findUnique: async () => ({
        id: STOCK_GROUP_ID,
        code: "ARENA",
        products: members.map((m) => ({ productId: m.productId, isCanonical: m.isCanonical, conversionFactor: m.conversionFactor })),
      }),
    },
    productStockGroupMember: {
      findMany: async (args: { where: { productId: { in: string[] } } }) => {
        return args.where.productId.in
          .map((id) => memberRow(id))
          .filter((m): m is NonNullable<typeof m> => m !== null)
          .map((m) => ({
            ...m,
            stockGroup: {
              id: STOCK_GROUP_ID, code: "ARENA", name: "Arena",
              baseUnit: "LATA", packageUnit: null, conversionFactorToBase: null,
              tracksPackages: false, approximateFactor: false,
              minimumClosedPackageReserve: new Prisma.Decimal(1), autoOpenForUnitSale: true,
              products: members.map((x) => ({ productId: x.productId, isCanonical: x.isCanonical, conversionFactor: x.conversionFactor })),
            },
          }));
      },
    },
    product: {
      findMany: async (args: { where: { id: { in: string[] } } }) => products.filter((p) => args.where.id.in.includes(p.id)),
    },
    branchProductSetting: {
      findMany: async (args: { where: { productId: { in: string[] }; branchId?: { in: string[] } } }) =>
        settings.filter((s) => args.where.productId.in.includes(s.productId)),
    },
    inventoryBalance: {
      findMany: async (args: { where: { productId?: string | { in: string[] }; branchId?: string | { in: string[] } } }) => {
        const productMatch = (productId: string) =>
          !args.where.productId
          || (typeof args.where.productId === "string" ? args.where.productId === productId : args.where.productId.in.includes(productId));
        const branchMatch = (branchId: string) =>
          !args.where.branchId
          || (typeof args.where.branchId === "string" ? args.where.branchId === branchId : args.where.branchId.in.includes(branchId));
        return balances.filter((b) => productMatch(b.productId) && branchMatch(b.branchId));
      },
    },
  };

  return db as unknown as import("@prisma/client").PrismaClient;
}

test("Prueba 9 (doc): canónico con costo efectivo C$1.00 y stock > 0 → PLACEHOLDER_COST", async () => {
  const db = createArenaFakeDb({
    products: { [CANONICAL_ID]: { globalCost: new Prisma.Decimal(1) } }, // relleno, exactamente el ejemplo del doc
    // WAC en 0 (sin compras todavía) — no hay costo real que tapar: desde
    // prompt-costos-precios-sucursal.md B2/B4, un WAC real siempre gana sobre
    // el relleno; el placeholder solo se resuelve cuando de verdad no hay
    // nada mejor, que es el escenario que esto prueba ahora.
    canonicalBalance: { quantityOnHand: 126.5, weightedAverageCost: 0 },
  });
  const result = await checkStockGroupPricingHealth(db, { stockGroupId: STOCK_GROUP_ID, branchIds: [BRANCH_ID] });
  assert.equal(result.healthy, false);
  const issue = result.issues.find((i) => i.kind === "PLACEHOLDER_COST" && i.productId === CANONICAL_ID);
  assert.ok(issue, "debe reportar PLACEHOLDER_COST sobre el canónico");
});

test("canónico con costo real (no 0/1) y stock > 0 → sin PLACEHOLDER_COST", async () => {
  const db = createArenaFakeDb({
    products: {},
    canonicalBalance: { quantityOnHand: 100, weightedAverageCost: 18.55 },
  });
  const result = await checkStockGroupPricingHealth(db, { stockGroupId: STOCK_GROUP_ID, branchIds: [BRANCH_ID] });
  assert.equal(result.issues.some((i) => i.kind === "PLACEHOLDER_COST"), false);
});

test("Prueba 8 (doc): dos presentaciones con factores 25 y 55 al mismo precio C$1200 → PRICE_BASIS_CONFLICT (el caso piedrín)", async () => {
  const db = createArenaFakeDb({
    products: {},
    settings: [
      { productId: METRO_A_ID, branchPrice: new Prisma.Decimal(1200) }, // implícito por lata: 1200/25 = 48
      { productId: METRO_B_ID, branchPrice: new Prisma.Decimal(1200) }, // implícito por lata: 1200/55 = 21.8
    ],
    canonicalBalance: { quantityOnHand: 100, weightedAverageCost: 18.55 },
  });
  const result = await checkStockGroupPricingHealth(db, { stockGroupId: STOCK_GROUP_ID, branchIds: [BRANCH_ID] });
  const issue = result.issues.find((i) => i.kind === "PRICE_BASIS_CONFLICT");
  assert.ok(issue, "debe reportar PRICE_BASIS_CONFLICT — hoy nadie lo detecta, el margen del reporte simplemente no cuadra");
  assert.match(issue!.productId, new RegExp(METRO_A_ID));
  assert.match(issue!.productId, new RegExp(METRO_B_ID));
});

test("dos presentaciones cuyo precio implícito coincide dentro de tolerancia → sin PRICE_BASIS_CONFLICT", async () => {
  const db = createArenaFakeDb({
    products: {},
    settings: [
      { productId: METRO_A_ID, branchPrice: new Prisma.Decimal(1000) }, // 1000/25 = 40
      { productId: METRO_B_ID, branchPrice: new Prisma.Decimal(2200) }, // 2200/55 = 40 — misma base
    ],
    canonicalBalance: { quantityOnHand: 100, weightedAverageCost: 18.55 },
  });
  const result = await checkStockGroupPricingHealth(db, { stockGroupId: STOCK_GROUP_ID, branchIds: [BRANCH_ID] });
  assert.equal(result.issues.some((i) => i.kind === "PRICE_BASIS_CONFLICT"), false);
});

test("Prueba 7 (doc): precio C$1.00 y costo efectivo C$55 → UNSELLABLE (el guard BELOW_COST_NOT_ALLOWED sigue bloqueando la venta, sin cambios)", async () => {
  const db = createArenaFakeDb({
    products: { [CANONICAL_ID]: { globalCost: new Prisma.Decimal(55) } },
    settings: [{ productId: CANONICAL_ID, branchPrice: new Prisma.Decimal(1) }],
    canonicalBalance: { quantityOnHand: 10, weightedAverageCost: 55 },
  });
  const result = await checkStockGroupPricingHealth(db, { stockGroupId: STOCK_GROUP_ID, branchIds: [BRANCH_ID] });
  const issue = result.issues.find((i) => i.kind === "UNSELLABLE" && i.productId === CANONICAL_ID);
  assert.ok(issue, "debe reportar UNSELLABLE — el mismo caso que hoy ya bloquea el 409 en el mostrador");
});

test("margen absurdamente alto (costo de relleno) → MARGIN_OUTLIER, el caso de las latas al 97.14%", async () => {
  const db = createArenaFakeDb({
    products: { [CANONICAL_ID]: { globalCost: new Prisma.Decimal(1) } },
    settings: [{ productId: CANONICAL_ID, branchPrice: new Prisma.Decimal(35) }], // margen = (35-1)/35 = 97.14%
    // WAC en 0 (sin compras): igual que arriba, con un WAC real disponible
    // ya no sería un costo de relleno — B2/B4 lo habría resuelto solos.
    canonicalBalance: { quantityOnHand: 10, weightedAverageCost: 0 },
  });
  const result = await checkStockGroupPricingHealth(db, { stockGroupId: STOCK_GROUP_ID, branchIds: [BRANCH_ID] });
  const issue = result.issues.find((i) => i.kind === "MARGIN_OUTLIER" && i.productId === CANONICAL_ID);
  assert.ok(issue, "debe reportar MARGIN_OUTLIER sobre un margen del 97.14%");
});

test("fusión sana (sin overrides, costo real, margen razonable) → healthy=true, sin issues", async () => {
  const db = createArenaFakeDb({
    products: {},
    canonicalBalance: { quantityOnHand: 100, weightedAverageCost: 18.55 },
  });
  const result = await checkStockGroupPricingHealth(db, { stockGroupId: STOCK_GROUP_ID, branchIds: [BRANCH_ID] });
  assert.equal(result.healthy, true);
  assert.equal(result.issues.length, 0);
});
