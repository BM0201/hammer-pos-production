/**
 * Presupuesto inteligente de gastos — módulo PURO (sin DB).
 *
 * En vez de un presupuesto fijo inventado, el sistema lleva el HISTORIAL de lo
 * realmente pagado por categoría ("el último gasto de servicios fue C$X") y de
 * ahí deriva:
 *  - el promedio mensual reciente (base para armar el presupuesto),
 *  - un presupuesto SUGERIDO (promedio + margen del 10%, redondeado),
 *  - y la detección de montos ATÍPICOS: si un gasto nuevo se sale de los
 *    valores normales de esa categoría, se avisa (sin bloquear: avisar ≠ impedir).
 *
 * Lo consumen /api/finance/expense-history (tarjeta en Finanzas › Gastos) y
 * POST /api/branch/expenses (aviso al registrar desde el POS).
 */

export type ExpenseRecord = {
  amount: number;
  /** Fecha efectiva del gasto (effectiveFrom). */
  date: Date;
  description: string;
};

export type CategoryStats = {
  category: string;
  /** Último gasto real registrado (el dato que pide el historial). */
  last: { amount: number; date: string; description: string } | null;
  /** Total por mes (YYYY-MM) de los últimos meses con datos. */
  monthlyTotals: Array<{ month: string; total: number }>;
  /** Promedio mensual de los meses CON gastos (0 si no hay historial). */
  monthlyAverage: number;
  /** Gasto individual típico: promedio de los registros individuales. */
  typicalAmount: number;
  /** Máximo individual visto (referencia del rango normal). */
  maxAmount: number;
  /** Presupuesto sugerido = promedio mensual + 10%, redondeado a la decena. */
  suggestedBudget: number;
  /** Cuántos registros respaldan las estadísticas. */
  sampleSize: number;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

/** "YYYY-MM" de una fecha (UTC — effectiveFrom se guarda a medianoche UTC). */
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Estadísticas de una categoría a partir de sus gastos reales. */
export function computeCategoryStats(category: string, records: ExpenseRecord[]): CategoryStats {
  const sorted = [...records].sort((a, b) => a.date.getTime() - b.date.getTime());
  const lastRecord = sorted[sorted.length - 1] ?? null;

  const totalsByMonth = new Map<string, number>();
  let sum = 0;
  let max = 0;
  for (const r of sorted) {
    const key = monthKey(r.date);
    totalsByMonth.set(key, round2((totalsByMonth.get(key) ?? 0) + r.amount));
    sum += r.amount;
    if (r.amount > max) max = r.amount;
  }
  const monthlyTotals = [...totalsByMonth.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const monthlyAverage = monthlyTotals.length > 0
    ? round2(monthlyTotals.reduce((s, m) => s + m.total, 0) / monthlyTotals.length)
    : 0;
  const typicalAmount = sorted.length > 0 ? round2(sum / sorted.length) : 0;
  // Sugerido: promedio mensual + 10% de colchón, redondeado a la decena hacia
  // arriba — un presupuesto que "se arma solo" con el historial real.
  const suggestedBudget = monthlyAverage > 0 ? Math.ceil((monthlyAverage * 1.1) / 10) * 10 : 0;

  return {
    category,
    last: lastRecord
      ? { amount: round2(lastRecord.amount), date: lastRecord.date.toISOString(), description: lastRecord.description }
      : null,
    monthlyTotals,
    monthlyAverage,
    typicalAmount,
    maxAmount: round2(max),
    suggestedBudget,
    sampleSize: sorted.length,
  };
}

export type OutlierCheck = {
  isOutlier: boolean;
  /** Umbral a partir del cual el monto se considera fuera de lo normal. */
  threshold: number;
  typicalAmount: number;
  lastAmount: number | null;
  /** Mensaje listo para mostrar (null si el monto es normal). */
  message: string | null;
};

/** Mínimo de registros para poder hablar de "valores normales". */
export const OUTLIER_MIN_SAMPLE = 3;
/** Un gasto es atípico si supera 2× el gasto típico Y además el máximo visto. */
export const OUTLIER_TYPICAL_FACTOR = 2;

/**
 * ¿Este monto se sale de los valores normales de la categoría?
 * Conservador a propósito: exige historial (≥3 registros) y que el monto
 * supere TANTO el doble del gasto típico COMO el máximo ya visto — así un
 * gasto grande pero ya conocido (el alquiler de siempre) no dispara avisos.
 */
export function checkOutlier(amount: number, stats: CategoryStats): OutlierCheck {
  const lastAmount = stats.last?.amount ?? null;
  if (stats.sampleSize < OUTLIER_MIN_SAMPLE || stats.typicalAmount <= 0) {
    return { isOutlier: false, threshold: 0, typicalAmount: stats.typicalAmount, lastAmount, message: null };
  }
  const threshold = round2(Math.max(stats.typicalAmount * OUTLIER_TYPICAL_FACTOR, stats.maxAmount));
  const isOutlier = amount > threshold;
  return {
    isOutlier,
    threshold,
    typicalAmount: stats.typicalAmount,
    lastAmount,
    message: isOutlier
      ? `Monto fuera de lo normal para esta categoría: lo típico es ~C$${stats.typicalAmount.toLocaleString("es-NI", { minimumFractionDigits: 2 })}` +
        (lastAmount != null ? ` y el último fue C$${lastAmount.toLocaleString("es-NI", { minimumFractionDigits: 2 })}` : "") +
        ". Se registró igual — verifica que no sea un error de dedo."
      : null,
  };
}
