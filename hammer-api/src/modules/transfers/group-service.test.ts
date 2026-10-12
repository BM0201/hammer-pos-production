import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  createTransferGroup,
  approveTransferGroup,
  cancelTransferGroup,
} from "@/modules/transfers/group-service";

/**
 * Parte B.3 (prompt-completo-pendientes-2026-10.md) — "un origen, varios
 * destinos, la misma matriz". Fake-db en memoria que soporta lo que
 * createTransferGroup/createTransfer (sin fusión) y approveTransferTx/
 * cancelTransferTx (las funciones REALES, sin mockear) necesitan — mismo
 * patrón que multi-branch-intake-service.test.ts y transfer-atomicity.test.ts,
 * combinado: createTransfer no toca inventoryBalance al crear (solo lee el
 * WAC para el snapshot), y approve/cancel no tocan stock en absoluto (eso
 * pasa en dispatch/receive, fuera de este módulo).
 */
const FROM = "branch-from";
const TO_1 = "branch-to-1";
const TO_2 = "branch-to-2";
const TO_3 = "branch-to-3";

type Balance = { id: string; branchId: string; productId: string; quantityOnHand: Prisma.Decimal; weightedAverageCost: Prisma.Decimal };

function buildFakeDb(opts: { stock?: Record<string, number> } = {}) {
  const branches: Record<string, { id: string; code: string; name: string }> = {
    [FROM]: { id: FROM, code: "FROM", name: "Sucursal Origen" },
    [TO_1]: { id: TO_1, code: "TO1", name: "Sucursal Destino 1" },
    [TO_2]: { id: TO_2, code: "TO2", name: "Sucursal Destino 2" },
    [TO_3]: { id: TO_3, code: "TO3", name: "Sucursal Destino 3" },
  };
  const balances = new Map<string, Balance>();
  function key(branchId: string, productId: string) { return `${branchId}:${productId}`; }
  function setStock(productId: string, qty: number) {
    const k = key(FROM, productId);
    balances.set(k, { id: `bal-${k}`, branchId: FROM, productId, quantityOnHand: new Prisma.Decimal(qty), weightedAverageCost: new Prisma.Decimal(10) });
  }
  for (const [productId, qty] of Object.entries(opts.stock ?? { p1: 100, p2: 100 })) setStock(productId, qty);

  const products = new Map<string, { id: string; sku: string; name: string }>([
    ["p1", { id: "p1", sku: "SKU-1", name: "Producto 1" }],
    ["p2", { id: "p2", sku: "SKU-2", name: "Producto 2" }],
  ]);

  const groups: Array<Record<string, unknown>> = [];
  const transfers = new Map<string, Record<string, unknown>>();
  const auditLogs: Array<Record<string, unknown>> = [];
  let groupSeq = 0;
  let transferSeq = 0;
  let lineSeq = 0;

  function transferSnapshot(t: Record<string, unknown>) {
    return { ...t, lines: (t.lines as Array<Record<string, unknown>>).map((l) => ({ ...l })) };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake-db recursivo
  const db: any = {
    productStockGroupMember: { findFirst: async () => null },
    product: {
      findUnique: async ({ where }: { where: { id: string } }) => products.get(where.id) ?? null,
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => products.get(id)).filter(Boolean),
    },
    inventoryBalance: {
      findUnique: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) =>
        balances.get(key(where.branchId_productId.branchId, where.branchId_productId.productId)) ?? null,
      findMany: async ({ where }: { where: { branchId: string; productId: { in: string[] } } }) =>
        where.productId.in.map((productId) => balances.get(key(where.branchId, productId))).filter(Boolean) as Balance[],
    },
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => {
      // Snapshot/restore: una línea rota a mitad de un grupo no debe dejar transferencias a medias.
      const balancesSnapshot = new Map([...balances].map(([k, v]) => [k, { ...v }]));
      const transfersSnapshot = new Map([...transfers].map(([k, v]) => [k, transferSnapshot(v)]));
      const groupsSnapshotLen = groups.length;
      try {
        return await fn(db);
      } catch (error) {
        balances.clear();
        for (const [k, v] of balancesSnapshot) balances.set(k, v);
        transfers.clear();
        for (const [k, v] of transfersSnapshot) transfers.set(k, v);
        groups.length = groupsSnapshotLen;
        throw error;
      }
    },
    transferGroup: {
      findUnique: async ({ where, include }: { where: { id?: string; clientRequestId?: string }; include?: { transfers?: unknown } }) => {
        const group = groups.find((g) => (where.id && g.id === where.id) || (where.clientRequestId && g.clientRequestId === where.clientRequestId));
        if (!group) return null;
        if (include?.transfers) {
          const groupTransfers = [...transfers.values()].filter((t) => t.groupId === group.id);
          return { ...group, transfers: groupTransfers.map((t) => ({ id: t.id, transferNumber: t.transferNumber, status: t.status, toBranchId: t.toBranchId, toBranch: branches[t.toBranchId as string], lines: (t.lines as unknown[]).map((l) => ({ id: (l as { id: string }).id })) })) };
        }
        return group;
      },
      findFirst: async () => (groups.length === 0 ? null : groups.reduce((max, g) => ((g.sequence as number) > (max.sequence as number) ? g : max))),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        groupSeq += 1;
        const row = { id: `group-${groupSeq}`, ...data };
        groups.push(row);
        return row;
      },
    },
    transfer: {
      create: async ({ data }: { data: Record<string, unknown> & { lines: { create: Array<Record<string, unknown>> } } }) => {
        transferSeq += 1;
        const id = `transfer-${transferSeq}`;
        const lines: Array<Record<string, unknown>> = data.lines.create.map((l) => {
          lineSeq += 1;
          return { id: `line-${lineSeq}`, transferId: id, quantityDispatched: new Prisma.Decimal(0), quantityReceived: new Prisma.Decimal(0), ...l };
        });
        const row: Record<string, unknown> = { ...data, id, lines, status: data.status ?? "DRAFT" };
        transfers.set(id, row);
        return { ...row, fromBranch: branches[row.fromBranchId as string], toBranch: branches[row.toBranchId as string], lines: lines.map((l) => ({ ...l, product: products.get(l.productId as string) })) };
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const t = transfers.get(where.id);
        if (!t) return null;
        return { ...t, fromBranch: branches[t.fromBranchId as string], toBranch: branches[t.toBranchId as string] };
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const t = transfers.get(where.id);
        if (!t) throw new Error("NOT_FOUND");
        return { ...t, fromBranch: branches[t.fromBranchId as string], toBranch: branches[t.toBranchId as string] };
      },
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        const t = transfers.get(where.id);
        if (!t || t.status !== where.status) return { count: 0 };
        Object.assign(t, data);
        return { count: 1 };
      },
    },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { auditLogs.push(data); return data; } },
    systemSetting: { findUnique: async () => null },
  };

  return { db, balances, transfers, groups, auditLogs };
}

test("LA QUE IMPORTA — 3 destinos, un override a cero en uno: ese destino no lleva esa línea", async () => {
  const { db } = buildFakeDb();
  const result = await createTransferGroup({
    clientRequestId: "req-1",
    actorUserId: "user-1",
    fromBranchId: FROM,
    toBranchIds: [TO_1, TO_2, TO_3],
    lines: [
      { productId: "p1", quantity: 10, overrides: { [TO_3]: 0 } },
      { productId: "p2", quantity: 5 },
    ],
  }, db);

  assert.equal(result.transfers.length, 3);
  const t3 = result.transfers.find((t) => t.toBranchId === TO_3)!;
  assert.equal(t3.linesCount, 1, "TO_3 no lleva p1 (override a 0), solo p2");
  assert.equal(result.skipped.length, 0);
});

test("LA QUE IMPORTA — un destino con todas las cantidades en cero queda SKIPPED, no crea transferencia vacía", async () => {
  const { db } = buildFakeDb();
  const result = await createTransferGroup({
    clientRequestId: "req-2",
    actorUserId: "user-1",
    fromBranchId: FROM,
    toBranchIds: [TO_1, TO_2],
    lines: [{ productId: "p1", quantity: 10, overrides: { [TO_2]: 0 } }],
  }, db);

  assert.equal(result.transfers.length, 1);
  assert.equal(result.transfers[0].toBranchId, TO_1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].branchId, TO_2);
});

test("LA QUE IMPORTA — doble envío con el mismo clientRequestId no crea transferencias nuevas", async () => {
  const { db, transfers } = buildFakeDb();
  const input = {
    clientRequestId: "req-idempotent",
    actorUserId: "user-1",
    fromBranchId: FROM,
    toBranchIds: [TO_1, TO_2],
    lines: [{ productId: "p1", quantity: 10 }],
  };
  const first = await createTransferGroup(input, db);
  const countAfterFirst = transfers.size;
  const second = await createTransferGroup(input, db);

  assert.equal(transfers.size, countAfterFirst, "el segundo envío no crea transferencias nuevas");
  assert.equal(second.group.id, first.group.id);
  assert.equal(second.transfers.length, first.transfers.length);
});

test("LA QUE IMPORTA — stock insuficiente en origen para la SUMA de destinos: 409 con detalle, nada se crea", async () => {
  const { db, groups, transfers } = buildFakeDb({ stock: { p1: 12 } }); // 3 destinos x 10 = 30 > 12 disponibles
  await assert.rejects(
    () => createTransferGroup({
      clientRequestId: "req-shortage",
      actorUserId: "user-1",
      fromBranchId: FROM,
      toBranchIds: [TO_1, TO_2, TO_3],
      lines: [{ productId: "p1", quantity: 10 }],
    }, db),
    /CONFLICT.*Stock insuficiente/,
  );
  assert.equal(groups.length, 0, "no se creó el grupo");
  assert.equal(transfers.size, 0, "no se creó ninguna transferencia");
});

test("stock insuficiente: la suma de TODOS los destinos es lo que cuenta, no una sola línea por separado", async () => {
  const { db } = buildFakeDb({ stock: { p1: 25 } }); // 10+10+10=30 > 25, aunque cada destino individual (10) parece alcanzar
  await assert.rejects(
    () => createTransferGroup({
      clientRequestId: "req-shortage-2",
      actorUserId: "user-1",
      fromBranchId: FROM,
      toBranchIds: [TO_1, TO_2, TO_3],
      lines: [{ productId: "p1", quantity: 10 }],
    }, db),
    /CONFLICT/,
  );
});

test("LA QUE IMPORTA — approveTransferGroup: aprueba lo que puede, reporta lo que falla, sin tumbar el resto", async () => {
  const { db, transfers } = buildFakeDb();
  const created = await createTransferGroup({
    clientRequestId: "req-approve",
    actorUserId: "user-1",
    fromBranchId: FROM,
    toBranchIds: [TO_1, TO_2],
    lines: [{ productId: "p1", quantity: 10 }],
  }, db);

  // Una de las dos ya fue aprobada/cancelada por fuera (simula una carrera) — approveTransferTx la rechaza con ALREADY_PROCESSED.
  const brokenTransferId = created.transfers[0].id;
  (transfers.get(brokenTransferId) as Record<string, unknown>).status = "CANCELLED";

  const result = await approveTransferGroup(created.group.id, "user-1", db);
  assert.equal(result.approved.length, 1);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].reason, /ALREADY_PROCESSED/);
});

test("LA QUE IMPORTA — cancelTransferGroup: solo cancela DRAFT/APPROVED, no toca IN_TRANSIT", async () => {
  const { db, transfers } = buildFakeDb();
  const created = await createTransferGroup({
    clientRequestId: "req-cancel",
    actorUserId: "user-1",
    fromBranchId: FROM,
    toBranchIds: [TO_1, TO_2],
    lines: [{ productId: "p1", quantity: 10 }],
  }, db);

  (transfers.get(created.transfers[0].id) as Record<string, unknown>).status = "IN_TRANSIT";

  const result = await cancelTransferGroup(created.group.id, "user-1", db);
  assert.equal(result.cancelled.length, 1, "solo la que seguía en DRAFT se cancela");
  assert.equal(result.failed.length, 0, "la IN_TRANSIT se ignora silenciosamente, no cuenta como fallo");
  assert.equal(transfers.get(created.transfers[0].id)!.status, "IN_TRANSIT", "la que estaba en tránsito no se tocó");
});
