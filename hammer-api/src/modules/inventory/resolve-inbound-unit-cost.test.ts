import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { resolveInboundUnitCostBatch, resolveInboundUnitCost } from "@/modules/inventory/resolve-inbound-unit-cost";

/**
 * prompt-entrada-reintento-precio.md Commit 1 §1 — "una sola función,
 * usada por la vista previa y por el guardado". IM-000008 (caso real):
 * BISAGRAS CRONO PAR 4"X4" tenía averageCost=75 a nivel producto (por
 * compras en MSY) pero NINGUNA fila de ProductBranchState/InventoryBalance
 * en RIV — la vista previa veía 75 (GLOBAL_AVERAGE) y dejaba pasar;
 * createOpeningBalanceTx solo miraba el WAC de RIV (0, por no tener fila)
 * y reventaba. Esta función es la regla ÚNICA que cierra esa brecha.
 *
 * Fake db mínimo — mismo patrón que effective-pricing.test.ts: solo lo que
 * getEffectiveProductPricingBatch necesita para un producto simple.
 */
function decimal(value: number) {
  return new Prisma.Decimal(value);
}

function buildFakeDb(opts: {
  products: Record<string, { standardSalePrice?: number; globalCost?: number | null; averageCost?: number | null; lastPurchaseCost?: number | null }>;
  balances?: Array<{ branchId: string; productId: string; weightedAverageCost: number }>;
  branchCost?: Array<{ branchId: string; productId: string; branchCost: number }>;
  wacEnabled?: boolean;
}) {
  const balances = opts.balances ?? [];
  const branchCosts = opts.branchCost ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    systemSetting: { findUnique: async () => (opts.wacEnabled ? { value: "true" } : null) },
    productStockGroupMember: { findMany: async () => [] },
    product: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => id in opts.products).map((id) => {
          const p = opts.products[id];
          return {
            id,
            standardSalePrice: decimal(p.standardSalePrice ?? 100),
            globalCost: p.globalCost != null ? decimal(p.globalCost) : null,
            averageCost: p.averageCost != null ? decimal(p.averageCost) : null,
            lastPurchaseCost: p.lastPurchaseCost != null ? decimal(p.lastPurchaseCost) : null,
          };
        }),
    },
    branchProductSetting: {
      findMany: async ({ where }: { where: { productId: { in: string[] }; branchId: { in: string[] } } }) =>
        branchCosts
          .filter((b) => where.productId.in.includes(b.productId) && where.branchId.in.includes(b.branchId))
          .map((b) => ({ branchId: b.branchId, productId: b.productId, branchPrice: null, branchCost: decimal(b.branchCost) })),
    },
    inventoryBalance: {
      findMany: async ({ where }: { where: { productId: { in: string[] }; branchId: { in: string[] } } }) =>
        balances
          .filter((b) => where.productId.in.includes(b.productId) && where.branchId.in.includes(b.branchId))
          .map((b) => ({ branchId: b.branchId, productId: b.productId, weightedAverageCost: decimal(b.weightedAverageCost) })),
    },
  };
  return db;
}

test("LA QUE IMPORTA — caso real IM-000008: entered=null, sin costo en RIV, pero averageCost=75 a nivel producto → resuelve 75 (GLOBAL_AVERAGE), nunca null", async () => {
  const db = buildFakeDb({ products: { bisagras: { averageCost: 75 } }, balances: [{ branchId: "MSY", productId: "bisagras", weightedAverageCost: 75 }] });
  const result = await resolveInboundUnitCost(db, { productId: "bisagras", branchId: "RIV", enteredCost: null });
  assert.equal(result.cost?.toNumber(), 75);
  assert.equal(result.source, "GLOBAL_AVERAGE");
});

test("sin costo en ninguna parte → null", async () => {
  const db = buildFakeDb({ products: { p1: {} } });
  const result = await resolveInboundUnitCost(db, { productId: "p1", branchId: "RIV", enteredCost: null });
  assert.equal(result.cost, null);
  assert.equal(result.source, "NONE");
});

test("solo globalCost (sin averageCost) → resuelve con GLOBAL", async () => {
  const db = buildFakeDb({ products: { p1: { globalCost: 50 } } });
  const result = await resolveInboundUnitCost(db, { productId: "p1", branchId: "RIV", enteredCost: null });
  assert.equal(result.cost?.toNumber(), 50);
  assert.equal(result.source, "GLOBAL");
});

test("solo última compra (sin global ni average) → resuelve con LAST_PURCHASE", async () => {
  const db = buildFakeDb({ products: { p1: { lastPurchaseCost: 42 } } });
  const result = await resolveInboundUnitCost(db, { productId: "p1", branchId: "RIV", enteredCost: null });
  assert.equal(result.cost?.toNumber(), 42);
  assert.equal(result.source, "LAST_PURCHASE");
});

test("LA QUE IMPORTA — costo de OTRA sucursal no cuenta: RIV sin nada propio, MSY con WAC real, resuelve null igual (el costo es por sucursal)", async () => {
  const db = buildFakeDb({ products: { p1: {} }, balances: [{ branchId: "MSY", productId: "p1", weightedAverageCost: 999 }], wacEnabled: true });
  const result = await resolveInboundUnitCost(db, { productId: "p1", branchId: "RIV", enteredCost: null });
  assert.equal(result.cost, null, "el WAC de MSY nunca debe filtrarse al resolver el costo de RIV");
});

test("branchCost propio de la sucursal gana sobre todo lo demás", async () => {
  const db = buildFakeDb({ products: { p1: { globalCost: 50, averageCost: 60 } }, branchCost: [{ branchId: "RIV", productId: "p1", branchCost: 120 }] });
  const result = await resolveInboundUnitCost(db, { productId: "p1", branchId: "RIV", enteredCost: null });
  assert.equal(result.cost?.toNumber(), 120);
  assert.equal(result.source, "BRANCH");
});

test("entered cost > 0 gana sobre cualquier cadena", async () => {
  const db = buildFakeDb({ products: { p1: { globalCost: 50 } }, branchCost: [{ branchId: "RIV", productId: "p1", branchCost: 120 }] });
  const result = await resolveInboundUnitCost(db, { productId: "p1", branchId: "RIV", enteredCost: 85 });
  assert.equal(result.cost?.toNumber(), 85);
  assert.equal(result.source, "ENTERED");
});

test("entered cost = 0 no cuenta como entrado — cae a la cadena", async () => {
  const db = buildFakeDb({ products: { p1: { globalCost: 50 } } });
  const result = await resolveInboundUnitCost(db, { productId: "p1", branchId: "RIV", enteredCost: 0 });
  assert.equal(result.cost?.toNumber(), 50);
  assert.equal(result.source, "GLOBAL");
});

test("resolveInboundUnitCostBatch resuelve varias líneas en una sola consulta por lote, cada una según su propio costo", async () => {
  const db = buildFakeDb({ products: { a: { globalCost: 10 }, b: {} }, branchCost: [{ branchId: "RIV", productId: "b", branchCost: 20 }] });
  const result = await resolveInboundUnitCostBatch(db, [
    { productId: "a", branchId: "RIV", enteredCost: null },
    { productId: "b", branchId: "RIV", enteredCost: null },
    { productId: "c", branchId: "MSY", enteredCost: 999 },
  ]);
  assert.equal(result.get("RIV:a")?.cost?.toNumber(), 10);
  assert.equal(result.get("RIV:b")?.cost?.toNumber(), 20);
  assert.equal(result.get("MSY:c")?.cost?.toNumber(), 999, "costo entrado no necesita consultar la cadena para nada");
});
