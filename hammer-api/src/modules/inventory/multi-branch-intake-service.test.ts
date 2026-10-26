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
  updateMultiBranchIntakeBranchLines,
  discardMultiBranchIntakeBranch,
  PossibleDuplicateIntakeError,
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

function buildFakeDb(opts: { products?: Set<string>; standardSalePrice?: number; initialBalances?: Array<{ branchId: string; productId: string; quantityOnHand: number; weightedAverageCost: number }>; blockedProducts?: Map<string, { isActive?: boolean; mergedIntoProductId?: string | null; mergedInto?: { sku: string; name: string } | null }>; productCost?: Map<string, { globalCost?: number; averageCost?: number; lastPurchaseCost?: number }> } = {}) {
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

  // Costo a nivel producto (globalCost/averageCost/lastPurchaseCost) para
  // resolveInboundUnitCost (prompt-entrada-reintento-precio.md Commit 1) —
  // por defecto ninguno (los tests existentes siempre mandan un costo
  // entrado o no lo necesitan); opts.productCost lo setea por test.
  const productCostById = opts.productCost ?? new Map<string, { globalCost?: number; averageCost?: number; lastPurchaseCost?: number }>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake-db recursivo (db.$transaction se pasa a sí mismo).
  const db: any = {
    productStockGroupMember: { findFirst: async () => null, findMany: async () => [] },
    branch: {
      // runBranches (Commit 1) — códigos de sucursal para los mensajes en
      // español ("No tiene costo en RIV..."); en los tests, el código ES el id.
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, code: id })),
    },
    product: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        if (!products.has(where.id)) throw new Error(`NOT_FOUND: producto ${where.id} no existe`);
        return { id: where.id, standardSalePrice: decimal(opts.standardSalePrice ?? 100) };
      },
      findUnique: async ({ where }: { where: { id: string } }) => (products.has(where.id) ? { id: where.id, standardSalePrice: decimal(opts.standardSalePrice ?? 100) } : null),
      // assertProductsIntakeable (prompt-entrada-multisucursal-fix.md) Y
      // getEffectiveProductPricingBatch (Commit 1 de prompt-entrada-reintento-
      // precio.md, vía resolveInboundUnitCostBatch) comparten este mismo
      // mock — por eso trae AMBOS juegos de campos.
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => products.has(id)).map((id) => {
          const blocked = opts.blockedProducts?.get(id);
          const cost = productCostById.get(id);
          return {
            id,
            sku: id.toUpperCase(),
            name: `Producto ${id}`,
            isActive: blocked?.isActive ?? true,
            mergedIntoProductId: blocked?.mergedIntoProductId ?? null,
            mergedInto: blocked?.mergedInto ?? null,
            standardSalePrice: decimal(opts.standardSalePrice ?? 100),
            globalCost: cost?.globalCost !== undefined ? decimal(cost.globalCost) : null,
            averageCost: cost?.averageCost !== undefined ? decimal(cost.averageCost) : null,
            lastPurchaseCost: cost?.lastPurchaseCost !== undefined ? decimal(cost.lastPurchaseCost) : null,
          };
        }),
    },
    branchProductSetting: {
      findUnique: async () => null,
      findMany: async () => [],
      upsert: async ({ create }: { create: Record<string, unknown> }) => create,
    },
    inventoryBalance: {
      upsert: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) => getBalance(where.branchId_productId.branchId, where.branchId_productId.productId),
      findUnique: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) => getBalance(where.branchId_productId.branchId, where.branchId_productId.productId),
      // resolveInboundUnitCostBatch/prevalidateBranchLines (Commit 1) — WAC
      // por sucursal para la cadena de costo; también usado para el chequeo
      // de PHYSICAL_COUNT en la prevalidación. Nunca devuelve una fila para
      // un par sin balance todavía (mismo criterio que el real: "sin fila
      // todavía" no es WAC=0, es "no sé").
      findMany: async ({ where }: { where: { productId: { in: string[] }; branchId: { in: string[] } | string } }) => {
        const productIds = where.productId.in;
        const branchIds = typeof where.branchId === "string" ? [where.branchId] : where.branchId.in;
        return [...balances.values()]
          .filter((b) => productIds.includes(b.productId) && branchIds.includes(b.branchId))
          .map((b) => ({ branchId: b.branchId, productId: b.productId, quantityOnHand: b.quantityOnHand, weightedAverageCost: b.weightedAverageCost }));
      },
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
    // confirmadas antes) Y el reclamo de processedLines que abrió la misma
    // transacción (Commit 1 §4: reclamo + aplicación se confirman juntos o
    // no se confirma nada) — el fake simula las TRES cosas con
    // snapshot/restore, intakeBranches incluido.
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => {
      const balancesSnapshot = new Map([...balances].map(([k, v]) => [k, { ...v }]));
      const movementsLenSnapshot = movements.length;
      const intakeBranchesSnapshot = intakeBranches.map((b) => ({ ...b }));
      try {
        return await fn(db);
      } catch (error) {
        balances.clear();
        for (const [k, v] of balancesSnapshot) balances.set(k, v);
        movements.length = movementsLenSnapshot;
        intakeBranches.length = 0;
        intakeBranches.push(...intakeBranchesSnapshot);
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
        const row = { id: `intake-${intakes.length + 1}`, createdAt: new Date(), ...data };
        intakes.push(row);
        return row;
      },
    },
    multiBranchIntakeBranch: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const d of data) intakeBranches.push({ id: `ib-${intakeBranches.length + 1}`, processedLines: 0, totalLines: 0, error: null, linesOverrideJson: null, revision: 0, ...d });
        return { count: data.length };
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const { intakeId, branchId, ...rest } = where;
        const matches = intakeBranches.filter((b) => b.intakeId === intakeId && b.branchId === branchId && matchesWhere(b, rest));
        matches.forEach((b) => Object.assign(b, data));
        return { count: matches.length };
      },
      findUnique: async ({ where }: { where: { intakeId_branchId: { intakeId: string; branchId: string } } }) => findIntakeBranch(where.intakeId_branchId.intakeId, where.intakeId_branchId.branchId) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { intakeId_branchId: { intakeId: string; branchId: string } } }) => {
        const found = findIntakeBranch(where.intakeId_branchId.intakeId, where.intakeId_branchId.branchId);
        if (!found) throw new Error("NOT_FOUND: MultiBranchIntakeBranch");
        return found;
      },
      // Commit 2 §2 (overrideRows en runBranches) y §4 (findPossibleDuplicateIntake)
      // — los dos únicos usos reales de este findMany: por intakeId+branchId+
      // linesOverrideJson no-null, y por branchId+status FAILED+intake.createdAt
      // reciente. El join a `intake`/`branch` se arma a mano (el fake no tiene
      // relaciones de verdad).
      findMany: async ({ where, orderBy }: { where: { intakeId?: string; branchId?: { in: string[] }; status?: string; linesOverrideJson?: { not: unknown }; intake?: { createdAt?: { gte: Date } } }; orderBy?: { intake?: { createdAt?: "asc" | "desc" } } }) => {
        const rows = intakeBranches.filter((b) => {
          if (where.intakeId !== undefined && b.intakeId !== where.intakeId) return false;
          if (where.branchId && !where.branchId.in.includes(b.branchId as string)) return false;
          if (where.status !== undefined && b.status !== where.status) return false;
          if (where.linesOverrideJson?.not !== undefined && (b.linesOverrideJson === null || b.linesOverrideJson === undefined)) return false;
          return true;
        });
        let withIntake = rows.map((b) => ({ row: b, intake: intakes.find((i) => i.id === b.intakeId)! }));
        if (where.intake?.createdAt?.gte) withIntake = withIntake.filter(({ intake }) => (intake.createdAt as Date).getTime() >= where.intake!.createdAt!.gte.getTime());
        if (orderBy?.intake?.createdAt === "desc") withIntake.sort((a, c) => (c.intake.createdAt as Date).getTime() - (a.intake.createdAt as Date).getTime());
        return withIntake.map(({ row, intake }) => ({
          ...row,
          intake: { id: intake.id, code: intake.code, linesJson: intake.linesJson },
          branch: { name: row.branchId },
        }));
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
  assert.equal(costModeForKind("ADD_STOCK", true), "BLEND", "con costo, sumar PROMEDIA — BLEND es el alias claro de SET_WAC");
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

// ── prompt-entrada-reintento-precio.md Commit 1 — regresión directa de IM-000008 ──

test("LA QUE IMPORTA — caso real IM-000008: ADD_STOCK sin costo entrado, sin WAC en la sucursal, PERO con averageCost a nivel producto — ya NO revienta con ZERO_COST_INBOUND", async () => {
  const { db, getBalance } = buildFakeDb({ products: new Set(["bisagras"]), productCost: new Map([["bisagras", { averageCost: 75 }]]) });
  // RIV (BRANCH_1 acá) nunca tuvo una fila de balance para este producto —
  // mismo estado exacto que RIV tenía para BISAGRAS CRONO en producción.
  const result = await createMultiBranchIntake({
    clientRequestId: "req-im8",
    actorUserId: "user-1",
    kind: "ADD_STOCK",
    reason: "Llegó pedido",
    branchIds: [BRANCH_1],
    lines: [{ productId: "bisagras", quantity: 6 }], // sin unitCost — igual que la línea real
  }, db);
  assert.equal(result.branches[0].status, "DONE", "antes del fix, esto fallaba con 'Inbound movements require a positive unit cost' aunque la vista previa decía OK");
  const balance = getBalance(BRANCH_1, "bisagras");
  assert.equal(Number(balance.quantityOnHand), 6);
  assert.equal(Number(balance.weightedAverageCost), 75, "el movimiento usa el costo resuelto (cadena), no 0");
});

test("LA QUE IMPORTA — prevalidación por sucursal: sin costo en NINGUNA parte, la sucursal queda FAILED SIN aplicar nada, con errorJson con el producto", async () => {
  const { db, getBalance } = buildFakeDb();
  const result = await createMultiBranchIntake({
    clientRequestId: "req-noavg",
    actorUserId: "user-1",
    kind: "ADD_STOCK",
    reason: "Llegó pedido",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p1", quantity: 6 }],
  }, db);
  assert.equal(result.branches[0].status, "FAILED");
  assert.equal(result.branches[0].processedLines, 0, "nada se aplicó — la prevalidación corrió ANTES de la primera tanda");
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 0);
  assert.ok(result.branches[0].errorJson, "debe traer errorJson, no solo el texto plano");
  assert.equal(result.branches[0].errorJson?.lines.length, 1);
  assert.equal(result.branches[0].errorJson?.lines[0].productId, "p1");
  assert.equal(result.branches[0].errorJson?.lines[0].code, "NO_COST_NO_AVERAGE");
  assert.match(result.branches[0].errorJson?.lines[0].text ?? "", /branch-1/i, "el mensaje dice en QUÉ sucursal (branch-1 es el código en este fake)");
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
  // El error de guardado dice QUÉ producto falló (antes iba con productId "").
  assert.equal(result.branches[0].errorJson?.lines[0]?.productId, "p1");
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

test("producto inactivo rechaza toda la carga, con el mismo motivo que el preview", async () => {
  const { db } = buildFakeDb({ products: new Set(["p1"]), blockedProducts: new Map([["p1", { isActive: false }]]) });
  await assert.rejects(
    () => createMultiBranchIntake({
      clientRequestId: "req-inactive",
      actorUserId: "user-1",
      kind: "ADD_STOCK",
      reason: "Llegó pedido",
      branchIds: [BRANCH_1],
      lines: [{ productId: "p1", quantity: 10 }],
    }, db),
    /inactivo/,
  );
});

test("producto unificado en otro rechaza toda la carga con el nombre del principal", async () => {
  const { db } = buildFakeDb({ products: new Set(["p2"]), blockedProducts: new Map([["p2", { mergedIntoProductId: "p1", mergedInto: { sku: "SKU-1", name: "Producto Principal" } }]]) });
  await assert.rejects(
    () => createMultiBranchIntake({
      clientRequestId: "req-merged",
      actorUserId: "user-1",
      kind: "ADD_STOCK",
      reason: "Llegó pedido",
      branchIds: [BRANCH_1],
      lines: [{ productId: "p2", quantity: 10 }],
    }, db),
    /Producto Principal/,
  );
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

test("LA QUE IMPORTA — dos /continue simultáneos sobre la misma sucursal no duplican existencias (Commit 1 §4: el reclamo de processedLines está DENTRO de la transacción de la tanda)", async () => {
  const { db, getBalance, intakeBranches, intakes } = buildFakeDb({ products: new Set(["p1", "p2", "p3"]) });
  intakes.push({ id: "intake-race", code: "IM-000098", sequence: 98, clientRequestId: "req-race", kind: "ADD_STOCK", reason: "Llegó pedido", notes: null, linesJson: [
    { productId: "p1", quantity: 5, unitCost: 10 },
    { productId: "p2", quantity: 5, unitCost: 10 },
    { productId: "p3", quantity: 5, unitCost: 10 },
  ] });
  intakeBranches.push({ id: "ib-race", intakeId: "intake-race", branchId: BRANCH_1, status: "IN_PROGRESS", error: null, processedLines: 0, totalLines: 3 });

  // Dos corridas "al mismo tiempo" — Promise.all interlaza las dos cadenas
  // de promesas en los mismos puntos `await` que usaría Node con dos
  // requests HTTP concurrentes reales.
  const [resultA, resultB] = await Promise.all([
    continueMultiBranchIntake("intake-race", "user-1", db),
    continueMultiBranchIntake("intake-race", "user-1", db),
  ]);

  const finalBranch = intakeBranches.find((b) => b.intakeId === "intake-race" && b.branchId === BRANCH_1)!;
  assert.equal(finalBranch.status, "DONE");
  assert.equal(finalBranch.processedLines, 3, "nunca más de totalLines — si se hubiera aplicado dos veces, el reclamo habría quedado en 6");
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 5, "una sola aplicación, no dos");
  assert.equal(Number(getBalance(BRANCH_1, "p2").quantityOnHand), 5);
  assert.equal(Number(getBalance(BRANCH_1, "p3").quantityOnHand), 5);
  // Una de las dos corridas hizo el trabajo real; la otra encontró todo ya
  // reclamado/hecho y no tiene nada más que aplicar — ambas devuelven DONE.
  assert.equal(resultA.branches.find((b) => b.branchId === BRANCH_1)!.status, "DONE");
  assert.equal(resultB.branches.find((b) => b.branchId === BRANCH_1)!.status, "DONE");
});

test("getMultiBranchIntake — inexistente da NOT_FOUND", async () => {
  const { db } = buildFakeDb();
  await assert.rejects(() => getMultiBranchIntake("no-existe", db), /NOT_FOUND/);
});

test("LA QUE IMPORTA — getMultiBranchIntake enriquece linesJson con sku/name para el detalle de solo lectura (Fase 3)", async () => {
  const { db } = buildFakeDb();
  const created = await createMultiBranchIntake({
    clientRequestId: "req-detail",
    actorUserId: "user-1",
    kind: "OPENING_BALANCE",
    reason: "Apertura",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p1", quantity: 10, unitCost: 50 }],
  }, db);

  db.product.findMany = async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.filter((id) => id === "p1").map((id) => ({ id, sku: "SKU-P1", name: "Producto 1" }));

  const detail = await getMultiBranchIntake(created.intake.id, db);
  assert.equal(detail.linesDetail.length, 1);
  assert.deepEqual(detail.linesDetail[0].product, { id: "p1", sku: "SKU-P1", name: "Producto 1" });
});

test("LA QUE IMPORTA — getMultiBranchIntake enriquece overrideLinesDetail, incluso con un producto que NO está en el pedido original (reemplazo de una línea descartada)", async () => {
  const { db } = buildFakeDb({ products: new Set(["p1"]) }); // p2 "no existe" -> FAILED
  const created = await createMultiBranchIntake({
    clientRequestId: "req-override-detail",
    actorUserId: "user-1",
    kind: "ADD_STOCK",
    reason: "Llegó pedido",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p2", quantity: 5 }],
  }, db);
  assert.equal(created.branches[0].status, "FAILED");

  await updateMultiBranchIntakeBranchLines({
    intakeId: created.intake.id,
    branchId: BRANCH_1,
    lines: [{ productId: "p1", quantity: 3, unitCost: 10 }], // p1 reemplaza a p2 -- nunca estuvo en `lines`
    expectedRevision: 0,
    actorUserId: "user-1",
  }, db);

  db.product.findMany = async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.filter((id) => id === "p1").map((id) => ({ id, sku: "SKU-P1", name: "Producto 1" }));

  const detail = await getMultiBranchIntake(created.intake.id, db);
  const branch = detail.branches.find((b) => b.branchId === BRANCH_1)!;
  assert.ok(branch.overrideLinesDetail, "la sucursal con override trae su propio detalle enriquecido");
  assert.equal(branch.overrideLinesDetail?.length, 1);
  assert.equal(branch.overrideLinesDetail?.[0].productId, "p1");
  assert.deepEqual(branch.overrideLinesDetail?.[0].product, { id: "p1", sku: "SKU-P1", name: "Producto 1" }, "p1 nunca estuvo en linesJson, pero igual se resuelve sku/name");
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

// ── prompt-entrada-reintento-precio.md Commit 2 — editar y reintentar ────

test("LA QUE IMPORTA — editar una sucursal FAILED no toca las que ya quedaron DONE", async () => {
  const { db, intakeBranches } = buildFakeDb({ products: new Set(["p1"]) }); // p2 "no existe" -> BRANCH_2 falla
  const created = await createMultiBranchIntake({
    clientRequestId: "req-edit-1",
    actorUserId: "user-1",
    kind: "OPENING_BALANCE",
    reason: "Carga inicial",
    branchIds: [BRANCH_1, BRANCH_2],
    lines: [
      { productId: "p1", quantity: 10, unitCost: 50, overrides: { [BRANCH_2]: 0 } },
      { productId: "p2", quantity: 5, unitCost: 20, overrides: { [BRANCH_1]: 0 } },
    ],
  }, db);
  assert.equal(created.branches.find((b) => b.branchId === BRANCH_1)!.status, "DONE");
  assert.equal(created.branches.find((b) => b.branchId === BRANCH_2)!.status, "FAILED");
  const branch1Before = { ...intakeBranches.find((b) => b.branchId === BRANCH_1)! };

  await updateMultiBranchIntakeBranchLines({
    intakeId: created.intake.id,
    branchId: BRANCH_2,
    lines: [{ productId: "p2", quantity: 5, unitCost: 20 }],
    expectedRevision: 0,
    actorUserId: "user-1",
  }, db);

  const branch1After = intakeBranches.find((b) => b.branchId === BRANCH_1)!;
  assert.deepEqual(branch1After, branch1Before, "la sucursal DONE no se tocó en absoluto");
  const branch2After = intakeBranches.find((b) => b.branchId === BRANCH_2)!;
  assert.equal(branch2After.revision, 1);
  assert.ok(branch2After.linesOverrideJson, "la FAILED sí quedó con el override");
});

test("editar con expectedRevision viejo (desactualizado) -> CONFLICT (409)", async () => {
  const { db } = buildFakeDb({ products: new Set(["p1"]) }); // p2 "no existe" -> falla
  const created = await createMultiBranchIntake({
    clientRequestId: "req-edit-2",
    actorUserId: "user-1",
    kind: "ADD_STOCK",
    reason: "Llegó pedido",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p2", quantity: 5 }],
  }, db);
  assert.equal(created.branches[0].status, "FAILED");

  await updateMultiBranchIntakeBranchLines({ intakeId: created.intake.id, branchId: BRANCH_1, lines: [{ productId: "p1", quantity: 5 }], expectedRevision: 0, actorUserId: "user-1" }, db);
  await assert.rejects(
    () => updateMultiBranchIntakeBranchLines({ intakeId: created.intake.id, branchId: BRANCH_1, lines: [{ productId: "p1", quantity: 7 }], expectedRevision: 0, actorUserId: "user-1" }, db),
    /CONFLICT/,
    "expectedRevision:0 ya no es el vigente (ya quedó en 1 tras la primera edición)",
  );
});

test("editar una sucursal DONE -> CONFLICT (409), solo se edita una que falló", async () => {
  const { db } = buildFakeDb({ products: new Set(["p1"]) });
  const created = await createMultiBranchIntake({
    clientRequestId: "req-edit-3",
    actorUserId: "user-1",
    kind: "OPENING_BALANCE",
    reason: "Carga inicial",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p1", quantity: 10, unitCost: 50 }],
  }, db);
  assert.equal(created.branches[0].status, "DONE");

  await assert.rejects(
    () => updateMultiBranchIntakeBranchLines({ intakeId: created.intake.id, branchId: BRANCH_1, lines: [{ productId: "p1", quantity: 20, unitCost: 50 }], expectedRevision: 0, actorUserId: "user-1" }, db),
    /CONFLICT/,
  );
});

test("LA QUE IMPORTA — editar + reintentar aplica el override corregido una sola vez (no duplica)", async () => {
  const { db, getBalance } = buildFakeDb({ products: new Set(["p1"]) });
  const created = await createMultiBranchIntake({
    clientRequestId: "req-edit-retry",
    actorUserId: "user-1",
    kind: "ADD_STOCK",
    reason: "Llegó pedido",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p1", quantity: 6 }], // sin costo entrado, sin WAC, sin averageCost -> FAILED
  }, db);
  assert.equal(created.branches[0].status, "FAILED");
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 0);

  await updateMultiBranchIntakeBranchLines({
    intakeId: created.intake.id,
    branchId: BRANCH_1,
    lines: [{ productId: "p1", quantity: 6, unitCost: 80 }],
    expectedRevision: 0,
    actorUserId: "user-1",
  }, db);

  const retried = await retryMultiBranchIntake(created.intake.id, "user-1", db);
  assert.equal(retried.branches[0].status, "DONE");
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 6, "se aplicó una sola vez");
  assert.equal(Number(getBalance(BRANCH_1, "p1").weightedAverageCost), 80, "con el costo corregido del override, no el de la entrada original (sin costo)");

  await retryMultiBranchIntake(created.intake.id, "user-1", db);
  assert.equal(Number(getBalance(BRANCH_1, "p1").quantityOnHand), 6, "un segundo retry (ya DONE) no reprocesa ni duplica");
});

test("LA QUE IMPORTA — falla a mitad (25 de 40 líneas): las 25 quedan bloqueadas y el reintento corregido aplica solo las 15 pendientes", async () => {
  const productIds = Array.from({ length: 40 }, (_, i) => `o${i + 1}`);
  const { db, getBalance } = buildFakeDb({
    products: new Set([...productIds, "o41"]),
    // o26 ya tiene existencias -- dispara la guarda de OPENING_BALANCE a
    // mitad de la SEGUNDA tanda (líneas 26-40), revirtiendo esa tanda ENTERA
    // (una tanda es una sola transacción) sin tocar la primera (ya confirmada).
    initialBalances: [{ branchId: BRANCH_1, productId: "o26", quantityOnHand: 1, weightedAverageCost: 999 }],
  });
  const lines = productIds.map((productId) => ({ productId, quantity: 10, unitCost: 50 }));

  const created = await createMultiBranchIntake({
    clientRequestId: "req-mid-fail",
    actorUserId: "user-1",
    kind: "OPENING_BALANCE",
    reason: "Carga inicial",
    branchIds: [BRANCH_1],
    lines,
  }, db);

  assert.equal(created.branches[0].status, "FAILED");
  assert.equal(created.branches[0].processedLines, 25, "la tanda 1 (25 líneas) quedó confirmada");
  assert.equal(Number(getBalance(BRANCH_1, "o1").quantityOnHand), 10, "o1 (tanda 1) sí se aplicó");
  assert.equal(Number(getBalance(BRANCH_1, "o27").quantityOnHand), 0, "o27 (tanda 2, junto a la que falló) NO se aplicó -- la tanda entera se revirtió");

  // Corrección: o26 (la que ya tenía existencias) se reemplaza por o41 --
  // los otros 14 pendientes (o27..o40) se mandan sin cambios. Sigue siendo
  // un override de 15 líneas, "las pendientes de esa sucursal".
  const overrideLines = [
    { productId: "o41", quantity: 10, unitCost: 50 },
    ...Array.from({ length: 14 }, (_, i) => ({ productId: `o${i + 27}`, quantity: 10, unitCost: 50 })),
  ];
  assert.equal(overrideLines.length, 15);

  await updateMultiBranchIntakeBranchLines({ intakeId: created.intake.id, branchId: BRANCH_1, lines: overrideLines, expectedRevision: 0, actorUserId: "user-1" }, db);
  const retried = await retryMultiBranchIntake(created.intake.id, "user-1", db);

  assert.equal(retried.branches[0].status, "DONE");
  assert.equal(Number(getBalance(BRANCH_1, "o1").quantityOnHand), 10, "o1 (tanda 1) no se duplicó");
  assert.equal(Number(getBalance(BRANCH_1, "o27").quantityOnHand), 10, "o27 (pendiente, sin cambios en la corrección) ahora sí se aplicó");
  assert.equal(Number(getBalance(BRANCH_1, "o41").quantityOnHand), 10, "o41 (el reemplazo de o26) se aplicó");
  assert.equal(Number(getBalance(BRANCH_1, "o26").quantityOnHand), 1, "o26 (descartada de la corrección) nunca se tocó -- sigue con su stock original");
});

test("descartar una sucursal que YA aplicó líneas (processedLines > 0) se rechaza -- se corrige con otra entrada, no se descarta", async () => {
  const productIds = Array.from({ length: 30 }, (_, i) => `d${i + 1}`);
  const { db } = buildFakeDb({ products: new Set(productIds.slice(0, 25)) }); // d26..d30 "no existen" todavía
  const lines = productIds.map((productId) => ({ productId, quantity: 10, unitCost: 50 }));
  const created = await createMultiBranchIntake({
    clientRequestId: "req-discard-blocked",
    actorUserId: "user-1",
    kind: "OPENING_BALANCE",
    reason: "Carga inicial",
    branchIds: [BRANCH_1],
    lines,
  }, db);
  assert.equal(created.branches[0].status, "FAILED");
  assert.equal(created.branches[0].processedLines, 25, "la tanda 1 sí aplicó");

  await assert.rejects(
    () => discardMultiBranchIntakeBranch({ intakeId: created.intake.id, branchId: BRANCH_1, reason: "ya no hace falta", actorUserId: "user-1" }, db),
    /CONFLICT/,
  );
});

test("descartar una sucursal FAILED sin nada aplicado (processedLines === 0) sí funciona -- pasa a DISCARDED", async () => {
  const { db } = buildFakeDb({ products: new Set(["p1"]) });
  const created = await createMultiBranchIntake({
    clientRequestId: "req-discard-ok",
    actorUserId: "user-1",
    kind: "ADD_STOCK",
    reason: "Llegó pedido",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p2", quantity: 5 }], // p2 no existe -> FAILED, nada aplicado
  }, db);
  assert.equal(created.branches[0].status, "FAILED");
  assert.equal(created.branches[0].processedLines, 0);

  await discardMultiBranchIntakeBranch({ intakeId: created.intake.id, branchId: BRANCH_1, reason: "se compró en otra sucursal", actorUserId: "user-1" }, db);

  await assert.rejects(
    () => discardMultiBranchIntakeBranch({ intakeId: created.intake.id, branchId: BRANCH_1, reason: "de nuevo", actorUserId: "user-1" }, db),
    /CONFLICT/,
    "ya no está FAILED (está DISCARDED) -- no se puede descartar dos veces",
  );
});

test("overallStatus es DONE_WITH_FAILURES ('Con fallas') si alguna sucursal quedó FAILED y las demás ya terminaron", async () => {
  const { db } = buildFakeDb({ products: new Set(["p1"]) }); // p2 no existe
  const result = await createMultiBranchIntake({
    clientRequestId: "req-status-fails",
    actorUserId: "user-1",
    kind: "OPENING_BALANCE",
    reason: "Carga inicial",
    branchIds: [BRANCH_1, BRANCH_2],
    lines: [
      { productId: "p1", quantity: 10, unitCost: 50, overrides: { [BRANCH_2]: 0 } },
      { productId: "p2", quantity: 5, unitCost: 20, overrides: { [BRANCH_1]: 0 } },
    ],
  }, db);
  assert.equal(result.branches.find((b) => b.branchId === BRANCH_1)!.status, "DONE");
  assert.equal(result.branches.find((b) => b.branchId === BRANCH_2)!.status, "FAILED");
  assert.equal(result.overallStatus, "DONE_WITH_FAILURES");
});

test("overallStatus vuelve a DONE una vez que la única FAILED se descarta (DONE = todas DONE o DISCARDED)", async () => {
  const { db } = buildFakeDb({ products: new Set(["p1"]) });
  const created = await createMultiBranchIntake({
    clientRequestId: "req-status-done",
    actorUserId: "user-1",
    kind: "ADD_STOCK",
    reason: "Llegó pedido",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p2", quantity: 5 }], // p2 no existe -> FAILED
  }, db);
  assert.equal(created.overallStatus, "DONE_WITH_FAILURES");

  await discardMultiBranchIntakeBranch({ intakeId: created.intake.id, branchId: BRANCH_1, reason: "no hace falta", actorUserId: "user-1" }, db);
  const after = await retryMultiBranchIntake(created.intake.id, "user-1", db); // sin FAILED que reintentar -> solo recalcula el estado
  assert.equal(after.overallStatus, "DONE");
  assert.equal(after.branches[0].status, "DISCARDED");
});

// ── Commit 2 §4 — aviso de posible duplicado ──────────────────────────────

test("LA QUE IMPORTA — crear con los mismos productos que una FAILED reciente avisa posible duplicado; confirmDuplicate la crea igual", async () => {
  const { db } = buildFakeDb({ products: new Set(["p1"]) }); // p2 no existe -> falla
  const first = await createMultiBranchIntake({
    clientRequestId: "req-dup-1",
    actorUserId: "user-1",
    kind: "ADD_STOCK",
    reason: "Llegó pedido",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p2", quantity: 5 }],
  }, db);
  assert.equal(first.branches[0].status, "FAILED");

  await assert.rejects(
    () => createMultiBranchIntake({
      clientRequestId: "req-dup-2",
      actorUserId: "user-1",
      kind: "ADD_STOCK",
      reason: "Llegó pedido otra vez",
      branchIds: [BRANCH_1],
      lines: [{ productId: "p2", quantity: 5 }],
    }, db),
    (error: unknown) => {
      assert.ok(error instanceof PossibleDuplicateIntakeError);
      assert.equal(error.warning.intakeId, first.intake.id);
      assert.equal(error.warning.branchId, BRANCH_1);
      assert.equal(error.warning.matchPercent, 100);
      return true;
    },
  );

  const confirmed = await createMultiBranchIntake({
    clientRequestId: "req-dup-3",
    actorUserId: "user-1",
    kind: "ADD_STOCK",
    reason: "Llegó pedido otra vez",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p2", quantity: 5 }],
    confirmDuplicate: true,
  }, db);
  assert.notEqual(confirmed.intake.id, first.intake.id, "confirmDuplicate SÍ crea una entrada nueva, en vez de avisar");
});

test("posible duplicado: menos del 80% de productos en común NO avisa", async () => {
  const { db } = buildFakeDb({ products: new Set(["p1", "p2"]) }); // p3, p4, p5 no existen -> FAILED, pero igual cuentan para el % de productos
  await createMultiBranchIntake({
    clientRequestId: "req-dup-low-1",
    actorUserId: "user-1",
    kind: "ADD_STOCK",
    reason: "Llegó pedido",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p3", quantity: 5 }, { productId: "p4", quantity: 5 }],
  }, db);

  // Segunda entrada: solo p3 en común de 4 productos distintos (p3,p4,p5,p1) -> 1/4 = 25%, bajo el umbral de 80%.
  const second = await createMultiBranchIntake({
    clientRequestId: "req-dup-low-2",
    actorUserId: "user-1",
    kind: "ADD_STOCK",
    reason: "Otro pedido",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p3", quantity: 5 }, { productId: "p5", quantity: 5 }, { productId: "p1", quantity: 1 }],
  }, db);
  assert.ok(second.intake.id, "se creó sin aviso de duplicado");
});

test("posible duplicado: una FAILED de hace más de 14 días no cuenta", async () => {
  const { db, intakes } = buildFakeDb({ products: new Set([]) }); // p9 no existe -> FAILED
  await createMultiBranchIntake({
    clientRequestId: "req-dup-old-1",
    actorUserId: "user-1",
    kind: "ADD_STOCK",
    reason: "Llegó pedido",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p9", quantity: 5 }],
  }, db);
  const old = intakes.find((i) => i.clientRequestId === "req-dup-old-1")!;
  old.createdAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000); // hace 15 días -- fuera de la ventana de 14

  const second = await createMultiBranchIntake({
    clientRequestId: "req-dup-old-2",
    actorUserId: "user-1",
    kind: "ADD_STOCK",
    reason: "Otro pedido",
    branchIds: [BRANCH_1],
    lines: [{ productId: "p9", quantity: 5 }],
  }, db);
  assert.ok(second.intake.id, "se creó sin aviso -- la FAILED anterior ya pasó los 14 días");
});

// ── prompt-entrada-reintento-precio.md Commit 3 — precio de venta por sucursal ──

test("LA QUE IMPORTA — salePriceOverrides aplica un precio DISTINTO por sucursal, salePrice general es el resto", async () => {
  const { db } = buildFakeDb();
  const upserts: Array<{ branchId: string; branchPrice: number }> = [];
  const originalUpsert = db.branchProductSetting.upsert;
  db.branchProductSetting.upsert = async (args: { where: { branchId_productId: { branchId: string; productId: string } }; create: Record<string, unknown> }) => {
    if ("branchPrice" in args.create) upserts.push({ branchId: args.where.branchId_productId.branchId, branchPrice: Number(args.create.branchPrice) });
    return originalUpsert(args);
  };

  const result = await createMultiBranchIntake({
    clientRequestId: "req-saleprice",
    actorUserId: "user-1",
    kind: "ADD_STOCK",
    reason: "Llegó pedido",
    branchIds: [BRANCH_1, BRANCH_2],
    lines: [{ productId: "p1", quantity: 10, unitCost: 50, salePrice: 150, salePriceOverrides: { [BRANCH_1]: 180 } }],
  }, db);

  assert.equal(result.branches.find((b) => b.branchId === BRANCH_1)!.status, "DONE");
  assert.equal(result.branches.find((b) => b.branchId === BRANCH_2)!.status, "DONE");
  assert.equal(upserts.find((u) => u.branchId === BRANCH_1)?.branchPrice, 180, "BRANCH_1 usa el override");
  assert.equal(upserts.find((u) => u.branchId === BRANCH_2)?.branchPrice, 150, "BRANCH_2 usa el precio general (sin override)");
});
