import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { decidePriceBandPath, setBranchPriceInBandTx, applyApprovedPriceOverrideTx } from "@/modules/pricing/branch-band-service";

/**
 * Fase 4 (prompt-motor-precios-lote-herencia-gobierno.md) — la sucursal
 * ajusta libre DENTRO de la banda de su categoría; solo sale a aprobación
 * lo que se pasa. decidePriceBandPath es la decisión pura (sin DB) —
 * setBranchPriceInBand (el wrapper que llama a getEffectiveProductPricing/
 * resolvePolicyForProduct/prisma.$transaction/approvalService.createRequest,
 * todo contra prisma real) no es probable sin base de datos, mismo límite
 * de siempre en este módulo. setBranchPriceInBandTx/applyApprovedPriceOverrideTx
 * SÍ son probables — son los cuerpos transaccionales, extraídos igual que
 * upsertBranchProductSettingTx (set-branch-price.test.ts).
 */

test("Prueba 11 — margen sobre el mínimo → dentro de la banda (se aplicaría directo, sin solicitud)", () => {
  const result = decidePriceBandPath({ price: 150, cost: 100, minMarginPercent: 20 });
  // margen real: (150-100)/150 = 33.3%, por encima del 20% mínimo
  assert.equal(result.inBand, true);
  assert.ok(Math.abs(result.marginPercent - 33.33) < 0.01);
});

test("Prueba 12 (LA QUE IMPORTA) — margen bajo el mínimo → NO dentro de la banda (saldría a solicitud de aprobación)", () => {
  const result = decidePriceBandPath({ price: 105, cost: 100, minMarginPercent: 20 });
  // margen real: (105-100)/105 = 4.76%, muy por debajo del 20% mínimo
  assert.equal(result.inBand, false);
  assert.ok(result.marginPercent < 20);
});

test("margen EXACTAMENTE en el mínimo cuenta como dentro de la banda (>=, no >)", () => {
  // precio tal que el margen sea exactamente 20%: price = cost / (1 - 0.20)
  const price = 100 / 0.8;
  const result = decidePriceBandPath({ price, cost: 100, minMarginPercent: 20 });
  assert.equal(result.inBand, true);
});

test("Prueba 13 — sin costo conocido (política sin resolver a un costo real) usa el default virtual y no revienta: se trata como dentro de la banda", () => {
  // resolvePolicyForProduct ya devuelve el default virtual (minMarginPercent
  // del schema, 15) cuando no hay BranchCategoryPricingPolicy configurada —
  // acá se prueba que decidePriceBandPath no revienta con ese valor típico,
  // ni con costo null (producto sin costo cargado todavía).
  const withDefaultPolicy = decidePriceBandPath({ price: 100, cost: 60, minMarginPercent: 15 });
  assert.equal(withDefaultPolicy.inBand, true);

  const withoutCost = decidePriceBandPath({ price: 100, cost: null, minMarginPercent: 15 });
  assert.equal(withoutCost.inBand, true, "sin costo no hay margen que comparar contra la banda — no bloquea a una sucursal sin costo cargado");

  const withZeroCost = decidePriceBandPath({ price: 100, cost: 0, minMarginPercent: 15 });
  assert.equal(withZeroCost.inBand, true, "costo 0 se trata igual que costo desconocido, no como margen 100%");
});

/**
 * docs/AUDITORIA-MOTOR-PRECIOS-COSTOS.md, hallazgo #3 — setBranchPriceInBand
 * y applyApprovedPriceOverride escribían branchPrice con un upsert propio,
 * por fuera de setBranchPriceTx: nunca quedaba priceExceptionReason ni
 * priceExceptionAt, exactamente la "excepción sin motivo registrado" que
 * product-360 marca en rojo (docs/PUERTAS-DE-PRECIO.md, hallazgo abierto
 * que este test cierra). Mismo tx falso que set-branch-price.test.ts.
 */

type FakeSetting = {
  branchId: string;
  productId: string;
  branchPrice: Prisma.Decimal | null;
  marginPercent?: Prisma.Decimal | null;
  priceExceptionReason?: string | null;
  priceExceptionAt?: Date | null;
  priceSource?: string | null;
  lastPriceUpdateAt?: Date | null;
  priceUpdatedByUserId?: string | null;
};

function createFakeTx(opts: { settings?: FakeSetting[] }) {
  const settings = new Map((opts.settings ?? []).map((s) => [`${s.branchId}:${s.productId}`, s]));
  const auditLogs: Record<string, unknown>[] = [];

  const tx = {
    // Parte B.1 (prompt-precio-no-se-mueve-solo.md) — setBranchPriceTx
    // ahora audita TODA escritura de branchPrice (PRODUCT_PRICE_CHANGED),
    // que necesita el sku del producto.
    product: {
      findUnique: async () => ({ sku: "SKU-TEST" }),
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
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return data;
      },
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, settings, auditLogs };
}

const ACTOR = "user-1";

test("Finding #3 — setBranchPriceInBandTx escribe priceExceptionReason/priceExceptionAt (antes: upsert propio, sin excepción registrada)", async () => {
  const { tx, settings, auditLogs } = createFakeTx({});

  const result = await setBranchPriceInBandTx(tx, {
    branchId: "branch-1",
    productId: "product-1",
    price: 150,
    marginPercent: 33.33,
    minMarginPercent: 20,
    actorUserId: ACTOR,
  });

  const row = settings.get("branch-1:product-1")!;
  assert.equal(row.branchPrice?.toString(), "150");
  assert.equal(row.marginPercent?.toString(), "33.33", "marginPercent sigue siendo responsabilidad de este llamador, no de setBranchPriceTx");
  assert.ok(row.priceExceptionReason, "antes del fix esto quedaba null — la divergencia silenciosa que product-360 marcaba en rojo");
  assert.ok(row.priceExceptionAt instanceof Date);
  assert.equal(result.newPrice, 150);
  // Parte B.1 — setBranchPriceTx ahora también audita PRODUCT_PRICE_CHANGED
  // (el rastro genérico de "ninguna escritura de precio queda sin rastro"),
  // además de PRICE_SET_IN_BAND (el detalle propio de este flujo).
  assert.equal(auditLogs.length, 2);
  assert.equal((auditLogs[0] as { action: string }).action, "PRODUCT_PRICE_CHANGED");
  assert.equal((auditLogs[1] as { action: string }).action, "PRICE_SET_IN_BAND");
});

test("Finding #3 — setBranchPriceInBandTx con reason explícito lo usa tal cual (no el genérico)", async () => {
  const { tx, settings } = createFakeTx({});
  await setBranchPriceInBandTx(tx, {
    branchId: "branch-1",
    productId: "product-1",
    price: 150,
    marginPercent: 33.33,
    minMarginPercent: 20,
    reason: "Cliente mayorista pidió ajuste",
    actorUserId: ACTOR,
  });
  const row = settings.get("branch-1:product-1")!;
  assert.equal(row.priceExceptionReason, "Cliente mayorista pidió ajuste");
});

test("Finding #3 — applyApprovedPriceOverrideTx escribe priceExceptionReason con el motivo que viajó en el payload de la solicitud", async () => {
  const { tx, settings, auditLogs } = createFakeTx({});

  await applyApprovedPriceOverrideTx(tx, {
    branchId: "branch-1",
    productId: "product-1",
    price: 90,
    reason: "Precio bajo el margen mínimo de la categoría",
    actorUserId: ACTOR,
    requestId: "req-1",
  });

  const row = settings.get("branch-1:product-1")!;
  assert.equal(row.branchPrice?.toString(), "90");
  assert.equal(row.priceExceptionReason, "Precio bajo el margen mínimo de la categoría", "antes del fix esto quedaba null pese a que Master ya había visto y aprobado este motivo en la cola");
  assert.ok(row.priceExceptionAt instanceof Date);
  assert.equal(auditLogs.length, 2);
  assert.equal((auditLogs[0] as { action: string }).action, "PRODUCT_PRICE_CHANGED");
  assert.equal((auditLogs[1] as { action: string }).action, "PRICE_APPROVAL_APPLIED");
});
