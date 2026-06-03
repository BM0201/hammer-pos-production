import { prisma } from "@/lib/prisma";
import {
  calculateTimber,
  calculateTimberTrip,
  classifyTimber,
  getVaraLength,
  measureKey,
  DEFAULT_PRICING,
  type TimberPricing,
  type TimberTripLineInput,
} from "./calculator";
import type {
  CreateTimberProductInput,
  UpdateTimberProductInput,
  CreateTimberTripInput,
  UpdateTimberTripInput,
  UpdateTimberPricingConfigInput,
} from "./validators";
import { Decimal } from "@prisma/client/runtime/library";
import { parseWoodDimensions } from "@/modules/catalog/sku-generator";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";

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
    const effectivePrice = effective ? Number(effective.effectivePrice) : product.standardSalePrice.toNumber();
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
      sellingPrice: String(effectivePrice),
      stockOnHand,
      effectiveCost,
      effectivePrice,
      priceSource: effective?.priceSource ?? "STANDARD",
      costSource: effective?.costSource ?? (weightedCost !== null ? "WAC" : "NONE"),
      product,
      detectedDimensions: detected,
      warnings: [
        ...(effectiveCost === null ? ["Producto de madera sin costo efectivo."] : []),
        ...(effectivePrice <= 0 ? ["Producto de madera sin precio de venta."] : []),
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

  const calc = calculateTimberTrip(tripLines, input.woodTripTotalCost, tripPricing);
  const tripCode = await generateTripCode();

  const trip = await prisma.$transaction(async (tx) => {
    const newTrip = await tx.timberTrip.create({
      data: {
        tripCode,
        destinationBranchId: input.destinationBranchId,
        status: "DRAFT",
        woodTripTotalCost: new Decimal(calc.totals.woodTripTotalCost),
        computedCostPerFoot: new Decimal(calc.totals.computedCostPerFoot),
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

/** Confirm a timber trip — marks it as CONFIRMED and can trigger inventory intake */
export async function confirmTimberTrip(id: string, userId?: string) {
  const trip = await prisma.timberTrip.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!trip) throw new Error("TIMBER_TRIP_NOT_FOUND");
  if (trip.status !== "DRAFT" && trip.status !== "CUBICADO") {
    throw new Error("TRIP_CANNOT_BE_CONFIRMED");
  }

  return prisma.timberTrip.update({
    where: { id },
    data: {
      status: "CONFIRMED",
      confirmedById: userId,
      confirmedAt: new Date(),
    },
    include: { lines: true, destinationBranch: true },
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
export async function getTimberTrip(id: string) {
  return prisma.timberTrip.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { createdAt: "asc" } },
      destinationBranch: true,
    },
  });
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
