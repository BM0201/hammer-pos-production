import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  allowedCorrectionsFor,
  suspectCostEqualsPrice,
  describeCostSource,
  correctProductCostTx,
  correctAndApplyTrayItemTx,
  type CostCorrectionAction,
} from "@/modules/pricing/cost-correction-service";

/**
 * Parte D (prompt-completo-pendientes-2026-10.md) — "corregir el costo en su
 * origen, no subir el precio para taparlo". El fake db/tx replica EXACTAMENTE
 * lo que getEffectiveProductPricing/getProductStockConversion piden para un
 * producto simple (sin fusión) y, cuando el test lo necesita, para un
 * miembro de fusión — mismo patrón que tray-apply.test.ts.
 */

function d(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

type FakeProduct = {
  id: string;
  sku?: string;
  standardSalePrice: Prisma.Decimal | null;
  globalCost: Prisma.Decimal | null;
  averageCost: Prisma.Decimal | null;
  lastPurchaseCost: Prisma.Decimal | null;
  costUpdatedAt?: Date | null;
  costUpdatedByUserId?: string | null;
};
type FakeSetting = { branchId: string; productId: string; branchPrice: Prisma.Decimal | null; branchCost: Prisma.Decimal | null; branchName?: string };
type FakeMember = { productId: string; stockGroupId: string; isCanonical: boolean; conversionFactor: Prisma.Decimal; isPackagePresentation?: boolean };
type FakeBalance = { id: string; branchId: string; productId: string; quantityOnHand: Prisma.Decimal; weightedAverageCost: Prisma.Decimal | null; inventoryValue?: Prisma.Decimal };

function createFakeDb(opts: {
  products?: FakeProduct[];
  settings?: FakeSetting[];
  members?: FakeMember[];
  balances?: FakeBalance[];
  wacEnabled?: boolean;
  purchaseLine?: { finalUnitCost: Prisma.Decimal | null; unitCost: Prisma.Decimal; supplierNameSnapshot: string | null; purchaseOrder: { createdAt: Date } } | null;
  saleLines?: Array<{ costSnapshot: Prisma.Decimal; saleOrder: { createdAt: Date } }>;
  branchCostAuditLog?: { action: string; occurredAt: Date; actor: { fullName: string | null; username: string } | null } | null;
}) {
  const products = new Map((opts.products ?? []).map((p) => [p.id, p]));
  const settings = new Map((opts.settings ?? []).map((s) => [`${s.branchId}:${s.productId}`, s]));
  const members = opts.members ?? [];
  const balances = new Map((opts.balances ?? []).map((b) => [`${b.branchId}:${b.productId}`, b]));
  const balancesById = new Map((opts.balances ?? []).map((b) => [b.id, b]));
  const auditLogs: Array<Record<string, unknown>> = [];
  let seq = 0;

  const db = {
    $queryRaw: async () => [],
    systemSetting: {
      findUnique: async () => (opts.wacEnabled ? { value: "true" } : null),
    },
    product: {
      findUnique: async ({ where }: { where: { id: string } }) => products.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const found = products.get(where.id);
        if (!found) throw new Error(`product ${where.id} no encontrado`);
        return found;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = products.get(where.id);
        if (!existing) throw new Error(`product ${where.id} no encontrado`);
        const updated = { ...existing, ...data };
        products.set(where.id, updated as FakeProduct);
        return updated;
      },
    },
    branchProductSetting: {
      findUnique: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) => {
        const s = settings.get(`${where.branchId_productId.branchId}:${where.branchId_productId.productId}`);
        return s ? { branchPrice: s.branchPrice, branchCost: s.branchCost } : null;
      },
      findMany: async ({ where }: { where: { productId: string; branchId: { not: string }; branchCost: { not: null } } }) => {
        return [...settings.values()]
          .filter((s) => s.productId === where.productId && s.branchId !== where.branchId.not && s.branchCost !== null)
          .map((s) => ({ branchId: s.branchId, productId: s.productId, branchCost: s.branchCost, branch: { id: s.branchId, name: s.branchName ?? s.branchId } }));
      },
      upsert: async ({ where, create, update }: { where: { branchId_productId: { branchId: string; productId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = `${where.branchId_productId.branchId}:${where.branchId_productId.productId}`;
        const existing = settings.get(key);
        const data = existing ? { ...existing, ...update } : { branchId: where.branchId_productId.branchId, productId: where.branchId_productId.productId, ...create };
        settings.set(key, data as FakeSetting);
        return data;
      },
      update: async ({ where, data }: { where: { branchId_productId: { branchId: string; productId: string } }; data: Record<string, unknown> }) => {
        const key = `${where.branchId_productId.branchId}:${where.branchId_productId.productId}`;
        const existing = settings.get(key);
        if (!existing) throw new Error(`setting ${key} no encontrado`);
        const updated = { ...existing, ...data };
        settings.set(key, updated as FakeSetting);
        return updated;
      },
    },
    productStockGroupMember: {
      findFirst: async ({ where }: { where: { productId: string } }) => {
        const member = members.find((m) => m.productId === where.productId);
        if (!member) return null;
        const siblings = members.filter((m) => m.stockGroupId === member.stockGroupId);
        return {
          stockGroupId: member.stockGroupId,
          conversionFactor: member.conversionFactor,
          isCanonical: member.isCanonical,
          isPackagePresentation: member.isPackagePresentation ?? false,
          stockGroup: {
            code: "GRP", name: "Grupo", baseUnit: "unidad", packageUnit: null, conversionFactorToBase: null,
            tracksPackages: false, approximateFactor: false, minimumClosedPackageReserve: d(1), autoOpenForUnitSale: false,
            products: siblings.map((s) => ({ productId: s.productId, isCanonical: s.isCanonical, conversionFactor: s.conversionFactor })),
          },
        };
      },
      findMany: async ({ where }: { where: { stockGroupId: string; isCanonical: boolean } }) => {
        return members.filter((m) => m.stockGroupId === where.stockGroupId && m.isCanonical === where.isCanonical);
      },
    },
    inventoryBalance: {
      findUnique: async ({ where }: { where: { branchId_productId?: { branchId: string; productId: string }; id?: string } }) => {
        if (where.id) return balancesById.get(where.id) ?? null;
        if (where.branchId_productId) return balances.get(`${where.branchId_productId.branchId}:${where.branchId_productId.productId}`) ?? null;
        return null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = balancesById.get(where.id);
        if (!existing) throw new Error(`balance ${where.id} no encontrado`);
        const updated = { ...existing, ...data };
        balancesById.set(where.id, updated as FakeBalance);
        balances.set(`${updated.branchId}:${updated.productId}`, updated as FakeBalance);
        return updated;
      },
      aggregate: async ({ where }: { where: { productId: string } }) => {
        const matches = [...balances.values()].filter((b) => b.productId === where.productId && b.weightedAverageCost !== null);
        const max = matches.reduce<Prisma.Decimal | null>((best, b) => (best === null || b.weightedAverageCost!.gt(best) ? b.weightedAverageCost : best), null);
        return { _max: { weightedAverageCost: max } };
      },
    },
    purchaseOrderLine: {
      findFirst: async () => opts.purchaseLine ?? null,
    },
    saleOrderLine: {
      findMany: async () => opts.saleLines ?? [],
    },
    auditLog: {
      findFirst: async () => opts.branchCostAuditLog ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `audit-${seq}`, ...data };
        auditLogs.push(row);
        return row;
      },
    },
  };

  return { db: db as unknown as Prisma.TransactionClient, products, settings, balances, auditLogs };
}

const ACTOR = "user-1";
const BRANCH = "branch-1";
const PRODUCT = "product-1";

function baseProduct(overrides: Partial<FakeProduct> = {}): FakeProduct {
  return { id: PRODUCT, sku: "SKU-1", standardSalePrice: d(0), globalCost: null, averageCost: null, lastPurchaseCost: null, ...overrides };
}

// ── allowedCorrectionsFor (pura) ──────────────────────────────────────────

test("allowedCorrectionsFor: BRANCH ofrece SET_BRANCH_COST y CLEAR_BRANCH_COST", () => {
  assert.deepEqual(allowedCorrectionsFor("BRANCH"), ["SET_BRANCH_COST", "CLEAR_BRANCH_COST"]);
});
test("allowedCorrectionsFor: GLOBAL ofrece SET_BRANCH_COST y SET_GLOBAL_COST", () => {
  assert.deepEqual(allowedCorrectionsFor("GLOBAL"), ["SET_BRANCH_COST", "SET_GLOBAL_COST"]);
});
test("allowedCorrectionsFor: NONE ofrece SET_BRANCH_COST y SET_GLOBAL_COST (igual que GLOBAL: no hay nada que limpiar)", () => {
  assert.deepEqual(allowedCorrectionsFor("NONE"), ["SET_BRANCH_COST", "SET_GLOBAL_COST"]);
});
test("allowedCorrectionsFor: GLOBAL_AVERAGE y WAC_ESTIMATE ofrecen SET_AVERAGE_COST, no SET_GLOBAL_COST", () => {
  assert.deepEqual(allowedCorrectionsFor("GLOBAL_AVERAGE"), ["SET_BRANCH_COST", "SET_AVERAGE_COST"]);
  assert.deepEqual(allowedCorrectionsFor("WAC_ESTIMATE"), ["SET_BRANCH_COST", "SET_AVERAGE_COST"]);
});
test("allowedCorrectionsFor: LAST_PURCHASE solo ofrece SET_BRANCH_COST (no hay acción directa sobre la última compra)", () => {
  assert.deepEqual(allowedCorrectionsFor("LAST_PURCHASE"), ["SET_BRANCH_COST"]);
});

// ── suspectCostEqualsPrice (pura) ─────────────────────────────────────────

test("suspectCostEqualsPrice: costo = precio exacto dispara la sospecha", () => {
  const result = suspectCostEqualsPrice(100, 100);
  assert.equal(result?.code, "COST_EQUALS_PRICE");
});
test("suspectCostEqualsPrice: costo y precio distintos no dispara nada", () => {
  assert.equal(suspectCostEqualsPrice(90, 100), null);
});
test("suspectCostEqualsPrice: sin costo o sin precio no se puede afirmar nada", () => {
  assert.equal(suspectCostEqualsPrice(null, 100), null);
  assert.equal(suspectCostEqualsPrice(100, null), null);
});

// ── describeCostSource — cada fuente de costo ─────────────────────────────

/**
 * isWacDrivesCostChainEnabled (catalog/cost-chain-config.ts) cachea el flag
 * a nivel de módulo por 60s — la PRIMERA lectura en este archivo decide el
 * valor para el resto de la corrida. Por eso este test (el único que
 * necesita wacEnabled=true) va PRIMERO entre los que tocan DB: los demás no
 * ponen weightedAverageCost en sus fixtures, así que la cache en `true` no
 * les cambia nada (usableWac sigue null sin un balance > 0 que leer).
 */
test("describeCostSource: WAC_ESTIMATE es responsable cuando el flag está activo y hay un WAC de sucursal", async () => {
  const { db, balances } = createFakeDb({
    products: [baseProduct()],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: null }],
    balances: [{ id: "bal-wac", branchId: BRANCH, productId: PRODUCT, quantityOnHand: d(20), weightedAverageCost: d(35) }],
    wacEnabled: true,
  });
  const result = await describeCostSource(PRODUCT, BRANCH, db);
  assert.equal(result.costSource, "WAC_ESTIMATE");
  assert.equal(result.effectiveCost, 35);
  assert.deepEqual(result.allowedCorrections, ["SET_BRANCH_COST", "SET_AVERAGE_COST"]);
  assert.ok(balances.get(`${BRANCH}:${PRODUCT}`), "sanity: el balance de fixture existe");
});

test("describeCostSource: BRANCH es responsable cuando branchCost está puesto", async () => {
  const { db } = createFakeDb({
    products: [baseProduct({ averageCost: d(50) })],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: d(80) }],
  });
  const result = await describeCostSource(PRODUCT, BRANCH, db);
  assert.equal(result.costSource, "BRANCH");
  assert.equal(result.effectiveCost, 80);
  assert.deepEqual(result.allowedCorrections, ["SET_BRANCH_COST", "CLEAR_BRANCH_COST"]);
});

test("describeCostSource: GLOBAL_AVERAGE es responsable cuando no hay branchCost pero sí averageCost", async () => {
  const { db } = createFakeDb({
    products: [baseProduct({ averageCost: d(55) })],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: null }],
  });
  const result = await describeCostSource(PRODUCT, BRANCH, db);
  assert.equal(result.costSource, "GLOBAL_AVERAGE");
  assert.equal(result.effectiveCost, 55);
  assert.equal(result.history.averageCost, 55);
});

test("describeCostSource: GLOBAL es responsable cuando no hay branchCost ni averageCost pero sí globalCost", async () => {
  const { db } = createFakeDb({
    products: [baseProduct({ globalCost: d(60) })],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: null }],
  });
  const result = await describeCostSource(PRODUCT, BRANCH, db);
  assert.equal(result.costSource, "GLOBAL");
  assert.equal(result.effectiveCost, 60);
});

test("describeCostSource: LAST_PURCHASE es responsable como último respaldo", async () => {
  const { db } = createFakeDb({
    products: [baseProduct({ lastPurchaseCost: d(45) })],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: null }],
  });
  const result = await describeCostSource(PRODUCT, BRANCH, db);
  assert.equal(result.costSource, "LAST_PURCHASE");
  assert.equal(result.effectiveCost, 45);
  assert.deepEqual(result.allowedCorrections, ["SET_BRANCH_COST"]);
});

test("describeCostSource: NONE cuando no hay ningún costo registrado", async () => {
  const { db } = createFakeDb({
    products: [baseProduct()],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: null }],
  });
  const result = await describeCostSource(PRODUCT, BRANCH, db);
  assert.equal(result.costSource, "NONE");
  assert.equal(result.effectiveCost, null);
});

test("describeCostSource: COST_EQUALS_PRICE aparece en suspicions cuando branchCost = precio efectivo", async () => {
  const { db } = createFakeDb({
    products: [baseProduct()],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(100), branchCost: d(100) }],
  });
  const result = await describeCostSource(PRODUCT, BRANCH, db);
  assert.ok(result.suspicions.some((s) => s.code === "COST_EQUALS_PRICE"), "debe traer la sospecha COST_EQUALS_PRICE");
});

test("describeCostSource: PACKAGE_AS_UNIT aparece cuando el costo del canónico parece ser el del paquete completo", async () => {
  const { db } = createFakeDb({
    products: [baseProduct({ id: PRODUCT })],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(500), branchCost: d(100) }], // 100 >= existingWac(10) * factor(10) * 0.6 = 60
    members: [
      { productId: PRODUCT, stockGroupId: "group-1", isCanonical: true, conversionFactor: d(1) },
      { productId: "product-package", stockGroupId: "group-1", isCanonical: false, conversionFactor: d(10) },
    ],
    balances: [{ id: "bal-1", branchId: BRANCH, productId: PRODUCT, quantityOnHand: d(5), weightedAverageCost: d(10) }],
  });
  const result = await describeCostSource(PRODUCT, BRANCH, db);
  assert.ok(result.suspicions.some((s) => s.code === "PACKAGE_AS_UNIT"), "debe traer la sospecha PACKAGE_AS_UNIT");
});

test("describeCostSource: historial trae el origen del branchCost (saldo inicial/importación) cuando hay auditLog", async () => {
  const { db } = createFakeDb({
    products: [baseProduct()],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: d(80) }],
    branchCostAuditLog: { action: "OPENING_BALANCE_CREATE", occurredAt: new Date("2026-08-12T00:00:00Z"), actor: { fullName: "Ana Pérez", username: "ana" } },
  });
  const result = await describeCostSource(PRODUCT, BRANCH, db);
  assert.ok(result.responsibleFieldLabel.includes("saldo inicial"), `debe mencionar el origen: ${result.responsibleFieldLabel}`);
  assert.equal(result.history.branchCostOrigin?.actorName, "Ana Pérez");
});

// ── correctProductCostTx ──────────────────────────────────────────────────

test("zero/negativo → VALIDATION_ERROR sin escribir nada", async () => {
  const { db, settings } = createFakeDb({
    products: [baseProduct()],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: d(80) }],
  });
  await assert.rejects(
    () => correctProductCostTx(db as any, { productId: PRODUCT, branchId: BRANCH, action: "SET_BRANCH_COST", newCost: 0, reason: "motivo de prueba", actorUserId: ACTOR }),
    /VALIDATION_ERROR/,
  );
  await assert.rejects(
    () => correctProductCostTx(db as any, { productId: PRODUCT, branchId: BRANCH, action: "SET_BRANCH_COST", newCost: -5, reason: "motivo de prueba", actorUserId: ACTOR }),
    /VALIDATION_ERROR/,
  );
  assert.equal(settings.get(`${BRANCH}:${PRODUCT}`)?.branchCost?.toNumber(), 80, "el costo no debe cambiar");
});

test("motivo con menos de 10 caracteres → VALIDATION_ERROR", async () => {
  const { db } = createFakeDb({ products: [baseProduct()], settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: d(80) }] });
  await assert.rejects(
    () => correctProductCostTx(db as any, { productId: PRODUCT, branchId: BRANCH, action: "SET_BRANCH_COST", newCost: 90, reason: "corto", actorUserId: ACTOR }),
    /VALIDATION_ERROR/,
  );
});

test("LA QUE IMPORTA — CLEAR_BRANCH_COST: el costo cae al promedio/global de respaldo", async () => {
  const { db, settings } = createFakeDb({
    products: [baseProduct({ averageCost: d(55) })],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: d(999) }], // 999 es el error de tecleo a corregir
  });
  const result = await correctProductCostTx(db as any, { productId: PRODUCT, branchId: BRANCH, action: "CLEAR_BRANCH_COST", reason: "costo de sucursal mal tecleado", actorUserId: ACTOR });
  assert.equal(settings.get(`${BRANCH}:${PRODUCT}`)?.branchCost, null, "branchCost debe quedar null");
  assert.equal(result.costSource, "GLOBAL_AVERAGE");
  assert.equal(result.effectiveCost, 55, "cae al costo promedio del producto");
});

test("LA QUE IMPORTA — SET_BRANCH_COST en un miembro de fusión: escribe en el CANÓNICO, no en el miembro", async () => {
  const canonicalId = "product-canonical";
  const memberId = "product-member";
  const { db, settings } = createFakeDb({
    products: [baseProduct({ id: canonicalId }), baseProduct({ id: memberId })],
    settings: [{ branchId: BRANCH, productId: memberId, branchPrice: d(150), branchCost: null }],
    members: [
      { productId: canonicalId, stockGroupId: "group-fusion", isCanonical: true, conversionFactor: d(1) },
      { productId: memberId, stockGroupId: "group-fusion", isCanonical: false, conversionFactor: d(4) }, // 1 unidad del miembro = 4 del canónico
    ],
  });
  await correctProductCostTx(db as any, { productId: memberId, branchId: BRANCH, action: "SET_BRANCH_COST", newCost: 40, reason: "corrigiendo el costo de sucursal", actorUserId: ACTOR });
  // resolveGlobalCostWriteTarget redirige: costForTarget = enteredCost / factor = 40 / 4 = 10, en el CANÓNICO.
  assert.equal(settings.get(`${BRANCH}:${canonicalId}`)?.branchCost?.toNumber(), 10, "debe escribir en el canónico, redirigido por el factor");
  assert.equal(settings.get(`${BRANCH}:${memberId}`)?.branchCost, null, "el miembro NO debe recibir su propio branchCost");
});

test("SET_AVERAGE_COST (GLOBAL_AVERAGE): corrige SOLO Product.averageCost, sin tocar globalCost", async () => {
  const { db, products } = createFakeDb({
    products: [baseProduct({ averageCost: d(999), globalCost: d(70) })], // 999 es el error a corregir
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: null }],
  });
  const result = await correctProductCostTx(db as any, { productId: PRODUCT, branchId: BRANCH, action: "SET_AVERAGE_COST", newCost: 58, reason: "corrigiendo el costo promedio", actorUserId: ACTOR });
  assert.equal(products.get(PRODUCT)?.averageCost?.toNumber(), 58);
  assert.equal(products.get(PRODUCT)?.globalCost?.toNumber(), 70, "globalCost no se toca — corrección más angosta que SET_GLOBAL_COST");
  assert.equal(result.effectiveCost, 58);
});

test("SET_AVERAGE_COST (WAC_ESTIMATE): corrige InventoryBalance.weightedAverageCost y recalcula inventoryValue", async () => {
  const { db, balances } = createFakeDb({
    products: [baseProduct()],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: null }],
    balances: [{ id: "bal-1", branchId: BRANCH, productId: PRODUCT, quantityOnHand: d(20), weightedAverageCost: d(999) }],
    wacEnabled: true,
  });
  const result = await correctProductCostTx(db as any, { productId: PRODUCT, branchId: BRANCH, action: "SET_AVERAGE_COST", newCost: 30, reason: "corrigiendo el WAC de esta sucursal", actorUserId: ACTOR });
  const updated = balances.get(`${BRANCH}:${PRODUCT}`);
  assert.equal(updated?.weightedAverageCost?.toNumber(), 30);
  assert.equal(updated?.inventoryValue?.toNumber(), 600, "20 unidades × C$30 = C$600");
  assert.equal(result.effectiveCost, 30);
});

test("SET_BRANCH_COST no disponible cuando el responsable no coincide con lo pedido: igual se puede corregir SIEMPRE (tabla D.1.2 — siempre se ofrece)", async () => {
  const { db } = createFakeDb({
    products: [baseProduct({ globalCost: d(60) })],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: null }],
  });
  // SET_BRANCH_COST siempre está permitido, sin importar el responsable actual.
  const result = await correctProductCostTx(db as any, { productId: PRODUCT, branchId: BRANCH, action: "SET_BRANCH_COST", newCost: 65, reason: "fijando el costo de esta sucursal", actorUserId: ACTOR });
  assert.equal(result.costSource, "BRANCH");
  assert.equal(result.effectiveCost, 65);
});

test("CLEAR_BRANCH_COST rechazado cuando el responsable NO es BRANCH (no hay nada que limpiar)", async () => {
  const { db } = createFakeDb({
    products: [baseProduct({ globalCost: d(60) })],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: null }],
  });
  await assert.rejects(
    () => correctProductCostTx(db as any, { productId: PRODUCT, branchId: BRANCH, action: "CLEAR_BRANCH_COST", reason: "intentando limpiar sin tener branchCost" } as any),
    /VALIDATION_ERROR/,
  );
});

test("el historial de ventas (costSnapshot) no cambia con una corrección de costo vigente", async () => {
  const saleLines = [{ costSnapshot: d(42), saleOrder: { createdAt: new Date("2026-09-01T00:00:00Z") } }];
  const { db } = createFakeDb({
    products: [baseProduct({ averageCost: d(55) })],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: d(999) }],
    saleLines,
  });
  const before = await describeCostSource(PRODUCT, BRANCH, db);
  await correctProductCostTx(db as any, { productId: PRODUCT, branchId: BRANCH, action: "CLEAR_BRANCH_COST", reason: "corrigiendo costo de sucursal", actorUserId: ACTOR });
  const after = await describeCostSource(PRODUCT, BRANCH, db);
  assert.deepEqual(before.history.recentSaleCostSnapshots, after.history.recentSaleCostSnapshots, "el costSnapshot de ventas pasadas no se toca");
  assert.equal(after.history.recentSaleCostSnapshots[0].cost, 42);
});

// ── correctAndApplyTrayItemTx — la decisión completa, con brainDecision ──

type FakeDecision = {
  id: string;
  category: string;
  status: string;
  branchId?: string | null;
  productId?: string | null;
  proposedActionJson?: Record<string, unknown> | null;
};

function withDecisions(db: ReturnType<typeof createFakeDb>["db"], decisions: FakeDecision[]) {
  const map = new Map(decisions.map((dec) => [dec.id, dec]));
  const full = db as any;
  full.brainDecision = {
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const found = map.get(where.id);
      if (!found) throw new Error(`decision ${where.id} no encontrada`);
      return found;
    },
    updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
      const found = map.get(where.id);
      if (!found || found.status !== where.status) return { count: 0 };
      Object.assign(found, data);
      return { count: 1 };
    },
  };
  full.brainDecisionActionLog = { create: async () => ({}) };
  return map;
}

function pricingDecision(overrides: Partial<FakeDecision> = {}): FakeDecision {
  return { id: "decision-1", category: "PRICING", status: "OPEN", branchId: BRANCH, productId: PRODUCT, proposedActionJson: {}, ...overrides };
}

test("LA QUE IMPORTA — precio manual validado contra el costo NUEVO: rechazado si queda bajo el costo recién corregido", async () => {
  const { db } = createFakeDb({
    products: [baseProduct({ averageCost: d(50) })],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: d(20) }], // costo viejo, barato
  });
  withDecisions(db, [pricingDecision()]);
  await assert.rejects(
    () => correctAndApplyTrayItemTx(
      db as any,
      { decisionId: "decision-1", mode: "MANUAL", cost: { action: "SET_BRANCH_COST", value: 90 }, price: 85 }, // el costo sube a 90, pero el precio manual (85) queda bajo eso
      "corrigiendo costo y precio juntos",
      ACTOR,
    ),
    /BELOW_COST|COST/i,
  );
});

test("precio manual válido contra el costo recién corregido: se aplica y queda auditado el antes/después", async () => {
  const { db, settings } = createFakeDb({
    products: [baseProduct({ averageCost: d(50) })],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: d(20) }],
  });
  const decisions = withDecisions(db, [pricingDecision()]);
  const result = await correctAndApplyTrayItemTx(
    db as any,
    { decisionId: "decision-1", mode: "MANUAL", cost: { action: "SET_BRANCH_COST", value: 90 }, price: 130 },
    "corrigiendo costo y precio juntos",
    ACTOR,
  );
  assert.equal(result.costBefore, 20);
  assert.equal(result.costAfter, 90);
  assert.equal(result.priceAfter, 130);
  assert.equal(settings.get(`${BRANCH}:${PRODUCT}`)?.branchCost?.toNumber(), 90);
  assert.equal(decisions.get("decision-1")?.status, "RESOLVED");
});

test("keepPrice: corrige el costo, cierra la decisión, y el precio NO cambia", async () => {
  const { db, settings } = createFakeDb({
    products: [baseProduct({ averageCost: d(50) })],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: d(999) }],
  });
  const decisions = withDecisions(db, [pricingDecision()]);
  const result = await correctAndApplyTrayItemTx(
    db as any,
    { decisionId: "decision-1", mode: "MANUAL", cost: { action: "CLEAR_BRANCH_COST" }, keepPrice: true },
    "el precio ya estaba bien, solo el costo estaba mal",
    ACTOR,
  );
  assert.equal(result.priceBefore, 150);
  assert.equal(result.priceAfter, 150, "el precio no debe tocarse con keepPrice");
  assert.equal(settings.get(`${BRANCH}:${PRODUCT}`)?.branchPrice?.toNumber(), 150, "branchPrice sin escribir");
  assert.equal(decisions.get("decision-1")?.status, "RESOLVED", "la decisión se cierra igual, el precio ya era correcto");
});

test("LA QUE IMPORTA — doble envío de la misma decisión: el segundo es rechazado con ALREADY_PROCESSED, un solo resultado", async () => {
  const { db } = createFakeDb({
    products: [baseProduct({ averageCost: d(50) })],
    settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: d(20) }],
  });
  withDecisions(db, [pricingDecision()]);
  await correctAndApplyTrayItemTx(db as any, { decisionId: "decision-1", mode: "MANUAL", price: 130 }, "primer envío", ACTOR);
  await assert.rejects(
    () => correctAndApplyTrayItemTx(db as any, { decisionId: "decision-1", mode: "MANUAL", price: 140 }, "segundo envío, debe fallar", ACTOR),
    /ALREADY_PROCESSED/,
  );
});

test("decisión que no es de categoría PRICING: rechazada antes de tocar nada", async () => {
  const { db } = createFakeDb({ products: [baseProduct()], settings: [{ branchId: BRANCH, productId: PRODUCT, branchPrice: d(150), branchCost: d(20) }] });
  withDecisions(db, [pricingDecision({ category: "INVENTORY" })]);
  await assert.rejects(
    () => correctAndApplyTrayItemTx(db as any, { decisionId: "decision-1", mode: "MANUAL", price: 130 }, "motivo cualquiera", ACTOR),
    /DECISION_NOT_PRICING/,
  );
});
