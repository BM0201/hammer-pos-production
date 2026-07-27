import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { reserveBatchInputsTx, releaseBatchInputsTx, getProductionReservedBaseQtyTx } from "@/modules/production/reservations";

/**
 * Producción v2 Fase 2 — no existía ningún mecanismo de reserva de stock en
 * el proyecto (se verificó en ventas y traslados). Estos tests prueban el
 * mecanismo nuevo: planificar reserva lo disponible (el faltante NO
 * bloquea, solo se reporta), cancelar/completar libera, y otros
 * consumidores (POS, otros lotes) pueden leer cuánto está reservado.
 */

const BRANCH_ID = "branch-central";
const BATCH_ID = "batch-1";
const CEMENT_ID = "prod-cemento";
const SAND_ID = "prod-arena";

function createFakeTx(input: {
  batchInputs: Array<{ id: string; inputProductId: string; plannedQuantity: number; reservedQuantity: number }>;
  balances: Record<string, number>; // productId -> quantityOnHand (base units, sin conversion en este test)
  otherReservations?: Array<{ inputProductId: string; reservedQuantity: number; batchStatus: string }>;
}) {
  const batchInputs = input.batchInputs.map((bi) => ({ ...bi, reservedQuantity: new Prisma.Decimal(bi.reservedQuantity) }));
  const otherReservations = input.otherReservations ?? [];

  const tx = {
    productionBatchInput: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        // getProductionReservedBaseQtyTx query shape: { inputProductId, reservedQuantity: {gt:0}, batch: {branchId, status:{in}} }
        if ("batch" in args.where) {
          const inputProductId = args.where.inputProductId as string;
          return otherReservations
            .filter((r) => r.inputProductId === inputProductId && r.reservedQuantity > 0)
            .map((r) => ({ reservedQuantity: new Prisma.Decimal(r.reservedQuantity) }));
        }
        // reserveBatchInputsTx query shape: { batchId }
        return batchInputs;
      },
      update: async (args: { where: { id: string }; data: { reservedQuantity: Prisma.Decimal } }) => {
        const bi = batchInputs.find((b) => b.id === args.where.id)!;
        bi.reservedQuantity = args.data.reservedQuantity;
        return bi;
      },
      updateMany: async (args: { where: { batchId: string }; data: { reservedQuantity: number } }) => {
        for (const bi of batchInputs) bi.reservedQuantity = new Prisma.Decimal(args.data.reservedQuantity);
        return { count: batchInputs.length };
      },
    },
    productStockGroupMember: {
      findFirst: async () => null, // sin fusión de stock en este test — conversion siempre null
    },
    inventoryBalance: {
      findUnique: async (args: { where: { branchId_productId: { productId: string } } }) => {
        const productId = args.where.branchId_productId.productId;
        const qty = input.balances[productId];
        return qty !== undefined ? { quantityOnHand: new Prisma.Decimal(qty) } : null;
      },
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, getBatchInputs: () => batchInputs };
}

test("Test de reserva: reserva completa cuando hay stock suficiente", async () => {
  const { tx, getBatchInputs } = createFakeTx({
    batchInputs: [
      { id: "bi-1", inputProductId: CEMENT_ID, plannedQuantity: 18, reservedQuantity: 0 },
      { id: "bi-2", inputProductId: SAND_ID, plannedQuantity: 2.5, reservedQuantity: 0 },
    ],
    balances: { [CEMENT_ID]: 100, [SAND_ID]: 50 },
  });

  const results = await reserveBatchInputsTx(tx, { batchId: BATCH_ID, branchId: BRANCH_ID });

  assert.equal(results.length, 2);
  assert.equal(results[0].reservedQuantity, 18);
  assert.equal(results[0].shortfall, 0);
  assert.equal(getBatchInputs()[0].reservedQuantity.toNumber(), 18);
});

test("Test de reserva: el faltante NO bloquea — reserva lo disponible y reporta el shortfall", async () => {
  const { tx, getBatchInputs } = createFakeTx({
    batchInputs: [{ id: "bi-1", inputProductId: "prod-colorante", plannedQuantity: 8, reservedQuantity: 0 }],
    balances: { "prod-colorante": 6 }, // solo 6kg de 8kg necesarios — faltan 2kg
  });

  const results = await reserveBatchInputsTx(tx, { batchId: BATCH_ID, branchId: BRANCH_ID });

  assert.equal(results[0].reservedQuantity, 6, "reserva lo disponible, no lo planificado");
  assert.equal(results[0].shortfall, 2, "reporta el faltante (2kg de colorante) sin bloquear la planificación");
  assert.equal(getBatchInputs()[0].reservedQuantity.toNumber(), 6);
});

test("Test de reserva: liberar (cancelar/completar) pone reservedQuantity en 0", async () => {
  const { tx, getBatchInputs } = createFakeTx({
    batchInputs: [{ id: "bi-1", inputProductId: CEMENT_ID, plannedQuantity: 18, reservedQuantity: 18 }],
    balances: { [CEMENT_ID]: 100 },
  });

  await releaseBatchInputsTx(tx, BATCH_ID);
  assert.equal(getBatchInputs()[0].reservedQuantity.toNumber(), 0);
});

test("Test de reserva: otros lotes PLANNED/IN_PROGRESS restan disponibilidad del insumo", async () => {
  const { tx } = createFakeTx({
    batchInputs: [],
    balances: {},
    otherReservations: [
      { inputProductId: CEMENT_ID, reservedQuantity: 18, batchStatus: "PLANNED" },
      { inputProductId: CEMENT_ID, reservedQuantity: 9, batchStatus: "IN_PROGRESS" },
    ],
  });

  const reserved = await getProductionReservedBaseQtyTx(tx, { branchId: BRANCH_ID, productId: CEMENT_ID });
  assert.equal(reserved.toNumber(), 27, "la suma de reservas activas de otros lotes debe verse como no disponible");
});

test("Test de reserva: sin reservas activas, disponibilidad reservada es 0", async () => {
  const { tx } = createFakeTx({ batchInputs: [], balances: {} });
  const reserved = await getProductionReservedBaseQtyTx(tx, { branchId: BRANCH_ID, productId: CEMENT_ID });
  assert.equal(reserved.toNumber(), 0);
});
