import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, ReturnedItemCondition, ReturnInventoryDestination } from "@prisma/client";
import { assertReturnItemDestination, calculateRefundableAmount } from "@/modules/sales-returns/service";

test("sales returns: good items must return to sellable inventory", () => {
  assert.doesNotThrow(() => assertReturnItemDestination({
    condition: ReturnedItemCondition.GOOD,
    inventoryDestination: ReturnInventoryDestination.SELLABLE,
  }));
  assert.throws(
    () => assertReturnItemDestination({
      condition: ReturnedItemCondition.GOOD,
      inventoryDestination: ReturnInventoryDestination.DAMAGED,
    }),
    /RETURN_ITEM_GOOD_MUST_GO_TO_SELLABLE/,
  );
});

test("sales returns: damaged items must return to damaged inventory", () => {
  assert.doesNotThrow(() => assertReturnItemDestination({
    condition: ReturnedItemCondition.DAMAGED,
    inventoryDestination: ReturnInventoryDestination.DAMAGED,
  }));
  assert.throws(
    () => assertReturnItemDestination({
      condition: ReturnedItemCondition.DAMAGED,
      inventoryDestination: ReturnInventoryDestination.SELLABLE,
    }),
    /RETURN_ITEM_DAMAGED_MUST_GO_TO_DAMAGED/,
  );
});

test("sales returns: not-returned items cannot affect inventory", () => {
  assert.doesNotThrow(() => assertReturnItemDestination({
    condition: ReturnedItemCondition.NOT_RETURNED,
    inventoryDestination: ReturnInventoryDestination.NONE,
  }));
  assert.throws(
    () => assertReturnItemDestination({
      condition: ReturnedItemCondition.NOT_RETURNED,
      inventoryDestination: ReturnInventoryDestination.SELLABLE,
    }),
    /RETURN_ITEM_NOT_RETURNED_MUST_GO_TO_NONE/,
  );
});

test("sales returns: refundable amount is proportional to returned quantity", () => {
  const amount = calculateRefundableAmount({
    quantity: new Prisma.Decimal(2),
    originalQuantity: new Prisma.Decimal(5),
    lineSubtotal: new Prisma.Decimal(500),
  });
  assert.equal(amount.toNumber(), 200);
});

test("sales returns: refundable amount rejects invalid original quantity", () => {
  assert.throws(
    () => calculateRefundableAmount({
      quantity: new Prisma.Decimal(1),
      originalQuantity: new Prisma.Decimal(0),
      lineSubtotal: new Prisma.Decimal(100),
    }),
    /INVALID_ORIGINAL_QUANTITY/,
  );
});
