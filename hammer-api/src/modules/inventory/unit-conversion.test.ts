import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateSharedStockChange,
  convertBaseQtyToSaleQty,
  convertSaleQtyToBaseQty,
  formatPackageLooseStock,
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

describe("package/loose shared stock availability", () => {
  it("shows auto-openable units while preserving one closed package", () => {
    const stock = formatPackageLooseStock({
      closedPackageQuantity: 6,
      looseUnitQuantity: 0,
      conversionFactor: 216,
      packageUnit: "KILO",
      baseUnit: "UNIDAD",
      minimumClosedPackageReserve: 1,
      autoOpenForUnitSale: true,
    });

    assert.equal(stock.closedPackageQuantity, 6);
    assert.equal(stock.looseUnitQuantity, 0);
    assert.equal(stock.autoOpenablePackages, 5);
    assert.equal(stock.autoOpenableUnitsTotal, 1080);
    assert.equal(stock.equivalentBaseQuantity, 1296);
    assert.equal(stock.minimumClosedPackageReserve, 1);
    assert.equal(stock.autoOpenForUnitSale, true);
  });

  it("does not expose auto-openable stock when only the closed reserve remains", () => {
    const stock = formatPackageLooseStock({
      closedPackageQuantity: 1,
      looseUnitQuantity: 0,
      conversionFactor: 216,
      packageUnit: "KILO",
      baseUnit: "UNIDAD",
      minimumClosedPackageReserve: 1,
      autoOpenForUnitSale: true,
    });

    assert.equal(stock.autoOpenablePackages, 0);
    assert.equal(stock.autoOpenableUnitsTotal, 0);
    assert.equal(stock.equivalentBaseQuantity, 216);
  });
});
