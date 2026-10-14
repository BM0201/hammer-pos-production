import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  createMultiBranchIntake,
  retryMultiBranchIntake,
  continueMultiBranchIntake,
  getMultiBranchIntake,
  normalizeIntakeKind,
  stockModeForKind,
  costModeForKind,
} from "@/modules/inventory/multi-branch-intake-service";

/**
 * Fase 1 (prompt-entrada-inventario.md) — fake-db en memoria que soporta lo
 * que createOpeningBalanceTx/createInventoryMovementTx (las funciones
 * REALES, sin mockear) necesitan para un producto simple sin fusión. Mismo
 * patrón que la versión Parte B.2 de este archivo, extendido para: 1 sola
 * sucursal, los 3 `kind` nuevos, y tandas reanudables (processedLines).
 */
function decimal(value: number) {
  return new Prisma.Decimal(value);
}

const BRANCH_1 = "branch-1";
const BRANCH_2 = "branch-2";

function buildFakeDb(opts: { products?: Set<string>; standardSalePrice?: number; initialBalances?: Array<{ branchId: string; productId: string; quantityOnHand: number; weightedAverageCost: number }> } = {}) {
  const products = opts.products ?? new Set(["p1", "p2"]);
  const balances = new Map<string, { id: string; branchId: string; productId: string; quantityOnHand: Prisma.Decimal; closedPackageQuantity: Prisma.Decimal; looseUnitQuantity: Prisma.Decimal; weightedAverageCost: Prisma.Decimal }>();
  const movements: Array<Record<string, unknown>> = [];
  const intakes: Array<Record<string, unknown>> = [];
  const intakeBranches: Array<Record<string, unknown>> = [];
  let movementSeq = 0;

  for (const b of opts.initialBalances ?? []) {
    balances.set(`${b.branchId}:${b.productId}`, { id: `bal-${b.branchId}:${b.productId}`, branchId: b.branchId, productId: b.productId, quantityOnHand: decimal(b.quantityOnHand), closedPackageQuantity: decimal(0), looseUnitQuantity: decimal(0), weightedAverageCost: decimal(b.weightedAverageCost) });
  }

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
  function findIntakeBranch(intakeId: string, branchId: string) {
    return intakeBranches.find((b) => b.intakeId === intakeId && b.branchId === branchId);
  }
  function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && "in" in (v as Record<string, unknown>)) {
        return ((v as { in: unknown[] }).in).includes(row[k]);
      }
      return row[k] === v;
    });
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
    // Una tanda es UNA transacción — si una línea falla a mitad de camino,
    // Postgres real revierte las anteriores de ESA TANDA (no de tandas ya
    // confirmadas antes). El fake simula eso con snapshot/restore.
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
        for (const d of data) intakeBranches.push({ id: `ib-${intakeBranches.length + 1}`, processedLines: 0, totalLines: 0, error: null, ...d });
        return { count: data.length };
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const { intakeId, branchId, ...rest } = where;
        const matches = intakeBranches.filter((b) => b.intakeId === intakeId && b.branchId === branchId && matchesWhere(b, rest));
        matches.forEach((b) => Object.assign(b, data));
        return { count: matches.length };
      },
      findUniqueOrThrow: async ({ where }: { where: { intakeId_branchId: { intakeId: string; branchId: string } } }) => {
        const found = findIntakeBranch(where.intakeId_branchId.intakeId, where.intakeId_branchId.branchId);
        if (!found) throw new Error("NOT_FOUND: MultiBranchIntakeBranch");
        return found;
      },
    },
  };
  return { db, getBalance, movements, intakeBranches, intakes, products };
}

// ── mapeo de cada kind (1.1) ───────────────────────────────────────────────

test("LA QUE IMPORTA — mapeo de kind a stockMode/costMode", () => {
  assert.equal(normalizeIntakeKind("ADD_STOCK"), "ADD_STOCK");
  assert.equal(normalizeIntakeKind("ADJUSTMENT_IN"), "ADD_STOCK", "ADJUSTMENT_IN es alias de ADD_STOCK");
  assert.equal(normalizeIntakeKind("PHYSICAL_COUNT"), "PHYSICAL_COUNT");
  assert.equal(normalizeIntakeKind("OPENING_BALANCE"), "OPENING_BALANCE");

  assert.equal(stockModeForKind("ADD_STOCK"), "ADD_TO_STOCK");
  assert.equal(stockModeForKind("PHYSICAL_COUNT"), "SET_PHYSICAL_STOCK");
  assert.equal(stockModeForKind("OPENING_BALANCE"), "SET_PHYSICAL_STOCK");

  assert.equal(costModeForKind("OPENING_BALANCE", true), "SET_BRANCH_COST");
  assert.equal(costModeForKind("OPENING_BALANCE", false), "SET_BRANCH_COST", "carga inicial siempre fija el costo de sucursal (el costo es obligatorio, se valida aparte)");
  assert.equal(costModeForKind("PHYSICAL_COUNT", true), "QUANTITY_ONLY", "un conteo NUNCA cambia el costo, aunque venga uno");
  assert.equal(costModeForKind("ADD_STOCK", true), "SET_WAC", "con costo, sumar PROMEDIA");
  assert.equal(costModeForKind("ADD_STOCK", false), "QUANTITY_ONLY", "sin costo, usa el promedio vigente");
});

// ── 1 sola sucursal — ya no exige 2 ────────────────────────────────────────

test("LA QUE IMPORTA — una sola sucursal ya no se rechaza (esa regla es solo de Compras)", async () => {
  const { db, getBalance } = buildFakeDb();
  const result = await createMultiBranchIntake({
    clientRequestId: "req-single",
    actorUserId: "user-1",
    kind: "OPENING_BALANCE",
    reason: "Carga inicial",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p1", quantity: 10, unitCost: 50 }],
  }, db);
  assert.equal(result.branches.length, 1);
  assert.equal(result.branches[0].status, "DONE");
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 10);
});

test("sin ninguna sucursal: sigue rechazado", async () => {
  const { db } = buildFakeDb();
  await assert.rejects(
    () => createMultiBranchIntake({ clientRequestId: "req-x", actorUserId: "user-1", kind: "OPENING_BALANCE", reason: "r", branchIds: [], lines: [{ productId: "p1", quantity: 1, unitCost: 10 }] }, db),
    /VALIDATION_ERROR/,
  );
});

// ── ADD_STOCK promedia de verdad ───────────────────────────────────────────

test("LA QUE IMPORTA — ADD_STOCK con costo PROMEDIA (120 a 402.30 + 50 a 415 → 406.04)", async () => {
  const { db, getBalance } = buildFakeDb({ initialBalances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 120, weightedAverageCost: 402.30 }] });
  const result = await createMultiBranchIntake({
    clientRequestId: "req-blend",
    actorUserId: "user-1",
    kind: "ADD_STOCK",
    reason: "Llegó pedido",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p1", quantity: 50, unitCost: 415 }],
  }, db);
  assert.equal(result.branches[0].status, "DONE");
  const balance = getBalance(BRANCH_1, "p1");
  assert.equal(Number(balance.quantityOnHand), 170);
  assert.equal(Number(balance.weightedAverageCost.toFixed(2)), 406.04);
});

test("PHYSICAL_COUNT no toca el costo, aunque el conteo suba el stock", async () => {
  const { db, getBalance } = buildFakeDb({ initialBalances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 40, weightedAverageCost: 402.30 }] });
  const result = await createMultiBranchIntake({
    clientRequestId: "req-count",
    actorUserId: "user-1",
    kind: "PHYSICAL_COUNT",
    reason: "Conteo mensual",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p1", quantity: 37 }],
  }, db);
  assert.equal(result.branches[0].status, "DONE");
  const balance = getBalance(BRANCH_1, "p1");
  assert.equal(Number(balance.quantityOnHand), 37, "el conteo FIJA el stock, no suma");
  assert.equal(Number(balance.weightedAverageCost), 402.30, "el costo no se mueve");
});

test("PHYSICAL_COUNT puede fijar el stock en 0 (no se omite como si fuera 'nada que hacer')", async () => {
  const { db, getBalance } = buildFakeDb({ initialBalances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 40, weightedAverageCost: 100 }] });
  const result = await createMultiBranchIntake({
    clientRequestId: "req-count-zero",
    actorUserId: "user-1",
    kind: "PHYSICAL_COUNT",
    reason: "Conteo",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p1", quantity: 0 }],
  }, db);
  assert.equal(result.branches[0].status, "DONE");
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 0);
});

// ── OPENING_BALANCE con stock existente — guarda de servidor ──────────────

test("LA QUE IMPORTA — OPENING_BALANCE sobre un producto que YA tiene existencias falla (no es 'sumar disfrazado')", async () => {
  const { db } = buildFakeDb({ initialBalances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 15, weightedAverageCost: 50 }] });
  const result = await createMultiBranchIntake({
    clientRequestId: "req-opening-dup",
    actorUserId: "user-1",
    kind: "OPENING_BALANCE",
    reason: "Apertura",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p1", quantity: 10, unitCost: 60 }],
  }, db);
  assert.equal(result.branches[0].status, "FAILED");
  assert.match(result.branches[0].error ?? "", /ya tiene existencias/);
});

// ── Resto de escenarios ya cubiertos antes, adaptados al nuevo shape ──────

test("una sucursal con producto inexistente FAILED, las demás DONE (una no tumba las otras)", async () => {
  const { db, getBalance } = buildFakeDb({ products: new Set(["p1"]) }); // p2 "no existe"
  const result = await createMultiBranchIntake({
    clientRequestId: "req-2",
    actorUserId: "user-1",
    kind: "OPENING_BALANCE",
    reason: "Carga inicial",
    branchIds: [BRANCH_1, BRANCH_2],
    lines: [
      { productId: "p1", quantity: 10, unitCost: 50 },
      { productId: "p2", quantity: 5, unitCost: 20, overrides: { [BRANCH_1]: 0 } },
    ],
  }, db);

  const branch1 = result.branches.find((b) => b.branchId === BRANCH_1)!;
  const branch2 = result.branches.find((b) => b.branchId === BRANCH_2)!;
  assert.equal(branch1.status, "DONE");
  assert.equal(branch2.status, "FAILED");
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 10);
});

test("LA QUE IMPORTA — doble envío con el mismo clientRequestId → un solo documento, no reprocesa", async () => {
  const { db, movements } = buildFakeDb();
  const input = {
    clientRequestId: "req-idempotent",
    actorUserId: "user-1",
    kind: "OPENING_BALANCE" as const,
    reason: "Carga inicial",
    branchIds: [BRANCH_1, BRANCH_2],
    lines: [{ productId: "p1", quantity: 10, unitCost: 50 }],
  };
  const first = await createMultiBranchIntake(input, db);
  const movementsAfterFirst = movements.length;
  const second = await createMultiBranchIntake(input, db);

  assert.equal(second.intake.id, first.intake.id, "mismo documento, no uno nuevo");
  assert.equal(movements.length, movementsAfterFirst, "el segundo envío no creó ningún movimiento nuevo");
  assert.ok(second.branches.every((b) => b.status === "DONE"));
});

test("LA QUE IMPORTA — reanudar después de fallar la tanda 2 no duplica la tanda 1 (30 líneas, tandas de 25)", async () => {
  const productIds = Array.from({ length: 30 }, (_, i) => `p${i + 1}`);
  const { db, getBalance, products, intakeBranches } = buildFakeDb({ products: new Set(productIds.slice(0, 25)) }); // p26..p30 "no existen" todavía
  const lines = productIds.map((productId) => ({ productId, quantity: 10, unitCost: 50 }));

  const created = await createMultiBranchIntake({
    clientRequestId: "req-batches",
    actorUserId: "user-1",
    kind: "OPENING_BALANCE",
    reason: "Carga inicial",
    branchIds: [BRANCH_1],
    lines,
  }, db);

  assert.equal(created.branches[0].status, "FAILED", "la tanda 2 (líneas 26-30) falla — p26 no existe");
  const branchRow = intakeBranches.find((b) => b.branchId === BRANCH_1)!;
  assert.equal(branchRow.processedLines, 25, "la tanda 1 (25 líneas) SÍ quedó confirmada");
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 10, "p1 (tanda 1) ya tiene su stock");

  products.add("p26"); products.add("p27"); products.add("p28"); products.add("p29"); products.add("p30");
  const retried = await retryMultiBranchIntake(created.intake.id, "user-1", db);

  assert.equal(retried.branches.find((b) => b.branchId === BRANCH_1)!.status, "DONE");
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 10, "p1 NO se duplicó — sigue en 10, no 20");
  assert.equal(Number(getBalance(BRANCH_1, "p30").quantityOnHand), 10, "p30 (tanda 2, tras el retry) sí quedó cargado");
});

test("retry solo reprocesa las FAILED, no toca las ya DONE", async () => {
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

  products.add("p2");
  const retried = await retryMultiBranchIntake(created.intake.id, "user-1", db);
  assert.equal(retried.branches.find((b) => b.branchId === BRANCH_1)!.status, "DONE");
  assert.equal(retried.branches.find((b) => b.branchId === BRANCH_2)!.status, "DONE");
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 10, "no se duplicó");
});

test("LA QUE IMPORTA — /continue retoma una sucursal IN_PROGRESS (presupuesto de tiempo agotado antes), sin reprocesar lo ya confirmado", async () => {
  const { db, getBalance, intakeBranches, intakes } = buildFakeDb({ products: new Set(["p1", "p2", "p3"]) });
  // Simula una corrida previa interrumpida a mitad: crea el documento a mano
  // (sin pasar por createMultiBranchIntake, que correría todo de una) para
  // dejar la sucursal en IN_PROGRESS con 1 de 3 líneas ya procesadas.
  intakes.push({ id: "intake-manual", code: "IM-000099", sequence: 99, clientRequestId: "req-manual", kind: "ADD_STOCK", reason: "Llegó pedido", notes: null, linesJson: [
    { productId: "p1", quantity: 5, unitCost: 10 },
    { productId: "p2", quantity: 5, unitCost: 10 },
    { productId: "p3", quantity: 5, unitCost: 10 },
  ] });
  intakeBranches.push({ id: "ib-manual", intakeId: "intake-manual", branchId: BRANCH_1, status: "IN_PROGRESS", error: null, processedLines: 1, totalLines: 3 });
  getBalance(BRANCH_1, "p1").quantityOnHand = decimal(5); // p1 ya se procesó en la corrida "anterior"

  const result = await continueMultiBranchIntake("intake-manual", "user-1", db);
  assert.equal(result.branches.find((b) => b.branchId === BRANCH_1)!.status, "DONE");
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 5, "p1 no se reprocesó (seguía en 5, no subió a 10)");
  assert.equal(Number(getBalance(BRANCH_1, "p2").quantityOnHand), 5, "p2 y p3 sí se procesaron ahora");
  assert.equal(Number(getBalance(BRANCH_1, "p3").quantityOnHand), 5);
});

test("getMultiBranchIntake — inexistente da NOT_FOUND", async () => {
  const { db } = buildFakeDb();
  await assert.rejects(() => getMultiBranchIntake("no-existe", db), /NOT_FOUND/);
});

test("ADJUSTMENT_IN (kind legado) se comporta igual que ADD_STOCK", async () => {
  const { db, getBalance } = buildFakeDb({ initialBalances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 40, weightedAverageCost: 100 }] });
  const result = await createMultiBranchIntake({
    clientRequestId: "req-legacy",
    actorUserId: "user-1",
    kind: "ADJUSTMENT_IN",
    reason: "Ajuste",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p1", quantity: 10, unitCost: 120 }],
  }, db);
  assert.equal(result.branches[0].status, "DONE");
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 50, "sumó, igual que ADD_STOCK");
});
