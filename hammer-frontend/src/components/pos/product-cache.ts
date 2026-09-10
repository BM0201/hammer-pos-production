// Conversión ProductRow ⇄ CachedProduct para el catálogo offline del POS.
// Antes: toCachedProduct vivía (sin exportar) en use-pos-catalog.ts y estaba
// re-implementado a mano en branch-pos.tsx; el mapeo inverso estaba repetido
// 3 veces textual en use-pos-catalog.ts.

import type { CachedProduct } from "@/lib/offline-db";
import type { ProductRow } from "./types";

/** ProductRow (respuesta del catálogo) → CachedProduct (lo que se guarda en IndexedDB). */
export function toCachedProduct(row: ProductRow): CachedProduct {
  const price = row.effectivePrice ?? row.branchPrice ?? null;
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    barcode: row.barcode,
    categoryName: row.categoryName,
    effectivePrice: price === null || price === undefined ? null : Number(price),
    unit: row.unit ?? "UND",
    availableSaleStock: typeof row.availableSaleStock === "number" ? row.availableSaleStock : null,
  };
}

/**
 * CachedProduct (IndexedDB) → ProductRow, con los campos suficientes para que
 * la UI del POS lo trate igual que un producto venido de la red. El cast es
 * inevitable: CachedProduct es un subconjunto deliberado de ProductRow.
 */
export function fromCachedProduct(p: CachedProduct): ProductRow {
  return {
    ...p,
    standardSalePrice: p.effectivePrice,
    branchPrice: p.effectivePrice,
    effectivePrice: p.effectivePrice,
    priceSource: "CACHE" as const,
    stockOnHand: p.availableSaleStock ?? 0,
    availableStock: p.availableSaleStock ?? 0,
    isActive: true,
    stockConversion: null,
    sharedStock: null,
  } as unknown as ProductRow;
}
