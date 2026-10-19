import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { computeStockStatus, refreshProductStateTx, incrementProductSales90dTx } from "@/modules/catalog-inventory/product-state-service";

test("computeStockStatus — negativo, cero, bajo (con y sin política) y ok", () => {
  assert.equal(computeStockStatus(-5, 10), "NEGATIVE");
  assert.equal(computeStockStatus(0, 10), "ZERO");
  assert.equal(computeStockStatus(3, 10), "LOW");
  assert.equal(computeStockStatus(1, null), "LOW", "sin política activa, el fallback es 1 (igual que isCriticalStock hoy)");
  assert.equal(computeStockStatus(2, null), "OK", "sin política, 2 ya no es crítico (fallback=1)");
  assert.equal(computeStockStatus(50, 10), "OK");
});

/**
 * Fake DB mínimo: productos simples (sin fusión), un branch, balances y
 * política de reorden configurables por test. getEffectiveProductPricingBatch
 * (effective-pricing.ts) necesita product/branchProductSetting/inventoryBalance/
 * systemSetting/productStockGroupMember — ninguno con fusión acá.
 */
function createFakeDb(opts: {
  products?: Array<{ id: string; barcode: string | null; standardSalePrice: number; globalCost?: number | null; averageCost?: number | null; lastPurchaseCost?: number | null }>;
  balances?: Array<{ productId: string; branchId: string; quantityOnHand: number; weightedAverageCost: number }>;
  settings?: Array<{ productId: string; branchId: string; branchCost?: number | null; branchPrice?: number | null; minStock?: number | null; reorderPoint?: number | null }>;
  policies?: Array<{ productId: string; branchId: string; minQuantity: number; reorderPoint: number; isActive?: boolean }>;
}) {
  const products = opts.products ?? [];
  const balances = (opts.balances ?? []).map((b) => ({ ...b, quantityOnHand: new Prisma.Decimal(b.quantityOnHand), weightedAverageCost: new Prisma.Decimal(b.weightedAverageCost) }));
  const settings = opts.settings ?? [];
  const policies = opts.policies ?? [];
  const productBranchStates: Array<Record<string, unknown>> = [];
  const productCatalogStates: Array<Record<string, unknown>> = [];

  const db = {
    product: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        products.filter((p) => where.id.in.includes(p.id)).map((p) => ({
          id: p.id, barcode: p.barcode, standardSalePrice: new Prisma.Decimal(p.standardSalePrice),
          globalCost: p.globalCost != null ? new Prisma.Decimal(p.globalCost) : null,
          averageCost: p.averageCost != null ? new Prisma.Decimal(p.averageCost) : null,
          lastPurchaseCost: p.lastPurchaseCost != null ? new Prisma.Decimal(p.lastPurchaseCost) : null,
        })),
    },
    branchProductSetting: {
      findMany: async ({ where }: { where: { productId: { in: string[] } } }) =>
        settings.filter((s) => where.productId.in.includes(s.productId)).map((s) => ({
          branchId: s.branchId, productId: s.productId,
          branchPrice: s.branchPrice != null ? new Prisma.Decimal(s.branchPrice) : null,
          branchCost: s.branchCost != null ? new Prisma.Decimal(s.branchCost) : null,
        })),
    },
    inventoryBalance: {
      findMany: async (args: { where: { productId?: { in: string[] }; OR?: Array<{ productId: string; branchId: string }> } }) => {
        const { where } = args;
        return balances
          .filter((b) => {
            if (where.OR) return where.OR.some((pair) => pair.productId === b.productId && pair.branchId === b.branchId);
            return where.productId!.in.includes(b.productId);
          })
          .map((b) => ({ ...b }));
      },
    },
    stockReorderPolicy: {
      findMany: async (args: { where: { productId?: { in: string[] }; OR?: Array<{ productId: string; branchId: string }> } }) => {
        const { where } = args;
        return policies
          .filter((p) => p.isActive !== false)
          .filter((p) => {
            if (where.OR) return where.OR.some((pair) => pair.productId === p.productId && pair.branchId === p.branchId);
            return where.productId!.in.includes(p.productId);
          })
          .map((p) => ({ productId: p.productId, branchId: p.branchId, minQuantity: new Prisma.Decimal(p.minQuantity), reorderPoint: new Prisma.Decimal(p.reorderPoint) }));
      },
    },
    productStockGroupMember: {
      findMany: async () => [],
    },
    systemSetting: {
      findUnique: async () => null,
    },
    productBranchState: {
      // Replica el {increment: X} de Prisma (incrementProductSales90dTx lo usa) — un merge superficial normal lo pisaría con el objeto literal en vez de sumar.
      upsert: async ({ where, create, update }: { where: { productId_branchId: { productId: string; branchId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = `${where.productId_branchId.productId}:${where.productId_branchId.branchId}`;
        const idx = productBranchStates.findIndex((s) => `${s.productId}:${s.branchId}` === key);
        if (idx === -1) {
          productBranchStates.push({ ...create });
        } else {
          const resolved: Record<string, unknown> = { ...update };
          for (const [field, value] of Object.entries(update)) {
            if (value && typeof value === "object" && "increment" in (value as Record<string, unknown>)) {
              const current = productBranchStates[idx][field] as Prisma.Decimal;
              resolved[field] = current.add((value as { increment: Prisma.Decimal }).increment);
            }
          }
          productBranchStates[idx] = { ...productBranchStates[idx], ...resolved };
        }
      },
      findMany: async ({ where }: { where: { productId: { in: string[] } } }) =>
        productBranchStates.filter((s) => where.productId.in.includes(s.productId as string)),
    },
    productCatalogState: {
      upsert: async ({ where, create, update }: { where: { productId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const idx = productCatalogStates.findIndex((s) => s.productId === where.productId);
        if (idx === -1) productCatalogStates.push({ ...create });
        else productCatalogStates[idx] = { ...productCatalogStates[idx], ...update };
      },
    },
  };

  return { db, productBranchStates, productCatalogStates };
}

test("refreshProductStateTx — LA QUE IMPORTA: stock/costo/precio/margen/reorden de un producto simple, sin tocar units90d/revenue90d", async () => {
  // globalCost, no weightedAverageCost: WAC_DRIVES_COST_CHAIN está apagado
  // por defecto (docs/WAC-DESACTIVADO.md) — el WAC de la fila de balance NO
  // alimenta el costo efectivo salvo que el flag esté prendido.
  const { db, productBranchStates } = createFakeDb({
    products: [{ id: "p1", barcode: "123", standardSalePrice: 100, globalCost: 60 }],
    balances: [{ productId: "p1", branchId: "b1", quantityOnHand: 5, weightedAverageCost: 999 }],
    policies: [{ productId: "p1", branchId: "b1", minQuantity: 2, reorderPoint: 10 }],
  });

  await refreshProductStateTx(db as never, ["p1"], ["b1"]);

  assert.equal(productBranchStates.length, 1);
  const state = productBranchStates[0];
  assert.equal((state.quantityOnHand as Prisma.Decimal).toNumber(), 5);
  assert.equal((state.effectiveCost as Prisma.Decimal).toNumber(), 60);
  assert.equal((state.effectivePrice as Prisma.Decimal).toNumber(), 100);
  assert.equal((state.marginPercent as Prisma.Decimal).toNumber(), 40);
  assert.equal(state.stockStatus, "LOW", "5 <= reorderPoint 10");
  assert.equal((state.units90d as Prisma.Decimal).toNumber(), 0, "refreshProductStateTx NUNCA toca units90d");
});

test("refreshProductStateTx — sin política activa, el fallback de stockStatus es 1 (mismo criterio que isCriticalStock hoy)", async () => {
  const { db, productBranchStates } = createFakeDb({
    products: [{ id: "p1", barcode: null, standardSalePrice: 50 }],
    balances: [{ productId: "p1", branchId: "b1", quantityOnHand: 1, weightedAverageCost: 20 }],
  });

  await refreshProductStateTx(db as never, ["p1"], ["b1"]);
  assert.equal(productBranchStates[0].stockStatus, "LOW");
  assert.equal(productBranchStates[0].reorderPoint, null);
});

test("refreshProductStateTx — sin ningún par relevante (producto recién creado): no crea ninguna fila ProductBranchState", async () => {
  const { db, productBranchStates, productCatalogStates } = createFakeDb({
    products: [{ id: "p1", barcode: null, standardSalePrice: 0 }],
  });

  await refreshProductStateTx(db as never, ["p1"]);
  assert.equal(productBranchStates.length, 0);
  assert.equal(productCatalogStates.length, 1, "ProductCatalogState sí se crea — es por producto, no por sucursal");
  assert.equal(productCatalogStates[0].hasCode, false);
  assert.equal(productCatalogStates[0].hasPrice, false);
});

test("refreshProductStateTx — ProductCatalogState: hasCost/hasPrice/costEqualsPrice agregan TODAS las sucursales del producto", async () => {
  const { db, productCatalogStates } = createFakeDb({
    products: [{ id: "p1", barcode: "999", standardSalePrice: 0 }],
    balances: [
      { productId: "p1", branchId: "b1", quantityOnHand: 3, weightedAverageCost: 80 },
      { productId: "p1", branchId: "b2", quantityOnHand: 2, weightedAverageCost: 80 },
    ],
    settings: [{ productId: "p1", branchId: "b2", branchPrice: 80, branchCost: 80 }],
  });

  await refreshProductStateTx(db as never, ["p1"], ["b1", "b2"]);

  const state = productCatalogStates[0];
  assert.equal(state.hasCost, true);
  assert.equal(state.hasPrice, true, "b2 tiene branchPrice aunque standardSalePrice sea 0");
  assert.equal(state.costEqualsPrice, true, "en b2, costo=precio=80");
  assert.equal((state.totalQuantity as Prisma.Decimal).toNumber(), 5);
});

test("incrementProductSales90dTx — suma sobre lo que ya había, nunca reemplaza", async () => {
  const { db, productBranchStates } = createFakeDb({
    products: [{ id: "p1", barcode: null, standardSalePrice: 10 }],
    balances: [{ productId: "p1", branchId: "b1", quantityOnHand: 5, weightedAverageCost: 5 }],
  });

  await refreshProductStateTx(db as never, ["p1"], ["b1"]);
  await incrementProductSales90dTx(db as never, [{ productId: "p1", branchId: "b1", unitsDelta: 3, revenueDelta: 300 }]);
  await incrementProductSales90dTx(db as never, [{ productId: "p1", branchId: "b1", unitsDelta: 2, revenueDelta: 200 }]);

  const state = productBranchStates.find((s) => s.productId === "p1" && s.branchId === "b1")!;
  assert.equal((state.units90d as Prisma.Decimal).toNumber(), 5);
  assert.equal((state.revenue90d as Prisma.Decimal).toNumber(), 500);
});

test("incrementProductSales90dTx — fila que no existía todavía (producto sin ProductBranchState previo): la crea", async () => {
  const { db, productBranchStates } = createFakeDb({});
  await incrementProductSales90dTx(db as never, [{ productId: "p-nuevo", branchId: "b1", unitsDelta: 4, revenueDelta: 400 }]);
  const state = productBranchStates.find((s) => s.productId === "p-nuevo")!;
  assert.ok(state, "crea la fila aunque refreshProductStateTx nunca la hubiera tocado antes");
  assert.equal((state.units90d as Prisma.Decimal).toNumber(), 4);
});
