/**
 * prompt-gastos-semana-quincena.md Fase 1 — pagado ≠ presupuesto.
 * Pura, sin DB — mismo principio que classifyBackfillBarcode
 * (product-barcode-service.ts): esta función documenta EXACTAMENTE la
 * misma regla que el backfill de la migración
 * (20261012000000_expense_kind_and_concept/migration.sql), con un test que
 * las mantiene sincronizadas. Nunca se llama desde el backfill en sí (ese
 * corre en SQL, una sola vez) — sirve para auditar/reclasificar un gasto
 * puntual sin tener que releer el SQL de la migración.
 */
export type ExpenseKind = "RECURRING" | "PAID" | "PAYROLL_SYNC";

function isSameUtcDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** Un concepto es de UNA categoría fija ("Combustible" es TRANSPORT) — nunca se puede cargar bajo una categoría distinta. */
export function conceptMatchesCategory(conceptCategory: string, expenseCategory: string): boolean {
  return conceptCategory === expenseCategory;
}

export function classifyExpenseKind(input: {
  isAutoCalculated: boolean;
  category: string;
  cashMovementId: string | null;
  /** true si algún TreasuryEntry.expensePaymentId apunta a este gasto (efectivo retenido / banco). */
  hasTreasuryEntryLink: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}): ExpenseKind {
  if (input.isAutoCalculated && input.category === "PAYROLL") return "PAYROLL_SYNC";

  const isSingleDay = input.effectiveTo !== null && isSameUtcDate(input.effectiveFrom, input.effectiveTo);
  if (input.cashMovementId !== null || input.hasTreasuryEntryLink || isSingleDay) return "PAID";

  return "RECURRING";
}
