/**
 * Enlace de una medida de madera con el catálogo: a qué producto va (buscar o crear)
 * y cómo se escriben su costo y precio al ingresar un viaje.
 */
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma, TimberTripLine } from "@prisma/client";
import { calculateTargetMarginPrice, type TimberPriceGroup } from "./calculator";
import { generateSkuForProduct, parseWoodDimensions } from "@/modules/catalog/sku-generator";
import { resolveGlobalCostWriteTarget } from "@/modules/catalog/service";
import { getProductStockConversion } from "@/modules/inventory/unit-conversion";

/** Default category used when auto-creating timber products on inventory injection. */
const TIMBER_CATEGORY_CODE = "MAD";
export const TIMBER_CATEGORY_NAME = "Madera";

/** Find-or-create the "Madera" category used for auto-generated timber products. */
async function resolveTimberCategoryTx(tx: Prisma.TransactionClient): Promise<string> {
  const existing = await tx.category.findUnique({ where: { code: TIMBER_CATEGORY_CODE } });
  if (existing) return existing.id;
  const created = await tx.category.create({
    data: { code: TIMBER_CATEGORY_CODE, name: TIMBER_CATEGORY_NAME, isActive: true },
  });
  return created.id;
}

export const WOOD_CATEGORY_WHERE: Prisma.CategoryWhereInput = {
  OR: [
    { code: { startsWith: TIMBER_CATEGORY_CODE, mode: "insensitive" } },
    { name: { contains: TIMBER_CATEGORY_NAME, mode: "insensitive" } },
  ],
};

/**
 * Nombre de una medida con la convención del catálogo real: el tercer número
 * son VARAS, no pies ("TABLA 1X12X6" = 1"×12"×16 pies, ver cubicationTable).
 * Familia según el catálogo: TABLA ≥10" · TABLILLA 1×6/1×8 · REGLA 1×2..4 · el resto CUARTON.
 */
export function timberCatalogName(thickness: number, width: number, varaLength: number): string {
  const family = width >= 10 ? "TABLA" : thickness === 1 && width >= 6 ? "TABLILLA" : thickness === 1 ? "REGLA" : "CUARTON";
  return `${family} ${thickness}X${width}X${varaLength}`;
}

export function timberDescription(priceGroup: string, thickness: number, width: number, lengthFeet: number, varaLength: number, boardFeet: number): string {
  return `Madera ${priceGroup} — ${thickness}"×${width}"×${lengthFeet} pies (${varaLength} varas) — ${boardFeet} pies tablares`;
}

/** De los productos que contienen la medida en el nombre: el de medida exacta, activo y con el nombre esperado primero. */
export function pickCatalogWoodProduct<T extends { name: string; isActive: boolean }>(
  candidates: T[],
  line: { thicknessIn: number; widthIn: number; varaLength: number },
): T | null {
  const expected = timberCatalogName(line.thicknessIn, line.widthIn, line.varaLength);
  const rank = (candidate: T) => (candidate.isActive ? 0 : 2) + (candidate.name.trim().toUpperCase() === expected ? 0 : 1);
  return candidates
    .filter((candidate) => {
      const parsed = parseWoodDimensions(candidate.name);
      return parsed.thicknessInches === line.thicknessIn && parsed.widthInches === line.widthIn && parsed.lengthFeet === line.varaLength;
    })
    .sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

type WoodIdentity = {
  product: { id: string; sku: string; name: string; isActive: boolean; isTimber: boolean } | null;
  timberProductId: string | null;
};
const WOOD_PRODUCT_SELECT = { id: true, sku: true, name: true, isActive: true, isTimber: true } as const;

/**
 * A qué producto va una medida — sin escribir: la vista previa y la confirmación
 * usan esta misma búsqueda. Orden: línea ya enlazada → medida de madera registrada
 * → producto del catálogo con esa medida en el nombre (los de categoría Madera
 * vienen de la importación con isTimber=false y SON los que vende el POS).
 */
export async function findWoodIdentity(
  client: Pick<Prisma.TransactionClient, "timberProduct" | "product">,
  line: Pick<TimberTripLine, "timberProductId" | "thicknessIn" | "widthIn" | "lengthIn" | "varaLength">,
): Promise<WoodIdentity> {
  const include = { product: { select: WOOD_PRODUCT_SELECT } };
  const registered =
    (line.timberProductId ? await client.timberProduct.findUnique({ where: { id: line.timberProductId }, include }) : null) ??
    (await client.timberProduct.findFirst({ where: { thickness: line.thicknessIn, width: line.widthIn, length: line.lengthIn }, include }));
  if (registered) return { product: registered.product, timberProductId: registered.id };

  const candidates = await client.product.findMany({
    where: { name: { contains: `${line.thicknessIn}X${line.widthIn}X${line.varaLength}`, mode: "insensitive" }, category: WOOD_CATEGORY_WHERE },
    select: { ...WOOD_PRODUCT_SELECT, timberProduct: { select: { id: true } } },
  });
  const match = pickCatalogWoodProduct(candidates, line);
  return { product: match, timberProductId: match?.timberProduct?.id ?? null };
}

/**
 * Find-or-create the Product + TimberProduct IDENTITY that represents a given trip line
 * dimension, so the same physical measure always maps to the same inventory product.
 *
 * Madera v2 Fase 2 — esta función SOLO resuelve identidad (encuentra o crea la fila). Los
 * costos/precios los escribe SIEMPRE applyTimberCostsTx, exista o no el producto — antes,
 * cuando el producto ya existía, esta función retornaba temprano sin actualizar nada, y del
 * segundo viaje en adelante TimberProduct.baseCost/sellingPrice, Product.standardSalePrice y el
 * BranchProductSetting de la sucursal destino quedaban congelados en los valores del primer viaje.
 *
 * Antes buscaba solo el SKU `MAD-TAB-1x12x16`, que ningún producto del catálogo tiene: el primer
 * viaje habría creado un duplicado de cada medida, con el stock en un producto que nadie vende.
 */
export async function resolveTimberProductIdentityTx(
  tx: Prisma.TransactionClient,
  line: TimberTripLine,
): Promise<{ productId: string; timberProductId: string; isNewProduct: boolean }> {
  const found = await findWoodIdentity(tx, line);
  // Un producto inactivo no se ve en el POS: el stock entrante quedaría invisible.
  if (found.product && (!found.product.isActive || !found.product.isTimber)) {
    await tx.product.update({ where: { id: found.product.id }, data: { isActive: true, isTimber: true } });
  }
  if (found.product && found.timberProductId) {
    return { productId: found.product.id, timberProductId: found.timberProductId, isNewProduct: false };
  }

  // El priceGroup/varaLength de la línea ya quedaron fijados al cubicar el viaje
  // (con la config vigente en ese momento) — se reutilizan tal cual en vez de
  // re-clasificar con la config ACTUAL, que podría haber cambiado desde entonces.
  const priceGroup = line.priceGroup as TimberPriceGroup;

  // Costos/precios iniciales provisionales (tomados de la línea tal cual quedó cubicada) —
  // applyTimberCostsTx los sobreescribe con los valores reales inmediatamente después.
  const boardFeetPerPiece = line.pieces > 0 ? line.calculatedFeet.div(line.pieces).toNumber() : 0;
  const costPerPiece = line.calculatedCostPerPiece.toNumber();
  const sellingPrice = line.calculatedSalePricePerPiece.toNumber();
  const denom = line.thicknessIn * line.widthIn * line.varaLength;
  const pricePerInch = denom > 0 ? sellingPrice / denom : 0;

  let productId = found.product?.id;
  if (!productId) {
    const name = timberCatalogName(line.thicknessIn, line.widthIn, line.varaLength);
    const product = await tx.product.create({
      data: {
        sku: await generateSkuForProduct(tx, { productName: name, categoryName: TIMBER_CATEGORY_NAME }),
        name,
        description: timberDescription(priceGroup, line.thicknessIn, line.widthIn, line.lengthIn, line.varaLength, boardFeetPerPiece),
        categoryId: await resolveTimberCategoryTx(tx),
        unit: "UNIDAD",
        isActive: true,
        allowsFraction: false,
        isTimber: true,
        standardSalePrice: new Decimal(sellingPrice),
      },
    });
    productId = product.id;
  }

  const timberProduct = await tx.timberProduct.create({
    data: {
      productId,
      timberType: priceGroup,
      thickness: new Decimal(line.thicknessIn),
      width: new Decimal(line.widthIn),
      length: new Decimal(line.lengthIn),
      boardFeet: new Decimal(boardFeetPerPiece),
      baseCost: new Decimal(costPerPiece),
      pricePerInch: new Decimal(pricePerInch),
      sellingPrice: new Decimal(sellingPrice),
      varaLength: line.varaLength,
    },
  });

  return { productId, timberProductId: timberProduct.id, isNewProduct: !found.product };
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

/** Precio <= C$2 = relleno ("algo hay que poner", p. ej. una medida que nunca se vendió), no un precio real: mismo piso que inventory/wac.ts. */
export const TIMBER_PLACEHOLDER_PRICE_FLOOR = 2;

/** Precio vigente EN la sucursal destino: el propio, si no el general, si no el último de madera. */
export function currentBranchSellingPrice(current: Pick<TimberCostInjectionSnapshot, "branchPrice" | "standardSalePrice" | "sellingPrice">): number | null {
  return current.branchPrice ?? current.standardSalePrice ?? current.sellingPrice;
}

/** "Solo actualizar costos" conserva el precio de la sucursal, salvo que sea un relleno de C$2 o menos: ese no es un precio. */
export function keepsCurrentPrice(pricePolicy: string, current: Pick<TimberCostInjectionSnapshot, "branchPrice" | "standardSalePrice" | "sellingPrice">): boolean {
  const price = currentBranchSellingPrice(current);
  return pricePolicy === "COST_ONLY" && price !== null && price > TIMBER_PLACEHOLDER_PRICE_FLOOR;
}

/**
 * El precio que deja un viaje — misma regla para la vista previa y para applyTimberCostsTx.
 * COST_ONLY = el vigente en ESTA sucursal; si ese es un relleno (VJM-2026-001: tablas 2X12 a C$1
 * contra costo C$946–1,376), se calcula con el margen objetivo en vez de dejarlo bajo costo.
 */
export function resolveTripSellingPrice(input: {
  pricePolicy: string;
  recalculatedSellingPrice: number;
  current: Pick<TimberCostInjectionSnapshot, "branchPrice" | "standardSalePrice" | "sellingPrice">;
  costPerPiece: number;
  targetMarginPercent: number;
  targetMarginRoundingMultiple: number;
}): number {
  if (keepsCurrentPrice(input.pricePolicy, input.current)) return currentBranchSellingPrice(input.current) as number;
  return resolveSellingPriceForPolicy({
    pricePolicy: input.pricePolicy === "COST_ONLY" ? "TARGET_MARGIN" : input.pricePolicy,
    recalculatedSellingPrice: input.recalculatedSellingPrice,
    existingSellingPrice: input.current.sellingPrice,
    costPerPiece: input.costPerPiece,
    targetMarginPercent: input.targetMarginPercent,
    targetMarginRoundingMultiple: input.targetMarginRoundingMultiple,
  });
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
    /**
     * true = el precio resultante vale para TODAS las sucursales que heredan
     * el general (RECALC con la config global, sin override de la sucursal
     * destino). false = es un precio de ESTA sucursal (override propio, o
     * margen objetivo sobre el costo de este viaje): no se escribe en
     * Product.standardSalePrice ni en TimberProduct.sellingPrice, que son
     * el respaldo de las demás sucursales. Default true (comportamiento previo).
     */
    updateGlobalPrice?: boolean;
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

  // COST_ONLY: "los precios de venta quedan como están" — el vigente EN ESTA
  // sucursal (branchPrice ?? general), y no se escribe ningún precio. Antes
  // tomaba TimberProduct.sellingPrice (puede venir del viaje de otra
  // sucursal) y lo escribía como branchPrice, pisando el precio propio.
  const costOnly = input.pricePolicy === "COST_ONLY";
  // Con un precio de relleno no hay nada que conservar: se escribe el de margen objetivo en esta sucursal.
  const keepsPrice = keepsCurrentPrice(input.pricePolicy, before);
  const sellingPrice = resolveTripSellingPrice({
    pricePolicy: input.pricePolicy,
    recalculatedSellingPrice: input.recalculatedSellingPrice,
    current: before,
    costPerPiece: input.costPerPiece,
    targetMarginPercent: input.targetMarginPercent,
    targetMarginRoundingMultiple: input.targetMarginRoundingMultiple,
  });
  const writeGlobalPrice = !costOnly && (input.updateGlobalPrice ?? true);

  await tx.timberProduct.update({
    where: { id: input.timberProductId },
    data: {
      timberType: input.priceGroup,
      boardFeet: new Decimal(input.boardFeet),
      baseCost: new Decimal(input.costPerPiece),
      pricePerInch: new Decimal(input.pricePerInch),
      ...(writeGlobalPrice ? { sellingPrice: new Decimal(sellingPrice) } : {}),
      varaLength: input.varaLength,
    },
  });

  if (writeGlobalPrice) {
    await tx.product.update({
      where: { id: input.productId },
      data: { standardSalePrice: new Decimal(sellingPrice) },
    });
  }

  // "revisa todo... para evitar bugs" — si input.productId es un miembro
  // DERIVADO de una fusión (un producto de madera podría estarlo, nada lo
  // impide), branchCost quedaba guardado en una fila que
  // resolveEffectivePricing ignora (solo lee la del canónico) — dato
  // fantasma. El precio SÍ se queda en input.productId siempre (los
  // precios de venta por presentación son individuales, nunca se
  // redirigen) — mismo criterio que el resto del motor.
  const timberConversion = await getProductStockConversion(tx, input.productId);
  const timberCostTarget = resolveGlobalCostWriteTarget({
    requestedProductId: input.productId,
    enteredCost: input.costPerPiece,
    conversion: timberConversion,
  });
  const priceFields = keepsPrice
    ? {}
    : { branchPrice: new Decimal(sellingPrice), priceSource: "TIMBER_TRIP", lastPriceUpdateAt: new Date(), priceUpdatedByUserId: input.actorUserId };
  const costFields = timberCostTarget.redirected ? {} : { branchCost: new Decimal(timberCostTarget.costForTarget) };
  await tx.branchProductSetting.upsert({
    where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
    create: { branchId: input.branchId, productId: input.productId, ...priceFields, ...costFields },
    update: { ...priceFields, ...costFields },
  });
  if (timberCostTarget.redirected) {
    const canonicalBranchCost = new Decimal(timberCostTarget.costForTarget);
    await tx.branchProductSetting.upsert({
      where: { branchId_productId: { branchId: input.branchId, productId: timberCostTarget.targetProductId } },
      create: { branchId: input.branchId, productId: timberCostTarget.targetProductId, branchCost: canonicalBranchCost },
      update: { branchCost: canonicalBranchCost },
    });
  }

  const after: TimberCostInjectionSnapshot = {
    baseCost: input.costPerPiece,
    sellingPrice: writeGlobalPrice ? sellingPrice : before.sellingPrice,
    standardSalePrice: writeGlobalPrice ? sellingPrice : before.standardSalePrice,
    branchCost: input.costPerPiece,
    branchPrice: keepsPrice ? before.branchPrice : sellingPrice,
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
