/**
 * Configuración de Madera (global o por sucursal) y recálculo masivo del precio
 * de venta cuando cambia el precio por pulgada.
 */
import { prisma } from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import {
  getPricePerInch,
  roundMoney,
  DEFAULT_PRICING,
  DEFAULT_CLASSIFICATION_CONFIG,
  DEFAULT_CUBICATION_TABLE,
  type TimberPricing,
  type TimberPriceGroup,
  type TimberClassificationConfig,
  type CubicationRow,
} from "./calculator";
import type { UpdateTimberPricingConfigInput } from "./validators";
import { branchProductScopeFilter } from "@/modules/catalog/service";

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
