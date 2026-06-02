import { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ProductStockConversion = {
  stockGroupId: string;
  stockGroupCode: string;
  stockGroupName: string;
  baseUnit: string;
  saleUnit: string;
  conversionFactor: Prisma.Decimal;
  canonicalProductId: string;
  isCanonical: boolean;
};

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
}) {
  return {
    baseQuantity: Number(new Prisma.Decimal(input.baseQuantity).toDecimalPlaces(4)),
    saleQuantity: Number(convertBaseQtyToSaleQty({ baseQuantity: input.baseQuantity, conversionFactor: input.conversionFactor }).toDecimalPlaces(4)),
    baseUnit: input.baseUnit,
    saleUnit: input.saleUnit,
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
    saleUnit: member.saleUnit,
    conversionFactor: member.conversionFactor,
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
