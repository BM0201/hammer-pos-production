/**
 * correccion-destino-y-pantalla-cobro.md §1.3 — "monto esperando depósito,
 * cruzado con días hábiles sin depositar". El monto declarado como
 * "esperando depósito" (CashDestinationDeclaration.retainAwaitingDepositPortion)
 * no queda ligado a un depósito específico — el dinero es fungible una vez
 * en la sucursal. Por eso la resolución es FIFO agregado: los depósitos
 * confirmados van cubriendo las declaraciones más viejas primero, y lo que
 * queda sin cubrir es lo que sigue "esperando", con su fecha más antigua.
 */

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export type OutstandingAwaitingDeposit = {
  outstandingAmount: number;
  oldestOutstandingDate: Date | null;
};

export function computeOutstandingAwaitingDeposit(
  declarations: Array<{ createdAt: Date; amount: number }>,
  deposits: Array<{ depositedAt: Date; amount: number }>,
): OutstandingAwaitingDeposit {
  const totalDeclared = declarations.reduce((s, d) => s + d.amount, 0);
  const totalDeposited = deposits.reduce((s, d) => s + d.amount, 0);
  const outstandingAmount = Math.max(0, round2(totalDeclared - totalDeposited));

  if (outstandingAmount <= 0) return { outstandingAmount: 0, oldestOutstandingDate: null };

  const sorted = [...declarations].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let remainingDeposits = totalDeposited;
  for (const d of sorted) {
    if (remainingDeposits >= d.amount) {
      remainingDeposits -= d.amount;
    } else {
      return { outstandingAmount, oldestOutstandingDate: d.createdAt };
    }
  }
  return { outstandingAmount, oldestOutstandingDate: sorted.length > 0 ? sorted[sorted.length - 1].createdAt : null };
}

/** Días hábiles (lun-vie) estrictamente transcurridos entre dos fechas — sin calendario de feriados, no lo pide ninguno de los dos docs. */
export function countBusinessDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let count = 0;
  const cursor = new Date(from.getTime());
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(to.getTime());
  end.setUTCHours(0, 0, 0, 0);
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}
