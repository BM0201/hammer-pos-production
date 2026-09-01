import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createOpeningBalanceTx } from "@/modules/inventory/service";
import { openingBalanceSchema } from "@/modules/inventory/validators";

/**
 * "que el WAC deje de moverse sin que nadie lo decida" — PARTE C. El
 * default de esta pantalla ERA SET_WAC: cargar existencias, la operación
 * más común del sistema, reescribía el costo promedio sin que nadie lo
 * pidiera. Test 10 es el que importa: sin costMode explícito, el default
 * del schema debe ser QUANTITY_ONLY y el WAC no debe moverse un milímetro.
 * Test 11 confirma que SET_WAC explícito SÍ sigue funcionando —
 * QUANTITY_ONLY no es "el WAC ya no se puede cambiar", es "cargar
 * existencias ya no lo cambia por accidente".
 *
 * Fake tx en memoria — mismo patrón que fusion-test-support.ts: solo los
 * métodos que createOpeningBalanceTx realmente llama para un producto
 * simple sin fusión (productStockGroupMember.findFirst -> null).
 */
function buildFakeDb(opts: { initialWac: number; initialQty: number; standardSalePrice: number }) {
  let balance = {
    id: "bal-1",
    branchId: "branch-1",
    productId: "prod-1",
    quantityOnHand: new Prisma.Decimal(opts.initialQty),
    closedPackageQuantity: new Prisma.Decimal(0),
    looseUnitQuantity: new Prisma.Decimal(0),
    weightedAverageCost: new Prisma.Decimal(opts.initialWac),
    inventoryValue: new Prisma.Decimal(opts.initialQty * opts.initialWac),
  };
  let movementCounter = 0;
  const auditLogs: Array<Record<string, unknown>> = [];
  const movements: Array<Record<string, unknown>> = [];

  const tx = {
    productStockGroupMember: {
      findFirst: async () => null, // producto simple, sin fusión
    },
    product: {
      findUniqueOrThrow: async () => ({ id: "prod-1", standardSalePrice: new Prisma.Decimal(opts.standardSalePrice) }),
      findUnique: async () => ({ id: "prod-1", standardSalePrice: new Prisma.Decimal(opts.standardSalePrice) }),
    },
    branchProductSetting: {
      findUnique: async () => null,
      upsert: async (args: { create: Record<string, unknown> }) => args.create,
    },
    inventoryBalance: {
      upsert: async () => balance,
      findUnique: async () => balance,
      update: async (args: { data: Record<string, unknown> }) => {
        balance = { ...balance, ...args.data } as typeof balance;
        return balance;
      },
    },
    inventoryMovement: {
      create: async (args: { data: Record<string, unknown> }) => {
        movementCounter += 1;
        const row = { id: `mv-${movementCounter}`, ...args.data };
        movements.push(row);
        return row;
      },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        auditLogs.push(args.data);
        return args.data;
      },
    },
    $queryRaw: async () => [],
  };

  return { tx: tx as any, getBalance: () => balance, auditLogs, movements };
}

test("10. Sin costMode explícito → el default del schema es QUANTITY_ONLY y el WAC NO cambia", () => {
  // "que el WAC deje de moverse sin que nadie lo decida" — el request no
  // manda costMode en absoluto, como haría cualquier caller que no se
  // haya actualizado.
  const parsed = openingBalanceSchema.parse({
    branchId: "clx0000000000000000000001",
    productId: "clx0000000000000000000002",
    quantity: 10,
    priceMode: "NO_PRICE_CHANGE",
    reason: "Conteo físico de rutina",
  });
  assert.equal(parsed.costMode, "QUANTITY_ONLY", "el default debe ser QUANTITY_ONLY, no SET_WAC");
});

test("10b. QUANTITY_ONLY (el default) ejecutado de punta a punta: el WAC reconstruido no se mueve un milímetro", async () => {
  const { tx, getBalance } = buildFakeDb({ initialWac: 18.55, initialQty: 100, standardSalePrice: 35 });
  const result = await createOpeningBalanceTx(tx, {
    actorUserId: "user-1",
    branchId: "branch-1",
    productId: "prod-1",
    quantity: 20,
    stockMode: "ADD_TO_STOCK",
    unitCost: null,
    costMode: "QUANTITY_ONLY",
    salePrice: null,
    priceMode: "NO_PRICE_CHANGE",
    reason: "Conteo físico de rutina",
  }, { createNoopMovement: true });

  assert.equal(getBalance().weightedAverageCost.toNumber(), 18.55, "cargar existencias con QUANTITY_ONLY no debe tocar el WAC");
  assert.equal(Number(result.weightedAverageCost), 18.55);
  assert.equal(result.newBaseStock, 120, "la cantidad SÍ debe cambiar — solo el costo queda intacto");
});

test("11. Con SET_WAC explícito, el WAC sí cambia — comportamiento intencional, no lo bloquea el nuevo default", async () => {
  const { tx, getBalance } = buildFakeDb({ initialWac: 18.55, initialQty: 100, standardSalePrice: 35 });
  const result = await createOpeningBalanceTx(tx, {
    actorUserId: "user-1",
    branchId: "branch-1",
    productId: "prod-1",
    quantity: 20,
    stockMode: "ADD_TO_STOCK",
    unitCost: 20,
    costMode: "SET_WAC",
    salePrice: null,
    priceMode: "NO_PRICE_CHANGE",
    reason: "Compra registrada como carga inicial",
  }, { createNoopMovement: true });

  // (100*18.55 + 20*20) / 120 = (1855+400)/120 = 18.7916...
  const expectedWac = (100 * 18.55 + 20 * 20) / 120;
  assert.ok(Math.abs(getBalance().weightedAverageCost.toNumber() - expectedWac) < 0.001);
  assert.ok(Math.abs(Number(result.weightedAverageCost) - expectedWac) < 0.001);
});

test("bulk: openingBalanceBulkLineSchema también tiene QUANTITY_ONLY como default (mismo riesgo, peor a escala)", async () => {
  const { openingBalanceBulkSchema } = await import("@/modules/inventory/validators");
  const parsed = openingBalanceBulkSchema.parse({
    branchId: "clx0000000000000000000001",
    reason: "Conteo físico de rutina",
    lines: [{ productId: "clx0000000000000000000000", quantity: 5, priceMode: "NO_PRICE_CHANGE" }],
  });
  assert.equal(parsed.lines[0].costMode, "QUANTITY_ONLY");
});
