/**
 * "Mi día" (pantalla /app/branch de la caja): reglas puras, sin Prisma, para
 * poder probarlas directo. La consulta vive en service.ts (getBranchDayView).
 */

/** Cuando el producto no tiene punto de reorden ni mínimo en la sucursal. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export function lowStockThreshold(setting: { reorderPoint: number | null; minStock: number | null } | null): number {
  return setting?.reorderPoint ?? setting?.minStock ?? DEFAULT_LOW_STOCK_THRESHOLD;
}

export type LowStockCandidate = {
  productId: string;
  name: string;
  unit: string;
  onHand: number;
  threshold: number;
  soldToday: number;
};

/** Solo lo vendido hoy que quedó en su umbral o debajo; primero lo que más se vendió. */
export function pickLowStock(candidates: LowStockCandidate[], limit = 8): LowStockCandidate[] {
  return candidates
    .filter((c) => c.onHand <= c.threshold)
    .sort((a, b) => b.soldToday - a.soldToday || a.onHand - b.onHand)
    .slice(0, limit);
}

export type PendingKey = "payments" | "myDrafts" | "dispatches" | "transports" | "approvals";

export type PendingItem = { key: PendingKey; count: number };

/**
 * Lo que falta resolver hoy. Solo entra lo que el usuario puede atender
 * (permiso en `allowed`) y lo que tiene algo pendiente: un 0 no es tarea.
 */
export function buildPendingList(
  counts: Record<PendingKey, number>,
  allowed: Record<PendingKey, boolean>,
): PendingItem[] {
  const order: PendingKey[] = ["payments", "myDrafts", "dispatches", "transports", "approvals"];
  return order.filter((key) => allowed[key] && counts[key] > 0).map((key) => ({ key, count: counts[key] }));
}
