import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { resolvePolicyForProduct } from "@/modules/pricing/category-policy-service";
import { assertPriceNotBelowCost } from "@/modules/pricing/price-guard";
import { approvalService } from "@/modules/approvals/service";

/**
 * Fase 4 (prompt-motor-precios-lote-herencia-gobierno.md) — la sucursal
 * ajusta libre DENTRO de la banda de su categoría (minMarginPercent ya
 * existe en BranchCategoryPricingPolicy, no hace falta modelo nuevo); solo
 * sale a aprobación lo que se pasa. Los ajustes cotidianos no molestan a
 * nadie y se revisa lo que merece revisión.
 */

export type BranchPricingContextForBand = {
  productId: string;
  productSku: string;
  productName: string;
  branchId: string;
  currentPrice: number | null;
  effectiveCost: number | null;
  minMarginPercent: number;
  targetMarginPercent: number;
};

/**
 * §4.3 — datos que la interfaz de sucursal necesita para mostrar el margen
 * EN VIVO mientras el cajero escribe: precio actual, costo efectivo, y el
 * mínimo/objetivo de la banda de su categoría. Deliberadamente NO usa
 * getProductPricingContext (pricing/service.ts) — esa función exige
 * assertFinanceAccess (Master/Contador), que BRANCH_ADMIN no tiene; esta
 * es la versión mínima gateada por PRICING_EDIT_BRANCH.
 */
export async function getBranchPricingContextForProduct(input: { branchId: string; productId: string }): Promise<BranchPricingContextForBand> {
  const [product, pricing, policy] = await Promise.all([
    prisma.product.findUniqueOrThrow({ where: { id: input.productId }, select: { sku: true, name: true } }),
    getEffectiveProductPricing(prisma, { branchId: input.branchId, productId: input.productId }),
    resolvePolicyForProduct({ branchId: input.branchId, productId: input.productId }),
  ]);

  return {
    productId: input.productId,
    productSku: product.sku,
    productName: product.name,
    branchId: input.branchId,
    currentPrice: pricing.effectivePrice === null ? null : Number(pricing.effectivePrice),
    effectiveCost: pricing.effectiveCost === null ? null : Number(pricing.effectiveCost),
    minMarginPercent: Number(policy.categoryPolicy.minMarginPercent),
    targetMarginPercent: Number(policy.categoryPolicy.targetMarginPercent),
  };
}

/**
 * Pura (sin DB) — la decisión de qué camino tomar. Aislada para poder
 * probar el límite exacto (margen justo en el mínimo, sin costo conocido)
 * sin base de datos, mismo principio que isPriceStaleAgainstCost.
 */
export function decidePriceBandPath(input: { price: number; cost: number | null; minMarginPercent: number }): { inBand: boolean; marginPercent: number } {
  if (input.cost === null || input.cost <= 0) {
    // Sin costo conocido no hay margen que calcular contra la banda — se
    // trata como dentro de la banda (nada que comparar) en vez de bloquear
    // a una sucursal que todavía no tiene costo cargado.
    return { inBand: true, marginPercent: 100 };
  }
  const marginPercent = ((input.price - input.cost) / input.price) * 100;
  return { inBand: marginPercent >= input.minMarginPercent, marginPercent };
}

export type SetPriceInBandResult =
  | { path: "IN_BAND"; applied: true; marginPercent: number; minMarginPercent: number; previousPrice: number | null; newPrice: number }
  | { path: "APPROVAL_REQUESTED"; applied: false; marginPercent: number; minMarginPercent: number; requestId: string; requestCreated: boolean };

/**
 * §4.2 — POST /api/branch/pricing/set-price. margen >= minMarginPercent →
 * aplica directo, audit PRICE_SET_IN_BAND. margen < minMarginPercent → NO
 * aplica, crea solicitud de aprobación con el módulo que ya existe, audit
 * PRICE_APPROVAL_REQUESTED. Devuelve SIEMPRE cuál camino se tomó, con el
 * margen calculado y el mínimo de la política — la respuesta dice por qué,
 * no solo que sí o que no.
 */
export async function setBranchPriceInBand(input: {
  productId: string;
  branchId: string;
  price: number;
  reason?: string;
  actorUserId: string;
}): Promise<SetPriceInBandResult> {
  if (input.price <= 0) throw new Error("VALIDATION_ERROR: el precio debe ser mayor que 0");

  const [pricing, policy] = await Promise.all([
    getEffectiveProductPricing(prisma, { branchId: input.branchId, productId: input.productId }),
    resolvePolicyForProduct({ branchId: input.branchId, productId: input.productId }),
  ]);
  const cost = pricing.effectiveCost === null ? null : Number(pricing.effectiveCost);
  const minMarginPercent = Number(policy.categoryPolicy.minMarginPercent);
  const { inBand, marginPercent } = decidePriceBandPath({ price: input.price, cost, minMarginPercent });

  if (inBand) {
    // El piso incondicional (nunca se vende bajo el costo interno) sigue
    // activo aunque el precio esté dentro de la banda de margen.
    assertPriceNotBelowCost({ price: input.price, cost });

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.branchProductSetting.findUnique({
        where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
        select: { branchPrice: true },
      });
      const previousPrice = existing?.branchPrice ?? null;
      const newPrice = new Prisma.Decimal(input.price);
      const now = new Date();
      const marginDecimal = new Prisma.Decimal(marginPercent);

      await tx.branchProductSetting.upsert({
        where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
        create: { branchId: input.branchId, productId: input.productId, branchPrice: newPrice, priceSource: "MANUAL", lastPriceUpdateAt: now, priceUpdatedByUserId: input.actorUserId, marginPercent: marginDecimal },
        update: { branchPrice: newPrice, priceSource: "MANUAL", lastPriceUpdateAt: now, priceUpdatedByUserId: input.actorUserId, marginPercent: marginDecimal },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: input.branchId,
          module: "pricing",
          action: "PRICE_SET_IN_BAND",
          entityType: "Product",
          entityId: input.productId,
          metadataJson: {
            productId: input.productId,
            branchId: input.branchId,
            previousPrice: previousPrice?.toString() ?? null,
            newPrice: newPrice.toString(),
            marginPercent,
            minMarginPercent,
            reason: input.reason ?? null,
          } as Prisma.InputJsonValue,
        },
      });

      return { previousPrice: previousPrice === null ? null : Number(previousPrice), newPrice: Number(newPrice) };
    });

    return { path: "IN_BAND", applied: true, marginPercent, minMarginPercent, ...result };
  }

  // §4.4 — la cola de aprobaciones de Master necesita mostrar producto y
  // costo sin una consulta aparte por solicitud; se guardan en el payload
  // en vez de resolverlos otra vez al listar.
  const product = await prisma.product.findUnique({ where: { id: input.productId }, select: { sku: true, name: true } });

  const { requestId, created } = await approvalService.createRequest({
    branchId: input.branchId,
    requestedByUserId: input.actorUserId,
    // referenceType es el discriminador que usa la ruta de aprobaciones
    // (api/approvals/[id]/route.ts) para saber qué ejecutar al aprobar —
    // mismo patrón que STOCK_ADJUSTMENT/DISPATCH_OVERRIDE (su referenceType
    // es el nombre del flujo, no el nombre de la entidad).
    referenceType: "PRICE_OVERRIDE",
    referenceId: input.productId,
    reason: input.reason?.trim() || "Precio bajo el margen mínimo de la categoría",
    type: "PRICE_OVERRIDE",
    payloadJson: {
      productId: input.productId,
      productSku: product?.sku ?? null,
      productName: product?.name ?? null,
      branchId: input.branchId,
      price: input.price,
      marginPercent,
      minMarginPercent,
      effectiveCost: cost,
    },
  });

  if (created) {
    await logAuditEvent({
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "pricing",
      action: "PRICE_APPROVAL_REQUESTED",
      entityType: "Product",
      entityId: input.productId,
      metadataJson: { productId: input.productId, branchId: input.branchId, price: input.price, marginPercent, minMarginPercent, requestId },
    });
  }

  return { path: "APPROVAL_REQUESTED", applied: false, marginPercent, minMarginPercent, requestId, requestCreated: created };
}

/**
 * §4.4 — aprobar una solicitud PRICE_OVERRIDE ejecuta el precio pedido;
 * rechazar deja el precio como estaba (nunca se tocó — la solicitud no
 * aplicó nada hasta este momento). Se llama DESPUÉS de que la ruta de
 * aprobaciones (api/approvals/[id]/route.ts) ya resolvió el status —
 * mismo patrón que executeApprovedRetainedCashExpense/markOrderDispatched
 * para STOCK_ADJUSTMENT/DISPATCH_OVERRIDE/RETAINED_CASH_EXPENSE.
 */
export async function applyApprovedPriceOverride(input: { payloadJson: unknown; actorUserId: string; requestId: string }) {
  const payload = input.payloadJson as Record<string, unknown> | null;
  if (!payload || typeof payload.productId !== "string" || typeof payload.branchId !== "string" || typeof payload.price !== "number") {
    throw new Error("PRICE_OVERRIDE_PAYLOAD_MISSING");
  }
  const productId = payload.productId;
  const branchId = payload.branchId;
  const price = payload.price;

  // Re-chequea el piso de costo al momento de aprobar, no solo al pedir —
  // el costo pudo haber cambiado en el tiempo que la solicitud esperó.
  const pricing = await getEffectiveProductPricing(prisma, { branchId, productId });
  const cost = pricing.effectiveCost === null ? null : Number(pricing.effectiveCost);
  assertPriceNotBelowCost({ price, cost });

  await prisma.$transaction(async (tx) => {
    const newPrice = new Prisma.Decimal(price);
    const now = new Date();
    await tx.branchProductSetting.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: { branchId, productId, branchPrice: newPrice, priceSource: "MANUAL", lastPriceUpdateAt: now, priceUpdatedByUserId: input.actorUserId },
      update: { branchPrice: newPrice, priceSource: "MANUAL", lastPriceUpdateAt: now, priceUpdatedByUserId: input.actorUserId },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId,
        module: "pricing",
        action: "PRICE_APPROVAL_APPLIED",
        entityType: "Product",
        entityId: productId,
        metadataJson: { requestId: input.requestId, newPrice: newPrice.toString() } as Prisma.InputJsonValue,
      },
    });
  });
}
