"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { DollarSign, Box, CircleMinus, Hourglass, Tag, Pause, Package, ScanLine, Plus, Boxes, ClipboardCheck } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useInventoryScope } from "@/hooks/use-inventory-scope";
import { money, money0, moneyCompact, qty, fmtDate } from "@/lib/format";
import { kpiTone, bucketCategoryValues, buildAttentionItems, combinedCoveragePercent, type AttentionItem, type CategoryBar, type KpiTone, type StateCoverage } from "@/lib/inventory-home-logic";
import { LoadingState } from "@/components/ui/loading-state";

/**
 * prompt-inventario-inicio-fix.md Commit 2 — Inicio rediseñado: KPIs 3×2
 * sin cortes, "Para atender" por tipo e impacto, categorías y flujo diario
 * con valores. Reemplaza el Inicio de prompt-inventario-v3.md Fase 2.2.
 *
 * Alcance: lee `?branchId=`/`?scope=network` de la URL (mismo mecanismo que
 * InventoryTopbar, Commit 1) — nunca el selector global de sucursal
 * directamente. "Toda la red" agrega de verdad en overview/attention (el
 * backend ya soporta branchId=null ahí); categorías y flujo diario NO
 * tienen variante de red todavía (fuera de lo que este commit pide — ver
 * comentario de getInventoryDailyFlow) y caen a la sucursal activa del
 * usuario como referencia, con un aviso explícito en su encabezado.
 *
 * Commit 3 §3 — "Datos actualizándose (N% listo)": combina la cobertura de
 * overview (ProductBranchState) y quality (ProductCatalogState) en un solo
 * aviso con barra; solo se muestra cuando de verdad falta algo (en
 * producción, a 2026-10-20, las dos están al 100% — el aviso simplemente
 * no aparece, no es un placeholder fijo).
 */

type Overview = {
  branchId: string | null;
  totalValueAtCost: number;
  activeProducts: number;
  createdThisMonth: number;
  negativeStock: number;
  lowStock: number;
  noCostOrPrice: number;
  noMovement90d: { count: number; value: number; withCost: number };
  coverage: StateCoverage;
};

type QualityCounts = { noCost: number; noPrice: number; noCode: number; costEqualsPrice: number; noCategory: number; affectedProducts: number; coverage: StateCoverage };

type AttentionCounts = {
  noCost: number;
  noPrice: number;
  costEqualsPrice: number;
  negativeStock: number;
  lowStock: number;
  staleTransfers: number;
  staleTransferSample: { transferNumber: string; fromBranchCode: string; toBranchCode: string } | null;
  failedIntakeLines: number;
  topMoversNoCost: number | null;
};

type DailyFlowPoint = { date: string; unitsIn: number; unitsOut: number };
type CategoryNode = { id: string; name: string; valueAtCost: number; productCount: number; children: CategoryNode[] };

function flattenCategoryValues(nodes: CategoryNode[]): Array<{ name: string; value: number }> {
  const flat: Array<{ name: string; value: number }> = [];
  for (const node of nodes) {
    if (node.valueAtCost > 0) flat.push({ name: node.name, value: node.valueAtCost });
    flat.push(...flattenCategoryValues(node.children));
  }
  return flat;
}

export function InventoryHome() {
  const searchParams = useSearchParams();
  // El mismo alcance que la barra (useInventoryScope: `?branch=`, links
  // viejos y localStorage) — antes Inicio leía solo `?branchId=`/`?scope=`,
  // que la barra ya no escribe, y cambiar de sucursal no cambiaba nada acá.
  const scope = useInventoryScope();
  const isNetwork = scope.mode === "all";
  const branchId = isNetwork ? null : scope.branchId;
  // Referencia para lo que NO tiene variante de red (categorías, flujo diario) — siempre una sucursal concreta.
  const referenceBranchId = branchId ?? scope.branches[0]?.id ?? "";
  const referenceBranchCode = scope.branches.find((b) => b.id === referenceBranchId)?.code ?? "";
  const tab = searchParams.get("tab");

  const [overview, setOverview] = useState<Overview | null>(null);
  const [quality, setQuality] = useState<QualityCounts | null>(null);
  const [attentionCounts, setAttentionCounts] = useState<AttentionCounts | null>(null);
  const [dailyFlow, setDailyFlow] = useState<DailyFlowPoint[]>([]);
  const [categoryBars, setCategoryBars] = useState<CategoryBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (scope.loading || !referenceBranchId) return;
    setLoading(true);
    setLoadError(false);
    const scopeQs = isNetwork ? "" : `?branchId=${branchId}`;
    // unwrapApiData no falla con una respuesta de error — sin este chequeo
    // el sobre {ok:false} se guardaba como si fueran los datos.
    const get = (url: string) => apiFetch(url).then(async (r) => {
      if (!r.ok) throw new Error(url);
      return unwrapApiData(await r.json());
    });
    Promise.all([
      get(`/api/master/inventory/overview${scopeQs}`),
      get(`/api/master/inventory/quality`),
      get(`/api/master/inventory/attention${scopeQs}`),
      get(`/api/master/inventory/daily-flow?branchId=${referenceBranchId}`),
      get(`/api/master/inventory/categories?branchId=${referenceBranchId}`),
    ])
      .then(([overviewData, qualityData, attentionData, flowData, categoriesData]) => {
        setOverview(overviewData as Overview);
        setQuality(qualityData as QualityCounts);
        setAttentionCounts(attentionData as AttentionCounts);
        setDailyFlow(flowData as DailyFlowPoint[]);
        setCategoryBars(bucketCategoryValues(flattenCategoryValues(categoriesData as CategoryNode[])));
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [scope.loading, branchId, isNetwork, referenceBranchId, reloadKey]);

  if (loadError) {
    return (
      <div className="rounded-xl border border-[var(--color-danger-300)] bg-[var(--color-danger-50)] p-4 text-sm text-[var(--color-danger-700)]">
        No se pudo cargar el inventario.{" "}
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="font-semibold underline">Reintentar</button>
      </div>
    );
  }
  if (scope.loading || !referenceBranchId) return <LoadingState message="Cargando sucursal…" />;
  if (loading || !overview || !quality || !attentionCounts) return <LoadingState message="Cargando inventario…" />;

  const attentionItems = buildAttentionItems({ ...attentionCounts, topMoversNoCost: isNetwork ? null : attentionCounts.topMoversNoCost });
  const withCost = overview.activeProducts - quality.noCost;
  const pendingQualityTotal = quality.noCost + quality.noPrice + quality.noCode + quality.costEqualsPrice + quality.noCategory;
  const coveragePercent = combinedCoveragePercent(overview.coverage, quality.coverage);

  const coverageBanner = coveragePercent < 100 && (
    <div className="rounded-xl border border-[var(--color-info-200)] bg-[var(--color-info-50)] p-3">
      <p className="text-xs text-[var(--color-info-700)]">
        Datos actualizándose: {coveragePercent}% de los productos ya tienen su estado calculado. Los números pueden cambiar.
      </p>
      <div className="mt-2 h-1.5 w-full rounded-full bg-[var(--color-info-100)]">
        <div className="h-1.5 rounded-full bg-[var(--color-info-500)]" style={{ width: `${coveragePercent}%` }} />
      </div>
    </div>
  );

  const kpis = (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      <HomeKpiCard
        icon={DollarSign}
        label="Valor a costo"
        value={moneyCompact(overview.totalValueAtCost)}
        exactTooltip={money(overview.totalValueAtCost)}
        tone="neutral"
        subline={`Con costo: ${withCost.toLocaleString("es-NI")} de ${overview.activeProducts.toLocaleString("es-NI")} productos`}
      />
      <HomeKpiCard
        icon={Box}
        label="Productos activos"
        value={qty(overview.activeProducts)}
        tone="neutral"
        subline={`${overview.createdThisMonth.toLocaleString("es-NI")} creados este mes`}
      />
      <HomeKpiCard
        icon={CircleMinus}
        label="Stock negativo"
        value={qty(overview.negativeStock)}
        tone={kpiTone("negativeStock", overview.negativeStock)}
        subline={overview.negativeStock > 0 ? "Revisar antes de vender" : "Sin problemas"}
        sublineOk={overview.negativeStock === 0}
      />
      <HomeKpiCard
        icon={Hourglass}
        label="Por agotarse"
        value={qty(overview.lowStock)}
        tone={kpiTone("lowStock", overview.lowStock)}
        subline={overview.lowStock > 0 ? "Podrían quedarse sin stock pronto" : "Sin problemas"}
        sublineOk={overview.lowStock === 0}
      />
      <HomeKpiCard
        icon={Tag}
        label="Sin costo o sin precio"
        value={qty(overview.noCostOrPrice)}
        tone={kpiTone("noCostOrPrice", overview.noCostOrPrice)}
        subline={
          overview.noCostOrPrice === 0
            ? "Sin problemas"
            : attentionCounts.topMoversNoCost
              ? `${attentionCounts.topMoversNoCost} de ellos están entre los más vendidos`
              : `${overview.noCostOrPrice.toLocaleString("es-NI")} productos`
        }
        sublineOk={overview.noCostOrPrice === 0}
      />
      <HomeKpiCard
        icon={Pause}
        label="Sin movimiento 90 días"
        value={qty(overview.noMovement90d.count)}
        tone="neutral"
        subline={
          overview.noMovement90d.count === 0
            ? "Nada sin movimiento"
            : `${money0(overview.noMovement90d.value)} en ${overview.noMovement90d.withCost} con costo · ${(overview.noMovement90d.count - overview.noMovement90d.withCost).toLocaleString("es-NI")} sin costo`
        }
      />
    </div>
  );

  const attentionPanel = (
    <div className="rounded-xl border border-[var(--color-border-strong)] p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Para atender</h2>
        <span className="text-[11px] text-[var(--color-text-muted)]">ordenado por impacto</span>
      </div>
      {pendingQualityTotal > 0 && (
        <p className="mb-3 text-[11px] text-[var(--color-text-muted)]">
          Calidad de datos: {pendingQualityTotal.toLocaleString("es-NI")} pendientes en {quality.affectedProducts.toLocaleString("es-NI")} productos
        </p>
      )}
      {attentionItems.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Nada pendiente por ahora.</p>
      ) : (
        <div className="divide-y divide-[var(--color-border)]">
          {attentionItems.map((item) => (
            <AttentionItemRow key={item.type} item={item} />
          ))}
        </div>
      )}
    </div>
  );

  const categoriesPanel = (
    <div className="rounded-xl border border-[var(--color-border-strong)] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Valor por categoría</h2>
        <span className="text-[11px] text-[var(--color-text-muted)]">a costo · top 8{isNetwork ? ` · sucursal ${referenceBranchCode}` : ""}</span>
      </div>
      {categoryBars.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Sin datos todavía.</p>
      ) : (
        <div className="space-y-2">
          {(() => {
            const max = Math.max(...categoryBars.map((c) => c.value));
            return categoryBars.map((bar) => (
              <div key={bar.name} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-xs text-[var(--color-text-secondary)]">{bar.name}</span>
                <div className="h-4 flex-1 rounded-full bg-[var(--color-surface-alt)]">
                  <div
                    className={`h-4 rounded-full ${bar.isOther ? "bg-[var(--color-text-muted)]" : "bg-[var(--color-master-500)]"}`}
                    style={{ width: `${max > 0 ? Math.max((bar.value / max) * 100, 3) : 0}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-xs font-medium text-[var(--color-text)]">{money0(bar.value)}</span>
              </div>
            ));
          })()}
        </div>
      )}
    </div>
  );

  const dailyFlowPanel = (
    <div className="rounded-xl border border-[var(--color-border-strong)] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Entradas y salidas · últimos 30 días</h2>
        <span className="text-[11px] text-[var(--color-text-muted)]">unidades por día{isNetwork ? ` · sucursal ${referenceBranchCode}` : ""}</span>
      </div>
      {dailyFlow.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Sin movimientos en los últimos 30 días.</p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={dailyFlow.map((d) => ({ ...d, label: fmtDate(d.date) }))} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: unknown) => [qty(Number(v)), ""]} />
            <Legend wrapperStyle={{ fontSize: "0.7rem" }} />
            <Bar dataKey="unitsIn" name="Entradas" fill="var(--color-success-500)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="unitsOut" name="Salidas (ventas, traslados, ajustes)" fill="var(--color-info-500)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {tab === null && (
        <>
          {coverageBanner}
          {kpis}
          <div className="grid gap-4 lg:grid-cols-2">
            {attentionPanel}
            {categoriesPanel}
          </div>
          {dailyFlowPanel}
          <div className="flex flex-wrap gap-2">
            <QuickLink href="/app/master/catalog-inventory?tab=intakes" icon={Package} label="Entrada de inventario" primary />
            <QuickLink href="/app/master/catalog/products/quick-add" icon={ScanLine} label="Escanear productos" />
            <QuickLink href="/app/master/catalog-inventory?tab=products" icon={Plus} label="Nuevo producto" />
            <QuickLink href="/app/master/catalog-inventory?tab=counts" icon={ClipboardCheck} label="Conteo" />
            <QuickLink href="/app/master/catalog-inventory?tab=stock" icon={Boxes} label="Ver stock por sucursal" />
          </div>
        </>
      )}
      {tab === "attention" && attentionPanel}
      {tab === "analysis" && (
        <>
          {categoriesPanel}
          {dailyFlowPanel}
        </>
      )}
    </div>
  );
}

const DOT_TONE_CLASSES: Record<AttentionItem["dotTone"], string> = {
  danger: "bg-[var(--color-danger-500)]",
  warning: "bg-[var(--color-warning-500)]",
  info: "bg-[var(--color-info-500)]",
};

function AttentionItemRow({ item }: { item: AttentionItem }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT_TONE_CLASSES[item.dotTone]}`} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text)]">{item.label}</p>
          <p className="truncate text-xs text-[var(--color-text-muted)]">{item.context}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-sm font-bold text-[var(--color-text)]">{item.count.toLocaleString("es-NI")}</span>
        <Link href={item.actionHref as Route} className="text-xs font-semibold text-[var(--color-info-600)] hover:underline">
          {item.actionLabel}
        </Link>
      </div>
    </div>
  );
}

const KPI_TONE_BORDER: Record<KpiTone, string> = {
  neutral: "border-[var(--color-border-strong)]",
  danger: "border-[var(--color-danger-300)]",
  warning: "border-[var(--color-warning-300)]",
};
const KPI_TONE_TEXT: Record<KpiTone, string> = {
  neutral: "text-[var(--color-text)]",
  danger: "text-[var(--color-danger-600)]",
  warning: "text-[var(--color-warning-500)]",
};
const KPI_TONE_ICON: Record<KpiTone, string> = {
  neutral: "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]",
  danger: "bg-[var(--color-danger-100)] text-[var(--color-danger-600)]",
  warning: "bg-[var(--color-warning-100)] text-[var(--color-warning-600)]",
};

function HomeKpiCard({ icon: Icon, label, value, exactTooltip, subline, sublineOk, tone }: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  exactTooltip?: string;
  subline: string;
  sublineOk?: boolean;
  tone: KpiTone;
}) {
  return (
    <div className={`rounded-xl border p-4 ${KPI_TONE_BORDER[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</p>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${KPI_TONE_ICON[tone]}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <p
        className={`mt-1 font-bold leading-tight ${KPI_TONE_TEXT[tone]}`}
        style={{ fontSize: "clamp(1.1rem, 2.4vw, 1.5rem)" }}
        title={exactTooltip}
      >
        {value}
      </p>
      <p className={`mt-1 text-xs ${sublineOk ? "text-[var(--color-success-600)]" : "text-[var(--color-text-muted)]"}`}>{subline}</p>
    </div>
  );
}

function QuickLink({ href, icon: Icon, label, primary }: { href: string; icon: typeof Package; label: string; primary?: boolean }) {
  return (
    <Link
      href={href as Route}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        primary
          ? "bg-[var(--color-master-600)] text-white hover:bg-[var(--color-master-700)]"
          : "border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}
