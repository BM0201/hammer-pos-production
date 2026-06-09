import { SaleOrderStatus } from "@prisma/client";

/**
 * ============================================================================
 *  GUARDAS DE ESTADO DE ORDEN  (single source of truth)
 * ============================================================================
 *
 * CONTEXTO DEL BUG QUE ESTAS GUARDAS PREVIENEN
 * --------------------------------------------
 * Anular una orden (módulo de gestión) sólo escribe `voidedAt`/`voidReason`,
 * y marcarla como prueba sólo escribe `isTest = true`. NINGUNA de esas dos
 * acciones cambia el `status` de la orden. Por eso una orden anulada o de
 * prueba que estaba en `DRAFT` SE QUEDABA en `DRAFT` (editable y cobrable).
 *
 * Todas las guardas del flujo de checkout validaban únicamente
 * `status === DRAFT`, sin mirar `voidedAt` ni `isTest`. Resultado real
 * (orden SO-MSY-MQ6VKAV0): una orden ANULADA + PRUEBA siguió aceptando líneas
 * y se COBRÓ, descontando inventario (6 productos, C$7,813) sin que la venta
 * quedara registrada en ningún total.
 *
 * REGLA DE NEGOCIO ÚNICA
 * ----------------------
 * Una orden anulada (`voidedAt != null`) o de prueba (`isTest = true`) NO debe
 * poder editarse, enviarse a cobro, cobrarse ni despacharse JAMÁS — sin
 * importar su `status`. Estas guardas son la fuente única de esa regla y deben
 * llamarse en TODOS los endpoints/servicios que mutan una orden.
 *
 * USO TRANSACCIONAL
 * -----------------
 * Son funciones puras y síncronas: se invocan DENTRO de la transacción justo
 * después de leer la orden (con `FOR UPDATE` cuando aplica) y antes de cualquier
 * escritura. Si la orden no es válida lanzan y abortan la transacción completa,
 * garantizando atomicidad (no se descuenta inventario ni se postea pago).
 */

/** Subconjunto mínimo de campos que necesitan las guardas. */
export interface GuardableOrder {
  status: SaleOrderStatus;
  voidedAt: Date | null;
  isTest: boolean;
}

/** Códigos de error estables (se mapean a respuestas HTTP 409 en las rutas). */
export const ORDER_GUARD_ERRORS = {
  VOIDED: "ORDER_VOIDED",
  IS_TEST: "ORDER_IS_TEST",
  NOT_DRAFT: "ORDER_NOT_DRAFT",
  NOT_PAYABLE: "PAYMENT_INVALID_STATUS",
} as const;

/**
 * Verifica que una orden NO esté anulada ni sea de prueba. Es el núcleo común
 * de todas las demás guardas. Lanza `ORDER_VOIDED` / `ORDER_IS_TEST`.
 */
export function assertOrderNotVoidedOrTest(order: GuardableOrder): void {
  if (order.voidedAt) {
    throw new Error(ORDER_GUARD_ERRORS.VOIDED);
  }
  if (order.isTest) {
    throw new Error(ORDER_GUARD_ERRORS.IS_TEST);
  }
}

/**
 * Guarda para EDITAR una orden (agregar/actualizar/quitar líneas, descuentos,
 * enviar a cobro, venta directa). La orden debe:
 *   1. NO estar anulada (`voidedAt = null`)
 *   2. NO ser de prueba (`isTest = false`)
 *   3. Estar en `DRAFT`
 *
 * Lanza `ORDER_VOIDED`, `ORDER_IS_TEST` o `ORDER_NOT_DRAFT`.
 */
export function assertEditableOrder(order: GuardableOrder): void {
  assertOrderNotVoidedOrTest(order);
  if (order.status !== SaleOrderStatus.DRAFT) {
    throw new Error(ORDER_GUARD_ERRORS.NOT_DRAFT);
  }
}

/**
 * Guarda para COBRAR una orden por el flujo de cola (pago contra orden ya
 * enviada). La orden debe:
 *   1. NO estar anulada
 *   2. NO ser de prueba
 *   3. Estar en `PENDING_PAYMENT`
 *
 * Lanza `ORDER_VOIDED`, `ORDER_IS_TEST` o `PAYMENT_INVALID_STATUS`.
 */
export function assertPayableOrder(order: GuardableOrder): void {
  assertOrderNotVoidedOrTest(order);
  if (order.status !== SaleOrderStatus.PENDING_PAYMENT) {
    throw new Error(ORDER_GUARD_ERRORS.NOT_PAYABLE);
  }
}

/**
 * Guarda para DESPACHAR una orden. La orden debe:
 *   1. NO estar anulada
 *   2. NO ser de prueba
 *   3. Estar en `DISPATCH_PENDING`
 *
 * Lanza `ORDER_VOIDED`, `ORDER_IS_TEST` o `DISPATCH_INVALID_STATUS`.
 */
export function assertDispatchableOrder(order: GuardableOrder): void {
  assertOrderNotVoidedOrTest(order);
  if (order.status !== SaleOrderStatus.DISPATCH_PENDING) {
    throw new Error("DISPATCH_INVALID_STATUS");
  }
}

/**
 * Helper para rutas HTTP: traduce los códigos de error de guarda a
 * `{ code, message, httpStatus }`. Devuelve `null` si el mensaje no es un
 * error de guarda conocido (la ruta debe re-lanzar / usar su manejo genérico).
 */
export function mapOrderGuardError(
  error: unknown,
): { code: string; message: string; httpStatus: number } | null {
  const message = error instanceof Error ? error.message : String(error);
  switch (message) {
    case ORDER_GUARD_ERRORS.VOIDED:
      return { code: "ORDER_VOIDED", message: "La orden fue anulada y no admite cambios ni cobros.", httpStatus: 409 };
    case ORDER_GUARD_ERRORS.IS_TEST:
      return { code: "ORDER_IS_TEST", message: "La orden está marcada como prueba y no admite cambios ni cobros.", httpStatus: 409 };
    case ORDER_GUARD_ERRORS.NOT_DRAFT:
      return { code: "ORDER_NOT_DRAFT", message: "La orden no está en estado editable.", httpStatus: 409 };
    case ORDER_GUARD_ERRORS.NOT_PAYABLE:
      return { code: "PAYMENT_INVALID_STATUS", message: "La orden no está en estado de cobro.", httpStatus: 409 };
    case "DISPATCH_INVALID_STATUS":
      return { code: "DISPATCH_INVALID_STATUS", message: "La orden no está en estado despachable.", httpStatus: 409 };
    default:
      return null;
  }
}
