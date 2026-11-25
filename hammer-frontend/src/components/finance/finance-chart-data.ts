/**
 * Datos de las gráficas del Resumen de Finanzas (puras, con prueba). Solo
 * reacomodan lo que ya devuelve /api/master/finance/summary y /trend: no
 * calculan nada nuevo, así la gráfica y el estado de resultados dicen lo mismo.
 */

export type WaterfallStep = {
  label: string;
  /** [desde, hasta] en C$: la barra flota entre los dos. */
  range: [number, number];
  /** Monto con signo (− resta, + suma); en los totales, el total. */
  amount: number;
  kind: "total" | "up" | "down";
};

export type PnlForWaterfall = {
  netSales: number;
  cogs: number;
  grossProfit: number;
  cashExpenses: number;
  bankExpenses: number;
  cardFees: number;
  retainedCashExpenses: number;
  payrollPaid: number;
  cashOverages: number;
  cashShortages: number;
  operatingProfit: number;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Cascada: de las ventas netas a la utilidad operativa, paso a paso. Los pasos en cero no se dibujan. */
export function buildPnlWaterfall(p: PnlForWaterfall): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  let running = 0;
  const total = (label: string, value: number) => {
    running = value;
    steps.push({ label, range: [Math.min(0, value), Math.max(0, value)], amount: round2(value), kind: "total" });
  };
  const move = (label: string, delta: number) => {
    if (Math.abs(delta) < 0.005) return;
    const from = running;
    running = round2(running + delta);
    steps.push({ label, range: [Math.min(from, running), Math.max(from, running)], amount: round2(delta), kind: delta > 0 ? "up" : "down" });
  };
  total("Ventas netas", p.netSales);
  move("Costo de ventas", -p.cogs);
  total("Utilidad bruta", p.grossProfit);
  move("Planilla", -p.payrollPaid);
  move("Gastos de caja", -p.cashExpenses);
  move("Gastos de banco", -p.bankExpenses);
  move("Comisión tarjeta", -p.cardFees);
  move("Efectivo retenido", -p.retainedCashExpenses);
  move("Sobrante de caja", p.cashOverages);
  move("Faltante de caja", -p.cashShortages);
  total("Utilidad operativa", p.operatingProfit);
  return steps;
}

export type BranchProfitRow = { label: string; profit: number; central?: boolean };

/** Utilidad operativa por sucursal, de mayor a menor; la fila Central (solo gastos) al final. */
export function buildBranchProfitRows(
  byBranch: Array<{ branchCode: string | null; branchName: string | null; operatingProfit: number }>,
  centralExpenses: number,
): BranchProfitRow[] {
  const rows: BranchProfitRow[] = byBranch
    .map((b) => ({ label: b.branchCode ?? b.branchName ?? "—", profit: b.operatingProfit }))
    .sort((a, b) => b.profit - a.profit);
  if (centralExpenses > 0) rows.push({ label: "Central", profit: round2(-centralExpenses), central: true });
  return rows;
}

export type ExpenseMixPoint = { label: string; payroll: number; operating: number; cardFees: number; total: number };

/** Gastos reales por mes en 3 grupos: planilla, gastos (caja + banco + retenido) y comisión de tarjeta. */
export function buildExpenseMix(
  points: Array<{ label: string; payrollPaid: number; cashExpenses: number; bankExpenses: number; retainedCashExpenses: number; cardFees?: number }>,
): ExpenseMixPoint[] {
  return points.map((p) => {
    const operating = round2(p.cashExpenses + p.bankExpenses + p.retainedCashExpenses);
    const cardFees = round2(p.cardFees ?? 0);
    return { label: p.label, payroll: round2(p.payrollPaid), operating, cardFees, total: round2(p.payrollPaid + operating + cardFees) };
  });
}

/** Eje en C$ compacto: 0 / 950 / 12k / 1.2M (una sola regla por eje). */
export function axisMoney(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
}

/** Tope redondo para un eje: 417,000 → 450,000; 42,000 → 45,000. */
export function niceCeil(value: number): number {
  if (value <= 0) return 0;
  const step = 10 ** Math.floor(Math.log10(value)) / 2;
  return Math.ceil(value / step) * step;
}
