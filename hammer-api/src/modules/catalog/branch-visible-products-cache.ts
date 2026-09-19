import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { branchProductScopeFilter } from "@/modules/catalog/branch-product-scope";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Fase 3 (prompt-flujo-velocidad.md): cache TTL corto del set de productos
 * visibles por sucursal (branchProductScopeFilter), mismo patrón que
 * catalog/cost-chain-config.ts (un Map en vez de un solo valor porque acá
 * hay uno por sucursal, no un flag global).
 *
 * TTL-only, sin invalidación activa — decisión explícita, no un descuido:
 * los 4 disparadores reales (alta/baja de producto, cambio de
 * BranchProductSetting.isAvailable, movimiento de inventario que saca del
 * OR de stock>0, traslado que entra/sale de tránsito) están repartidos en
 * catalog/service.ts, inventory/service.ts, timber/service.ts y
 * transfer/service.ts — invalidar activamente en los cuatro habría exigido
 * tocar código de escritura fuera del alcance de "optimización, no cambio
 * de comportamiento" de este documento. Con 30s de ventana, el peor caso es
 * que un producto recién visible/ocultado tarde hasta 30s en reflejarse en
 * la búsqueda del POS — el resto de las pantallas que no pasan por este
 * cache (inventory/service.ts, replenishment-service.ts, timber/service.ts
 * siguen llamando branchProductScopeFilter directo) no tienen ese delay.
 */
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { ids: string[]; expiresAt: number }>();

export async function getVisibleProductIdsForBranch(branchId: string, db: DbClient = prisma): Promise<string[]> {
  const cached = cache.get(branchId);
  if (cached && cached.expiresAt > Date.now()) return cached.ids;

  const rows = await db.product.findMany({
    where: branchProductScopeFilter(branchId),
    select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  cache.set(branchId, { ids, expiresAt: Date.now() + CACHE_TTL_MS });
  return ids;
}

/** Para tests — el cache es un Map a nivel de módulo, persiste entre tests del mismo archivo. */
export function clearBranchVisibleProductsCache(): void {
  cache.clear();
}
