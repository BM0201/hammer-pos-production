import { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ProductStockConversion = {
  stockGroupId: string;
  stockGroupCode: string;
  stockGroupName: string;
  baseUnit: string;
  packageUnit: string | null;
  saleUnit: string;
  conversionFactor: Prisma.Decimal;
  conversionFactorToBase: Prisma.Decimal | null;
  tracksPackages: boolean;
  approximateFactor: boolean;
  minimumClosedPackageReserve: Prisma.Decimal;
  autoOpenForUnitSale: boolean;
  isPackagePresentation: boolean;
  canonicalProductId: string;
  isCanonical: boolean;
};

export const DEFAULT_MINIMUM_CLOSED_PACKAGE_RESERVE = 1;

function normalize(value: string) {
  return value.toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * Extracts the bars-per-quintal factor from a product name.
 *
 * Priority order:
 *  1. Explicit "XV" suffix (e.g., "9V" → 9, "12V" → 12, "14V" → 14).
 *     Products like "HIERRO DE 3/8 9V" have exactly 9 bars/quintal,
 *     which differs from the 3/8 STD default of 14.
 *  2. Standard defaults by gauge: 1/4 → 30, 3/8 → 14, 1/2 → 8.
 */
export function getIronBarsPerQuintal(productName: string): number | null {
  const name = normalize(productName);

  // Explicit bar count: e.g. "9V", "12V" (word boundary so "12V" ≠ "12VAR...")
  const vMatch = name.match(/\b(\d{1,3})V\b/);
  if (vMatch && vMatch[1]) {
    const count = parseInt(vMatch[1], 10);
    if (count >= 1 && count <= 100) return count;
  }

  // Standard defaults by gauge
  if (name.includes("1/2")) return 8;
  if (name.includes("3/8")) return 14;
  if (name.includes("1/4")) return 30;
  return null;
}

/**
 * Determines the sale unit from the product name.
 * Products named "VARILLA HIERRO …" are the canonical unit (1 VARILLA = base).
 * Products named "QUINTAL HIERRO …" are explicitly the quintal presentation.
 * Anything else starting with "HIERRO" defaults to QUINTAL (sold by quintal).
 */
export function detectIronSaleUnit(productName: string): "VARILLA" | "QUINTAL" | null {
  const name = normalize(productName);
  if (name.startsWith("VARILLA HIERRO") || name.startsWith("VARILLA DE HIERRO")) return "VARILLA";
  if (name.startsWith("QUINTAL HIERRO") || name.startsWith("QUINTAL DE HIERRO")) return "QUINTAL";
  if (name.includes("HIERRO")) return "QUINTAL";
  return null;
}

/**
 * Derives the stock-group code for an iron product.
 *
 * Rules (most-specific first):
 *  - Explicit "XV" → HIERRO_<gauge>_<X>V  (e.g., HIERRO_3_8_9V)
 *  - MM dimension  → HIERRO_<gauge>_<N>MM (e.g., HIERRO_3_8_8MM)
 *  - "STD"         → HIERRO_<gauge>_STD   (e.g., HIERRO_3_8_STD)
 *  - "SEMI"        → HIERRO_<gauge>_SEMI  (e.g., HIERRO_1_4_SEMI)
 *  - fallback      → HIERRO_<gauge>       (generic, for any un-suffixed variant)
 *
 * This ensures that different physical variants (9V vs 14V vs 8MM)
 * are placed in SEPARATE fusion groups with their own conversion factors,
 * rather than all being merged into a single HIERRO_3_8 group.
 */
export function ironStockGroupCode(productName: string): string | null {
  const name = normalize(productName);
  if (!name.includes("HIERRO")) return null;

  const sizeCode = name.includes("1/2") ? "1_2"
    : name.includes("3/8") ? "3_8"
    : name.includes("1/4") ? "1_4"
    : null;
  if (!sizeCode) return null;

  // 1. Explicit V suffix (most specific)
  const vMatch = name.match(/\b(\d{1,3})V\b/);
  if (vMatch && vMatch[1]) {
    const count = parseInt(vMatch[1], 10);
    if (count >= 1 && count <= 100) return `HIERRO_${sizeCode}_${count}V`;
  }

  // 2. MM dimension (e.g., 8MM, 5.5MM, 6MM → safe slug)
  const mmMatch = name.match(/\b(\d+(?:[._]\d+)?)MM\b/);
  if (mmMatch && mmMatch[1]) {
    const slug = mmMatch[1].replace(".", "_");
    return `HIERRO_${sizeCode}_${slug}MM`;
  }

  // 3. Named variants
  if (name.includes("SEMI")) return `HIERRO_${sizeCode}_SEMI`;
  if (name.includes("STD"))  return `HIERRO_${sizeCode}_STD`;

  return `HIERRO_${sizeCode}`;
}

export const NAIL_PACKAGE_PRESETS = [
  { key: "clavo_acero_4", label: 'Clavo acero 4"', measure: '4"', baseUnit: "UNIDAD", packageUnit: "KILO", factor: 80 },
  { key: "clavo_acero_3", label: 'Clavo acero 3"', measure: '3"', baseUnit: "UNIDAD", packageUnit: "KILO", factor: 105 },
  { key: "clavo_acero_2_1_2", label: 'Clavo acero 2 1/2"', measure: '2 1/2"', baseUnit: "UNIDAD", packageUnit: "KILO", factor: 142 },
  { key: "clavo_acero_2", label: 'Clavo acero 2"', measure: '2"', baseUnit: "UNIDAD", packageUnit: "KILO", factor: 216 },
  { key: "clavo_acero_1_1_2", label: 'Clavo acero 1 1/2"', measure: '1 1/2"', baseUnit: "UNIDAD", packageUnit: "KILO", factor: 308 },
  { key: "clavo_acero_1", label: 'Clavo acero 1"', measure: '1"', baseUnit: "UNIDAD", packageUnit: "KILO", factor: 417 },
] as const;

export function detectNailPackagePreset(productName: string) {
  const name = normalize(productName);
  if (!name.includes("CLAVO") || !name.includes("ACERO")) return null;
  const ordered = [...NAIL_PACKAGE_PRESETS].sort((a, b) => b.measure.length - a.measure.length);
  return ordered.find((preset) => name.includes(preset.measure.toUpperCase())) ?? null;
}

export function formatPackageLooseStock(input: {
  closedPackageQuantity: number | Prisma.Decimal;
  looseUnitQuantity: number | Prisma.Decimal;
  conversionFactor: number | Prisma.Decimal;
  packageUnit: string;
  baseUnit: string;
  minimumClosedPackageReserve?: number | Prisma.Decimal | null;
  autoOpenForUnitSale?: boolean | null;
}) {
  const closed = new Prisma.Decimal(input.closedPackageQuantity);
  const loose = new Prisma.Decimal(input.looseUnitQuantity);
  const factor = new Prisma.Decimal(input.conversionFactor);
  const reserve = new Prisma.Decimal(input.minimumClosedPackageReserve ?? DEFAULT_MINIMUM_CLOSED_PACKAGE_RESERVE);
  const autoOpenablePackages = Prisma.Decimal.max(0, closed.sub(reserve));
  const autoOpenableUnitsTotal = autoOpenablePackages.mul(factor);
  const equivalentBaseQuantity = closed.mul(factor).add(loose);
  return {
    closedPackageQuantity: Number(closed.toDecimalPlaces(4)),
    looseUnitQuantity: Number(loose.toDecimalPlaces(4)),
    minimumClosedPackageReserve: Number(reserve.toDecimalPlaces(4)),
    autoOpenForUnitSale: input.autoOpenForUnitSale ?? true,
    autoOpenablePackages: Number(autoOpenablePackages.toDecimalPlaces(4)),
    autoOpenableUnitsTotal: Number(autoOpenableUnitsTotal.toDecimalPlaces(4)),
    equivalentBaseQuantity: Number(equivalentBaseQuantity.toDecimalPlaces(4)),
    conversionFactor: Number(factor.toDecimalPlaces(4)),
    packageUnit: input.packageUnit,
    baseUnit: input.baseUnit,
  };
}

export function convertSaleQtyToBaseQty(input: { quantity: number | Prisma.Decimal; conversionFactor: number | Prisma.Decimal }) {
  return new Prisma.Decimal(input.quantity).mul(input.conversionFactor);
}

export function convertBaseQtyToSaleQty(input: { baseQuantity: number | Prisma.Decimal; conversionFactor: number | Prisma.Decimal }) {
  const factor = new Prisma.Decimal(input.conversionFactor);
  if (factor.lte(0)) return new Prisma.Decimal(0);
  return new Prisma.Decimal(input.baseQuantity).div(factor);
}

export function convertSaleUnitCostToBaseUnitCost(input: { saleUnitCost: number | Prisma.Decimal; conversionFactor: number | Prisma.Decimal }) {
  const factor = new Prisma.Decimal(input.conversionFactor);
  if (factor.lte(0)) return new Prisma.Decimal(input.saleUnitCost);
  return new Prisma.Decimal(input.saleUnitCost).div(factor);
}

export function convertBaseUnitCostToSaleUnitCost(input: { baseUnitCost: number | Prisma.Decimal; conversionFactor: number | Prisma.Decimal }) {
  return new Prisma.Decimal(input.baseUnitCost).mul(input.conversionFactor);
}

export function formatDualStock(input: {
  baseQuantity: number | Prisma.Decimal;
  conversionFactor: number | Prisma.Decimal;
  /**
   * Factor used exclusively for closed-package ↔ base-unit arithmetic.
   * When the canonical product (factor = 1) is displayed alongside a
   * package presentation (e.g., KILO = 216 UNIDADES), pass the group's
   * conversionFactorToBase here so that:
   *   equivalentBaseQuantity = closedPkg × 216 + loose
   * instead of the wrong:
   *   equivalentBaseQuantity = closedPkg × 1   + loose
   * Defaults to `conversionFactor` when omitted (backwards-compatible).
   */
  packageConversionFactor?: number | Prisma.Decimal | null;
  baseUnit: string;
  saleUnit: string;
  closedPackageQuantity?: number | Prisma.Decimal | null;
  looseUnitQuantity?: number | Prisma.Decimal | null;
  packageUnit?: string | null;
  tracksPackages?: boolean;
  minimumClosedPackageReserve?: number | Prisma.Decimal | null;
  autoOpenForUnitSale?: boolean | null;
}) {
  const pkgFactor = input.packageConversionFactor != null
    ? input.packageConversionFactor
    : input.conversionFactor;
  const packageStock = input.tracksPackages && input.packageUnit
    ? formatPackageLooseStock({
        closedPackageQuantity: input.closedPackageQuantity ?? 0,
        looseUnitQuantity: input.looseUnitQuantity ?? input.baseQuantity,
        conversionFactor: pkgFactor,
        packageUnit: input.packageUnit,
        baseUnit: input.baseUnit,
        minimumClosedPackageReserve: input.minimumClosedPackageReserve,
        autoOpenForUnitSale: input.autoOpenForUnitSale,
      })
    : null;
  return {
    baseQuantity: Number(new Prisma.Decimal(input.baseQuantity).toDecimalPlaces(4)),
    saleQuantity: Number(convertBaseQtyToSaleQty({ baseQuantity: input.baseQuantity, conversionFactor: input.conversionFactor }).toDecimalPlaces(4)),
    baseUnit: input.baseUnit,
    saleUnit: input.saleUnit,
    packageStock,
  };
}

export function calculateSharedStockChange(input: {
  currentBaseQuantity: number | Prisma.Decimal;
  enteredQuantity: number | Prisma.Decimal;
  conversionFactor?: number | Prisma.Decimal | null;
  isBaseUnit: boolean;
  mode: "SET_PHYSICAL_STOCK" | "ADD_TO_STOCK" | "ADD_OPENING_STOCK";
}) {
  const currentBaseQty = new Prisma.Decimal(input.currentBaseQuantity);
  const enteredQty = new Prisma.Decimal(input.enteredQuantity);
  const factor = new Prisma.Decimal(input.conversionFactor ?? 1);
  const enteredBaseQty = !input.isBaseUnit && factor.gt(0)
    ? convertSaleQtyToBaseQty({ quantity: enteredQty, conversionFactor: factor })
    : enteredQty;
  const finalBaseQty = input.mode === "SET_PHYSICAL_STOCK"
    ? enteredBaseQty
    : currentBaseQty.add(enteredBaseQty);
  const deltaBaseQty = finalBaseQty.sub(currentBaseQty);
  const movementQuantity = input.isBaseUnit || factor.lte(0)
    ? deltaBaseQty.abs()
    : convertBaseQtyToSaleQty({ baseQuantity: deltaBaseQty.abs(), conversionFactor: factor });

  return {
    enteredBaseQty,
    finalBaseQty,
    deltaBaseQty,
    movementQuantity,
  };
}

export async function getProductStockConversion(db: DbClient, productId: string): Promise<ProductStockConversion | null> {
  const member = await db.productStockGroupMember.findFirst({
    where: { productId, isActive: true, stockGroup: { isActive: true } },
    include: {
      stockGroup: {
        include: {
          products: {
            where: { isActive: true },
            select: { productId: true, isCanonical: true, conversionFactor: true },
            orderBy: [{ isCanonical: "desc" }, { conversionFactor: "asc" }],
          },
        },
      },
    },
  });
  if (!member) return null;
  const canonical = member.stockGroup.products.find((item) => item.isCanonical) ?? member.stockGroup.products.find((item) => new Prisma.Decimal(item.conversionFactor).eq(1)) ?? member;
  return {
    stockGroupId: member.stockGroupId,
    stockGroupCode: member.stockGroup.code,
    stockGroupName: member.stockGroup.name,
    baseUnit: member.stockGroup.baseUnit,
    packageUnit: member.stockGroup.packageUnit,
    saleUnit: member.saleUnit,
    conversionFactor: member.conversionFactor,
    conversionFactorToBase: member.stockGroup.conversionFactorToBase,
    tracksPackages: member.stockGroup.tracksPackages,
    approximateFactor: member.stockGroup.approximateFactor,
    minimumClosedPackageReserve: member.stockGroup.minimumClosedPackageReserve,
    autoOpenForUnitSale: member.stockGroup.autoOpenForUnitSale,
    isPackagePresentation: member.isPackagePresentation,
    canonicalProductId: canonical.productId,
    isCanonical: member.isCanonical,
  };
}

export async function resolveInventoryProductForMovement(db: DbClient, productId: string) {
  const conversion = await getProductStockConversion(db, productId);
  return {
    inventoryProductId: conversion?.canonicalProductId ?? productId,
    conversion,
  };
}

export async function getSharedInventoryBalance(db: DbClient, input: { branchId: string; productId: string }) {
  const resolved = await resolveInventoryProductForMovement(db, input.productId);
  const balance = await db.inventoryBalance.findUnique({
    where: { branchId_productId: { branchId: input.branchId, productId: resolved.inventoryProductId } },
  });
  return { ...resolved, balance };
}
