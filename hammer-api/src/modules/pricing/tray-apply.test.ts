import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { applyOneTrayDecisionTx, computeTrayTotals, type PricingTrayRow } from "@/modules/pricing/tray-service";

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
 */

type FakeDecision = {
  id: string;
  category: string;
  status: string;
  evidenceJson: Record<string, unknown> | null;
  proposedActionJson: Record<string, unknown> | null;
};
type FakeSetting = { branchId: string; productId: string; branchPrice: Prisma.Decimal | null };

function createFakeTx(opts: { decisions?: FakeDecision[]; settings?: FakeSetting[] }) {
  const decisions = new Map((opts.decisions ?? []).map((d) => [d.id, d]));
  const settings = new Map((opts.settings ?? []).map((s) => [`${s.branchId}:${s.productId}`, s]));
  const auditLogs: Array<Record<string, unknown>> = [];
  const decisionUpdates: Array<Record<string, unknown>> = [];
  let seq = 0;

  const tx = {
    brainDecision: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const d = decisions.get(where.id);
        if (!d) throw new Error(`decision ${where.id} no encontrada`);
        return d;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        decisionUpdates.push({ id: where.id, ...data });
        const existing = decisions.get(where.id);
        if (existing) decisions.set(where.id, { ...existing, ...data } as FakeDecision);
        return existing;
      },
    },
    branchProductSetting: {
      findUnique: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) => {
        const key = `${where.branchId_productId.branchId}:${where.branchId_productId.productId}`;
        const s = settings.get(key);
        return s ? { branchPrice: s.branchPrice } : null;
      },
      upsert: async ({ where, create, update }: { where: { branchId_productId: { branchId: string; productId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = `${where.branchId_productId.branchId}:${where.branchId_productId.productId}`;
        const existing = settings.get(key);
        const data = existing ? { ...existing, ...update } : { branchId: where.branchId_productId.branchId, productId: where.branchId_productId.productId, ...create };
        settings.set(key, data as FakeSetting & Record<string, unknown>);
        return data;
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

  return { tx: tx as unknown as Prisma.TransactionClient, settings, auditLogs, decisionUpdates };
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

test("una decisión SIN costLooksWrong (aplicable normal) sí se procesa", async () => {
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
