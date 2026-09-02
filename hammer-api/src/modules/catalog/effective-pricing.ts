import { Prisma, PrismaClient } from "@prisma/client";
import { convertBaseUnitCostToSaleUnitCost, resolveInventoryProductForMovement, getProductStockConversionsBatch } from "@/modules/inventory/unit-conversion";

type PricingClient = PrismaClient | Prisma.TransactionClient;

export type EffectivePricing = {
  productId: string;
  standardSalePrice: Prisma.Decimal;
  branchPrice: Prisma.Decimal | null;
  effectivePrice: Prisma.Decimal | null;
  branchCost: Prisma.Decimal | null;
  weightedAverageCost: Prisma.Decimal | null;
  globalCost: Prisma.Decimal | null;
  averageCost: Prisma.Decimal | null;
  lastPurchaseCost: Prisma.Decimal | null;
  effectiveCost: Prisma.Decimal | null;
  priceSource: "BRANCH" | "STANDARD" | "MISSING" | "FUSION_DERIVED";
  costSource: "BRANCH" | "GLOBAL_AVERAGE" | "GLOBAL" | "LAST_PURCHASE" | "WAC_ESTIMATE" | "NONE";
  /**
   * true cuando el producto es un miembro DERIVADO de una fusión activa (no
   * el canónico). Con esto en true, effectiveCost SIEMPRE sale del canónico
   * × factor — branchCost/averageCost/globalCost/lastPurchaseCost propios
   * del miembro se ignoran para el cálculo (prompt-costos-precios-fusion.md
   * §2.1). false para el canónico y para productos sin fusión.
   */
  isFusionMember: boolean;
  /**
   * Solo con isFusionMember=true: precioBase(canónico) × factor — el precio
   * que tendría esta presentación si nadie la hubiera sobreescrito (§2.2).
   * null cuando el producto no es un miembro derivado.
   */
  impliedFusionPrice: Prisma.Decimal | null;
  /**
   * true si branchPrice está seteado en un miembro derivado: un override
   * DELIBERADO sobre impliedFusionPrice, no "un precio suelto más" (§2.2).
   */
  isFusionPriceOverride: boolean;
  /**
   * prompt-fusionado-invendible-409.md §P-2 — el catálogo del POS avisa
   * ANTES del clic con la MISMA comparación que usa el guard de venta bajo
   * costo (discount-policy.ts validateDiscountForRole, caso sin descuento):
   * BELOW_COST cuando hay costo positivo y el precio efectivo queda por
   * debajo; NO_COST cuando no hay costo conocido (se vende, sin margen
   * visible); OK en cualquier otro caso. Calculado acá, no en el caller, para
   * que la advertencia no pueda divergir del bloqueo real en addSaleOrderLine.
   */
  sellability: "OK" | "BELOW_COST" | "NO_COST";
};

function computeSellability(effectiveCost: Prisma.Decimal | null, effectivePrice: Prisma.Decimal | null): EffectivePricing["sellability"] {
  if (effectiveCost === null || effectiveCost.lte(0)) return "NO_COST";
  if (effectivePrice !== null && effectivePrice.lt(effectiveCost)) return "BELOW_COST";
  return "OK";
}

/**
 * Umbral de desvío (relativo al precio implícito de fusión) que exige
 * confirmación explícita al guardar un override de precio sobre un miembro
 * derivado. 20%: generoso a propósito — vender por metro más barato que por
 * lata suelta es un descuento por volumen legítimo y common, no un error;
 * el umbral solo debe atrapar el caso "C$1,200 en dos factores que difieren
 * 2.2×", no cualquier descuento razonable (prompt-costos-precios-fusion.md §2.2).
 */
export const FUSION_PRICE_OVERRIDE_THRESHOLD = 0.2;

/** |a-b| / referencia, o null si la referencia es <= 0 (división sin sentido). */
export function relativeDeviation(value: Prisma.Decimal, reference: Prisma.Decimal): number | null {
  if (reference.lte(0)) return null;
  return Number(value.sub(reference).abs().div(reference));
}

async function getEffectiveProductPricing(
  txOrPrisma: PricingClient,
  input: { branchId: string; productId: string },
): Promise<EffectivePricing> {
  const product = await txOrPrisma.product.findUniqueOrThrow({
    where: { id: input.productId },
    select: { id: true, standardSalePrice: true, globalCost: true, averageCost: true, lastPurchaseCost: true },
  });

  const stockResolution = await resolveInventoryProductForMovement(txOrPrisma, input.productId);
  const isFusionMember = Boolean(stockResolution.conversion && !stockResolution.conversion.isCanonical);
  const conversionFactor = stockResolution.conversion?.conversionFactor ?? null;

  const [branchSetting, inventoryBalance, canonicalProduct, canonicalBranchSetting] = await Promise.all([
    txOrPrisma.branchProductSetting.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      select: { branchPrice: true, branchCost: true },
    }),
    txOrPrisma.inventoryBalance.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: stockResolution.inventoryProductId } },
      select: { weightedAverageCost: true },
    }),
    isFusionMember
      ? txOrPrisma.product.findUnique({
          where: { id: stockResolution.inventoryProductId },
          select: { standardSalePrice: true, globalCost: true, averageCost: true, lastPurchaseCost: true },
        })
      : Promise.resolve(null),
    isFusionMember
      ? txOrPrisma.branchProductSetting.findUnique({
          where: { branchId_productId: { branchId: input.branchId, productId: stockResolution.inventoryProductId } },
          select: { branchPrice: true, branchCost: true },
        })
      : Promise.resolve(null),
  ]);

  const saleUnitWac = inventoryBalance?.weightedAverageCost && conversionFactor
    ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: inventoryBalance.weightedAverageCost, conversionFactor })
    : inventoryBalance?.weightedAverageCost ?? null;

  return resolveEffectivePricing({
    productId: product.id,
    standardSalePrice: product.standardSalePrice,
    globalCost: product.globalCost,
    averageCost: product.averageCost,
    lastPurchaseCost: product.lastPurchaseCost,
    branchPrice: branchSetting?.branchPrice ?? null,
    branchCost: branchSetting?.branchCost ?? null,
    weightedAverageCost: saleUnitWac,
    fusion: isFusionMember && conversionFactor && canonicalProduct
      ? {
          conversionFactor,
          canonicalBranchCost: canonicalBranchSetting?.branchCost ?? null,
          canonicalAverageCost: canonicalProduct.averageCost ?? null,
          canonicalGlobalCost: canonicalProduct.globalCost ?? null,
          canonicalLastPurchaseCost: canonicalProduct.lastPurchaseCost ?? null,
          canonicalBaseWeightedAverageCost: inventoryBalance?.weightedAverageCost ?? null,
          canonicalBranchPrice: canonicalBranchSetting?.branchPrice ?? null,
          canonicalStandardSalePrice: canonicalProduct.standardSalePrice,
        }
      : null,
  });
}

/**
 * Batch version of getEffectiveProductPricing — resolves effective pricing for
 * many (branchId, productId) pairs in a fixed small number of queries instead
 * of ~4 queries per pair. Used by hot loops (Brain detectors, replenishment,
 * commercial-intelligence) that previously called getEffectiveProductPricing
 * once per item, turning O(n) sequential round trips into O(1).
 */
async function getEffectiveProductPricingBatch(
  txOrPrisma: PricingClient,
  items: Array<{ branchId: string; productId: string }>,
): Promise<Map<string, EffectivePricing>> {
  const result = new Map<string, EffectivePricing>();
  if (items.length === 0) return result;

  const productIds = [...new Set(items.map((item) => item.productId))];
  const branchIds = [...new Set(items.map((item) => item.branchId))];

  const conversionByProductId = await getProductStockConversionsBatch(txOrPrisma, productIds);

  const canonicalIds = new Set<string>();
  for (const productId of productIds) {
    const conversion = conversionByProductId.get(productId);
    canonicalIds.add(conversion?.canonicalProductId ?? productId);
  }
  const allProductIds = [...new Set([...productIds, ...canonicalIds])];

  const [products, branchSettings] = await Promise.all([
    txOrPrisma.product.findMany({
      where: { id: { in: allProductIds } },
      select: { id: true, standardSalePrice: true, globalCost: true, averageCost: true, lastPurchaseCost: true },
    }),
    txOrPrisma.branchProductSetting.findMany({
      where: { productId: { in: allProductIds }, branchId: { in: branchIds } },
      select: { branchId: true, productId: true, branchPrice: true, branchCost: true },
    }),
  ]);

  const productById = new Map(products.map((product) => [product.id, product]));
  const settingByKey = new Map(branchSettings.map((setting) => [`${setting.branchId}:${setting.productId}`, setting]));

  const inventoryProductIdByProductId = new Map(
    productIds.map((productId) => [productId, conversionByProductId.get(productId)?.canonicalProductId ?? productId]),
  );
  const inventoryProductIds = [...new Set(inventoryProductIdByProductId.values())];

  const balances = await txOrPrisma.inventoryBalance.findMany({
    where: { productId: { in: inventoryProductIds }, branchId: { in: branchIds } },
    select: { branchId: true, productId: true, weightedAverageCost: true },
  });
  const balanceByKey = new Map(balances.map((balance) => [`${balance.branchId}:${balance.productId}`, balance]));

  for (const { branchId, productId } of items) {
    const key = `${branchId}:${productId}`;
    if (result.has(key)) continue;
    const product = productById.get(productId);
    if (!product) continue;

    const conversion = conversionByProductId.get(productId) ?? null;
    const isFusionMember = Boolean(conversion && !conversion.isCanonical);
    const inventoryProductId = inventoryProductIdByProductId.get(productId) ?? productId;
    const balance = balanceByKey.get(`${branchId}:${inventoryProductId}`);
    const conversionFactor = conversion?.conversionFactor ?? null;
    const saleUnitWac = balance?.weightedAverageCost && conversionFactor
      ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: balance.weightedAverageCost, conversionFactor })
      : balance?.weightedAverageCost ?? null;
    const setting = settingByKey.get(key);

    const canonicalProduct = isFusionMember ? productById.get(inventoryProductId) ?? null : null;
    const canonicalSetting = isFusionMember ? settingByKey.get(`${branchId}:${inventoryProductId}`) ?? null : null;

    result.set(key, resolveEffectivePricing({
      productId: product.id,
      standardSalePrice: product.standardSalePrice,
      globalCost: product.globalCost,
      averageCost: product.averageCost,
      lastPurchaseCost: product.lastPurchaseCost,
      branchPrice: setting?.branchPrice ?? null,
      branchCost: setting?.branchCost ?? null,
      weightedAverageCost: saleUnitWac,
      fusion: isFusionMember && conversionFactor && canonicalProduct
        ? {
            conversionFactor,
            canonicalBranchCost: canonicalSetting?.branchCost ?? null,
            canonicalAverageCost: canonicalProduct.averageCost ?? null,
            canonicalGlobalCost: canonicalProduct.globalCost ?? null,
            canonicalLastPurchaseCost: canonicalProduct.lastPurchaseCost ?? null,
            canonicalBaseWeightedAverageCost: balance?.weightedAverageCost ?? null,
            canonicalBranchPrice: canonicalSetting?.branchPrice ?? null,
            canonicalStandardSalePrice: canonicalProduct.standardSalePrice,
          }
        : null,
    }));
  }

  return result;
}

type CostChainInput = {
  branchCost: Prisma.Decimal | null | undefined;
  averageCost: Prisma.Decimal | null | undefined;
  globalCost: Prisma.Decimal | null | undefined;
  lastPurchaseCost: Prisma.Decimal | null | undefined;
  weightedAverageCost: Prisma.Decimal | null;
};

/**
 * Prioridad: branchCost > weightedAverageCost > averageCost > globalCost >
 * lastPurchaseCost > null.
 *
 * Los dos primeros son POR SUCURSAL; los tres últimos son globales y solo
 * entran cuando la sucursal no tiene costo propio. El WAC —el único costo
 * por sucursal que el sistema calcula solo, a partir de las compras reales
 * de esa sucursal— antes estaba último, detrás de tres campos idénticos
 * para toda la red: dos sucursales que compran al mismo producto a precios
 * distintos mostraban el mismo margen (prompt-costos-precios-sucursal.md
 * B2). `branchCost` sigue primero porque es una declaración explícita del
 * usuario y debe poder sobreescribir el cálculo.
 *
 * Un WAC de 0 no es un costo — es "no sé", no "vale nada". Un balance recién
 * creado (sin compras todavía, o el de un miembro derivado de una fusión que
 * `rebuildStockGroupBalancesTx` deja en cero por diseño) se ignora y cae al
 * siguiente respaldo; nunca produce un costo efectivo de cero, que desactiva
 * el guard de venta bajo costo (B4).
 *
 * Función propia porque se llama en DOS contextos: sobre los campos propios
 * de un producto normal (o el canónico de una fusión), o —desde fuera de
 * este archivo, en la auditoría de coherencia— sobre los campos propios de
 * un miembro DERIVADO para detectar qué costo implicarían si todavía se
 * leyeran (ya no se leen, pero pueden seguir ahí como dato corrupto sin
 * limpiar).
 */
export function resolveCostChain(input: CostChainInput): { cost: Prisma.Decimal | null; source: EffectivePricing["costSource"] } {
  const usableWac = input.weightedAverageCost && input.weightedAverageCost.gt(0) ? input.weightedAverageCost : null;

  const cost = input.branchCost
    ?? usableWac
    ?? input.averageCost
    ?? input.globalCost
    ?? input.lastPurchaseCost
    ?? null;

  const source: EffectivePricing["costSource"] = input.branchCost !== null && input.branchCost !== undefined
    ? "BRANCH"
    : usableWac !== null
      ? "WAC_ESTIMATE"
      : input.averageCost !== null && input.averageCost !== undefined
        ? "GLOBAL_AVERAGE"
        : input.globalCost !== null && input.globalCost !== undefined
          ? "GLOBAL"
          : input.lastPurchaseCost !== null && input.lastPurchaseCost !== undefined
            ? "LAST_PURCHASE"
            : "NONE";

  return { cost, source };
}

/**
 * En una fusión hay UN material físico, así que hay UNA base de costo: la
 * del canónico (con su propia cadena de prioridad), convertida por factor.
 * Los campos propios del miembro derivado (branchCost, averageCost,
 * globalCost, lastPurchaseCost) se IGNORAN — antes ganaban por estar
 * primero en la cadena aunque fueran un valor de relleno, mientras el WAC
 * del canónico —el único consciente de la fusión— quedaba último: la LATA
 * DE ARENA tenía globalCost=1.00 mientras el METRO derivaba C$463.84 del
 * WAC (C$18.55/lata). 18.6× de desfase sobre el mismo material físico
 * (prompt-costos-precios-fusion.md §1/§2.1).
 */
export function resolveFusionMemberCost(canonicalEffectiveCost: Prisma.Decimal | null, conversionFactor: Prisma.Decimal): Prisma.Decimal | null {
  return canonicalEffectiveCost === null ? null : canonicalEffectiveCost.mul(conversionFactor);
}

export type FusionMemberPricingBasis = {
  /** Factor de ESTE miembro (no el del canónico, que es 1). */
  conversionFactor: Prisma.Decimal;
  canonicalBranchCost: Prisma.Decimal | null;
  canonicalAverageCost: Prisma.Decimal | null;
  canonicalGlobalCost: Prisma.Decimal | null;
  canonicalLastPurchaseCost: Prisma.Decimal | null;
  /** WAC del canónico SIN convertir (unidad base) — se resuelve y LUEGO se convierte, no al revés. */
  canonicalBaseWeightedAverageCost: Prisma.Decimal | null;
  canonicalBranchPrice: Prisma.Decimal | null;
  canonicalStandardSalePrice: Prisma.Decimal;
};

function resolveEffectivePricing(input: {
  productId: string;
  standardSalePrice: Prisma.Decimal;
  globalCost?: Prisma.Decimal | null;
  averageCost?: Prisma.Decimal | null;
  lastPurchaseCost?: Prisma.Decimal | null;
  branchPrice: Prisma.Decimal | null;
  branchCost: Prisma.Decimal | null;
  weightedAverageCost: Prisma.Decimal | null;
  /**
   * Presente cuando el producto es un miembro DERIVADO de una fusión
   * activa: fuerza a que costo y precio efectivos salgan del canónico ×
   * factor. branchPrice sigue siendo el override explícito del miembro
   * (§2.2) — branchCost/averageCost/globalCost/lastPurchaseCost del
   * miembro (arriba) se ignoran para el costo cuando esto está presente.
   */
  fusion?: FusionMemberPricingBasis | null;
}): EffectivePricing {
  if (input.fusion) {
    const canonicalCost = resolveCostChain({
      branchCost: input.fusion.canonicalBranchCost,
      averageCost: input.fusion.canonicalAverageCost,
      globalCost: input.fusion.canonicalGlobalCost,
      lastPurchaseCost: input.fusion.canonicalLastPurchaseCost,
      weightedAverageCost: input.fusion.canonicalBaseWeightedAverageCost,
    });
    const effectiveCost = resolveFusionMemberCost(canonicalCost.cost, input.fusion.conversionFactor);

    const canonicalPriceBase = input.fusion.canonicalBranchPrice ?? input.fusion.canonicalStandardSalePrice;
    const impliedFusionPrice = canonicalPriceBase.mul(input.fusion.conversionFactor);
    const isFusionPriceOverride = input.branchPrice !== null;
    // "el precio de venta no se mueva solo... el PRECIO es una decisión
    // comercial POR PRESENTACIÓN" — antes, sin branchPrice, esto SIEMPRE
    // caía a impliedFusionPrice: el standardSalePrice propio del derivado
    // (input.standardSalePrice, ya devuelto abajo pero nunca leído acá)
    // era un campo fantasma que el motor ignoraba, aunque updateProduct ya
    // no lo redirija al canónico (catalog/service.ts, Parte A). Ahora que
    // esa escritura es real, la lectura tiene que coincidir: el precio
    // propio de la presentación gana sobre el implícito — impliedFusionPrice
    // sigue calculado y expuesto (UI, el aviso de desvío de Parte A.2), solo
    // deja de ser el valor efectivo por defecto.
    const effectivePrice = isFusionPriceOverride ? input.branchPrice : input.standardSalePrice;

    return {
      productId: input.productId,
      standardSalePrice: input.standardSalePrice,
      branchPrice: input.branchPrice,
      effectivePrice,
      branchCost: input.branchCost,
      weightedAverageCost: input.weightedAverageCost,
      globalCost: input.globalCost ?? null,
      averageCost: input.averageCost ?? null,
      lastPurchaseCost: input.lastPurchaseCost ?? null,
      effectiveCost,
      priceSource: isFusionPriceOverride ? "BRANCH" : "FUSION_DERIVED",
      costSource: canonicalCost.source,
      isFusionMember: true,
      impliedFusionPrice,
      isFusionPriceOverride,
      sellability: computeSellability(effectiveCost, effectivePrice),
    };
  }

  // Respaldo al precio estándar (B1): sin esto, un producto sin fila
  // BranchProductSetting para esta sucursal no tenía precio ahí — y esas
  // filas no se crean solas. "STANDARD" es deliberadamente visible (no se
  // colapsa en el mismo valor que BRANCH): un producto vendiéndose al
  // precio general porque nadie le puso precio en esta sucursal es una
  // situación que hay que poder listar, no un detalle que se tapa.
  // standardSalePrice es NOT NULL en Product, así que "MISSING" ya no puede
  // ocurrir por esta vía — queda en el tipo por compatibilidad con
  // consumidores que aún lo esperan como caso límite.
  const effectivePrice = input.branchPrice ?? input.standardSalePrice;
  const priceSource: EffectivePricing["priceSource"] = input.branchPrice !== null ? "BRANCH" : "STANDARD";

  const { cost: effectiveCost, source: costSource } = resolveCostChain({
    branchCost: input.branchCost,
    averageCost: input.averageCost,
    globalCost: input.globalCost,
    lastPurchaseCost: input.lastPurchaseCost,
    weightedAverageCost: input.weightedAverageCost,
  });

  return {
    productId: input.productId,
    standardSalePrice: input.standardSalePrice,
    branchPrice: input.branchPrice,
    effectivePrice,
    branchCost: input.branchCost,
    weightedAverageCost: input.weightedAverageCost,
    globalCost: input.globalCost ?? null,
    averageCost: input.averageCost ?? null,
    lastPurchaseCost: input.lastPurchaseCost ?? null,
    effectiveCost,
    priceSource,
    costSource,
    isFusionMember: false,
    impliedFusionPrice: null,
    isFusionPriceOverride: false,
    sellability: computeSellability(effectiveCost, effectivePrice),
  };
}

export {
  resolveEffectivePricing as resolveEffectivePricingFromParts,
  getEffectiveProductPricing,
  getEffectiveProductPricingBatch,
};
