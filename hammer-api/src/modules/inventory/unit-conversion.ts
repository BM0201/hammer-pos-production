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

export function getIronBarsPerQuintal(productName: string): number | null {
  const name = normalize(productName);
  if (name.includes("1/2")) return 8;
  if (name.includes("3/8")) return 14;
  if (name.includes("1/4")) return 30;
  return null;
}

export function detectIronSaleUnit(productName: string): "VARILLA" | "QUINTAL" | null {
  const name = normalize(productName);
  if (name.startsWith("VARILLA HIERRO")) return "VARILLA";
  if (name.startsWith("HIERRO")) return "QUINTAL";
  return null;
}

export function ironStockGroupCode(productName: string): string | null {
  const name = normalize(productName);
  if (!name.includes("HIERRO")) return null;
  if (name.includes("1/2")) return "HIERRO_1_2";
  if (name.includes("3/8")) return "HIERRO_3_8";
  if (name.includes("1/4")) return "HIERRO_1_4";
  return null;
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
  baseUnit: string;
  saleUnit: string;
  closedPackageQuantity?: number | Prisma.Decimal | null;
  looseUnitQuantity?: number | Prisma.Decimal | null;
  packageUnit?: string | null;
  tracksPackages?: boolean;
  minimumClosedPackageReserve?: number | Prisma.Decimal | null;
  autoOpenForUnitSale?: boolean | null;
}) {
  const packageStock = input.tracksPackages && input.packageUnit
    ? formatPackageLooseStock({
        closedPackageQuantity: input.closedPackageQuantity ?? 0,
        looseUnitQuantity: input.looseUnitQuantity ?? input.baseQuantity,
        conversionFactor: input.conversionFactor,
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
