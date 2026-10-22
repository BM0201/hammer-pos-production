import assert from "node:assert/strict";
import test from "node:test";
import { applySuggestedPrice, createOperatingExpense } from "@/modules/pricing/service";

// prompt-caja-gastos-pos-cobro.md Commit 1 — el guard de OTHER+10 caracteres
// tira ANTES de cualquier `await prisma...` (ver service.ts), así que se
// puede testear directo contra el prisma real sin fake-db: nunca llega a
// intentar una conexión.
test("createOperatingExpense: OTHER con descripción corta (<10) rechaza sin tocar la DB", async () => {
  await assert.rejects(
    () => createOperatingExpense(
      { branchId: "clbranchxxxxxxxxxxxxxxxxxxx", category: "OTHER", description: "corto", amount: 100 },
      "clactorxxxxxxxxxxxxxxxxxxxx",
    ),
    /VALIDATION_ERROR.*10 caracteres/,
  );
});

test("pricing: applySuggestedPrice blocks non-applicable calculator result", async () => {
  await assert.rejects(
    () => applySuggestedPrice({
      actorUserId: "clactorxxxxxxxxxxxxxxxxxxxx",
      productId: "clproductxxxxxxxxxxxxxxxxxx",
      branchId: "clbranchxxxxxxxxxxxxxxxxxxx",
      applyScope: "BRANCH",
      suggestedPrice: 90,
      minPrice: 100,
      maxPrice: 95,
      totalInternalCost: 100,
      canApplyPrice: false,
      applyBlockReason: "MARKET_MAX_BELOW_MIN_PRICE",
      calculationSnapshot: {
        canApplyPrice: false,
        applyBlockReason: "MARKET_MAX_BELOW_MIN_PRICE",
      },
    }),
    /PRICE_APPLICATION_BLOCKED/,
  );
});
