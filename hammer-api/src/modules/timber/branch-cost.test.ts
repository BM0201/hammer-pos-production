import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { DEFAULT_CUBICATION_TABLE } from "@/modules/timber/calculator";
import {
  applyTimberBranchCostRowsTx,
  summarizeTimberBranchCost,
  woodMeasureOf,
  type TimberBranchCostRow,
} from "@/modules/timber/service";

const row = (overrides: Partial<TimberBranchCostRow> = {}): TimberBranchCostRow => ({
  productId: "tabla",
  timberProductId: null,
  sku: "MAD-TAB-1126-0001",
  name: "TABLA 1X12X6",
  thickness: 1,
  width: 12,
  lengthFeet: 16,
  varaLength: 6,
  boardFeet: 16,
  stock: 10,
  totalFeet: 160,
  currentCost: 1150,
  newCost: 784,
  price: 1360,
  ...overrides,
});

test("medida del catálogo: el tercer número son varas — CUARTON 2X4X6 son 16 pies, 10.67 pies tablares", () => {
  const measure = woodMeasureOf({ name: "CUARTON 2X4X6" }, DEFAULT_CUBICATION_TABLE);
  assert.equal(measure?.lengthFeet, 16);
  assert.equal(measure?.boardFeet.toFixed(2), "10.67");
  // A C$49 por pie: 522.67, no 196 (lo que saldría leyendo el 6 como pies).
  assert.equal(((measure?.boardFeet ?? 0) * 49).toFixed(2), "522.67");
});

test("medida registrada: manda el largo del viaje — 2X8X5 de 15 pies no se confunde con el de 14", () => {
  const measure = woodMeasureOf(
    { name: "CUARTON 2X8X5", timberProduct: { thickness: new Prisma.Decimal(2), width: new Prisma.Decimal(8), length: new Prisma.Decimal(15), varaLength: 5 } },
    DEFAULT_CUBICATION_TABLE,
  );
  assert.equal(measure?.lengthFeet, 15);
  assert.equal(measure?.boardFeet, 20);
});

test("un nombre sin medida no recibe costo inventado", () => {
  assert.equal(woodMeasureOf({ name: "ASERRIN POR SACO" }, DEFAULT_CUBICATION_TABLE), null);
});

test("totales: pies y valor de la sucursal, y las medidas que quedan bajo costo", () => {
  const totals = summarizeTimberBranchCost([
    row(),
    row({ productId: "cuarton", stock: 110, totalFeet: 513.3333, boardFeet: 4.6667, currentCost: null, newCost: 228.67, price: 100 }),
  ]);
  assert.equal(totals.pieces, 120);
  assert.equal(totals.feet, 673.3333);
  assert.equal(totals.currentValue, 11500);
  assert.equal(totals.newValue, 7840 + 110 * 228.67);
  assert.equal(totals.belowCost, 1);
});

test("sin costo escrito todavía: mide contra el costo vigente", () => {
  const totals = summarizeTimberBranchCost([row({ newCost: null, currentCost: 2000 })]);
  assert.equal(totals.newValue, 20000);
  assert.equal(totals.belowCost, 1);
});

function createFakeTx(balances: Array<{ id: string; productId: string; quantityOnHand: number; weightedAverageCost: number }>) {
  const settings: Array<Record<string, unknown>> = [];
  const balanceUpdates: Array<{ id: string; weightedAverageCost: Prisma.Decimal; inventoryValue: Prisma.Decimal }> = [];
  const timberUpdates: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  const tx = {
    $queryRaw: async () => { calls.push("lock"); return []; },
    inventoryBalance: {
      findMany: async () => balances.map((b) => ({ ...b, quantityOnHand: new Prisma.Decimal(b.quantityOnHand), weightedAverageCost: new Prisma.Decimal(b.weightedAverageCost) })),
      update: async (args: { where: { id: string }; data: { weightedAverageCost: Prisma.Decimal; inventoryValue: Prisma.Decimal } }) => {
        balanceUpdates.push({ id: args.where.id, ...args.data });
      },
    },
    branchProductSetting: { upsert: async (args: Record<string, unknown>) => { settings.push(args); } },
    timberProduct: { update: async (args: Record<string, unknown>) => { timberUpdates.push(args); } },
    auditLog: { create: async (args: { data: Record<string, unknown> }) => { audits.push(args.data); } },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, settings, balanceUpdates, timberUpdates, audits, calls };
}

test("fijar: escribe el costo de sucursal y el saldo, para que POS y Finanzas lean lo mismo, y lo audita", async () => {
  const { tx, settings, balanceUpdates, audits, calls } = createFakeTx([{ id: "bal-1", productId: "tabla", quantityOnHand: 10, weightedAverageCost: 1150 }]);
  const applied = await applyTimberBranchCostRowsTx(tx, { branchId: "msy", costPerFoot: 49, rows: [row()], userId: "user-1" });

  assert.equal(applied, 1);
  assert.equal(calls[0], "lock");
  const upsert = settings[0] as { where: { branchId_productId: { branchId: string } }; update: { branchCost: Prisma.Decimal }; create: { branchCost: Prisma.Decimal } };
  assert.equal(upsert.where.branchId_productId.branchId, "msy", "solo esa sucursal");
  assert.equal(upsert.update.branchCost.toNumber(), 784);
  assert.equal(upsert.create.branchCost.toNumber(), 784);
  assert.deepEqual(Object.keys(upsert.update), ["branchCost"], "el precio de venta no se toca");
  assert.equal(balanceUpdates[0].weightedAverageCost.toNumber(), 784);
  assert.equal(balanceUpdates[0].inventoryValue.toNumber(), 7840);
  assert.equal(audits[0].action, "TIMBER_BRANCH_COST_FIXED");
  assert.deepEqual(audits[0].metadataJson, { costPerFoot: 49, boardFeet: 16, before: 1150, after: 784, previousWac: 1150 });
});

test("fijar: una medida sin saldo en la sucursal recibe costo igual, y la registrada actualiza su costo base", async () => {
  const { tx, settings, balanceUpdates, timberUpdates } = createFakeTx([]);
  await applyTimberBranchCostRowsTx(tx, { branchId: "msy", costPerFoot: 49, rows: [row({ timberProductId: "tp-1" })] });
  assert.equal(settings.length, 1);
  assert.equal(balanceUpdates.length, 0);
  assert.equal(timberUpdates.length, 1);
});

test("fijar sin costo calculado no escribe nada", async () => {
  const { tx, settings, calls } = createFakeTx([]);
  assert.equal(await applyTimberBranchCostRowsTx(tx, { branchId: "msy", costPerFoot: 49, rows: [row({ newCost: null })] }), 0);
  assert.equal(settings.length, 0);
  assert.equal(calls.length, 0);
});
