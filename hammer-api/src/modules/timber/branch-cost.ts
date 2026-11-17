/** Costo por pie fijado por sucursal y existencias de madera en pies. */
import { prisma } from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import { Prisma as PrismaRuntime } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { calculateBoardFeet, roundFeet, roundMoney, type CubicationRow } from "./calculator";
import { getPricingConfig, updatePricingConfig } from "./pricing-config";
import { WOOD_CATEGORY_WHERE } from "./catalog-link";
import { parseWoodDimensions } from "@/modules/catalog/sku-generator";
import { getEffectiveProductPricingBatch } from "@/modules/catalog/effective-pricing";
import { branchProductScopeFilter, excludeDerivedStockGroupMembers } from "@/modules/catalog/service";

/* ══════════════════════════════════════════════════════════
   Costo por pie fijado por sucursal y existencias en pies
   ══════════════════════════════════════════════════════════ */

/** Largo en pies de un nombre del catálogo, donde el tercer número son varas: "2X4X6" = 16 pies. */
export function catalogLengthFeet(varas: number, cubicationTable: CubicationRow[]): number {
  return cubicationTable.find((row) => row.varas === varas)?.lengthFeet ?? varas;
}

type WoodMeasureSource = {
  name: string;
  timberProduct?: { thickness: Prisma.Decimal; width: Prisma.Decimal; length: Prisma.Decimal; varaLength: number } | null;
};

/** Medida y pies por pieza de un producto de madera: la registrada, o la de su nombre. null si no se puede leer. */
export function woodMeasureOf(product: WoodMeasureSource, cubicationTable: CubicationRow[]) {
  const registered = product.timberProduct;
  const parsed = registered ? null : parseWoodDimensions(product.name);
  const thickness = registered ? registered.thickness.toNumber() : parsed?.thicknessInches;
  const width = registered ? registered.width.toNumber() : parsed?.widthInches;
  const varaLength = registered ? registered.varaLength : parsed?.lengthFeet;
  if (!thickness || !width || !varaLength) return null;
  const lengthFeet = registered ? registered.length.toNumber() : catalogLengthFeet(varaLength, cubicationTable);
  return { thickness, width, varaLength, lengthFeet, boardFeet: calculateBoardFeet({ thickness, width, length: lengthFeet }) };
}

export type TimberBranchCostRow = {
  productId: string;
  timberProductId: string | null;
  sku: string;
  name: string;
  thickness: number;
  width: number;
  lengthFeet: number;
  varaLength: number;
  boardFeet: number;
  stock: number;
  totalFeet: number;
  currentCost: number | null;
  /** Pies por pieza × costo por pie. null si todavía no se escribió un costo por pie. */
  newCost: number | null;
  price: number | null;
};

export type TimberBranchCostPreview = {
  costPerFoot: number | null;
  rows: TimberBranchCostRow[];
  /** Productos de madera de la sucursal sin medida legible en el nombre: no reciben costo. */
  unreadable: string[];
  totals: { pieces: number; feet: number; currentValue: number; newValue: number; saleValue: number; belowCost: number };
  byBranch: Array<{ branchId: string; code: string; name: string; pieces: number; feet: number }>;
};

/** Totales de la sucursal. Con costo nuevo, "bajo costo" se mide contra él: es lo que verá el POS. */
export function summarizeTimberBranchCost(rows: TimberBranchCostRow[]): TimberBranchCostPreview["totals"] {
  const totals = { pieces: 0, feet: 0, currentValue: 0, newValue: 0, saleValue: 0, belowCost: 0 };
  for (const row of rows) {
    const cost = row.newCost ?? row.currentCost;
    totals.pieces += row.stock;
    totals.feet += row.totalFeet;
    totals.currentValue += row.stock * (row.currentCost ?? 0);
    totals.newValue += row.stock * (cost ?? 0);
    totals.saleValue += row.stock * (row.price ?? 0);
    if (cost !== null && row.price !== null && row.price < cost) totals.belowCost += 1;
  }
  return {
    pieces: totals.pieces,
    feet: roundFeet(totals.feet),
    currentValue: roundMoney(totals.currentValue),
    newValue: roundMoney(totals.newValue),
    saleValue: roundMoney(totals.saleValue),
    belowCost: totals.belowCost,
  };
}

/**
 * Lee la madera del inventario general (mismos saldos y mismo costo efectivo que el POS y
 * Catálogo e Inventario), sin una copia aparte. Los miembros derivados de una fusión se
 * excluyen: su stock y su costo viven en el canónico. Sin branchId solo arma el resumen.
 */
export async function previewTimberBranchCost(branchId: string | null, costPerFoot?: number): Promise<TimberBranchCostPreview> {
  if (branchId && !(await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } }))) {
    throw new Error("BRANCH_NOT_FOUND");
  }
  const { classification } = await getPricingConfig(branchId);
  const table = classification.cubicationTable;
  const baseWhere: Prisma.ProductWhereInput = { isActive: true, category: WOOD_CATEGORY_WHERE, ...excludeDerivedStockGroupMembers() };
  const [products, branches, scoped] = await Promise.all([
    prisma.product.findMany({
      where: baseWhere,
      select: {
        id: true,
        sku: true,
        name: true,
        timberProduct: { select: { id: true, thickness: true, width: true, length: true, varaLength: true } },
        inventoryBalances: { select: { branchId: true, quantityOnHand: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.branch.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    // Solo los productos de la sucursal: escribirle costo a otro crearía su fila y lo haría visible ahí.
    branchId ? prisma.product.findMany({ where: { ...baseWhere, AND: [branchProductScopeFilter(branchId)] }, select: { id: true } }) : [],
  ]);
  const measured = products.map((product) => ({ product, measure: woodMeasureOf(product, table) }));

  const byBranch = branches.map((branch) => {
    let pieces = 0;
    let feet = 0;
    for (const { product, measure } of measured) {
      const stock = product.inventoryBalances.find((balance) => balance.branchId === branch.id)?.quantityOnHand.toNumber() ?? 0;
      pieces += stock;
      feet += stock * (measure?.boardFeet ?? 0);
    }
    return { branchId: branch.id, code: branch.code, name: branch.name, pieces, feet: roundFeet(feet) };
  });

  const scopedIds = new Set(scoped.map((product) => product.id));
  const inScope = measured.filter(({ product }) => scopedIds.has(product.id));
  const pricing = branchId
    ? await getEffectiveProductPricingBatch(prisma, inScope.map(({ product }) => ({ branchId, productId: product.id })))
    : new Map<string, never>();

  const rows: TimberBranchCostRow[] = [];
  for (const { product, measure } of inScope) {
    if (!measure) continue;
    const effective = pricing.get(`${branchId}:${product.id}`);
    const stock = product.inventoryBalances.find((balance) => balance.branchId === branchId)?.quantityOnHand.toNumber() ?? 0;
    rows.push({
      productId: product.id,
      timberProductId: product.timberProduct?.id ?? null,
      sku: product.sku,
      name: product.name,
      thickness: measure.thickness,
      width: measure.width,
      lengthFeet: measure.lengthFeet,
      varaLength: measure.varaLength,
      boardFeet: roundFeet(measure.boardFeet),
      stock,
      totalFeet: roundFeet(stock * measure.boardFeet),
      currentCost: effective?.effectiveCost ? roundMoney(effective.effectiveCost.toNumber()) : null,
      newCost: costPerFoot ? roundMoney(measure.boardFeet * costPerFoot) : null,
      price: effective?.effectivePrice ? effective.effectivePrice.toNumber() : null,
    });
  }

  return {
    costPerFoot: costPerFoot ?? null,
    rows,
    unreadable: inScope.filter(({ measure }) => !measure).map(({ product }) => product.name),
    totals: summarizeTimberBranchCost(rows),
    byBranch,
  };
}

/**
 * Escribe el costo donde lo lee todo el sistema: branchCost (primero en la cadena de costo: margen
 * de cada venta nueva, Precios, POS) y el saldo de la sucursal (valor de inventario de Finanzas).
 * No toca ventas ni movimientos pasados: esos guardan el costo de su momento.
 */
export async function applyTimberBranchCostRowsTx(
  tx: Prisma.TransactionClient,
  input: { branchId: string; costPerFoot: number; rows: TimberBranchCostRow[]; userId?: string },
): Promise<number> {
  const rows = input.rows.filter((row) => row.newCost !== null);
  if (rows.length === 0) return 0;
  const productIds = rows.map((row) => row.productId);
  // Mismo candado que el checkout: una venta en medio dejaría inventoryValue con la cantidad vieja.
  await tx.$queryRaw`SELECT id FROM "InventoryBalance" WHERE "branchId" = ${input.branchId} AND "productId" = ANY(ARRAY[${PrismaRuntime.join(productIds)}]) ORDER BY id FOR UPDATE`;
  const balances = await tx.inventoryBalance.findMany({
    where: { branchId: input.branchId, productId: { in: productIds } },
    select: { id: true, productId: true, quantityOnHand: true, weightedAverageCost: true },
  });
  const balanceByProduct = new Map(balances.map((balance) => [balance.productId, balance]));

  for (const row of rows) {
    const cost = new Decimal(row.newCost as number);
    await tx.branchProductSetting.upsert({
      where: { branchId_productId: { branchId: input.branchId, productId: row.productId } },
      create: { branchId: input.branchId, productId: row.productId, branchCost: cost },
      update: { branchCost: cost },
    });
    const balance = balanceByProduct.get(row.productId);
    if (balance) {
      await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: { weightedAverageCost: cost, inventoryValue: balance.quantityOnHand.mul(cost) },
      });
    }
    if (row.timberProductId) {
      await tx.timberProduct.update({ where: { id: row.timberProductId }, data: { baseCost: cost } });
    }
    await tx.auditLog.create({
      data: {
        actorUserId: input.userId,
        branchId: input.branchId,
        module: "timber",
        action: "TIMBER_BRANCH_COST_FIXED",
        entityType: "Product",
        entityId: row.productId,
        metadataJson: { costPerFoot: input.costPerFoot, boardFeet: row.boardFeet, before: row.currentCost, after: row.newCost, previousWac: balance?.weightedAverageCost.toNumber() ?? null },
      },
    });
  }
  return rows.length;
}

/** Recalcula al escribir, como applyTimberSalePriceRecalc, y recuerda el valor en la config de la sucursal. */
export async function applyTimberBranchCost(branchId: string, costPerFoot: number, userId?: string): Promise<{ applied: number; preview: TimberBranchCostPreview }> {
  const preview = await previewTimberBranchCost(branchId, costPerFoot);
  const config = await getPricingConfig(branchId);
  const applied = await prisma.$transaction(async (tx) => {
    await updatePricingConfig(
      {
        costPerFoot,
        pricePerInchTabla: config.pricePerInchTabla,
        pricePerInchTablilla: config.pricePerInchTablilla,
        pricePerInchCuadro: config.pricePerInchCuadro,
      },
      userId,
      branchId,
      tx,
    );
    return applyTimberBranchCostRowsTx(tx, { branchId, costPerFoot, rows: preview.rows, userId });
  }, { timeout: 60000, maxWait: 10000 });
  return { applied, preview };
}
