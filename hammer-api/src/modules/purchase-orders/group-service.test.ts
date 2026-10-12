import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  createPurchaseOrderGroup,
  getPurchaseOrderGroup,
  approvePurchaseOrderGroup,
  cancelPurchaseOrderGroup,
  updatePurchaseOrderGroupLines,
} from "@/modules/purchase-orders/group-service";

/**
 * Parte B.1 (prompt-completo-pendientes-2026-10.md) — fake-db en memoria
 * que soporta lo que createPurchaseOrder/approvePurchaseOrderTx/
 * cancelPurchaseOrderTx (las funciones REALES de service.ts, sin mockear)
 * necesitan — group-service.ts las llama directo a propósito (no
 * reimplementa nada de aprobar/cancelar/crear una orden individual).
 */
function decimal(value: number) {
  return new Prisma.Decimal(value);
}

const BRANCH_1 = { id: "branch-1", code: "MSY", name: "Masaya" };
const BRANCH_2 = { id: "branch-2", code: "RVS", name: "Rivas" };
const BRANCH_3 = { id: "branch-3", code: "MGA", name: "Managua" };

function buildFakeDb(opts: { products?: Array<{ id: string; isActive?: boolean; mergedIntoProductId?: string | null; sku: string }> } = {}) {
  const products = opts.products ?? [
    { id: "p1", isActive: true, mergedIntoProductId: null, sku: "CEM-001" },
    { id: "p2", isActive: true, mergedIntoProductId: null, sku: "VAR-001" },
  ];
  const groups: Array<Record<string, unknown>> = [];
  const orders: Array<Record<string, unknown>> = [];
  let poSeq = 0;

  const branchById = new Map([BRANCH_1, BRANCH_2, BRANCH_3].map((b) => [b.id, b]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake-db recursivo (db.$transaction se pasa a sí mismo).
  const db: any = {
    purchaseOrderGroup: {
      findUnique: async ({ where }: { where: { id?: string; clientRequestId?: string } }) => {
        const g = groups.find((g) => (where.id && g.id === where.id) || (where.clientRequestId && g.clientRequestId === where.clientRequestId));
        if (!g) return null;
        return { ...g, orders: orders.filter((o) => o.groupId === g.id) };
      },
      findFirst: async () => (groups.length === 0 ? null : groups.reduce((max, g) => ((g.sequence as number) > (max.sequence as number) ? g : max))),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const g = { id: `grp-${groups.length + 1}`, ...data };
        groups.push(g);
        return g;
      },
    },
    product: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => products.filter((p) => where.id.in.includes(p.id)),
    },
    purchaseOrder: {
      create: async ({ data }: { data: Record<string, unknown> & { lines: { create: Array<Record<string, unknown>> }; branchId: string } }) => {
        poSeq++;
        const lines = data.lines.create.map((l, i) => ({ id: `pol-${poSeq}-${i}`, ...l }));
        const po = {
          id: `po-${poSeq}`, orderNumber: `PO-TEST-${poSeq}`, status: "DRAFT",
          branchId: data.branchId, groupId: data.groupId ?? null,
          total: data.total, subtotalBeforeTax: data.subtotalBeforeTax, supplier: data.supplier ?? null,
          lines, branch: branchById.get(data.branchId), supplierRef: null,
        };
        orders.push(po);
        return po;
      },
      findMany: async ({ where }: { where?: { groupId?: string } }) => orders.filter((o) => !where?.groupId || o.groupId === where.groupId),
      findUnique: async ({ where }: { where: { id: string } }) => orders.find((o) => o.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const o = orders.find((o) => o.id === where.id);
        if (!o) throw new Error("NOT_FOUND");
        return o;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const o = orders.find((o) => o.id === where.id)!;
        Object.assign(o, data);
        return o;
      },
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        const matches = orders.filter((o) => o.id === where.id && o.status === where.status);
        matches.forEach((o) => Object.assign(o, data));
        return { count: matches.length };
      },
    },
    purchaseOrderLine: {
      deleteMany: async ({ where }: { where: { purchaseOrderId: string } }) => {
        const o = orders.find((o) => o.id === where.purchaseOrderId);
        if (o) (o as { lines: unknown[] }).lines = [];
        return { count: 0 };
      },
      create: async ({ data }: { data: Record<string, unknown> & { purchaseOrderId: string } }) => {
        const o = orders.find((o) => o.id === data.purchaseOrderId) as { lines: unknown[] };
        const line = { id: `pol-new-${o.lines.length}`, ...data };
        o.lines.push(line);
        return line;
      },
    },
    auditLog: { create: async () => ({}) },
    inventoryMovement: { count: async () => 0 },
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
  };
  return { db, groups, orders };
}

test("LA QUE IMPORTA — grupo con 3 sucursales y un override en 0 → 3 órdenes, una sin esa línea", async () => {
  const { db } = buildFakeDb();
  const result = await createPurchaseOrderGroup({
    clientRequestId: "req-1",
    actorUserId: "user-1",
    branchIds: [BRANCH_1.id, BRANCH_2.id, BRANCH_3.id],
    lines: [
      { productId: "p1", unitCostBeforeTax: 100, quantity: 10 },
      { productId: "p2", unitCostBeforeTax: 50, quantity: 5, overrides: { [BRANCH_3.id]: 0 } },
    ],
  }, db);

  assert.equal(result.orders.length, 3);
  const msyOrder = result.orders.find((o) => o.branchId === BRANCH_1.id)!;
  const mgaOrder = result.orders.find((o) => o.branchId === BRANCH_3.id)!;
  assert.equal(msyOrder.linesCount, 2, "MSY lleva las 2 líneas con la cantidad 'para todas'");
  assert.equal(mgaOrder.linesCount, 1, "MGA quedó solo con p1 — el override en 0 saca la línea de p2");
  assert.equal(result.skipped.length, 0);
});

test("LA QUE IMPORTA — una sucursal con TODAS sus cantidades en 0 queda en skipped, no se crea su orden", async () => {
  const { db } = buildFakeDb();
  const result = await createPurchaseOrderGroup({
    clientRequestId: "req-2",
    actorUserId: "user-1",
    branchIds: [BRANCH_1.id, BRANCH_2.id],
    lines: [{ productId: "p1", unitCostBeforeTax: 100, quantity: 10, overrides: { [BRANCH_2.id]: 0 } }],
  }, db);

  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].branchId, BRANCH_1.id);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].branchId, BRANCH_2.id);
});

test("LA QUE IMPORTA — doble envío con el mismo clientRequestId no duplica el grupo", async () => {
  const { db } = buildFakeDb();
  const input = {
    clientRequestId: "req-idempotent",
    actorUserId: "user-1",
    branchIds: [BRANCH_1.id, BRANCH_2.id],
    lines: [{ productId: "p1", unitCostBeforeTax: 100, quantity: 10 }],
  };
  const first = await createPurchaseOrderGroup(input, db);
  const second = await createPurchaseOrderGroup(input, db);

  assert.equal(first.group.id, second.group.id);
  assert.equal(second.orders.length, 2, "devuelve las órdenes YA creadas, no crea otras nuevas");
});

test("sin sucursales suficientes (menos de 2) rechaza antes de tocar la base", async () => {
  const { db } = buildFakeDb();
  await assert.rejects(
    () => createPurchaseOrderGroup({ clientRequestId: "req-x", actorUserId: "user-1", branchIds: [BRANCH_1.id], lines: [{ productId: "p1", unitCostBeforeTax: 1, quantity: 1 }] }, db),
    /VALIDATION_ERROR/,
  );
});

test("un producto unificado (mergedIntoProductId) rechaza el grupo entero", async () => {
  const { db, orders } = buildFakeDb({ products: [{ id: "p1", isActive: true, mergedIntoProductId: "p-canonical", sku: "FER-OLD" }] });
  await assert.rejects(
    () => createPurchaseOrderGroup({ clientRequestId: "req-merged", actorUserId: "user-1", branchIds: [BRANCH_1.id, BRANCH_2.id], lines: [{ productId: "p1", unitCostBeforeTax: 1, quantity: 1 }] }, db),
    /VALIDATION_ERROR/,
  );
  assert.equal(orders.length, 0, "nada se crea si una línea no pasa la validación");
});

test("LA QUE IMPORTA — aprobar el grupo con una orden ya aprobada: esa queda en failed, las demás se aprueban", async () => {
  const { db, orders } = buildFakeDb();
  const result = await createPurchaseOrderGroup({
    clientRequestId: "req-approve",
    actorUserId: "user-1",
    branchIds: [BRANCH_1.id, BRANCH_2.id],
    lines: [{ productId: "p1", unitCostBeforeTax: 100, quantity: 10 }],
  }, db);

  // Una de las dos ya se aprueba de antemano (simula que alguien ya la aprobó aparte).
  const alreadyApproved = orders.find((o) => o.branchId === BRANCH_2.id)!;
  (alreadyApproved as { status: string }).status = "APPROVED";

  const approveResult = await approvePurchaseOrderGroup(result.group.id, "user-2", db);
  assert.equal(approveResult.approved.length, 1);
  assert.equal(approveResult.failed.length, 1);
  assert.equal(approveResult.failed[0].branchCode, BRANCH_2.code);
});

test("cancelar el grupo: una orden RECEIVED no se toca, no cuenta como fallo", async () => {
  const { db, orders } = buildFakeDb();
  const result = await createPurchaseOrderGroup({
    clientRequestId: "req-cancel",
    actorUserId: "user-1",
    branchIds: [BRANCH_1.id, BRANCH_2.id],
    lines: [{ productId: "p1", unitCostBeforeTax: 100, quantity: 10 }],
  }, db);

  const received = orders.find((o) => o.branchId === BRANCH_2.id)!;
  (received as { status: string }).status = "RECEIVED";

  const cancelResult = await cancelPurchaseOrderGroup(result.group.id, "user-2", db);
  assert.equal(cancelResult.cancelled.length, 1);
  assert.equal(cancelResult.failed.length, 0, "RECEIVED se omite en silencio, no es un fallo");
});

test("LA QUE IMPORTA — editar un grupo con una orden ya aprobada da CONFLICT, sin tocar ninguna", async () => {
  const { db, orders } = buildFakeDb();
  const result = await createPurchaseOrderGroup({
    clientRequestId: "req-edit",
    actorUserId: "user-1",
    branchIds: [BRANCH_1.id, BRANCH_2.id],
    lines: [{ productId: "p1", unitCostBeforeTax: 100, quantity: 10 }],
  }, db);
  const approvedOrder = orders.find((o) => o.branchId === BRANCH_1.id)!;
  (approvedOrder as { status: string }).status = "APPROVED";

  const linesBefore = (orders.find((o) => o.branchId === BRANCH_2.id) as { lines: unknown[] }).lines.length;
  await assert.rejects(
    () => updatePurchaseOrderGroupLines(result.group.id, { lines: [{ productId: "p1", unitCostBeforeTax: 200, quantity: 5 }] }, db),
    /CONFLICT/,
  );
  // $queryRaw en el fake no filtra por groupId de verdad — igual confirmamos que la línea de la orden sana no cambió.
  assert.equal((orders.find((o) => o.branchId === BRANCH_2.id) as { lines: unknown[] }).lines.length, linesBefore);
});

test("getPurchaseOrderGroup — grupo inexistente da NOT_FOUND", async () => {
  const { db } = buildFakeDb();
  await assert.rejects(() => getPurchaseOrderGroup("no-existe", db), /NOT_FOUND/);
});
