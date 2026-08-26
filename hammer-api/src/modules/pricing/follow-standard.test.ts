import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { clearBranchPriceExceptionTx } from "@/modules/pricing/branch-price-exception-service";
import { resolveEffectivePricingFromParts } from "@/modules/catalog/effective-pricing";

/**
 * Fase 3 (prompt-motor-precios-lote-herencia-gobierno.md) — "volver a
 * seguir el precio general" no es modelo nuevo (effective-pricing.ts YA
 * resuelve branchPrice → standardSalePrice → MISSING, sin tocar nada acá);
 * lo que faltaba era que ese estado fuera visible y reversible.
 *
 * clearBranchPriceExceptionTx es el cuerpo de UNA sucursal, separado del
 * bucle (que abre prisma.$transaction real) para poder probarlo con un tx
 * en memoria — mismo patrón que applySuggestedPriceTx.
 */

type FakeSetting = { branchId: string; productId: string; branchPrice: Prisma.Decimal | null; priceExceptionReason: string | null; priceExceptionAt: Date | null };

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

  return { tx: tx as unknown as Prisma.TransactionClient, settings, auditLogs };
}

const ACTOR = "user-1";

test("Prueba 9 (LA QUE IMPORTA) — limpiar la excepción deja branchPrice en null y el precio efectivo pasa a ser standardSalePrice", async () => {
  const { tx, settings } = createFakeTx({
    settings: [{ branchId: "branch-rivas", productId: "product-1", branchPrice: new Prisma.Decimal(480), priceExceptionReason: "Flete", priceExceptionAt: new Date("2026-03-12") }],
  });

  await clearBranchPriceExceptionTx(tx, { productId: "product-1", branchId: "branch-rivas", actorUserId: ACTOR });

  const row = settings.get("branch-rivas:product-1")!;
  assert.equal(row.branchPrice, null, "branchPrice vuelve a null");
  assert.equal(row.priceExceptionReason, null, "el motivo se limpia junto con el precio");
  assert.equal(row.priceExceptionAt, null);

  // effective-pricing.ts NO se toca — con branchPrice null, ya resolvía a
  // STANDARD antes de esta fase; acá se confirma que sigue así.
  const effective = resolveEffectivePricingFromParts({
    productId: "product-1",
    standardSalePrice: new Prisma.Decimal(450),
    branchPrice: row.branchPrice,
    branchCost: null,
    weightedAverageCost: null,
  });
  assert.equal(effective.priceSource, "STANDARD");
  assert.ok(effective.effectivePrice?.equals(new Prisma.Decimal(450)));
});

test("Prueba 10 — el audit log guarda el branchPrice descartado", async () => {
  const { tx, auditLogs } = createFakeTx({
    settings: [{ branchId: "branch-rivas", productId: "product-1", branchPrice: new Prisma.Decimal(480), priceExceptionReason: "Flete", priceExceptionAt: new Date() }],
  });

  await clearBranchPriceExceptionTx(tx, { productId: "product-1", branchId: "branch-rivas", actorUserId: ACTOR });

  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, "PRICE_EXCEPTION_CLEARED");
  assert.equal(auditLogs[0].branchId, "branch-rivas");
  const metadata = auditLogs[0].metadataJson as Record<string, unknown>;
  assert.equal(metadata.discardedBranchPrice, "480", "el precio que se descarta queda en el audit — es la única forma de volver atrás si la excepción sí era deliberada");
});

test("limpiar una sucursal que ya seguía el general (branchPrice ya null) no revienta — previousPrice sale null", async () => {
  const { tx } = createFakeTx({
    settings: [{ branchId: "branch-masaya", productId: "product-1", branchPrice: null, priceExceptionReason: null, priceExceptionAt: null }],
  });
  const previousPrice = await clearBranchPriceExceptionTx(tx, { productId: "product-1", branchId: "branch-masaya", actorUserId: ACTOR });
  assert.equal(previousPrice, null);
});
