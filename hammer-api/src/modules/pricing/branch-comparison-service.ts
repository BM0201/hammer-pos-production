import { calculatePricingSuggestion, type RoundingRule } from "@/modules/pricing/calculator";
import { getMonthlyExpensesByBranch, getPricingConfig } from "@/modules/pricing/service";
import { getProductBranchPricingStatus } from "@/modules/pricing/branch-price-exception-service";
import { resolvePolicyForProduct } from "@/modules/pricing/category-policy-service";

export type BranchComparisonRow = {
  branchId: string;
  branchName: string;
  configExists: boolean;
  monthlyExpenses: number;
  estimatedMonthlyUnits: number;
  operatingExpensePerUnit: number;
  totalInternalCost: number;
  marginPercent: number;
  suggestedPrice: number;
  currentPrice: number | null;
  /** (actual − sugerido) / sugerido × 100; negativo = la sucursal vende por debajo de lo que sus gastos piden. */
  diffPercent: number | null;
};

/** Dispersión entre sucursales: el cliente compara; >10% en lo que más se vende se nota. */
export function branchPriceSpread(prices: number[]): { min: number; max: number; spreadPercent: number } | null {
  const valid = prices.filter((p) => p > 0);
  if (valid.length < 2) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  return { min, max, spreadPercent: Math.round(((max - min) / min) * 1000) / 10 };
}

/**
 * Mismo costo de compra para todas las sucursales; lo que cambia es el gasto
 * mensual, las unidades y el margen de cada una (su PricingConfig). Cálculo
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
      const [config, expenses, policy] = await Promise.all([
        getPricingConfig(branch.branchId),
        getMonthlyExpensesByBranch(branch.branchId),
        resolvePolicyForProduct({ branchId: branch.branchId, productId: input.productId }),
      ]);
      const units = config?.estimatedMonthlyUnits ?? 1000;
      const result = calculatePricingSuggestion({
        baseCost: input.baseCost,
        taxPercent: input.taxPercent,
        includeTaxInCost: input.includeTaxInCost,
        monthlyOperatingExpenses: expenses,
        estimatedMonthlyUnits: units,
        expenseAllocationScope: "BRANCH",
        branchMonthlyUnits: units,
        marginPercent: config?.desiredMarginPercent ?? 30,
        minProfitAmount: policy.categoryPolicy.minProfitAmount,
        roundingRule: input.roundingRule ?? (policy.categoryPolicy.roundingRule as RoundingRule),
      });
      const currentPrice = branch.effectivePrice;
      return {
        branchId: branch.branchId,
        branchName: branch.branchName,
        configExists: Boolean(config),
        monthlyExpenses: result.monthlyOperatingExpenses,
        estimatedMonthlyUnits: Number(units),
        operatingExpensePerUnit: result.operatingExpensePerUnit,
        totalInternalCost: result.totalInternalCost,
        marginPercent: result.marginPercent,
        suggestedPrice: result.suggestedPrice,
        currentPrice,
        diffPercent: currentPrice !== null && result.suggestedPrice > 0
          ? Math.round(((currentPrice - result.suggestedPrice) / result.suggestedPrice) * 1000) / 10
          : null,
      };
    }),
  );

  return { rows, spread: branchPriceSpread(rows.map((r) => r.suggestedPrice)) };
}
