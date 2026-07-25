import { prisma } from "@/lib/prisma";
import {
  calculateTimber,
  calculateTimberTrip,
  calculateReconciliation,
  calculateTargetMarginPrice,
  DEFAULT_PRICING,
  type TimberPricing,
  type TimberTripLineInput,
  type TimberPriceGroup,
} from "./calculator";
import type {
  CreateTimberProductInput,
  UpdateTimberProductInput,
  CreateTimberTripInput,
  UpdateTimberTripInput,
  UpdateTimberPricingConfigInput,
} from "./validators";
import { Decimal } from "@prisma/client/runtime/library";
import { createHash } from "crypto";
import { parseWoodDimensions } from "@/modules/catalog/sku-generator";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { createInventoryMovementTx } from "@/modules/inventory/service";
import type { Prisma, TimberTripLine } from "@prisma/client";

/** Default category used when auto-creating timber products on inventory injection. */
const TIMBER_CATEGORY_CODE = "MAD";
const TIMBER_CATEGORY_NAME = "Madera";

/** Find-or-create the "Madera" category used for auto-generated timber products. */
async function resolveTimberCategoryTx(tx: Prisma.TransactionClient): Promise<string> {
  const existing = await tx.category.findUnique({ where: { code: TIMBER_CATEGORY_CODE } });
  if (existing) return existing.id;
  const created = await tx.category.create({
    data: { code: TIMBER_CATEGORY_CODE, name: TIMBER_CATEGORY_NAME, isActive: true },
  });
  return created.id;
}

/**
 * Find-or-create the Product + TimberProduct IDENTITY that represents a given trip line
 * dimension. The SKU pattern matches createTimberProduct (`MAD-<GRP>-<T>x<W>x<L>`) so the same
 * physical measure always maps to the same inventory product across trips.
 *
 * Madera v2 Fase 2 — esta función SOLO resuelve identidad (encuentra o crea la fila). Los
 * costos/precios los escribe SIEMPRE applyTimberCostsTx, exista o no el producto — antes,
 * cuando el producto ya existía, esta función retornaba temprano sin actualizar nada, y del
 * segundo viaje en adelante TimberProduct.baseCost/sellingPrice, Product.standardSalePrice y el
 * BranchProductSetting de la sucursal destino quedaban congelados en los valores del primer viaje.
 */
async function resolveTimberProductIdentityTx(
  tx: Prisma.TransactionClient,
  line: TimberTripLine,
  pricing: TimberPricing,
): Promise<{ productId: string; timberProductId: string; isNewProduct: boolean }> {
  const calc = calculateTimber(
    { thickness: line.thicknessIn, width: line.widthIn, length: line.lengthIn },
    pricing,
  );
  const sku = `MAD-${calc.priceGroup.substring(0, 3)}-${line.thicknessIn}x${line.widthIn}x${line.lengthIn}`;

  // Already linked on the line → reuse it.
  if (line.timberProductId) {
    const existing = await tx.timberProduct.findUnique({ where: { id: line.timberProductId } });
    if (existing) return { productId: existing.productId, timberProductId: existing.id, isNewProduct: false };
  }

  // Existing product with the deterministic SKU → reuse it.
  const existingProduct = await tx.product.findUnique({
    where: { sku },
    include: { timberProduct: true },
  });
  if (existingProduct?.timberProduct) {
    return { productId: existingProduct.id, timberProductId: existingProduct.timberProduct.id, isNewProduct: false };
  }

  // Otherwise create both Product and TimberProduct. Costos/precios iniciales son
  // provisionales — applyTimberCostsTx los sobreescribe con los valores reales
  // inmediatamente después, siempre, en el mismo flujo que los productos existentes.
  const categoryId = await resolveTimberCategoryTx(tx);
  const product = existingProduct
    ?? (await tx.product.create({
      data: {
        sku,
        name: `Madera ${calc.priceGroup} ${line.thicknessIn}"×${line.widthIn}"×${calc.varaLength} pies`,
        description: `Madera ${calc.priceGroup} — ${line.thicknessIn}"×${line.widthIn}"×${calc.varaLength} pies — ${calc.boardFeet} pies tablares`,
        categoryId,
        unit: "pieza",
        isActive: true,
        allowsFraction: false,
        isTimber: true,
        standardSalePrice: new Decimal(calc.sellingPrice),
      },
    }));

  const timberProduct = await tx.timberProduct.create({
    data: {
      productId: product.id,
      timberType: calc.priceGroup,
      thickness: new Decimal(line.thicknessIn),
      width: new Decimal(line.widthIn),
      length: new Decimal(line.lengthIn),
      boardFeet: new Decimal(calc.boardFeet),
      baseCost: new Decimal(calc.baseCost),
      pricePerInch: new Decimal(calc.pricePerInch),
      sellingPrice: new Decimal(calc.sellingPrice),
      varaLength: calc.varaLength,
    },
  });

  return { productId: product.id, timberProductId: timberProduct.id, isNewProduct: true };
}

export type TimberCostInjectionSnapshot = {
  baseCost: number | null;
  sellingPrice: number | null;
  standardSalePrice: number | null;
  branchCost: number | null;
  branchPrice: number | null;
};

/**
 * Resuelve el precio de venta según la política del viaje (Madera v2 Fase 2.3).
 *   RECALC_FROM_PRICE_PER_INCH → precio calculado con el precio por pulgada vigente (default).
 *   COST_ONLY                  → conserva el precio de venta actual (no lo toca).
 *   TARGET_MARGIN               → costPerPiece / (1 − margenObjetivo), redondeado hacia arriba.
 */
export function resolveSellingPriceForPolicy(input: {
  pricePolicy: string;
  recalculatedSellingPrice: number;
  existingSellingPrice: number | null;
  costPerPiece: number;
  targetMarginPercent: number;
  targetMarginRoundingMultiple: number;
}): number {
  switch (input.pricePolicy) {
    case "COST_ONLY":
      return input.existingSellingPrice ?? input.recalculatedSellingPrice;
    case "TARGET_MARGIN":
      return calculateTargetMarginPrice(input.costPerPiece, input.targetMarginPercent, input.targetMarginRoundingMultiple);
    case "RECALC_FROM_PRICE_PER_INCH":
    default:
      return input.recalculatedSellingPrice;
  }
}

/**
 * Escribe SIEMPRE los 4 costos/precios de una medida de madera — exista o no el producto.
 * Este es el corazón del fix de Fase 2: antes del segundo viaje en adelante estos valores
 * quedaban congelados. Ahora cada confirmación los actualiza y deja un evento de auditoría
 * con el antes → después de los 4 valores.
 */
export async function applyTimberCostsTx(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId?: string;
    branchId: string;
    productId: string;
    timberProductId: string;
    priceGroup: TimberPriceGroup;
    boardFeet: number;
    pricePerInch: number;
    varaLength: number;
    costPerPiece: number;
    recalculatedSellingPrice: number;
    pricePolicy: string;
    targetMarginPercent: number;
    targetMarginRoundingMultiple: number;
  },
): Promise<{ before: TimberCostInjectionSnapshot; after: TimberCostInjectionSnapshot }> {
  const [productBefore, timberProductBefore, branchSettingBefore] = await Promise.all([
    tx.product.findUnique({ where: { id: input.productId }, select: { standardSalePrice: true } }),
    tx.timberProduct.findUnique({ where: { id: input.timberProductId }, select: { baseCost: true, sellingPrice: true } }),
    tx.branchProductSetting.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      select: { branchCost: true, branchPrice: true },
    }),
  ]);

  const before: TimberCostInjectionSnapshot = {
    baseCost: timberProductBefore?.baseCost.toNumber() ?? null,
    sellingPrice: timberProductBefore?.sellingPrice.toNumber() ?? null,
    standardSalePrice: productBefore?.standardSalePrice.toNumber() ?? null,
    branchCost: branchSettingBefore?.branchCost?.toNumber() ?? null,
    branchPrice: branchSettingBefore?.branchPrice?.toNumber() ?? null,
  };

  const sellingPrice = resolveSellingPriceForPolicy({
    pricePolicy: input.pricePolicy,
    recalculatedSellingPrice: input.recalculatedSellingPrice,
    existingSellingPrice: before.sellingPrice,
    costPerPiece: input.costPerPiece,
    targetMarginPercent: input.targetMarginPercent,
    targetMarginRoundingMultiple: input.targetMarginRoundingMultiple,
  });

  await tx.timberProduct.update({
    where: { id: input.timberProductId },
    data: {
      timberType: input.priceGroup,
      boardFeet: new Decimal(input.boardFeet),
      baseCost: new Decimal(input.costPerPiece),
      pricePerInch: new Decimal(input.pricePerInch),
      sellingPrice: new Decimal(sellingPrice),
      varaLength: input.varaLength,
    },
  });

  await tx.product.update({
    where: { id: input.productId },
    data: { standardSalePrice: new Decimal(sellingPrice) },
  });

  await tx.branchProductSetting.upsert({
    where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
    create: {
      branchId: input.branchId,
      productId: input.productId,
      branchCost: new Decimal(input.costPerPiece),
      branchPrice: new Decimal(sellingPrice),
      priceSource: "TIMBER_TRIP",
      lastPriceUpdateAt: new Date(),
      priceUpdatedByUserId: input.actorUserId,
    },
    update: {
      branchCost: new Decimal(input.costPerPiece),
      branchPrice: new Decimal(sellingPrice),
      priceSource: "TIMBER_TRIP",
      lastPriceUpdateAt: new Date(),
      priceUpdatedByUserId: input.actorUserId,
    },
  });

  const after: TimberCostInjectionSnapshot = {
    baseCost: input.costPerPiece,
    sellingPrice,
    standardSalePrice: sellingPrice,
    branchCost: input.costPerPiece,
    branchPrice: sellingPrice,
  };

  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "timber",
      action: "TIMBER_COST_INJECTED",
      entityType: "Product",
      entityId: input.productId,
      metadataJson: { timberProductId: input.timberProductId, before, after },
    },
  });

  return { before, after };
}

/* ══════════════════════════════════════════════════════════
   Pricing Config
   ══════════════════════════════════════════════════════════ */

/** Get current pricing config (or return defaults) */
export async function getPricingConfig(): Promise<TimberPricing> {
  const cfg = await prisma.timberPricingConfig.findFirst({
    orderBy: { updatedAt: "desc" },
  });
  if (!cfg) return { ...DEFAULT_PRICING };
  return {
    costPerFoot: cfg.costPerFoot.toNumber(),
    pricePerInchTabla: cfg.pricePerInchTabla.toNumber(),
    pricePerInchTablilla: cfg.pricePerInchTablilla.toNumber(),
    pricePerInchCuadro: cfg.pricePerInchCuadro.toNumber(),
  };
}

/** Update pricing config */
export async function updatePricingConfig(input: UpdateTimberPricingConfigInput, userId?: string) {
  // Upsert — only one config record
  const existing = await prisma.timberPricingConfig.findFirst();
  if (existing) {
    return prisma.timberPricingConfig.update({
      where: { id: existing.id },
      data: {
        costPerFoot: new Decimal(input.costPerFoot),
        pricePerInchTabla: new Decimal(input.pricePerInchTabla),
        pricePerInchTablilla: new Decimal(input.pricePerInchTablilla),
        pricePerInchCuadro: new Decimal(input.pricePerInchCuadro),
        updatedBy: userId,
      },
    });
  }
  return prisma.timberPricingConfig.create({
    data: {
      costPerFoot: new Decimal(input.costPerFoot),
      pricePerInchTabla: new Decimal(input.pricePerInchTabla),
      pricePerInchTablilla: new Decimal(input.pricePerInchTablilla),
      pricePerInchCuadro: new Decimal(input.pricePerInchCuadro),
      updatedBy: userId,
    },
  });
}

/* ══════════════════════════════════════════════════════════
   Timber Products CRUD
   ══════════════════════════════════════════════════════════ */

export async function createTimberProduct(input: CreateTimberProductInput) {
  const pricing = await getPricingConfig();
  const calc = calculateTimber(
    { thickness: input.thickness, width: input.width, length: input.length },
    pricing,
  );

  const sku = input.sku || `MAD-${calc.priceGroup.substring(0, 3)}-${input.thickness}x${input.width}x${input.length}`;

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        sku,
        name: input.name,
        description: `Madera ${calc.priceGroup} — ${input.thickness}"×${input.width}"×${calc.varaLength} pies — ${calc.boardFeet} pies tablares`,
        categoryId: input.categoryId,
        unit: "pieza",
        isActive: true,
        allowsFraction: false,
        isTimber: true,
        standardSalePrice: new Decimal(calc.sellingPrice),
      },
    });

    const timberProduct = await tx.timberProduct.create({
      data: {
        productId: product.id,
        timberType: calc.priceGroup,
        thickness: new Decimal(input.thickness),
        width: new Decimal(input.width),
        length: new Decimal(input.length),
        boardFeet: new Decimal(calc.boardFeet),
        baseCost: new Decimal(calc.baseCost),
        pricePerInch: new Decimal(calc.pricePerInch),
        sellingPrice: new Decimal(calc.sellingPrice),
        varaLength: calc.varaLength,
      },
    });

    return { product, timberProduct, calculation: calc };
  });

  return result;
}

export async function updateTimberProduct(id: string, input: UpdateTimberProductInput) {
  const existing = await prisma.timberProduct.findUnique({
    where: { id },
    include: { product: true },
  });
  if (!existing) throw new Error("TIMBER_PRODUCT_NOT_FOUND");

  const pricing = await getPricingConfig();
  const thickness = input.thickness ?? existing.thickness.toNumber();
  const width = input.width ?? existing.width.toNumber();
  const length = input.length ?? existing.length.toNumber();

  const calc = calculateTimber({ thickness, width, length }, pricing);

  const result = await prisma.$transaction(async (tx) => {
    const timberProduct = await tx.timberProduct.update({
      where: { id },
      data: {
        timberType: calc.priceGroup,
        thickness: new Decimal(thickness),
        width: new Decimal(width),
        length: new Decimal(length),
        boardFeet: new Decimal(calc.boardFeet),
        baseCost: new Decimal(calc.baseCost),
        pricePerInch: new Decimal(calc.pricePerInch),
        sellingPrice: new Decimal(calc.sellingPrice),
        varaLength: calc.varaLength,
      },
    });

    await tx.product.update({
      where: { id: existing.productId },
      data: {
        ...(input.name ? { name: input.name } : {}),
        description: `Madera ${calc.priceGroup} — ${thickness}"×${width}"×${calc.varaLength} pies — ${calc.boardFeet} pies tablares`,
        standardSalePrice: new Decimal(calc.sellingPrice),
      },
    });

    return { timberProduct, calculation: calc };
  });

  return result;
}

export async function getTimberProduct(id: string) {
  const tp = await prisma.timberProduct.findUnique({
    where: { id },
    include: { product: { include: { category: true } } },
  });
  if (!tp) return null;

  const pricing = await getPricingConfig();
  const calc = calculateTimber(
    { thickness: tp.thickness.toNumber(), width: tp.width.toNumber(), length: tp.length.toNumber() },
    pricing,
  );

  return { ...tp, calculation: calc };
}

export async function listTimberProducts(filters?: {
  timberType?: string;
  search?: string;
  branchId?: string;
  page?: number;
  limit?: number;
}) {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (filters?.timberType) where.timberType = filters.timberType;
  if (filters?.search) {
    where.product = {
      OR: [
        { name: { contains: filters.search } },
        { sku: { contains: filters.search } },
      ],
    };
  }

  const [timberItems, timberTotal] = await Promise.all([
    prisma.timberProduct.findMany({
      where,
      include: { product: { include: { category: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.timberProduct.count({ where }),
  ]);

  const timberProductIds = timberItems.map((item) => item.productId);
  const catalogWhere = {
    isActive: true,
    ...(timberProductIds.length > 0 ? { id: { notIn: timberProductIds } } : {}),
    category: {
      OR: [
        { code: { startsWith: "MAD" } },
        { name: { contains: "Madera" } },
        { name: { contains: "madera" } },
      ],
    },
    ...(filters?.search
      ? {
          OR: [
            { name: { contains: filters.search } },
            { sku: { contains: filters.search } },
          ],
        }
      : {}),
  };

  const catalogProducts = await prisma.product.findMany({
    where: catalogWhere,
    include: {
      category: true,
      inventoryBalances: filters?.branchId
        ? { where: { branchId: filters.branchId }, select: { quantityOnHand: true, weightedAverageCost: true } }
        : { select: { quantityOnHand: true, weightedAverageCost: true } },
    },
    orderBy: { name: "asc" },
    take: 1000,
  });

  const mappedTimber = timberItems.map((item) => ({
    id: item.id,
    catalogProductId: item.productId,
    isCatalogOnly: false,
    timberType: item.timberType,
    woodSubtype: item.timberType,
    thickness: item.thickness.toString(),
    width: item.width.toString(),
    length: item.length.toString(),
    varaLength: item.varaLength,
    boardFeet: item.boardFeet.toString(),
    baseCost: item.baseCost.toString(),
    sellingPrice: item.sellingPrice.toString(),
    product: item.product,
    detectedDimensions: {
      thicknessInches: item.thickness.toNumber(),
      widthInches: item.width.toNumber(),
      lengthFeet: item.length.toNumber(),
      subtype: item.timberType,
    },
  }));

  const mappedCatalog = await Promise.all(catalogProducts.map(async (product) => {
    const detected = parseWoodDimensions(product.name);
    if (filters?.timberType && detected.subtype !== filters.timberType) return null;
    const effective = filters?.branchId
      ? await getEffectiveProductPricing(prisma, { branchId: filters.branchId, productId: product.id })
      : null;
    const stockOnHand = product.inventoryBalances.reduce((sum, balance) => sum + balance.quantityOnHand.toNumber(), 0);
    const weightedCost = product.inventoryBalances.find((balance) => balance.weightedAverageCost.toNumber() > 0)?.weightedAverageCost.toNumber() ?? null;
    const effectiveCost = effective?.effectiveCost === null || effective?.effectiveCost === undefined
      ? weightedCost
      : Number(effective.effectiveCost);
    const effectivePrice = effective
      ? (effective.effectivePrice === null ? null : Number(effective.effectivePrice))
      : product.standardSalePrice.toNumber();
    const thickness = detected.thicknessInches ?? 0;
    const width = detected.widthInches ?? 0;
    const length = detected.lengthFeet ?? 0;
    const boardFeet = thickness > 0 && width > 0 && length > 0 ? (thickness * width * length) / 12 : 0;
    return {
      id: `catalog:${product.id}`,
      catalogProductId: product.id,
      isCatalogOnly: true,
      timberType: detected.subtype ?? "OTRO",
      woodSubtype: detected.subtype ?? "OTRO",
      thickness: String(thickness),
      width: String(width),
      length: String(length),
      varaLength: length,
      boardFeet: String(boardFeet),
      baseCost: String(effectiveCost ?? 0),
      sellingPrice: effectivePrice === null ? "" : String(effectivePrice),
      stockOnHand,
      effectiveCost,
      effectivePrice,
      priceSource: effective?.priceSource ?? "MISSING",
      costSource: effective?.costSource ?? (weightedCost !== null ? "WAC" : "NONE"),
      product,
      detectedDimensions: detected,
      warnings: [
        ...(effectiveCost === null ? ["Producto de madera sin costo efectivo."] : []),
        ...(effectivePrice === null || effectivePrice <= 0 ? ["Producto de madera sin precio de venta."] : []),
        ...(boardFeet <= 0 ? ["No se pudieron inferir dimensiones desde el nombre."] : []),
      ],
    };
  }));

  const items = [...mappedTimber, ...mappedCatalog.filter((item): item is NonNullable<typeof item> => item !== null)];
  const total = timberTotal + mappedCatalog.filter((item) => item !== null).length;
  const pageItems = items.slice(0, limit);

  return { items: pageItems, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function deleteTimberProduct(id: string) {
  const existing = await prisma.timberProduct.findUnique({ where: { id } });
  if (!existing) throw new Error("TIMBER_PRODUCT_NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    await tx.timberProduct.delete({ where: { id } });
    await tx.product.update({
      where: { id: existing.productId },
      data: { isActive: false },
    });
  });

  return { success: true };
}

/* ══════════════════════════════════════════════════════════
   Timber Trips (Viajes de Madera)
   ══════════════════════════════════════════════════════════ */

/** Generate next trip code */
async function generateTripCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `VJM-${year}-`;

  const lastTrip = await prisma.timberTrip.findFirst({
    where: { tripCode: { startsWith: prefix } },
    orderBy: { tripCode: "desc" },
  });

  const lastNum = lastTrip ? parseInt(lastTrip.tripCode.replace(prefix, ""), 10) || 0 : 0;
  return `${prefix}${String(lastNum + 1).padStart(3, "0")}`;
}

/** Create a new timber trip with lines */
export async function createTimberTrip(input: CreateTimberTripInput, userId?: string) {
  const pricing = await getPricingConfig();
  const tripPricing: TimberPricing = {
    costPerFoot: pricing.costPerFoot,
    pricePerInchTabla: input.pricePerInchTabla ?? pricing.pricePerInchTabla,
    pricePerInchTablilla: input.pricePerInchTablilla ?? pricing.pricePerInchTablilla,
    pricePerInchCuadro: input.pricePerInchCuadro ?? pricing.pricePerInchCuadro,
  };

  // Calculate trip
  const tripLines: TimberTripLineInput[] = input.lines.map((l) => ({
    thickness: l.thickness,
    width: l.width,
    length: l.length,
    pieces: l.pieces,
    priceGroup: l.priceGroup,
  }));

  const calc = calculateTimberTrip(tripLines, input.woodTripTotalCost, tripPricing, {
    costPerFootInput: input.costPerFoot,
    expenses: input.expenses,
  });
  const tripCode = await generateTripCode();

  const trip = await prisma.$transaction(async (tx) => {
    const newTrip = await tx.timberTrip.create({
      data: {
        tripCode,
        destinationBranchId: input.destinationBranchId,
        status: "DRAFT",
        woodTripTotalCost: new Decimal(calc.totals.woodTripTotalCost),
        computedCostPerFoot: new Decimal(calc.totals.computedCostPerFoot),
        freightAmount: new Decimal(input.expenses?.freightAmount ?? 0),
        fuelAmount: new Decimal(input.expenses?.fuelAmount ?? 0),
        perDiemAmount: new Decimal(input.expenses?.perDiemAmount ?? 0),
        permitsAmount: new Decimal(input.expenses?.permitsAmount ?? 0),
        otherExpensesAmount: new Decimal(input.expenses?.otherExpensesAmount ?? 0),
        tripExpensesTotal: new Decimal(calc.totals.tripExpensesTotal),
        landedCostPerFoot: new Decimal(calc.totals.landedCostPerFoot),
        invoicedFeet: input.invoicedFeet != null ? new Decimal(input.invoicedFeet) : null,
        pricePolicy: input.pricePolicy ?? "RECALC_FROM_PRICE_PER_INCH",
        pricePerInchTabla: new Decimal(tripPricing.pricePerInchTabla),
        pricePerInchTablilla: new Decimal(tripPricing.pricePerInchTablilla),
        pricePerInchCuadro: new Decimal(tripPricing.pricePerInchCuadro),
        totalPieces: calc.totals.totalPieces,
        totalFeet: new Decimal(calc.totals.totalFeet),
        totalCost: new Decimal(calc.totals.totalCostFeet),
        totalSale: new Decimal(calc.totals.totalSale),
        totalProfit: new Decimal(calc.totals.totalProfit),
        marginPercent: new Decimal(calc.totals.globalMarginPct),
        supplierName: input.supplierName,
        origin: input.origin,
        notes: input.notes,
        createdById: userId,
        lines: {
          create: calc.lines.map((line) => ({
            thicknessIn: line.dimensions.thickness,
            widthIn: line.dimensions.width,
            lengthIn: line.dimensions.length,
            varaLength: line.varaLength,
            priceGroup: line.priceGroup,
            pieces: line.pieces,
            calculatedFeet: new Decimal(line.calculatedFeet),
            calculatedCostFeet: new Decimal(line.calculatedCostFeet),
            calculatedCostPerPiece: new Decimal(line.calculatedCostPerPiece),
            calculatedSalePricePerPiece: new Decimal(line.calculatedSalePricePerPiece),
            calculatedSaleTotal: new Decimal(line.calculatedSaleTotal),
            calculatedProfit: new Decimal(line.calculatedProfit),
            calculatedMarginPct: new Decimal(line.calculatedMarginPct),
          })),
        },
      },
      include: { lines: true, destinationBranch: true },
    });

    return newTrip;
  });

  return { trip, calculation: calc };
}

/** Update a draft timber trip */
export async function updateTimberTrip(id: string, input: UpdateTimberTripInput) {
  const existing = await prisma.timberTrip.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!existing) throw new Error("TIMBER_TRIP_NOT_FOUND");
  if (existing.status !== "DRAFT") throw new Error("TRIP_NOT_EDITABLE");

  const pricing = await getPricingConfig();
  const tripPricing: TimberPricing = {
    costPerFoot: pricing.costPerFoot,
    pricePerInchTabla: input.pricePerInchTabla ?? existing.pricePerInchTabla.toNumber(),
    pricePerInchTablilla: input.pricePerInchTablilla ?? existing.pricePerInchTablilla.toNumber(),
    pricePerInchCuadro: input.pricePerInchCuadro ?? existing.pricePerInchCuadro.toNumber(),
  };

  const woodCost = input.woodTripTotalCost ?? existing.woodTripTotalCost.toNumber();
  const lines = input.lines ?? existing.lines.map((l) => ({
    thickness: l.thicknessIn,
    width: l.widthIn,
    length: l.lengthIn,
    pieces: l.pieces,
    priceGroup: l.priceGroup as "TABLA" | "TABLILLA" | "CUADRO",
  }));
  const expenses = input.expenses ?? {
    freightAmount: existing.freightAmount.toNumber(),
    fuelAmount: existing.fuelAmount.toNumber(),
    perDiemAmount: existing.perDiemAmount.toNumber(),
    permitsAmount: existing.permitsAmount.toNumber(),
    otherExpensesAmount: existing.otherExpensesAmount.toNumber(),
  };

  const calc = calculateTimberTrip(
    lines.map((l) => ({
      thickness: l.thickness,
      width: l.width,
      length: l.length,
      pieces: l.pieces,
      priceGroup: l.priceGroup,
    })),
    woodCost,
    tripPricing,
    { costPerFootInput: input.costPerFoot, expenses },
  );

  const trip = await prisma.$transaction(async (tx) => {
    // Delete old lines
    await tx.timberTripLine.deleteMany({ where: { tripId: id } });

    // Update trip
    return tx.timberTrip.update({
      where: { id },
      data: {
        woodTripTotalCost: new Decimal(calc.totals.woodTripTotalCost),
        computedCostPerFoot: new Decimal(calc.totals.computedCostPerFoot),
        freightAmount: new Decimal(expenses.freightAmount ?? 0),
        fuelAmount: new Decimal(expenses.fuelAmount ?? 0),
        perDiemAmount: new Decimal(expenses.perDiemAmount ?? 0),
        permitsAmount: new Decimal(expenses.permitsAmount ?? 0),
        otherExpensesAmount: new Decimal(expenses.otherExpensesAmount ?? 0),
        tripExpensesTotal: new Decimal(calc.totals.tripExpensesTotal),
        landedCostPerFoot: new Decimal(calc.totals.landedCostPerFoot),
        invoicedFeet: input.invoicedFeet !== undefined ? (input.invoicedFeet != null ? new Decimal(input.invoicedFeet) : null) : undefined,
        pricePolicy: input.pricePolicy ?? undefined,
        pricePerInchTabla: new Decimal(tripPricing.pricePerInchTabla),
        pricePerInchTablilla: new Decimal(tripPricing.pricePerInchTablilla),
        pricePerInchCuadro: new Decimal(tripPricing.pricePerInchCuadro),
        totalPieces: calc.totals.totalPieces,
        totalFeet: new Decimal(calc.totals.totalFeet),
        totalCost: new Decimal(calc.totals.totalCostFeet),
        totalSale: new Decimal(calc.totals.totalSale),
        totalProfit: new Decimal(calc.totals.totalProfit),
        marginPercent: new Decimal(calc.totals.globalMarginPct),
        supplierName: input.supplierName !== undefined ? input.supplierName : undefined,
        origin: input.origin !== undefined ? input.origin : undefined,
        notes: input.notes !== undefined ? input.notes : undefined,
        lines: {
          create: calc.lines.map((line) => ({
            thicknessIn: line.dimensions.thickness,
            widthIn: line.dimensions.width,
            lengthIn: line.dimensions.length,
            varaLength: line.varaLength,
            priceGroup: line.priceGroup,
            pieces: line.pieces,
            calculatedFeet: new Decimal(line.calculatedFeet),
            calculatedCostFeet: new Decimal(line.calculatedCostFeet),
            calculatedCostPerPiece: new Decimal(line.calculatedCostPerPiece),
            calculatedSalePricePerPiece: new Decimal(line.calculatedSalePricePerPiece),
            calculatedSaleTotal: new Decimal(line.calculatedSaleTotal),
            calculatedProfit: new Decimal(line.calculatedProfit),
            calculatedMarginPct: new Decimal(line.calculatedMarginPct),
          })),
        },
      },
      include: { lines: true, destinationBranch: true },
    });
  });

  return { trip, calculation: calc };
}

type ResolvedLineForInjection = {
  lineId: string;
  dimensions: { thickness: number; width: number; length: number };
  priceGroup: TimberPriceGroup;
  varaLength: number;
  pieces: number;
  boardFeet: number;
  productId: string | null;
  timberProductId: string | null;
  isNewProduct: boolean;
  costPerPiece: number;
  pricePerInch: number;
  recalculatedSellingPrice: number;
};

/** Resuelve, SIN escribir nada, la identidad (existente o "nuevo") de cada línea. */
async function resolveLinesForInjectionReadOnly(
  trip: Prisma.TimberTripGetPayload<{ include: { lines: true } }>,
): Promise<ResolvedLineForInjection[]> {
  const resolved: ResolvedLineForInjection[] = [];
  for (const line of trip.lines) {
    if (line.pieces <= 0) continue;
    const sku = `MAD-${line.priceGroup.substring(0, 3)}-${line.thicknessIn}x${line.widthIn}x${line.lengthIn}`;
    let productId: string | null = null;
    let timberProductId: string | null = null;

    if (line.timberProductId) {
      const existing = await prisma.timberProduct.findUnique({ where: { id: line.timberProductId } });
      if (existing) {
        productId = existing.productId;
        timberProductId = existing.id;
      }
    }
    if (!productId) {
      const existingProduct = await prisma.product.findUnique({ where: { sku }, include: { timberProduct: true } });
      if (existingProduct?.timberProduct) {
        productId = existingProduct.id;
        timberProductId = existingProduct.timberProduct.id;
      }
    }

    const costPerPiece = line.calculatedCostPerPiece.gt(0)
      ? line.calculatedCostPerPiece.toNumber()
      : line.pieces > 0
        ? line.calculatedCostFeet.toNumber() / line.pieces
        : 0;

    resolved.push({
      lineId: line.id,
      dimensions: { thickness: line.thicknessIn, width: line.widthIn, length: line.lengthIn },
      priceGroup: line.priceGroup as TimberPriceGroup,
      varaLength: line.varaLength,
      pieces: line.pieces,
      boardFeet: line.calculatedFeet.div(line.pieces).toNumber(),
      productId,
      timberProductId,
      isNewProduct: productId === null,
      costPerPiece,
      pricePerInch: line.calculatedSalePricePerPiece.div(line.thicknessIn * line.widthIn * line.varaLength || 1).toNumber(),
      recalculatedSellingPrice: line.calculatedSalePricePerPiece.toNumber(),
    });
  }
  return resolved;
}

export type TimberInjectionLinePreview = {
  lineId: string;
  dimensions: { thickness: number; width: number; length: number };
  isNewProduct: boolean;
  productId: string | null;
  piecesToAdd: number;
  costPerPiece: { before: number | null; after: number };
  wac: { before: number | null; after: number };
  branchCost: { before: number | null; after: number };
  sellingPrice: { before: number | null; after: number };
};

export type TimberInjectionPreview = {
  tripId: string;
  tripCode: string;
  pricePolicy: string;
  lines: TimberInjectionLinePreview[];
  hash: string;
};

/**
 * Madera v2 Fase 2.4 — preview de inyección: por línea, el par ANTES → DESPUÉS de costo
 * unitario, WAC (proyectado con la misma fórmula que usa recalculateWeightedAverage), costo de
 * sucursal y precio de venta, SIN escribir nada. confirmTimberTrip exige el hash de este preview
 * para aplicar — si el inventario cambió entre medias, el hash no coincide y rechaza.
 */
export async function getTimberTripInjectionPreview(id: string): Promise<TimberInjectionPreview> {
  const trip = await prisma.timberTrip.findUnique({ where: { id }, include: { lines: true } });
  if (!trip) throw new Error("TIMBER_TRIP_NOT_FOUND");

  const marginConfig = await getMarginConfig();
  const resolvedLines = await resolveLinesForInjectionReadOnly(trip);

  const lines: TimberInjectionLinePreview[] = [];
  for (const line of resolvedLines) {
    const [timberProductBefore, productBefore, balanceBefore, branchSettingBefore] = await Promise.all([
      line.timberProductId ? prisma.timberProduct.findUnique({ where: { id: line.timberProductId } }) : null,
      line.productId ? prisma.product.findUnique({ where: { id: line.productId } }) : null,
      line.productId
        ? prisma.inventoryBalance.findUnique({ where: { branchId_productId: { branchId: trip.destinationBranchId, productId: line.productId } } })
        : null,
      line.productId
        ? prisma.branchProductSetting.findUnique({ where: { branchId_productId: { branchId: trip.destinationBranchId, productId: line.productId } } })
        : null,
    ]);

    const qohActual = balanceBefore?.quantityOnHand.toNumber() ?? 0;
    const wacActual = balanceBefore?.weightedAverageCost.toNumber() ?? 0;
    const wacAfter = (qohActual * wacActual + line.pieces * line.costPerPiece) / (qohActual + line.pieces || 1);

    const sellingPriceBefore = timberProductBefore?.sellingPrice.toNumber() ?? null;
    const sellingPriceAfter = resolveSellingPriceForPolicy({
      pricePolicy: trip.pricePolicy,
      recalculatedSellingPrice: line.recalculatedSellingPrice,
      existingSellingPrice: sellingPriceBefore,
      costPerPiece: line.costPerPiece,
      targetMarginPercent: marginConfig.targetMarginPercent,
      targetMarginRoundingMultiple: marginConfig.targetMarginRoundingMultiple,
    });

    lines.push({
      lineId: line.lineId,
      dimensions: line.dimensions,
      isNewProduct: line.isNewProduct,
      productId: line.productId,
      piecesToAdd: line.pieces,
      costPerPiece: { before: timberProductBefore?.baseCost.toNumber() ?? null, after: line.costPerPiece },
      wac: { before: balanceBefore ? wacActual : null, after: roundMoney(wacAfter) },
      branchCost: { before: branchSettingBefore?.branchCost?.toNumber() ?? null, after: line.costPerPiece },
      sellingPrice: { before: productBefore?.standardSalePrice.toNumber() ?? sellingPriceBefore, after: sellingPriceAfter },
    });
  }

  const hash = createHash("sha256").update(JSON.stringify(lines)).digest("hex");
  return { tripId: trip.id, tripCode: trip.tripCode, pricePolicy: trip.pricePolicy, lines, hash };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function getMarginConfig(): Promise<{ targetMarginPercent: number; targetMarginRoundingMultiple: number }> {
  const cfg = await prisma.timberPricingConfig.findFirst({ orderBy: { updatedAt: "desc" } });
  return {
    targetMarginPercent: cfg ? cfg.targetMarginPercent.toNumber() : 0.4,
    targetMarginRoundingMultiple: cfg ? cfg.targetMarginRoundingMultiple.toNumber() : 1,
  };
}

/**
 * Confirm a timber trip and inject all its lines into the destination branch inventory.
 *
 * This is the single step the user expects from the "Confirmar e insertar en inventario"
 * action: a DRAFT/CUBICADO trip is validated, every line is resolved to a (Product +
 * TimberProduct), costs/prices are ALWAYS written via applyTimberCostsTx (Madera v2 Fase 2 —
 * fixes the bug where they froze at the first trip's values), a TIMBER_INTAKE_IN inventory
 * movement is created for each line, and the trip transitions to TRANSFERRED. Everything runs
 * inside one transaction so it is all-or-nothing.
 *
 * Requires the hash of a freshly-generated injection preview (Fase 2.4) — "nadie inyecta sin
 * ver". If the trip's reconciliation is out of tolerance, requires explicit acknowledgment too.
 */
export async function confirmTimberTrip(
  id: string,
  userId?: string,
  options: { expectedHash?: string; acknowledgeReconciliation?: boolean } = {},
) {
  const trip = await prisma.timberTrip.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!trip) throw new Error("TIMBER_TRIP_NOT_FOUND");
  if (trip.status !== "DRAFT" && trip.status !== "CUBICADO") {
    throw new Error("TRIP_CANNOT_BE_CONFIRMED");
  }
  if (trip.lines.length === 0) {
    throw new Error("TRIP_HAS_NO_LINES");
  }
  // A positive landed cost per board foot is required so inbound inventory movements have a real cost.
  if (trip.landedCostPerFoot.lte(0)) {
    throw new Error("TRIP_REQUIRES_COST");
  }

  const tolerancePercent = await getReconciliationTolerance();
  const reconciliation = calculateReconciliation(
    trip.totalFeet.toNumber(),
    trip.invoicedFeet != null ? trip.invoicedFeet.toNumber() : null,
    tolerancePercent,
  );
  if (reconciliation.status === "REVIEW" && !options.acknowledgeReconciliation) {
    throw new Error("RECONCILIATION_REQUIRES_ACK");
  }

  if (!options.expectedHash) {
    throw new Error("INJECTION_PREVIEW_REQUIRED");
  }
  const freshPreview = await getTimberTripInjectionPreview(id);
  if (freshPreview.hash !== options.expectedHash) {
    throw new Error("INJECTION_PREVIEW_STALE");
  }

  const marginConfig = await getMarginConfig();
  const pricing: TimberPricing = {
    costPerFoot: trip.computedCostPerFoot.toNumber(),
    pricePerInchTabla: trip.pricePerInchTabla.toNumber(),
    pricePerInchTablilla: trip.pricePerInchTablilla.toNumber(),
    pricePerInchCuadro: trip.pricePerInchCuadro.toNumber(),
  };

  return prisma.$transaction(async (tx) => {
    for (const line of trip.lines) {
      if (line.pieces <= 0) continue;
      const { productId, timberProductId } = await resolveTimberProductIdentityTx(tx, line, pricing);

      // Unit cost per piece — fall back to cost/feet ÷ pieces when not pre-computed.
      const unitCost = line.calculatedCostPerPiece.gt(0)
        ? line.calculatedCostPerPiece.toNumber()
        : line.pieces > 0
          ? line.calculatedCostFeet.toNumber() / line.pieces
          : 0;

      // Madera v2 Fase 2 — SIEMPRE actualiza costos/precios, exista o no el producto.
      await applyTimberCostsTx(tx, {
        actorUserId: userId,
        branchId: trip.destinationBranchId,
        productId,
        timberProductId,
        priceGroup: line.priceGroup as TimberPriceGroup,
        boardFeet: line.calculatedFeet.div(line.pieces).toNumber(),
        pricePerInch: line.calculatedSalePricePerPiece.div((line.thicknessIn * line.widthIn * line.varaLength) || 1).toNumber(),
        varaLength: line.varaLength,
        costPerPiece: unitCost,
        recalculatedSellingPrice: line.calculatedSalePricePerPiece.toNumber(),
        pricePolicy: trip.pricePolicy,
        targetMarginPercent: marginConfig.targetMarginPercent,
        targetMarginRoundingMultiple: marginConfig.targetMarginRoundingMultiple,
      });

      await createInventoryMovementTx(tx, {
        actorUserId: userId ?? "SYSTEM",
        branchId: trip.destinationBranchId,
        productId,
        movementType: "TIMBER_INTAKE_IN",
        quantity: line.pieces,
        unitCost,
        referenceType: "TIMBER_TRIP",
        referenceId: trip.id,
        notes: `Viaje de madera ${trip.tripCode} — ${line.thicknessIn}"×${line.widthIn}"×${line.varaLength} pies`,
      });

      // Link the line to the resolved product for traceability.
      if (line.timberProductId !== timberProductId) {
        await tx.timberTripLine.update({
          where: { id: line.id },
          data: { timberProductId },
        });
      }
    }

    // Auditoría 2026-07-22 (ALTO Madera): el status se validaba ANTES de abrir
    // la transacción y la transición final usaba un update plano — un doble
    // clic o un retry concurrente podían pasar ambos el chequeo inicial e
    // inyectar el mismo viaje dos veces en inventario. Opción A (mismo patrón
    // que executeSaleReturn/executeSaleCancellation): updateMany guardado por
    // status dentro de la misma transacción — si otro request ya confirmó
    // este viaje, count=0 y se revierte TODO lo de esta transacción
    // (incluidos los movimientos de inventario ya creados arriba).
    const transition = await tx.timberTrip.updateMany({
      where: { id, status: { in: ["DRAFT", "CUBICADO"] } },
      data: {
        status: "TRANSFERRED",
        confirmedById: userId,
        confirmedAt: new Date(),
        reconciliationAcknowledged: reconciliation.status === "REVIEW" ? true : trip.reconciliationAcknowledged,
      },
    });
    if (transition.count === 0) {
      throw new Error("TRIP_ALREADY_CONFIRMED");
    }
    const updated = await tx.timberTrip.findUniqueOrThrow({
      where: { id },
      include: { lines: true, destinationBranch: true },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        branchId: trip.destinationBranchId,
        module: "timber",
        action: "TIMBER_TRIP_CONFIRMED_AND_INJECTED",
        entityType: "TimberTrip",
        entityId: trip.id,
        metadataJson: {
          tripCode: trip.tripCode,
          totalPieces: trip.totalPieces,
          totalFeet: trip.totalFeet.toString(),
          totalCost: trip.totalCost.toString(),
          landedCostPerFoot: trip.landedCostPerFoot.toString(),
          linesInjected: trip.lines.length,
          reconciliationStatus: reconciliation.status,
          reconciliationAcknowledged: reconciliation.status === "REVIEW",
        },
      },
    });

    return updated;
  });
}

/** Cancel a timber trip */
export async function cancelTimberTrip(id: string) {
  const trip = await prisma.timberTrip.findUnique({ where: { id } });
  if (!trip) throw new Error("TIMBER_TRIP_NOT_FOUND");
  if (trip.status === "TRANSFERRED" || trip.status === "CANCELLED") {
    throw new Error("TRIP_CANNOT_BE_CANCELLED");
  }

  return prisma.timberTrip.update({
    where: { id },
    data: { status: "CANCELLED" },
    include: { lines: true, destinationBranch: true },
  });
}

/** Get a single trip with lines */
/** Tolerancia de conciliación configurada (Madera v2 Fase 1.3 / Fase 4). */
async function getReconciliationTolerance(): Promise<number> {
  const cfg = await prisma.timberPricingConfig.findFirst({ orderBy: { updatedAt: "desc" } });
  return cfg ? cfg.reconciliationTolerancePercent.toNumber() : 0.01;
}

export async function getTimberTrip(id: string) {
  const trip = await prisma.timberTrip.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { createdAt: "asc" } },
      destinationBranch: true,
    },
  });
  if (!trip) return null;

  const tolerancePercent = await getReconciliationTolerance();
  const reconciliation = calculateReconciliation(
    trip.totalFeet.toNumber(),
    trip.invoicedFeet != null ? trip.invoicedFeet.toNumber() : null,
    tolerancePercent,
  );

  return { ...trip, reconciliation };
}

/** List timber trips with filtering */
export async function listTimberTrips(filters?: {
  status?: string;
  destinationBranchId?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.destinationBranchId) where.destinationBranchId = filters.destinationBranchId;
  if (filters?.search) {
    where.OR = [
      { tripCode: { contains: filters.search } },
      { supplierName: { contains: filters.search } },
      { origin: { contains: filters.search } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.timberTrip.findMany({
      where,
      include: {
        destinationBranch: true,
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.timberTrip.count({ where }),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}
