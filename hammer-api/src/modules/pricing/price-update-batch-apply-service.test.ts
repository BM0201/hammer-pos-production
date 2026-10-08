import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { beginApplyTx, applyLineChunkTx, finalizeBatchTx } from "@/modules/pricing/price-update-batch-apply-service";

/**
 * prompt-carga-precios.md Fase 2 — fake tx completo (no solo el de
 * price-update-batch-service.test.ts): applyLineChunkTx re-valida con datos
 * FRESCOS, así que pasa por el mismo motor de costo/precio que el POS
 * (getEffectiveProductPricingBatch/getProductStockConversionsBatch/
 * isWacDrivesCostChainEnabled) — mismo patrón de fake db que
 * current-prices.test.ts, sin fusión/WAC (systemSetting siempre "false",
 * sin stockGroupMember) porque ninguno de estos tests depende de eso.
 *
 * batchHasPendingWarnings y el orquestador applyBatch usan el prisma
 * global (igual que previewBatch/listBatches en Fase 1) — fuera de
 * alcance para un tx en memoria, requieren Prisma real.
 */

const BRANCH = "branch-1";
const ACTOR = "user-1";

function d(n: number) {
  return new Prisma.Decimal(n);
}

type FakeProduct = { id: string; sku: string; isActive: boolean; standardSalePrice: Prisma.Decimal; averageCost: Prisma.Decimal | null; globalCost: Prisma.Decimal | null; lastPurchaseCost: Prisma.Decimal | null };
type FakeSetting = { branchId: string; productId: string; branchPrice: Prisma.Decimal | null; branchCost: Prisma.Decimal | null; priceSource: string | null; priceExceptionReason: string | null; priceExceptionAt: Date | null; lastPriceUpdateAt: Date | null; priceUpdatedByUserId: string | null };
type FakeLine = {
  id: string; batchId: string; productId: string; branchId: string | null;
  costSnapshot: Prisma.Decimal | null; currentPriceSnapshot: Prisma.Decimal | null; priceSourceSnapshot: string;
  newPrice: Prisma.Decimal | null; status: string; message: string | null; trayDecisionId: string | null;
  appliedPreviousPrice: Prisma.Decimal | null; appliedAt: Date | null;
};
type FakeBatch = { id: string; code: string; status: string; target: "BRANCHES" | "GENERAL"; branchIds: string[]; reason: string; source: "MANUAL" | "TRAY" | "FILE" | "REVERT"; appliedByUserId: string | null; appliedAt: Date | null };
type FakeDecision = { id: string; category: string; status: string; resolvedAt: Date | null; resolvedByUserId: string | null; executedEntityType: string | null; executedEntityId: string | null; actionResultJson: unknown };

function createStore(opts: { batch: FakeBatch; products: FakeProduct[]; settings?: FakeSetting[]; lines: FakeLine[]; decisions?: FakeDecision[] }) {
  const batch = opts.batch;
  const products = opts.products;
  const settings: FakeSetting[] = opts.settings ?? [];
  const lines = opts.lines;
  const decisions: FakeDecision[] = opts.decisions ?? [];
  const auditLogs: Array<{ action: string; metadataJson: unknown }> = [];

  const tx = {
    $queryRaw: async () => [],
    product: {
      findMany: async ({ where }: { where?: { id?: { in?: string[] } } }) =>
        products.filter((p) => !where?.id?.in || where.id.in.includes(p.id)),
      findUnique: async ({ where }: { where: { id: string } }) => products.find((p) => p.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const found = products.find((p) => p.id === where.id);
        if (!found) throw new Error("NOT_FOUND");
        return found;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeProduct> }) => {
        const found = products.find((p) => p.id === where.id);
        if (!found) throw new Error("NOT_FOUND");
        Object.assign(found, data);
        return found;
      },
    },
    branchProductSetting: {
      findMany: async ({ where }: { where?: { productId?: { in?: string[] }; branchId?: { in?: string[] } } }) =>
        settings.filter((s) => (!where?.productId?.in || where.productId.in.includes(s.productId)) && (!where?.branchId?.in || where.branchId.in.includes(s.branchId))),
      findUnique: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) =>
        settings.find((s) => s.branchId === where.branchId_productId.branchId && s.productId === where.branchId_productId.productId) ?? null,
      upsert: async ({ where, create, update }: { where: { branchId_productId: { branchId: string; productId: string } }; create: FakeSetting; update: Partial<FakeSetting> }) => {
        const existing = settings.find((s) => s.branchId === where.branchId_productId.branchId && s.productId === where.branchId_productId.productId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const created = { ...create };
        settings.push(created);
        return created;
      },
    },
    productStockGroupMember: { findMany: async () => [] },
    inventoryBalance: { findMany: async () => [] },
    systemSetting: { findUnique: async () => null },
    priceUpdateBatch: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === batch.id ? { ...batch } : null),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Partial<FakeBatch> }) => {
        if (where.id !== batch.id || where.status !== batch.status) return { count: 0 };
        Object.assign(batch, data);
        return { count: 1 };
      },
    },
    priceUpdateLine: {
      findMany: async ({ where }: { where: { id: { in: string[] }; status?: string } }) =>
        lines.filter((l) => where.id.in.includes(l.id) && (where.status === undefined || l.status === where.status)),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Partial<FakeLine> }) => {
        const line = lines.find((l) => l.id === where.id && l.status === where.status);
        if (!line) return { count: 0 };
        Object.assign(line, data);
        return { count: 1 };
      },
      count: async ({ where }: { where: { batchId: string; status: string } }) =>
        lines.filter((l) => l.batchId === where.batchId && l.status === where.status).length,
      groupBy: async ({ where }: { where: { batchId: string } }) => {
        const byStatus = new Map<string, number>();
        for (const line of lines.filter((l) => l.batchId === where.batchId)) {
          byStatus.set(line.status, (byStatus.get(line.status) ?? 0) + 1);
        }
        return [...byStatus.entries()].map(([status, count]) => ({ status, _count: { _all: count } }));
      },
    },
    brainDecision: {
      findUnique: async ({ where }: { where: { id: string } }) => decisions.find((d2) => d2.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeDecision> }) => {
        const found = decisions.find((d2) => d2.id === where.id);
        if (!found) throw new Error("NOT_FOUND");
        Object.assign(found, data);
        return found;
      },
    },
    // Fase 4.2 (prompt-brain-centro-decisiones.md) — closeLinkedTrayDecisionTx
    // ahora también deja una entrada de bitácora al cerrar como RESOLVED/EXECUTION.
    brainDecisionActionLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => data,
    },
    auditLog: {
      create: async ({ data }: { data: { action: string; metadataJson: unknown } }) => {
        auditLogs.push({ action: data.action, metadataJson: data.metadataJson });
        return data;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx: tx as Prisma.TransactionClient, batch, products, settings, lines, decisions, auditLogs };
}

test("LA QUE IMPORTA — doble aplicación: la segunda da ALREADY_PROCESSED, el precio se escribe una sola vez", async () => {
  const batch: FakeBatch = { id: "b1", code: "CP-000001", status: "DRAFT", target: "BRANCHES", branchIds: [BRANCH], reason: "Ajuste de precios", source: "MANUAL", appliedByUserId: null, appliedAt: null };
  const products: FakeProduct[] = [{ id: "p1", sku: "SKU-1", isActive: true, standardSalePrice: d(100), averageCost: d(50), globalCost: null, lastPurchaseCost: null }];
  const lines: FakeLine[] = [{ id: "l1", batchId: "b1", productId: "p1", branchId: BRANCH, costSnapshot: d(50), currentPriceSnapshot: d(100), priceSourceSnapshot: "STANDARD", newPrice: d(120), status: "PENDING", message: null, trayDecisionId: null, appliedPreviousPrice: null, appliedAt: null }];
  const { tx, settings } = createStore({ batch, products, lines });

  const started = await beginApplyTx(tx, "b1");
  assert.equal(started.status, "APPLYING");

  await applyLineChunkTx(tx, started, ["l1"], ACTOR);
  assert.equal(lines[0].status, "APPLIED");
  assert.equal(settings[0]?.branchPrice?.toNumber(), 120);

  await finalizeBatchTx(tx, "b1", ACTOR);
  assert.equal(batch.status, "APPLIED");

  await assert.rejects(() => beginApplyTx(tx, "b1"), /ALREADY_PROCESSED/);
  // Re-aplicar la misma línea con otro valor demostraría doble escritura — no corrido porque beginApplyTx ya cortó antes de llegar ahí.
  assert.equal(settings[0]?.branchPrice?.toNumber(), 120, "el precio no cambió por el segundo intento");
});

test("LA QUE IMPORTA — el precio vigente cambió desde el borrador: la línea queda CONFLICT, sin pisar nada", async () => {
  const batch: FakeBatch = { id: "b2", code: "CP-000002", status: "APPLYING", target: "BRANCHES", branchIds: [BRANCH], reason: "Ajuste de precios", source: "MANUAL", appliedByUserId: null, appliedAt: null };
  const products: FakeProduct[] = [{ id: "p2", sku: "SKU-2", isActive: true, standardSalePrice: d(200), averageCost: d(80), globalCost: null, lastPurchaseCost: null }];
  // Alguien declaró un precio de excepción (250) DESPUÉS de que esta línea se armó con la foto de 200.
  const settings: FakeSetting[] = [{ branchId: BRANCH, productId: "p2", branchPrice: d(250), branchCost: null, priceSource: "MANUAL", priceExceptionReason: "otro cambio", priceExceptionAt: new Date(), lastPriceUpdateAt: new Date(), priceUpdatedByUserId: "otro-user" }];
  const lines: FakeLine[] = [{ id: "l2", batchId: "b2", productId: "p2", branchId: BRANCH, costSnapshot: d(80), currentPriceSnapshot: d(200), priceSourceSnapshot: "STANDARD", newPrice: d(220), status: "PENDING", message: null, trayDecisionId: null, appliedPreviousPrice: null, appliedAt: null }];
  const { tx } = createStore({ batch, products, settings, lines });

  await applyLineChunkTx(tx, batch, ["l2"], ACTOR);

  assert.equal(lines[0].status, "CONFLICT");
  assert.match(lines[0].message ?? "", /cambió/);
  assert.equal(settings[0].branchPrice?.toNumber(), 250, "el precio vigente no se toca — la línea en conflicto se muestra, no se aplica");
});

test("LA QUE IMPORTA — el costo subió después de la vista previa: BLOCKED al aplicar, no en el borrador", async () => {
  const batch: FakeBatch = { id: "b3", code: "CP-000003", status: "APPLYING", target: "BRANCHES", branchIds: [BRANCH], reason: "Ajuste de precios", source: "MANUAL", appliedByUserId: null, appliedAt: null };
  const products: FakeProduct[] = [{ id: "p3", sku: "SKU-3", isActive: true, standardSalePrice: d(300), averageCost: d(90), globalCost: null, lastPurchaseCost: null }];
  const lines: FakeLine[] = [{ id: "l3", batchId: "b3", productId: "p3", branchId: BRANCH, costSnapshot: d(90), currentPriceSnapshot: d(300), priceSourceSnapshot: "STANDARD", newPrice: d(100), status: "PENDING", message: null, trayDecisionId: null, appliedPreviousPrice: null, appliedAt: null }];
  const { tx, products: liveProducts } = createStore({ batch, products, lines });

  // El costo subió DESPUÉS de armar la carga (90 → 150) — con newPrice=100 ahora queda bajo costo.
  liveProducts[0].averageCost = d(150);

  await applyLineChunkTx(tx, batch, ["l3"], ACTOR);

  assert.equal(lines[0].status, "BLOCKED");
  assert.match(lines[0].message ?? "", /menor que el costo efectivo/);
});

test("LA QUE IMPORTA — reanudación: una tanda solo toca las líneas PENDING, nunca una ya APPLIED", async () => {
  const batch: FakeBatch = { id: "b4", code: "CP-000004", status: "APPLYING", target: "BRANCHES", branchIds: [BRANCH], reason: "Ajuste de precios", source: "MANUAL", appliedByUserId: null, appliedAt: null };
  const products: FakeProduct[] = [
    { id: "p4", sku: "SKU-4", isActive: true, standardSalePrice: d(400), averageCost: d(40), globalCost: null, lastPurchaseCost: null },
    { id: "p5", sku: "SKU-5", isActive: true, standardSalePrice: d(500), averageCost: d(60), globalCost: null, lastPurchaseCost: null },
  ];
  // p4 ya quedó APPLIED en una corrida anterior que se cayó antes de terminar el batch.
  const settings: FakeSetting[] = [{ branchId: BRANCH, productId: "p4", branchPrice: d(450), branchCost: null, priceSource: "MANUAL", priceExceptionReason: "Ajuste de precios", priceExceptionAt: new Date(), lastPriceUpdateAt: new Date(), priceUpdatedByUserId: ACTOR }];
  const appliedAtFirstRun = new Date("2026-01-01T00:00:00Z");
  const lines: FakeLine[] = [
    { id: "l4", batchId: "b4", productId: "p4", branchId: BRANCH, costSnapshot: d(40), currentPriceSnapshot: d(400), priceSourceSnapshot: "STANDARD", newPrice: d(450), status: "APPLIED", message: null, trayDecisionId: null, appliedPreviousPrice: null, appliedAt: appliedAtFirstRun },
    { id: "l5", batchId: "b4", productId: "p5", branchId: BRANCH, costSnapshot: d(60), currentPriceSnapshot: d(500), priceSourceSnapshot: "STANDARD", newPrice: d(550), status: "PENDING", message: null, trayDecisionId: null, appliedPreviousPrice: null, appliedAt: null },
  ];
  const { tx, settings: liveSettings } = createStore({ batch, products, settings, lines });

  await applyLineChunkTx(tx, batch, ["l4", "l5"], ACTOR);

  assert.equal(lines[0].status, "APPLIED");
  assert.equal(lines[0].appliedAt, appliedAtFirstRun, "la línea ya aplicada no se reprocesa");
  assert.equal(liveSettings.find((s) => s.productId === "p4")?.branchPrice?.toNumber(), 450, "su precio no cambia");

  assert.equal(lines[1].status, "APPLIED");
  assert.equal(liveSettings.find((s) => s.productId === "p5")?.branchPrice?.toNumber(), 550, "la línea PENDING sí se aplica");
});

test("LA QUE IMPORTA — una línea con trayDecisionId cierra la decisión de Bandeja (RESOLVED/EXECUTION) sin volver a aplicar el precio por ese camino", async () => {
  const batch: FakeBatch = { id: "b5", code: "CP-000005", status: "APPLYING", target: "BRANCHES", branchIds: [BRANCH], reason: "Ajuste de precios", source: "MANUAL", appliedByUserId: null, appliedAt: null };
  const products: FakeProduct[] = [{ id: "p6", sku: "SKU-6", isActive: true, standardSalePrice: d(600), averageCost: d(70), globalCost: null, lastPurchaseCost: null }];
  const lines: FakeLine[] = [{ id: "l6", batchId: "b5", productId: "p6", branchId: BRANCH, costSnapshot: d(70), currentPriceSnapshot: d(600), priceSourceSnapshot: "STANDARD", newPrice: d(650), status: "PENDING", message: null, trayDecisionId: "decision-1", appliedPreviousPrice: null, appliedAt: null }];
  const decisions: FakeDecision[] = [{ id: "decision-1", category: "PRICING", status: "OPEN", resolvedAt: null, resolvedByUserId: null, executedEntityType: null, executedEntityId: null, actionResultJson: null }];
  const { tx } = createStore({ batch, products, lines, decisions });

  await applyLineChunkTx(tx, batch, ["l6"], ACTOR);

  assert.equal(lines[0].status, "APPLIED");
  const decision = decisions[0] as unknown as { status: string; resolvedByUserId: string | null; resolutionSource: string | null; resolutionNote: string | null; executedEntityType: string | null; executedEntityId: string | null; actionResultJson: unknown };
  assert.equal(decision.status, "RESOLVED", "ya no EXECUTED — ese estado ahora es propio de runBrainDecision (Brain ejecutando algo él mismo)");
  assert.equal(decision.resolutionSource, "EXECUTION");
  assert.match(decision.resolutionNote ?? "", /CP-000005/);
  assert.equal(decision.resolvedByUserId, ACTOR);
  assert.equal(decision.executedEntityType, "Product");
  assert.equal(decision.executedEntityId, "p6");
  assert.deepEqual(decision.actionResultJson, { branchId: BRANCH, productId: "p6", previousPrice: null, newPrice: 650 });
});

test("una decisión de Bandeja ya resuelta por otro camino se deja como está — no se pisa su resolución", async () => {
  const batch: FakeBatch = { id: "b6", code: "CP-000006", status: "APPLYING", target: "BRANCHES", branchIds: [BRANCH], reason: "Ajuste de precios", source: "MANUAL", appliedByUserId: null, appliedAt: null };
  const products: FakeProduct[] = [{ id: "p7", sku: "SKU-7", isActive: true, standardSalePrice: d(700), averageCost: d(10), globalCost: null, lastPurchaseCost: null }];
  const lines: FakeLine[] = [{ id: "l7", batchId: "b6", productId: "p7", branchId: BRANCH, costSnapshot: d(10), currentPriceSnapshot: d(700), priceSourceSnapshot: "STANDARD", newPrice: d(720), status: "PENDING", message: null, trayDecisionId: "decision-2", appliedPreviousPrice: null, appliedAt: null }];
  const resolvedAt = new Date("2026-02-02T00:00:00Z");
  const decisions: FakeDecision[] = [{ id: "decision-2", category: "PRICING", status: "EXECUTED", resolvedAt, resolvedByUserId: "otro-user", executedEntityType: "Product", executedEntityId: "p7", actionResultJson: { origin: "bandeja_precios" } }];
  const { tx } = createStore({ batch, products, lines, decisions });

  await applyLineChunkTx(tx, batch, ["l7"], ACTOR);

  assert.equal(lines[0].status, "APPLIED", "la línea sí se aplica — el precio es independiente de la decisión");
  assert.equal(decisions[0].resolvedByUserId, "otro-user", "no se reescribe una decisión que otro camino ya resolvió");
  assert.equal(decisions[0].resolvedAt, resolvedAt);
});

test("destino GENERAL: aplica vía setStandardSalePriceTx, no vía branchProductSetting", async () => {
  const batch: FakeBatch = { id: "b7", code: "CP-000007", status: "APPLYING", target: "GENERAL", branchIds: [], reason: "Ajuste de precios", source: "MANUAL", appliedByUserId: null, appliedAt: null };
  const products: FakeProduct[] = [{ id: "p8", sku: "SKU-8", isActive: true, standardSalePrice: d(800), averageCost: d(20), globalCost: null, lastPurchaseCost: null }];
  const lines: FakeLine[] = [{ id: "l8", batchId: "b7", productId: "p8", branchId: null, costSnapshot: d(20), currentPriceSnapshot: d(800), priceSourceSnapshot: "STANDARD", newPrice: d(850), status: "PENDING", message: null, trayDecisionId: null, appliedPreviousPrice: null, appliedAt: null }];
  const { tx, products: liveProducts, settings } = createStore({ batch, products, lines });

  await applyLineChunkTx(tx, batch, ["l8"], ACTOR);

  assert.equal(lines[0].status, "APPLIED");
  assert.equal(lines[0].appliedPreviousPrice?.toNumber(), 800);
  assert.equal(liveProducts[0].standardSalePrice.toNumber(), 850);
  assert.equal(settings.length, 0, "GENERAL nunca toca BranchProductSetting");
});

test("LA QUE IMPORTA — reversión: una línea con newPrice=0 en un batch source=REVERT escribe branchPrice:null (vuelve a seguir el general), no un precio de 0", async () => {
  const batch: FakeBatch = { id: "b11", code: "CP-000011", status: "APPLYING", target: "BRANCHES", branchIds: [BRANCH], reason: "Reversión de CP-000001", source: "REVERT", appliedByUserId: null, appliedAt: null };
  const products: FakeProduct[] = [{ id: "p13", sku: "SKU-13", isActive: true, standardSalePrice: d(900), averageCost: d(30), globalCost: null, lastPurchaseCost: null }];
  // Esta sucursal SÍ tenía una excepción (la carga original la puso) — revertir la quita.
  const settings: FakeSetting[] = [{ branchId: BRANCH, productId: "p13", branchPrice: d(950), branchCost: null, priceSource: "MANUAL", priceExceptionReason: "Ajuste de precios", priceExceptionAt: new Date(), lastPriceUpdateAt: new Date(), priceUpdatedByUserId: ACTOR }];
  const lines: FakeLine[] = [{ id: "l13", batchId: "b11", productId: "p13", branchId: BRANCH, costSnapshot: d(30), currentPriceSnapshot: d(950), priceSourceSnapshot: "BRANCH", newPrice: d(0), status: "PENDING", message: null, trayDecisionId: null, appliedPreviousPrice: null, appliedAt: null }];
  const { tx, settings: liveSettings } = createStore({ batch, products, settings, lines });

  await applyLineChunkTx(tx, batch, ["l13"], ACTOR);

  assert.equal(lines[0].status, "APPLIED", "no queda BLOCKED por 'precio <= 0' — el sentinel de reversión se maneja antes de classifyLine");
  assert.equal(liveSettings.find((s) => s.productId === "p13")?.branchPrice, null, "vuelve a seguir el precio general, no queda en 0");
});

test("finalizeBatchTx: todo APPLIED → el batch cierra APPLIED y audita totales", async () => {
  const batch: FakeBatch = { id: "b8", code: "CP-000008", status: "APPLYING", target: "BRANCHES", branchIds: [BRANCH], reason: "Ajuste de precios", source: "MANUAL", appliedByUserId: null, appliedAt: null };
  const lines: FakeLine[] = [
    { id: "l9", batchId: "b8", productId: "p9", branchId: BRANCH, costSnapshot: null, currentPriceSnapshot: null, priceSourceSnapshot: "STANDARD", newPrice: null, status: "APPLIED", message: null, trayDecisionId: null, appliedPreviousPrice: null, appliedAt: new Date() },
  ];
  const { tx, auditLogs } = createStore({ batch, products: [], lines });

  const result = await finalizeBatchTx(tx, "b8", ACTOR);

  assert.equal(result.status, "APPLIED");
  assert.equal(batch.status, "APPLIED");
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, "PRICE_BATCH_APPLIED");
});

test("finalizeBatchTx: con una línea BLOCKED entre las demás APPLIED → PARTIAL", async () => {
  const batch: FakeBatch = { id: "b9", code: "CP-000009", status: "APPLYING", target: "BRANCHES", branchIds: [BRANCH], reason: "Ajuste de precios", source: "MANUAL", appliedByUserId: null, appliedAt: null };
  const lines: FakeLine[] = [
    { id: "l10", batchId: "b9", productId: "p10", branchId: BRANCH, costSnapshot: null, currentPriceSnapshot: null, priceSourceSnapshot: "STANDARD", newPrice: null, status: "APPLIED", message: null, trayDecisionId: null, appliedPreviousPrice: null, appliedAt: new Date() },
    { id: "l11", batchId: "b9", productId: "p11", branchId: BRANCH, costSnapshot: null, currentPriceSnapshot: null, priceSourceSnapshot: "STANDARD", newPrice: null, status: "BLOCKED", message: "bloqueada", trayDecisionId: null, appliedPreviousPrice: null, appliedAt: null },
  ];
  const { tx } = createStore({ batch, products: [], lines });

  const result = await finalizeBatchTx(tx, "b9", ACTOR);
  assert.equal(result.status, "PARTIAL");
});

test("finalizeBatchTx: todavía hay PENDING → no cierra el batch (no debería llamarse así, pero es un no-op seguro)", async () => {
  const batch: FakeBatch = { id: "b10", code: "CP-000010", status: "APPLYING", target: "BRANCHES", branchIds: [BRANCH], reason: "Ajuste de precios", source: "MANUAL", appliedByUserId: null, appliedAt: null };
  const lines: FakeLine[] = [
    { id: "l12", batchId: "b10", productId: "p12", branchId: BRANCH, costSnapshot: null, currentPriceSnapshot: null, priceSourceSnapshot: "STANDARD", newPrice: null, status: "PENDING", message: null, trayDecisionId: null, appliedPreviousPrice: null, appliedAt: null },
  ];
  const { tx } = createStore({ batch, products: [], lines });

  const result = await finalizeBatchTx(tx, "b10", ACTOR);
  assert.equal(result.status, "APPLYING", "sigue abierto — todavía queda trabajo pendiente");
  assert.equal(batch.status, "APPLYING");
});
