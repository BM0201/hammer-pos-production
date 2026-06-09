import { PaymentStatus, Prisma, SaleOrderStatus } from "@prisma/client";

/**
 * ============================================================================
 *  HELPER UNIFICADO DE "VENTA VÁLIDA"  (single source of truth)
 * ============================================================================
 *
 * Antes de este archivo cada módulo (dashboard, operations, command-center,
 * ai-insights, reports) reimplementaba el filtro de "qué cuenta como venta
 * válida". Eso provocó que el módulo de operaciones se desincronizara del
 * resto y mostrara totales inflados (contaba ventas ANULADAS y de PRUEBA).
 *
 * Regla de negocio única — una venta cuenta para métricas/totales sólo si:
 *   1. NO está anulada            → `voidedAt = null`
 *   2. NO es una venta de prueba  → `isTest = false`
 *   3. NO tiene estado CANCELLED  → `status != CANCELLED`
 *
 * En este sistema las ventas NO se invalidan cambiando `status` a CANCELLED;
 * se anulan poniendo `voidedAt` (con `voidReason`) y se marcan de prueba con
 * `isTest = true`. Por eso filtrar sólo por `status` NO basta — hay que excluir
 * SIEMPRE `voidedAt` e `isTest`. Usa estos helpers en cualquier consulta nueva.
 */

/** Estados "cerrados": la venta ya descontó inventario y está cobrada/en despacho. */
export const CLOSED_SALE_ORDER_STATUSES: SaleOrderStatus[] = [
  SaleOrderStatus.DISPATCH_PENDING,
  SaleOrderStatus.DISPATCHED,
  SaleOrderStatus.PAID,
];

/** Estados que cuentan como "venta activa válida" del día (incluye pendientes de pago). */
export const ACTIVE_SALE_ORDER_STATUSES: SaleOrderStatus[] = [
  SaleOrderStatus.PENDING_PAYMENT,
  SaleOrderStatus.PAID,
  SaleOrderStatus.DISPATCH_PENDING,
  SaleOrderStatus.DISPATCHED,
];

/**
 * Núcleo del filtro de exclusión. Estas dos condiciones deben estar presentes
 * en TODA consulta de métricas/totales de ventas.
 */
export const VALID_SALE_EXCLUSIONS = {
  voidedAt: null,
  isTest: false,
} as const satisfies Prisma.SaleOrderWhereInput;

/**
 * Devuelve el `where` Prisma correcto para "venta válida", combinando filtros
 * adicionales (sucursal, fechas, estado, etc.).
 *
 * - Si el llamador NO especifica `status`, se aplica `status != CANCELLED`.
 * - Si el llamador SÍ especifica `status` (p.ej. `{ in: CLOSED_... }`), se
 *   respeta tal cual (cualquier lista de estados ya excluye CANCELLED).
 * - SIEMPRE se fuerzan `voidedAt: null` e `isTest: false`.
 *
 * @example
 *   tx.saleOrder.aggregate({ where: validSaleWhere({ branchId, createdAt: { gte, lt } }) })
 *   tx.saleOrder.aggregate({ where: validSaleWhere({ status: { in: CLOSED_SALE_ORDER_STATUSES } }) })
 */
export function validSaleWhere(extra: Prisma.SaleOrderWhereInput = {}): Prisma.SaleOrderWhereInput {
  const { status, ...rest } = extra;
  return {
    ...rest,
    ...VALID_SALE_EXCLUSIONS,
    status: status ?? { not: SaleOrderStatus.CANCELLED },
  };
}

/**
 * Variante con rango temporal y sucursal explícitos, pensada para los reportes
 * y resúmenes operativos. `branchId` admite un id único o `{ in: string[] }`.
 */
export function validSaleWhereWithDates(params: {
  branchId?: string | { in: string[] };
  start?: Date;
  end?: Date;
  /** Campo de fecha a filtrar (por defecto `createdAt`). */
  dateField?: "createdAt" | "updatedAt";
  status?: Prisma.SaleOrderWhereInput["status"];
  extra?: Prisma.SaleOrderWhereInput;
}): Prisma.SaleOrderWhereInput {
  const dateField = params.dateField ?? "createdAt";
  const where: Prisma.SaleOrderWhereInput = { ...(params.extra ?? {}) };

  if (params.branchId !== undefined) {
    where.branchId = params.branchId as Prisma.SaleOrderWhereInput["branchId"];
  }
  if (params.start || params.end) {
    where[dateField] = {
      ...(params.start ? { gte: params.start } : {}),
      ...(params.end ? { lt: params.end } : {}),
    };
  }
  if (params.status !== undefined) {
    where.status = params.status;
  }

  return validSaleWhere(where);
}

/**
 * Filtro de pagos "válidos": pagos POSTED cuya venta asociada también es válida
 * (no anulada, no prueba, no cancelada).
 *
 * Nota: al anular una venta los pagos se marcan como `VOIDED` (ver
 * `management-service.setSaleOrderVoided`), de modo que el filtro `status:
 * POSTED` ya los excluye. El join con `saleOrder` es DEFENSA EN PROFUNDIDAD:
 * garantiza que ningún pago de una venta inválida se cuele aunque por alguna
 * razón quedara POSTED.
 */
export function validPaymentWhere(params: {
  start?: Date;
  end?: Date;
  branchId?: string | { in: string[] };
  cashSessionId?: string;
  /** Filtros extra a aplicar sobre la venta relacionada. */
  saleOrderWhere?: Prisma.SaleOrderWhereInput;
  /** Campo de fecha del pago (por defecto `paidAt`). */
  dateField?: "paidAt" | "createdAt";
} = {}): Prisma.PaymentWhereInput {
  const dateField = params.dateField ?? "paidAt";
  const where: Prisma.PaymentWhereInput = { status: PaymentStatus.POSTED };

  if (params.start || params.end) {
    where[dateField] = {
      ...(params.start ? { gte: params.start } : {}),
      ...(params.end ? { lt: params.end } : {}),
    };
  }
  if (params.cashSessionId) {
    where.cashSessionId = params.cashSessionId;
  }

  const saleOrderExtra: Prisma.SaleOrderWhereInput = { ...(params.saleOrderWhere ?? {}) };
  if (params.branchId !== undefined) {
    saleOrderExtra.branchId = params.branchId as Prisma.SaleOrderWhereInput["branchId"];
  }
  where.saleOrder = validSaleWhere(saleOrderExtra);

  return where;
}
