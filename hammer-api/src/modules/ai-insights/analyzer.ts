/**
 * AI Insights — Main Analyzer
 * 
 * Core statistical utilities and data aggregation engine for the AI insights module.
 * Implements: Z-Score anomaly detection, IQR method, trend analysis, and helper math.
 *
 * Algorithms used:
 *  - Z-Score: detects values > N standard deviations from the mean
 *  - IQR (Interquartile Range): robust outlier detection (Q1-1.5*IQR … Q3+1.5*IQR)
 *  - Simple Linear Regression: trend slope & direction
 *  - Coefficient of Variation (CV): demand stability measure
 */

// ─── Statistical Helpers ────────────────────────────────────────

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

/** IQR-based outlier bounds */
export function iqrBounds(values: number[]): { lower: number; upper: number } {
  const q1 = percentile(values, 25);
  const q3 = percentile(values, 75);
  const iqr = q3 - q1;
  return { lower: q1 - 1.5 * iqr, upper: q3 + 1.5 * iqr };
}

/** Z-Score for a single value given the distribution */
export function zScore(value: number, m: number, sd: number): number {
  if (sd === 0) return 0;
  return (value - m) / sd;
}

/** Simple Linear Regression: returns slope and intercept */
export function linearRegression(values: number[]): { slope: number; intercept: number; r2: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, r2: 0 };

  const xs = values.map((_, i) => i);
  const xMean = mean(xs);
  const yMean = mean(values);

  let ssXY = 0;
  let ssXX = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssXY += (xs[i] - xMean) * (values[i] - yMean);
    ssXX += (xs[i] - xMean) ** 2;
    ssTot += (values[i] - yMean) ** 2;
  }

  const slope = ssXX > 0 ? ssXY / ssXX : 0;
  const intercept = yMean - slope * xMean;
  const ssRes = values.reduce((s, y, i) => s + (y - (intercept + slope * i)) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2 };
}

/** Trend direction label */
export function trendDirection(slope: number, avgValue: number): "creciente" | "decreciente" | "estable" {
  if (avgValue === 0) return "estable";
  const relativeChange = Math.abs(slope) / avgValue;
  if (relativeChange < 0.02) return "estable";
  return slope > 0 ? "creciente" : "decreciente";
}

/** Coefficient of Variation */
export function coefficientOfVariation(values: number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return stddev(values) / m;
}

// ─── Date Helpers ────────────────────────────────────────────────

export function dayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function dayOfWeekLabel(dow: number): string {
  return ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][dow] ?? "?";
}

export function hourLabel(h: number): string {
  return `${h.toString().padStart(2, "0")}:00`;
}

// ─── Severity / Impact Helpers ───────────────────────────────────

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export function severityScore(s: Severity): number {
  const map: Record<Severity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  return map[s];
}

// ─── Shared Types ────────────────────────────────────────────────

export interface InsightBase {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: Severity;
  impact?: string;
  metric?: string;
  createdAt: string;
}

export interface DiscountSuggestion extends InsightBase {
  category: "discount";
  productId: string;
  productName: string;
  currentPrice: number;
  suggestedDiscount: number;
  estimatedSalesIncrease: number;
  reason: string;
}

export interface AnomalyInsight extends InsightBase {
  category: "anomaly";
  entityType: "sale" | "product" | "branch" | "cashier" | "inventory";
  entityId: string;
  entityName: string;
  detectedValue: number;
  expectedRange: { min: number; max: number };
  deviationPercent: number;
}

export interface DiscrepancyInsight extends InsightBase {
  category: "discrepancy";
  discrepancyType: "unusual_discount" | "duplicate_transaction" | "price_inconsistency" | "anomalous_returns" | "branch_deviation";
  entityId: string;
  entityName: string;
  details: Record<string, unknown>;
}

export interface PatternInsight extends InsightBase {
  category: "pattern";
  patternType: "basket" | "temporal" | "demand_trend" | "efficiency" | "correlation";
  details: Record<string, unknown>;
}

export interface BusinessRecommendation extends InsightBase {
  category: "recommendation";
  actionType: string;
  estimatedImpact: string;
  priority: number;
}

export interface AiInsightsSummary {
  discountSuggestions: DiscountSuggestion[];
  anomalies: AnomalyInsight[];
  discrepancies: DiscrepancyInsight[];
  patterns: PatternInsight[];
  recommendations: BusinessRecommendation[];
  generatedAt: string;
  periodDays: number;
  branchFilter: string | null;
}
