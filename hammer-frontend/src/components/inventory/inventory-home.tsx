"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { AlertTriangle, TrendingDown, DollarSign, Package, Boxes, ScanLine, Plus, ClipboardCheck } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { money, money0, qty, fmtDate } from "@/lib/format";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { LoadingState } from "@/components/ui/loading-state";

/**
 * prompt-inventario-v3.md Fase 2.2 — Inicio de la sección Inventario:
 * KPIs, "para atender" y gráficos, todos leyendo de los endpoints nuevos
 * de Fase 1 (ProductBranchState/ProductCatalogState) — nunca recalculando
 * nada en el cliente.
 *
 * "Para atender" acá es la versión ACOTADA de lo que pide el doc: stock
 * negativo, por agotarse, sin costo/precio — las 4 señales que Fase 1 ya
 * agrega. Las otras (OC pendiente, conteos por aprobar, traslados en
 * tránsito +2 días, productos creados sin precio) necesitan cruzar con
 * Compras/Traslados/Conteos — fuera de alcance de Fase 2, se suman cuando
 * esos módulos tengan su propio enganche con el estado precalculado.
 */

type Overview = {
  branchId: string;
  totalValueAtCost: number;
  activeProducts: number;
  negativeStock: number;
  lowStock: number;
  noCostOrPrice: number;
  noMovement90d: { count: number; value: number };
};

type DailyFlowPoint = { date: string; unitsIn: number; unitsOut: number };

type TopNoMovementRow = { id: string; sku: string; name: string; quantityOnHand: number; effectiveCost: number | null };

type CategoryNode = { id: string; name: string; valueAtCost: number; productCount: number; children: CategoryNode[] };

function flattenCategoryValues(nodes: CategoryNode[]): Array<{ name: string; value: number }> {
  const flat: Array<{ name: string; value: number }> = [];
  for (const node of nodes) {
    if (node.valueAtCost > 0) flat.push({ name: node.name, value: node.valueAtCost });
    flat.push(...flattenCategoryValues(node.children));
  }
  return flat.sort((a, b) => b.value - a.value).slice(0, 8);
}

export function InventoryHome() {
  const sessionState = useSession();
  const branchId = sessionState.status === "authenticated"
    ? getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId)
    : "";

  const [overview, setOverview] = useState<Overview | null>(null);
  const [dailyFlow, setDailyFlow] = useState<DailyFlowPoint[]>([]);
  const [categoryValues, setCategoryValues] = useState<Array<{ name: string; value: number }>>([]);
  const [topNoMovement, setTopNoMovement] = useState<TopNoMovementRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!branchId) return;
    setLoading(true);
    Promise.all([
      apiFetch(`/api/master/inventory/overview?branchId=${branchId}`).then((r) => r.json()).then(unwrapApiData),
      apiFetch(`/api/master/inventory/daily-flow?branchId=${branchId}`).then((r) => r.json()).then(unwrapApiData),
      apiFetch(`/api/master/inventory/categories?branchId=${branchId}`).then((r) => r.json()).then(unwrapApiData),
      apiFetch(`/api/master/inventory/products?branchId=${branchId}&view=NO_MOVEMENT_90D&sort=value&limit=10`).then((r) => r.json()).then(unwrapApiData),
    ])
      .then(([overviewData, flowData, categoriesData, productsData]) => {
        setOverview(overviewData as Overview);
        setDailyFlow(flowData as DailyFlowPoint[]);
        setCategoryValues(flattenCategoryValues(categoriesData as CategoryNode[]));
        setTopNoMovement(((productsData as { rows: TopNoMovementRow[] }).rows ?? []));
      })
      .finally(() => setLoading(false));
  }, [branchId]);

  if (!branchId) return <LoadingState message="Cargando sucursal…" />;
  if (loading || !overview) return <LoadingState message="Cargando inventario…" />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-[var(--color-text)]">Inventario — Inicio</h1>
        <p className="text-xs text-[var(--color-text-muted)]">Vista general de la sucursal activa.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Valor a costo" value={money0(overview.totalValueAtCost)} accent="master" />
        <KpiCard label="Productos activos" value={qty(overview.activeProducts)} accent="master" />
        <KpiCard label="Stock negativo" value={qty(overview.negativeStock)} tone={overview.negativeStock > 0 ? "alert" : "ok"} accent="master" />
        <KpiCard label="Por agotarse" value={qty(overview.lowStock)} tone={overview.lowStock > 0 ? "alert" : "ok"} accent="master" />
        <KpiCard label="Sin costo o precio" value={qty(overview.noCostOrPrice)} tone={overview.noCostOrPrice > 0 ? "alert" : "ok"} accent="master" />
        <KpiCard label="Sin movimiento 90d" value={qty(overview.noMovement90d.count)} helper={money0(overview.noMovement90d.value)} accent="master" />
      </div>

      <div className="rounded-xl border border-[var(--color-border-strong)] p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Para atender</h2>
        <div className="space-y-2">
          {overview.negativeStock > 0 && (
            <AttentionRow icon={AlertTriangle} tone="critical" label={`${overview.negativeStock} producto(s) con stock negativo`} href="/app/master/catalog-inventory?tab=stock&filter=NEGATIVE_STOCK" />
          )}
          {overview.lowStock > 0 && (
            <AttentionRow icon={TrendingDown} tone="warning" label={`${overview.lowStock} producto(s) por agotarse`} href="/app/master/catalog-inventory?tab=stock&filter=LOW_STOCK" />
          )}
          {overview.noCostOrPrice > 0 && (
            <AttentionRow icon={DollarSign} tone="warning" label={`${overview.noCostOrPrice} producto(s) sin costo o sin precio`} href="/app/master/catalog-inventory?tab=products&filter=NO_COST" />
          )}
          {overview.negativeStock === 0 && overview.lowStock === 0 && overview.noCostOrPrice === 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">Nada pendiente por ahora.</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--color-border-strong)] p-4">
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Valor por categoría (a costo)</h2>
          {categoryValues.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Sin datos todavía.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={categoryValues} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => money0(v)} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: unknown) => [money(Number(v)), "Valor"]} />
                <Bar dataKey="value" fill="var(--color-master-500)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-xl border border-[var(--color-border-strong)] p-4">
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Entradas y salidas — últimos 30 días</h2>
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
                <Bar dataKey="unitsOut" name="Salidas" fill="var(--color-warning-500)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-border-strong)] p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Top 10 sin movimiento (90 días) por valor inmovilizado</h2>
        {topNoMovement.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">Nada sin movimiento — o todavía no hay datos suficientes.</p>
        ) : (
          <div className="space-y-1">
            {topNoMovement.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] py-1.5 text-sm last:border-0">
                <span className="truncate">{row.name} <span className="text-[var(--color-text-muted)]">({row.sku})</span></span>
                <span className="shrink-0 font-medium">{money0(row.quantityOnHand * (row.effectiveCost ?? 0))}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <QuickLink href="/app/master/catalog-inventory?tab=movements" icon={Package} label="Entrada de inventario" primary />
        <QuickLink href="/app/master/catalog/products/quick-add" icon={ScanLine} label="Escanear productos" />
        <QuickLink href="/app/master/catalog-inventory?tab=products" icon={Plus} label="Nuevo producto" />
        <QuickLink href="/app/master/catalog-inventory?tab=movements" icon={ClipboardCheck} label="Conteo" />
        <QuickLink href="/app/master/catalog-inventory?tab=stock" icon={Boxes} label="Ver stock por sucursal" />
      </div>
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

function AttentionRow({ icon: Icon, tone, label, href }: { icon: typeof AlertTriangle; tone: "critical" | "warning"; label: string; href: string }) {
  return (
    <Link
      href={href as Route}
      className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-[var(--color-surface-alt)]"
      style={{
        borderColor: tone === "critical" ? "var(--color-danger-200)" : "var(--color-warning-200)",
        background: tone === "critical" ? "var(--color-danger-50)" : "var(--color-warning-50)",
      }}
    >
      <span className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone === "critical" ? "text-[var(--color-danger-600)]" : "text-[var(--color-warning-600)]"}`} />
        {label}
      </span>
      <span className="text-xs font-medium text-[var(--color-info-600)]">Ver →</span>
    </Link>
  );
}
