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
 * §3.5 — fijar un precio de sucursal DECLARADO, con motivo obligatorio.
 * Distinto del camino de applySuggestedPrice/tray (motor de cálculo,
 * aplicación en lote): esto es una excepción puntual que alguien está
 * declarando a mano desde la ficha del producto, y tiene que quedar dicho
 * por qué — "sin motivo, en seis meses nadie sabe si esa excepción sigue
 * teniendo sentido".
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
    const existing = await tx.branchProductSetting.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      select: { branchPrice: true },
    });
    const previousPrice = existing?.branchPrice ?? null;
    const newPrice = new Prisma.Decimal(input.price);
    const now = new Date();

    await tx.branchProductSetting.upsert({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      create: {
        branchId: input.branchId,
        productId: input.productId,
        branchPrice: newPrice,
        priceSource: "MANUAL",
        lastPriceUpdateAt: now,
        priceUpdatedByUserId: input.actorUserId,
        priceExceptionReason: reason,
        priceExceptionAt: now,
      },
      update: {
        branchPrice: newPrice,
        priceSource: "MANUAL",
        lastPriceUpdateAt: now,
        priceUpdatedByUserId: input.actorUserId,
        priceExceptionReason: reason,
        priceExceptionAt: now,
      },
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

      return {
        branchId: branch.id,
        branchName: branch.name,
        followsStandard: setting?.branchPrice === null || setting?.branchPrice === undefined,
        effectivePrice: price,
        priceExceptionReason: setting?.priceExceptionReason ?? null,
        priceExceptionAt: setting?.priceExceptionAt ? setting.priceExceptionAt.toISOString() : null,
        effectiveCost: cost,
        marginPercent,
      };
    }),
  );

  return {
    standardSalePrice: product.standardSalePrice === null ? null : Number(product.standardSalePrice),
    branches: rows,
  };
}
