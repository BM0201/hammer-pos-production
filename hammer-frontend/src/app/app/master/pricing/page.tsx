"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCcw, TrendingDown, Clock3, SearchX } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";

/**
 * Fase 1 (prompt-motor-precios-lote-herencia-gobierno.md) — bandeja de
 * revisión de precios. Lee /api/master/pricing/tray, que ya trae la
 * detección hecha por Brain (pricing-detector.ts) con el precio sugerido
 * adentro. Esta pantalla es la que faltaba, no un motor nuevo.
 */

type Reason = "BELOW_COST" | "MARGIN_POLICY" | "COST_STALE";

type TrayRow = {
  decisionId: string;
  severity: string;
  reason: Reason;
  branchId: string;
  branchName: string;
  productId: string;
  productSku: string;
  productName: string;
  currentPrice: number | null;
  suggestedPrice: number | null;
  effectiveCost: number | null;
  marginActual: number | null;
  marginObjetivo: number | null;
  stockAtRisk: number | null;
  impactAmount: number;
  lastPriceUpdateAt: string | null;
  applicable: boolean;
  /** Parte A (prompt-huecos-fase1-fase3-despliegue.md) — branchCost más de 2× el costo de referencia: probable error de tecleo, no un producto mal preciado. */
  costLooksWrong: boolean;
  referenceCost: number | null;
  evidence: Record<string, unknown>;
};

type TrayResult = {
  rows: TrayRow[];
  totals: { count: number; impactTotal: number; byReason: Record<Reason, number>; costDoubtfulCount: number };
};

type Branch = { id: string; code: string; name: string };
type Category = { id: string; name: string };
type ApplyResponse = {
  applied: Array<{ decisionId: string; branchId: string; productId: string; previousPrice: number | null; newPrice: number }>;
  failed: Array<{ decisionId: string; reason: string }>;
};

const REASON_GROUPS: Array<{ key: Reason; title: string; badge: string; icon: typeof TrendingDown }> = [
  { key: "BELOW_COST", title: "Vendiendo bajo el costo", badge: "CRITICAL", icon: AlertTriangle },
  { key: "MARGIN_POLICY", title: "Margen bajo la política", badge: "", icon: TrendingDown },
  { key: "COST_STALE", title: "El costo cambió y el precio no", badge: "", icon: Clock3 },
];

const fmt = (v: number | null) => (v === null ? "—" : `C$${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-NI", { day: "2-digit", month: "short", year: "numeric" }) : "nunca");

function severityDot(severity: string) {
  if (severity === "CRITICAL") return "bg-[var(--color-danger-600)]";
  if (severity === "HIGH") return "bg-[var(--color-warning-600)]";
  return "bg-[var(--color-text-soft)]";
}

export default function PricingTrayPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TrayResult | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [branchFilter, setBranchFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState<Reason | "">("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [lastApplyResult, setLastApplyResult] = useState<ApplyResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (branchFilter) params.set("branchId", branchFilter);
      if (categoryFilter) params.set("categoryId", categoryFilter);
      if (reasonFilter) params.set("reason", reasonFilter);
      const res = await apiFetch(`/api/master/pricing/tray?${params.toString()}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar la bandeja de precios.");
      setData(unwrapApiData(raw) as TrayResult);
      setSelected(new Set());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar la bandeja de precios.");
    } finally {
      setLoading(false);
    }
  }, [branchFilter, categoryFilter, reasonFilter]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    apiFetch("/api/branches").then((r) => (r.ok ? r.json() : null)).then((raw) => { if (raw) setBranches(unwrapApiData(raw) as Branch[]); }).catch(() => {});
    apiFetch("/api/catalog/categories").then((r) => (r.ok ? r.json() : null)).then((raw) => { if (raw) setCategories(unwrapApiData(raw) as Category[]); }).catch(() => {});
  }, []);

  const rowsByReason = useMemo(() => {
    const map: Record<Reason, TrayRow[]> = { BELOW_COST: [], MARGIN_POLICY: [], COST_STALE: [] };
    for (const row of data?.rows ?? []) map[row.reason].push(row);
    return map;
  }, [data]);

  const selectedRows = useMemo(() => (data?.rows ?? []).filter((r) => selected.has(r.decisionId)), [data, selected]);

  function toggleRow(decisionId: string, applicable: boolean) {
    if (!applicable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(decisionId)) next.delete(decisionId); else next.add(decisionId);
      return next;
    });
  }

  function toggleGroup(reason: Reason) {
    const rows = rowsByReason[reason].filter((r) => r.applicable);
    const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.decisionId));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of rows) {
        if (allSelected) next.delete(row.decisionId); else next.add(row.decisionId);
      }
      return next;
    });
  }

  const summary = useMemo(() => {
    if (selectedRows.length === 0) return null;
    const branchSet = new Set(selectedRows.map((r) => r.branchId));
    const diffs = selectedRows.filter((r) => r.suggestedPrice !== null && r.currentPrice !== null).map((r) => (r.suggestedPrice as number) - (r.currentPrice as number));
    const avgDiff = diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
    return { productCount: selectedRows.length, branchCount: branchSet.size, avgDiff };
  }, [selectedRows]);

  async function applySelection() {
    setApplying(true);
    try {
      const res = await apiFetch("/api/master/pricing/tray/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionIds: [...selected], reason: "Aplicado desde la bandeja de precios" }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo aplicar la selección.");
      const result = unwrapApiData(raw) as ApplyResponse;
      setLastApplyResult(result);
      if (result.failed.length === 0) {
        toast.success(`${result.applied.length} precio(s) aplicado(s).`);
      } else {
        toast.error(`${result.applied.length} aplicado(s), ${result.failed.length} con error.`);
      }
      setConfirming(false);
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo aplicar la selección.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="space-y-6 pb-24">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text)]">Precios</h1>
          {data && (
            <>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {data.totals.count === 0
                  ? "Nada necesita revisión ahora mismo."
                  : <>
                      <span className="font-semibold text-[var(--color-text)]">{data.totals.count}</span> producto{data.totals.count === 1 ? "" : "s"} necesita{data.totals.count === 1 ? "" : "n"} revisión ·{" "}
                      <span className="font-semibold text-[var(--color-danger-600)]">{fmt(data.totals.impactTotal)}</span> en riesgo
                    </>}
              </p>
              {/* A.4 — un total contaminado por un costo mal tecleado es peor que no tener total */}
              {data.totals.costDoubtfulCount > 0 && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--color-warning-700)]">
                  <SearchX className="h-3.5 w-3.5" aria-hidden="true" />
                  {data.totals.costDoubtfulCount} producto{data.totals.costDoubtfulCount === 1 ? "" : "s"} con costo dudoso, sin cuantificar
                </p>
              )}
            </>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => void load()} disabled={loading} icon={<RefreshCcw className="h-4 w-4" />}>Actualizar</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select className="hm-input w-auto" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
          <option value="">Todas las sucursales</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="hm-input w-auto" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="hm-input w-auto" value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value as Reason | "")}>
          <option value="">Todos los motivos</option>
          {REASON_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.title}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Cargando…</p>
      ) : !data || data.totals.count === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">No hay precios pendientes de revisión con estos filtros.</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {REASON_GROUPS.map((group) => {
            const rows = rowsByReason[group.key];
            if (rows.length === 0) return null;
            const applicableRows = rows.filter((r) => r.applicable);
            const allSelected = applicableRows.length > 0 && applicableRows.every((r) => selected.has(r.decisionId));
            return (
              <div key={group.key}>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <group.icon className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
                  <h2 className="text-[15px] font-semibold text-[var(--color-text)]">{group.title}</h2>
                  <span className="rounded-full bg-[var(--color-surface-alt)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">{rows.length}</span>
                  {applicableRows.length > 0 && (
                    <button type="button" onClick={() => toggleGroup(group.key)} className="ml-auto text-xs font-medium text-[var(--color-pay)] hover:underline">
                      {allSelected ? "Deseleccionar todo" : "Seleccionar todo"}
                    </button>
                  )}
                </div>

                <Card className="overflow-hidden p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                          <th className="w-8 px-3 py-2" />
                          <th className="px-3 py-2">Producto</th>
                          <th className="px-3 py-2">Sucursal</th>
                          <th className="px-3 py-2 text-right">Costo</th>
                          <th className="px-3 py-2 text-right">Precio actual</th>
                          <th className="px-3 py-2 text-right">Margen actual</th>
                          <th className="px-3 py-2 text-right">Precio sugerido</th>
                          <th className="px-3 py-2 text-right">Margen resultante</th>
                          <th className="px-3 py-2 text-right">Impacto</th>
                          <th className="w-8 px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <RowGroup
                            key={row.decisionId}
                            row={row}
                            selected={selected.has(row.decisionId)}
                            expanded={expanded === row.decisionId}
                            onToggleSelect={() => toggleRow(row.decisionId, row.applicable)}
                            onToggleExpand={() => setExpanded((prev) => (prev === row.decisionId ? null : row.decisionId))}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      )}

      {lastApplyResult && lastApplyResult.failed.length > 0 && (
        <Card className="border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-4">
          <h3 className="mb-2 text-sm font-semibold text-[var(--color-danger-700)]">{lastApplyResult.failed.length} no se pudieron aplicar</h3>
          <ul className="space-y-1 text-xs text-[var(--color-danger-700)]">
            {lastApplyResult.failed.map((f) => <li key={f.decisionId}>{f.decisionId}: {f.reason}</li>)}
          </ul>
        </Card>
      )}

      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-2xl md:pl-[calc(var(--sidebar-width,0px)+1rem)]">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <span className="text-sm text-[var(--color-text-muted)]">{selected.size} producto{selected.size === 1 ? "" : "s"} seleccionado{selected.size === 1 ? "" : "s"}</span>
            <Button type="button" variant="success" onClick={() => setConfirming(true)}>
              Aplicar seleccionados ({selected.size})
            </Button>
          </div>
        </div>
      )}

      {confirming && summary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Confirmar aplicación en lote</h3>
            <p className="text-sm text-[var(--color-text-muted)]">
              Aplicar precios en lote es irreversible en la práctica. Antes de confirmar:
            </p>
            <div className="space-y-1.5 rounded-lg bg-[var(--color-surface-alt)] p-3 text-sm">
              <p><strong className="text-[var(--color-text)]">{summary.productCount}</strong> producto{summary.productCount === 1 ? "" : "s"}</p>
              <p><strong className="text-[var(--color-text)]">{summary.branchCount}</strong> sucursal{summary.branchCount === 1 ? "" : "es"}</p>
              <p>Cambio de precio promedio: <strong className={summary.avgDiff >= 0 ? "text-[var(--color-success-700)]" : "text-[var(--color-danger-600)]"}>{summary.avgDiff >= 0 ? "+" : ""}{fmt(summary.avgDiff)}</strong></p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={applying}>Cancelar</Button>
              <Button type="button" variant="success" onClick={() => void applySelection()} loading={applying}>Confirmar</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function RowGroup({ row, selected, expanded, onToggleSelect, onToggleExpand }: {
  row: TrayRow;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
}) {
  const evidence = row.evidence;
  const commercialClass = typeof evidence.commercialClass === "string" ? evidence.commercialClass : null;
  const priceSource = typeof evidence.priceSource === "string" ? evidence.priceSource : null;
  const costSource = typeof evidence.costSource === "string" ? evidence.costSource : null;
  const stock = row.stockAtRisk;

  return (
    <>
      <tr className={["border-b border-[var(--color-border)] last:border-0", !row.applicable ? "opacity-60" : ""].join(" ")}>
        <td className="px-3 py-2.5">
          {row.costLooksWrong ? (
            <AlertTriangle className="h-4 w-4 text-[var(--color-warning-600)]" aria-hidden="true" />
          ) : (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              disabled={!row.applicable}
              title={row.applicable ? undefined : "Esta decisión no tiene un precio sugerido listo para aplicar"}
              className="h-4 w-4 rounded border-[var(--color-border-strong)]"
            />
          )}
        </td>
        <td className="px-3 py-2.5">
          <span className="flex items-center gap-1.5">
            <span className={["h-2 w-2 shrink-0 rounded-full", severityDot(row.severity)].join(" ")} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate font-medium text-[var(--color-text)]">{row.productName}</span>
              <span className="block text-xs text-[var(--color-text-soft)]">{row.productSku}</span>
            </span>
          </span>
        </td>
        <td className="px-3 py-2.5 text-[var(--color-text-muted)]">{row.branchName}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {row.costLooksWrong ? <span className="font-semibold text-[var(--color-warning-700)]">{fmt(row.effectiveCost)}</span> : fmt(row.effectiveCost)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">{fmt(row.currentPrice)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(row.marginActual)}</td>
        {/* A.2 — el precio sugerido sigue visible, en gris: si el costo resulta ser correcto, quien lo revise lo necesita. */}
        <td className={["px-3 py-2.5 text-right font-medium tabular-nums", row.costLooksWrong ? "text-[var(--color-text-soft)]" : "text-[var(--color-success-700)]"].join(" ")}>
          {fmt(row.suggestedPrice)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(row.marginObjetivo)}</td>
        <td className="px-3 py-2.5 text-right font-medium tabular-nums text-[var(--color-danger-600)]">
          {row.costLooksWrong ? <span className="font-normal text-[var(--color-text-soft)]">sin cuantificar</span> : fmt(row.impactAmount)}
        </td>
        <td className="px-3 py-2.5">
          <button type="button" onClick={onToggleExpand} className="text-[var(--color-text-soft)]" aria-label="Ver detalle">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
      </tr>

      {/* A.2 — costo sospechoso: sin checkbox, con la comparación contra el costo de referencia y un enlace al editor en vez de aplicar a ciegas. */}
      {row.costLooksWrong && (
        <tr className="border-b border-[var(--color-border)] bg-[var(--color-warning-50)] last:border-0">
          <td />
          <td colSpan={9} className="px-3 py-2">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-warning-700)]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Costo de sucursal {fmt(row.effectiveCost)} · promedio del producto {fmt(row.referenceCost)}.</span>
              <Link href={`/app/master/catalog-inventory/products/${row.productId}`} className="font-semibold underline underline-offset-2">
                Revisar el costo primero
              </Link>
            </p>
          </td>
        </tr>
      )}

      {expanded && (
        <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] last:border-0">
          <td />
          <td colSpan={9} className="px-3 py-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-[var(--color-text-muted)] sm:grid-cols-4">
              <span>Clase comercial: <strong className="text-[var(--color-text)]">{commercialClass ?? "—"}</strong></span>
              <span>Stock en riesgo: <strong className="text-[var(--color-text)]">{stock ?? "—"}</strong></span>
              <span>Origen del costo: <strong className="text-[var(--color-text)]">{costSource ?? "—"}</strong></span>
              <span>Origen del precio: <strong className="text-[var(--color-text)]">{priceSource ?? "—"}</strong></span>
              <span>Último precio fijado: <strong className="text-[var(--color-text)]">{fmtDate(row.lastPriceUpdateAt)}</strong></span>
              {!row.applicable && !row.costLooksWrong && (
                <span className="col-span-2 flex items-center gap-1 text-[var(--color-warning-700)] sm:col-span-4">
                  <AlertTriangle className="h-3.5 w-3.5" /> Sin precio sugerido calculado — no se puede aplicar desde acá todavía.
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
