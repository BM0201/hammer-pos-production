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
 * Fusión de Inventario v2, Fase 2.3 — presets de familia como DATOS, no código.
 * Reemplaza los antiguos detectores hardcodeados de hierro/clavos
 * (getIronBarsPerQuintal, detectIronSaleUnit, ironStockGroupCode,
 * detectNailPackagePreset, NAIL_PACKAGE_PRESETS): el factor de conversión y la
 * unidad de cada familia son datos de catálogo, no lógica especial por
 * producto. El asistente de creación (Fase 2.1) los usa para sugerir
 * productos y precargar el factor; el usuario decide y confirma siempre.
 */
export type FusionPreset = {
  key: string;
  label: string;
  baseUnit: string;
  packageUnit: string;
  factor: number;
  approximateFactor: boolean;
  namePatterns: string[];
};

export const FUSION_PRESETS: FusionPreset[] = [
  { key: "clavo_acero_4", label: 'Clavo acero 4"', baseUnit: "UNIDAD", packageUnit: "KILO", factor: 80, approximateFactor: true, namePatterns: ["CLAVO", "ACERO", '4"'] },
  { key: "clavo_acero_3", label: 'Clavo acero 3"', baseUnit: "UNIDAD", packageUnit: "KILO", factor: 105, approximateFactor: true, namePatterns: ["CLAVO", "ACERO", '3"'] },
  { key: "clavo_acero_2_1_2", label: 'Clavo acero 2 1/2"', baseUnit: "UNIDAD", packageUnit: "KILO", factor: 142, approximateFactor: true, namePatterns: ["CLAVO", "ACERO", '2 1/2"'] },
  { key: "clavo_acero_2", label: 'Clavo acero 2"', baseUnit: "UNIDAD", packageUnit: "KILO", factor: 216, approximateFactor: true, namePatterns: ["CLAVO", "ACERO", '2"'] },
  { key: "clavo_acero_1_1_2", label: 'Clavo acero 1 1/2"', baseUnit: "UNIDAD", packageUnit: "KILO", factor: 308, approximateFactor: true, namePatterns: ["CLAVO", "ACERO", '1 1/2"'] },
  { key: "clavo_acero_1", label: 'Clavo acero 1"', baseUnit: "UNIDAD", packageUnit: "KILO", factor: 417, approximateFactor: true, namePatterns: ["CLAVO", "ACERO", '1"'] },
  { key: "hierro_1_2", label: 'Hierro 1/2"', baseUnit: "VARILLA", packageUnit: "QUINTAL", factor: 8, approximateFactor: false, namePatterns: ["HIERRO", "1/2"] },
  { key: "hierro_3_8", label: 'Hierro 3/8"', baseUnit: "VARILLA", packageUnit: "QUINTAL", factor: 14, approximateFactor: false, namePatterns: ["HIERRO", "3/8"] },
  { key: "hierro_1_4", label: 'Hierro 1/4"', baseUnit: "VARILLA", packageUnit: "QUINTAL", factor: 30, approximateFactor: false, namePatterns: ["HIERRO", "1/4"] },
];

/**
 * Encuentra el preset cuyo patrón de nombre coincide con el nombre del
 * producto. Cuando varios presets podrían coincidir (p.ej. "CLAVO ACERO 2
 * 1/2"" contiene la subcadena "2"" del preset de 2"), gana el patrón MÁS
 * específico (más largo) — mismo criterio que el detector viejo de clavos.
 */
export function matchFusionPreset(productName: string): FusionPreset | null {
  const name = normalize(productName);
  const longestPatternLength = (preset: FusionPreset) => Math.max(...preset.namePatterns.map((p) => p.length));
  const ordered = [...FUSION_PRESETS].sort((a, b) => longestPatternLength(b) - longestPatternLength(a));
  return ordered.find((preset) => preset.namePatterns.every((pattern) => name.includes(normalize(pattern)))) ?? null;
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

/**
 * Batch version of getProductStockConversion — resolves stock-group conversion
 * for many products in 1 query instead of 1-per-product. Used by hot loops
 * (Brain detectors, replenishment, commercial-intelligence) that previously
 * called getProductStockConversion once per item.
 */
export async function getProductStockConversionsBatch(
  db: DbClient,
  productIds: string[],
): Promise<Map<string, ProductStockConversion>> {
  const uniqueIds = [...new Set(productIds)];
  if (uniqueIds.length === 0) return new Map();

  const members = await db.productStockGroupMember.findMany({
    where: { productId: { in: uniqueIds }, isActive: true, stockGroup: { isActive: true } },
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

  const result = new Map<string, ProductStockConversion>();
  for (const member of members) {
    const canonical = member.stockGroup.products.find((item) => item.isCanonical) ?? member.stockGroup.products.find((item) => new Prisma.Decimal(item.conversionFactor).eq(1)) ?? member;
    result.set(member.productId, {
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
    });
  }
  return result;
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
