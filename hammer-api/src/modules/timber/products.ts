/** Medidas de madera en el catálogo: crear, editar, borrar y listar con stock/costo/precio de la sucursal. */
import { prisma } from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { calculateTimber, type CubicationRow } from "./calculator";
import type { CreateTimberProductInput, UpdateTimberProductInput } from "./validators";
import { getPricingConfig } from "./pricing-config";
import { catalogLengthFeet } from "./branch-cost";
import { findWoodIdentity, timberDescription, TIMBER_CATEGORY_NAME, WOOD_CATEGORY_WHERE } from "./catalog-link";
import { generateSkuForProduct, parseWoodDimensions } from "@/modules/catalog/sku-generator";
import { buildProductSearchWhere, tokenize, type SearchableField } from "@/modules/catalog/product-search";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";

/* ══════════════════════════════════════════════════════════
   Timber Products CRUD
   ══════════════════════════════════════════════════════════ */

// Sin branchId a propósito: al crearse, el producto no pertenece a ninguna
// sucursal en particular (es catálogo global) — el precio por sucursal se
// resuelve después, en el catálogo, vía BranchProductSetting.branchPrice.
export async function createTimberProduct(input: CreateTimberProductInput) {
  const pricing = await getPricingConfig();
  const calc = calculateTimber(
    { thickness: input.thickness, width: input.width, length: input.length },
    pricing,
    pricing.classification,
  );

  // Una medida es un solo producto: el viaje la enlazaría a uno de los dos y el otro quedaría sin stock.
  const existing = await findWoodIdentity(prisma, {
    timberProductId: null,
    thicknessIn: input.thickness,
    widthIn: input.width,
    lengthIn: input.length,
    varaLength: calc.varaLength,
  });
  if (existing.product) {
    throw new Error(`TIMBER_PRODUCT_DUPLICATE: Esa medida ya existe en el catálogo: ${existing.product.name} (${existing.product.sku}).`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const sku = input.sku || (await generateSkuForProduct(tx, { productName: input.name, categoryName: TIMBER_CATEGORY_NAME }));
    const product = await tx.product.create({
      data: {
        sku,
        name: input.name,
        description: timberDescription(calc.priceGroup, input.thickness, input.width, input.length, calc.varaLength, calc.boardFeet),
        categoryId: input.categoryId,
        unit: "UNIDAD",
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

/** Con movimientos de inventario o viajes, la medida ya tiene historia: ni se borra ni cambia de dimensiones. */
async function timberProductHasHistory(timberProductId: string, productId: string): Promise<boolean> {
  const [movements, tripLines] = await Promise.all([
    prisma.inventoryMovement.count({ where: { productId } }),
    prisma.timberTripLine.count({ where: { timberProductId } }),
  ]);
  return movements > 0 || tripLines > 0;
}

export async function updateTimberProduct(id: string, input: UpdateTimberProductInput) {
  const existing = await prisma.timberProduct.findUnique({
    where: { id },
    include: { product: true },
  });
  if (!existing) throw new Error("TIMBER_PRODUCT_NOT_FOUND");

  const thickness = input.thickness ?? existing.thickness.toNumber();
  const width = input.width ?? existing.width.toNumber();
  const length = input.length ?? existing.length.toNumber();

  // El formulario manda siempre las medidas: renombrar pisaba el costo real y el
  // precio del último viaje con los de la config. Solo se recalcula si cambió la medida.
  if (thickness === existing.thickness.toNumber() && width === existing.width.toNumber() && length === existing.length.toNumber()) {
    if (input.name) await prisma.product.update({ where: { id: existing.productId }, data: { name: input.name } });
    return { timberProduct: existing, calculation: null };
  }
  if (await timberProductHasHistory(existing.id, existing.productId)) throw new Error("TIMBER_PRODUCT_IN_USE");

  // Mismo motivo que createTimberProduct: el producto sigue sin sucursal
  // propia, así que se recalcula contra el default global.
  const pricing = await getPricingConfig();

  const calc = calculateTimber({ thickness, width, length }, pricing, pricing.classification);

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
        description: timberDescription(calc.priceGroup, thickness, width, length, calc.varaLength, calc.boardFeet),
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
    pricing.classification,
  );

  return { ...tp, calculation: calc };
}

/** Lista [medidas de madera… | catálogo…]: qué tramo del catálogo cae en la página que empieza en `skip`. */
export function catalogSliceForCombinedPage(input: { skip: number; limit: number; timberTotal: number; timberOnPage: number }): { offset: number; count: number } {
  return { offset: Math.max(0, input.skip - input.timberTotal), count: Math.max(0, input.limit - input.timberOnPage) };
}

/**
 * Palabra por palabra, sin distinguir mayúsculas (misma regla de catalog/product-search).
 * Una medida en pies también busca su nombre del catálogo: "2x4x16" encuentra "CUARTON 2X4X6".
 */
export function timberProductSearchWhere(search: string, cubicationTable: CubicationRow[]): Prisma.ProductWhereInput {
  const fields: SearchableField[] = ["name", "sku"];
  return {
    AND: tokenize(search).map((token) => {
      const normalized = token.replace(/[×*]/g, "X");
      const measure = normalized.match(/^(\d+)X(\d+)X(\d+)$/);
      const varas = measure ? cubicationTable.find((row) => row.lengthFeet === Number(measure[3]))?.varas : undefined;
      return {
        OR: [
          buildProductSearchWhere(normalized, fields),
          ...(measure && varas ? [buildProductSearchWhere(`${measure[1]}X${measure[2]}X${varas}`, fields)] : []),
        ],
      };
    }),
  };
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

  const { classification } = await getPricingConfig(filters?.branchId);
  const search = filters?.search ? timberProductSearchWhere(filters.search, classification.cubicationTable) : {};

  const where: Record<string, unknown> = {};
  // El tipo del catálogo (REGLA, CUARTON…) no es el grupo de precio guardado en timberType.
  if (filters?.timberType) where.OR = [{ timberType: filters.timberType }, { product: { name: { startsWith: filters.timberType, mode: "insensitive" } } }];
  if (filters?.search) where.product = search;

  const inventoryBalances = {
    ...(filters?.branchId ? { where: { branchId: filters.branchId } } : {}),
    select: { quantityOnHand: true, weightedAverageCost: true },
  };

  const [timberItems, timberTotal] = await Promise.all([
    prisma.timberProduct.findMany({
      where,
      include: { product: { include: { category: true, inventoryBalances } } },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.timberProduct.count({ where }),
  ]);

  // Lista combinada: TODAS las medidas de madera primero (paginadas en la
  // base) y después los productos de catálogo de categoría Madera SIN
  // TimberProduct. Antes se excluían solo los de la página actual — los de
  // otras páginas reaparecían como "Catálogo real" — y el catálogo se
  // repetía (recortado) en cada página.
  const catalogWhere = {
    isActive: true,
    timberProduct: { is: null },
    category: WOOD_CATEGORY_WHERE,
    ...search,
  };

  const catalogProducts = await prisma.product.findMany({
    where: catalogWhere,
    include: {
      category: true,
      inventoryBalances,
    },
    orderBy: { name: "asc" },
    take: 1000,
  });

  // Stock, costo y precio de la sucursal pedida: el precio general del catálogo es un relleno (C$1).
  const branchFigures = async (product: (typeof catalogProducts)[number] | (typeof timberItems)[number]["product"]) => {
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
    return {
      stockOnHand,
      effectiveCost,
      effectivePrice,
      priceSource: effective?.priceSource ?? "MISSING",
      costSource: effective?.costSource ?? (weightedCost !== null ? "WAC" : "NONE"),
    };
  };

  const mappedTimber = await Promise.all(timberItems.map(async (item) => {
    const subtype = parseWoodDimensions(item.product.name).subtype;
    return {
      id: item.id,
      catalogProductId: item.productId,
      isCatalogOnly: false,
      timberType: item.timberType,
      woodSubtype: subtype && subtype !== "OTRO" ? subtype : item.timberType,
      thickness: item.thickness.toString(),
      width: item.width.toString(),
      length: item.length.toString(),
      varaLength: item.varaLength,
      boardFeet: item.boardFeet.toString(),
      baseCost: item.baseCost.toString(),
      sellingPrice: item.sellingPrice.toString(),
      ...(await branchFigures(item.product)),
      product: item.product,
      detectedDimensions: {
        thicknessInches: item.thickness.toNumber(),
        widthInches: item.width.toNumber(),
        lengthFeet: item.length.toNumber(),
        subtype: item.timberType,
      },
    };
  }));

  const catalogCandidates = catalogProducts
    .map((product) => ({ product, detected: parseWoodDimensions(product.name) }))
    .filter(({ detected }) => !filters?.timberType || detected.subtype === filters.timberType);
  const total = timberTotal + catalogCandidates.length;
  // La parte de catálogo de ESTA página: sigue a las medidas de madera en el orden global.
  const slice = catalogSliceForCombinedPage({ skip, limit, timberTotal, timberOnPage: timberItems.length });
  const catalogPage = catalogCandidates.slice(slice.offset, slice.offset + slice.count);

  // Precio/costo efectivo solo de los de esta página (antes: de hasta 1000, uno por uno).
  const mappedCatalog = await Promise.all(catalogPage.map(async ({ product, detected }) => {
    const { stockOnHand, effectiveCost, effectivePrice, priceSource, costSource } = await branchFigures(product);
    const thickness = detected.thicknessInches ?? 0;
    const width = detected.widthInches ?? 0;
    // En el nombre del catálogo el tercer número son varas: "2X4X6" = 16 pies = 10.67 pies tablares, no 4.
    const varaLength = detected.lengthFeet ?? 0;
    const length = catalogLengthFeet(varaLength, classification.cubicationTable);
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
      varaLength,
      boardFeet: String(boardFeet),
      baseCost: String(effectiveCost ?? 0),
      sellingPrice: effectivePrice === null ? "" : String(effectivePrice),
      stockOnHand,
      effectiveCost,
      effectivePrice,
      priceSource,
      costSource,
      product,
      detectedDimensions: detected,
      warnings: [
        ...(effectiveCost === null ? ["Producto de madera sin costo efectivo."] : []),
        ...(effectivePrice === null || effectivePrice <= 0 ? ["Producto de madera sin precio de venta."] : []),
        ...(boardFeet <= 0 ? ["No se pudieron inferir dimensiones desde el nombre."] : []),
      ],
    };
  }));

  const items = [...mappedTimber, ...mappedCatalog];

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function deleteTimberProduct(id: string) {
  const existing = await prisma.timberProduct.findUnique({ where: { id } });
  if (!existing) throw new Error("TIMBER_PRODUCT_NOT_FOUND");
  // Desactivaba el producto aunque tuviera stock o ventas: desaparecía del POS.
  if (await timberProductHasHistory(id, existing.productId)) throw new Error("TIMBER_PRODUCT_IN_USE");

  await prisma.$transaction(async (tx) => {
    await tx.timberProduct.delete({ where: { id } });
    await tx.product.update({
      where: { id: existing.productId },
      data: { isActive: false },
    });
  });

  return { success: true };
}
