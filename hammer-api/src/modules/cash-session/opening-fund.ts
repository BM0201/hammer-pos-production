type Decimalish = { toString(): string } | number | string;

export type OpeningCashFund = { amount: number; note: string | null; declaredAt: string; setByMaster: boolean };

/**
 * Con qué sencillo se propone abrir la caja: el del último cierre declarado,
 * salvo que Master haya fijado el sencillo actual DESPUÉS de ese cierre (o no
 * haya ningún cierre declarado todavía). Pura, para poder probarla.
 */
export function pickOpeningCashFund(
  lastDeclaration: { retainCashFundPortion: Decimalish; notes: string | null; createdAt: Date } | null,
  branch: { cashFundAmount: Decimalish | null; cashFundSetAt: Date | null } | null,
): OpeningCashFund | null {
  if (branch?.cashFundSetAt && branch.cashFundAmount !== null && (!lastDeclaration || branch.cashFundSetAt > lastDeclaration.createdAt)) {
    return { amount: Number(branch.cashFundAmount), note: null, declaredAt: branch.cashFundSetAt.toISOString(), setByMaster: true };
  }
  if (!lastDeclaration) return null;
  return { amount: Number(lastDeclaration.retainCashFundPortion), note: lastDeclaration.notes, declaredAt: lastDeclaration.createdAt.toISOString(), setByMaster: false };
}
