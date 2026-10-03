"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Factory,
  PackageX,
  Plus,
  ReceiptText,
  RefreshCcw,
  Tag,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { fmtDateNumeric, fmtRatioPercent, money, qty2 } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { components } from "@/styles/design-system";
import {
  INCOMPLETE_RECIPE_REASON,
  RECOMMENDATION_TYPE,
  batchStatus,
  recommendationPriority,
  type Tone,
} from "@/lib/production-labels";
import { PERIOD_PRESETS, formatPeriodRange, resolvePeriod, type PeriodPreset } from "@/lib/production-period";

/**
 * Hub de Producción de Materiales. UI adoptada de un diseño alterno
 * (hub-produccion.patch) construido contra una versión previa del backend;
 * el cálculo server-side (dashboard por sucursal/período, costo ponderado,
 * recomendaciones con demanda real/BUY_INSTEAD/merma) es el de
 * prompt-produccion-materiales.md Fases 3-4, sin tocar.
 */

/* ── Tipos: espejo de GET /api/master/production/dashboard ─────────────── */

type BranchRef = { id: string; code?: string; name: string };
type ProductRef = { id: string; name: string; unit?: string | null };

type ShortInput = { productId: string; productName: string; unit: string; planned: number; reserved: number; missing: number };

type Dashboard = {
  period: { from: string; to: string };
  totals: {
    completedBatches: number;
    producedValue: number;
    lossValue: number;
    avgYieldPct: number | null;
    reversedBatches: number;
    openBatches: number;
    openBatchesWithShortInputs: number;
  };
  producedByProduct: Array<{
    productId: string;
    productName: string;
    sku: string;
    unit: string | null;
    batchCount: number;
    goodQuantity: number;
    badQuantity: number;
    weightedYieldPct: number | null;
    targetYieldPct: number | null;
    weightedUnitCost: number | null;
    currentPrice: number | null;
    marginAtCurrentPrice: number | null;
  }>;
  materialVarianceCostTotal: number;
  attention: {
    openBatches: Array<{
      id: string;
      batchNumber: string;
      status: string;
      plannedQuantity: number;
      createdAt: string;
      startedAt: string | null;
      branch: BranchRef;
      recipe: { id: string; name: string };
      product: ProductRef;
      shortInputs: ShortInput[];
    }>;
    priceApprovals: Array<{
      id: string;
      batchNumber: string;
      completedAt: string | null;
      unitCost: number | null;
      suggestedPrice: number | null;
      branch: BranchRef;
      product: ProductRef;
    }>;
    incompleteRecipes: Array<{ recipeId: string; recipeName: string; recipeCode: string; reason: string }>;
  };
};

type RecentBatch = {
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

type Recommendation = {
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
  suggestedBatches: number;
  expectedOutputQty: number;
  estimatedUnitCost: number | null;
  buyCost: number | null;
  priority: string;
  recommendationType: string;
  warnings: string[];
  recommendedActions: string[];
};

type AttentionItem = {
  key: string;
  tone: Tone;
  Icon: LucideIcon;
  title: string;
  detail: string;
  meta?: ReactNode;
  href: string;
  rank: number;
};

/* ── Utilidades de presentación ─────────────────────────────────────────── */

const ALL_BRANCHES = "";
const RECENT_BATCHES_LIMIT = 10;

const TONE_ICON: Record<Tone, string> = {
  danger: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
  warning: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  success: "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  info: "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  neutral: "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]",
};

const qtyWithUnit = (value: number | null | undefined, unit?: string | null) =>
  value == null ? "—" : `${qty2(value)}${unit ? ` ${unit}` : ""}`;

const moneyOrDash = (value: number | null | undefined) => (value == null ? "—" : money(value));

function sinceLabel(iso: string, now: number): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${days} días`;
}

/*
 * globals.css trae `a { color: inherit }` sin capa, y en Tailwind 4 eso le
 * gana a cualquier utilidad de color (que vive en @layer utilities). Por eso
 * el color del texto de los <Link> va con `!` — sin eso, los enlaces y los
 * botones-enlace salen en el color del texto heredado.
 */
const LINK_TEXT: Record<"primary" | "secondary" | "ghost", string> = {
  primary: "!text-white",
  secondary: "!text-[var(--color-text)]",
  ghost: "!text-[var(--color-text-secondary)]",
};
const linkButton = (variant: "primary" | "secondary" | "ghost", size: "sm" | "md" = "md") =>
  `${components.button.base} ${components.button[variant]} ${components.button.sizes[size]} ${LINK_TEXT[variant]}`;
const TEXT_LINK = "font-semibold !text-[var(--color-master-700)] hover:underline";

/**
 * Ordena lo que necesita atención: insumos faltantes primero (frena
 * producción), luego precios por aprobar (afecta venta), recetas
 * incompletas y, al final, lotes abiertos sin problema (seguimiento).
 */
function buildAttentionItems(dashboard: Dashboard, now: number): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const batch of dashboard.attention.openBatches) {
    const status = batchStatus(batch.status);
    const since = sinceLabel(batch.startedAt ?? batch.createdAt, now);
    if (batch.shortInputs.length > 0) {
      items.push({
        key: `short-${batch.id}`,
        tone: "danger",
        Icon: PackageX,
        title: `${batch.batchNumber} · ${batch.product.name}`,
        detail: `Faltan ${batch.shortInputs.map((input) => `${input.productName} (${qtyWithUnit(input.missing, input.unit)})`).join(", ")}`,
        meta: <Badge variant={status.tone}>{status.label}</Badge>,
        href: `/app/master/production/batches/${batch.id}`,
        rank: 0,
      });
    } else {
      items.push({
        key: `open-${batch.id}`,
        tone: batch.status === "DRAFT" ? "neutral" : "info",
        Icon: Factory,
        title: `${batch.batchNumber} · ${batch.product.name}`,
        detail: `${qtyWithUnit(batch.plannedQuantity, batch.product.unit)} planificadas en ${batch.branch.name} · ${batch.status === "DRAFT" ? "sin reservar insumos" : since}`,
        meta: <Badge variant={status.tone}>{status.label}</Badge>,
        href: `/app/master/production/batches/${batch.id}`,
        rank: 3,
      });
    }
  }

  for (const approval of dashboard.attention.priceApprovals) {
    items.push({
      key: `price-${approval.id}`,
      tone: "warning",
      Icon: Tag,
      title: `Precio por aprobar · ${approval.product.name}`,
      detail: `Lote ${approval.batchNumber} en ${approval.branch.name}: costo ${moneyOrDash(approval.unitCost)}, precio sugerido ${moneyOrDash(approval.suggestedPrice)}`,
      href: `/app/master/production/batches/${approval.id}`,
      rank: 1,
    });
  }

  for (const recipe of dashboard.attention.incompleteRecipes) {
    items.push({
      key: `recipe-${recipe.recipeId}`,
      tone: "warning",
      Icon: ClipboardList,
      title: `Receta incompleta · ${recipe.recipeName}`,
      detail: `${recipe.recipeCode}: ${INCOMPLETE_RECIPE_REASON[recipe.reason] ?? recipe.reason}`,
      href: `/app/master/production/recipes/${recipe.recipeId}`,
      rank: 2,
    });
  }

  return items.sort((a, b) => a.rank - b.rank);
}

/* ── Piezas de UI ───────────────────────────────────────────────────────── */

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`rounded-md bg-[var(--color-surface-alt)] motion-safe:animate-pulse ${className}`} aria-hidden="true" />;
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-4 text-sm text-[var(--color-danger-700)] sm:flex-row sm:items-center sm:justify-between">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className={linkButton("secondary", "sm")}>
        <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reintentar
      </button>
    </div>
  );
}

function Panel({ title, description, action, children, className = "" }: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--color-text)] [text-wrap:balance]">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: ReactNode; tone?: Tone }) {
  const valueColor = tone === "danger"
    ? "text-[var(--color-danger-700)]"
    : tone === "warning"
      ? "text-[var(--color-warning-700)]"
      : "text-[var(--color-text)]";
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-[var(--color-surface)] px-5 py-4">
      <p className="text-sm text-[var(--color-text-muted)]">{label}</p>
      <p className={`text-2xl font-bold tabular-nums tracking-[-0.02em] ${valueColor}`}>{value}</p>
      {hint && <p className="text-xs text-[var(--color-text-soft)]">{hint}</p>}
    </div>
  );
}

function ShowMore({ total, shown, expanded, onToggle }: { total: number; shown: number; expanded: boolean; onToggle: () => void }) {
  if (total <= shown && !expanded) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full border-t border-[var(--color-border)] px-5 py-3 text-left text-sm font-semibold text-[var(--color-master-700)] transition-colors hover:bg-[var(--color-surface-alt)]"
    >
      {expanded ? "Mostrar menos" : `Ver ${total - shown} más`}
    </button>
  );
}

/* ── Página ─────────────────────────────────────────────────────────────── */

const ATTENTION_PREVIEW = 6;
const RECOMMENDATION_PREVIEW = 4;

export default function ProductionHubPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<BranchRef[]>([]);
  const [branchId, setBranchId] = useState(ALL_BRANCHES);
  const [preset, setPreset] = useState<PeriodPreset>("THIS_MONTH");

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [recentBatches, setRecentBatches] = useState<RecentBatch[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const [recommendationBranchId, setRecommendationBranchId] = useState("");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const [attentionExpanded, setAttentionExpanded] = useState(false);
  const [recommendationsExpanded, setRecommendationsExpanded] = useState(false);

  // Se fija al cargar el tablero, no en cada render: "hace N días" estable.
  const [now, setNow] = useState(() => Date.now());
  const period = useMemo(() => resolvePeriod(preset, new Date(now)), [preset, now]);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/branches")
      .then(async (res) => (res.ok ? (unwrapApiData(await res.json()) as BranchRef[]) : []))
      .then((list) => {
        if (cancelled) return;
        const safe = Array.isArray(list) ? list : [];
        setBranches(safe);
        setRecommendationBranchId((current) => current || safe[0]?.id || "");
      })
      .catch(() => { if (!cancelled) setBranches([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDashboardLoading(true);
    setDashboardError(null);
    const params = new URLSearchParams({ from: period.from.toISOString(), to: period.to.toISOString() });
    if (branchId) params.set("branchId", branchId);
    apiFetch(`/api/master/production/dashboard?${params.toString()}`)
      .then(async (res) => {
        const raw = await res.json().catch(() => null);
        if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar el tablero de producción.");
        if (!cancelled) setDashboard(unwrapApiData(raw) as Dashboard);
      })
      .catch((error: unknown) => {
        if (!cancelled) setDashboardError(error instanceof Error ? error.message : "No se pudo cargar el tablero de producción.");
      })
      .finally(() => { if (!cancelled) setDashboardLoading(false); });
    return () => { cancelled = true; };
  }, [branchId, period, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    setRecentLoading(true);
    const params = new URLSearchParams({ limit: String(RECENT_BATCHES_LIMIT) });
    if (branchId) params.set("branchId", branchId);
    apiFetch(`/api/master/production/batches?${params.toString()}`)
      .then(async (res) => (res.ok ? (unwrapApiData(await res.json()) as RecentBatch[]) : []))
      .then((list) => { if (!cancelled) setRecentBatches(Array.isArray(list) ? list : []); })
      .catch(() => { if (!cancelled) setRecentBatches([]); })
      .finally(() => { if (!cancelled) setRecentLoading(false); });
    return () => { cancelled = true; };
  }, [branchId, reloadKey]);

  // Las recomendaciones son por sucursal: con un filtro activo se usa ese;
  // con "Todas", el selector propio del panel.
  const effectiveRecommendationBranch = branchId || recommendationBranchId;

  useEffect(() => {
    let cancelled = false;
    if (!effectiveRecommendationBranch) {
      setRecommendations([]);
      return;
    }
    setRecommendationsLoading(true);
    setRecommendationsError(null);
    apiFetch(`/api/master/production/recommendations?branchId=${encodeURIComponent(effectiveRecommendationBranch)}`)
      .then(async (res) => {
        const raw = await res.json().catch(() => null);
        if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudieron cargar las recomendaciones.");
        const data = unwrapApiData(raw) as { recommendations?: Recommendation[] };
        if (!cancelled) setRecommendations(data.recommendations ?? []);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRecommendations([]);
          setRecommendationsError(error instanceof Error ? error.message : "No se pudieron cargar las recomendaciones.");
        }
      })
      .finally(() => { if (!cancelled) setRecommendationsLoading(false); });
    return () => { cancelled = true; };
  }, [effectiveRecommendationBranch, reloadKey]);

  const reload = useCallback(() => {
    setNow(Date.now());
    setReloadKey((key) => key + 1);
  }, []);

  const createSuggestedBatch = async (recommendation: Recommendation) => {
    setCreatingId(recommendation.id);
    setCreateError(null);
    try {
      const res = await apiFetch("/api/master/production/recommendations/create-batch", {
        method: "POST",
        body: JSON.stringify({
          branchId: recommendation.branchId,
          recipeId: recommendation.recipeId,
          suggestedBatches: recommendation.suggestedBatches,
          targetProductId: recommendation.targetProductId,
          notes: `Lote sugerido: ${recommendation.targetProductName}, faltaban ${qty2(recommendation.targetShortageQty)}.`,
        }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo crear el lote sugerido.");
      const created = unwrapApiData(raw) as { id: string };
      router.push(`/app/master/production/batches/${created.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "No se pudo crear el lote sugerido.");
    } finally {
      setCreatingId(null);
    }
  };

  const attentionItems = useMemo(() => (dashboard ? buildAttentionItems(dashboard, now) : []), [dashboard, now]);
  const visibleAttention = attentionExpanded ? attentionItems : attentionItems.slice(0, ATTENTION_PREVIEW);
  const sortedRecommendations = useMemo(
    () => [...recommendations].sort((a, b) => recommendationPriority(b.priority).rank - recommendationPriority(a.priority).rank),
    [recommendations],
  );
  const visibleRecommendations = recommendationsExpanded ? sortedRecommendations : sortedRecommendations.slice(0, RECOMMENDATION_PREVIEW);

  const totals = dashboard?.totals;
  const lossShare = totals && totals.producedValue > 0 ? totals.lossValue / totals.producedValue : null;
  const branchName = branchId ? branches.find((branch) => branch.id === branchId)?.name : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Producción de materiales"
        description="Qué se fabricó, qué está trabado y qué conviene producir, con costos reales de cada lote."
        actions={(
          <>
            <Link href="/app/master/production/recipes" className={linkButton("ghost")}>
              <ReceiptText className="h-4 w-4" aria-hidden="true" /> Recetas
            </Link>
            <Link href="/app/master/production/recipes/new" className={linkButton("secondary")}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Nueva receta
            </Link>
            <Link href="/app/master/production/batches/new" className={linkButton("primary")}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Nuevo lote
            </Link>
          </>
        )}
      />

      {/* Filtros */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <span>Sucursal</span>
            <select
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              className="hm-input min-w-[12rem] py-2"
            >
              <option value={ALL_BRANCHES}>Todas las sucursales</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </label>
          <div role="radiogroup" aria-label="Período" className="flex w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1 sm:inline-flex sm:w-auto">
            {PERIOD_PRESETS.map((option) => {
              const active = option.value === preset;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPreset(option.value)}
                  className={`flex-auto whitespace-nowrap rounded-lg px-2 py-1.5 text-[0.8125rem] font-medium sm:px-3 sm:text-sm transition-colors duration-150 sm:flex-none ${
                    active
                      ? "bg-[var(--color-master-50)] text-[var(--color-master-700)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
          <span className="tabular-nums">{formatPeriodRange(period.from, period.to)}</span>
          <button type="button" onClick={reload} className={linkButton("ghost", "sm")} aria-label="Actualizar tablero">
            <RefreshCcw className={`h-3.5 w-3.5 ${dashboardLoading ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" /> Actualizar
          </button>
        </div>
      </div>

      {dashboardError && <SectionError message={dashboardError} onRetry={reload} />}

      {/* Resumen del período: una sola banda, no una grilla de tarjetas */}
      <section aria-label="Resumen del período" className="overflow-hidden rounded-xl border border-[var(--color-border)] shadow-[var(--shadow-card)]">
        <div className="grid grid-cols-1 gap-px bg-[var(--color-border)] sm:grid-cols-2 lg:grid-cols-5">
          {dashboardLoading && !dashboard ? (
            Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="space-y-2 bg-[var(--color-surface)] px-5 py-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-7 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))
          ) : totals ? (
            <>
              <Stat
                label="Lotes completados"
                value={String(totals.completedBatches)}
                hint={totals.reversedBatches > 0
                  ? `${totals.reversedBatches} revertido${totals.reversedBatches === 1 ? "" : "s"} en el período`
                  : branchName ? `en ${branchName}` : "en todas las sucursales"}
              />
              <Stat label="Valor producido" value={money(totals.producedValue)} hint="Costo total de lo fabricado" />
              <Stat
                label="Perdido en unidades malas"
                value={money(totals.lossValue)}
                tone={totals.lossValue > 0 ? "warning" : undefined}
                hint={lossShare != null ? `${fmtRatioPercent(lossShare)} del valor producido` : "Sin producción en el período"}
              />
              <Stat
                label="Rendimiento promedio"
                value={fmtRatioPercent(totals.avgYieldPct)}
                hint="Unidades buenas sobre intentadas, por lote"
              />
              <Stat
                label="Lotes abiertos"
                value={String(totals.openBatches)}
                tone={totals.openBatchesWithShortInputs > 0 ? "danger" : undefined}
                hint={totals.openBatchesWithShortInputs > 0
                  ? `${totals.openBatchesWithShortInputs} con insumos faltantes`
                  : totals.openBatches > 0 ? "Todos con insumos reservados" : "Ninguno en curso"}
              />
            </>
          ) : null}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Necesita atención */}
        <Panel
          className="lg:col-span-3"
          title="Necesita atención"
          description="Insumos faltantes, precios por aprobar, recetas incompletas y lotes en curso."
          action={attentionItems.length > 0 ? <Badge variant="neutral">{attentionItems.length}</Badge> : undefined}
        >
          {dashboardLoading && !dashboard ? (
            <div className="space-y-4 p-5">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
                </div>
              ))}
            </div>
          ) : attentionItems.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center">
              <CheckCircle2 className="h-8 w-8 text-[var(--color-success-600)]" aria-hidden="true" />
              <p className="font-semibold text-[var(--color-text)]">Todo en orden</p>
              <p className="max-w-sm text-sm text-[var(--color-text-muted)]">No hay lotes trabados, precios por aprobar ni recetas incompletas.</p>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-[var(--color-border)]">
                {visibleAttention.map((item, index) => (
                  <li
                    key={item.key}
                    className="motion-safe:animate-[fadeInUp_280ms_var(--ease-out-strong)_both]"
                    style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
                  >
                    <Link
                      href={item.href as never}
                      className="group flex items-start gap-3 px-5 py-3.5 transition-colors duration-150 hover:bg-[var(--color-surface-alt)] focus-visible:bg-[var(--color-surface-alt)] focus-visible:outline-none"
                    >
                      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONE_ICON[item.tone]}`}>
                        <item.Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[var(--color-text)]">{item.title}</span>
                        <span className="mt-0.5 block text-sm text-[var(--color-text-muted)]">{item.detail}</span>
                      </span>
                      {item.meta && <span className="hidden shrink-0 sm:block">{item.meta}</span>}
                      <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-[var(--color-text-soft)] transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
              <ShowMore
                total={attentionItems.length}
                shown={ATTENTION_PREVIEW}
                expanded={attentionExpanded}
                onToggle={() => setAttentionExpanded((value) => !value)}
              />
            </>
          )}
        </Panel>

        {/* Qué conviene producir */}
        <Panel
          className="lg:col-span-2"
          title="Qué conviene producir"
          description="Productos por debajo de su nivel que se pueden fabricar con una receta activa."
          action={!branchId && branches.length > 0 ? (
            <select
              value={recommendationBranchId}
              onChange={(event) => setRecommendationBranchId(event.target.value)}
              className="hm-input w-auto py-1.5 text-sm"
              aria-label="Sucursal para recomendaciones"
            >
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          ) : undefined}
        >
          {createError && <div className="px-5 pt-4"><SectionError message={createError} onRetry={() => setCreateError(null)} /></div>}
          {recommendationsError ? (
            <div className="p-5"><SectionError message={recommendationsError} onRetry={reload} /></div>
          ) : recommendationsLoading ? (
            <div className="space-y-4 p-5">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-3/4" /><Skeleton className="h-8 w-28" /></div>
              ))}
            </div>
          ) : !effectiveRecommendationBranch ? (
            <p className="px-5 py-10 text-center text-sm text-[var(--color-text-muted)]">No hay sucursales disponibles.</p>
          ) : sortedRecommendations.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center">
              <Factory className="h-8 w-8 text-[var(--color-text-soft)]" aria-hidden="true" />
              <p className="font-semibold text-[var(--color-text)]">Nada que producir por ahora</p>
              <p className="max-w-xs text-sm text-[var(--color-text-muted)]">Aparece aquí cuando un producto baja de su punto de reorden y tiene una receta viable.</p>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-[var(--color-border)]">
                {visibleRecommendations.map((rec) => {
                  const priority = recommendationPriority(rec.priority);
                  const canCreate = rec.suggestedBatches > 0 && rec.recommendedActions.includes("CREATE_PRODUCTION_BATCH");
                  const isBuyInstead = rec.recommendationType === "BUY_INSTEAD";
                  return (
                    <li key={rec.id} className="space-y-2.5 px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--color-text)]">{rec.targetProductName}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            Hay {qty2(rec.targetStockOnHand)} · faltan <span className="font-semibold text-[var(--color-text-secondary)]">{qty2(rec.targetShortageQty)}</span>
                            {rec.dailySalesVelocity > 0 && (
                              <> · {qty2(rec.dailySalesVelocity)}/día{rec.daysOfStockRemaining != null && ` · ${qty2(rec.daysOfStockRemaining)}d de stock`}</>
                            )}
                          </p>
                        </div>
                        <Badge variant={priority.tone}>{priority.label}</Badge>
                      </div>
                      {isBuyInstead ? (
                        <p className="text-sm font-semibold text-[var(--color-warning-700)]">
                          Comprar sale {moneyOrDash(rec.buyCost)} vs. producir {moneyOrDash(rec.estimatedUnitCost)}
                        </p>
                      ) : (
                        <p className="text-sm text-[var(--color-text-secondary)]">
                          {canCreate ? (
                            <>Producir <span className="font-semibold tabular-nums">{qty2(rec.expectedOutputQty)}</span> con «{rec.recipeName}»
                              {rec.estimatedUnitCost != null && <> a <span className="tabular-nums">{money(rec.estimatedUnitCost)}</span> c/u</>}</>
                          ) : (
                            <>{RECOMMENDATION_TYPE[rec.recommendationType] ?? rec.recommendationType} para «{rec.recipeName}»</>
                          )}
                        </p>
                      )}
                      {rec.warnings.length > 0 && (
                        <p className="flex items-start gap-1.5 text-xs text-[var(--color-warning-700)]">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>{rec.warnings.join(" ")}</span>
                        </p>
                      )}
                      {canCreate && !isBuyInstead && (
                        <button
                          type="button"
                          disabled={creatingId !== null}
                          onClick={() => createSuggestedBatch(rec)}
                          className={linkButton("secondary", "sm")}
                        >
                          {creatingId === rec.id ? "Creando…" : `Crear lote (${rec.suggestedBatches})`}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <ShowMore
                total={sortedRecommendations.length}
                shown={RECOMMENDATION_PREVIEW}
                expanded={recommendationsExpanded}
                onToggle={() => setRecommendationsExpanded((value) => !value)}
              />
            </>
          )}
        </Panel>
      </div>

      {/* Producción por producto */}
      <Panel title="Producción por producto" description="Costo unitario ponderado por cantidad; el margen es contra el precio vigente.">
        {dashboardLoading && !dashboard ? (
          <div className="space-y-3 p-5">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-6 w-full" />)}</div>
        ) : !dashboard || dashboard.producedByProduct.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-[var(--color-text-muted)]">Sin producción completada en este período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="hm-table w-full text-sm">
              <thead>
                <tr>
                  <th className="px-5 py-3 text-left">Producto</th>
                  <th className="px-4 py-3 text-right">Lotes</th>
                  <th className="px-4 py-3 text-right">Buenas</th>
                  <th className="px-4 py-3 text-right">Malas</th>
                  <th className="px-4 py-3 text-right">Rendimiento</th>
                  <th className="px-4 py-3 text-right">Costo unitario</th>
                  <th className="px-4 py-3 text-right">Precio</th>
                  <th className="px-5 py-3 text-right">Margen</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.producedByProduct.map((row) => {
                  const belowTarget = row.weightedYieldPct != null && row.targetYieldPct != null && row.weightedYieldPct < row.targetYieldPct;
                  const marginColor = row.marginAtCurrentPrice == null
                    ? "text-[var(--color-text-soft)]"
                    : row.marginAtCurrentPrice < 0 ? "text-[var(--color-danger-700)] font-semibold" : "text-[var(--color-text)]";
                  return (
                    <tr key={row.productId}>
                      <td className="px-5 py-3">
                        <p className="font-semibold text-[var(--color-text)]">{row.productName}</p>
                        <p className="text-xs text-[var(--color-text-soft)]">{row.sku}</p>
                      </td>
                      <td data-label="Lotes" className="px-4 py-3 text-right tabular-nums">{row.batchCount}</td>
                      <td data-label="Buenas" className="px-4 py-3 text-right tabular-nums">{qtyWithUnit(row.goodQuantity, row.unit)}</td>
                      <td data-label="Malas" className="px-4 py-3 text-right tabular-nums">{row.badQuantity > 0 ? qty2(row.badQuantity) : "—"}</td>
                      <td data-label="Rendimiento" className="px-4 py-3 text-right tabular-nums">
                        <span>
                          <span className={belowTarget ? "font-semibold text-[var(--color-warning-700)]" : "text-[var(--color-text)]"}>{fmtRatioPercent(row.weightedYieldPct)}</span>
                          {row.targetYieldPct != null && <span className="block text-xs text-[var(--color-text-soft)]">meta {fmtRatioPercent(row.targetYieldPct)}</span>}
                        </span>
                      </td>
                      <td data-label="Costo unitario" className="px-4 py-3 text-right tabular-nums">{moneyOrDash(row.weightedUnitCost)}</td>
                      <td data-label="Precio" className="px-4 py-3 text-right tabular-nums">{moneyOrDash(row.currentPrice)}</td>
                      <td data-label="Margen" className={`px-5 py-3 text-right tabular-nums ${marginColor}`}>{fmtRatioPercent(row.marginAtCurrentPrice)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Lotes recientes */}
      <Panel
        title="Lotes recientes"
        action={<Link href="/app/master/production/batches" className={`text-sm ${TEXT_LINK}`}>Ver todos los lotes</Link>}
      >
        {recentLoading ? (
          <div className="space-y-3 p-5">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-6 w-full" />)}</div>
        ) : recentBatches.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
            <p className="text-sm text-[var(--color-text-muted)]">Todavía no hay lotes. Crea uno desde una receta activa.</p>
            <Link href="/app/master/production/batches/new" className={linkButton("secondary", "sm")}><Plus className="h-3.5 w-3.5" aria-hidden="true" /> Nuevo lote</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="hm-table w-full text-sm">
              <thead>
                <tr>
                  <th className="px-5 py-3 text-left">Lote</th>
                  <th className="px-4 py-3 text-left">Receta</th>
                  <th className="px-4 py-3 text-left">Sucursal</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-right">Cantidad</th>
                  <th className="px-4 py-3 text-right">Costo unitario</th>
                  <th className="px-5 py-3 text-right">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {recentBatches.map((batch) => {
                  const status = batchStatus(batch.status);
                  const done = batch.status === "COMPLETED" || batch.status === "REVERSED";
                  return (
                    <tr key={batch.id}>
                      <td className="px-5 py-3">
                        <Link href={`/app/master/production/batches/${batch.id}` as never} className={TEXT_LINK}>{batch.batchNumber}</Link>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[var(--color-text)]">{batch.recipe.name}</p>
                        <p className="text-xs text-[var(--color-text-soft)]">{batch.recipe.code}</p>
                      </td>
                      <td data-label="Sucursal" className="px-4 py-3 text-[var(--color-text-secondary)]">{batch.branch.name}</td>
                      <td data-label="Estado" className="px-4 py-3"><Badge variant={status.tone}>{status.label}</Badge></td>
                      <td data-label="Cantidad" className="px-4 py-3 text-right tabular-nums">
                        {done && batch.producedGoodQuantity != null
                          ? <>{qty2(batch.producedGoodQuantity)} <span className="text-[var(--color-text-soft)]">/ {qty2(batch.plannedQuantity)}</span></>
                          : qty2(batch.plannedQuantity)}
                      </td>
                      <td data-label="Costo unitario" className="px-4 py-3 text-right tabular-nums">{moneyOrDash(batch.unitCost)}</td>
                      <td data-label="Fecha" className="px-5 py-3 text-right tabular-nums text-[var(--color-text-muted)]">{fmtDateNumeric(batch.completedAt ?? batch.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
