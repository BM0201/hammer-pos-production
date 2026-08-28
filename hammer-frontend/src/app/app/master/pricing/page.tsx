"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCcw, TrendingDown, Clock3, SearchX, Inbox, Calculator, Settings, SlidersHorizontal, Building2, ReceiptText, Search } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PricingCalculatorPanel } from "@/components/pricing/pricing-calculator-panel";
import { CategoryPoliciesPanel } from "@/components/pricing/category-policies-panel";
import { PricingConfigPanel } from "@/components/pricing/pricing-config-panel";
import toast from "react-hot-toast";

/**
 * Zona Precios (prompt-mudanza-zona-precios.md, Fase 2) — cinco pestañas:
 * Bandeja (la cola de revisión, default) · Precios vigentes (Parte C,
 * prompt-precios-vigentes-catalogo.md — lo que HAY, después de lo que está
 * MAL) · Calculadora · Políticas · Configuración. Un único selector de
 * sucursal en el encabezado, compartido por las cinco; la Bandeja funciona
 * con "todas" (value=""), las otras cuatro son por sucursal por definición
 * y piden elegir una.
 */

type ZoneTab = "tray" | "current" | "calculator" | "policies" | "config";
const ZONE_TABS: Array<{ key: ZoneTab; label: string; icon: typeof Inbox }> = [
  { key: "tray", label: "Bandeja", icon: Inbox },
  { key: "current", label: "Precios vigentes", icon: ReceiptText },
  { key: "calculator", label: "Calculadora", icon: Calculator },
  { key: "policies", label: "Políticas", icon: SlidersHorizontal },
  { key: "config", label: "Configuración", icon: Settings },
];

type Branch = { id: string; code: string; name: string };

export default function PricingZonePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawTab = searchParams.get("tab") ?? "tray";
  const activeTab: ZoneTab = (ZONE_TABS.some((t) => t.key === rawTab) ? rawTab : "tray") as ZoneTab;

  // Fase 4.1 (prompt-mudanza-zona-precios.md) — el enlace desde la ficha de
  // producto llega con branchId propio (?tab=calculator&productId=...&branchId=...);
  // se usa como valor inicial del selector de la zona, no como un estado aparte.
  const [branchId, setBranchId] = useState(searchParams.get("branchId") ?? "");
  const initialProductId = searchParams.get("productId") ?? undefined;
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    apiFetch("/api/branches").then((r) => (r.ok ? r.json() : null)).then((raw) => { if (raw) setBranches(unwrapApiData(raw) as Branch[]); }).catch(() => {});
  }, []);

  function selectTab(tab: ZoneTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "tray") params.delete("tab"); else params.set("tab", tab);
    router.replace(`${pathname}${params.size ? `?${params}` : ""}` as Parameters<typeof router.replace>[0], { scroll: false });
  }

  function selectBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    const params = new URLSearchParams(searchParams.toString());
    if (nextBranchId) params.set("branchId", nextBranchId); else params.delete("branchId");
    // productId solo tenía sentido con el branchId que llegó del enlace de origen.
    params.delete("productId");
    router.replace(`${pathname}${params.size ? `?${params}` : ""}` as Parameters<typeof router.replace>[0], { scroll: false });
  }

  // C.5 (prompt-precios-vigentes-catalogo.md) — una fila de Precios vigentes
  // abre la Calculadora con ese producto y la sucursal actual precargados.
  // Es el puente entre ver y actuar; sin esto la vista es un reporte, no
  // una herramienta.
  function openCalculatorFor(productId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "calculator");
    params.set("productId", productId);
    if (branchId) params.set("branchId", branchId);
    router.replace(`${pathname}?${params}` as Parameters<typeof router.replace>[0], { scroll: false });
  }

  const needsBranch = activeTab !== "tray";

  return (
    <section className="space-y-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">Precios</h1>
        <div className="flex items-end gap-2">
          <Building2 className="mb-2.5 h-4 w-4 text-[var(--color-text-muted)]" />
          {/* Parte B.1/B.2 (prompt-zona-precios-consolidacion.md) — .hm-input es
              width:100% (globals.css) y le gana a w-auto; el ancho va en el
              contenedor, no en el select. Etiqueta real (label htmlFor), no un <p>. */}
          <div className="w-[220px]">
            <label htmlFor="pricing-zone-branch" className="mb-1 block text-xs text-[var(--color-text-muted)]">Sucursal</label>
            <select id="pricing-zone-branch" className="hm-input" value={branchId} onChange={(e) => selectBranch(e.target.value)}>
              <option value="">Todas las sucursales</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="flex gap-1 bg-[var(--color-surface-raised)] rounded-lg p-1 overflow-x-auto">
        {ZONE_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => selectTab(key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all whitespace-nowrap
              ${activeTab === key
                ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {needsBranch && !branchId ? (
        <Card className="p-10 text-center">
          <Building2 className="mx-auto mb-3 h-8 w-8 text-[var(--color-text-soft)]" aria-hidden="true" />
          <p className="text-sm font-medium text-[var(--color-text)]">Elegí una sucursal para continuar</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {ZONE_TABS.find((t) => t.key === activeTab)?.label} trabaja sobre una sucursal específica — seleccionala arriba.
          </p>
        </Card>
      ) : (
        <>
          {activeTab === "tray" && (
            <PricingTrayTab
              branchId={branchId}
              branchName={branches.find((b) => b.id === branchId)?.name}
              onClearBranch={() => selectBranch("")}
              onGoToCalculator={() => selectTab("calculator")}
            />
          )}
          {activeTab === "current" && (
            <CurrentPricesTab branchId={branchId} onOpenCalculator={openCalculatorFor} />
          )}
          {activeTab === "calculator" && <PricingCalculatorPanel branchId={branchId} initialProductId={initialProductId} />}
          {activeTab === "policies" && <CategoryPoliciesPanel branchId={branchId} />}
          {activeTab === "config" && <PricingConfigPanel branchId={branchId} />}
        </>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── TAB: BANDEJA ── */
/* Fase 1 (prompt-motor-precios-lote-herencia-gobierno.md) — bandeja de       */
/* revisión de precios. Lee /api/master/pricing/tray, que ya trae la         */
/* detección hecha por Brain (pricing-detector.ts) con el precio sugerido    */
/* adentro. Ahora vive como pestaña de la zona Precios (Fase 2, prompt-      */
/* mudanza-zona-precios.md) — branchId llega del selector de la zona.        */
/* ═══════════════════════════════════════════════════════════════════════════ */

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

type TrayTotals = { count: number; impactTotal: number; byReason: Record<Reason, number>; costDoubtfulCount: number };
type TrayResult = {
  rows: TrayRow[];
  totals: TrayTotals;
  /** Parte A (prompt-zona-precios-consolidacion.md) — el mismo cálculo, sin los filtros del usuario. */
  unfilteredTotals: TrayTotals;
};

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

/** Parte C.1 (prompt-zona-precios-consolidacion.md) — predicado para "Ningún producto ... tiene {motivo}"; distinto de REASON_GROUPS.title, que es un encabezado de sección, no una frase que sigue a "tiene". */
const REASON_PREDICATE: Record<Reason, string> = {
  BELOW_COST: "precio bajo el costo",
  MARGIN_POLICY: "margen bajo la política",
  COST_STALE: "el costo cambiado y el precio sin actualizar",
};

const fmt = (v: number | null) => (v === null ? "—" : `C$${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-NI", { day: "2-digit", month: "short", year: "numeric" }) : "nunca");

function severityDot(severity: string) {
  if (severity === "CRITICAL") return "bg-[var(--color-danger-600)]";
  if (severity === "HIGH") return "bg-[var(--color-warning-600)]";
  return "bg-[var(--color-text-soft)]";
}

function PricingTrayTab({
  branchId,
  branchName,
  onClearBranch,
  onGoToCalculator,
}: {
  branchId: string;
  branchName?: string;
  /** Limpia el filtro de sucursal — vive en el estado del padre (Zona Precios), compartido por las cuatro pestañas. */
  onClearBranch: () => void;
  /** Parte C.2 (prompt-zona-precios-consolidacion.md) — "Calcular un precio" cambia de pestaña en el padre. */
  onGoToCalculator: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TrayResult | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState<Reason | "">("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [lastApplyResult, setLastApplyResult] = useState<ApplyResponse | null>(null);

  // Parte A.2/B.3 (prompt-zona-precios-consolidacion.md) — la sucursal (estado
  // del padre) cuenta como filtro igual que categoría/motivo: es exactamente
  // lo que produce el bug de la captura (Masaya + Arena + Margen bajo la política).
  const hasFilters = !!branchId || !!categoryFilter || !!reasonFilter;
  const clearFilters = () => {
    onClearBranch();
    setCategoryFilter("");
    setReasonFilter("");
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
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
  }, [branchId, categoryFilter, reasonFilter]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
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
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          {data && (
            <>
              {/* Parte A.2 (prompt-zona-precios-consolidacion.md) — tres estados
                  distintos, no uno: "nada necesita revisión" solo es cierto cuando
                  unfilteredTotals.count es 0. Con filtros puestos y cero resultados
                  visibles, el catálogo puede seguir teniendo trabajo pendiente en
                  otro lado — es exactamente el bug de la captura. */}
              <p className="text-sm text-[var(--color-text-muted)]">
                {data.unfilteredTotals.count === 0 ? (
                  "Nada necesita revisión ahora mismo."
                ) : data.totals.count === 0 ? (
                  <>
                    Mostrando <span className="font-semibold text-[var(--color-text)]">0</span> de{" "}
                    <span className="font-semibold text-[var(--color-text)]">{data.unfilteredTotals.count}</span> productos que necesitan revisión ·{" "}
                    <span className="font-semibold text-[var(--color-danger-600)]">{fmt(data.unfilteredTotals.impactTotal)}</span> en riesgo en total
                  </>
                ) : !hasFilters ? (
                  <>
                    <span className="font-semibold text-[var(--color-text)]">{data.totals.count}</span> producto{data.totals.count === 1 ? "" : "s"} necesita{data.totals.count === 1 ? "" : "n"} revisión ·{" "}
                    <span className="font-semibold text-[var(--color-danger-600)]">{fmt(data.totals.impactTotal)}</span> en riesgo
                  </>
                ) : (
                  <>
                    Mostrando <span className="font-semibold text-[var(--color-text)]">{data.totals.count}</span> de{" "}
                    <span className="font-semibold text-[var(--color-text)]">{data.unfilteredTotals.count}</span> ·{" "}
                    <span className="font-semibold text-[var(--color-danger-600)]">{fmt(data.totals.impactTotal)}</span> de {fmt(data.unfilteredTotals.impactTotal)} en riesgo
                  </>
                )}
              </p>
              {/* A.4 — un total contaminado por un costo mal tecleado es peor que no
                  tener total. El aviso usa el conteo del alcance visible, no el
                  global — salvo que esté filtrado, ahí dice "n de global" (A.2). */}
              {data.unfilteredTotals.costDoubtfulCount > 0 && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--color-warning-700)]">
                  <SearchX className="h-3.5 w-3.5" aria-hidden="true" />
                  {hasFilters
                    ? `${data.totals.costDoubtfulCount} de ${data.unfilteredTotals.costDoubtfulCount} con costo dudoso, sin cuantificar`
                    : `${data.unfilteredTotals.costDoubtfulCount} producto${data.unfilteredTotals.costDoubtfulCount === 1 ? "" : "s"} con costo dudoso, sin cuantificar`}
                </p>
              )}
            </>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => void load()} disabled={loading} icon={<RefreshCcw className="h-4 w-4" />}>Actualizar</Button>
      </div>

      {/* Parte B (prompt-zona-precios-consolidacion.md) — el ancho va en el
          contenedor (no en el select, que .hm-input fuerza a 100%), y cada
          uno tiene su <label htmlFor> real. La sucursal ya se elige en el
          encabezado de la zona (compartida por las cuatro pestañas); acá
          solo categoría y motivo, que son propios de la bandeja. */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-[200px]">
          <label htmlFor="pricing-tray-category" className="mb-1 block text-xs text-[var(--color-text-muted)]">Categoría</label>
          <select id="pricing-tray-category" className="hm-input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="w-[220px]">
          <label htmlFor="pricing-tray-reason" className="mb-1 block text-xs text-[var(--color-text-muted)]">Motivo</label>
          <select id="pricing-tray-reason" className="hm-input" value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value as Reason | "")}>
            <option value="">Todos los motivos</option>
            {REASON_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.title}</option>)}
          </select>
        </div>
        {/* Parte B.3 — sin esto, quien filtró antes vuelve a la pantalla, ve el
            estado vacío y concluye que no hay trabajo (junto con el bug A, es
            la causa real de la captura: filtro invisible + mensaje global
            equivocado). */}
        {hasFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Quitar filtros</Button>
        )}
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Cargando…</p>
      ) : !data || data.totals.count === 0 ? (
        <EmptyTrayState
          hasFilters={hasFilters}
          branchName={branchName}
          categoryName={categories.find((c) => c.id === categoryFilter)?.name}
          reasonFilter={reasonFilter}
          unfilteredCount={data?.unfilteredTotals.count ?? 0}
          onClearFilters={clearFilters}
          onGoToCalculator={onGoToCalculator}
        />
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

      {/* Parte C.3 (prompt-zona-precios-consolidacion.md) — chips con el
          conteo SIN FILTRAR por motivo, más el de costo dudoso. Es
          navegación, no adorno: con la bandeja vacía por filtros, esta fila
          es lo único accionable de la pantalla. Cada chip limpia sucursal y
          categoría (lo que suele vaciar la vista) y aplica ese motivo. */}
      {!loading && data && data.unfilteredTotals.count > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-4">
          <span className="text-xs text-[var(--color-text-muted)]">Ver por motivo:</span>
          {REASON_GROUPS.map((group) => (
            <button
              key={group.key}
              type="button"
              onClick={() => { onClearBranch(); setCategoryFilter(""); setReasonFilter(group.key); }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                reasonFilter === group.key
                  ? "border-[var(--color-pay)] bg-[var(--color-pay)]/10 text-[var(--color-pay)]"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
              }`}
            >
              <group.icon className="h-3 w-3" aria-hidden="true" />
              {group.title} ({data.unfilteredTotals.byReason[group.key]})
            </button>
          ))}
          {data.unfilteredTotals.costDoubtfulCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-1 text-xs font-medium text-[var(--color-warning-700)] hover:bg-[var(--color-warning-100)]"
              title="Sin un filtro propio — limpia los filtros para verlos entre sus motivos"
            >
              <SearchX className="h-3 w-3" aria-hidden="true" />
              Costo dudoso ({data.unfilteredTotals.costDoubtfulCount})
            </button>
          )}
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
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── Estado vacío (Parte C, prompt-zona-precios-consolidacion.md) ── */
/* Antes era una tarjeta con una frase y ningún camino de salida. Ahora       */
/* nombra la causa (qué filtros produjeron el vacío) y ofrece dos salidas —   */
/* o, si el catálogo de verdad está sano, lo confirma en vez de sonar vacío.  */
/* ═══════════════════════════════════════════════════════════════════════════ */
function EmptyTrayState({
  hasFilters,
  branchName,
  categoryName,
  reasonFilter,
  unfilteredCount,
  onClearFilters,
  onGoToCalculator,
}: {
  hasFilters: boolean;
  branchName?: string;
  categoryName?: string;
  reasonFilter: Reason | "";
  unfilteredCount: number;
  onClearFilters: () => void;
  onGoToCalculator: () => void;
}) {
  // C.2 — catálogo sano de verdad: no hay "Ver los N" porque no hay ningún N.
  if (unfilteredCount === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm font-medium text-[var(--color-text)]">Todo el catálogo está al día.</p>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">No hay precios pendientes de revisión en ninguna sucursal.</p>
        <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={onGoToCalculator}>Calcular un precio</Button>
      </Card>
    );
  }

  // C.1 — nombrar la causa: qué combinación de filtros produjo el vacío.
  let causeText = "No hay precios pendientes de revisión.";
  if (hasFilters) {
    const scopeBits: string[] = [];
    if (categoryName) scopeBits.push(`de ${categoryName}`);
    if (branchName) scopeBits.push(`en ${branchName}`);
    const scope = scopeBits.length > 0 ? ` ${scopeBits.join(" ")}` : "";
    const ending = reasonFilter ? `tiene ${REASON_PREDICATE[reasonFilter]}` : "necesita revisión";
    causeText = `Ningún producto${scope} ${ending}.`;
  }

  return (
    <Card className="p-8 text-center">
      <p className="text-sm font-medium text-[var(--color-text)]">{causeText}</p>
      {hasFilters && (
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Hay <strong className="text-[var(--color-text)]">{unfilteredCount}</strong> producto{unfilteredCount === 1 ? "" : "s"} que sí necesita{unfilteredCount === 1 ? "" : "n"} revisión en otras sucursales o categorías.
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {hasFilters && (
          <Button type="button" variant="primary" size="sm" onClick={onClearFilters}>Ver los {unfilteredCount}</Button>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={onGoToCalculator}>Calcular un precio</Button>
      </div>
    </Card>
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
          {/* Fase 4.2 (prompt-mudanza-zona-precios.md) — la bandeja enlaza a la ficha del producto en Catálogo (los dos sentidos, junto con 4.1). */}
          <Link href={`/app/master/catalog-inventory/products/${row.productId}`} className="flex items-center gap-1.5 group">
            <span className={["h-2 w-2 shrink-0 rounded-full", severityDot(row.severity)].join(" ")} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate font-medium text-[var(--color-text)] group-hover:underline">{row.productName}</span>
              <span className="block text-xs text-[var(--color-text-soft)]">{row.productSku}</span>
            </span>
          </Link>
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

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── TAB: PRECIOS VIGENTES (prompt-precios-vigentes-catalogo.md, Parte C) ── */
/* Bandeja = lo que está mal. Precios vigentes = lo que hay. USA los mismos  */
/* números que resuelve el backend (effective-pricing.ts + resolveCatalog-  */
/* DisplayCost) — acá solo se muestran, no se recalculan.                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

type CurrentPriceSource = "BRANCH" | "STANDARD" | "FUSION_DERIVED" | "MISSING";

type CurrentPriceRow = {
  productId: string;
  sku: string;
  name: string;
  categoryName: string;
  effectiveCost: number;
  effectivePrice: number | null;
  priceSource: CurrentPriceSource;
  standardPrice: number;
  marginPercent: number | null;
  minMarginPercent: number;
  belowPolicy: boolean;
  priceExceptionReason: string | null;
  priceExceptionAt: string | null;
  lastPriceUpdateAt: string | null;
  stockOnHand: number;
  canonicalProductLabel: string | null;
};

type CurrentPricesTotals = {
  total: number;
  byPriceSource: Record<CurrentPriceSource, number>;
  belowPolicyCount: number;
  missingCostCount: number;
};

type CurrentPricesResponse = {
  rows: CurrentPriceRow[];
  totals: CurrentPricesTotals;
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

type CurrentPricesSort = "name" | "marginAsc" | "price" | "lastUpdate";

const PRICE_SOURCE_BADGE: Record<CurrentPriceSource, { label: string; className: string }> = {
  BRANCH: { label: "Propio", className: "bg-[var(--color-info-50)] text-[var(--color-info-700)] border-[var(--color-info-200)]" },
  STANDARD: { label: "General", className: "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)]" },
  FUSION_DERIVED: { label: "Derivado", className: "bg-[var(--color-master-50)] text-[var(--color-master-700)] border-[var(--color-master-200)]" },
  MISSING: { label: "Sin precio", className: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)] border-[var(--color-danger-200)]" },
};

const PRICE_SOURCE_CHIP_LABEL: Record<CurrentPriceSource, string> = {
  BRANCH: "con precio propio",
  STANDARD: "siguen el general",
  FUSION_DERIVED: "derivados",
  MISSING: "sin precio",
};

function CurrentPricesTab({ branchId, onOpenCalculator }: { branchId: string; onOpenCalculator: (productId: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CurrentPricesResponse | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [priceSourceFilter, setPriceSourceFilter] = useState<CurrentPriceSource | "">("");
  const [sort, setSort] = useState<CurrentPricesSort>("name");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(timer);
  }, [q]);

  // Los filtros (menos la sucursal, que es contexto obligatorio, no un
  // filtro que se pueda "quitar") vuelven a la página 1 al cambiar.
  useEffect(() => { setPage(1); }, [categoryFilter, debouncedQ, priceSourceFilter]);

  const hasFilters = !!categoryFilter || !!debouncedQ || !!priceSourceFilter;

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("branchId", branchId);
      if (categoryFilter) params.set("categoryId", categoryFilter);
      if (debouncedQ) params.set("q", debouncedQ);
      if (priceSourceFilter) params.set("priceSource", priceSourceFilter);
      if (sort !== "name") params.set("sort", sort);
      params.set("page", String(page));
      const res = await apiFetch(`/api/master/pricing/current?${params.toString()}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudieron cargar los precios vigentes.");
      setData(unwrapApiData(raw) as CurrentPricesResponse);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar los precios vigentes.");
    } finally {
      setLoading(false);
    }
  }, [branchId, categoryFilter, debouncedQ, priceSourceFilter, sort, page]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    apiFetch("/api/catalog/categories").then((r) => (r.ok ? r.json() : null)).then((raw) => { if (raw) setCategories(unwrapApiData(raw) as Category[]); }).catch(() => {});
  }, []);

  function clearFilters() {
    setCategoryFilter("");
    setQ("");
    setDebouncedQ("");
    setPriceSourceFilter("");
  }

  function toggleSourceChip(source: CurrentPriceSource) {
    setPriceSourceFilter((prev) => (prev === source ? "" : source));
  }

  return (
    <div className="space-y-4">
      {/* C.4 — encabezado con el desglose por origen, en chips que filtran */}
      {data && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[var(--color-text-muted)]">
            <strong className="font-semibold text-[var(--color-text)]">{data.totals.total}</strong> producto{data.totals.total === 1 ? "" : "s"}
          </span>
          {(["BRANCH", "STANDARD", "FUSION_DERIVED", "MISSING"] as const).map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => toggleSourceChip(source)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                priceSourceFilter === source
                  ? "border-[var(--color-pay)] bg-[var(--color-pay)]/10 text-[var(--color-pay)]"
                  : source === "MISSING" && data.totals.byPriceSource.MISSING > 0
                    ? "border-[var(--color-danger-200)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]"
                    : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
              }`}
            >
              {data.totals.byPriceSource[source]} {PRICE_SOURCE_CHIP_LABEL[source]}
            </button>
          ))}
        </div>
      )}

      {/* C.3 — filtros: categoría, búsqueda, origen del precio (la sucursal ya se eligió en el encabezado de la zona) */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-[200px]">
          <label htmlFor="current-prices-category" className="mb-1 block text-xs text-[var(--color-text-muted)]">Categoría</label>
          <select id="current-prices-category" className="hm-input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="w-[240px]">
          <label htmlFor="current-prices-search" className="mb-1 block text-xs text-[var(--color-text-muted)]">Buscar</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-soft)]" aria-hidden="true" />
            <input
              id="current-prices-search"
              className="hm-input pl-8"
              placeholder="SKU o nombre"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div className="w-[180px]">
          <label htmlFor="current-prices-sort" className="mb-1 block text-xs text-[var(--color-text-muted)]">Ordenar por</label>
          <select id="current-prices-sort" className="hm-input" value={sort} onChange={(e) => setSort(e.target.value as CurrentPricesSort)}>
            <option value="name">Nombre</option>
            <option value="marginAsc">Margen (peor primero)</option>
            <option value="price">Precio</option>
            <option value="lastUpdate">Última actualización</option>
          </select>
        </div>
        {hasFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Quitar filtros</Button>
        )}
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Cargando…</p>
      ) : !data || data.pagination.total === 0 ? (
        <CurrentPricesEmptyState
          hasFilters={hasFilters}
          categoryName={categories.find((c) => c.id === categoryFilter)?.name}
          q={debouncedQ}
          priceSourceFilter={priceSourceFilter}
          totalInBranch={data?.totals.total ?? 0}
          onClearFilters={clearFilters}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2">Categoría</th>
                  <th className="px-3 py-2 text-right">Costo</th>
                  <th className="px-3 py-2 text-right">Precio</th>
                  <th className="px-3 py-2">Origen</th>
                  <th className="px-3 py-2 text-right">Margen</th>
                  <th className="px-3 py-2 text-right">Stock</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const badge = PRICE_SOURCE_BADGE[row.priceSource];
                  const badgeTitle = row.priceSource === "BRANCH"
                    ? (row.priceExceptionReason ?? undefined)
                    : row.priceSource === "FUSION_DERIVED"
                      ? (row.canonicalProductLabel ? `Deriva de ${row.canonicalProductLabel}` : undefined)
                      : undefined;
                  return (
                    <tr
                      key={row.productId}
                      className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-alt)]"
                      onClick={() => onOpenCalculator(row.productId)}
                      title="Abrir en la calculadora"
                    >
                      <td className="px-3 py-2.5">
                        <span className="block truncate font-medium text-[var(--color-text)]">{row.name}</span>
                        <span className="block text-xs text-[var(--color-text-soft)]">{row.sku}</span>
                      </td>
                      <td className="px-3 py-2.5 text-[var(--color-text-muted)]">{row.categoryName}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.effectiveCost > 0 ? fmt(row.effectiveCost) : <span className="text-[var(--color-text-soft)]">—</span>}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.effectivePrice !== null ? fmt(row.effectivePrice) : <span className="text-[var(--color-text-soft)]">—</span>}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`} title={badgeTitle}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {row.marginPercent === null ? (
                          <span className="text-[var(--color-text-soft)]">—</span>
                        ) : row.belowPolicy ? (
                          // Nunca solo color — el número y el mínimo de referencia van al lado, para quien no distingue tonos.
                          <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-warning-700)]">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                            {fmtPct(row.marginPercent)} <span className="font-normal text-[var(--color-text-soft)]">(mín. {fmtPct(row.minMarginPercent)})</span>
                          </span>
                        ) : (
                          fmtPct(row.marginPercent)
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.stockOnHand}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
              <span>Página {data.pagination.page} de {data.pagination.totalPages} · {data.pagination.total} resultado{data.pagination.total === 1 ? "" : "s"}</span>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</Button>
                <Button type="button" variant="ghost" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/** C.6 — mismo criterio que la bandeja: nunca afirmar que no hay productos cuando lo que pasa es que el filtro no matchea. */
function CurrentPricesEmptyState({
  hasFilters,
  categoryName,
  q,
  priceSourceFilter,
  totalInBranch,
  onClearFilters,
}: {
  hasFilters: boolean;
  categoryName?: string;
  q: string;
  priceSourceFilter: CurrentPriceSource | "";
  totalInBranch: number;
  onClearFilters: () => void;
}) {
  if (!hasFilters) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">Esta sucursal no tiene productos activos para mostrar.</p>
      </Card>
    );
  }

  const bits: string[] = [];
  if (categoryName) bits.push(`de ${categoryName}`);
  if (q) bits.push(`que coincidan con "${q}"`);
  if (priceSourceFilter) bits.push(`con origen "${PRICE_SOURCE_BADGE[priceSourceFilter].label}"`);

  return (
    <Card className="p-8 text-center">
      <p className="text-sm font-medium text-[var(--color-text)]">Ningún producto {bits.join(" ")}.</p>
      {totalInBranch > 0 && (
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Hay <strong className="text-[var(--color-text)]">{totalInBranch}</strong> producto{totalInBranch === 1 ? "" : "s"} en esta sucursal con otros filtros.
        </p>
      )}
      <Button type="button" variant="primary" size="sm" className="mt-4" onClick={onClearFilters}>Quitar filtros</Button>
    </Card>
  );
}
