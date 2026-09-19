import { Prisma } from "@prisma/client";

/**
 * Branch-scope visibility filter: a product is relevant to a branch if it
 * satisfies at least one of the 4 conditions (stock, history, manual assignment,
 * or active inbound process). Products that satisfy none are hidden from that
 * branch's POS, catalog, and inventory views.
 *
 * Vive en su propio módulo (separado de catalog/service.ts) desde Fase 3
 * (prompt-flujo-velocidad.md) para que branch-visible-products-cache.ts
 * pueda importarlo sin crear un ciclo — service.ts re-exporta esta misma
 * función para no romper a los llamadores existentes.
 */
export function branchProductScopeFilter(branchId: string): Prisma.ProductWhereInput {
  return {
    OR: [
      // 1. Has stock > 0 at this branch
      { inventoryBalances: { some: { branchId, quantityOnHand: { gt: 0 } } } },
      // 2. Has sale history at this branch. Fase 3 (prompt-flujo-velocidad.md):
      // antes armaba un JOIN SaleOrderLine->SaleOrder por cada producto
      // evaluado — branchId ahora vive denormalizado en la propia línea
      // (ver comentario en el schema), así que es un filtro directo sin join.
      // Líneas creadas ANTES del backfill (scripts/backfill-sale-order-line-branch-id.ts)
      // tienen branchId=null y no matchean aquí hasta que el backfill corra
      // — las otras 3 condiciones (stock, asignación manual, traslado activo)
      // igual cubren la mayoría de los productos mientras tanto.
      { orderLines: { some: { branchId } } },
      // 3. Manually assigned as available at this branch
      { branchProductSettings: { some: { branchId, isAvailable: true } } },
      // 4. In active inbound transfer to this branch
      {
        transferLines: {
          some: {
            transfer: {
              toBranchId: branchId,
              status: { in: ["DRAFT", "APPROVED", "IN_TRANSIT"] },
            },
          },
        },
      },
    ],
  };
}
