import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { applySuggestedPriceTx } from "@/modules/pricing/service";

/**
 * Fase 0 (prompt-motor-precios-lote-herencia-gobierno.md): applySuggestedPrice
 * escribía branchPrice sin lastPriceUpdateAt/priceUpdatedByUserId/priceSource/
 * marginPercent — la Fase 1 (bandeja de precios) necesita esos cuatro campos
 * para detectar COST_CHANGED_PRICE_STALE. applySuggestedPriceTx es el cuerpo
 * transaccional, separado del wrapper (que abre prisma.$transaction) para
 * poder probarlo con un tx en memoria — mismo patrón que
 * sendCashOutToCustodyTx/postponeCashDepositTx en el módulo de tesorería.
 *
 * Pruebas 2-5 (ALL_BRANCHES, fallo parcial, audit por sucursal, bloqueo en
 * lote) se agregan en la Fase 2, cuando applySuggestedPrice resuelve una
 * lista de sucursales en vez de una sola.
 */

type FakeSetting = { branchId: string; productId: string; branchPrice: Prisma.Decimal | null };

function createFakeTx(opts: { settings?: FakeSetting[] }) {
  const settings = new Map((opts.settings ?? []).map((s) => [`${s.branchId}:${s.productId}`, s]));
  const auditLogs: Array<Record<string, unknown>> = [];
  let seq = 0;

  const tx = {
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

  return { tx: tx as unknown as Prisma.TransactionClient, settings, auditLogs };
}

const ACTOR = "user-1";

test("Prueba 1 (LA QUE IMPORTA) — aplicar escribe lastPriceUpdateAt, priceUpdatedByUserId, priceSource y marginPercent", async () => {
  const { tx, settings } = createFakeTx({});
  const before = new Date();

  await applySuggestedPriceTx(
    tx,
    {
      productId: "product-1",
      branchId: "branch-1",
      applyScope: "BRANCH",
      suggestedPrice: 150,
      marginPercent: 28.5,
      actorUserId: ACTOR,
    },
    "branch-1",
    [],
  );

  const row = settings.get("branch-1:product-1") as unknown as Record<string, unknown>;
  assert.ok(row, "el upsert creó la fila");
  assert.equal(row.priceSource, "CALCULATED", "distinto de MANUAL — este camino viene del motor con snapshot completo");
  assert.equal(row.marginPercent, 28.5);
  assert.equal(row.priceUpdatedByUserId, ACTOR);
  assert.ok(row.lastPriceUpdateAt instanceof Date && (row.lastPriceUpdateAt as Date).getTime() >= before.getTime(), "lastPriceUpdateAt quedó poblado con la fecha real de la aplicación");
});

test("Prueba 1b — sobre una fila existente, el update también escribe los cuatro campos (no solo el create)", async () => {
  const { tx, settings } = createFakeTx({
    settings: [{ branchId: "branch-1", productId: "product-1", branchPrice: new Prisma.Decimal(100) }],
  });

  await applySuggestedPriceTx(
    tx,
    { productId: "product-1", branchId: "branch-1", applyScope: "BRANCH", suggestedPrice: 200, marginPercent: 30, actorUserId: ACTOR },
    "branch-1",
    [],
  );

  const row = settings.get("branch-1:product-1") as unknown as Record<string, unknown>;
  assert.equal(row.priceSource, "CALCULATED");
  assert.equal(row.priceUpdatedByUserId, ACTOR);
  assert.ok(row.lastPriceUpdateAt instanceof Date);
});

test("marginPercent ausente en el input queda null, no undefined ni el valor previo", async () => {
  const { tx, settings } = createFakeTx({});
  await applySuggestedPriceTx(
    tx,
    { productId: "product-1", branchId: "branch-1", applyScope: "BRANCH", suggestedPrice: 150, actorUserId: ACTOR },
    "branch-1",
    [],
  );
  const row = settings.get("branch-1:product-1") as unknown as Record<string, unknown>;
  assert.equal(row.marginPercent, null);
});
