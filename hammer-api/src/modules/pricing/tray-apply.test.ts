import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  applyOneTrayDecisionTx,
  applyAlsoBranchPriceTx,
  keepOneTrayPriceTx,
  computeTrayTotals,
  type PricingTrayRow,
} from "@/modules/pricing/tray-service";

/**
 * Parte A (prompt-huecos-fase1-fase3-despliegue.md) — un costo de sucursal
 * dudoso (branchCost más de 2× el costo de referencia, probable error de
 * tecleo) no puede aplicarse en un clic desde la bandeja. El precio
 * sugerido se calculó sobre ese costo y hereda el error; sacar el checkbox
 * es comodidad, no control — este endpoint escribe precios de venta, así
 * que se rechaza también en el backend.
 *
 * applyOneTrayDecisionTx es el cuerpo de UNA decisión, separado del bucle
 * (que abre prisma.$transaction real) para poder probarlo con un tx en
 * memoria — mismo patrón que applySuggestedPriceTx/clearBranchPriceExceptionTx.
 *
 * Parte C (prompt-completo-pendientes-2026-10.md) — ahora applyOneTrayDecisionTx
 * también llama a getEffectiveProductPricing(tx, ...) para el guard "bajo el
 * costo nunca se aplica, ni a mano", así que el fake tx necesita soportar
 * TODO lo que esa función pide para un producto simple sin fusión
 * (productStockGroupMember.findFirst -> null, systemSetting.findUnique ->
 * null = WAC desactivado, product.findUniqueOrThrow con los campos de costo).
 */

type FakeDecision = {
  id: string;
  category: string;
  status: string;
  branchId?: string | null;
  productId?: string | null;
  proposedActionType?: string | null;
  evidenceJson: Record<string, unknown> | null;
  proposedActionJson: Record<string, unknown> | null;
};
type FakeProduct = { id: string; sku: string; standardSalePrice: Prisma.Decimal | null; globalCost: Prisma.Decimal | null; averageCost: Prisma.Decimal | null; lastPurchaseCost: Prisma.Decimal | null };
type FakeSetting = { branchId: string; productId: string; branchPrice: Prisma.Decimal | null; branchCost: Prisma.Decimal | null; marginPercent?: Prisma.Decimal | null; priceReviewedAt?: Date | null; priceReviewedPrice?: Prisma.Decimal | null; priceReviewedCost?: Prisma.Decimal | null; priceReviewedByUserId?: string | null; priceReviewNote?: string | null };

function d(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

function createFakeTx(opts: { decisions?: FakeDecision[]; settings?: FakeSetting[]; products?: FakeProduct[] }) {
  const decisions = new Map((opts.decisions ?? []).map((dec) => [dec.id, dec]));
  const settings = new Map((opts.settings ?? []).map((s) => [`${s.branchId}:${s.productId}`, s]));
  const products = new Map((opts.products ?? [{ id: "product-1", sku: "SKU-TEST", standardSalePrice: d(0), globalCost: null, averageCost: null, lastPurchaseCost: null }]).map((p) => [p.id, p]));
  const auditLogs: Array<Record<string, unknown>> = [];
  const decisionUpdates: Array<Record<string, unknown>> = [];
  const actionLogs: Array<Record<string, unknown>> = [];
  let seq = 0;

  const tx = {
    $queryRaw: async () => [],
    productStockGroupMember: { findFirst: async () => null },
    systemSetting: { findUnique: async () => null },
    inventoryBalance: { findUnique: async () => null },
    product: {
      findUnique: async ({ where }: { where: { id: string } }) => products.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const found = products.get(where.id);
        if (!found) throw new Error(`product ${where.id} no encontrado`);
        return found;
      },
    },
    brainDecision: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const dec = decisions.get(where.id);
        if (!dec) throw new Error(`decision ${where.id} no encontrada`);
        return dec;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        decisionUpdates.push({ id: where.id, ...data });
        const existing = decisions.get(where.id);
        if (existing) decisions.set(where.id, { ...existing, ...data } as FakeDecision);
        return existing;
      },
      updateMany: async ({ where, data }: { where: { id?: string; status?: string; category?: string; productId?: string; branchId?: string }; data: Record<string, unknown> }) => {
        const matches = [...decisions.values()].filter((dec) =>
          (where.id === undefined || dec.id === where.id)
          && (where.status === undefined || dec.status === where.status)
          && (where.category === undefined || dec.category === where.category)
          && (where.productId === undefined || dec.productId === where.productId)
          && (where.branchId === undefined || dec.branchId === where.branchId),
        );
        for (const match of matches) {
          decisionUpdates.push({ id: match.id, ...data });
          Object.assign(match, data);
        }
        return { count: matches.length };
      },
    },
    // Fase 4.2 (prompt-brain-centro-decisiones.md) — applyOneTrayDecisionTx
    // ahora también deja una entrada de bitácora al cerrar como RESOLVED/EXECUTION.
    brainDecisionActionLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        actionLogs.push(data);
        return data;
      },
    },
    branchProductSetting: {
      findUnique: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) => {
        const key = `${where.branchId_productId.branchId}:${where.branchId_productId.productId}`;
        const s = settings.get(key);
        return s ? { branchPrice: s.branchPrice, branchCost: s.branchCost } : null;
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
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `audit-${seq}`, ...data };
        auditLogs.push(row);
        return row;
      },
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, settings, products, auditLogs, decisionUpdates, actionLogs, decisions };
}

const ACTOR = "user-1";

function costLooksWrongDecision(): FakeDecision {
  return {
    id: "decision-doubtful",
    category: "PRICING",
    status: "OPEN",
    evidenceJson: { costLooksWrong: true, branchCost: 4500, referenceCost: 450 },
    proposedActionJson: { productId: "product-1", branchId: "branch-1", currentPrice: 100, suggestedPrice: 5999, calculationSnapshot: {} },
  };
}

test("Prueba 4 (LA QUE IMPORTA) — aplicar una decisión con costLooksWrong es rechazada con COST_REQUIRES_REVIEW, sin escribir precio", async () => {
  const { tx, settings, auditLogs } = createFakeTx({ decisions: [costLooksWrongDecision()] });

  await assert.rejects(
    () => applyOneTrayDecisionTx(tx, "decision-doubtful", { actorUserId: ACTOR }),
    /COST_REQUIRES_REVIEW/,
  );

  assert.equal(settings.size, 0, "no se escribió ningún BranchProductSetting");
  assert.equal(auditLogs.length, 0, "no se escribió ninguna entrada de libro/auditoría de aplicación");
});

test("una decisión SIN costLooksWrong (aplicable normal) sí se procesa con el sugerido, cuando no se manda price", async () => {
  const decision: FakeDecision = {
    id: "decision-ok",
    category: "PRICING",
    status: "OPEN",
    evidenceJson: { costLooksWrong: false },
    proposedActionJson: { productId: "product-1", branchId: "branch-1", currentPrice: 100, suggestedPrice: 150, calculationSnapshot: {} },
  };
  const { tx, settings } = createFakeTx({ decisions: [decision] });

  const result = await applyOneTrayDecisionTx(tx, "decision-ok", { actorUserId: ACTOR });
  assert.equal(result.newPrice, 150);
  assert.equal(settings.get("branch-1:product-1")?.branchPrice?.toString(), "150");
});

test("evidenceJson ausente (decisión sin ese campo) no revienta — se trata como costLooksWrong false", async () => {
  const decision: FakeDecision = {
    id: "decision-no-evidence",
    category: "PRICING",
    status: "OPEN",
    evidenceJson: null,
    proposedActionJson: { productId: "product-1", branchId: "branch-1", currentPrice: 100, suggestedPrice: 150, calculationSnapshot: {} },
  };
  const { tx } = createFakeTx({ decisions: [decision] });
  const result = await applyOneTrayDecisionTx(tx, "decision-no-evidence", { actorUserId: ACTOR });
  assert.equal(result.newPrice, 150);
});

test("LA QUE IMPORTA — precio manual (price distinto del sugerido) se aplica, y el sugerido original queda en el log", async () => {
  const decision: FakeDecision = {
    id: "decision-manual",
    category: "PRICING",
    status: "OPEN",
    evidenceJson: { costLooksWrong: false },
    proposedActionJson: { productId: "product-1", branchId: "branch-1", currentPrice: 100, suggestedPrice: 150, calculationSnapshot: {} },
  };
  const { tx, settings, decisionUpdates } = createFakeTx({ decisions: [decision] });

  const result = await applyOneTrayDecisionTx(tx, "decision-manual", { actorUserId: ACTOR, price: 130, reason: "El dueño decidió otro precio" });
  assert.equal(result.newPrice, 130, "se aplicó el precio elegido, NO el sugerido");
  assert.equal(settings.get("branch-1:product-1")?.branchPrice?.toString(), "130");

  const update = decisionUpdates.find((u) => u.id === "decision-manual")!;
  assert.equal(update.resolutionSource, "USER", "method MANUAL cierra como USER, no EXECUTION");
  const actionResult = update.actionResultJson as { suggestedByEngine: number; chosenPrice: number; method: string };
  assert.equal(actionResult.suggestedByEngine, 150, "el sugerido original queda en el snapshot");
  assert.equal(actionResult.chosenPrice, 130);
  assert.equal(actionResult.method, "MANUAL");
});

test("LA QUE IMPORTA — precio manual bajo el costo efectivo se rechaza sin escribir nada", async () => {
  const decision: FakeDecision = {
    id: "decision-below",
    category: "PRICING",
    status: "OPEN",
    evidenceJson: { costLooksWrong: false },
    proposedActionJson: { productId: "product-1", branchId: "branch-1", currentPrice: 100, suggestedPrice: 150, calculationSnapshot: {} },
  };
  const { tx, settings } = createFakeTx({
    decisions: [decision],
    settings: [{ branchId: "branch-1", productId: "product-1", branchPrice: d(100), branchCost: d(80) }],
  });

  await assert.rejects(
    () => applyOneTrayDecisionTx(tx, "decision-below", { actorUserId: ACTOR, price: 50 }),
    /BELOW_COST_NOT_ALLOWED/,
  );
  assert.equal(settings.get("branch-1:product-1")?.branchPrice?.toString(), "100", "el precio NO se tocó");
});

test("LA QUE IMPORTA — doble aplicar da ALREADY_PROCESSED en el segundo (mismo tx reutilizado simula el estado ya cerrado)", async () => {
  const decision: FakeDecision = {
    id: "decision-double",
    category: "PRICING",
    status: "OPEN",
    evidenceJson: { costLooksWrong: false },
    proposedActionJson: { productId: "product-1", branchId: "branch-1", currentPrice: 100, suggestedPrice: 150, calculationSnapshot: {} },
  };
  const { tx } = createFakeTx({ decisions: [decision] });

  await applyOneTrayDecisionTx(tx, "decision-double", { actorUserId: ACTOR });
  await assert.rejects(
    () => applyOneTrayDecisionTx(tx, "decision-double", { actorUserId: ACTOR }),
    /ALREADY_PROCESSED/,
  );
});

test("Prueba 5 — el total en riesgo excluye el impactAmount de las filas con costLooksWrong", () => {
  const baseRow: PricingTrayRow = {
    decisionId: "d1",
    severity: "HIGH",
    reason: "BELOW_COST",
    branchId: "branch-1",
    branchName: "Managua",
    productId: "product-1",
    productSku: "SKU-1",
    productName: "Producto 1",
    currentPrice: 100,
    suggestedPrice: 150,
    effectiveCost: 90,
    marginActual: 10,
    marginObjetivo: 20,
    stockAtRisk: 5,
    impactAmount: 1000,
    lastPriceUpdateAt: null,
    applicable: true,
    costLooksWrong: false,
    referenceCost: null,
    evidence: {},
  };
  const doubtfulRow: PricingTrayRow = {
    ...baseRow,
    decisionId: "d2",
    productId: "product-2",
    impactAmount: 50_000, // inflado por el costo mal tecleado
    applicable: false,
    costLooksWrong: true,
    referenceCost: 450,
  };

  const totals = computeTrayTotals([baseRow, doubtfulRow]);
  assert.equal(totals.impactTotal, 1000, "el impactAmount inflado (50,000) queda fuera del total");
  assert.equal(totals.costDoubtfulCount, 1);
  assert.equal(totals.count, 2, "count sigue contando ambas filas — solo el total en córdobas las excluye");
});

test("LA QUE IMPORTA — 'aplicar también en…' en otra sucursal respeta su propio costo (rechaza si queda bajo costo)", async () => {
  const { tx, settings } = createFakeTx({
    settings: [{ branchId: "branch-2", productId: "product-1", branchPrice: d(100), branchCost: d(80) }],
  });

  await assert.rejects(
    () => applyAlsoBranchPriceTx(tx, "branch-2", "product-1", 50, ACTOR),
    /BELOW_COST_NOT_ALLOWED/,
  );
  assert.equal(settings.get("branch-2:product-1")?.branchPrice?.toString(), "100");
});

test("LA QUE IMPORTA — 'aplicar también en…' cierra las decisiones PRICING abiertas de ese producto en esa sucursal", async () => {
  const otherDecision: FakeDecision = {
    id: "decision-other-branch",
    category: "PRICING",
    status: "OPEN",
    branchId: "branch-2",
    productId: "product-1",
    evidenceJson: null,
    proposedActionJson: null,
  };
  const { tx, settings, decisions } = createFakeTx({
    decisions: [otherDecision],
    settings: [{ branchId: "branch-2", productId: "product-1", branchPrice: d(100), branchCost: null }],
  });

  await applyAlsoBranchPriceTx(tx, "branch-2", "product-1", 130, ACTOR);
  assert.equal(settings.get("branch-2:product-1")?.branchPrice?.toString(), "130");
  assert.equal(decisions.get("decision-other-branch")?.status, "RESOLVED", "la decisión de esa sucursal/producto se cerró — ya no está desactualizada");
});

test("LA QUE IMPORTA — mantener un BELOW_COST se rechaza, sin escribir nada", async () => {
  const decision: FakeDecision = {
    id: "decision-below-keep",
    category: "PRICING",
    status: "OPEN",
    branchId: "branch-1",
    productId: "product-1",
    proposedActionType: "REVIEW_PRICE_BELOW_COST",
    evidenceJson: { currentPrice: 100 },
    proposedActionJson: null,
  };
  const { tx, settings } = createFakeTx({ decisions: [decision] });

  await assert.rejects(
    () => keepOneTrayPriceTx(tx, "decision-below-keep", { note: "Ya lo revisé", actorUserId: ACTOR }),
    /NOT_KEEPABLE/,
  );
  assert.equal(settings.size, 0, "no se escribió ningún BranchProductSetting");
});

test("LA QUE IMPORTA — mantener un MARGIN_POLICY guarda la foto (precio/costo/nota) y resuelve la decisión", async () => {
  const decision: FakeDecision = {
    id: "decision-margin-keep",
    category: "PRICING",
    status: "OPEN",
    branchId: "branch-1",
    productId: "product-1",
    proposedActionType: "REVIEW_PRICE_MARGIN_POLICY",
    evidenceJson: { currentPrice: 100 },
    proposedActionJson: null,
  };
  const { tx, settings, decisions } = createFakeTx({ decisions: [decision] });

  await keepOneTrayPriceTx(tx, "decision-margin-keep", { note: "Precio de competencia", actorUserId: ACTOR });

  const setting = settings.get("branch-1:product-1")!;
  assert.equal(setting.priceReviewedPrice?.toString(), "100");
  assert.equal(setting.priceReviewedByUserId, ACTOR);
  assert.equal(setting.priceReviewNote, "Precio de competencia");
  assert.ok(setting.priceReviewedAt instanceof Date);
  assert.equal(decisions.get("decision-margin-keep")?.status, "RESOLVED");
});

test("mantener una decisión ya resuelta da ALREADY_PROCESSED", async () => {
  const decision: FakeDecision = {
    id: "decision-already",
    category: "PRICING",
    status: "RESOLVED",
    branchId: "branch-1",
    productId: "product-1",
    proposedActionType: "REVIEW_PRICE_MARGIN_POLICY",
    evidenceJson: null,
    proposedActionJson: null,
  };
  const { tx } = createFakeTx({ decisions: [decision] });

  await assert.rejects(
    () => keepOneTrayPriceTx(tx, "decision-already", { note: "Ya lo revisé", actorUserId: ACTOR }),
    /ALREADY_PROCESSED/,
  );
});
