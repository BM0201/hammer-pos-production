/**
 * Tipos y constantes de Gastos/Fletes (expense-manager.tsx) y de los tipos de
 * Precios que sus paneles mudados (components/pricing/*-panel.tsx) siguen
 * necesitando — quedaron acá en la Fase 1 (prompt-mudanza-zona-precios.md)
 * para no volver a duplicar definiciones; Precios ya no comparte lógica ni
 * estado con Gastos, solo estos tipos.
 *
 * Extraídos de expense-manager.tsx (parte del refactor TODO(finance-extract)):
 * separar las definiciones puras del componente reduce el monolito y permite
 * reutilizarlas desde los futuros paneles de finanzas sin arrastrar toda la UI.
 */

export type Branch = { id: string; code: string; name: string };

/** Fase 2 (prompt-motor-precios-lote-herencia-gobierno.md) — una fila de /api/pricing/apply (dryRun o real), enriquecida con branchName para la tabla de previsualización. */
export type ApplyPreviewRow = {
  branchId: string;
  branchName: string;
  previousPrice: number | null;
  newPrice: number;
  applied: boolean;
  error?: string;
  marginPercent: number | null;
  minMarginPercent: number | null;
  belowMinMargin: boolean;
};

export type Expense = {
  id: string;
  branchId: string;
  category: string;
  description: string;
  amount: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  branch: Branch;
};

export type ExpenseSummary = {
  byCategory: Record<string, { total: number; count: number; items: Expense[] }>;
  grandTotal: number;
  totalExpenses: number;
};

/** Resumen consolidado de /api/expenses?branchId=all&summary=true (solo lectura). */
export type AllBranchesSummary = {
  grandTotal: number;
  branchesWithExpenses: number;
  totalBranches: number;
  topCategory: string | null;
  byBranch: Array<{
    branchId: string;
    branchCode: string;
    branchName: string;
    byCategory: Record<string, number>;
    total: number;
  }>;
};

export type PricingConfig = {
  id?: string;
  branchId: string;
  desiredMarginPercent: string | number;
  prorationMethod: string;
  estimatedMonthlyUnits: string | number;
  exists?: boolean;
  branch?: Branch;
};

export type ProductOption = {
  id: string;
  sku: string;
  name: string;
};

export type PricingProductContext = {
  productId: string;
  branchId: string;
  sku: string;
  name: string;
  standardSalePrice: number;
  branchPrice: number | null;
  effectivePrice: number | null;
  priceSource: "BRANCH" | "STANDARD" | "MISSING" | "FUSION_DERIVED";
  branchCost: number | null;
  weightedAverageCost: number | null;
  effectiveCost: number | null;
  costSource: "BRANCH" | "WAC" | "NONE";
  categoryId: string;
  categoryName: string;
  categoryPolicy: CategoryPolicyRow;
  commercialIntelligence?: CommercialIntelligence;
};

export type CommercialIntelligence = {
  abcClass: "A" | "B" | "C";
  xyzClass: "X" | "Y" | "Z";
  combinedClass: string;
  recommendedMarginPercent: number;
  recommendedMinProfitAmount: number;
  recommendedMaxDiscountPercent: number;
  recommendedStockPolicy: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  warnings: string[];
  recommendedActions: string[];
};

export type CommercialAlert = {
  productId: string;
  sku: string;
  name: string;
  categoryName: string;
  combinedClass: string;
  riskLevel: string;
  effectivePrice: number;
  effectiveCost: number | null;
  grossMarginPercent: number | null;
  stockOnHand: number;
  daysInStock: number | null;
  message: string;
  recommendedAction: string;
  severity: "INFO" | "WARNING" | "DANGER";
};

export type CategoryPolicyRow = {
  id: string | null;
  branchId: string;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  minMarginPercent: number;
  targetMarginPercent: number;
  minProfitAmount: number;
  maxDiscountPercent: number;
  estimatedMonthlyUnits: number;
  estimatedMonthlySalesValue: number | null;
  monthlyExpenseAllocation: number;
  stockPolicy: string;
  priceMode: string;
  roundingRule: string;
  isActive: boolean;
  notes: string | null;
  isVirtualDefault: boolean;
};

export type SuggestedPriceResult = {
  mode: "SIMPLE" | "ADVANCED";
  baseCost: number;
  taxPercent: number;
  taxAmount: number;
  includeTaxInCost: boolean;
  purchaseFreightPerUnit: number;
  otherCostPerUnit: number;
  shrinkagePercent: number;
  shrinkageAmount: number;
  landedCost: number;
  monthlyOperatingExpenses: number;
  expenseAllocationScope: "BRANCH" | "CATEGORY" | "PRODUCT" | "MANUAL";
  expenseScopeLabel: string;
  unitsUsedForProration: number;
  operatingExpenseSource: string;
  scopeWarnings: string[];
  prorateMethod: "BY_QUANTITY" | "BY_VALUE";
  purchaseCost: number;
  operatingExpensePerUnit: number;
  totalInternalCost: number;
  totalCostPerUnit: number;
  marginPercent: number;
  markupPercent: number;
  minProfitAmount: number;
  rawSuggestedPrice: number;
  suggestedPrice: number;
  minPrice: number;
  maxPrice: number | null;
  marketConflict?: {
    hasConflict: boolean;
    type: "MARKET_MAX_BELOW_MIN_PRICE" | null;
    minPrice: number;
    marketMaxPrice: number | null;
    gapAmount: number | null;
    recommendation: string | null;
  };
  canApplyPrice: boolean;
  applyBlockReason?: string | null;
  grossProfit: number;
  grossMarginPercent: number;
  priceFloorReason: "MARGIN" | "MIN_PROFIT" | "MARKET_MIN" | "NONE";
  roundingRule: string;
  warnings: string[];
  policyApplied?: boolean;
  policySource?: "CATEGORY" | "VIRTUAL_DEFAULT";
  categoryPolicySnapshot?: CategoryPolicyRow;
  commercialIntelligenceApplied?: boolean;
  commercialIntelligenceSnapshot?: CommercialIntelligence;
  fallbackApplied?: boolean;
  fallbackMethod?: "BY_QUANTITY";
  expenseAllocationRatio?: number;
  allocatedMonthlyExpense?: number;
  totalMonthlyExpenses: number;
  estimatedMonthlyUnits: number;
  configExists: boolean;
};

export type InternalFreightRoute = {
  id: string;
  name: string;
  originBranchId: string;
  destinationBranchId: string;
  roundTripKm: string;
  defaultAllocationMethod: string;
  isActive: boolean;
  originBranch: Branch;
  destinationBranch: Branch;
};

export type Truck = {
  id: string;
  name: string;
  plate: string | null;
  fuelEfficiencyKmPerGallon: string | null;
  maintenanceCostPerKm: string;
  isActive: boolean;
};

export type TransferOption = {
  id: string;
  transferNumber: string;
  fromBranchId: string;
  toBranchId: string;
};

export type InternalFreightTrip = {
  id: string;
  status: string;
  fuelCost: string;
  maintenanceCost: string;
  totalTripCost: string;
  allocationMethod: string;
  route: InternalFreightRoute;
  truck: Truck | null;
  transfer: { id: string; transferNumber: string } | null;
  lines: Array<{
    id: string;
    quantity: string;
    lineValue: string;
    allocatedFreight: string;
    allocatedFreightPerUnit: string;
    product: { id: string; sku: string; name: string };
  }>;
};

/**
 * Fase 3 (prompt-mudanza-zona-precios.md) — "pricing" y "policies" salieron
 * de acá: viven en la zona Precios (/app/master/pricing), que ya no comparte
 * estado con Gastos. Flete interno se queda: es costo de transporte que
 * alimenta el costo puesto, pero también es un gasto operativo, y moverlo es
 * una decisión aparte que nadie pidió.
 */
export type ExpenseManagerTab = "expenses" | "freight";

/* ── Constants ── */

export const CATEGORY_LABELS: Record<string, string> = {
  PAYROLL: "Personal / Nómina",
  UTILITIES: "Servicios (Agua, Luz, Internet)",
  RENT: "Renta / Alquiler",
  FOOD: "Alimentación",
  MAINTENANCE: "Mantenimiento",
  TRANSPORT: "Transporte",
  MARKETING: "Publicidad / Marketing",
  TAXES: "Impuestos (Alcaldía / DGI)",
  OTHER: "Otros",
};

export const CATEGORY_ICONS: Record<string, string> = {
  PAYROLL: "NOM",
  UTILITIES: "SVC",
  RENT: "ALQ",
  FOOD: "ALM",
  MAINTENANCE: "MNT",
  TRANSPORT: "TRP",
  MARKETING: "MKT",
  TAXES: "IMP",
  OTHER: "OTR",
};

export const CATEGORY_COLORS: Record<string, string> = {
  PAYROLL: "#6366f1",
  UTILITIES: "#f59e0b",
  RENT: "#ef4444",
  FOOD: "#22c55e",
  MAINTENANCE: "#8b5cf6",
  TRANSPORT: "#3b82f6",
  MARKETING: "#ec4899",
  TAXES: "#db2777",
  OTHER: "#6b7280",
};

export const CATEGORIES = Object.keys(CATEGORY_LABELS);

export const FREIGHT_STATUS_LABELS: Record<string, string> = {
  CALCULATED: "Calculado",
  APPLIED: "Aplicado",
  CANCELLED: "Cancelado",
  DRAFT: "Borrador",
};
