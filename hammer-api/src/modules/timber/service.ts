import { prisma } from "@/lib/prisma";
import {
  calculateTimber,
  calculateTimberTrip,
  calculateReconciliation,
  calculateTargetMarginPrice,
  calculateBoardFeet,
  getPricePerInch,
  DEFAULT_PRICING,
  DEFAULT_CLASSIFICATION_CONFIG,
  DEFAULT_CUBICATION_TABLE,
  type TimberPricing,
  type TimberTripLineInput,
  type TimberPriceGroup,
  type TimberClassificationConfig,
  type CubicationRow,
} from "./calculator";
import { readExcelBase64 } from "@/modules/import-excel/excel-reader";
import type {
  CreateTimberProductInput,
  UpdateTimberProductInput,
  CreateTimberTripInput,
  UpdateTimberTripInput,
  UpdateTimberPricingConfigInput,
} from "./validators";
import { Decimal } from "@prisma/client/runtime/library";
import { Prisma as PrismaRuntime } from "@prisma/client";
import { createHash, randomUUID } from "crypto";
import { generateSkuForProduct, parseWoodDimensions } from "@/modules/catalog/sku-generator";
import { buildProductSearchWhere, tokenize, type SearchableField } from "@/modules/catalog/product-search";
import { getEffectiveProductPricing, getEffectiveProductPricingBatch } from "@/modules/catalog/effective-pricing";
import { resolveGlobalCostWriteTarget, branchProductScopeFilter, excludeDerivedStockGroupMembers } from "@/modules/catalog/service";
import { createInventoryMovementTx } from "@/modules/inventory/service";
import { getProductStockConversion } from "@/modules/inventory/unit-conversion";
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

const WOOD_CATEGORY_WHERE: Prisma.CategoryWhereInput = {
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

function timberDescription(priceGroup: string, thickness: number, width: number, lengthFeet: number, varaLength: number, boardFeet: number): string {
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
async function findWoodIdentity(
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

/** Precio vigente EN la sucursal destino: el propio, si no el general, si no el último de madera. */
function currentBranchSellingPrice(current: Pick<TimberCostInjectionSnapshot, "branchPrice" | "standardSalePrice" | "sellingPrice">): number | null {
  return current.branchPrice ?? current.standardSalePrice ?? current.sellingPrice;
}

/** El precio que deja un viaje — misma regla para la vista previa y para applyTimberCostsTx. COST_ONLY = el vigente en ESTA sucursal. */
function resolveTripSellingPrice(input: {
  pricePolicy: string;
  recalculatedSellingPrice: number;
  current: Pick<TimberCostInjectionSnapshot, "branchPrice" | "standardSalePrice" | "sellingPrice">;
  costPerPiece: number;
  targetMarginPercent: number;
  targetMarginRoundingMultiple: number;
}): number {
  if (input.pricePolicy === "COST_ONLY") return currentBranchSellingPrice(input.current) ?? input.recalculatedSellingPrice;
  return resolveSellingPriceForPolicy({
    pricePolicy: input.pricePolicy,
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
  const priceFields = costOnly
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
    branchPrice: costOnly ? before.branchPrice : sellingPrice,
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
/**
 * Madera v2 Fase 4 — configuración como datos. Un solo mecanismo (este) para toda la
 * config del módulo: precios, clasificación (tabla de cubicación + anchos), margen
 * objetivo/redondeo, tolerancia de conciliación y los 2 flags de alerta. Las constantes
 * de calculator.ts son SOLO la semilla del primer registro — a partir de ahí, todo
 * consumidor (calculateTimber/calculateTimberTrip, confirmTimberTrip, etc.) recibe esta
 * config por parámetro, nunca lee las constantes directamente.
 */
export type TimberFullConfig = TimberPricing & {
  classification: TimberClassificationConfig;
  targetMarginPercent: number;
  targetMarginRoundingMultiple: number;
  reconciliationTolerancePercent: number;
  warnBelowTargetMargin: boolean;
  blockNegativeMargin: boolean;
  /** true solo si se pidió un branchId y existe una fila propia de esa sucursal — false si se cayó al default global. */
  isBranchOverride: boolean;
};

/**
 * branchId opcional — mismo patrón de fallback que usan los demás overrides por
 * sucursal del proyecto: fila propia de la sucursal si existe, si no la fila
 * global (branchId null). Sin branchId, siempre resuelve la global — igual que
 * antes de que existieran los overrides.
 */
export async function getPricingConfig(branchId?: string | null): Promise<TimberFullConfig> {
  const cfg = branchId
    ? (await prisma.timberPricingConfig.findFirst({ where: { branchId } })) ??
      (await prisma.timberPricingConfig.findFirst({ where: { branchId: null } }))
    : await prisma.timberPricingConfig.findFirst({ where: { branchId: null } });

  if (!cfg) {
    return {
      ...DEFAULT_PRICING,
      classification: DEFAULT_CLASSIFICATION_CONFIG,
      targetMarginPercent: 0.4,
      targetMarginRoundingMultiple: 1,
      reconciliationTolerancePercent: 0.01,
      warnBelowTargetMargin: true,
      blockNegativeMargin: true,
      isBranchOverride: false,
    };
  }
  const cubicationTable = Array.isArray(cfg.cubicationTable) && cfg.cubicationTable.length > 0
    ? (cfg.cubicationTable as unknown as CubicationRow[])
    : DEFAULT_CUBICATION_TABLE;
  const tablaWidths = Array.isArray(cfg.tablaWidths) && cfg.tablaWidths.length > 0
    ? (cfg.tablaWidths as unknown as number[])
    : DEFAULT_CLASSIFICATION_CONFIG.tablaWidths;
  const tablillaWidths = Array.isArray(cfg.tablillaWidths) && cfg.tablillaWidths.length > 0
    ? (cfg.tablillaWidths as unknown as number[])
    : DEFAULT_CLASSIFICATION_CONFIG.tablillaWidths;

  return {
    costPerFoot: cfg.costPerFoot.toNumber(),
    pricePerInchTabla: cfg.pricePerInchTabla.toNumber(),
    pricePerInchTablilla: cfg.pricePerInchTablilla.toNumber(),
    pricePerInchCuadro: cfg.pricePerInchCuadro.toNumber(),
    classification: { cubicationTable, tablaWidths, tablillaWidths },
    targetMarginPercent: cfg.targetMarginPercent.toNumber(),
    targetMarginRoundingMultiple: cfg.targetMarginRoundingMultiple.toNumber(),
    reconciliationTolerancePercent: cfg.reconciliationTolerancePercent.toNumber(),
    warnBelowTargetMargin: cfg.warnBelowTargetMargin,
    blockNegativeMargin: cfg.blockNegativeMargin,
    isBranchOverride: !!branchId && cfg.branchId === branchId,
  };
}

/**
 * Update pricing config. Sin branchId, actualiza (o crea) la fila global —
 * igual que siempre. Con branchId, upsert sobre la fila de esa sucursal
 * específica; si no existe todavía, se crea copiando del default global los
 * campos que el input no trae (mismos valores de partida que vería un Master
 * que recién empieza a personalizar esa sucursal).
 */
export async function updatePricingConfig(
  input: UpdateTimberPricingConfigInput,
  userId?: string,
  branchId?: string | null,
  client: Pick<Prisma.TransactionClient, "timberPricingConfig"> = prisma,
) {
  const data = {
    costPerFoot: new Decimal(input.costPerFoot),
    pricePerInchTabla: new Decimal(input.pricePerInchTabla),
    pricePerInchTablilla: new Decimal(input.pricePerInchTablilla),
    pricePerInchCuadro: new Decimal(input.pricePerInchCuadro),
    ...(input.cubicationTable !== undefined ? { cubicationTable: input.cubicationTable } : {}),
    ...(input.tablaWidths !== undefined ? { tablaWidths: input.tablaWidths } : {}),
    ...(input.tablillaWidths !== undefined ? { tablillaWidths: input.tablillaWidths } : {}),
    ...(input.targetMarginPercent !== undefined ? { targetMarginPercent: new Decimal(input.targetMarginPercent) } : {}),
    ...(input.targetMarginRoundingMultiple !== undefined ? { targetMarginRoundingMultiple: new Decimal(input.targetMarginRoundingMultiple) } : {}),
    ...(input.reconciliationTolerancePercent !== undefined ? { reconciliationTolerancePercent: new Decimal(input.reconciliationTolerancePercent) } : {}),
    ...(input.warnBelowTargetMargin !== undefined ? { warnBelowTargetMargin: input.warnBelowTargetMargin } : {}),
    ...(input.blockNegativeMargin !== undefined ? { blockNegativeMargin: input.blockNegativeMargin } : {}),
    updatedBy: userId,
  };

  if (branchId) {
    const existing = await client.timberPricingConfig.findFirst({ where: { branchId } });
    if (existing) {
      return client.timberPricingConfig.update({ where: { id: existing.id }, data });
    }
    const globalDefault = await client.timberPricingConfig.findFirst({ where: { branchId: null } });
    return client.timberPricingConfig.create({
      data: {
        branchId,
        cubicationTable: globalDefault?.cubicationTable ?? undefined,
        tablaWidths: globalDefault?.tablaWidths ?? undefined,
        tablillaWidths: globalDefault?.tablillaWidths ?? undefined,
        targetMarginPercent: globalDefault?.targetMarginPercent ?? new Decimal(0.4),
        targetMarginRoundingMultiple: globalDefault?.targetMarginRoundingMultiple ?? new Decimal(1),
        reconciliationTolerancePercent: globalDefault?.reconciliationTolerancePercent ?? new Decimal(0.01),
        warnBelowTargetMargin: globalDefault?.warnBelowTargetMargin ?? true,
        blockNegativeMargin: globalDefault?.blockNegativeMargin ?? true,
        ...data,
      },
    });
  }

  const existing = await client.timberPricingConfig.findFirst({ where: { branchId: null } });
  if (existing) {
    return client.timberPricingConfig.update({ where: { id: existing.id }, data });
  }
  return client.timberPricingConfig.create({ data });
}

/* ══════════════════════════════════════════════════════════
   Recálculo masivo de precio de venta (cambio de precio por pulgada)
   ══════════════════════════════════════════════════════════ */

export type TimberSalePriceRecalcRow = {
  productId: string;
  sku: string;
  name: string;
  branchId: string;
  branchName: string;
  currentPrice: number;
  newPrice: number;
  difference: number;
};

/**
 * Pura — sin DB — para poder testear el cálculo del recálculo masivo sin
 * montar productos/tx falsos. timberType y varaLength ya están guardados en
 * el TimberProduct (se fijaron al cubicar/confirmar el viaje) — NO se
 * re-clasifica acá. Si se reclasificara con la tabla de cubicación/anchos
 * vigente, un producto podría "saltar" de grupo (p.ej. CUADRO → TABLA) solo
 * porque cambió la config, sin que nadie haya tocado ESE producto — el
 * recálculo de precio debe variar únicamente por el pricePerInch nuevo, no
 * por una reclasificación implícita. Misma fórmula que calculateTimber
 * (thickness × width × varaLength × pricePerInch[grupo]), sin pasar por
 * calculateTimber/classifyTimber.
 */
export function recalcTimberSalePrice(
  tp: { timberType: string; thickness: number; width: number; varaLength: number },
  pricing: TimberPricing,
): { priceGroup: TimberPriceGroup; pricePerInch: number; newPrice: number } {
  const priceGroup: TimberPriceGroup =
    tp.timberType === "TABLA" || tp.timberType === "TABLILLA" || tp.timberType === "CUADRO" ? tp.timberType : "CUADRO";
  const pricePerInch = getPricePerInch(priceGroup, pricing);
  const newPrice = roundMoney(tp.thickness * tp.width * tp.varaLength * pricePerInch);
  return { priceGroup, pricePerInch, newPrice };
}

async function previewForBranch(
  branch: { id: string; name: string },
  pricing: TimberFullConfig,
): Promise<TimberSalePriceRecalcRow[]> {
  const products = await prisma.product.findMany({
    where: { isTimber: true, isActive: true, ...branchProductScopeFilter(branch.id) },
    include: {
      timberProduct: true,
      branchProductSettings: { where: { branchId: branch.id }, select: { branchPrice: true } },
    },
  });

  const rows: TimberSalePriceRecalcRow[] = [];
  for (const product of products) {
    const tp = product.timberProduct;
    if (!tp) continue;
    const { newPrice } = recalcTimberSalePrice(
      { timberType: tp.timberType, thickness: tp.thickness.toNumber(), width: tp.width.toNumber(), varaLength: tp.varaLength },
      pricing,
    );
    const currentPrice = product.branchProductSettings[0]?.branchPrice?.toNumber() ?? product.standardSalePrice.toNumber();
    if (newPrice === currentPrice) continue;
    rows.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      branchId: branch.id,
      branchName: branch.name,
      currentPrice,
      newPrice,
      difference: roundMoney(newPrice - currentPrice),
    });
  }
  return rows;
}

/**
 * Vista previa (sin escribir nada) de cómo cambiaría sellingPrice de cada
 * TimberProduct al recalcular con el pricing vigente. Usa la MISMA fórmula
 * que calculateTimber (thickness × width × varaLength × pricePerInch[grupo])
 * pero sin pasar por calculateTimber/classifyTimber — timberType y varaLength
 * ya están guardados en cada TimberProduct, así que solo cambia el
 * pricePerInch (getPricePerInch), nunca la clasificación.
 *
 * Alcance: con branchId, solo esa sucursal (los productos que
 * branchProductScopeFilter considera "de" esa sucursal — mismo filtro que ya
 * usa el catálogo para POS/inventario). Sin branchId (se cambió el default
 * global), el alcance es TODAS las sucursales que NO tienen su propio
 * override — una sucursal con override propio no se mueve por un cambio al
 * global, así que queda afuera de la vista previa a propósito.
 */
export async function previewTimberSalePriceRecalc(branchId?: string | null): Promise<TimberSalePriceRecalcRow[]> {
  if (branchId) {
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new Error("BRANCH_NOT_FOUND");
    return previewForBranch(branch, await getPricingConfig(branchId));
  }

  const [branches, overrides, globalPricing] = await Promise.all([
    prisma.branch.findMany({ where: { isActive: true } }),
    prisma.timberPricingConfig.findMany({ where: { branchId: { not: null } }, select: { branchId: true } }),
    getPricingConfig(null),
  ]);
  const overriddenBranchIds = new Set(overrides.map((o) => o.branchId));

  const rows: TimberSalePriceRecalcRow[] = [];
  for (const branch of branches) {
    if (overriddenBranchIds.has(branch.id)) continue;
    rows.push(...(await previewForBranch(branch, globalPricing)));
  }
  return rows;
}

/**
 * Escribe una lista ya calculada de filas: SOLO branchPrice en
 * BranchProductSetting (nunca branchCost), y solo para el branchId de cada
 * fila — mismo campo/patrón que ya usa applyTimberCostsTx para viajes, sin
 * mecanismo nuevo de escritura de precio. Separada de applyTimberSalePriceRecalc
 * (que resuelve las filas desde la DB) para poder probar el alcance de la
 * escritura con un tx de prueba, igual que injection.test.ts prueba
 * applyTimberCostsTx.
 */
export async function applyTimberSalePriceRecalcRowsTx(
  tx: Prisma.TransactionClient,
  rows: TimberSalePriceRecalcRow[],
  userId?: string,
): Promise<void> {
  for (const row of rows) {
    await tx.branchProductSetting.upsert({
      where: { branchId_productId: { branchId: row.branchId, productId: row.productId } },
      create: {
        branchId: row.branchId,
        productId: row.productId,
        branchPrice: new Decimal(row.newPrice),
        priceSource: "TIMBER_PRICE_PER_INCH_RECALC",
        lastPriceUpdateAt: new Date(),
        priceUpdatedByUserId: userId,
      },
      update: {
        branchPrice: new Decimal(row.newPrice),
        priceSource: "TIMBER_PRICE_PER_INCH_RECALC",
        lastPriceUpdateAt: new Date(),
        priceUpdatedByUserId: userId,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        branchId: row.branchId,
        module: "timber",
        action: "TIMBER_SALE_PRICE_RECALCULATED",
        entityType: "Product",
        entityId: row.productId,
        metadataJson: { before: row.currentPrice, after: row.newPrice, difference: row.difference },
      },
    });
  }
}

/**
 * Recalcula la vista previa en el momento de escribir (no hay selección
 * parcial de filas — "aplicar" es todo lo que la vista previa muestre en ese
 * instante para esa sucursal) y la escribe con applyTimberSalePriceRecalcRowsTx.
 *
 * Solo una sucursal concreta a la vez — nunca el default global — para que
 * una escritura masiva nunca cruce sucursales sin que quien la dispare haya
 * elegido cuál.
 */
export async function applyTimberSalePriceRecalc(
  branchId: string,
  userId?: string,
): Promise<{ applied: number; rows: TimberSalePriceRecalcRow[] }> {
  if (!branchId) throw new Error("BRANCH_ID_REQUIRED");
  const rows = await previewTimberSalePriceRecalc(branchId);
  if (rows.length === 0) return { applied: 0, rows: [] };

  await prisma.$transaction((tx) => applyTimberSalePriceRecalcRowsTx(tx, rows, userId));

  return { applied: rows.length, rows };
}

/* ══════════════════════════════════════════════════════════
   Costo por pie fijado por sucursal y existencias en pies
   ══════════════════════════════════════════════════════════ */

/** Largo en pies de un nombre del catálogo, donde el tercer número son varas: "2X4X6" = 16 pies. */
function catalogLengthFeet(varas: number, cubicationTable: CubicationRow[]): number {
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

/* ══════════════════════════════════════════════════════════
   Timber Trips (Viajes de Madera)
   ══════════════════════════════════════════════════════════ */

/** Código de trabajo de un viaje sin número: BOR = borrador, CAN = cancelado. Solo el ingreso consume correlativo. */
function provisionalTripCode(prefix: "BOR" | "CAN"): string {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

/** Año de Managua: el servidor corre en UTC y el 31/12 por la noche ya sería el año siguiente. */
export function tripCodePrefix(at: Date = new Date()): string {
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Managua", year: "numeric" }).format(at);
  return `VJM-${year}-`;
}

/** Comparación numérica: como texto, "VJM-2026-1000" ordena antes que "VJM-2026-999". */
export function nextTripCodeFrom(prefix: string, confirmedCodes: string[]): string {
  const last = confirmedCodes.reduce((max, code) => {
    const number = code.startsWith(prefix) ? Number(code.slice(prefix.length)) : 0;
    return Number.isInteger(number) && number > max ? number : max;
  }, 0);
  return `${prefix}${String(last + 1).padStart(3, "0")}`;
}

/** Número que saldría si se ingresa un viaje ahora: el siguiente a los YA ingresados. Cancelados y borradores no cuentan. */
async function getNextTripCode(client: Pick<Prisma.TransactionClient, "timberTrip"> = prisma): Promise<string> {
  const prefix = tripCodePrefix();
  const confirmed = await client.timberTrip.findMany({
    where: { tripCode: { startsWith: prefix }, status: { in: ["CONFIRMED", "TRANSFERRED"] } },
    select: { tripCode: true },
  });
  return nextTripCodeFrom(prefix, confirmed.map((trip) => trip.tripCode));
}

/**
 * Asigna el número definitivo dentro de la transacción de confirmar. El candado serializa dos
 * ingresos simultáneos (dos borradores abiertos no pueden sacar el mismo número). Si el número
 * lo tiene un viaje viejo sin ingresar (antes se numeraba al crear), ese viaje lo cede.
 */
export async function assignTripCodeTx(tx: Prisma.TransactionClient, tripId: string): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('timber_trip_code'))`;
  const tripCode = await getNextTripCode(tx);
  const holder = await tx.timberTrip.findUnique({ where: { tripCode }, select: { id: true, status: true } });
  if (holder && holder.id !== tripId) {
    await tx.timberTrip.update({
      where: { id: holder.id },
      data: { tripCode: provisionalTripCode(holder.status === "CANCELLED" ? "CAN" : "BOR") },
    });
  }
  await tx.timberTrip.update({ where: { id: tripId }, data: { tripCode } });
  return tripCode;
}

/** Create a new timber trip with lines */
export async function createTimberTrip(input: CreateTimberTripInput, userId?: string) {
  const pricing = await getPricingConfig(input.destinationBranchId);
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
    targetMarginPercent: pricing.targetMarginPercent,
    classification: pricing.classification,
  });

  const trip = await prisma.$transaction(async (tx) => {
    const newTrip = await tx.timberTrip.create({
      data: {
        tripCode: provisionalTripCode("BOR"),
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

  const pricing = await getPricingConfig(existing.destinationBranchId);
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
    { costPerFootInput: input.costPerFoot, expenses, targetMarginPercent: pricing.targetMarginPercent, classification: pricing.classification },
  );

  const trip = await prisma.$transaction(async (tx) => {
    // El chequeo de DRAFT de arriba es fuera de la transacción: un
    // autoguardado que llega justo después de confirmar reemplazaba las
    // líneas y totales de un viaje ya inyectado. Candado + rechequeo acá.
    await tx.$queryRaw`SELECT id FROM "TimberTrip" WHERE id = ${id} FOR UPDATE`;
    const locked = await tx.timberTrip.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (locked.status !== "DRAFT") throw new Error("TRIP_NOT_EDITABLE");

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

  // BUG FIX (crash en produccion): getTimberTrip adjunta `reconciliation` al
  // trip que devuelve, pero este endpoint (el que dispara el autoguardado
  // con debounce del frontend) devolvia el trip crudo de Prisma sin ese
  // campo. El frontend lee `trip.reconciliation.status` incondicionalmente
  // (StepViajeYCubicacion/StepConfirmar) — apenas el autoguardado reemplazaba
  // el trip en el estado, la siguiente renderizacion crasheaba con
  // "Cannot read properties of undefined (reading 'status')". Mismo calculo
  // que getTimberTrip, reutilizando el `pricing` ya cargado arriba.
  const reconciliation = calculateReconciliation(
    trip.totalFeet.toNumber(),
    trip.invoicedFeet != null ? trip.invoicedFeet.toNumber() : null,
    pricing.reconciliationTolerancePercent,
  );

  return { trip: { ...trip, reconciliation }, calculation: calc };
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
  productName: string;
  sku: string | null;
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
    const { product, timberProductId } = await findWoodIdentity(prisma, line);
    const productId = product?.id ?? null;

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
      productName: product?.name ?? timberCatalogName(line.thicknessIn, line.widthIn, line.varaLength),
      sku: product?.sku ?? null,
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
  /** Producto del catálogo que recibe el stock (o el nombre con el que se creará). */
  productName: string;
  sku: string | null;
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

  const marginConfig = await getPricingConfig(trip.destinationBranchId);
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

    const current = {
      branchPrice: branchSettingBefore?.branchPrice?.toNumber() ?? null,
      standardSalePrice: productBefore?.standardSalePrice.toNumber() ?? null,
      sellingPrice: timberProductBefore?.sellingPrice.toNumber() ?? null,
    };
    const sellingPriceAfter = resolveTripSellingPrice({
      pricePolicy: trip.pricePolicy,
      recalculatedSellingPrice: line.recalculatedSellingPrice,
      current,
      costPerPiece: line.costPerPiece,
      targetMarginPercent: marginConfig.targetMarginPercent,
      targetMarginRoundingMultiple: marginConfig.targetMarginRoundingMultiple,
    });

    lines.push({
      lineId: line.lineId,
      dimensions: line.dimensions,
      isNewProduct: line.isNewProduct,
      productId: line.productId,
      productName: line.productName,
      sku: line.sku,
      piecesToAdd: line.pieces,
      costPerPiece: { before: timberProductBefore?.baseCost.toNumber() ?? null, after: line.costPerPiece },
      wac: { before: balanceBefore ? wacActual : null, after: roundMoney(wacAfter) },
      branchCost: { before: branchSettingBefore?.branchCost?.toNumber() ?? null, after: line.costPerPiece },
      // "antes" = el precio vigente EN la sucursal destino (lo que se pisa), no el general.
      sellingPrice: { before: currentBranchSellingPrice(current), after: sellingPriceAfter },
    });
  }

  // Sin lineId: updateTimberTrip borra y recrea las líneas en cada guardado
  // (ids nuevos), y la pantalla guarda justo antes de confirmar — con el id
  // en el hash, confirmar desde la UI daba "preview viejo" siempre.
  const hash = createHash("sha256").update(JSON.stringify(lines.map(({ lineId: _lineId, ...rest }) => rest))).digest("hex");
  return { tripId: trip.id, tripCode: trip.tripCode, pricePolicy: trip.pricePolicy, lines, hash };
}

/** Alguna medida queda vendiéndose bajo su costo con el precio que deja la política del viaje. */
export function hasNegativeMarginInPreview(lines: Array<Pick<TimberInjectionLinePreview, "costPerPiece" | "sellingPrice">>): boolean {
  return lines.some((line) => line.sellingPrice.after < line.costPerPiece.after);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundFeet(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

// Sin acentos que despojar: los alias de encabezado que se comparan acá
// (medida, piezas, cantidad, etc.) son todos ASCII simple — a diferencia
// de normalizeHeader en import-excel/import-service.ts, no hace falta
// pasar por NFD.
function normalizeCubicationHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * prompt-timber-cubicacion-carga.md, Parte B — "1 X 12 X16" / "2 x 4 x 11":
 * el aserradero manda mayúsculas y espaciado inconsistentes, tolerante a
 * cero o varios espacios alrededor de cada "x".
 */
const MEDIDA_PATTERN = /^\s*(\d+)\s*[xX]\s*(\d+)\s*[xX]\s*(\d+)\s*$/;

type TimberCubicationImportRecognizedLine = {
  thickness: number;
  width: number;
  length: number;
  pieces: number;
  /** Recalculado con calculateBoardFeet (la fórmula propia) — la columna PIES del archivo NUNCA se usa. */
  calculatedFeet: number;
  /** Piezas que ya tenía esta medida en el viaje, si existía — null si es una medida nueva. */
  existingPieces: number | null;
  action: "CREATE" | "UPDATE";
};

type TimberCubicationImportUnrecognizedRow = {
  rowNumber: number;
  rawMedida: string;
  rawPiezas: string;
  reason: string;
};

export type TimberCubicationImportPreview = {
  tripId: string;
  tripCode: string;
  recognized: TimberCubicationImportRecognizedLine[];
  unrecognized: TimberCubicationImportUnrecognizedRow[];
};

/**
 * prompt-timber-cubicacion-carga.md, Parte B — pura, exportada para
 * test: parsea la matriz cruda (ya leída por readExcelBase64) contra las
 * piezas que YA existen en el viaje (`existingByKey`, sin tocar DB acá).
 * Separada de previewTimberCubicationImport para poder probar la parte
 * que de verdad puede fallar (regex tolerante a mayúsculas/espacios,
 * fila TOTALES, medidas repetidas, columnas no encontradas) sin base de
 * datos.
 */
export function parseCubicationMatrix(
  matrix: string[][],
  existingByKey: Map<string, number>,
): Pick<TimberCubicationImportPreview, "recognized" | "unrecognized"> {
  if (matrix.length < 2) throw new Error("EMPTY_CUBICATION_FILE");

  const headers = matrix[0].map(normalizeCubicationHeader);
  const medidaIdx = headers.findIndex((h) => ["medida", "medidas", "dimension", "dimensiones", "corte"].includes(h));
  const piezasIdx = headers.findIndex((h) => ["piezas", "pieza", "cantidad", "cant", "qty", "unidades"].includes(h));
  if (medidaIdx === -1 || piezasIdx === -1) {
    throw new Error("CUBICATION_COLUMNS_NOT_FOUND");
  }

  // Varias filas del archivo pueden traer la MISMA medida (el aserradero
  // separa por tarima/atado) — se suman las piezas antes de comparar
  // contra lo existente, para que el preview refleje un solo CREATE/UPDATE
  // por medida, no uno por fila.
  const recognizedByKey = new Map<string, TimberCubicationImportRecognizedLine>();
  const unrecognized: TimberCubicationImportUnrecognizedRow[] = [];

  for (let rowIdx = 1; rowIdx < matrix.length; rowIdx += 1) {
    const row = matrix[rowIdx];
    const rawMedida = (row[medidaIdx] ?? "").trim();
    const rawPiezas = (row[piezasIdx] ?? "").trim();
    if (!rawMedida) continue; // fila en blanco — no es un dato, no es un error

    // Fila "TOTALES" (u otra fila de resumen) al final de la hoja: se
    // ignora en silencio, no es una medida no reconocida.
    if (/^totales?\b/i.test(rawMedida)) continue;

    const match = MEDIDA_PATTERN.exec(rawMedida);
    const pieces = Number(rawPiezas.replace(",", "."));
    if (!match) {
      unrecognized.push({ rowNumber: rowIdx + 1, rawMedida, rawPiezas, reason: "Formato de medida no reconocido (esperado ej. \"1 X 12 X 16\")" });
      continue;
    }
    if (!Number.isFinite(pieces) || pieces <= 0) {
      unrecognized.push({ rowNumber: rowIdx + 1, rawMedida, rawPiezas, reason: "Piezas vacío, cero o no numérico" });
      continue;
    }

    const thickness = Number(match[1]);
    const width = Number(match[2]);
    const length = Number(match[3]);
    const key = `${thickness}x${width}x${length}`;
    const existing = recognizedByKey.get(key);
    if (existing) {
      existing.pieces += pieces;
      existing.calculatedFeet = roundFeet(calculateBoardFeet({ thickness, width, length }) * existing.pieces);
      continue;
    }
    const existingPieces = existingByKey.get(key) ?? null;
    recognizedByKey.set(key, {
      thickness,
      width,
      length,
      pieces,
      calculatedFeet: roundFeet(calculateBoardFeet({ thickness, width, length }) * pieces),
      existingPieces,
      action: existingPieces !== null ? "UPDATE" : "CREATE",
    });
  }

  return { recognized: Array.from(recognizedByKey.values()), unrecognized };
}

/**
 * prompt-timber-cubicacion-carga.md, Parte B — vista previa de una carga
 * de cubicación completa desde el Excel que el usuario recuenta a mano
 * (hoja "Simple", columna MEDIDA + PIEZAS; columna PIES del archivo se
 * ignora siempre — se recalcula acá con calculateBoardFeet, la MISMA
 * fórmula que usa el resto del módulo, no una copia). No escribe nada:
 * el llamador aplica el resultado editando `lines` en el cliente (mismo
 * mecanismo que updateLinePieces/addMeasure en timber-workspace.tsx) y
 * lo guarda con el PUT de siempre — no hay un camino de escritura nuevo.
 */
export async function previewTimberCubicationImport(id: string, fileBase64: string): Promise<TimberCubicationImportPreview> {
  const trip = await prisma.timberTrip.findUnique({ where: { id }, include: { lines: true } });
  if (!trip) throw new Error("TIMBER_TRIP_NOT_FOUND");

  const matrix = await readExcelBase64(fileBase64, "Simple");
  const existingByKey = new Map(trip.lines.map((line) => [`${line.thicknessIn}x${line.widthIn}x${line.lengthIn}`, line.pieces]));
  const { recognized, unrecognized } = parseCubicationMatrix(matrix, existingByKey);

  return { tripId: trip.id, tripCode: trip.tripCode, recognized, unrecognized };
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
  options: { expectedHash?: string; acknowledgeReconciliation?: boolean; marginOverrideReason?: string } = {},
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
  // Y un costo de la MADERA > 0: solo con gastos (flete, etc.) el costo aterrizado salía > 0 sin costo de compra.
  if (trip.woodTripTotalCost.lte(0) || trip.landedCostPerFoot.lte(0)) {
    throw new Error("TRIP_REQUIRES_COST");
  }

  const config = await getPricingConfig(trip.destinationBranchId);
  const reconciliation = calculateReconciliation(
    trip.totalFeet.toNumber(),
    trip.invoicedFeet != null ? trip.invoicedFeet.toNumber() : null,
    config.reconciliationTolerancePercent,
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

  // Madera v2 Fase 3 — margen negativo en CUALQUIER línea bloquea la confirmación salvo
  // override explícito con motivo (queda auditado). Margen bajo el objetivo NUNCA bloquea
  // por sí solo — eso es solo un aviso visible en el frontend (Fase 5).
  // Con el precio que deja la POLÍTICA del viaje (el de la vista previa), no el
  // calculado por pulgada: "margen objetivo" nunca queda bajo costo y pedía motivo igual.
  const hasNegativeMarginLine = hasNegativeMarginInPreview(freshPreview.lines);
  if (config.blockNegativeMargin && hasNegativeMarginLine && !options.marginOverrideReason?.trim()) {
    throw new Error("NEGATIVE_MARGIN_REQUIRES_OVERRIDE");
  }

  return prisma.$transaction(async (tx) => {
    // Mismo candado que updateTimberTrip/cancelTimberTrip: serializa confirmar
    // contra el autoguardado. Si el viaje cambió desde que se leyó arriba (un
    // autoguardado entró en medio), las líneas de `trip` ya no son las reales.
    await tx.$queryRaw`SELECT id FROM "TimberTrip" WHERE id = ${id} FOR UPDATE`;
    const locked = await tx.timberTrip.findUniqueOrThrow({ where: { id }, select: { status: true, updatedAt: true } });
    if (locked.status !== "DRAFT" && locked.status !== "CUBICADO") throw new Error("TRIP_ALREADY_CONFIRMED");
    if (locked.updatedAt.getTime() !== trip.updatedAt.getTime()) throw new Error("INJECTION_PREVIEW_STALE");

    const tripCode = await assignTripCodeTx(tx, id);

    // updateGlobalPrice: solo si el precio sale de la config GLOBAL por
    // pulgada — un override de sucursal o un margen sobre el costo de ESTE
    // viaje es un precio de esa sucursal, no el respaldo de las demás.
    const updateGlobalPrice = trip.pricePolicy === "RECALC_FROM_PRICE_PER_INCH" && !config.isBranchOverride;

    for (const line of trip.lines) {
      if (line.pieces <= 0) continue;
      const { productId, timberProductId } = await resolveTimberProductIdentityTx(tx, line);

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
        targetMarginPercent: config.targetMarginPercent,
        targetMarginRoundingMultiple: config.targetMarginRoundingMultiple,
        updateGlobalPrice,
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
        notes: `Viaje de madera ${tripCode} — ${line.thicknessIn}"×${line.widthIn}"×${line.lengthIn} pies`,
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
        marginOverrideReason: hasNegativeMarginLine ? options.marginOverrideReason?.trim() : trip.marginOverrideReason,
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
          tripCode,
          totalPieces: trip.totalPieces,
          totalFeet: trip.totalFeet.toString(),
          totalCost: trip.totalCost.toString(),
          landedCostPerFoot: trip.landedCostPerFoot.toString(),
          linesInjected: trip.lines.length,
          reconciliationStatus: reconciliation.status,
          reconciliationAcknowledged: reconciliation.status === "REVIEW",
          hasNegativeMarginLine,
          marginOverrideReason: hasNegativeMarginLine ? options.marginOverrideReason?.trim() ?? null : null,
        },
      },
    });

    // Mismo shape que getTimberTrip/updateTimberTrip (`reconciliation` ya
    // calculado arriba en esta función) — evita que un futuro consumidor de
    // este trip caiga en el mismo `trip.reconciliation.status` sobre undefined.
    return { ...updated, reconciliation };
    // El default de 5 s no alcanza: la hoja real trae ~50 medidas y cada una son ~20 consultas.
  }, { timeout: 60000, maxWait: 10000 });
}

/** Cancel a timber trip */
export async function cancelTimberTrip(id: string) {
  const trip = await prisma.timberTrip.findUnique({ where: { id } });
  if (!trip) throw new Error("TIMBER_TRIP_NOT_FOUND");
  if (trip.status === "TRANSFERRED" || trip.status === "CANCELLED") {
    throw new Error("TRIP_CANNOT_BE_CANCELLED");
  }

  // Condicionado al estado: si un confirmar entró en medio (ya TRANSFERRED),
  // no se marca cancelado un viaje que ya está en inventario.
  const transition = await prisma.timberTrip.updateMany({
    where: { id, status: { notIn: ["TRANSFERRED", "CANCELLED"] } },
    data: { status: "CANCELLED" },
  });
  if (transition.count === 0) throw new Error("TRIP_CANNOT_BE_CANCELLED");
  const cancelled = await prisma.timberTrip.findUniqueOrThrow({
    where: { id },
    include: { lines: true, destinationBranch: true },
  });

  // Mismo shape que getTimberTrip/updateTimberTrip/confirmTimberTrip.
  const config = await getPricingConfig(cancelled.destinationBranchId);
  const reconciliation = calculateReconciliation(
    cancelled.totalFeet.toNumber(),
    cancelled.invoicedFeet != null ? cancelled.invoicedFeet.toNumber() : null,
    config.reconciliationTolerancePercent,
  );
  return { ...cancelled, reconciliation };
}

/** Get a single trip with lines */
export async function getTimberTrip(id: string) {
  const trip = await prisma.timberTrip.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { createdAt: "asc" } },
      destinationBranch: true,
    },
  });
  if (!trip) return null;

  const config = await getPricingConfig(trip.destinationBranchId);
  const reconciliation = calculateReconciliation(
    trip.totalFeet.toNumber(),
    trip.invoicedFeet != null ? trip.invoicedFeet.toNumber() : null,
    config.reconciliationTolerancePercent,
  );

  return { ...trip, reconciliation, nextTripCode: trip.status === "DRAFT" ? await getNextTripCode() : null };
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
  if (filters?.status) {
    where.status = filters.status;
  } else {
    // prompt-timber-borrador-bugs.md, BUG 1 — sin un status pedido
    // explícito, la lista activa no debe ensuciarse con viajes
    // cancelados (ahora se pueden cancelar desde la interfaz). Quien
    // necesite verlos igual puede pedir status=CANCELLED explícito.
    where.status = { not: "CANCELLED" };
  }
  if (filters?.destinationBranchId) where.destinationBranchId = filters.destinationBranchId;
  if (filters?.search) {
    where.OR = [
      { tripCode: { contains: filters.search, mode: "insensitive" } },
      { supplierName: { contains: filters.search, mode: "insensitive" } },
      { origin: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const [items, total, nextTripCode] = await Promise.all([
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
    getNextTripCode(),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit), nextTripCode };
}
