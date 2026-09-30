/**
 * prompt-tesoreria-sin-transito.md v2 Commit 2 — "Total para depositar" de
 * la barra de totales de Tesorería suma directDepositAvailable, nunca
 * pendingDeposit (que incluye la gaveta abierta — caja, no Tesorería).
 * Extraída para poder probarla sin montar toda la página.
 */
export function computeTreasuryTotals(
  rows: Array<{ accumulatedAmount: number; directDepositAvailable: number }>,
): { accumulated: number; pendingDeposit: number } {
  return rows.reduce(
    (acc, row) => ({
      accumulated: acc.accumulated + row.accumulatedAmount,
      pendingDeposit: acc.pendingDeposit + row.directDepositAvailable,
    }),
    { accumulated: 0, pendingDeposit: 0 },
  );
}
