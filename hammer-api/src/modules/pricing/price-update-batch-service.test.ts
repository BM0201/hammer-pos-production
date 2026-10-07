import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { updateLinesTx, removeLinesTx, cancelDraftTx } from "@/modules/pricing/price-update-batch-service";

/**
 * prompt-carga-precios.md Fase 1 — "editar una carga que ya no está en
 * DRAFT → 409 (ALREADY_PROCESSED)". Fake tx mínimo: solo lo que
 * assertDraftTx + cada mutación tocan, sin el motor de snapshot (eso
 * requiere mockear getEffectiveProductPricingBatch/resolvePolicyForProductBatch,
 * fuera de alcance de este test puntual — createDraft/previewBatch se
 * prueban mejor con Prisma real o un fake más grande en otra pasada).
 */

const BATCH_ID = "batch-1";

function createBatchFakeStore(opts: { status?: string } = {}) {
  const batch = {
    id: BATCH_ID,
    code: "CP-000001",
    status: opts.status ?? "DRAFT",
    target: "BRANCHES",
    branchIds: ["branch-1"],
  };

  const lines = [
    { id: "line-1", batchId: BATCH_ID, newPrice: null as Prisma.Decimal | null },
    { id: "line-2", batchId: BATCH_ID, newPrice: null as Prisma.Decimal | null },
  ];

  const tx = {
    $queryRaw: async () => [],
    priceUpdateBatch: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === batch.id ? { ...batch } : null),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        if (where.id !== batch.id || where.status !== batch.status) return { count: 0 };
        Object.assign(batch, data);
        return { count: 1 };
      },
    },
    priceUpdateLine: {
      updateMany: async ({ where, data }: { where: { id: string; batchId: string }; data: { newPrice: Prisma.Decimal | null } }) => {
        const line = lines.find((l) => l.id === where.id && l.batchId === where.batchId);
        if (!line) return { count: 0 };
        line.newPrice = data.newPrice;
        return { count: 1 };
      },
      deleteMany: async ({ where }: { where: { batchId: string; id: { in: string[] } } }) => {
        const before = lines.length;
        const remaining = lines.filter((l) => !(l.batchId === where.batchId && where.id.in.includes(l.id)));
        lines.length = 0;
        lines.push(...remaining);
        return { count: before - lines.length };
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx: tx as Prisma.TransactionClient, batch, lines };
}

test("LA QUE IMPORTA — updateLines sobre una carga que ya NO está en DRAFT: ALREADY_PROCESSED, no se toca nada", async () => {
  const { tx, lines } = createBatchFakeStore({ status: "APPLIED" });
  await assert.rejects(
    () => updateLinesTx(tx, BATCH_ID, [{ lineId: "line-1", newPrice: 500 }]),
    /ALREADY_PROCESSED/,
  );
  assert.equal(lines[0].newPrice, null, "no debe escribir nada si la carga no esta en DRAFT");
});

test("updateLines en DRAFT: escribe newPrice normalmente", async () => {
  const { tx, lines } = createBatchFakeStore();
  const result = await updateLinesTx(tx, BATCH_ID, [{ lineId: "line-1", newPrice: 500 }]);
  assert.equal(result.updated, 1);
  assert.equal(lines[0].newPrice?.toNumber(), 500);
});

test("LA QUE IMPORTA — removeLines sobre una carga CANCELLED: ALREADY_PROCESSED", async () => {
  const { tx, lines } = createBatchFakeStore({ status: "CANCELLED" });
  await assert.rejects(() => removeLinesTx(tx, BATCH_ID, ["line-1"]), /ALREADY_PROCESSED/);
  assert.equal(lines.length, 2, "no debe borrar nada si la carga ya no esta en DRAFT");
});

test("LA QUE IMPORTA — doble cancelDraft: el segundo falla, el primero sí cancela", async () => {
  const { tx, batch } = createBatchFakeStore();
  const first = await cancelDraftTx(tx, BATCH_ID);
  assert.equal(first.status, "CANCELLED");
  assert.equal(batch.status, "CANCELLED");

  await assert.rejects(() => cancelDraftTx(tx, BATCH_ID), /ALREADY_PROCESSED/);
});

test("cancelDraft sobre un batch inexistente: NOT_FOUND", async () => {
  const { tx } = createBatchFakeStore();
  await assert.rejects(() => cancelDraftTx(tx, "no-existe"), /NOT_FOUND|ALREADY_PROCESSED/);
});
