import assert from "node:assert/strict";
import test from "node:test";
import { applySuggestedPrice } from "@/modules/pricing/service";

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
