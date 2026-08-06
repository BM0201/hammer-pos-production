import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { applyProductionCostsTx, resolveProductionPricing } from "@/modules/production/service";

/**
 * Producción v2 Fase 3 — el bug a matar: completeBatch calculaba
 * costs.unitCost y solo emitía advertencias; Product.standardSalePrice y
 * BranchProductSetting.branchCost/branchPrice NUNCA se tocaban. Este test
 * prueba que applyProductionCostsTx SIEMPRE escribe los 4 destinos (costo
 * del movimiento vía WAC — probado en inventory —, standardSalePrice,
 * branchCost, branchPrice) con auditoría antes→después.
 */

const BRANCH_ID = "branch-central";
const PRODUCT_ID = "prod-loseta-30x30";

function createFakeTx(initial: { standardSalePrice: number | null; branchCost: number | null; branchPrice: number | null }) {
  const product = { standardSalePrice: initial.standardSalePrice != null ? new Prisma.Decimal(initial.standardSalePrice) : null };
  let branchSetting: { branchCost: Prisma.Decimal | null; branchPrice: Prisma.Decimal | null } | null =
    initial.branchCost !== null ? { branchCost: new Prisma.Decimal(initial.branchCost), branchPrice: new Prisma.Decimal(initial.branchPrice ?? 0) } : null;
  const auditLogs: Array<Record<string, unknown>> = [];

  const tx = {
    product: {
      findUnique: async () => ({ standardSalePrice: product.standardSalePrice }),
      update: async (args: { data: { standardSalePrice: Prisma.Decimal } }) => {
        product.standardSalePrice = args.data.standardSalePrice;
        return product;
      },
    },
    branchProductSetting: {
      findUnique: async () => branchSetting,
      upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const data = (branchSetting ? args.update : args.create) as { branchCost: Prisma.Decimal; branchPrice?: Prisma.Decimal };
        if (!branchSetting) {
          branchSetting = { branchCost: data.branchCost, branchPrice: data.branchPrice ?? new Prisma.Decimal(0) };
        } else {
          Object.assign(branchSetting, data);
        }
        return branchSetting;
      },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        auditLogs.push(args.data);
        return args.data;
      },
    },
  };

  return {
    tx: tx as unknown as Prisma.TransactionClient,
    getProduct: () => product,
    getBranchSetting: () => branchSetting,
    auditLogs,
  };
}

test("Test de inyección: RECALC_TARGET_MARGIN escribe SIEMPRE costo y precio del producto terminado", async () => {
  const { tx, getProduct, getBranchSetting, auditLogs } = createFakeTx({
    standardSalePrice: 12,
    branchCost: 10.7,
    branchPrice: 12,
  });

  const result = await applyProductionCostsTx(tx, {
    actorUserId: "user-1",
    branchId: BRANCH_ID,
    finishedProductId: PRODUCT_ID,
    unitCostSaleUnit: new Prisma.Decimal(11.03),
    pricePolicy: "RECALC_TARGET_MARGIN",
    targetMarginPct: new Prisma.Decimal(0.3),
    roundingMultiple: new Prisma.Decimal(1),
    priceApprovalDeltaPct: new Prisma.Decimal(0.15),
  });

  // 11.03 / (1-0.3) = 15.757 -> redondeado hacia arriba = 16.
  assert.equal(getProduct().standardSalePrice?.toNumber(), 16, "Product.standardSalePrice debe actualizarse SIEMPRE, no solo advertirse");
  assert.equal(getBranchSetting()?.branchCost?.toNumber(), 11.03, "BranchProductSetting.branchCost debe reflejar el costo real del lote");
  assert.equal(getBranchSetting()?.branchPrice?.toNumber(), 16);
  assert.equal(result.priceApprovalRequired, false);
  assert.equal(result.before.branchCost, 10.7);
  assert.equal(result.after.branchCost, 11.03);
  assert.equal(auditLogs.length, 1, "debe quedar un evento de auditoría con antes->después");
  const logged = auditLogs[0].metadataJson as { before: { branchCost: number }; after: { branchCost: number } };
  assert.equal(logged.before.branchCost, 10.7);
  assert.equal(logged.after.branchCost, 11.03);
});

test("Test de inyección: KEEP_CURRENT actualiza el costo pero conserva el precio de venta", async () => {
  const { tx, getProduct, getBranchSetting } = createFakeTx({ standardSalePrice: 20, branchCost: 10, branchPrice: 20 });

  await applyProductionCostsTx(tx, {
    actorUserId: "user-1",
    branchId: BRANCH_ID,
    finishedProductId: PRODUCT_ID,
    unitCostSaleUnit: new Prisma.Decimal(15),
    pricePolicy: "KEEP_CURRENT",
    targetMarginPct: new Prisma.Decimal(0.3),
    roundingMultiple: new Prisma.Decimal(1),
    priceApprovalDeltaPct: new Prisma.Decimal(0.15),
  });

  assert.equal(getBranchSetting()?.branchCost?.toNumber(), 15, "el costo siempre se actualiza");
  assert.equal(getProduct().standardSalePrice?.toNumber(), 20, "el precio no se toca bajo KEEP_CURRENT");
  assert.equal(getBranchSetting()?.branchPrice?.toNumber(), 20);
});

test("Test de inyección: APPROVAL_IF_DELTA bloquea el precio si la desviación excede el umbral y no hay override", async () => {
  const { tx, getProduct, getBranchSetting } = createFakeTx({ standardSalePrice: 10, branchCost: 8, branchPrice: 10 });

  const result = await applyProductionCostsTx(tx, {
    actorUserId: "user-1",
    branchId: BRANCH_ID,
    finishedProductId: PRODUCT_ID,
    // Costo se dispara -> precio recalculado se desviaría muy por encima del 15% configurado.
    unitCostSaleUnit: new Prisma.Decimal(20),
    pricePolicy: "APPROVAL_IF_DELTA",
    targetMarginPct: new Prisma.Decimal(0.3),
    roundingMultiple: new Prisma.Decimal(1),
    priceApprovalDeltaPct: new Prisma.Decimal(0.15),
  });

  assert.equal(result.priceApprovalRequired, true);
  assert.equal(getBranchSetting()?.branchCost?.toNumber(), 20, "el costo se actualiza incluso si el precio queda pendiente de aprobación");
  assert.equal(getProduct().standardSalePrice?.toNumber(), 10, "el precio NO se aplica hasta que se apruebe");
  assert.equal(getBranchSetting()?.branchPrice?.toNumber(), 10);
});

test("Test de inyección: APPROVAL_IF_DELTA con motivo de override sí aplica el precio recalculado", async () => {
  const { tx, getProduct } = createFakeTx({ standardSalePrice: 10, branchCost: 8, branchPrice: 10 });

  const result = await applyProductionCostsTx(tx, {
    actorUserId: "user-1",
    branchId: BRANCH_ID,
    finishedProductId: PRODUCT_ID,
    unitCostSaleUnit: new Prisma.Decimal(20),
    pricePolicy: "APPROVAL_IF_DELTA",
    targetMarginPct: new Prisma.Decimal(0.3),
    roundingMultiple: new Prisma.Decimal(1),
    priceApprovalDeltaPct: new Prisma.Decimal(0.15),
    priceOverrideReason: "Aumento real de costo de cemento — aprobado por gerencia",
  });

  assert.equal(result.priceApprovalRequired, false);
  assert.ok(getProduct().standardSalePrice!.gt(10));
});

test("Test de inyección: producto sin BranchProductSetting previo crea el registro con costo/precio correctos", async () => {
  const { tx, getBranchSetting } = createFakeTx({ standardSalePrice: null, branchCost: null, branchPrice: null });

  await applyProductionCostsTx(tx, {
    actorUserId: "user-1",
    branchId: BRANCH_ID,
    finishedProductId: PRODUCT_ID,
    unitCostSaleUnit: new Prisma.Decimal(10.7),
    pricePolicy: "RECALC_TARGET_MARGIN",
    targetMarginPct: new Prisma.Decimal(0.3),
    roundingMultiple: new Prisma.Decimal(1),
    priceApprovalDeltaPct: new Prisma.Decimal(0.15),
  });

  assert.equal(getBranchSetting()?.branchCost?.toNumber(), 10.7);
  assert.ok(getBranchSetting()!.branchPrice!.gt(10.7));
});

test("resolveProductionPricing: KEEP_CURRENT conserva el precio actual sin importar el costo", () => {
  const { nextPrice, priceApprovalRequired } = resolveProductionPricing({
    pricePolicy: "KEEP_CURRENT",
    unitCost: new Prisma.Decimal(15),
    currentPrice: new Prisma.Decimal(20),
    targetMarginPct: new Prisma.Decimal(0.3),
    roundingMultiple: new Prisma.Decimal(1),
    priceApprovalDeltaPct: new Prisma.Decimal(0.15),
  });
  assert.equal(nextPrice.toNumber(), 20);
  assert.equal(priceApprovalRequired, false);
});

test("resolveProductionPricing: sin precio actual (producto nuevo) nunca requiere aprobación", () => {
  const { nextPrice, priceApprovalRequired } = resolveProductionPricing({
    pricePolicy: "APPROVAL_IF_DELTA",
    unitCost: new Prisma.Decimal(15),
    currentPrice: null,
    targetMarginPct: new Prisma.Decimal(0.3),
    roundingMultiple: new Prisma.Decimal(1),
    priceApprovalDeltaPct: new Prisma.Decimal(0.15),
  });
  assert.equal(priceApprovalRequired, false);
  assert.ok(nextPrice.gt(15));
});
