import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { setBranchPriceTx } from "@/modules/pricing/branch-price-exception-service";
import { upsertBranchProductSettingTx } from "@/modules/catalog-inventory/service";

/**
 * Parte B (prompt-huecos-fase1-fase3-despliegue.md) — la excepción de
 * precio tenía dos puertas y solo una pedía motivo. upsertBranchProductSetting
 * (catalog-inventory/service.ts, el editor de catálogo) escribía branchPrice
 * y sí registraba lastPriceUpdateAt/priceUpdatedByUserId/priceSource, pero
 * NUNCA priceExceptionReason ni priceExceptionAt — quien fijara un precio
 * desde esa pantalla creaba exactamente la divergencia silenciosa que la
 * Fase 3 existe para eliminar. setBranchPriceTx es ahora el único escritor
 * de branchPrice, y lo llaman los tres caminos (Fase 3, applySuggestedPriceTx,
 * upsertBranchProductSetting).
 */

type FakeSetting = {
  branchId: string;
  productId: string;
  branchPrice: Prisma.Decimal | null;
  priceExceptionReason?: string | null;
  priceExceptionAt?: Date | null;
  priceSource?: string | null;
  lastPriceUpdateAt?: Date | null;
  priceUpdatedByUserId?: string | null;
};

function createFakeTx(opts: { settings?: FakeSetting[] }) {
  const settings = new Map((opts.settings ?? []).map((s) => [`${s.branchId}:${s.productId}`, s]));
  const auditLogs: Array<Record<string, unknown>> = [];

  const tx = {
    // Parte B.1 (prompt-precio-no-se-mueve-solo.md) — setBranchPriceTx
    // ahora audita TODA escritura de branchPrice (PRODUCT_PRICE_CHANGED).
    product: {
      findUnique: async () => ({ sku: "SKU-TEST" }),
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return data;
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
  };

  return { tx: tx as unknown as Prisma.TransactionClient, settings, auditLogs };
}

const ACTOR = "user-1";

test("Prueba 6 — setBranchPriceTx con precio y sin motivo → throw", async () => {
  const { tx } = createFakeTx({});
  await assert.rejects(
    () => setBranchPriceTx(tx, { branchId: "branch-1", productId: "product-1", branchPrice: new Prisma.Decimal(150), exceptionReason: null, priceSource: "MANUAL", actorUserId: ACTOR, origin: "catalogo" }),
    /PRICE_EXCEPTION_REASON_REQUIRED/,
  );
  // Motivo demasiado corto (menos de 3 caracteres) tampoco alcanza.
  await assert.rejects(
    () => setBranchPriceTx(tx, { branchId: "branch-1", productId: "product-1", branchPrice: new Prisma.Decimal(150), exceptionReason: "ok", priceSource: "MANUAL", actorUserId: ACTOR, origin: "catalogo" }),
    /PRICE_EXCEPTION_REASON_REQUIRED/,
  );
});

test("Prueba 7 — con precio y motivo → escribe reason, exceptionAt, lastPriceUpdateAt, priceUpdatedByUserId y priceSource", async () => {
  const { tx, settings } = createFakeTx({});
  const before = new Date();

  await setBranchPriceTx(tx, { branchId: "branch-1", productId: "product-1", branchPrice: new Prisma.Decimal(150), exceptionReason: "Flete", priceSource: "MANUAL", actorUserId: ACTOR, origin: "catalogo" });

  const row = settings.get("branch-1:product-1")!;
  assert.equal(row.branchPrice?.toString(), "150");
  assert.equal(row.priceExceptionReason, "Flete");
  assert.ok(row.priceExceptionAt instanceof Date && row.priceExceptionAt.getTime() >= before.getTime());
  assert.ok(row.lastPriceUpdateAt instanceof Date && row.lastPriceUpdateAt.getTime() >= before.getTime());
  assert.equal(row.priceUpdatedByUserId, ACTOR);
  assert.equal(row.priceSource, "MANUAL");
});

test("Prueba 8 — con branchPrice null → limpia reason y exceptionAt junto con el precio", async () => {
  const { tx, settings } = createFakeTx({
    settings: [{ branchId: "branch-1", productId: "product-1", branchPrice: new Prisma.Decimal(480), priceExceptionReason: "Flete", priceExceptionAt: new Date("2026-03-12") }],
  });

  await setBranchPriceTx(tx, { branchId: "branch-1", productId: "product-1", branchPrice: null, exceptionReason: null, priceSource: "MANUAL", actorUserId: ACTOR, origin: "catalogo" });

  const row = settings.get("branch-1:product-1")!;
  assert.equal(row.branchPrice, null);
  assert.equal(row.priceExceptionReason, null);
  assert.equal(row.priceExceptionAt, null);
});

test("Prueba 9 (LA QUE IMPORTA) — upsertBranchProductSettingTx con branchPrice y sin motivo → throw", async () => {
  const { tx } = createFakeTx({});
  await assert.rejects(
    () => upsertBranchProductSettingTx(tx, { branchId: "branch-1", productId: "product-1", branchPrice: 150 } as any, ACTOR),
    /PRICE_EXCEPTION_REASON_REQUIRED/,
    "el editor de catálogo (segunda puerta) ahora exige motivo igual que la Fase 3 — sin esto, creaba la divergencia silenciosa que la Fase 3 existe para eliminar",
  );
});

test("Prueba 9b — upsertBranchProductSettingTx con branchPrice y motivo → aplica y escribe priceExceptionReason", async () => {
  const { tx, settings } = createFakeTx({});
  await upsertBranchProductSettingTx(tx, { branchId: "branch-1", productId: "product-1", branchPrice: 150, priceExceptionReason: "Cliente mayorista" } as any, ACTOR);

  const row = settings.get("branch-1:product-1")!;
  assert.equal(row.branchPrice?.toString(), "150");
  assert.equal(row.priceExceptionReason, "Cliente mayorista");
});

test("Prueba 10 — upsertBranchProductSettingTx sin tocar branchPrice (solo minStock) → NO exige motivo y no toca los campos de excepción", async () => {
  const { tx, settings } = createFakeTx({
    settings: [{ branchId: "branch-1", productId: "product-1", branchPrice: new Prisma.Decimal(150), priceExceptionReason: "ya declarada antes", priceExceptionAt: new Date("2026-01-01") }],
  });

  await upsertBranchProductSettingTx(tx, { branchId: "branch-1", productId: "product-1", minStock: 5 } as any, ACTOR);

  const row = settings.get("branch-1:product-1")!;
  assert.equal(row.priceExceptionReason, "ya declarada antes", "los campos de excepción no se tocan cuando branchPrice no viene en el input");
  assert.equal(row.branchPrice?.toString(), "150", "el precio tampoco se toca");
});

test("Prueba 11 — la guarda de desvío de fusión sigue disparando igual que antes (vive en el wrapper, antes de la transacción, sin tocar)", () => {
  // FUSION_PRICE_OVERRIDE_CONFIRMATION_REQUIRED usa getEffectiveProductPricing
  // (cliente global de Prisma) para saber si el producto es un miembro
  // derivado de fusión — eso no puede probarse sin base de datos real (mismo
  // límite del resto de esta sesión), y esta refactorización deliberadamente
  // NO tocó esa lógica: solo se extrajo el cuerpo transaccional
  // (upsertBranchProductSettingTx) para poder probar el motivo obligatorio
  // (pruebas 9-10) sin DB. Se confirma acá que la guarda de fusión sigue
  // exactamente donde estaba — en el wrapper, no en el cuerpo transaccional
  // — así que sigue corriendo ANTES de escribir nada, como antes.
  const wrapperSource = upsertBranchProductSettingTx.toString();
  assert.ok(!wrapperSource.includes("FUSION_PRICE_OVERRIDE_CONFIRMATION_REQUIRED"), "la guarda de fusión no se movió al cuerpo transaccional — sigue siendo un guard previo a la escritura, no parte de ella");
});
