/**
 * AI Insights — Service Layer
 *
 * Orchestrates all insight generators and provides caching.
 * Caches results in-memory with TTL to avoid re-computing on every request.
 */

import { generateDiscountSuggestions } from "./discount-optimizer";
import { detectAnomalies } from "./anomaly-detector";
import { detectDiscrepancies } from "./discrepancy-detector";
import { analyzePatterns, generateRecommendations } from "./pattern-analyzer";
import type {
  AiInsightsSummary,
  DiscountSuggestion,
  AnomalyInsight,
  DiscrepancyInsight,
  PatternInsight,
  BusinessRecommendation,
} from "./analyzer";

// ─── In-Memory Cache ─────────────────────────────────────────────

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheEntry<T> {
  data: T;
  generatedAt: number;
  branchId: string | null;
  days: number;
}

const cache = {
  discounts: null as CacheEntry<DiscountSuggestion[]> | null,
  anomalies: null as CacheEntry<AnomalyInsight[]> | null,
  discrepancies: null as CacheEntry<DiscrepancyInsight[]> | null,
  patterns: null as CacheEntry<PatternInsight[]> | null,
  recommendations: null as CacheEntry<BusinessRecommendation[]> | null,
};

function isCacheValid<T>(
  entry: CacheEntry<T> | null,
  branchId: string | null,
  days: number,
): entry is CacheEntry<T> {
  if (!entry) return false;
  if (Date.now() - entry.generatedAt > CACHE_TTL_MS) return false;
  if (entry.branchId !== branchId || entry.days !== days) return false;
  return true;
}

// ─── Public API ──────────────────────────────────────────────────

export async function getDiscountSuggestions(
  branchId?: string,
  days = 30,
): Promise<DiscountSuggestion[]> {
  const bid = branchId ?? null;
  if (isCacheValid(cache.discounts, bid, days)) return cache.discounts.data;

  const data = await generateDiscountSuggestions(branchId, days);
  cache.discounts = { data, generatedAt: Date.now(), branchId: bid, days };
  return data;
}

export async function getAnomalies(
  branchId?: string,
  days = 7,
): Promise<AnomalyInsight[]> {
  const bid = branchId ?? null;
  if (isCacheValid(cache.anomalies, bid, days)) return cache.anomalies.data;

  const data = await detectAnomalies(branchId, days);
  cache.anomalies = { data, generatedAt: Date.now(), branchId: bid, days };
  return data;
}

export async function getDiscrepancies(
  branchId?: string,
  days = 7,
): Promise<DiscrepancyInsight[]> {
  const bid = branchId ?? null;
  if (isCacheValid(cache.discrepancies, bid, days)) return cache.discrepancies.data;

  const data = await detectDiscrepancies(branchId, days);
  cache.discrepancies = { data, generatedAt: Date.now(), branchId: bid, days };
  return data;
}

export async function getPatterns(
  branchId?: string,
  days = 30,
): Promise<PatternInsight[]> {
  const bid = branchId ?? null;
  if (isCacheValid(cache.patterns, bid, days)) return cache.patterns.data;

  const data = await analyzePatterns(branchId, days);
  cache.patterns = { data, generatedAt: Date.now(), branchId: bid, days };
  return data;
}

export async function getRecommendations(
  branchId?: string,
  days = 30,
): Promise<BusinessRecommendation[]> {
  const bid = branchId ?? null;
  if (isCacheValid(cache.recommendations, bid, days)) return cache.recommendations.data;

  const data = await generateRecommendations(branchId, days);
  cache.recommendations = { data, generatedAt: Date.now(), branchId: bid, days };
  return data;
}

/** Full summary — runs all analyzers */
export async function getFullInsights(
  branchId?: string,
  days = 30,
): Promise<AiInsightsSummary> {
  const [discountSuggestions, anomalies, discrepancies, patterns, recommendations] =
    await Promise.all([
      getDiscountSuggestions(branchId, days),
      getAnomalies(branchId, Math.min(days, 7)),
      getDiscrepancies(branchId, Math.min(days, 7)),
      getPatterns(branchId, days),
      getRecommendations(branchId, days),
    ]);

  return {
    discountSuggestions,
    anomalies,
    discrepancies,
    patterns,
    recommendations,
    generatedAt: new Date().toISOString(),
    periodDays: days,
    branchFilter: branchId ?? null,
  };
}

/** Force refresh all caches */
export function invalidateInsightsCache(): void {
  cache.discounts = null;
  cache.anomalies = null;
  cache.discrepancies = null;
  cache.patterns = null;
  cache.recommendations = null;
}

/** Refresh all insights (invalidates cache and regenerates) */
export async function refreshAllInsights(
  branchId?: string,
  days = 30,
): Promise<AiInsightsSummary> {
  invalidateInsightsCache();
  return getFullInsights(branchId, days);
}
