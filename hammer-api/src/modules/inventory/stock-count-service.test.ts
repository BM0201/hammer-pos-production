import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  createStockCount,
  scanStockCount,
  correctStockCountLine,
  submitStockCount,
  approveStockCount,
  rejectStockCount,
  reopenStockCount,
  getStockCountForViewer,
  canAccessStockCount,
} from "@/modules/inventory/stock-count-service";

/**
 * prompt-conteo-delegado.md Commit 1 — fake-db en memoria, SIN conexión a
 * ninguna base real (regla del 22 oct). Extiende el mismo patrón de
 * multi-branch-intake-service.test.ts (createMultiBranchIntake real, sin
 * mockear) + lo propio de conteo: productBarcode (resolución de código),
 * productStockGroupMember (fusión/presentación), y las 4 tablas nuevas.
 */
function decimal(value: number) {
  return new Prisma.Decimal(value);
}

const BRANCH_1 = "branch-1";
const BRANCH_2 = "branch-2";
const COUNTER_USER = "user-counter";
const MASTER_USER = "user-master";

type ProductFixture = { id: string; sku?: string; name?: string; standardSalePrice?: number; isActive?: boolean; averageCost?: number };
type BarcodeFixture = { code: string; productId: string };
type FusionFixture = { stockGroupId: string; productId: string; isCanonical: boolean; conversionFactor: number; saleUnit: string; isPackagePresentation: boolean };

function buildFakeDb(opts: {
  products?: ProductFixture[];
  barcodes?: BarcodeFixture[];
  balances?: Array<{ branchId: string; productId: string; quantityOnHand: number; weightedAverageCost: number }>;
  fusionMembers?: FusionFixture[];
} = {}) {
  const products = opts.products ?? [];
  const barcodes = opts.barcodes ?? [];
  const balances = new Map<string, { id: string; branchId: string; productId: string; quantityOnHand: Prisma.Decimal; weightedAverageCost: Prisma.Decimal }>();
  const fusionMembers = opts.fusionMembers ?? [];
  const intakes: Array<Record<string, unknown>> = [];
  const intakeBranches: Array<Record<string, unknown>> = [];
  const stockCounts: Array<Record<string, unknown>> = [];
  const stockCountLines: Array<Record<string, unknown>> = [];
  const stockCountEvents: Array<Record<string, unknown>> = [];
  const stockCountUnknownCodes: Array<Record<string, unknown>> = [];
  let movementSeq = 0;
  const movements: Array<Record<string, unknown>> = [];

  for (const b of opts.balances ?? []) {
    balances.set(`${b.branchId}:${b.productId}`, { id: `bal-${b.branchId}:${b.productId}`, branchId: b.branchId, productId: b.productId, quantityOnHand: decimal(b.quantityOnHand), weightedAverageCost: decimal(b.weightedAverageCost) });
  }
  function getBalance(branchId: string, productId: string) {
    const k = `${branchId}:${productId}`;
    if (!balances.has(k)) balances.set(k, { id: `bal-${k}`, branchId, productId, quantityOnHand: decimal(0), weightedAverageCost: decimal(0) });
    return balances.get(k)!;
  }
  function productRow(id: string) {
    const p = products.find((x) => x.id === id);
    if (!p) return null;
    return { id: p.id, sku: p.sku ?? id.toUpperCase(), name: p.name ?? `Producto ${id}`, mergedIntoProductId: null, mergedInto: null, barcode: null, unit: "UN", standardSalePrice: decimal(p.standardSalePrice ?? 100), isActive: p.isActive ?? true, category: null, isActive2: true };
  }
  function withIncludes(row: Record<string, unknown>, include?: { lines?: unknown; unknownCodes?: unknown; branch?: unknown }) {
    if (!include) return row;
    const result: Record<string, unknown> = { ...row };
    if (include.lines) {
      result.lines = stockCountLines.filter((l) => l.stockCountId === row.id).map((l) => ({ ...l, product: productRow(l.productId as string) }));
    }
    if (include.unknownCodes) {
      result.unknownCodes = stockCountUnknownCodes.filter((u) => u.stockCountId === row.id);
    }
    if (include.branch) {
      result.branch = { id: row.branchId, code: row.branchId, name: row.branchId };
    }
    return result;
  }
  function findIntakeBranch(intakeId: string, branchId: string) {
    return intakeBranches.find((b) => b.intakeId === intakeId && b.branchId === branchId);
  }
  function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && "in" in (v as Record<string, unknown>)) return ((v as { in: unknown[] }).in).includes(row[k]);
      return row[k] === v;
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake db, db.$transaction se pasa a sí mismo.
  const db: any = {
    // ── Catálogo / fusión ──────────────────────────────────────────────
    productBarcode: {
      findUnique: async ({ where }: { where: { code: string } }) => {
        const found = barcodes.find((b) => b.code === where.code);
        return found ? { productId: found.productId } : null;
      },
    },
    productStockGroupMember: {
      findFirst: async ({ where }: { where: { productId: string } }) => {
        const member = fusionMembers.find((m) => m.productId === where.productId);
        if (!member) return null;
        const peers = fusionMembers.filter((m) => m.stockGroupId === member.stockGroupId);
        return {
          stockGroupId: member.stockGroupId,
          saleUnit: member.saleUnit,
          conversionFactor: decimal(member.conversionFactor),
          isPackagePresentation: member.isPackagePresentation,
          isCanonical: member.isCanonical,
          stockGroup: {
            code: member.stockGroupId, name: member.stockGroupId, baseUnit: "KG", packageUnit: "BOLSA",
            conversionFactorToBase: null, tracksPackages: false, approximateFactor: false,
            minimumClosedPackageReserve: decimal(0), autoOpenForUnitSale: false,
            products: peers.map((p) => ({ productId: p.productId, isCanonical: p.isCanonical, conversionFactor: decimal(p.conversionFactor) })),
          },
        };
      },
      findMany: async () => [],
    },
    product: {
      findUnique: async ({ where }: { where: { id?: string; sku?: string } }) => {
        if (where.id) return productRow(where.id);
        if (where.sku) { const p = products.find((x) => x.sku === where.sku); return p ? productRow(p.id) : null; }
        return null;
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = productRow(where.id);
        if (!row) throw new Error(`NOT_FOUND: producto ${where.id} no existe`);
        return row;
      },
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => products.some((p) => p.id === id)).map((id) => {
          const p = products.find((x) => x.id === id)!;
          return { id, sku: p.sku ?? id.toUpperCase(), name: p.name ?? `Producto ${id}`, isActive: p.isActive ?? true, mergedIntoProductId: null, mergedInto: null, standardSalePrice: decimal(p.standardSalePrice ?? 100), globalCost: null, averageCost: p.averageCost !== undefined ? decimal(p.averageCost) : null, lastPurchaseCost: null };
        }),
    },
    branch: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, code: id })) },
    branchProductSetting: { findUnique: async () => null, findMany: async () => [], upsert: async ({ create }: { create: Record<string, unknown> }) => create },
    inventoryBalance: {
      upsert: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) => getBalance(where.branchId_productId.branchId, where.branchId_productId.productId),
      findUnique: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) => getBalance(where.branchId_productId.branchId, where.branchId_productId.productId),
      findMany: async ({ where }: { where: { productId: { in: string[] }; branchId: { in: string[] } | string } }) => {
        const productIds = where.productId.in;
        const branchIds = typeof where.branchId === "string" ? [where.branchId] : where.branchId.in;
        return [...balances.values()].filter((b) => productIds.includes(b.productId) && branchIds.includes(b.branchId)).map((b) => ({ branchId: b.branchId, productId: b.productId, quantityOnHand: b.quantityOnHand, weightedAverageCost: b.weightedAverageCost }));
      },
      update: async ({ where, data }: { where: { branchId_productId: { branchId: string; productId: string } }; data: Record<string, unknown> }) => {
        const bal = getBalance(where.branchId_productId.branchId, where.branchId_productId.productId);
        Object.assign(bal, data);
        return bal;
      },
    },
    inventoryMovement: { create: async ({ data }: { data: Record<string, unknown> }) => { movementSeq++; const row = { id: `mv-${movementSeq}`, ...data }; movements.push(row); return row; } },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => data },
    systemSetting: { findUnique: async () => null },
    $queryRaw: async () => [],
    $transaction: async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const fn = arg as (tx: typeof db) => Promise<unknown>;
      return fn(db);
    },
    multiBranchIntake: {
      findUnique: async ({ where, include }: { where: { id?: string; clientRequestId?: string }; include?: { branches?: unknown } }) => {
        const intake = intakes.find((i) => (where.id && i.id === where.id) || (where.clientRequestId && i.clientRequestId === where.clientRequestId));
        if (!intake) return null;
        if (include?.branches) return { ...intake, branches: intakeBranches.filter((b) => b.intakeId === intake.id).map((b) => ({ ...b, branch: { id: b.branchId, code: b.branchId, name: b.branchId } })) };
        return intake;
      },
      findFirst: async () => (intakes.length === 0 ? null : intakes.reduce((max, i) => ((i.sequence as number) > (max.sequence as number) ? i : max))),
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `intake-${intakes.length + 1}`, createdAt: new Date(), ...data }; intakes.push(row); return row; },
    },
    multiBranchIntakeBranch: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { for (const d of data) intakeBranches.push({ id: `ib-${intakeBranches.length + 1}`, processedLines: 0, totalLines: 0, error: null, linesOverrideJson: null, revision: 0, ...d }); return { count: data.length }; },
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
        return withIntake.map(({ row, intake }) => ({ ...row, intake: { id: intake.id, code: intake.code, linesJson: intake.linesJson }, branch: { name: row.branchId } }));
      },
    },
    // ── Conteo (StockCount) ──────────────────────────────────────────────
    stockCount: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `sc-${stockCounts.length + 1}`, status: "OPEN", createdAt: new Date(), updatedAt: new Date(), submittedById: null, submittedAt: null, reviewedById: null, reviewedAt: null, reviewNote: null, appliedIntakeId: null, ...data };
        stockCounts.push(row);
        return row;
      },
      findUnique: async ({ where, include }: { where: { id: string }; include?: { lines?: unknown; unknownCodes?: unknown; branch?: unknown } }) => {
        const row = stockCounts.find((c) => c.id === where.id);
        if (!row) return null;
        return withIncludes(row, include);
      },
      findUniqueOrThrow: async ({ where, include }: { where: { id: string }; include?: { lines?: unknown; unknownCodes?: unknown; branch?: unknown } }) => {
        const row = stockCounts.find((c) => c.id === where.id);
        if (!row) throw new Error("NOT_FOUND: StockCount");
        return withIncludes(row, include);
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => stockCounts.filter((c) => matchesWhere(c, where)),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = stockCounts.find((c) => c.id === where.id);
        if (!row) throw new Error("NOT_FOUND: StockCount");
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const { id, ...rest } = where;
        const matches = stockCounts.filter((c) => c.id === id && matchesWhere(c, rest));
        matches.forEach((c) => Object.assign(c, data));
        return { count: matches.length };
      },
    },
    stockCountLine: {
      findUnique: async ({ where, include }: { where: { stockCountId_productId: { stockCountId: string; productId: string } }; include?: { product?: unknown } }) => {
        const row = stockCountLines.find((l) => l.stockCountId === where.stockCountId_productId.stockCountId && l.productId === where.stockCountId_productId.productId);
        if (!row) return null;
        return include?.product ? { ...row, product: productRow(row.productId as string) } : row;
      },
      findUniqueOrThrow: async ({ where, include }: { where: { stockCountId_productId: { stockCountId: string; productId: string } }; include?: { product?: unknown } }) => {
        const row = stockCountLines.find((l) => l.stockCountId === where.stockCountId_productId.stockCountId && l.productId === where.stockCountId_productId.productId);
        if (!row) throw new Error("NOT_FOUND: StockCountLine");
        return include?.product ? { ...row, product: productRow(row.productId as string) } : row;
      },
      upsert: async ({ where, create, update, include }: { where: { stockCountId_productId: { stockCountId: string; productId: string } }; create: Record<string, unknown>; update: Record<string, unknown>; include?: { product?: unknown } }) => {
        let row = stockCountLines.find((l) => l.stockCountId === where.stockCountId_productId.stockCountId && l.productId === where.stockCountId_productId.productId);
        if (!row) {
          row = { id: `scl-${stockCountLines.length + 1}`, ...create };
          stockCountLines.push(row);
        } else {
          const patch = { ...update };
          if (patch.countedBase && typeof patch.countedBase === "object" && "increment" in (patch.countedBase as Record<string, unknown>)) {
            patch.countedBase = Number(row.countedBase) + Number((patch.countedBase as { increment: number }).increment);
          }
          Object.assign(row, patch);
        }
        if (include?.product) return { ...row, product: productRow(row.productId as string) };
        return row;
      },
      update: async ({ where, data }: { where: { stockCountId_productId: { stockCountId: string; productId: string } }; data: Record<string, unknown> }) => {
        const row = stockCountLines.find((l) => l.stockCountId === where.stockCountId_productId.stockCountId && l.productId === where.stockCountId_productId.productId);
        if (!row) throw new Error("NOT_FOUND: StockCountLine");
        Object.assign(row, data);
        return row;
      },
    },
    stockCountEvent: {
      findUnique: async ({ where }: { where: { clientEventId: string } }) => stockCountEvents.find((e) => e.clientEventId === where.clientEventId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `sce-${stockCountEvents.length + 1}`, createdAt: new Date(), ...data }; stockCountEvents.push(row); return row; },
    },
    stockCountUnknownCode: {
      upsert: async ({ where, create, update }: { where: { stockCountId_code: { stockCountId: string; code: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        let row = stockCountUnknownCodes.find((u) => u.stockCountId === where.stockCountId_code.stockCountId && u.code === where.stockCountId_code.code);
        if (!row) { row = { id: `scu-${stockCountUnknownCodes.length + 1}`, ...create }; stockCountUnknownCodes.push(row); }
        else {
          const patch = { ...update };
          if (patch.quantity && typeof patch.quantity === "object" && "increment" in (patch.quantity as Record<string, unknown>)) patch.quantity = Number(row.quantity) + Number((patch.quantity as { increment: number }).increment);
          Object.assign(row, patch);
        }
        return row;
      },
    },
  };
  return { db, getBalance, stockCounts, stockCountLines, stockCountEvents, stockCountUnknownCodes, intakes, intakeBranches };
}

// ── Creación y permisos básicos ───────────────────────────────────────────

test("LA QUE IMPORTA — canAccessStockCount: privilegiado siempre puede; no asignado sin privilegio no puede", () => {
  const sc = { assignedUserIds: [COUNTER_USER] };
  assert.equal(canAccessStockCount(sc, COUNTER_USER, false), true);
  assert.equal(canAccessStockCount(sc, "otro-user", false), false, "no está en assignedUserIds y no es privilegiado");
  assert.equal(canAccessStockCount(sc, "otro-user", true), true, "Master siempre puede, aunque no esté asignado");
});

test("createStockCount: título vacío o sin contadores asignados se rechaza", async () => {
  const { db } = buildFakeDb();
  await assert.rejects(() => createStockCount({ branchId: BRANCH_1, title: "  ", assignedUserIds: [COUNTER_USER], actorUserId: MASTER_USER }, db), /VALIDATION_ERROR/);
  await assert.rejects(() => createStockCount({ branchId: BRANCH_1, title: "Conteo", assignedUserIds: [], actorUserId: MASTER_USER }, db), /VALIDATION_ERROR/);
});

test("LA QUE IMPORTA — a ciegas por defecto, oculta el sistema al contador pero no a Master", async () => {
  const { db } = buildFakeDb({ products: [{ id: "p1" }], balances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 50, weightedAverageCost: 10 }], barcodes: [{ code: "CODE1", productId: "p1" }] });
  const sc = await createStockCount({ branchId: BRANCH_1, title: "Conteo", assignedUserIds: [COUNTER_USER], actorUserId: MASTER_USER }, db);
  await scanStockCount({ stockCountId: sc.id, code: "CODE1", multiplier: 1, clientEventId: "ev1", actorUserId: COUNTER_USER, isPrivileged: false }, db);

  const forCounter = await getStockCountForViewer(sc.id, { isPrivileged: false }, db);
  assert.equal(forCounter.lines[0].systemBaseAtLastScan, null, "ciego: el contador no ve el sistema");

  const forMaster = await getStockCountForViewer(sc.id, { isPrivileged: true }, db);
  assert.equal(forMaster.lines[0].systemBaseAtLastScan, 50, "Master siempre ve el sistema");
});

test("ciego=false: el contador también ve el sistema", async () => {
  const { db } = buildFakeDb({ products: [{ id: "p1" }], balances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 50, weightedAverageCost: 10 }], barcodes: [{ code: "CODE1", productId: "p1" }] });
  const sc = await createStockCount({ branchId: BRANCH_1, title: "Conteo", blind: false, assignedUserIds: [COUNTER_USER], actorUserId: MASTER_USER }, db);
  await scanStockCount({ stockCountId: sc.id, code: "CODE1", multiplier: 1, clientEventId: "ev1", actorUserId: COUNTER_USER, isPrivileged: false }, db);
  const forCounter = await getStockCountForViewer(sc.id, { isPrivileged: false }, db);
  assert.equal(forCounter.lines[0].systemBaseAtLastScan, 50);
});

// ── Escaneo ────────────────────────────────────────────────────────────────

test("LA QUE IMPORTA — multiplicador ×12 suma 12 de una vez", async () => {
  const { db, stockCountLines } = buildFakeDb({ products: [{ id: "p1" }], barcodes: [{ code: "CODE1", productId: "p1" }] });
  const sc = await createStockCount({ branchId: BRANCH_1, title: "Conteo", assignedUserIds: [COUNTER_USER], actorUserId: MASTER_USER }, db);
  const result = await scanStockCount({ stockCountId: sc.id, code: "CODE1", multiplier: 12, clientEventId: "ev1", actorUserId: COUNTER_USER, isPrivileged: false }, db);
  assert.equal(result.kind, "COUNTED");
  assert.equal(stockCountLines[0].countedBase, 12);
});

test("LA QUE IMPORTA — escaneo con presentación (bolsa → kg base): 1 bolsa de 42.5 kg", async () => {
  const { db, stockCountLines } = buildFakeDb({
    products: [{ id: "cemento-kg" }, { id: "bolsa-cemento" }],
    barcodes: [{ code: "BOLSA-42KG", productId: "bolsa-cemento" }],
    fusionMembers: [
      { stockGroupId: "grp-cemento", productId: "cemento-kg", isCanonical: true, conversionFactor: 1, saleUnit: "KG", isPackagePresentation: false },
      { stockGroupId: "grp-cemento", productId: "bolsa-cemento", isCanonical: false, conversionFactor: 42.5, saleUnit: "BOLSA", isPackagePresentation: true },
    ],
  });
  const sc = await createStockCount({ branchId: BRANCH_1, title: "Conteo", assignedUserIds: [COUNTER_USER], actorUserId: MASTER_USER }, db);
  const result = await scanStockCount({ stockCountId: sc.id, code: "BOLSA-42KG", multiplier: 1, clientEventId: "ev1", actorUserId: COUNTER_USER, isPrivileged: false }, db);
  assert.equal(result.kind, "COUNTED");
  assert.equal(result.productId, "cemento-kg", "se guarda contra el CANÓNICO, no la presentación");
  assert.equal(stockCountLines[0].countedBase, 42.5, "1 bolsa = 42.5 kg base");
});

test("LA QUE IMPORTA — clientEventId repetido no duplica (reintento de red)", async () => {
  const { db, stockCountLines, stockCountEvents } = buildFakeDb({ products: [{ id: "p1" }], barcodes: [{ code: "CODE1", productId: "p1" }] });
  const sc = await createStockCount({ branchId: BRANCH_1, title: "Conteo", assignedUserIds: [COUNTER_USER], actorUserId: MASTER_USER }, db);
  await scanStockCount({ stockCountId: sc.id, code: "CODE1", multiplier: 5, clientEventId: "same-event", actorUserId: COUNTER_USER, isPrivileged: false }, db);
  await scanStockCount({ stockCountId: sc.id, code: "CODE1", multiplier: 5, clientEventId: "same-event", actorUserId: COUNTER_USER, isPrivileged: false }, db);
  assert.equal(stockCountLines[0].countedBase, 5, "el segundo envío (mismo clientEventId) no sumó de nuevo");
  assert.equal(stockCountEvents.length, 1);
});

test("LA QUE IMPORTA — código desconocido va a unknownCodes, no revienta ni crea una línea", async () => {
  const { db, stockCountLines, stockCountUnknownCodes } = buildFakeDb({ products: [{ id: "p1" }], barcodes: [] });
  const sc = await createStockCount({ branchId: BRANCH_1, title: "Conteo", assignedUserIds: [COUNTER_USER], actorUserId: MASTER_USER }, db);
  const result = await scanStockCount({ stockCountId: sc.id, code: "CODIGO-FANTASMA", multiplier: 3, clientEventId: "ev1", actorUserId: COUNTER_USER, isPrivileged: false }, db);
  assert.equal(result.kind, "UNKNOWN");
  assert.equal(stockCountLines.length, 0);
  assert.equal(stockCountUnknownCodes[0].quantity, 3);
});

test("un conteo que no está OPEN rechaza nuevos escaneos", async () => {
  const { db } = buildFakeDb({ products: [{ id: "p1" }], barcodes: [{ code: "CODE1", productId: "p1" }] });
  const sc = await createStockCount({ branchId: BRANCH_1, title: "Conteo", assignedUserIds: [COUNTER_USER], actorUserId: MASTER_USER }, db);
  await submitStockCount(sc.id, COUNTER_USER, false, db);
  await assert.rejects(() => scanStockCount({ stockCountId: sc.id, code: "CODE1", multiplier: 1, clientEventId: "ev1", actorUserId: COUNTER_USER, isPrivileged: false }, db), /CONFLICT/);
});

// ── Corrección ─────────────────────────────────────────────────────────────

test("LA QUE IMPORTA — −1 no baja de 0", async () => {
  const { db, stockCountLines } = buildFakeDb({ products: [{ id: "p1" }], barcodes: [{ code: "CODE1", productId: "p1" }] });
  const sc = await createStockCount({ branchId: BRANCH_1, title: "Conteo", assignedUserIds: [COUNTER_USER], actorUserId: MASTER_USER }, db);
  await scanStockCount({ stockCountId: sc.id, code: "CODE1", multiplier: 1, clientEventId: "ev1", actorUserId: COUNTER_USER, isPrivileged: false }, db);
  await correctStockCountLine({ stockCountId: sc.id, productId: "p1", delta: -1, clientEventId: "ev2", actorUserId: COUNTER_USER, isPrivileged: false }, db);
  assert.equal(stockCountLines[0].countedBase, 0);
  await correctStockCountLine({ stockCountId: sc.id, productId: "p1", delta: -1, clientEventId: "ev3", actorUserId: COUNTER_USER, isPrivileged: false }, db);
  assert.equal(stockCountLines[0].countedBase, 0, "ya estaba en 0, no baja a negativo");
});

// ── Enviar / aprobar / rechazar / reabrir ──────────────────────────────────

test("LA QUE IMPORTA — doble submit → ALREADY_PROCESSED (409)", async () => {
  const { db } = buildFakeDb({ products: [{ id: "p1" }], barcodes: [{ code: "CODE1", productId: "p1" }] });
  const sc = await createStockCount({ branchId: BRANCH_1, title: "Conteo", assignedUserIds: [COUNTER_USER], actorUserId: MASTER_USER }, db);
  await submitStockCount(sc.id, COUNTER_USER, false, db);
  await assert.rejects(() => submitStockCount(sc.id, COUNTER_USER, false, db), /ALREADY_PROCESSED/);
});

test("LA QUE IMPORTA — approve crea una sola Entrada, solo con las líneas con diferencia", async () => {
  const { db, intakes } = buildFakeDb({
    products: [{ id: "p1", averageCost: 50 }, { id: "p2", averageCost: 50 }],
    barcodes: [{ code: "CODE1", productId: "p1" }, { code: "CODE2", productId: "p2" }],
    balances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 40, weightedAverageCost: 50 }, { branchId: BRANCH_1, productId: "p2", quantityOnHand: 10, weightedAverageCost: 50 }],
  });
  const sc = await createStockCount({ branchId: BRANCH_1, title: "Conteo", assignedUserIds: [COUNTER_USER], actorUserId: MASTER_USER }, db);
  // p1: sistema dice 40, el contador cuenta 37 (diferencia real) -- escanea de a uno, 37 veces simuladas con multiplicador.
  await scanStockCount({ stockCountId: sc.id, code: "CODE1", multiplier: 37, clientEventId: "ev1", actorUserId: COUNTER_USER, isPrivileged: false }, db);
  // p2: sistema dice 10, el contador cuenta exactamente 10 -- sin diferencia.
  await scanStockCount({ stockCountId: sc.id, code: "CODE2", multiplier: 10, clientEventId: "ev2", actorUserId: COUNTER_USER, isPrivileged: false }, db);

  await submitStockCount(sc.id, COUNTER_USER, false, db);
  const approved = await approveStockCount(sc.id, MASTER_USER, db);

  assert.equal(approved.status, "APPROVED");
  assert.equal(intakes.length, 1, "una sola Entrada generada");
  const linesJson = intakes[0].linesJson as Array<{ productId: string; quantity: number }>;
  assert.equal(linesJson.length, 1, "solo la línea CON diferencia (p1), p2 no entra");
  assert.equal(linesJson[0].productId, "p1");
  assert.equal(linesJson[0].quantity, 37);
});

test("approve sin ninguna diferencia no genera ninguna Entrada", async () => {
  const { db, intakes } = buildFakeDb({
    products: [{ id: "p1" }],
    barcodes: [{ code: "CODE1", productId: "p1" }],
    balances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 5, weightedAverageCost: 50 }],
  });
  const sc = await createStockCount({ branchId: BRANCH_1, title: "Conteo", assignedUserIds: [COUNTER_USER], actorUserId: MASTER_USER }, db);
  await scanStockCount({ stockCountId: sc.id, code: "CODE1", multiplier: 5, clientEventId: "ev1", actorUserId: COUNTER_USER, isPrivileged: false }, db);
  await submitStockCount(sc.id, COUNTER_USER, false, db);
  const approved = await approveStockCount(sc.id, MASTER_USER, db);
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.appliedIntakeId, null);
  assert.equal(intakes.length, 0);
});

test("solo se puede aprobar un conteo SUBMITTED", async () => {
  const { db } = buildFakeDb({ products: [{ id: "p1" }] });
  const sc = await createStockCount({ branchId: BRANCH_1, title: "Conteo", assignedUserIds: [COUNTER_USER], actorUserId: MASTER_USER }, db);
  await assert.rejects(() => approveStockCount(sc.id, MASTER_USER, db), /CONFLICT/, "sigue OPEN, nunca se envió");
});

test("reject exige motivo y deja el conteo en REJECTED", async () => {
  const { db } = buildFakeDb({ products: [{ id: "p1" }] });
  const sc = await createStockCount({ branchId: BRANCH_1, title: "Conteo", assignedUserIds: [COUNTER_USER], actorUserId: MASTER_USER }, db);
  await submitStockCount(sc.id, COUNTER_USER, false, db);
  await assert.rejects(() => rejectStockCount(sc.id, "", MASTER_USER, db), /VALIDATION_ERROR/);
  const rejected = await rejectStockCount(sc.id, "Conteo incompleto", MASTER_USER, db);
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.reviewNote, "Conteo incompleto");
});

test("reopen vuelve un SUBMITTED a OPEN para que el contador corrija", async () => {
  const { db } = buildFakeDb({ products: [{ id: "p1" }], barcodes: [{ code: "CODE1", productId: "p1" }] });
  const sc = await createStockCount({ branchId: BRANCH_1, title: "Conteo", assignedUserIds: [COUNTER_USER], actorUserId: MASTER_USER }, db);
  await submitStockCount(sc.id, COUNTER_USER, false, db);
  const reopened = await reopenStockCount(sc.id, MASTER_USER, db);
  assert.equal(reopened.status, "OPEN");
  // Y ahora sí puede volver a escanear.
  const result = await scanStockCount({ stockCountId: sc.id, code: "CODE1", multiplier: 1, clientEventId: "ev1", actorUserId: COUNTER_USER, isPrivileged: false }, db);
  assert.equal(result.kind, "COUNTED");
});
