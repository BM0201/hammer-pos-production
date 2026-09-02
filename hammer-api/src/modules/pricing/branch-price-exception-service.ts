import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { resolvePolicyForProduct } from "@/modules/pricing/category-policy-service";
import { assertPriceNotBelowCost } from "@/modules/pricing/price-guard";

/**
 * Fase 3 (prompt-motor-precios-lote-herencia-gobierno.md) — "cada sucursal
 * es un mundo": la herencia YA existe (effective-pricing.ts resuelve
 * branchPrice → standardSalePrice → MISSING). Lo que faltaba no es modelo,
 * es que el estado de "sigue el general" vs "excepción declarada" sea
 * visible y reversible, con motivo obligatorio y auditable.
 */

const MIN_REASON_LENGTH = 3;

export type BranchPriceExceptionResult = {
  branchId: string;
  productId: string;
  previousPrice: number | null;
  newPrice: number;
};

/**
 * Parte B (prompt-huecos-fase1-fase3-despliegue.md) — el único escritor de
 * branchPrice. Antes de este helper, upsertBranchProductSetting
 * (catalog-inventory/service.ts) escribía branchPrice/priceSource/
 * lastPriceUpdateAt/priceUpdatedByUserId pero NUNCA priceExceptionReason
 * ni priceExceptionAt — quien fijara un precio desde la pantalla de
 * catálogo creaba exactamente la divergencia silenciosa que la Fase 3
 * existe para eliminar. docs/PUERTAS-DE-PRECIO.md registra los caminos que
 * llaman a este helper — hoy son CINCO (este endpoint, applySuggestedPriceTx,
 * upsertBranchProductSetting, y desde el hallazgo #3 de
 * docs/AUDITORIA-MOTOR-PRECIOS-COSTOS.md también setBranchPriceInBandTx y
 * applyApprovedPriceOverrideTx en branch-band-service.ts) — no debería
 * haber un lugar donde branchPrice y las columnas de excepción puedan
 * desincronizarse sin pasar por acá.
 *
 * branchPrice != null exige exceptionReason (>= 3 caracteres) — sin
 * motivo, en seis meses nadie sabe si esa excepción sigue teniendo
 * sentido. branchPrice == null (volver a seguir el precio general) limpia
 * las dos columnas de excepción junto con el precio, en el mismo golpe.
 * Solo escribe las columnas de precio/excepción — minStock, isAvailable,
 * marginPercent, etc. son responsabilidad de cada llamador, en la MISMA
 * transacción, si hacen falta.
 */
export type PriceChangeOrigin = "catalogo" | "fusion" | "importacion_excel" | "bandeja_precios" | "calculadora" | "saldo_inicial";

export async function setBranchPriceTx(
  tx: Prisma.TransactionClient,
  input: {
    branchId: string;
    productId: string;
    branchPrice: Prisma.Decimal | null;
    exceptionReason: string | null;
    priceSource: "MANUAL" | "CALCULATED";
    actorUserId: string;
    /** Parte B.1 — "ninguna escritura de precio queda sin rastro". Único escritor de branchPrice: acá se audita TODA escritura, sin importar el llamador. */
    origin: PriceChangeOrigin;
  },
): Promise<{ previousPrice: Prisma.Decimal | null; setting: { branchPrice: Prisma.Decimal | null } }> {
  const reason = input.exceptionReason?.trim() ?? "";
  if (input.branchPrice !== null && reason.length < MIN_REASON_LENGTH) {
    throw new Error("PRICE_EXCEPTION_REASON_REQUIRED");
  }

  const existing = await tx.branchProductSetting.findUnique({
    where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
    select: { branchPrice: true },
  });
  const previousPrice = existing?.branchPrice ?? null;
  const now = new Date();

  const data = {
    branchPrice: input.branchPrice,
    priceSource: input.priceSource,
    lastPriceUpdateAt: now,
    priceUpdatedByUserId: input.actorUserId,
    priceExceptionReason: input.branchPrice !== null ? reason : null,
    priceExceptionAt: input.branchPrice !== null ? now : null,
  };

  const setting = await tx.branchProductSetting.upsert({
    where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
    create: { branchId: input.branchId, productId: input.productId, ...data },
    update: data,
  });

  const previousNumber = previousPrice === null ? null : Number(previousPrice);
  const newNumber = input.branchPrice === null ? null : Number(input.branchPrice);
  if (previousNumber !== newNumber) {
    const product = await tx.product.findUnique({ where: { id: input.productId }, select: { sku: true } });
    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        module: "pricing",
        action: "PRODUCT_PRICE_CHANGED",
        entityType: "Product",
        entityId: input.productId,
        metadataJson: {
          productId: input.productId,
          sku: product?.sku ?? null,
          branchId: input.branchId,
          previousPrice: previousNumber,
          newPrice: newNumber,
          field: "branchPrice",
          origin: input.origin,
        },
      },
    });
  }

  return { previousPrice, setting };
}

/**
 * §3.5 — fijar un precio de sucursal DECLARADO, con motivo obligatorio.
 * Distinto del camino de applySuggestedPrice/tray (motor de cálculo,
 * aplicación en lote): esto es una excepción puntual que alguien está
 * declarando a mano desde la ficha del producto, y tiene que quedar dicho
 * por qué.
 */
export async function setBranchPriceException(input: {
  productId: string;
  branchId: string;
  price: number;
  reason: string;
  actorUserId: string;
}): Promise<BranchPriceExceptionResult> {
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) {
    throw new Error(`VALIDATION_ERROR: el motivo debe tener al menos ${MIN_REASON_LENGTH} caracteres`);
  }
  if (input.price <= 0) throw new Error("VALIDATION_ERROR: el precio debe ser mayor que 0");

  const pricing = await getEffectiveProductPricing(prisma, { branchId: input.branchId, productId: input.productId });
  assertPriceNotBelowCost({ price: input.price, cost: pricing.effectiveCost === null ? null : Number(pricing.effectiveCost) });

  const result = await prisma.$transaction(async (tx) => {
    const newPrice = new Prisma.Decimal(input.price);
    const { previousPrice } = await setBranchPriceTx(tx, {
      branchId: input.branchId,
      productId: input.productId,
      branchPrice: newPrice,
      exceptionReason: reason,
      priceSource: "MANUAL",
      actorUserId: input.actorUserId,
      origin: "bandeja_precios",
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        module: "pricing",
        action: "PRICE_EXCEPTION_SET",
        entityType: "Product",
        entityId: input.productId,
        metadataJson: {
          productId: input.productId,
          branchId: input.branchId,
          previousPrice: previousPrice?.toString() ?? null,
          newPrice: newPrice.toString(),
          reason,
        } as Prisma.InputJsonValue,
      },
    });

    return { previousPrice: previousPrice === null ? null : Number(previousPrice), newPrice: Number(newPrice) };
  });

  return { branchId: input.branchId, productId: input.productId, ...result };
}

export type FollowStandardResult = {
  branchId: string;
  applied: boolean;
  previousPrice: number | null;
  error?: string;
};

/**
 * El cuerpo transaccional de una sola sucursal, separado del bucle para
 * poder probarlo con un tx en memoria — mismo patrón que
 * applySuggestedPriceTx/sendCashOutToCustodyTx. El audit guarda el precio
 * que se descarta — es la única forma de volver atrás si alguien limpia
 * una excepción que sí era deliberada (§3.3).
 */
export async function clearBranchPriceExceptionTx(tx: Prisma.TransactionClient, input: { productId: string; branchId: string; actorUserId: string }): Promise<number | null> {
  const existing = await tx.branchProductSetting.findUnique({
    where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
    select: { branchPrice: true },
  });
  const previous = existing?.branchPrice ?? null;

  await tx.branchProductSetting.update({
    where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
    data: { branchPrice: null, priceExceptionReason: null, priceExceptionAt: null },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "pricing",
      action: "PRICE_EXCEPTION_CLEARED",
      entityType: "Product",
      entityId: input.productId,
      metadataJson: {
        productId: input.productId,
        branchId: input.branchId,
        discardedBranchPrice: previous?.toString() ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  return previous === null ? null : Number(previous);
}

/**
 * §3.3 — POST /api/master/pricing/follow-standard. Una transacción por
 * sucursal — que una falle no tumba las demás, mismo principio que
 * applySuggestedPrice.
 */
export async function clearBranchPriceExceptions(input: { productId: string; branchIds: string[]; actorUserId: string }): Promise<{ results: FollowStandardResult[] }> {
  const results: FollowStandardResult[] = [];
  for (const branchId of input.branchIds) {
    try {
      const previousPrice = await prisma.$transaction((tx) => clearBranchPriceExceptionTx(tx, { productId: input.productId, branchId, actorUserId: input.actorUserId }));
      results.push({ branchId, applied: true, previousPrice });
    } catch (error) {
      results.push({ branchId, applied: false, previousPrice: null, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
    }
  }
  return { results };
}

export type ProductBranchPricingStatusRow = {
  branchId: string;
  branchName: string;
  followsStandard: boolean;
  effectivePrice: number | null;
  priceExceptionReason: string | null;
  priceExceptionAt: string | null;
  effectiveCost: number | null;
  marginPercent: number | null;
  /** B.3 (prompt-huecos-fase1-fase3-despliegue.md) — branchPrice fijado por un camino de antes de este fix (editor de catálogo sin motivo obligatorio): no se inventa un motivo, se marca para que Master lo agregue o limpie con follow-standard. */
  hasUnexplainedException: boolean;
};

/**
 * §3.4 — GET /api/master/pricing/product/[productId]/branches. Por
 * sucursal: si sigue el general o tiene excepción, el precio efectivo, el
 * motivo y la fecha, el costo de esa sucursal y el margen resultante.
 */
export async function getProductBranchPricingStatus(productId: string): Promise<{
  standardSalePrice: number | null;
  branches: ProductBranchPricingStatusRow[];
}> {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { standardSalePrice: true } });

  const [branches, settings] = await Promise.all([
    prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.branchProductSetting.findMany({
      where: { productId },
      select: { branchId: true, branchPrice: true, priceExceptionReason: true, priceExceptionAt: true },
    }),
  ]);
  const settingByBranch = new Map(settings.map((s) => [s.branchId, s]));

  const rows = await Promise.all(
    branches.map(async (branch) => {
      const setting = settingByBranch.get(branch.id) ?? null;
      const [effective, policy] = await Promise.all([
        getEffectiveProductPricing(prisma, { branchId: branch.id, productId }),
        resolvePolicyForProduct({ branchId: branch.id, productId }).catch(() => null),
      ]);
      const cost = effective.effectiveCost === null ? null : Number(effective.effectiveCost);
      const price = effective.effectivePrice === null ? null : Number(effective.effectivePrice);
      const marginPercent = cost !== null && price !== null && price > 0 ? ((price - cost) / price) * 100 : null;

      const followsStandard = setting?.branchPrice === null || setting?.branchPrice === undefined;
      return {
        branchId: branch.id,
        branchName: branch.name,
        followsStandard,
        effectivePrice: price,
        priceExceptionReason: setting?.priceExceptionReason ?? null,
        priceExceptionAt: setting?.priceExceptionAt ? setting.priceExceptionAt.toISOString() : null,
        effectiveCost: cost,
        marginPercent,
        hasUnexplainedException: !followsStandard && !setting?.priceExceptionReason,
      };
    }),
  );

  return {
    standardSalePrice: product.standardSalePrice === null ? null : Number(product.standardSalePrice),
    branches: rows,
  };
}
