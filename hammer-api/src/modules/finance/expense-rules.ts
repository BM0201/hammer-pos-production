import { Prisma } from "@prisma/client";

/**
 * prompt-gastos-semana-quincena.md Fase 2.2 — reglas puras compartidas
 * entre finance/service.ts (computeRealPerformance) y finance/expense-ledger.ts
 * (getExpenseLedger). Separadas a su propio archivo para que
 * expense-ledger.ts las pueda importar sin crear un ciclo (finance/service.ts
 * importa getExpenseLedger de vuelta desde ahí) — mismo patrón que
 * brain/detector-registry.ts o catalog/barcode-errors.ts en este mismo repo.
 */

function num(value: Prisma.Decimal | number | null | undefined): number {
  return Number(value ?? 0);
}

/**
 * prompt-cxp.md Fase 3 / prompt-tesoreria-cerrar-circuito.md H-2/H-3 — un
 * TreasuryEntry de gasto cuenta como gasto operativo real salvo que: esté
 * ligado a una orden de compra (su costo ya entra por COGS al vender), o
 * esté ligado a un OperatingExpense de categoría PAYROLL (la planilla se
 * cuenta aparte, a costo empresa) o ya inactivo (anulado).
 *
 * NO TOCAR esta exclusión sin entender esto primero: quien la revierta
 * infla el gasto y desinfla la utilidad dos veces, en silencio, para toda
 * orden de compra pagada.
 */
export function isCountableTreasuryExpenseEntry(
  entry: { purchaseOrderId: string | null; expensePaymentId: string | null },
  linkedExpense: { category: string; isActive: boolean } | undefined,
): boolean {
  if (entry.purchaseOrderId) return false;
  if (!entry.expensePaymentId) return true;
  if (!linkedExpense) return true;
  return linkedExpense.category !== "PAYROLL" && linkedExpense.isActive;
}

/**
 * Convierte un desembolso de planilla PAGADO (registrado al NETO) a costo
 * EMPRESA, escalando por employerCost/netPay de su PayrollLine. Si la línea
 * no tiene neto (>0) — p. ej. datos históricos — se usa el monto pagado tal cual.
 */
export function payrollEmployerCostPaid(d: {
  amount: Prisma.Decimal;
  payrollLine: { netPay: Prisma.Decimal; employerCost: Prisma.Decimal } | null;
}): number {
  const paidNet = num(d.amount);
  const lineNet = num(d.payrollLine?.netPay);
  const lineCost = num(d.payrollLine?.employerCost);
  if (lineNet <= 0 || lineCost <= 0) return paidNet;
  return paidNet * (lineCost / lineNet);
}
