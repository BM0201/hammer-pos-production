import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { getInputWacTx } from "@/modules/production/service";

/**
 * docs/WAC-DESACTIVADO.md — con el flag PRENDIDO, getInputWacTx debe seguir
 * exactamente igual que siempre: WAC directo del balance, sin el fallback a
 * averageCost/globalCost/lastPurchaseCost. Ver production-wac-gate-off.test.ts
 * para por qué esto vive en su propio archivo (cache de isWacDrivesCostChainEnabled
 * a nivel de módulo, compartido por proceso — node --test aísla por archivo).
 */
function createFakeDb(fixtures: { weightedAverageCost: Prisma.Decimal; averageCost: Prisma.Decimal | null }) {
  const db = {
    productStockGroupMember: { findFirst: async () => null },
    inventoryBalance: {
      findUnique: async () => ({ weightedAverageCost: fixtures.weightedAverageCost, quantityOnHand: new Prisma.Decimal(100) }),
    },
    systemSetting: { findUnique: async () => ({ value: "true" }) },
    // No debería ni consultarse con el flag prendido — si getInputWacTx lo
    // llamara igual, este resultado (999) filtraría al test y lo haría fallar.
    product: { findUnique: async () => ({ averageCost: new Prisma.Decimal(999), globalCost: null, lastPurchaseCost: null }) },
    branchProductSetting: { findUnique: async () => null },
    productionBatchInput: { findMany: async () => [] },
  };
  return db as unknown as Prisma.TransactionClient;
}

test("getInputWacTx con el flag prendido: sigue usando WAC directo del balance, nunca averageCost", async () => {
  const db = createFakeDb({ weightedAverageCost: new Prisma.Decimal(470), averageCost: new Prisma.Decimal(18) });
  const { wacSaleUnit } = await getInputWacTx(db, { branchId: "branch-1", productId: "prod-cemento" });
  assert.equal(wacSaleUnit.toNumber(), 470, "con el flag prendido el comportamiento no cambió: WAC tal cual, sin fallback");
});
