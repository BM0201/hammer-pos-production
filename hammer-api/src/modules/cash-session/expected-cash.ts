/**
 * Aritmética PURA del efectivo esperado en gaveta (sin DB) — fuente única
 * usada por cash-session/service.ts y operations/service.ts, y testeable
 * directamente (expected-cash.test.ts).
 *
 * INVARIANTE DEL VUELTO (por qué NO se resta):
 * `normalizeTenders` (payments/service.ts) garantiza que `tender.amount` es el
 * monto APLICADO a la orden — valida `Σ tender.amount === grandTotal` y
 * `receivedAmount − amount === changeAmount`. El vuelto sale del EXCEDENTE
 * `receivedAmount`, nunca del monto aplicado: si el cliente paga C$1,000 por
 * una venta de C$850, a la gaveta entran netos C$850 (entran 1,000 y salen 150
 * en el mismo acto). Restar `changeAmount` del esperado lo descontaba DOS veces
 * (una implícita en `amount`, otra explícita) y el arqueo quedaba corto.
 * `changeAmount` es solo métrica informativa/auditoría.
 */
import { CashMovementType, PaymentMethod } from "@prisma/client";

/**
 * Tipos de movimiento que SACAN efectivo de la gaveta. Lista compartida por
 * cash-session (esperado por sesión) y operations (resumen del día) para que
 * no vuelvan a divergir.
 */
export const CASH_OUTFLOW_TYPES: readonly CashMovementType[] = [
  CashMovementType.CASH_OUT,
  CashMovementType.BANK_DEPOSIT_OUT,
  CashMovementType.EXPENSE_OUT,
  CashMovementType.REFUND_OUT,
  // CORRECTION quedó como ENTRADA (compatibilidad con datos existentes);
  // las correcciones que restan usan CORRECTION_OUT.
  CashMovementType.CORRECTION_OUT,
];

export function isCashOutflowType(type: CashMovementType): boolean {
  return CASH_OUTFLOW_TYPES.includes(type);
}

export type CashMovementLike = { type: CashMovementType; amount: number };

/** Neto de movimientos de caja: entradas suman, salidas (CASH_OUTFLOW_TYPES) restan. */
export function cashMovementsNetTotal(movements: readonly CashMovementLike[]): number {
  return movements.reduce(
    (sum, movement) => (isCashOutflowType(movement.type) ? sum - movement.amount : sum + movement.amount),
    0,
  );
}

export type TenderLike = {
  method: PaymentMethod | string;
  amount: number;
  changeAmount?: number | null;
};

/**
 * Efectivo que entra a la gaveta por ventas: Σ `amount` de tenders CASH.
 * Sin restar vuelto — ver invariante arriba.
 */
export function cashTenderTotal(tenders: readonly TenderLike[]): number {
  return tenders
    .filter((tender) => tender.method === PaymentMethod.CASH)
    .reduce((sum, tender) => sum + tender.amount, 0);
}

/**
 * Totales por método de pago para el resumen del día. `net` === `amount`
 * (el vuelto ya no se resta); `changeAmount` queda como campo informativo.
 * Se conserva la clave `net` por compatibilidad con snapshots/UI existentes.
 */
export function tenderTotalsByMethod(tenders: readonly TenderLike[]) {
  return tenders.reduce<Record<string, { amount: number; changeAmount: number; net: number }>>((acc, tender) => {
    const key = String(tender.method);
    const amount = tender.amount;
    const change = tender.changeAmount ?? 0;
    acc[key] = acc[key] ?? { amount: 0, changeAmount: 0, net: 0 };
    acc[key].amount += amount;
    acc[key].changeAmount += change;
    acc[key].net += amount;
    return acc;
  }, {});
}

/**
 * Efectivo esperado en gaveta:
 *   apertura + Σ tenders CASH posteados + neto de movimientos de caja.
 * El vuelto NO participa (ver invariante del módulo).
 */
export function computeExpectedCash(input: {
  openingAmount: number;
  postedCashPayments: number;
  cashMovementsNet: number;
}): number {
  return input.openingAmount + input.postedCashPayments + input.cashMovementsNet;
}
