import { Prisma } from "@prisma/client";
import type { PriceChangeOrigin } from "@/modules/pricing/branch-price-exception-service";

/**
 * prompt-carga-precios.md Fase 1 — escritor CENTRAL de
 * `Product.standardSalePrice` (el precio general, destino GENERAL de una
 * carga). No existía ninguno: la importación de Excel, la edición manual
 * de producto y un par de módulos más hacen cada uno su propio
 * `product.update` suelto, con auditoría inconsistente (uno de los
 * caminos de importación ni siquiera audita `PRODUCT_PRICE_CHANGED`).
 * Mismo patrón que `setBranchPriceTx` (branch-price-exception-service.ts),
 * el único escritor equivalente para `BranchProductSetting.branchPrice`:
 * MISMA acción/módulo/forma de metadataJson, solo que `branchId: null` y
 * el campo es `standardSalePrice`.
 *
 * Alcance deliberadamente acotado a la carga de precios — no migra los
 * escritores existentes (import-service.ts, catalog/service.ts
 * updateProduct, etc.), eso es un refactor aparte fuera de este doc.
 *
 * El caller es responsable del lock (`FOR UPDATE` sobre "Product") y de
 * cualquier guard de negocio (costo, fusión) ANTES de llamar a esto — igual
 * que setBranchPriceTx, esto solo escribe el precio y audita.
 */
export async function setStandardSalePriceTx(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    newPrice: Prisma.Decimal;
    actorUserId: string;
    origin: PriceChangeOrigin;
  },
): Promise<{ previousPrice: Prisma.Decimal }> {
  const product = await tx.product.findUniqueOrThrow({
    where: { id: input.productId },
    select: { sku: true, standardSalePrice: true },
  });
  const previousPrice = product.standardSalePrice;

  if (!previousPrice.equals(input.newPrice)) {
    await tx.product.update({
      where: { id: input.productId },
      data: { standardSalePrice: input.newPrice },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: null,
        module: "pricing",
        action: "PRODUCT_PRICE_CHANGED",
        entityType: "Product",
        entityId: input.productId,
        metadataJson: {
          productId: input.productId,
          sku: product.sku,
          branchId: null,
          previousPrice: previousPrice.toNumber(),
          newPrice: input.newPrice.toNumber(),
          field: "standardSalePrice",
          origin: input.origin,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  return { previousPrice };
}
