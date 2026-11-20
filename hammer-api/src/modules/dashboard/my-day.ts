/**
 * "Mi día" (pantalla /app/branch de la caja): reglas puras, sin Prisma, para
 * poder probarlas directo. La consulta vive en service.ts (getBranchDayView).
 */

/** Ritmo de venta: 2 semanas aplanan el día flojo y el pedido grande de una vez. */
export const PACE_WINDOW_DAYS = 14;
/** Alcanza para 3 días o menos: hay que pedir ya. Hasta 7: hay que vigilarlo. */
const SHORT_DAYS = 3;
const WATCH_DAYS = 7;

export type StockLevel = "out" | "short" | "watch" | "ok";

export type SoldStockInput = {
  productId: string;
  name: string;
  unit: string;
  onHand: number;
  soldToday: number;
  /** Vendido en los últimos PACE_WINDOW_DAYS días, hoy incluido. */
  soldInWindow: number;
  /** Punto de reorden (o mínimo) de la sucursal; null si no se configuró. */
  reorderPoint: number | null;
};

export type SoldStockRow = Omit<SoldStockInput, "soldInWindow" | "reorderPoint"> & {
  /** Días que alcanza lo que queda al ritmo reciente; null sin ventas en la ventana. */
  daysOfCover: number | null;
  level: StockLevel;
};

const LEVEL_ORDER: Record<StockLevel, number> = { out: 0, short: 1, watch: 2, ok: 3 };

export function stockLevel(onHand: number, daysOfCover: number | null, reorderPoint: number | null): StockLevel {
  if (onHand <= 0) return "out";
  if (reorderPoint !== null && onHand <= reorderPoint) return "short";
  if (daysOfCover === null) return "ok";
  if (daysOfCover <= SHORT_DAYS) return "short";
  if (daysOfCover <= WATCH_DAYS) return "watch";
  return "ok";
}

/**
 * Cuánto alcanza lo vendido hoy. Antes era "lo que quedó en 5 o menos" y casi
 * siempre salía vacío (un cemento con 20 bolsas que vende 13 al día no
 * entraba). Siempre muestra lo vendido hoy, lo más urgente primero.
 */
export function rankSoldStock(items: SoldStockInput[], limit = 8): SoldStockRow[] {
  return items
    .map(({ soldInWindow, reorderPoint, ...rest }) => {
      const perDay = soldInWindow / PACE_WINDOW_DAYS;
      const daysOfCover = perDay > 0 ? Math.round((Math.max(rest.onHand, 0) / perDay) * 10) / 10 : null;
      return { ...rest, daysOfCover, level: stockLevel(rest.onHand, daysOfCover, reorderPoint) };
    })
    .sort(
      (a, b) =>
        LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
        (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity) ||
        b.soldToday - a.soldToday,
    )
    .slice(0, limit);
}

export type PendingKey = "payments" | "myDrafts" | "dispatches" | "transports" | "approvals";

type PendingItem = { key: PendingKey; count: number };

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
