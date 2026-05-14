"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  Target,
  AlertTriangle,
  Search,
  BarChart3,
  Lightbulb,
  RefreshCw,
  Filter,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Minus,
  ShoppingCart,
  Clock,
  Users,
  Package,
  Building2,
  Tag,
  DollarSign,
  ArrowRight,
  ShieldAlert,
  Zap,
  Activity,
} from "lucide-react";
import { apiFetch } from "@/lib/client/api";

/* ────────────────────────────── Types ────────────────────────────── */

type Severity = "critical" | "high" | "medium" | "low" | "info";

interface InsightBase {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: Severity;
  impact?: string;
  metric?: string;
  createdAt: string;
}

interface DiscountSuggestion extends InsightBase {
  productName: string;
  currentPrice: number;
  suggestedDiscount: number;
  estimatedSalesIncrease: number;
  reason: string;
}

interface AnomalyInsight extends InsightBase {
  entityType: string;
  entityName: string;
  detectedValue: number;
  expectedRange: { min: number; max: number };
  deviationPercent: number;
}

interface DiscrepancyInsight extends InsightBase {
  discrepancyType: string;
  entityName: string;
  details: Record<string, unknown>;
}

interface PatternInsight extends InsightBase {
  patternType: string;
  details: Record<string, unknown>;
}

interface BusinessRecommendation extends InsightBase {
  actionType: string;
  estimatedImpact: string;
  priority: number;
}

interface Branch {
  id: string;
  code: string;
  name: string;
}

/* ────────────────────────────── Helpers ──────────────────────────── */

function severityColor(s: Severity) {
  const map: Record<Severity, { bg: string; text: string; border: string; badge: string }> = {
    critical: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", badge: "bg-red-100 text-red-800" },
    high: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", badge: "bg-orange-100 text-orange-800" },
    medium: { bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200", badge: "bg-yellow-100 text-yellow-800" },
    low: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", badge: "bg-blue-100 text-blue-800" },
    info: { bg: "bg-slate-50", text: "text-slate-600", border: "border-slate-200", badge: "bg-slate-100 text-slate-700" },
  };
  return map[s];
}

function severityLabel(s: Severity) {
  const map: Record<Severity, string> = {
    critical: "Crítico",
    high: "Alto",
    medium: "Medio",
    low: "Bajo",
    info: "Info",
  };
  return map[s];
}

function formatCurrency(v: number) {
  return `C$ ${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ────────────────────────── Severity Badge ───────────────────────── */

function SeverityBadge({ severity }: { severity: Severity }) {
  const c = severityColor(severity);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase tracking-wider ${c.badge}`}>
      {severityLabel(severity)}
    </span>
  );
}

/* ──────────────────── Expandable Insight Card ───────────────────── */

function InsightCard({
  insight,
  icon,
  children,
}: {
  insight: InsightBase;
  icon: React.ReactNode;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const c = severityColor(insight.severity);

  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} overflow-hidden transition-all duration-200`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-black/[0.02] transition-colors"
      >
        <div className="mt-0.5 flex-shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className={`text-sm font-semibold ${c.text}`}>{insight.title}</h4>
            <SeverityBadge severity={insight.severity} />
          </div>
          {insight.impact && (
            <p className="text-xs text-slate-500 mt-0.5 font-medium">{insight.impact}</p>
          )}
        </div>
        <div className="flex-shrink-0 mt-1">
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-black/5">
          <p className="text-xs text-slate-600 leading-relaxed mt-3">{insight.description}</p>
          {insight.metric && (
            <div className="mt-2 inline-flex items-center gap-1.5 bg-white/80 rounded-lg px-2.5 py-1 text-[0.7rem] text-slate-500 font-mono">
              <Activity className="h-3 w-3" />
              {insight.metric}
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

/* ──────────────────── Section Wrapper ────────────────────────────── */

function InsightSection({
  icon,
  title,
  count,
  color,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  color: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-5 py-4 flex items-center gap-3 hover:bg-slate-50 transition-colors"
      >
        <div className={`flex items-center justify-center w-10 h-10 rounded-xl ${color}`}>
          {icon}
        </div>
        <div className="flex-1 text-left">
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
        </div>
        <span className="flex items-center justify-center min-w-[1.75rem] h-7 rounded-full bg-slate-100 text-xs font-bold text-slate-600 px-2">
          {count}
        </span>
        {collapsed ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronUp className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {!collapsed && (
        <div className="px-5 pb-5 space-y-2">{children}</div>
      )}
    </section>
  );
}

/* ─────────────────────── Summary Stats ──────────────────────────── */

function StatCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex items-center gap-3">
      <div className={`flex items-center justify-center w-10 h-10 rounded-xl ${color}`}>
        {icon}
      </div>
      <div>
        <p className="text-xl font-bold text-slate-800">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
        {sub && <p className="text-[0.65rem] text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/* ─────────────────────── MAIN PAGE ──────────────────────────────── */
/* ══════════════════════════════════════════════════════════════════ */

export default function AiInsightsPage() {
  const [discounts, setDiscounts] = useState<DiscountSuggestion[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyInsight[]>([]);
  const [discrepancies, setDiscrepancies] = useState<DiscrepancyInsight[]>([]);
  const [patterns, setPatterns] = useState<PatternInsight[]>([]);
  const [recommendations, setRecommendations] = useState<BusinessRecommendation[]>([]);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [days, setDays] = useState(30);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  // Fetch branches
  useEffect(() => {
    apiFetch("/api/branches")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setBranches(d);
        else if (d.data && Array.isArray(d.data)) setBranches(d.data);
        else if (d.branches && Array.isArray(d.branches)) setBranches(d.branches);
      })
      .catch(() => {});
  }, []);

  // Fetch all insights
  const fetchInsights = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const qs = new URLSearchParams();
      if (branchId) qs.set("branchId", branchId);
      qs.set("days", String(days));
      const q = qs.toString();

      try {
        if (isRefresh) {
          // Use refresh endpoint
          const res = await apiFetch("/api/ai-insights/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ branchId: branchId || undefined, days }),
          });
          const json = await res.json();
          if (json.ok && json.data) {
            setDiscounts(json.data.discountSuggestions ?? []);
            setAnomalies(json.data.anomalies ?? []);
            setDiscrepancies(json.data.discrepancies ?? []);
            setPatterns(json.data.patterns ?? []);
            setRecommendations(json.data.recommendations ?? []);
            setLastRefresh(json.data.generatedAt ?? new Date().toISOString());
          }
        } else {
          // Parallel fetch
          const [discRes, anomRes, discpRes, patRes] = await Promise.all([
            apiFetch(`/api/ai-insights/discount-suggestions?${q}`),
            apiFetch(`/api/ai-insights/anomalies?${q}`),
            apiFetch(`/api/ai-insights/discrepancies?${q}`),
            apiFetch(`/api/ai-insights/patterns?${q}`),
          ]);

          const [discJson, anomJson, discpJson, patJson] = await Promise.all([
            discRes.json(),
            anomRes.json(),
            discpRes.json(),
            patRes.json(),
          ]);

          setDiscounts(discJson.data ?? []);
          setAnomalies(anomJson.data ?? []);
          setDiscrepancies(discpJson.data ?? []);
          setPatterns(patJson.data?.patterns ?? []);
          setRecommendations(patJson.data?.recommendations ?? []);
          setLastRefresh(new Date().toISOString());
        }
      } catch (err) {
        setError("Error al cargar insights. Intente de nuevo.");
        console.error(err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [branchId, days],
  );

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const totalAlerts =
    discrepancies.filter((d) => d.severity === "critical" || d.severity === "high").length +
    anomalies.filter((a) => a.severity === "critical" || a.severity === "high").length;

  /* ────────────────────────── RENDER ─────────────────────────────── */

  return (
    <section className="space-y-6 pb-10">
      {/* ── Header ── */}
      <div className="flex items-start gap-4">
        <div
          className="h-full w-1.5 rounded-full self-stretch hidden sm:block"
          style={{ background: "linear-gradient(180deg, #8b5cf6, #6d28d9)" }}
        />
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <Brain className="h-7 w-7 text-violet-600" />
            <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">
              Análisis Inteligente
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[0.6rem] font-bold uppercase tracking-wider bg-violet-100 text-violet-700">
              AI Insights
            </span>
          </div>
          <p className="text-sm text-slate-500 leading-relaxed max-w-2xl">
            Panel de sugerencias inteligentes basado en análisis estadístico de patrones de ventas,
            detección de anomalías y optimización de descuentos. Los insights se generan automáticamente
            analizando datos históricos.
          </p>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 bg-white rounded-xl shadow-sm border border-slate-200 px-4 py-3">
        <Filter className="h-4 w-4 text-slate-400" />
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500">Sucursal:</label>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:ring-2 focus:ring-violet-300 focus:border-violet-400 outline-none"
          >
            <option value="">Todas las sucursales</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500">Período:</label>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:ring-2 focus:ring-violet-300 focus:border-violet-400 outline-none"
          >
            <option value={7}>Últimos 7 días</option>
            <option value={14}>Últimos 14 días</option>
            <option value={30}>Últimos 30 días</option>
            <option value={60}>Últimos 60 días</option>
            <option value={90}>Últimos 90 días</option>
          </select>
        </div>

        <div className="flex-1" />

        <button
          onClick={() => fetchInsights(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold
            hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Analizando..." : "Recalcular"}
        </button>
      </div>

      {/* ── Last refresh ── */}
      {lastRefresh && (
        <p className="text-[0.65rem] text-slate-400 text-right -mt-4">
          Última actualización: {new Date(lastRefresh).toLocaleString("es-NI")}
        </p>
      )}

      {/* ── Loading / Error States ── */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <RefreshCw className="h-8 w-8 text-violet-400 animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-500">Analizando datos con algoritmos de IA...</p>
            <p className="text-xs text-slate-400 mt-1">Esto puede tomar unos segundos</p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* ── Summary Stats ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard
              icon={<Target className="h-5 w-5 text-green-600" />}
              label="Sugerencias de Descuento"
              value={discounts.length}
              sub="productos recomendados"
              color="bg-green-100"
            />
            <StatCard
              icon={<AlertTriangle className="h-5 w-5 text-orange-600" />}
              label="Alertas Críticas"
              value={totalAlerts}
              sub="requieren atención"
              color="bg-orange-100"
            />
            <StatCard
              icon={<Search className="h-5 w-5 text-red-600" />}
              label="Anomalías Detectadas"
              value={anomalies.length}
              sub={`últimos ${Math.min(days, 7)} días`}
              color="bg-red-100"
            />
            <StatCard
              icon={<BarChart3 className="h-5 w-5 text-blue-600" />}
              label="Patrones Identificados"
              value={patterns.length}
              sub="insights accionables"
              color="bg-blue-100"
            />
            <StatCard
              icon={<Lightbulb className="h-5 w-5 text-violet-600" />}
              label="Recomendaciones"
              value={recommendations.length}
              sub="oportunidades de mejora"
              color="bg-violet-100"
            />
          </div>

          {/* ── Discount Suggestions ── */}
          <InsightSection
            icon={<Target className="h-5 w-5 text-green-600" />}
            title="Sugerencias de Descuentos"
            count={discounts.length}
            color="bg-green-100"
          >
            {discounts.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">
                No hay sugerencias de descuento en este período.
              </p>
            ) : (
              discounts.map((d) => (
                <InsightCard
                  key={d.id}
                  insight={d}
                  icon={<Tag className="h-4 w-4 text-green-600" />}
                >
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                      <p className="text-[0.6rem] text-slate-400 uppercase tracking-wider">Precio Actual</p>
                      <p className="text-sm font-bold text-slate-700">{formatCurrency(d.currentPrice)}</p>
                    </div>
                    <div className="bg-white rounded-lg px-3 py-2 border border-green-100">
                      <p className="text-[0.6rem] text-green-600 uppercase tracking-wider">Descuento Sugerido</p>
                      <p className="text-sm font-bold text-green-700">{d.suggestedDiscount}%</p>
                    </div>
                    <div className="bg-white rounded-lg px-3 py-2 border border-blue-100">
                      <p className="text-[0.6rem] text-blue-600 uppercase tracking-wider">↑ Ventas Estimado</p>
                      <p className="text-sm font-bold text-blue-700">+{d.estimatedSalesIncrease}%</p>
                    </div>
                    <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                      <p className="text-[0.6rem] text-slate-400 uppercase tracking-wider">Razón</p>
                      <p className="text-xs font-medium text-slate-600">{d.reason}</p>
                    </div>
                  </div>
                </InsightCard>
              ))
            )}
          </InsightSection>

          {/* ── Discrepancies ── */}
          <InsightSection
            icon={<ShieldAlert className="h-5 w-5 text-orange-600" />}
            title="Alertas de Discrepancias"
            count={discrepancies.length}
            color="bg-orange-100"
          >
            {discrepancies.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">
                No se detectaron discrepancias en este período. 
              </p>
            ) : (
              discrepancies.map((d) => (
                <InsightCard
                  key={d.id}
                  insight={d}
                  icon={<AlertTriangle className="h-4 w-4 text-orange-500" />}
                >
                  {d.details && (
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {Object.entries(d.details)
                        .slice(0, 6)
                        .map(([key, val]) => (
                          <div key={key} className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                            <p className="text-[0.6rem] text-slate-400 uppercase tracking-wider">
                              {key.replace(/([A-Z])/g, " $1").trim()}
                            </p>
                            <p className="text-xs font-medium text-slate-600 truncate">
                              {String(val)}
                            </p>
                          </div>
                        ))}
                    </div>
                  )}
                </InsightCard>
              ))
            )}
          </InsightSection>

          {/* ── Anomalies ── */}
          <InsightSection
            icon={<Search className="h-5 w-5 text-red-600" />}
            title="Anomalias Detectadas"
            count={anomalies.length}
            color="bg-red-100"
          >
            {anomalies.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">
                No se detectaron anomalías significativas. 
              </p>
            ) : (
              anomalies.map((a) => (
                <InsightCard
                  key={a.id}
                  insight={a}
                  icon={
                    a.entityType === "sale" ? (
                      <ShoppingCart className="h-4 w-4 text-red-500" />
                    ) : a.entityType === "cashier" ? (
                      <Users className="h-4 w-4 text-red-500" />
                    ) : a.entityType === "branch" ? (
                      <Building2 className="h-4 w-4 text-red-500" />
                    ) : a.entityType === "inventory" ? (
                      <Package className="h-4 w-4 text-red-500" />
                    ) : (
                      <Zap className="h-4 w-4 text-red-500" />
                    )
                  }
                >
                  <div className="mt-3 flex flex-wrap gap-2">
                    <div className="bg-white rounded-lg px-3 py-2 border border-red-100">
                      <p className="text-[0.6rem] text-red-600 uppercase tracking-wider">Valor Detectado</p>
                      <p className="text-sm font-bold text-red-700">
                        {typeof a.detectedValue === "number" && a.detectedValue > 100
                          ? formatCurrency(a.detectedValue)
                          : a.detectedValue?.toFixed(2)}
                      </p>
                    </div>
                    <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                      <p className="text-[0.6rem] text-slate-400 uppercase tracking-wider">Rango Esperado</p>
                      <p className="text-xs font-medium text-slate-600">
                        {a.expectedRange.min?.toFixed(0)} — {a.expectedRange.max?.toFixed(0)}
                      </p>
                    </div>
                    <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                      <p className="text-[0.6rem] text-slate-400 uppercase tracking-wider">Desviación</p>
                      <p className="text-sm font-bold text-slate-700">{a.deviationPercent}%</p>
                    </div>
                  </div>
                </InsightCard>
              ))
            )}
          </InsightSection>

          {/* ── Patterns ── */}
          <InsightSection
            icon={<BarChart3 className="h-5 w-5 text-blue-600" />}
            title="Patrones Identificados"
            count={patterns.length}
            color="bg-blue-100"
          >
            {patterns.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">
                No se identificaron patrones significativos con los datos actuales.
              </p>
            ) : (
              patterns.map((p) => (
                <InsightCard
                  key={p.id}
                  insight={p}
                  icon={
                    p.patternType === "basket" ? (
                      <ShoppingCart className="h-4 w-4 text-blue-500" />
                    ) : p.patternType === "temporal" ? (
                      <Clock className="h-4 w-4 text-blue-500" />
                    ) : p.patternType === "demand_trend" ? (
                      <TrendingUp className="h-4 w-4 text-blue-500" />
                    ) : p.patternType === "efficiency" ? (
                      <Users className="h-4 w-4 text-blue-500" />
                    ) : (
                      <BarChart3 className="h-4 w-4 text-blue-500" />
                    )
                  }
                >
                  {p.details && typeof p.details === "object" && (
                    <div className="mt-3">
                      {p.patternType === "basket" && Boolean(p.details.productA) && (
                        <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-blue-100">
                          <Package className="h-4 w-4 text-blue-400" />
                          <span className="text-xs font-medium text-slate-700">
                            {String(p.details.productA)}
                          </span>
                          <ArrowRight className="h-3 w-3 text-slate-300" />
                          <Package className="h-4 w-4 text-blue-400" />
                          <span className="text-xs font-medium text-slate-700">
                            {String(p.details.productB)}
                          </span>
                          {p.details.lift ? (
                            <span className="ml-auto text-[0.65rem] font-bold text-blue-600">
                              {String(p.details.lift)}x lift
                            </span>
                          ) : null}
                        </div>
                      )}

                      {/* For demand trends, show product list */}
                      {p.patternType === "demand_trend" && Array.isArray(p.details.products) && (
                        <div className="space-y-1">
                          {(p.details.products as Array<Record<string, string>>).slice(0, 5).map((prod, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 bg-white rounded-lg px-3 py-1.5 border border-slate-100 text-xs"
                            >
                              {p.details.direction === "growing" ? (
                                <TrendingUp className="h-3 w-3 text-green-500" />
                              ) : (
                                <TrendingDown className="h-3 w-3 text-red-500" />
                              )}
                              <span className="font-medium text-slate-700 flex-1">{prod.name}</span>
                              <span className="text-slate-400">
                                {prod.avgDailySales} uds/día
                              </span>
                              <span className="text-slate-400">
                                R²: {prod.confidence}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* For efficiency, show ranking */}
                      {p.patternType === "efficiency" && Array.isArray(p.details.ranking) && (
                        <div className="space-y-1">
                          {(p.details.ranking as Array<Record<string, string | number>>).map((r, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 bg-white rounded-lg px-3 py-1.5 border border-slate-100 text-xs"
                            >
                              <span className={`font-bold ${i === 0 ? "text-green-600" : "text-slate-400"} w-5`}>
                                #{i + 1}
                              </span>
                              <span className="font-medium text-slate-700 flex-1">{String(r.username)}</span>
                              <span className="text-slate-500">{String(r.totalSales)}</span>
                              <span className="text-slate-400">{String(r.transactions)} txn</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </InsightCard>
              ))
            )}
          </InsightSection>

          {/* ── Recommendations ── */}
          <InsightSection
            icon={<Lightbulb className="h-5 w-5 text-violet-600" />}
            title="Recomendaciones de Negocio"
            count={recommendations.length}
            color="bg-violet-100"
          >
            {recommendations.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">
                No hay recomendaciones adicionales en este momento.
              </p>
            ) : (
              recommendations.map((r) => (
                <InsightCard
                  key={r.id}
                  insight={r}
                  icon={<Lightbulb className="h-4 w-4 text-violet-500" />}
                >
                  <div className="mt-3 bg-violet-50 rounded-lg px-3 py-2 border border-violet-100">
                    <p className="text-[0.6rem] text-violet-600 uppercase tracking-wider font-bold mb-1">
                      Impacto Estimado
                    </p>
                    <p className="text-xs text-violet-800 font-medium">{r.estimatedImpact}</p>
                  </div>
                </InsightCard>
              ))
            )}
          </InsightSection>

          {/* ── Algorithm Info Footer ── */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="h-4 w-4 text-slate-400" />
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Algoritmos Utilizados
              </h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[0.7rem] text-slate-500">
              <div>
                <p className="font-semibold text-slate-600">Detección de Anomalías</p>
                <p>Z-Score (|z| &gt; 2.0), IQR Fence Method</p>
              </div>
              <div>
                <p className="font-semibold text-slate-600">Análisis de Tendencias</p>
                <p>Regresión Lineal Simple, R² goodness-of-fit</p>
              </div>
              <div>
                <p className="font-semibold text-slate-600">Market Basket</p>
                <p>Co-ocurrencia, Soporte/Confianza/Lift</p>
              </div>
              <div>
                <p className="font-semibold text-slate-600">Clasificación</p>
                <p>ABC-XYZ existente, CV variabilidad</p>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
