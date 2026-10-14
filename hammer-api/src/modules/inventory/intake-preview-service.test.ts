import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { previewIntake } from "@/modules/inventory/intake-preview-service";

/**
 * Fase 1 (prompt-entrada-inventario.md) — fake-db a medida de lo que
 * previewIntake necesita (todo por lote): product/branchProductSetting/
 * inventoryBalance.findMany (para getEffectiveProductPricingBatch y el
 * balance directo), productStockGroupMember.findMany vacío (sin fusión en
 * estos escenarios — ya cubierto en otro lado), purchaseOrder/
 * purchaseOrderLine.findMany (OC pendiente y "compra típica").
 */
function decimal(value: number) {
  return new Prisma.Decimal(value);
}

const BRANCH_1 = "branch-1";
const BRANCH_2 = "branch-2";

type ProductFixture = { id: string; isActive?: boolean; standardSalePrice?: number; averageCost?: number | null; globalCost?: number | null; lastPurchaseCost?: number | null; costUpdatedAt?: Date | null };
type BalanceFixture = { branchId: string; productId: string; quantityOnHand: number; weightedAverageCost: number };
type BranchSettingFixture = { branchId: string; productId: string; branchCost?: number | null; branchPrice?: number | null };
type ApprovedPoFixture = { id: string; orderNumber: string; branchId: string; productIds: string[] };
type PoLineFixture = { branchId: string; productId: string; quantity: number };

function buildFakeDb(opts: {
  products?: ProductFixture[];
  balances?: BalanceFixture[];
  branchSettings?: BranchSettingFixture[];
  approvedPOs?: ApprovedPoFixture[];
  poLines?: PoLineFixture[];
} = {}) {
  const products = opts.products ?? [];
  const balances = opts.balances ?? [];
  const branchSettings = opts.branchSettings ?? [];
  const approvedPOs = opts.approvedPOs ?? [];
  const poLines = opts.poLines ?? [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake db, shape dictado por los selects reales de cada llamador.
  const db: any = {
    systemSetting: { findUnique: async () => null },
    productStockGroupMember: { findMany: async () => [] },
    product: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        products
          .filter((p) => where.id.in.includes(p.id))
          .map((p) => ({
            id: p.id,
            isActive: p.isActive ?? true,
            standardSalePrice: decimal(p.standardSalePrice ?? 100),
            globalCost: p.globalCost != null ? decimal(p.globalCost) : null,
            averageCost: p.averageCost != null ? decimal(p.averageCost) : null,
            lastPurchaseCost: p.lastPurchaseCost != null ? decimal(p.lastPurchaseCost) : null,
            costUpdatedAt: p.costUpdatedAt ?? null,
          })),
    },
    branchProductSetting: {
      findMany: async ({ where }: { where: { productId: { in: string[] }; branchId: { in: string[] } } }) =>
        branchSettings
          .filter((s) => where.productId.in.includes(s.productId) && where.branchId.in.includes(s.branchId))
          .map((s) => ({ branchId: s.branchId, productId: s.productId, branchPrice: s.branchPrice != null ? decimal(s.branchPrice) : null, branchCost: s.branchCost != null ? decimal(s.branchCost) : null })),
    },
    inventoryBalance: {
      findMany: async ({ where }: { where: { productId: { in: string[] }; branchId: { in: string[] } } }) =>
        balances
          .filter((b) => where.productId.in.includes(b.productId) && where.branchId.in.includes(b.branchId))
          .map((b) => ({ branchId: b.branchId, productId: b.productId, quantityOnHand: decimal(b.quantityOnHand), weightedAverageCost: decimal(b.weightedAverageCost) })),
    },
    purchaseOrder: {
      findMany: async ({ where }: { where: { branchId: { in: string[] }; lines: { some: { productId: { in: string[] } } } } }) =>
        approvedPOs
          .filter((po) => where.branchId.in.includes(po.branchId) && po.productIds.some((id) => where.lines.some.productId.in.includes(id)))
          .map((po) => ({ id: po.id, orderNumber: po.orderNumber, branchId: po.branchId, lines: po.productIds.filter((id) => where.lines.some.productId.in.includes(id)).map((id) => ({ productId: id })) })),
    },
    purchaseOrderLine: {
      findMany: async ({ where }: { where: { productId: { in: string[] }; purchaseOrder: { branchId: { in: string[] } } } }) =>
        poLines
          .filter((l) => where.productId.in.includes(l.productId) && where.purchaseOrder.branchId.in.includes(l.branchId))
          .map((l) => ({ productId: l.productId, quantity: decimal(l.quantity), purchaseOrder: { branchId: l.branchId } })),
    },
  };
  return db;
}

test("LA QUE IMPORTA — ADD_STOCK con costo PROMEDIA de verdad en la vista previa (120 a 402.30 + 50 a 415 → 406.04), igual que el servicio real", async () => {
  const db = buildFakeDb({
    products: [{ id: "p1" }],
    balances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 120, weightedAverageCost: 402.3 }],
  });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: 50, unitCost: 415 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.currentQty, 120);
  assert.equal(cell.finalQty, 170);
  assert.equal(cell.delta, 50);
  assert.equal(cell.currentWac, 402.3);
  assert.equal(Number(cell.newWac!.toFixed(2)), 406.04);
  assert.equal(cell.status, "OK");
});

test("PHYSICAL_COUNT nunca calcula newWac, aunque el conteo suba el stock", async () => {
  const db = buildFakeDb({
    products: [{ id: "p1" }],
    balances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 40, weightedAverageCost: 402.3 }],
  });
  const result = await previewIntake({ kind: "PHYSICAL_COUNT", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: 60 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.newWac, null, "un conteo no promedia costo, aunque suba el stock");
});

test("OPENING_BALANCE sobre un producto con existencias → ERROR OPENING_BALANCE_HAS_STOCK", async () => {
  const db = buildFakeDb({
    products: [{ id: "p1" }],
    balances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 15, weightedAverageCost: 50 }],
  });
  const result = await previewIntake({ kind: "OPENING_BALANCE", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: 10, unitCost: 60 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.status, "ERROR");
  assert.ok(cell.messages.some((m) => m.code === "OPENING_BALANCE_HAS_STOCK"));
});

test("LA QUE IMPORTA — OC pendiente del mismo producto/sucursal → REVIEW con el poId para el botón 'Recibir OC-XXXX'", async () => {
  const db = buildFakeDb({
    products: [{ id: "p-oc" }],
    approvedPOs: [{ id: "po-1", orderNumber: "OC-000123", branchId: BRANCH_1, productIds: ["p-oc"] }],
  });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p-oc", quantity: 20, unitCost: 80 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.status, "REVIEW");
  const msg = cell.messages.find((m) => m.code === "PENDING_PURCHASE_ORDER");
  assert.ok(msg, "debe avisar la OC pendiente");
  assert.equal(msg!.poId, "po-1");
});

test("producto inactivo → ERROR PRODUCT_BLOCKED", async () => {
  const db = buildFakeDb({ products: [{ id: "p-inactive", isActive: false }] });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p-inactive", quantity: 5, unitCost: 10 }] }, db);
  assert.equal(result.cells[0].status, "ERROR");
  assert.ok(result.cells[0].messages.some((m) => m.code === "PRODUCT_BLOCKED"));
});

test("LA QUE IMPORTA — cantidad muy por encima de la compra típica (mediana de OC) → REVIEW", async () => {
  const db = buildFakeDb({
    products: [{ id: "p-typical" }],
    poLines: [
      { branchId: BRANCH_1, productId: "p-typical", quantity: 10 },
      { branchId: BRANCH_1, productId: "p-typical", quantity: 12 },
      { branchId: BRANCH_1, productId: "p-typical", quantity: 11 },
      { branchId: BRANCH_1, productId: "p-typical", quantity: 9 },
      { branchId: BRANCH_1, productId: "p-typical", quantity: 10 },
    ],
  });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p-typical", quantity: 150, unitCost: 50 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.status, "REVIEW");
  assert.ok(cell.messages.some((m) => m.code === "QUANTITY_FAR_ABOVE_TYPICAL"));
});

test("cantidad vacía (borrador a medio llenar) → ERROR MISSING_QUANTITY, no mueve finalQty ni entra en los totales", async () => {
  const db = buildFakeDb({ products: [{ id: "p1" }], balances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 8, weightedAverageCost: 20 }] });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: null, unitCost: 25 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.status, "ERROR");
  assert.ok(cell.messages.some((m) => m.code === "MISSING_QUANTITY"));
  assert.equal(cell.finalQty, 8, "sin cantidad, el stock final queda igual al actual");
  assert.equal(result.totals[BRANCH_1].units, 0);
});

test("override por sucursal: la misma línea entra distinta cantidad en cada sucursal", async () => {
  const db = buildFakeDb({ products: [{ id: "p1" }] });
  const result = await previewIntake({
    kind: "ADD_STOCK",
    branchIds: [BRANCH_1, BRANCH_2],
    lines: [{ productId: "p1", quantity: 10, unitCost: 50, overrides: { [BRANCH_2]: 25 } }],
  }, db);
  const b1Cell = result.cells.find((c) => c.branchId === BRANCH_1)!;
  const b2Cell = result.cells.find((c) => c.branchId === BRANCH_2)!;
  assert.equal(b1Cell.delta, 10, "sin override, usa la cantidad general");
  assert.equal(b2Cell.delta, 25, "con override, usa el valor específico de la sucursal");
});

test("totales por sucursal: suma unidades y valor de varias líneas OK", async () => {
  const db = buildFakeDb({ products: [{ id: "pA" }, { id: "pB" }] });
  const result = await previewIntake({
    kind: "ADD_STOCK",
    branchIds: [BRANCH_1],
    lines: [
      { productId: "pA", quantity: 10, unitCost: 100 },
      { productId: "pB", quantity: 5, unitCost: 50 },
    ],
  }, db);
  assert.equal(result.totals[BRANCH_1].units, 15);
  assert.equal(result.totals[BRANCH_1].value, 1250);
  assert.equal(result.totals[BRANCH_1].wacChanges, 2, "ambas partían de 0 existencias — las dos calculan un WAC nuevo");
});

test("conteo a la baja SIN costo (no es entrada, no necesita costo) deja el total de valor en null para esa sucursal", async () => {
  const db = buildFakeDb({ products: [{ id: "p1" }], balances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 20, weightedAverageCost: 0 }] });
  const result = await previewIntake({ kind: "PHYSICAL_COUNT", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: 12 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.status, "OK", "una baja de 40% no dispara el aviso de 'baja fuerte' (umbral 50%)");
  assert.equal(result.totals[BRANCH_1].units, 8);
  assert.equal(result.totals[BRANCH_1].value, null, "sin costo propio ni efectivo, no se puede valorizar esta salida");
});

test("lastPurchaseCost/fecha salen de Product (global, no por sucursal) — igual que el resto del sistema", async () => {
  const costUpdatedAt = new Date("2026-09-01T00:00:00.000Z");
  const db = buildFakeDb({ products: [{ id: "p1", lastPurchaseCost: 123.45, costUpdatedAt }] });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: 5, unitCost: 10 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.lastPurchaseCost, 123.45);
  assert.equal(cell.lastPurchaseDate, costUpdatedAt.toISOString());
});
