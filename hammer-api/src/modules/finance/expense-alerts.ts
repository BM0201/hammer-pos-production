import { checkOutlier, type CategoryStats } from "@/modules/finance/expense-intelligence";
import type { ExpenseLedgerRow } from "@/modules/finance/expense-ledger";
import { expenseCategoryLabel } from "@/modules/pricing/expense-category-labels";

/**
 * prompt-gastos-semana-quincena.md Fase 2.4 — "alertas de qué cambió",
 * construidas con funciones PURAS a partir de datos ya cargados (nunca
 * consultan la DB directamente) para poder testearlas sin fake-db.
 */
export type ExpensePeriodAlert = {
  code: string;
  message: string;
  category: string | null;
  href: string | null;
};

const NO_RECEIPT_DEFAULT_THRESHOLD = 1000;

function money(n: number): string {
  return `C$${n.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// prompt-caja-gastos-pos-cobro.md Commit 1 — etiquetas en español en un solo
// lugar (antes una copia propia acá). UNCLASSIFIED no es una ExpenseCategory
// real (es el marcador sintético de expense-ledger.ts para movimientos de
// tesorería sin OperatingExpense vinculado) — se mantiene aparte.
function categoryLabel(category: string): string {
  if (category === "UNCLASSIFIED") return "Sin clasificar";
  return expenseCategoryLabel(category);
}

/**
 * Categorías que se movieron más de ±30% Y más de C$500 vs el promedio de
 * los 4 períodos anteriores del mismo tipo. Cuando el promedio es cero
 * (categoría nueva) el % no se puede calcular — se alerta igual si el monto
 * ya pasa el umbral absoluto, porque "de cero a C$2,000" sí es una señal.
 */
export function buildCategorySwingAlerts(
  currentByCategory: Map<string, number>,
  average4ByCategory: Map<string, number>,
  opts: { minAbsolute?: number; minPercent?: number } = {},
): ExpensePeriodAlert[] {
  const minAbsolute = opts.minAbsolute ?? 500;
  const minPercent = opts.minPercent ?? 30;
  const alerts: ExpensePeriodAlert[] = [];

  const categories = new Set<string>([...currentByCategory.keys(), ...average4ByCategory.keys()]);
  for (const category of categories) {
    if (category === "UNCLASSIFIED") continue; // tiene su propia alerta, más directa.
    const current = currentByCategory.get(category) ?? 0;
    const average = average4ByCategory.get(category) ?? 0;
    const delta = current - average;
    if (Math.abs(delta) <= minAbsolute) continue;
    const percent = average > 0 ? (delta / average) * 100 : current > minAbsolute ? 100 : 0;
    if (Math.abs(percent) < minPercent) continue;

    const direction = delta > 0 ? "subió" : "bajó";
    alerts.push({
      code: "CATEGORY_SWING",
      category,
      message: average > 0
        ? `${categoryLabel(category)} ${direction} ${Math.abs(Math.round(percent))}% vs el promedio (${money(average)} → ${money(current)}).`
        : `${categoryLabel(category)} es una categoría nueva este período: ${money(current)} (antes C$0).`,
      href: null,
    });
  }

  return alerts.sort((a, b) => a.category!.localeCompare(b.category!));
}

/**
 * Filas del período (cualquier fuente) cuyo monto se sale de lo normal para
 * su categoría, según el historial YA calculado (computeCategoryStats /
 * checkOutlier de expense-intelligence.ts — el mismo criterio que ya usa
 * el registro en caja, no uno nuevo).
 */
export function buildOutlierAlerts(
  rows: ExpenseLedgerRow[],
  statsByCategory: Map<string, CategoryStats>,
): ExpensePeriodAlert[] {
  const alerts: ExpensePeriodAlert[] = [];
  for (const row of rows) {
    if (row.category === "UNCLASSIFIED" || row.category === "PAYROLL") continue;
    const stats = statsByCategory.get(row.category);
    if (!stats) continue;
    const check = checkOutlier(row.amount, stats);
    if (check.isOutlier) {
      alerts.push({
        code: "OUTLIER",
        category: row.category,
        message: `${row.description || categoryLabel(row.category)}: ${money(row.amount)} — ${check.message}`,
        href: null,
      });
    }
  }
  return alerts;
}

/**
 * Gastos PAID sin recibo, por encima del umbral (default C$1,000).
 * "Sin recibo" = ni número de recibo ni foto (prompt-caja-gastos-pos-
 * cobro.md Commit 2 — la foto satisface lo mismo que el número).
 */
export function buildNoReceiptAlert(rows: ExpenseLedgerRow[], threshold = NO_RECEIPT_DEFAULT_THRESHOLD): ExpensePeriodAlert | null {
  const flagged = rows.filter((r) => r.source !== "DEVENGADO" && !r.receiptNumber && !r.receiptPhotoUrl && r.amount > threshold);
  if (flagged.length === 0) return null;
  const total = flagged.reduce((s, r) => s + r.amount, 0);
  return {
    code: "NO_RECEIPT",
    category: null,
    message: `${flagged.length} gasto${flagged.length === 1 ? "" : "s"} sin recibo por más de ${money(threshold)} (${money(total)} en total).`,
    href: null,
  };
}

const OTHER_SHARE_DEFAULT_THRESHOLD = 0.15;

/**
 * prompt-caja-gastos-pos-cobro.md Commit 3 — "El 79% del gasto está en
 * Otros: reclasificá para ver en qué se gasta." OTHER es la categoría real
 * (ExpenseCategory.OTHER) — distinta de UNCLASSIFIED (el marcador
 * sintético de expense-ledger.ts para movimientos de tesorería sin
 * OperatingExpense vinculado, que ya tiene su propia alerta aparte).
 */
export function buildOtherShareAlert(rows: ExpenseLedgerRow[], threshold = OTHER_SHARE_DEFAULT_THRESHOLD): ExpensePeriodAlert | null {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  if (total <= 0) return null;
  const otherTotal = rows.filter((r) => r.category === "OTHER").reduce((s, r) => s + r.amount, 0);
  const share = otherTotal / total;
  if (share <= threshold) return null;
  return {
    code: "OTHER_SHARE",
    category: "OTHER",
    message: `El ${Math.round(share * 100)}% del gasto está en Otros: reclasificá para ver en qué se gasta.`,
    href: null,
  };
}

/** Egresos de caja tipo CASH_OUT (retiro/traslado genérico) — no entran al total de gastos pero pueden ser un gasto disfrazado. */
export function buildUnclassifiedCashOutAlert(totalAmount: number, count: number): ExpensePeriodAlert | null {
  if (count === 0 || totalAmount <= 0) return null;
  return {
    code: "UNCLASSIFIED_CASH_OUT",
    category: null,
    message: `${count} retiro${count === 1 ? "" : "s"} de caja (CASH_OUT) por ${money(totalAmount)} sin clasificar — revisa si alguno es en realidad un gasto.`,
    href: null,
  };
}

/** Gastos vinculados pero sin categoría reconocida (fallback "Sin clasificar" del libro). */
export function buildUnclassifiedCategoryAlert(currentByCategory: Map<string, number>): ExpensePeriodAlert | null {
  const total = currentByCategory.get("UNCLASSIFIED") ?? 0;
  if (total <= 0) return null;
  return {
    code: "UNCLASSIFIED_CATEGORY",
    category: "UNCLASSIFIED",
    message: `${money(total)} en gastos sin categoría asignada.`,
    href: null,
  };
}
