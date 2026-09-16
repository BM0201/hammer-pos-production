import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { getInputWacTx } from "@/modules/production/service";

/**
 * docs/WAC-DESACTIVADO.md — Producción de Materiales no estaba en el barrido
 * original (el doc la listaba como "fuera de alcance a propósito"), así que
 * con el flag apagado un WAC contaminado seguía colándose como costo del
 * insumo hacia adentro del producto terminado vía PRODUCTION_OUTPUT.
 *
 * isWacDrivesCostChainEnabled cachea en una variable a nivel de módulo (TTL
 * 60s) — igual que effective-pricing.test.ts documenta, ese cache es
 * compartido por TODO el proceso de este archivo. Por eso el flag=true se
 * prueba en un archivo APARTE (production-wac-gate-on.test.ts): node --test
 * corre cada archivo en su propio proceso, así que cada uno arranca con el
 * cache en null y lee su propio fake db, sin pisarse entre sí.
 */
function createFakeDb(fixtures: {
  weightedAverageCost: Prisma.Decimal;
  averageCost: Prisma.Decimal | null;
  globalCost: Prisma.Decimal | null;
  lastPurchaseCost: Prisma.Decimal | null;
  branchCost?: Prisma.Decimal | null;
}) {
  const db = {
    productStockGroupMember: { findFirst: async () => null },
    inventoryBalance: {
      findUnique: async () => ({ weightedAverageCost: fixtures.weightedAverageCost, quantityOnHand: new Prisma.Decimal(100) }),
    },
    systemSetting: { findUnique: async () => ({ value: "false" }) },
    product: {
      findUnique: async () => ({
        averageCost: fixtures.averageCost,
        globalCost: fixtures.globalCost,
        lastPurchaseCost: fixtures.lastPurchaseCost,
      }),
    },
    branchProductSetting: { findUnique: async () => (fixtures.branchCost !== undefined ? { branchCost: fixtures.branchCost } : null) },
    productionBatchInput: { findMany: async () => [] },
  };
  return db as unknown as Prisma.TransactionClient;
}

test("getInputWacTx con el flag apagado: insumo con WAC contaminado (C$470) pero averageCost sano (C$18) costea con el segundo", async () => {
  const db = createFakeDb({
    weightedAverageCost: new Prisma.Decimal(470),
    averageCost: new Prisma.Decimal(18),
    globalCost: null,
    lastPurchaseCost: null,
  });

  const { wacSaleUnit } = await getInputWacTx(db, { branchId: "branch-1", productId: "prod-cemento" });
  assert.equal(wacSaleUnit.toNumber(), 18, "debe usar averageCost (18), nunca el WAC contaminado (470)");
});

test("getInputWacTx con el flag apagado: sin averageCost, cae a globalCost; sin ninguno de los dos, a lastPurchaseCost", async () => {
  const dbGlobal = createFakeDb({
    weightedAverageCost: new Prisma.Decimal(470),
    averageCost: null,
    globalCost: new Prisma.Decimal(22),
    lastPurchaseCost: new Prisma.Decimal(25),
  });
  const resultGlobal = await getInputWacTx(dbGlobal, { branchId: "branch-1", productId: "prod-arena" });
  assert.equal(resultGlobal.wacSaleUnit.toNumber(), 22, "sin averageCost, cae a globalCost (22), no a lastPurchaseCost ni al WAC");

  const dbLastPurchase = createFakeDb({
    weightedAverageCost: new Prisma.Decimal(470),
    averageCost: null,
    globalCost: null,
    lastPurchaseCost: new Prisma.Decimal(25),
  });
  const resultLastPurchase = await getInputWacTx(dbLastPurchase, { branchId: "branch-1", productId: "prod-piedrin" });
  assert.equal(resultLastPurchase.wacSaleUnit.toNumber(), 25, "sin averageCost ni globalCost, cae a lastPurchaseCost (25)");
});

test("getInputWacTx con el flag apagado: branchCost explícito de esa sucursal gana sobre averageCost — misma prioridad que el resto del catálogo", async () => {
  const db = createFakeDb({
    weightedAverageCost: new Prisma.Decimal(470),
    averageCost: new Prisma.Decimal(18),
    globalCost: null,
    lastPurchaseCost: null,
    branchCost: new Prisma.Decimal(20),
  });

  const { wacSaleUnit } = await getInputWacTx(db, { branchId: "branch-1", productId: "prod-cemento" });
  assert.equal(wacSaleUnit.toNumber(), 20, "branchCost explícito de la sucursal gana sobre averageCost, igual que en effective-pricing.ts");
});
