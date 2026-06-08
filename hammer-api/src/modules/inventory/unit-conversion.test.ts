import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateSharedStockChange,
  convertBaseQtyToSaleQty,
  convertSaleQtyToBaseQty,
  getIronBarsPerQuintal,
} from "@/modules/inventory/unit-conversion";

describe("iron shared stock conversions", () => {
  it("maps iron quintal products to the correct bar counts", () => {
    assert.equal(getIronBarsPerQuintal("HIERRO CORRUGADO 1/2"), 8);
    assert.equal(getIronBarsPerQuintal("HIERRO CORRUGADO 3/8"), 14);
    assert.equal(getIronBarsPerQuintal("HIERRO CORRUGADO 1/4"), 30);
    assert.equal(getIronBarsPerQuintal("HIERRO LISO"), null);
  });

  it("converts between quintales and varillas using the shared factor", () => {
    assert.equal(convertSaleQtyToBaseQty({ quantity: 2, conversionFactor: 8 }).toNumber(), 16);
    assert.equal(convertBaseQtyToSaleQty({ baseQuantity: 16, conversionFactor: 8 }).toNumber(), 2);
    assert.equal(convertBaseQtyToSaleQty({ baseQuantity: 15, conversionFactor: 8 }).toNumber(), 1.875);
  });

  it("sets physical stock in quintales by replacing the canonical varilla balance", () => {
    const change = calculateSharedStockChange({
      currentBaseQuantity: 16,
      enteredQuantity: 1,
      conversionFactor: 8,
      isBaseUnit: false,
      mode: "SET_PHYSICAL_STOCK",
    });

    assert.equal(change.enteredBaseQty.toNumber(), 8);
    assert.equal(change.finalBaseQty.toNumber(), 8);
    assert.equal(change.deltaBaseQty.toNumber(), -8);
    assert.equal(change.movementQuantity.toNumber(), 1);
  });

  it("adds opening stock in quintales onto the canonical varilla balance", () => {
    const change = calculateSharedStockChange({
      currentBaseQuantity: 16,
      enteredQuantity: 1,
      conversionFactor: 8,
      isBaseUnit: false,
      mode: "ADD_OPENING_STOCK",
    });

    assert.equal(change.enteredBaseQty.toNumber(), 8);
    assert.equal(change.finalBaseQty.toNumber(), 24);
    assert.equal(change.deltaBaseQty.toNumber(), 8);
    assert.equal(change.movementQuantity.toNumber(), 1);
  });

  it("keeps direct varilla quantities in base units", () => {
    const change = calculateSharedStockChange({
      currentBaseQuantity: 16,
      enteredQuantity: 3,
      conversionFactor: 8,
      isBaseUnit: true,
      mode: "ADD_TO_STOCK",
    });

    assert.equal(change.enteredBaseQty.toNumber(), 3);
    assert.equal(change.finalBaseQty.toNumber(), 19);
    assert.equal(change.deltaBaseQty.toNumber(), 3);
    assert.equal(change.movementQuantity.toNumber(), 3);
  });
});
