import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { mapSingleProductWithBranchInventory } from "./service";
import type { ProductStockConversion } from "@/modules/inventory/unit-conversion";

// Bug real reportado: en una fusión triple (Caja/Unidad/Libra), el stock
// disponible de "Libra" se mostraba igual al de "Unidad" — el mismo número
// de unidades base sin dividir por el factor propio de Libra. El canónico
// (Unidad, factor 1) "funcionaba" de pura coincidencia. Ver service.ts
// mapSingleProductWithBranchInventory → packageAvailableSaleStock.

const BRANCH_ID = "branch-1";

function baseProduct(id: string) {
  return {
    id,
    unit: "UNIDAD",
    standardSalePrice: new Prisma.Decimal(0),
    globalCost: null,
    averageCost: null,
    lastPurchaseCost: null,
    branchProductSettings: [] as never[],
    inventoryBalances: [] as never[],
    category: null,
  };
}

function conversionFor(input: {
  productId: string;
  saleUnit: string;
  conversionFactor: number;
  isCanonical: boolean;
  isPackagePresentation: boolean;
}): ProductStockConversion {
  return {
    stockGroupId: "group-clavo-acero",
    stockGroupCode: "CLAVO-2",
    stockGroupName: 'Clavo Acero 2"',
    baseUnit: "UNIDAD",
    packageUnit: "CAJA",
    saleUnit: input.saleUnit,
    conversionFactor: new Prisma.Decimal(input.conversionFactor),
    conversionFactorToBase: new Prisma.Decimal(500), // 1 Caja = 500 Unidades
    tracksPackages: true,
    approximateFactor: true,
    minimumClosedPackageReserve: new Prisma.Decimal(1),
    autoOpenForUnitSale: true,
    isPackagePresentation: input.isPackagePresentation,
    canonicalProductId: "prod-unidad",
    isCanonical: input.isCanonical,
  };
}

function balanceRow() {
  return {
    branchId: BRANCH_ID,
    productId: "prod-unidad",
    quantityOnHand: new Prisma.Decimal(1350),
    closedPackageQuantity: new Prisma.Decimal(2), // 2 cajas cerradas
    looseUnitQuantity: new Prisma.Decimal(850), // 850 unidades sueltas físicas
    weightedAverageCost: new Prisma.Decimal(10),
  };
}

test("Caja/Unidad/Libra: Unidad (canonico, factor 1) muestra el total suelto+abrible tal cual", () => {
  const conversion = conversionFor({ productId: "prod-unidad", saleUnit: "UNIDAD", conversionFactor: 1, isCanonical: true, isPackagePresentation: false });
  const mapped = mapSingleProductWithBranchInventory(baseProduct("prod-unidad"), BRANCH_ID, conversion, balanceRow());
  // autoOpenable = (2 - 1 reserva) * 500 = 500 → total suelto = 850 + 500 = 1350
  assert.equal(mapped.availableSaleStock, 1350);
});

test("Caja/Unidad/Libra: Libra (factor 100, no canonico) debe convertir a SU propia escala, no mostrar el crudo en Unidades", () => {
  const conversion = conversionFor({ productId: "prod-libra", saleUnit: "LIBRA", conversionFactor: 100, isCanonical: false, isPackagePresentation: false });
  const mapped = mapSingleProductWithBranchInventory(baseProduct("prod-libra"), BRANCH_ID, conversion, balanceRow());
  // Mismo total suelto en base (1350 unidades) / 100 unidades por libra = 13.5 libras.
  // Antes del fix esto devolvía 1350 (igual que Unidad) — el bug reportado.
  assert.equal(mapped.availableSaleStock, 13.5);
  assert.notEqual(mapped.availableSaleStock, 1350);
});

test("Caja/Unidad/Libra: Caja (empaque cerrado) sigue mostrando el conteo de cajas, sin conversion", () => {
  const conversion = conversionFor({ productId: "prod-caja", saleUnit: "CAJA", conversionFactor: 500, isCanonical: false, isPackagePresentation: true });
  const mapped = mapSingleProductWithBranchInventory(baseProduct("prod-caja"), BRANCH_ID, conversion, balanceRow());
  assert.equal(mapped.availableSaleStock, 2);
});

/* ── prompt-costos-precios-sucursal.md B3/B5 — vía mapSingleProductWithBranchInventory,
 * el camino real que usa el catálogo del POS (batchMapProductsWithBranchInventory
 * pasa canonicalProduct/canonicalBranchSetting exactamente así). ── */

test("Libra (factor 100, derivada): el costo efectivo sale del canónico × factor, IGNORA el globalCost de relleno propio del miembro (B3)", () => {
  const conversion = conversionFor({ productId: "prod-libra", saleUnit: "LIBRA", conversionFactor: 100, isCanonical: false, isPackagePresentation: false });
  const product = { ...baseProduct("prod-libra"), globalCost: new Prisma.Decimal(1) }; // relleno tecleado a mano en el miembro
  const canonicalProduct = { id: "prod-unidad", standardSalePrice: new Prisma.Decimal(30), globalCost: null, averageCost: null, lastPurchaseCost: null };
  const mapped = mapSingleProductWithBranchInventory(product, BRANCH_ID, conversion, balanceRow(), canonicalProduct, null);
  // balanceRow().weightedAverageCost = 10 (del canónico) × factor 100 = 1000 — NO 1.00.
  assert.equal(mapped.effectiveCost?.toNumber(), 1000);
  assert.notEqual(mapped.effectiveCost?.toNumber(), 1);
  assert.equal(mapped.isFusionMember, true);
});

test("Libra (factor 100, derivada): costSource es coherente con effectiveCost — mismo objeto, no dos resoluciones parcialmente pisadas (B5)", () => {
  const conversion = conversionFor({ productId: "prod-libra", saleUnit: "LIBRA", conversionFactor: 100, isCanonical: false, isPackagePresentation: false });
  const product = { ...baseProduct("prod-libra"), globalCost: new Prisma.Decimal(1) };
  const canonicalProduct = { id: "prod-unidad", standardSalePrice: new Prisma.Decimal(30), globalCost: null, averageCost: null, lastPurchaseCost: null };
  const mapped = mapSingleProductWithBranchInventory(product, BRANCH_ID, conversion, balanceRow(), canonicalProduct, null);
  // La fuente que se muestra (WAC_ESTIMATE, del canónico) tiene que corresponder
  // al número que efectivamente se usó — antes solo se pisaban effectiveCost y
  // weightedAverageCost, costSource podía quedar de la resolución vieja.
  assert.equal(mapped.costSource, "WAC_ESTIMATE");
  assert.equal(mapped.effectiveCost?.toNumber(), 1000);
});
