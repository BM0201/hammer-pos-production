"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  Factory,
  PackageSearch,
  Plus,
  ReceiptText,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money as formatMoney, qty2, fmtDateNumeric, fmtRatioPercent } from "@/lib/format";

/**
 * prompt-produccion-materiales.md Fase 3 — el dashboard real: antes, los
 * KPIs se calculaban en el cliente con los últimos 80 lotes (ni siquiera
 * garantizaba cubrir el período que el usuario creía ver), "Costo unitario
 * promedio" mezclaba productos distintos sin ponderar por cantidad, e
 * "Insumos críticos" en realidad contaba recetas, no insumos. Ahora todo
 * eso sale de /api/master/production/dashboard, calculado en el servidor
 * por sucursal y período.
 */

type BatchSummary = {
  id: string;
  batchNumber: string;
  status: string;
  plannedQuantity: number;
  producedGoodQuantity: number | null;
  unitCost: number | null;
  createdAt: string;
  completedAt: string | null;
  recipe: { id: string; name: string; code: string };
  branch: { id: string; code: string; name: string };
};

type RecipeSummary = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  expectedQuantity: number;
  expectedUnit: string;
  targetMarginPct: number | null;
};

type Branch = { id: string; code: string; name: string };
type ProductionRecommendation = {
  id: string;
  branchId: string;
  targetProductId: string;
  targetProductName: string;
  targetSku: string;
  targetStockOnHand: number;
  targetShortageQty: number;
  dailySalesVelocity: number;
  daysOfStockRemaining: number | null;
  recipeId: string;
  recipeName: string;
  recipeType: string;
  recipeFamily: string;
  inputSummary: Array<{ productName: string; excessQty: number; availableStock: number; requiredQtyPerBatch: number }>;
  suggestedBatches: number;
  expectedOutputQty: number;
  estimatedUnitCost: number | null;
  buyCost: number | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  recommendationType: string;
  message: string;
  warnings: string[];
  recommendedActions: string[];
};

type ProducedByProduct = {
  productId: string;
  productName: string;
  goodQuantity: number;
  badQuantity: number;
  weightedYieldPct: number | null;
  weightedUnitCost: number | null;
  targetYieldPct: number | null;
  batchCount: number;
  currentPrice: number | null;
  marginAtCurrentPrice: number | null;
};
type IncompleteRecipe = { recipeId: string; recipeName: string; recipeCode: string; reason: "NO_INPUTS" | "INVALID_EXPECTED_QUANTITY" | "ZERO_COST_INPUT" };
type BlockingInput = { productId: string; productName: string; shortfall: number; batchCount: number };
type ProductionDashboard = {
  period: { from: string; to: string };
  batchesByStatus: Record<string, number>;
  producedByProduct: ProducedByProduct[];
  materialVarianceCostTotal: number;
  blockingInputs: BlockingInput[];
  incompleteRecipes: IncompleteRecipe[];
};

const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" }> = {
  DRAFT: { label: "Borrador", tone: "neutral" },
  PLANNED: { label: "Planificado", tone: "info" },
  IN_PROGRESS: { label: "En proceso", tone: "warning" },
  COMPLETED: { label: "Completado", tone: "success" },
  CANCELLED: { label: "Cancelado", tone: "danger" },
  REVERSED: { label: "Revertido", tone: "danger" },
};
const STATUS_TONE_CLASS: Record<string, string> = {
  neutral: "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]",
  info: "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  warning: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  success: "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  danger: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
};
const PRIORITY_TONE_CLASS: Record<string, string> = {
  URGENT: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
  HIGH: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  MEDIUM: "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  LOW: "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
};
const INCOMPLETE_REASON_LABEL: Record<string, string> = {
  NO_INPUTS: "Receta activa sin insumos.",
  INVALID_EXPECTED_QUANTITY: "Cantidad esperada inválida (0 o menos).",
  ZERO_COST_INPUT: "Un insumo no tiene costo efectivo en esta sucursal.",
};

const money = (value: number | null | undefined) => value == null ? "-" : formatMoney(value);
const num = (value: number | null | undefined) => value == null ? "-" : qty2(value);
const pct = fmtRatioPercent;
type KpiItem = { label: string; value: string | number; Icon: LucideIcon };

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-5">
      <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{body}</p>
    </div>
  );
}

/** Primer y último día del mes en curso, como "YYYY-MM-DD" (horario local del navegador). */
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(last) };
}

export default function ProductionDashboardPage() {
  const router = useRouter();
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [period, setPeriod] = useState(currentMonthRange);
  const [dashboard, setDashboard] = useState<ProductionDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<ProductionRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [creatingRecommendationId, setCreatingRecommendationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [batchRes, recipeRes, branchRes] = await Promise.all([
          apiFetch("/api/master/production/batches?limit=80"),
          apiFetch("/api/master/production/recipes"),
          apiFetch("/api/branches"),
        ]);
        if (!batchRes.ok || !recipeRes.ok) throw new Error("No se pudo cargar produccion.");
        const batchData = unwrapApiData(await batchRes.json()) as BatchSummary[];
        const recipeData = unwrapApiData(await recipeRes.json()) as RecipeSummary[];
        const branchData = branchRes.ok ? unwrapApiData(await branchRes.json()) as Branch[] : [];
        if (!cancelled) {
          setBatches(batchData);
          setRecipes(recipeData);
          const branchList = Array.isArray(branchData) ? branchData : [];
          setBranches(branchList);
          setSelectedBranchId((current) => current || branchList[0]?.id || "");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!selectedBranchId) {
      setRecommendations([]);
      return;
    }
    (async () => {
      setRecommendationsLoading(true);
      try {
        const res = await apiFetch(`/api/master/production/recommendations?branchId=${encodeURIComponent(selectedBranchId)}`);
        if (!res.ok) throw new Error("No se pudieron cargar recomendaciones.");
        const data = unwrapApiData(await res.json()) as { recommendations?: ProductionRecommendation[] };
        if (!cancelled) setRecommendations(data.recommendations ?? []);
      } catch {
        if (!cancelled) setRecommendations([]);
      } finally {
        if (!cancelled) setRecommendationsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedBranchId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedBranchId) {
      setDashboard(null);
      return;
    }
    (async () => {
      setDashboardLoading(true);
      try {
        const params = new URLSearchParams({ branchId: selectedBranchId, from: period.from, to: period.to });
        const res = await apiFetch(`/api/master/production/dashboard?${params.toString()}`);
        if (!res.ok) throw new Error("No se pudo cargar el dashboard de producción.");
        if (!cancelled) setDashboard(unwrapApiData(await res.json()) as ProductionDashboard);
      } catch {
        if (!cancelled) setDashboard(null);
      } finally {
        if (!cancelled) setDashboardLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedBranchId, period.from, period.to]);

  const createSuggestedBatch = async (recommendation: ProductionRecommendation) => {
    setCreatingRecommendationId(recommendation.id);
    setError(null);
    try {
      const res = await apiFetch("/api/master/production/recommendations/create-batch", {
        method: "POST",
        body: JSON.stringify({
          branchId: recommendation.branchId,
          recipeId: recommendation.recipeId,
          suggestedBatches: recommendation.suggestedBatches,
          targetProductId: recommendation.targetProductId,
          notes: `Lote sugerido: ${recommendation.message}`,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error?.message ?? errData?.message ?? "No se pudo crear el lote sugerido.");
      }
      const created = unwrapApiData(await res.json()) as { id: string };
      router.push(`/app/master/production/batches/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setCreatingRecommendationId(null);
    }
  };

  const inProcess = batches.filter((batch) => batch.status === "IN_PROGRESS" || batch.status === "PLANNED");
  const activeRecipes = recipes.filter((recipe) => recipe.isActive);

  const totalGoodQuantity = useMemo(() => (dashboard?.producedByProduct ?? []).reduce((sum, p) => sum + p.goodQuantity, 0), [dashboard]);
  const overallYieldPct = useMemo(() => {
    const rows = dashboard?.producedByProduct ?? [];
    const good = rows.reduce((sum, p) => sum + p.goodQuantity, 0);
    const total = rows.reduce((sum, p) => sum + p.goodQuantity + p.badQuantity, 0);
    return total > 0 ? good / total : null;
  }, [dashboard]);
  const openBatchCount = (dashboard?.batchesByStatus.PLANNED ?? 0) + (dashboard?.batchesByStatus.IN_PROGRESS ?? 0);

  const priorities = [
    ...inProcess.slice(0, 3).map((batch) => ({ label: batch.batchNumber, detail: `${batch.recipe.name} en ${batch.branch.name}`, tone: "warning" as const })),
    ...(dashboard?.incompleteRecipes ?? []).slice(0, 3).map((r) => ({ label: r.recipeCode, detail: INCOMPLETE_REASON_LABEL[r.reason] ?? r.reason, tone: "danger" as const })),
  ];

  return (
    <section className="space-y-6">
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex flex-col gap-5 bg-gradient-to-r from-[var(--color-master-900)] via-[var(--color-master-700)] to-[var(--color-success-700)] px-5 py-6 text-white lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-white/12">
              <Factory className="h-6 w-6" />
            </div>
            <h1 className="text-3xl font-bold tracking-normal">Produccion de Materiales</h1>
            <p className="mt-2 text-sm text-white/80">Recetas, insumos, costos y lotes para fabricar productos.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/app/master/production/batches/new" className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[var(--color-master-900)] hover:bg-white/90"><Plus className="h-4 w-4" />Nuevo lote</Link>
            <Link href="/app/master/production/recipes/new" className="inline-flex items-center gap-2 rounded-lg bg-white/12 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/25 hover:bg-white/18"><Plus className="h-4 w-4" />Crear receta</Link>
            <Link href="/app/master/production/recipes" className="inline-flex items-center gap-2 rounded-lg bg-white/12 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/25 hover:bg-white/18"><ReceiptText className="h-4 w-4" />Recetas / Materiales</Link>
            <Link href="/app/master/catalog/products" className="inline-flex items-center gap-2 rounded-lg bg-white/12 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/25 hover:bg-white/18"><PackageSearch className="h-4 w-4" />Catalogo de productos</Link>
          </div>
        </div>
      </div>

      {error && <div className="rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-3 text-sm text-[var(--color-danger-700)]">{error}</div>}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--color-text-muted)]">Sucursal</span>
          <select value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--color-text-muted)]">Desde</span>
          <input type="date" value={period.from} onChange={(event) => setPeriod((p) => ({ ...p, from: event.target.value }))} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--color-text-muted)]">Hasta</span>
          <input type="date" value={period.to} onChange={(event) => setPeriod((p) => ({ ...p, to: event.target.value }))} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {([
          { label: "Recetas activas", value: activeRecipes.length, Icon: ClipboardList },
          { label: "Lotes abiertos", value: dashboardLoading ? "…" : openBatchCount, Icon: Factory },
          { label: "Producido (periodo)", value: dashboardLoading ? "…" : num(totalGoodQuantity), Icon: Boxes },
          { label: "Rendimiento real", value: dashboardLoading ? "…" : (overallYieldPct != null ? pct(overallYieldPct) : "-"), Icon: TrendingUp },
          { label: "Variancia de materiales", value: dashboardLoading ? "…" : money(dashboard?.materialVarianceCostTotal ?? 0), Icon: TrendingUp },
          { label: "Insumos bloqueando", value: dashboardLoading ? "…" : (dashboard?.blockingInputs.length ?? 0), Icon: AlertTriangle },
        ] satisfies KpiItem[]).map(({ label, value, Icon }) => (
          <div key={label} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</p>
              <Icon className="h-4 w-4 text-[var(--color-master-600)]" />
            </div>
            <p className="mt-2 text-2xl font-bold text-[var(--color-text)]">{String(value)}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">Recomendaciones de produccion</h2>
            <p className="text-sm text-[var(--color-text-muted)]">Detecta productos bajos que pueden fabricarse desde insumos disponibles o excedentes.</p>
          </div>
        </div>

        {recommendationsLoading ? (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">Buscando oportunidades de produccion...</p>
        ) : recommendations.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="Sin recomendaciones por ahora" body="Cuando falte un producto y exista una receta viable con insumos disponibles, aparecera aqui." />
          </div>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {recommendations.slice(0, 6).map((recommendation) => {
              const input = recommendation.inputSummary[0];
              const canCreate = recommendation.suggestedBatches > 0
                && recommendation.recommendedActions.includes("CREATE_PRODUCTION_BATCH")
                && recommendation.recommendationType !== "NOT_ENOUGH_INPUTS"
                && recommendation.recommendationType !== "REVIEW_RECIPE";
              return (
                <div key={recommendation.id} className="rounded-lg border border-[var(--color-border)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Falta</p>
                      <h3 className="mt-1 text-base font-bold text-[var(--color-text)]">{recommendation.targetProductName}</h3>
                      <p className="text-xs text-[var(--color-text-muted)]">{recommendation.targetSku} · Stock actual: {num(recommendation.targetStockOnHand)} · Falta: {num(recommendation.targetShortageQty)}</p>
                      {recommendation.dailySalesVelocity > 0 && (
                        <p className="text-xs text-[var(--color-text-muted)]">
                          Venta: {num(recommendation.dailySalesVelocity)}/día
                          {recommendation.daysOfStockRemaining != null && ` · ${num(recommendation.daysOfStockRemaining)} días de stock restantes`}
                        </p>
                      )}
                    </div>
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${PRIORITY_TONE_CLASS[recommendation.priority]}`}>
                      {recommendation.priority}
                    </span>
                  </div>
                  <div className="mt-3 rounded-lg bg-[var(--color-surface-alt)] p-3 text-sm">
                    <p><span className="font-semibold">Receta:</span> {recommendation.recipeName}</p>
                    <p><span className="font-semibold">Tipo/familia:</span> {recommendation.recipeType} · {recommendation.recipeFamily}</p>
                    {input && <p><span className="font-semibold">Insumo disponible:</span> {input.productName}, exceso {num(input.excessQty)} / stock {num(input.availableStock)}</p>}
                    {recommendation.recommendationType === "BUY_INSTEAD" ? (
                      <p className="font-semibold text-[var(--color-warning-700)]">Comprar sale {money(recommendation.buyCost)} vs. producir {money(recommendation.estimatedUnitCost)}</p>
                    ) : (
                      <>
                        <p><span className="font-semibold">Sugerencia:</span> producir {num(recommendation.expectedOutputQty)} unidades</p>
                        <p><span className="font-semibold">Costo estimado:</span> {money(recommendation.estimatedUnitCost)} por unidad</p>
                      </>
                    )}
                  </div>
                  {recommendation.warnings.length > 0 && (
                    <div className="mt-3 rounded-lg bg-[var(--color-warning-50)] p-2 text-xs text-[var(--color-warning-700)]">
                      {recommendation.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={!canCreate || creatingRecommendationId === recommendation.id}
                    onClick={() => createSuggestedBatch(recommendation)}
                    className="mt-3 rounded-lg bg-[var(--color-master-600)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creatingRecommendationId === recommendation.id ? "Creando..." : "Crear lote sugerido"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.35fr]">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Prioridades de produccion</h2>
          <div className="mt-4 space-y-3">
            {loading ? <p className="text-sm text-[var(--color-text-muted)]">Cargando prioridades...</p> : priorities.length === 0 ? (
              <EmptyState title="Sin prioridades pendientes" body="Cuando existan lotes en proceso o recetas incompletas apareceran aqui." />
            ) : priorities.map((item) => (
              <div key={`${item.label}-${item.detail}`} className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] px-3 py-3">
                <span className={`mt-1 h-2.5 w-2.5 rounded-full ${item.tone === "danger" ? "bg-[var(--color-danger-500)]" : "bg-[var(--color-warning-500)]"}`} />
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text)]">{item.label}</p>
                  <p className="text-sm text-[var(--color-text-muted)]">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Ultimos lotes</h2>
            <Link href="/app/master/production/batches" className="text-sm font-medium text-[var(--color-master-600)] hover:underline">Ver todos</Link>
          </div>
          {loading ? <p className="p-5 text-sm text-[var(--color-text-muted)]">Cargando lotes...</p> : batches.length === 0 ? (
            <div className="p-4"><EmptyState title="No hay lotes creados" body="Crea un lote desde una receta activa para validar insumos, producir y registrar Kardex." /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="hm-table w-full text-sm">
                <thead className="bg-[var(--color-surface-alt)] text-xs uppercase text-[var(--color-text-muted)]">
                  <tr>
                    <th className="px-4 py-3 text-left">Lote</th>
                    <th className="px-4 py-3 text-left">Receta</th>
                    <th className="px-4 py-3 text-left">Producto terminado</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                    <th className="px-4 py-3 text-right">Cantidad</th>
                    <th className="px-4 py-3 text-right">Costo unitario</th>
                    <th className="px-4 py-3 text-left">Fecha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {batches.slice(0, 8).map((batch) => {
                    const st = STATUS[batch.status] ?? { label: batch.status, tone: "neutral" as const };
                    return (
                      <tr key={batch.id} className="hover:bg-[var(--color-surface-alt)]">
                        <td className="px-4 py-3"><Link href={`/app/master/production/batches/${batch.id}` as never} className="font-semibold text-[var(--color-master-600)] hover:underline">{batch.batchNumber}</Link></td>
                        <td className="px-4 py-3 text-[var(--color-text)]">{batch.recipe.name}</td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">{batch.recipe.code}</td>
                        <td className="px-4 py-3 text-center"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_TONE_CLASS[st.tone]}`}>{st.label}</span></td>
                        <td className="px-4 py-3 text-right">{num(batch.producedGoodQuantity ?? batch.plannedQuantity)}</td>
                        <td className="px-4 py-3 text-right">{money(batch.unitCost)}</td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">{fmtDateNumeric(batch.completedAt ?? batch.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Por producto (periodo seleccionado)</h2>
        {dashboardLoading ? (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">Calculando...</p>
        ) : !dashboard || dashboard.producedByProduct.length === 0 ? (
          <div className="mt-4"><EmptyState title="Sin produccion en este periodo" body="Los productos aparecen aqui cuando se completan lotes en el rango de fechas elegido." /></div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="hm-table w-full text-sm">
              <thead className="bg-[var(--color-surface-alt)] text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Producto</th>
                  <th className="px-3 py-2 text-right">Buenas</th>
                  <th className="px-3 py-2 text-right">Malas</th>
                  <th className="px-3 py-2 text-right">Rendimiento</th>
                  <th className="px-3 py-2 text-right">Meta</th>
                  <th className="px-3 py-2 text-right">Costo unitario ponderado</th>
                  <th className="px-3 py-2 text-right">Precio actual</th>
                  <th className="px-3 py-2 text-right">Margen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {dashboard.producedByProduct.map((row) => (
                  <tr key={row.productId}>
                    <td className="px-3 py-2 font-semibold text-[var(--color-text)]">{row.productName}</td>
                    <td className="px-3 py-2 text-right">{num(row.goodQuantity)}</td>
                    <td className="px-3 py-2 text-right">{num(row.badQuantity)}</td>
                    <td className="px-3 py-2 text-right">{row.weightedYieldPct != null ? pct(row.weightedYieldPct) : "-"}</td>
                    <td className="px-3 py-2 text-right text-[var(--color-text-muted)]">{row.targetYieldPct != null ? pct(row.targetYieldPct) : "-"}</td>
                    <td className="px-3 py-2 text-right">{money(row.weightedUnitCost)}</td>
                    <td className="px-3 py-2 text-right">{money(row.currentPrice)}</td>
                    <td className="px-3 py-2 text-right" style={{ color: row.marginAtCurrentPrice != null && row.marginAtCurrentPrice > 0 ? "var(--color-success-700)" : "var(--color-danger-700)" }}>
                      {row.marginAtCurrentPrice != null ? pct(row.marginAtCurrentPrice) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Recetas incompletas</h2>
          {dashboardLoading ? (
            <p className="mt-4 text-sm text-[var(--color-text-muted)]">Calculando...</p>
          ) : !dashboard || dashboard.incompleteRecipes.length === 0 ? (
            <div className="mt-4"><EmptyState title="Todas las recetas activas están completas" body="Sin insumos, cantidad esperada inválida o insumo sin costo." /></div>
          ) : (
            <div className="mt-4 space-y-2">
              {dashboard.incompleteRecipes.map((r) => (
                <div key={r.recipeId} className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--color-danger-500)]" />
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text)]">{r.recipeName} <span className="font-mono text-xs text-[var(--color-text-muted)]">{r.recipeCode}</span></p>
                    <p className="text-sm text-[var(--color-text-muted)]">{INCOMPLETE_REASON_LABEL[r.reason] ?? r.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Insumos que bloquean lotes</h2>
          <p className="text-sm text-[var(--color-text-muted)]">Lotes PLANIFICADOS o EN PROCESO con reserva insuficiente — hace falta comprar o trasladar.</p>
          {dashboardLoading ? (
            <p className="mt-4 text-sm text-[var(--color-text-muted)]">Calculando...</p>
          ) : !dashboard || dashboard.blockingInputs.length === 0 ? (
            <div className="mt-4"><EmptyState title="Sin insumos bloqueando" body="Todos los lotes abiertos tienen su insumo completamente reservado." /></div>
          ) : (
            <div className="mt-4 space-y-2">
              {dashboard.blockingInputs.map((b) => (
                <div key={b.productId} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text)]">{b.productName}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{b.batchCount} lote{b.batchCount === 1 ? "" : "s"} afectado{b.batchCount === 1 ? "" : "s"}</p>
                  </div>
                  <span className="font-mono text-sm font-bold text-[var(--color-warning-700)]">Faltan {num(b.shortfall)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
