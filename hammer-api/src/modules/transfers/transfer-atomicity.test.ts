import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  approveTransferTx,
  dispatchTransferTx,
  receiveTransferTx,
  cancelTransferTx,
} from "@/modules/transfers/service";

/**
 * prompt-seguridad-basica.md Fase 1 — approveTransfer/dispatchTransfer/
 * receiveTransfer/cancelTransfer leían el estado fuera de cualquier
 * transacción y actualizaban sin condición: un doble click o un reintento de
 * red repetía la operación. Ahora todo vive dentro de SELECT...FOR UPDATE +
 * recálculo sobre datos frescos + updateMany condicional. Fake tx en memoria
 * (sin fusión: productStockGroupMember.findFirst siempre null), mismo patrón
 * que batch-atomicity.test.ts.
 */

const FROM_BRANCH_ID = "branch-from";
const TO_BRANCH_ID = "branch-to";
const PRODUCT_ID = "prod-1";
const TRANSFER_ID = "transfer-1";
const LINE_ID = "line-1";

type Balance = {
  id: string;
  branchId: string;
  productId: string;
  quantityOnHand: Prisma.Decimal;
  closedPackageQuantity: Prisma.Decimal;
  looseUnitQuantity: Prisma.Decimal;
  weightedAverageCost: Prisma.Decimal;
  inventoryValue: Prisma.Decimal;
};

function createTransferFakeStore(opts: {
  status?: string;
  quantityRequested?: number;
  quantityDispatched?: number;
  quantityReceived?: number;
  unitCostSnapshot?: number;
  originStock?: number;
  originWac?: number;
} = {}) {
  const transfer = {
    id: TRANSFER_ID,
    transferNumber: "TR-TEST-1",
    status: opts.status ?? "APPROVED",
    fromBranchId: FROM_BRANCH_ID,
    toBranchId: TO_BRANCH_ID,
    receivedAt: null as Date | null,
    dispatchedAt: null as Date | null,
    approvedAt: null as Date | null,
    approvedByUserId: null as string | null,
  };

  const lines = [{
    id: LINE_ID,
    transferId: TRANSFER_ID,
    productId: PRODUCT_ID,
    quantityRequested: new Prisma.Decimal(opts.quantityRequested ?? 50),
    quantityDispatched: new Prisma.Decimal(opts.quantityDispatched ?? 0),
    quantityReceived: new Prisma.Decimal(opts.quantityReceived ?? 0),
    unitCostSnapshot: new Prisma.Decimal(opts.unitCostSnapshot ?? 10),
    product: { id: PRODUCT_ID, name: "Producto de prueba" },
  }];

  const fromBranch = { id: FROM_BRANCH_ID, code: "FROM", name: "Sucursal Origen" };
  const toBranch = { id: TO_BRANCH_ID, code: "TO", name: "Sucursal Destino" };

  const balances = new Map<string, Balance>();
  balances.set(`${FROM_BRANCH_ID}:${PRODUCT_ID}`, {
    id: "bal-origin",
    branchId: FROM_BRANCH_ID,
    productId: PRODUCT_ID,
    quantityOnHand: new Prisma.Decimal(opts.originStock ?? 1000),
    closedPackageQuantity: new Prisma.Decimal(0),
    looseUnitQuantity: new Prisma.Decimal(opts.originStock ?? 1000),
    weightedAverageCost: new Prisma.Decimal(opts.originWac ?? 10),
    inventoryValue: new Prisma.Decimal((opts.originStock ?? 1000) * (opts.originWac ?? 10)),
  });
  const key = (branchId: string, productId: string) => `${branchId}:${productId}`;

  const movements: Array<Record<string, unknown> & { id: string; movementType: string }> = [];
  const auditLogs: Array<Record<string, unknown>> = [];
  let movementSeq = 0;

  const tx = {
    $queryRaw: async () => [],
    systemSetting: { findUnique: async () => null },
    productStockGroupMember: { findFirst: async () => null },
    product: { findUnique: async () => null },
    inventoryBalance: {
      upsert: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) => {
        const k = key(where.branchId_productId.branchId, where.branchId_productId.productId);
        if (!balances.has(k)) {
          balances.set(k, {
            id: `bal-${k}`,
            branchId: where.branchId_productId.branchId,
            productId: where.branchId_productId.productId,
            quantityOnHand: new Prisma.Decimal(0),
            closedPackageQuantity: new Prisma.Decimal(0),
            looseUnitQuantity: new Prisma.Decimal(0),
            weightedAverageCost: new Prisma.Decimal(0),
            inventoryValue: new Prisma.Decimal(0),
          });
        }
        return balances.get(k)!;
      },
      findUnique: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) =>
        balances.get(key(where.branchId_productId.branchId, where.branchId_productId.productId)) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = [...balances.values()].find((b) => b.id === where.id);
        if (!row) throw new Error("balance not found");
        Object.assign(row, data);
        return row;
      },
    },
    inventoryMovement: {
      create: async ({ data }: { data: Record<string, unknown> & { movementType: string } }) => {
        movementSeq += 1;
        const row = { id: `mv-${movementSeq}`, ...data };
        movements.push(row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return data;
      },
    },
    transfer: {
      findUnique: async () => ({ ...transfer, lines, fromBranch, toBranch }),
      findUniqueOrThrow: async () => ({ ...transfer, lines, fromBranch, toBranch }),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        if (where.id !== transfer.id || where.status !== transfer.status) return { count: 0 };
        Object.assign(transfer, data);
        return { count: 1 };
      },
    },
    transferLine: {
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = lines.find((l) => l.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
      findMany: async () => lines,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx: tx as Prisma.TransactionClient, transfer, lines, movements, auditLogs, balances };
}

test("LA QUE IMPORTA — doble approveTransfer: el segundo falla, sin doble aprobación", async () => {
  const { tx, transfer } = createTransferFakeStore({ status: "DRAFT" });
  const first = await approveTransferTx(tx, TRANSFER_ID, "user-1");
  assert.equal(first.status, "APPROVED");
  await assert.rejects(() => approveTransferTx(tx, TRANSFER_ID, "user-1"), /ALREADY_PROCESSED/);
  assert.equal(transfer.status, "APPROVED");
});

test("LA QUE IMPORTA — doble dispatchTransfer (doble click/reintento): el segundo falla y solo hay UN movimiento de salida", async () => {
  const { tx, movements } = createTransferFakeStore({ status: "APPROVED", quantityRequested: 50 });
  const first = await dispatchTransferTx(tx, TRANSFER_ID, "user-1");
  assert.equal(first.status, "IN_TRANSIT");
  const outMovements = movements.filter((m) => m.movementType === "TRANSFER_OUT");
  assert.equal(outMovements.length, 1);

  await assert.rejects(() => dispatchTransferTx(tx, TRANSFER_ID, "user-1"), /ALREADY_PROCESSED/);
  assert.equal(movements.filter((m) => m.movementType === "TRANSFER_OUT").length, 1, "el segundo intento no despacha de nuevo");
});

test("LA QUE IMPORTA — doble receiveTransfer con recepcion total (doble click/reintento): el segundo no encuentra pendiente y no duplica el movimiento de entrada", async () => {
  const { tx, movements } = createTransferFakeStore({
    status: "IN_TRANSIT",
    quantityRequested: 50,
    quantityDispatched: 50,
  });

  const first = await receiveTransferTx(tx, TRANSFER_ID, "user-1");
  assert.equal(first.statusAfter, "RECEIVED");
  const inMovements = movements.filter((m) => m.movementType === "TRANSFER_IN");
  assert.equal(inMovements.length, 1);

  // Segundo intento: el status ya es RECEIVED -> rechazo inmediato, sin tocar nada.
  await assert.rejects(() => receiveTransferTx(tx, TRANSFER_ID, "user-1"), /INVALID_INPUT/);
  assert.equal(movements.filter((m) => m.movementType === "TRANSFER_IN").length, 1, "el segundo intento no recibe de nuevo");
});

test("receiveTransfer parcial: el segundo intento recalcula el pendiente FRESCO (no el leido antes del lock) y no sobre-recibe", async () => {
  const { tx, lines } = createTransferFakeStore({
    status: "IN_TRANSIT",
    quantityRequested: 50,
    quantityDispatched: 50,
  });

  // Primera recepcion parcial: 30 de 50.
  const first = await receiveTransferTx(tx, TRANSFER_ID, "user-1", {
    items: [{ productId: PRODUCT_ID, quantityReceived: 30 }],
  });
  assert.equal(first.statusAfter, "PARTIALLY_RECEIVED");
  assert.equal(lines[0].quantityReceived.toNumber(), 30);

  // Reintento con items explicitos pidiendo MAS de lo que ya queda pendiente
  // (20) -> debe rechazarse con el pendiente FRESCO, no con el pendiente
  // original (50) que hubiera permitido una segunda recepcion de 30.
  await assert.rejects(
    () => receiveTransferTx(tx, TRANSFER_ID, "user-1", { items: [{ productId: PRODUCT_ID, quantityReceived: 30 }] }),
    /No se puede recibir mas de lo despachado/,
  );
  assert.equal(lines[0].quantityReceived.toNumber(), 30, "el reintento no debe sumar nada");
});

test("LA QUE IMPORTA — doble cancelTransfer: el segundo falla", async () => {
  const { tx, transfer } = createTransferFakeStore({ status: "DRAFT" });
  const first = await cancelTransferTx(tx, TRANSFER_ID, "user-1");
  assert.equal(first.status, "CANCELLED");
  await assert.rejects(() => cancelTransferTx(tx, TRANSFER_ID, "user-1"), /ALREADY_PROCESSED/);
  assert.equal(transfer.status, "CANCELLED");
});

test("cancelTransfer en transito: conserva el mensaje de negocio especifico (no ALREADY_PROCESSED)", async () => {
  const { tx } = createTransferFakeStore({ status: "IN_TRANSIT" });
  await assert.rejects(
    () => cancelTransferTx(tx, TRANSFER_ID, "user-1"),
    /No se puede cancelar un traslado en transito/,
  );
});
