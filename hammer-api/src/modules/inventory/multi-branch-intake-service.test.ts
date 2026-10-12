import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  createMultiBranchIntake,
  retryMultiBranchIntake,
  getMultiBranchIntake,
} from "@/modules/inventory/multi-branch-intake-service";

/**
 * Parte B.2 (prompt-completo-pendientes-2026-10.md) — fake-db en memoria
 * que soporta lo que createOpeningBalanceTx/createManualInventoryAdjustmentTx
 * (las funciones REALES, sin mockear) necesitan para un producto simple sin
 * fusión — mismo patrón que opening-balance.test.ts, generalizado a varias
 * sucursales (cada una con su propio saldo) y con un producto que puede
 * "no existir" para forzar que UNA sucursal falle sin tumbar las demás.
 */
function decimal(value: number) {
  return new Prisma.Decimal(value);
}

const BRANCH_1 = "branch-1";
const BRANCH_2 = "branch-2";
const BRANCH_3 = "branch-3";

function buildFakeDb(opts: { products?: Set<string>; standardSalePrice?: number } = {}) {
  const products = opts.products ?? new Set(["p1", "p2"]);
  const balances = new Map<string, { id: string; branchId: string; productId: string; quantityOnHand: Prisma.Decimal; closedPackageQuantity: Prisma.Decimal; looseUnitQuantity: Prisma.Decimal; weightedAverageCost: Prisma.Decimal }>();
  const movements: Array<Record<string, unknown>> = [];
  const intakes: Array<Record<string, unknown>> = [];
  const intakeBranches: Array<Record<string, unknown>> = [];
  let movementSeq = 0;

  function key(branchId: string, productId: string) {
    return `${branchId}:${productId}`;
  }
  function getBalance(branchId: string, productId: string) {
    const k = key(branchId, productId);
    if (!balances.has(k)) balances.set(k, { id: `bal-${k}`, branchId, productId, quantityOnHand: decimal(0), closedPackageQuantity: decimal(0), looseUnitQuantity: decimal(0), weightedAverageCost: decimal(0) });
    return balances.get(k)!;
  }
  function getBalanceById(id: string) {
    for (const bal of balances.values()) if (bal.id === id) return bal;
    throw new Error(`BALANCE_NOT_FOUND: ${id}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake-db recursivo (db.$transaction se pasa a sí mismo).
  const db: any = {
    productStockGroupMember: { findFirst: async () => null },
    product: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        if (!products.has(where.id)) throw new Error(`NOT_FOUND: producto ${where.id} no existe`);
        return { id: where.id, standardSalePrice: decimal(opts.standardSalePrice ?? 100) };
      },
      findUnique: async ({ where }: { where: { id: string } }) => (products.has(where.id) ? { id: where.id, standardSalePrice: decimal(opts.standardSalePrice ?? 100) } : null),
    },
    branchProductSetting: {
      findUnique: async () => null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => create,
    },
    inventoryBalance: {
      upsert: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) => getBalance(where.branchId_productId.branchId, where.branchId_productId.productId),
      findUnique: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) => getBalance(where.branchId_productId.branchId, where.branchId_productId.productId),
      update: async ({ where, data }: { where: { id?: string; branchId_productId?: { branchId: string; productId: string } }; data: Record<string, unknown> }) => {
        const bal = where.id ? getBalanceById(where.id) : getBalance(where.branchId_productId!.branchId, where.branchId_productId!.productId);
        Object.assign(bal, data);
        return bal;
      },
    },
    inventoryMovement: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        movementSeq++;
        const row = { id: `mv-${movementSeq}`, ...data };
        movements.push(row);
        return row;
      },
    },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => data },
    systemSetting: { findUnique: async () => null },
    $queryRaw: async () => [],
    // processBranchTx mete varias líneas en UNA transacción por sucursal —
    // si una línea falla a mitad de camino, Postgres real revierte las
    // anteriores de esa misma sucursal. El fake necesita simular eso
    // (snapshot/restore de balances y movimientos) o una línea rota deja
    // basura a medio escribir que el retry ve como "ya procesado".
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => {
      const balancesSnapshot = new Map([...balances].map(([k, v]) => [k, { ...v }]));
      const movementsLenSnapshot = movements.length;
      try {
        return await fn(db);
      } catch (error) {
        balances.clear();
        for (const [k, v] of balancesSnapshot) balances.set(k, v);
        movements.length = movementsLenSnapshot;
        throw error;
      }
    },
    multiBranchIntake: {
      findUnique: async ({ where, include }: { where: { id?: string; clientRequestId?: string }; include?: { branches?: unknown } }) => {
        const intake = intakes.find((i) => (where.id && i.id === where.id) || (where.clientRequestId && i.clientRequestId === where.clientRequestId));
        if (!intake) return null;
        if (include?.branches) {
          return { ...intake, branches: intakeBranches.filter((b) => b.intakeId === intake.id).map((b) => ({ ...b, branch: { id: b.branchId, code: b.branchId, name: b.branchId } })) };
        }
        return intake;
      },
      findFirst: async () => (intakes.length === 0 ? null : intakes.reduce((max, i) => ((i.sequence as number) > (max.sequence as number) ? i : max))),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `intake-${intakes.length + 1}`, ...data };
        intakes.push(row);
        return row;
      },
    },
    multiBranchIntakeBranch: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const d of data) intakeBranches.push({ id: `ib-${intakeBranches.length + 1}`, ...d });
        return { count: data.length };
      },
      updateMany: async ({ where, data }: { where: { intakeId: string; branchId: string; status: string }; data: Record<string, unknown> }) => {
        const matches = intakeBranches.filter((b) => b.intakeId === where.intakeId && b.branchId === where.branchId && b.status === where.status);
        matches.forEach((b) => Object.assign(b, data));
        return { count: matches.length };
      },
    },
  };
  return { db, getBalance, movements, intakeBranches, products };
}

test("LA QUE IMPORTA — crea inventario en 3 sucursales (OPENING_BALANCE), las 3 terminan DONE", async () => {
  const { db, getBalance, intakeBranches } = buildFakeDb();
  const result = await createMultiBranchIntake({
    clientRequestId: "req-1",
    actorUserId: "user-1",
    kind: "OPENING_BALANCE",
    reason: "Carga inicial",
    branchIds: [BRANCH_1, BRANCH_2, BRANCH_3],
    lines: [{ productId: "p1", quantity: 10, unitCost: 50 }],
  }, db);

  assert.equal(result.branches.length, 3);
  assert.ok(result.branches.every((b) => b.status === "DONE"));
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 10);
  assert.equal(Number(getBalance(BRANCH_2, "p1").quantityOnHand), 10);
  assert.equal(intakeBranches.filter((b) => b.status === "DONE").length, 3);
});

test("LA QUE IMPORTA — una sucursal con producto inexistente FAILED, las demás DONE (una no tumba las otras)", async () => {
  const { db, getBalance } = buildFakeDb({ products: new Set(["p1"]) }); // p2 "no existe"
  const result = await createMultiBranchIntake({
    clientRequestId: "req-2",
    actorUserId: "user-1",
    kind: "OPENING_BALANCE",
    reason: "Carga inicial",
    branchIds: [BRANCH_1, BRANCH_2],
    lines: [
      { productId: "p1", quantity: 10, unitCost: 50 },
      { productId: "p2", quantity: 5, unitCost: 20, overrides: { [BRANCH_1]: 0 } }, // solo BRANCH_2 lleva p2, que no existe
    ],
  }, db);

  const branch1 = result.branches.find((b) => b.branchId === BRANCH_1)!;
  const branch2 = result.branches.find((b) => b.branchId === BRANCH_2)!;
  assert.equal(branch1.status, "DONE", "BRANCH_1 solo lleva p1 (existe) — sin problema");
  assert.equal(branch2.status, "FAILED", "BRANCH_2 lleva p2, que no existe");
  assert.ok(branch2.error);
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 10, "BRANCH_1 sí se procesó, aunque BRANCH_2 falló");
});

test("LA QUE IMPORTA — doble envío con el mismo clientRequestId no reprocesa nada", async () => {
  const { db, movements } = buildFakeDb();
  const input = {
    clientRequestId: "req-idempotent",
    actorUserId: "user-1",
    kind: "OPENING_BALANCE" as const,
    reason: "Carga inicial",
    branchIds: [BRANCH_1, BRANCH_2],
    lines: [{ productId: "p1", quantity: 10, unitCost: 50 }],
  };
  await createMultiBranchIntake(input, db);
  const movementsAfterFirst = movements.length;
  const second = await createMultiBranchIntake(input, db);

  assert.equal(movements.length, movementsAfterFirst, "el segundo envío no creó ningún movimiento nuevo");
  assert.ok(second.branches.every((b) => b.status === "DONE"));
});

test("LA QUE IMPORTA — retry solo reprocesa las FAILED, no toca las ya DONE", async () => {
  const { db, getBalance, products } = buildFakeDb({ products: new Set(["p1"]) });
  const created = await createMultiBranchIntake({
    clientRequestId: "req-retry",
    actorUserId: "user-1",
    kind: "OPENING_BALANCE",
    reason: "Carga inicial",
    branchIds: [BRANCH_1, BRANCH_2],
    lines: [
      { productId: "p1", quantity: 10, unitCost: 50 },
      { productId: "p2", quantity: 5, unitCost: 20, overrides: { [BRANCH_1]: 0 } },
    ],
  }, db);
  assert.equal(created.branches.find((b) => b.branchId === BRANCH_2)!.status, "FAILED");

  // "Arreglar" p2 antes de reintentar — mismo objeto `products` que ya usa el fake.
  products.add("p2");

  const retried = await retryMultiBranchIntake(created.intake.id, "user-1", db);
  const branch1After = retried.branches.find((b) => b.branchId === BRANCH_1)!;
  const branch2After = retried.branches.find((b) => b.branchId === BRANCH_2)!;
  assert.equal(branch1After.status, "DONE", "ya estaba DONE — el retry no la toca");
  assert.equal(branch2After.status, "DONE", "ahora sí se pudo procesar");
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 10, "no se duplicó — sigue en 10, no 20");
});

test("getMultiBranchIntake — inexistente da NOT_FOUND", async () => {
  const { db } = buildFakeDb();
  await assert.rejects(() => getMultiBranchIntake("no-existe", db), /NOT_FOUND/);
});

test("sin sucursales suficientes (menos de 2) rechaza antes de tocar la base", async () => {
  const { db } = buildFakeDb();
  await assert.rejects(
    () => createMultiBranchIntake({ clientRequestId: "req-x", actorUserId: "user-1", kind: "OPENING_BALANCE", reason: "r", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: 1 }] }, db),
    /VALIDATION_ERROR/,
  );
});
