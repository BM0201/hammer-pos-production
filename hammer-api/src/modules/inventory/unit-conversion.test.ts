import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateSharedStockChange,
  convertBaseQtyToSaleQty,
  convertSaleQtyToBaseQty,
  formatDualStock,
  formatPackageLooseStock,
  matchFusionPreset,
} from "@/modules/inventory/unit-conversion";

describe("matchFusionPreset — presets de familia como datos (Fase 2.3)", () => {
  it("mapea hierro por calibre al factor correcto (varillas por quintal)", () => {
    assert.equal(matchFusionPreset("HIERRO CORRUGADO 1/2")?.factor, 8);
    assert.equal(matchFusionPreset("HIERRO CORRUGADO 3/8")?.factor, 14);
    assert.equal(matchFusionPreset("HIERRO CORRUGADO 1/4")?.factor, 30);
    assert.equal(matchFusionPreset("HIERRO LISO"), null);
  });

  it("sufijos de tipo de prensado (9V, 12V, STD, SEMI, MM) no cambian el factor — el calibre es lo unico que importa", () => {
    assert.equal(matchFusionPreset("HIERRO DE 3/8 9V")?.factor, 14);
    assert.equal(matchFusionPreset("HIERRO DE 1/2 12V")?.factor, 8);
    assert.equal(matchFusionPreset("HIERRO 3/8 8MM")?.factor, 14);
    assert.equal(matchFusionPreset("HIERRO DE 1/4 5.5MM SEMI STD")?.factor, 30);
  });

  it("clavos: la medida mas especifica gana cuando una es subcadena de otra (2\" dentro de 2 1/2\")", () => {
    assert.equal(matchFusionPreset('CLAVO ACERO 2"')?.key, "clavo_acero_2");
    assert.equal(matchFusionPreset('CLAVO ACERO 2 1/2"')?.key, "clavo_acero_2_1_2");
    assert.equal(matchFusionPreset('CLAVO ACERO 1"')?.key, "clavo_acero_1");
    assert.equal(matchFusionPreset('CLAVO ACERO 1 1/2"')?.key, "clavo_acero_1_1_2");
  });

  it("no matchea productos que no son clavo/hierro", () => {
    assert.equal(matchFusionPreset("MARTILLO DE ACERO"), null);
    assert.equal(matchFusionPreset("CLAVO ACERO 5\""), null);
  });
});

describe("iron shared stock conversions (unit-agnostic helpers)", () => {
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

describe("nail KILO/UNIDAD conversion (factor 216)", () => {
  const FACTOR = 216;

  it("6 kilos × 216 = 1296 unidades base", () => {
    const baseQty = convertSaleQtyToBaseQty({ quantity: 6, conversionFactor: FACTOR });
    assert.equal(baseQty.toNumber(), 1296);
  });

  it("1296 unidades base = 6 kilos (sale qty)", () => {
    const saleQty = convertBaseQtyToSaleQty({ baseQuantity: 1296, conversionFactor: FACTOR });
    assert.equal(saleQty.toNumber(), 6);
  });

  it("1296 unidades base => 6 kilos cerrados + 0 sueltas", () => {
    const stock = formatPackageLooseStock({
      closedPackageQuantity: 6,
      looseUnitQuantity: 0,
      conversionFactor: FACTOR,
      packageUnit: "KILO",
      baseUnit: "UNIDAD",
    });
    assert.equal(stock.equivalentBaseQuantity, 1296);
    assert.equal(stock.closedPackageQuantity, 6);
    assert.equal(stock.looseUnitQuantity, 0);
  });

  it("1297 unidades base => 6 kilos cerrados + 1 suelta", () => {
    const stock = formatPackageLooseStock({
      closedPackageQuantity: 6,
      looseUnitQuantity: 1,
      conversionFactor: FACTOR,
      packageUnit: "KILO",
      baseUnit: "UNIDAD",
    });
    assert.equal(stock.equivalentBaseQuantity, 1297);
    assert.equal(stock.closedPackageQuantity, 6);
    assert.equal(stock.looseUnitQuantity, 1);
  });

  it("1300 unidades base => 6 kilos cerrados + 4 sueltas", () => {
    const stock = formatPackageLooseStock({
      closedPackageQuantity: 6,
      looseUnitQuantity: 4,
      conversionFactor: FACTOR,
      packageUnit: "KILO",
      baseUnit: "UNIDAD",
    });
    assert.equal(stock.equivalentBaseQuantity, 1300);
    assert.equal(stock.closedPackageQuantity, 6);
    assert.equal(stock.looseUnitQuantity, 4);
  });

  it("formatDualStock para producto canonical UNIDAD (factor=1) usa packageConversionFactor=216, no el factor=1", () => {
    const result = formatDualStock({
      baseQuantity: 1296,
      conversionFactor: 1,
      packageConversionFactor: FACTOR,
      baseUnit: "UNIDAD",
      saleUnit: "UNIDAD",
      closedPackageQuantity: 6,
      looseUnitQuantity: 0,
      packageUnit: "KILO",
      tracksPackages: true,
    });
    assert.equal(result.baseQuantity, 1296);
    assert.equal(result.saleQuantity, 1296);
    assert.notEqual(result.packageStock, null);
    assert.equal(result.packageStock!.equivalentBaseQuantity, 1296);
    assert.equal(result.packageStock!.closedPackageQuantity, 6);
    assert.equal(result.packageStock!.looseUnitQuantity, 0);
  });

  it("formatDualStock SIN packageConversionFactor usa el factor del producto (regresion: no debe romperse products normales)", () => {
    const result = formatDualStock({
      baseQuantity: 100,
      conversionFactor: 14,
      baseUnit: "VARILLA",
      saleUnit: "QUINTAL",
    });
    assert.equal(result.baseQuantity, 100);
    assert.ok(Math.abs(result.saleQuantity - 100 / 14) < 0.001);
  });

  it("formatDualStock: factor=1 del canonical SIN packageConversionFactor da equivalentBaseQuantity incorrecto (caso de regresion documentado)", () => {
    const withoutFix = formatDualStock({
      baseQuantity: 1296,
      conversionFactor: 1,
      baseUnit: "UNIDAD",
      saleUnit: "UNIDAD",
      closedPackageQuantity: 6,
      looseUnitQuantity: 0,
      packageUnit: "KILO",
      tracksPackages: true,
    });
    assert.equal(withoutFix.packageStock!.equivalentBaseQuantity, 6);
  });

  it("formatDualStock: con packageConversionFactor=216 el canonical UNIDAD muestra equivalente correcto de 1296", () => {
    const withFix = formatDualStock({
      baseQuantity: 1296,
      conversionFactor: 1,
      packageConversionFactor: FACTOR,
      baseUnit: "UNIDAD",
      saleUnit: "UNIDAD",
      closedPackageQuantity: 6,
      looseUnitQuantity: 0,
      packageUnit: "KILO",
      tracksPackages: true,
    });
    assert.equal(withFix.packageStock!.equivalentBaseQuantity, 1296);
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
