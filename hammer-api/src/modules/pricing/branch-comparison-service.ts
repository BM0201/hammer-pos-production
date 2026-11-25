import { prisma } from "@/lib/prisma";
import { calculatePricingSuggestion, type RoundingRule } from "@/modules/pricing/calculator";
import { getMonthlyExpensesByBranch, getPricingConfig } from "@/modules/pricing/service";
import { getProductBranchPricingStatus } from "@/modules/pricing/branch-price-exception-service";
import { resolvePolicyForProduct } from "@/modules/pricing/category-policy-service";

export type BranchComparisonRow = {
  branchId: string;
  branchName: string;
  configExists: boolean;
  monthlyExpenses: number;
  /** Venta promedio del mes (últimos 3 meses). */
  monthlySales: number;
  /** De cada C$100 que vende la sucursal, cuánto se va en gastos. null = sin ventas para medirlo. */
  expenseRatePercent: number | null;
  operatingExpensePerUnit: number;
  totalInternalCost: number;
  marginPercent: number;
  suggestedPrice: number;
  currentPrice: number | null;
  /** (actual − sugerido) / sugerido × 100; negativo = la sucursal vende por debajo de lo que sus gastos piden. */
  diffPercent: number | null;
  /** Lo que de verdad le queda por unidad al precio actual, ya pagado el costo y su parte de los gastos. */
  profitAfterExpensesAtCurrent: number | null;
};

const SALES_WINDOW_DAYS = 90;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** % de gasto = presupuesto del mes ÷ venta promedio del mes. */
export function expenseRateFrom(monthlyExpenses: number, monthlySales: number): number | null {
  return monthlySales > 0 ? round1((monthlyExpenses / monthlySales) * 100) : null;
}

/**
 * Parte del gasto que le toca a una unidad cuando el gasto es un % de la
 * venta: si el precio es P, el gasto es P·r y P·(1−m) = costo + P·r, así que
 * P = costo ÷ (1 − m − r) y el gasto por unidad = costo·r ÷ (1 − m − r).
 * Antes se dividía el gasto del mes entre "unidades del mes" configuradas a
 * mano (MSY tenía 12 → C$4,567 por unidad a cualquier producto).
 */
export function expensePerUnitForRate(landedCost: number, marginPercent: number, ratePercent: number | null): number {
  if (!ratePercent || ratePercent <= 0 || landedCost <= 0) return 0;
  // Tope: margen + gasto nunca más de 90% del precio (si no, el precio explota).
  const rest = Math.max(0.1, 1 - marginPercent / 100 - ratePercent / 100);
  return round2((landedCost * (ratePercent / 100)) / rest);
}

export async function getBranchExpenseRate(branchId: string, db: typeof prisma = prisma, now = new Date()) {
  const since = new Date(now.getTime() - SALES_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [budget, sales] = await Promise.all([
    getMonthlyExpensesByBranch(branchId, db),
    db.saleOrder.aggregate({
      where: { branchId, status: { notIn: ["DRAFT", "PENDING_PAYMENT", "CANCELLED", "RETURNED"] }, createdAt: { gte: since, lt: now } },
      _sum: { subtotal: true },
    }),
  ]);
  const monthlyExpenses = Number(budget);
  const monthlySales = round2(Number(sales._sum.subtotal ?? 0) / (SALES_WINDOW_DAYS / 30));
  return { monthlyExpenses, monthlySales, expenseRatePercent: expenseRateFrom(monthlyExpenses, monthlySales) };
}

/** Dispersión entre sucursales: el cliente compara; >10% en lo que más se vende se nota. */
export function branchPriceSpread(prices: number[]): { min: number; max: number; spreadPercent: number } | null {
  const valid = prices.filter((p) => p > 0);
  if (valid.length < 2) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  return { min, max, spreadPercent: Math.round(((max - min) / min) * 1000) / 10 };
}

/**
 * Mismo costo de compra para todas las sucursales; lo que cambia es el % de
 * gasto (gasto del mes ÷ venta del mes) y el margen de cada una. Cálculo
 * puro: no guarda historial (calculatePricingSuggestionForBranch sí lo hace).
 */
export async function compareBranchPricingSuggestions(input: {
  productId: string;
  baseCost: number;
  taxPercent: number;
  includeTaxInCost: boolean;
  roundingRule?: RoundingRule;
}) {
  const status = await getProductBranchPricingStatus(input.productId);

  const rows: BranchComparisonRow[] = await Promise.all(
    status.branches.map(async (branch) => {
      const [config, rate, policy] = await Promise.all([
        getPricingConfig(branch.branchId),
        getBranchExpenseRate(branch.branchId),
        resolvePolicyForProduct({ branchId: branch.branchId, productId: input.productId }),
      ]);
      const marginPercent = Number(config?.desiredMarginPercent ?? 30);
      const calc = (manualOperatingExpensePerUnit: number) => calculatePricingSuggestion({
        baseCost: input.baseCost,
        taxPercent: input.taxPercent,
        includeTaxInCost: input.includeTaxInCost,
        monthlyOperatingExpenses: rate.monthlyExpenses,
        expenseAllocationScope: "MANUAL",
        manualOperatingExpensePerUnit,
        marginPercent,
        minProfitAmount: policy.categoryPolicy.minProfitAmount,
        roundingRule: input.roundingRule ?? (policy.categoryPolicy.roundingRule as RoundingRule),
      });
      // 1.ª pasada solo para el costo puesto (con IVA si corresponde).
      const landedCost = calc(0).landedCost;
      const result = calc(expensePerUnitForRate(landedCost, marginPercent, rate.expenseRatePercent));
      const currentPrice = branch.effectivePrice;
      return {
        branchId: branch.branchId,
        branchName: branch.branchName,
        configExists: Boolean(config),
        monthlyExpenses: rate.monthlyExpenses,
        monthlySales: rate.monthlySales,
        expenseRatePercent: rate.expenseRatePercent,
        operatingExpensePerUnit: result.operatingExpensePerUnit,
        totalInternalCost: result.totalInternalCost,
        marginPercent: result.marginPercent,
        suggestedPrice: result.suggestedPrice,
        currentPrice,
        diffPercent: currentPrice !== null && result.suggestedPrice > 0
          ? Math.round(((currentPrice - result.suggestedPrice) / result.suggestedPrice) * 1000) / 10
          : null,
        profitAfterExpensesAtCurrent: currentPrice !== null
          ? round2(currentPrice - landedCost - currentPrice * ((rate.expenseRatePercent ?? 0) / 100))
          : null,
      };
    }),
  );

  return { rows, spread: branchPriceSpread(rows.map((r) => r.suggestedPrice)) };
}
