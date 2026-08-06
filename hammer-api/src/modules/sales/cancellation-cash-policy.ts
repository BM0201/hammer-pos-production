/**
 * Política PURA del manejo del efectivo al anular una orden con pagos POSTED
 * que incluyen tenders CASH (testeable sin DB; la ejecuta cancelSaleOrderTx).
 *
 * Problema que resuelve: al anular, el void del pago ya excluye el tender del
 * efectivo esperado — el esperado "baja mágicamente" sin que exista ningún
 * movimiento que obligue a sacar el dinero físico de la gaveta (compárese con
 * sales-returns, que sí crea REFUND_OUT al reembolsar en efectivo).
 *
 * El operador declara qué pasó físicamente (`cashRefundHandling`):
 *
 * - REFUNDED_FROM_DRAWER → el efectivo SÍ salió de la gaveta. Se registra el
 *   par CASH_IN (el efectivo de la venta anulada permaneció en gaveta) +
 *   REFUND_OUT (su devolución física). Neto de movimientos: 0, así el esperado
 *   baja UNA sola vez (por el void) y queda el rastro auditable de la salida.
 *   Aritmética exacta: esperado = opening + ventas_cash_vigentes + movimientos
 *   = opening + 0 + (+cash − cash) = opening = efectivo físico. ✓
 *
 * - NO_CASH_MOVEMENT → el dinero nunca entró a la gaveta / fue un error antes
 *   de cobrar. No se crea movimiento; el esperado baja solo por el void
 *   (comportamiento previo), que en este caso ES el físico. ✓
 *
 * - Sesión ya no OPEN (anulación de días anteriores) → no se tocan movimientos
 *   de una sesión cerrada; se audita SESSION_CLOSED_MANUAL_FOLLOWUP y se crea
 *   una BrainDecision de seguimiento para la devolución manual.
 */
import { CashSessionStatus } from "@prisma/client";

export const CASH_REFUND_HANDLING_VALUES = ["REFUNDED_FROM_DRAWER", "NO_CASH_MOVEMENT"] as const;
export type CashRefundHandling = (typeof CASH_REFUND_HANDLING_VALUES)[number];

export type CancellationCashPlan =
  /** Sin porción CASH posteada: nada que decidir. */
  | { action: "NONE" }
  /** Crear el par CASH_IN + REFUND_OUT en la sesión OPEN (dinero salió). */
  | { action: "CREATE_DRAWER_REFUND" }
  /** Solo el void ajusta el esperado (el dinero nunca entró / ya salió). */
  | { action: "VOID_ONLY" }
  /** Sesión cerrada: auditar y crear decisión de seguimiento manual. */
  | { action: "MANUAL_FOLLOWUP" };

export function isCashRefundHandling(value: unknown): value is CashRefundHandling {
  return typeof value === "string" && (CASH_REFUND_HANDLING_VALUES as readonly string[]).includes(value);
}

export function resolveCancellationCashPlan(input: {
  /** Σ tender.amount de tenders CASH de los pagos POSTED de la orden en esa sesión. */
  cashTenderTotal: number;
  sessionStatus: CashSessionStatus;
  cashRefundHandling?: CashRefundHandling | null;
}): CancellationCashPlan {
  if (input.cashTenderTotal <= 0) return { action: "NONE" };
  // RECONCILING/CLOSED/AUTO_CLOSED…: no se inyectan movimientos a una sesión
  // que ya no está operando — seguimiento manual.
  if (input.sessionStatus !== CashSessionStatus.OPEN) return { action: "MANUAL_FOLLOWUP" };
  if (!isCashRefundHandling(input.cashRefundHandling)) {
    throw new Error(
      "INVALID_INPUT: CASH_REFUND_HANDLING_REQUIRED — la orden tiene pagos en efectivo de una caja abierta. " +
        "Indique cashRefundHandling: REFUNDED_FROM_DRAWER (se devolvió el efectivo de la gaveta) o NO_CASH_MOVEMENT (el dinero no salió de la gaveta).",
    );
  }
  return input.cashRefundHandling === "REFUNDED_FROM_DRAWER"
    ? { action: "CREATE_DRAWER_REFUND" }
    : { action: "VOID_ONLY" };
}
