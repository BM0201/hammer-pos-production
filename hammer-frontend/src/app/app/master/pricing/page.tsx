"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, RefreshCcw, TrendingDown, Clock3, SearchX, Inbox, Calculator, Settings, SlidersHorizontal, Building2, ReceiptText, Search, HelpCircle, ClipboardList, ChevronDown } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PricingCalculatorPanel } from "@/components/pricing/pricing-calculator-panel";
import { CategoryPoliciesPanel } from "@/components/pricing/category-policies-panel";
import { PricingConfigPanel } from "@/components/pricing/pricing-config-panel";
import { PriceLoadTab, type LoadSeed } from "@/components/pricing/price-load-tab";
import { TrayRow, type TrayRowData, type ReferenceChip } from "@/components/pricing/tray-row";
import { TrayDetailDrawer, type PricingTrayDecisionContext } from "@/components/pricing/tray-detail-drawer";
import {
  parsePriceInput,
  shouldConfirmBigChange,
  buildBatchSummary,
  priceForMethod,
  readGainOrderPreference,
  writeGainOrderPreference,
  type PriceApplyMethod,
  type GainOrderPreference,
} from "@/lib/pricing-tray-logic";
import { useSubmitting } from "@/lib/client/use-submitting";
import toast from "react-hot-toast";
import { money, fmtDatePadded } from "@/lib/format";

/**
 * Zona Precios (prompt-mudanza-zona-precios.md, Fase 2) — cinco pestañas:
 * Bandeja (la cola de revisión, default) · Precios vigentes (Parte C,
 * prompt-precios-vigentes-catalogo.md — lo que HAY, después de lo que está
 * MAL) · Calculadora · Políticas · Configuración. Un único selector de
 * sucursal en el encabezado, compartido por las cinco; la Bandeja funciona
 * con "todas" (value=""), las otras cuatro son por sucursal por definición
 * y piden elegir una.
 */

type ZoneTab = "tray" | "current" | "loads" | "calculator" | "policies" | "config";
const ZONE_TABS: Array<{ key: ZoneTab; label: string; icon: typeof Inbox }> = [
  { key: "tray", label: "Bandeja", icon: Inbox },
  { key: "current", label: "Precios vigentes", icon: ReceiptText },
  { key: "loads", label: "Carga de precios", icon: ClipboardList },
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
  // Puente Precios vigentes → Carga de precios: "Agregar a carga" desde la
  // tabla de vigentes siembra esta pestaña con los productos ya elegidos,
  // en vez de obligar a buscarlos de nuevo.
  const [loadSeed, setLoadSeed] = useState<LoadSeed | null>(null);

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

  const needsBranch = activeTab !== "tray" && activeTab !== "loads";

  function sendSelectionToLoads(seed: LoadSeed) {
    setLoadSeed(seed);
    selectTab("loads");
  }

  // Parte A · Commit 2.2 (prompt-completo-pendientes-2026-10.md) — "Crear
  // carga de precios" desde el Centro de Decisiones llega como
  // ?tab=loads&seedProductIds=id1,id2&branchId=... — a diferencia del
  // puente de Precios vigentes (sendSelectionToLoads, estado de React
  // puro), este SÍ cruza de página, así que tiene que venir por la URL.
  // Se resuelve una sola vez (necesita sku/name que la URL no trae) y los
  // params se limpian para que un refresh no vuelva a sembrar la misma carga.
  useEffect(() => {
    const seedProductIds = searchParams.get("seedProductIds");
    if (!seedProductIds || activeTab !== "loads") return;
    const ids = seedProductIds.split(",").map((id) => id.trim()).filter(Boolean);
    if (ids.length === 0) return;

    let cancelled = false;
    apiFetch(`/api/catalog/products?ids=${ids.join(",")}&limit=${ids.length}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        const products = (unwrapApiData(raw) as Array<{ id: string; sku: string; name: string }>) ?? [];
        if (products.length === 0) return;
        setLoadSeed({
          branchId: searchParams.get("branchId") ?? "",
          products: products.map((p) => ({ productId: p.id, sku: p.sku, name: p.name })),
        });
      })
      .catch(() => toast.error("No se pudieron cargar los productos para la carga de precios."));

    const params = new URLSearchParams(searchParams.toString());
    params.delete("seedProductIds");
    router.replace(`${pathname}?${params}` as Parameters<typeof router.replace>[0], { scroll: false });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe correr cuando llega seedProductIds; router/pathname/searchParams cambiarían por el propio replace de abajo.
  }, [searchParams.get("seedProductIds")]);

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
              branches={branches}
              onClearBranch={() => selectBranch("")}
              onGoToCalculator={() => selectTab("calculator")}
              onSendToLoads={sendSelectionToLoads}
            />
          )}
          {activeTab === "current" && (
            <CurrentPricesTab branchId={branchId} onOpenCalculator={openCalculatorFor} onSendToLoads={sendSelectionToLoads} />
          )}
          {activeTab === "loads" && (
            <PriceLoadTab branches={branches} seed={loadSeed} onSeedConsumed={() => setLoadSeed(null)} />
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

type Reason = "BELOW_COST" | "MARGIN_POLICY" | "COST_STALE" | "NO_COST";

/** La fila que trae /api/master/pricing/tray — superconjunto de TrayRowData (components/pricing/tray-row.tsx), que es lo que el componente realmente necesita. */
type TrayRowDto = TrayRowData & {
  reason: Reason;
  marginActual: number | null;
  lastPriceUpdateAt: string | null;
};

type TrayTotals = { count: number; impactTotal: number; byReason: Record<Reason, number>; costDoubtfulCount: number };
type TrayResult = {
  rows: TrayRowDto[];
  totals: TrayTotals;
  /** Parte A (prompt-zona-precios-consolidacion.md) — el mismo cálculo, sin los filtros del usuario. */
  unfilteredTotals: TrayTotals;
};

type Category = { id: string; name: string };
type ApplyResponse = {
  applied: Array<{ decisionId: string; branchId: string; productId: string; previousPrice: number | null; newPrice: number }>;
  failed: Array<{ decisionId: string; reason: string }>;
};
type KeepResponse = { kept: string[]; rejected: Array<{ decisionId: string; reason: string }> };

const REFERENCE_LABELS: Record<PriceApplyMethod, string> = {
  MANUAL: "Manual",
  SUGGESTED: "Referencia de política",
  REALIZED_MARGIN: "Como lo venís vendiendo",
  KEEP_GAIN_AMOUNT: "Misma ganancia en C$",
  KEEP_MARGIN_PCT: "Mismo % que tenía",
  OTHER_BRANCH: "Igual que otra sucursal",
  POLICY_MIN: "Mínimo de la política",
};
const KEEP_NOTE_CHIPS = ["Precio de competencia", "Producto gancho", "Ya lo revisé"];

const REASON_GROUPS: Array<{ key: Reason; title: string; badge: string; icon: typeof TrendingDown }> = [
  { key: "BELOW_COST", title: "Vendiendo bajo el costo", badge: "CRITICAL", icon: AlertTriangle },
  // prompt-precios-vigilancia-movimiento.md — "cuando... no tenga costo, me
  // aparezca": sección propia, después de "bajo costo" (ahí sí hay un costo
  // conocido y es peor) pero antes de margen/costo-viejo (acá directamente
  // no se sabe si hay margen o pérdida).
  { key: "NO_COST", title: "Sin costo conocido", badge: "", icon: HelpCircle },
  { key: "MARGIN_POLICY", title: "Margen bajo la política", badge: "", icon: TrendingDown },
  { key: "COST_STALE", title: "El costo cambió y el precio no", badge: "", icon: Clock3 },
];

/** Parte C.1 (prompt-zona-precios-consolidacion.md) — predicado para "Ningún producto ... tiene {motivo}"; distinto de REASON_GROUPS.title, que es un encabezado de sección, no una frase que sigue a "tiene". */
const REASON_PREDICATE: Record<Reason, string> = {
  BELOW_COST: "precio bajo el costo",
  NO_COST: "un costo sin registrar",
  MARGIN_POLICY: "margen bajo la política",
  COST_STALE: "el costo cambiado y el precio sin actualizar",
};

const fmt = (v: number | null) => (v === null ? "—" : money(v));
const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const fmtDate = (iso: string | null) => (iso ? fmtDatePadded(iso) : "nunca");

function PricingTrayTab({
  branchId,
  branchName,
  branches,
  onClearBranch,
  onGoToCalculator,
  onSendToLoads,
}: {
  branchId: string;
  branchName?: string;
  branches: Branch[];
  /** Limpia el filtro de sucursal — vive en el estado del padre (Zona Precios), compartido por las cuatro pestañas. */
  onClearBranch: () => void;
  /** Parte C.2 (prompt-zona-precios-consolidacion.md) — "Calcular un precio" cambia de pestaña en el padre. */
  onGoToCalculator: () => void;
  onSendToLoads: (seed: LoadSeed) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TrayResult | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState<Reason | "">("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [lastApplyResult, setLastApplyResult] = useState<ApplyResponse | null>(null);
  const [scanning, setScanning] = useState(false);

  // Parte C.4 (prompt-completo-pendientes-2026-10.md) — "la Bandeja como mesa
  // de decisión": precio editable por fila (precargado con el ACTUAL, no el
  // sugerido), el método con el que se llenó ese precio, el contexto
  // completo (Fase 2) cargado bajo demanda, y cuál fila tiene el drawer abierto.
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [methodByRow, setMethodByRow] = useState<Record<string, PriceApplyMethod>>({});
  const [contextCache, setContextCache] = useState<Record<string, PricingTrayDecisionContext>>({});
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [gainOrderPreference, setGainOrderPreferenceState] = useState<GainOrderPreference>("cost");
  const [rowMenuFor, setRowMenuFor] = useState<string | null>(null);
  const [keepTarget, setKeepTarget] = useState<string[] | null>(null); // decisionIds a "mantener" — 1 (fila) o N (lote)
  const [keepNote, setKeepNote] = useState("");
  const [keeping, setKeeping] = useState(false);
  const [alsoBranchesFor, setAlsoBranchesFor] = useState<string | null>(null);
  const [alsoBranchIds, setAlsoBranchIds] = useState<Set<string>>(new Set());
  const [applyingSingle, setApplyingSingle] = useState<string | null>(null);
  const [batchMethodMenuOpen, setBatchMethodMenuOpen] = useState(false);
  const [pendingBigChange, setPendingBigChange] = useState<{ decisionId: string; price: number; method: PriceApplyMethod } | null>(null);
  const rowInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => { setGainOrderPreferenceState(readGainOrderPreference()); }, []);
  function setGainOrderPreference(pref: GainOrderPreference) {
    setGainOrderPreferenceState(pref);
    writeGainOrderPreference(pref);
  }

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
      const result = unwrapApiData(raw) as TrayResult;
      setData(result);
      setSelected(new Set());
      // El input se precarga con el precio ACTUAL (no el sugerido) — el
      // dueño decide. Solo para filas nuevas: si ya existe (de una carga
      // previa en esta misma sesión) no se pisa lo que el usuario tecleó.
      setPriceInputs((prev) => {
        const next = { ...prev };
        for (const row of result.rows) if (!(row.decisionId in next)) next[row.decisionId] = row.currentPrice !== null ? String(row.currentPrice) : "";
        return next;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar la bandeja de precios.");
    } finally {
      setLoading(false);
    }
  }, [branchId, categoryFilter, reasonFilter]);

  async function ensureContext(decisionId: string): Promise<PricingTrayDecisionContext | null> {
    const cached = contextCache[decisionId];
    if (cached) return cached;
    try {
      const res = await apiFetch(`/api/master/pricing/tray/${decisionId}/context`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar el contexto.");
      const ctx = unwrapApiData(raw) as PricingTrayDecisionContext;
      setContextCache((prev) => ({ ...prev, [decisionId]: ctx }));
      return ctx;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar el contexto.");
      return null;
    }
  }

  /** Antes de tener el contexto completo (Fase 2), la fila igual muestra "Referencia de política" — ya viene en evidenceJson, sin fetch extra. */
  function referencesFor(row: TrayRowDto): ReferenceChip[] {
    const ctx = contextCache[row.decisionId];
    if (ctx) return ctx.references.map((r) => ({ method: r.method, label: REFERENCE_LABELS[r.method] ?? r.label, price: r.price, available: r.available, reason: r.reason }));
    return [{ method: "SUGGESTED", label: REFERENCE_LABELS.SUGGESTED, price: row.suggestedPrice, available: row.suggestedPrice !== null, reason: row.suggestedPrice === null ? "sin costo" : undefined }];
  }

  function openDetail(decisionId: string) {
    setExpandedRow(decisionId);
    void ensureContext(decisionId);
  }

  /**
   * PARTE A (prompt-precios-mejoras-bandeja-visibilidad.md) — "Recalcular
   * ahora" dispara un escaneo real (POST /api/master/brain/scan), no solo
   * un refresh de lo que ya está guardado (eso es "Actualizar", arriba).
   *
   * prompt-brain-centro-decisiones.md Fase 2.6 — SCHEDULED_SCAN (no
   * DEEP_SCAN): desde el rediseño de Brain, DEEP_SCAN/QUICK_SCAN/etc. son
   * modos de diagnóstico avanzado que la ruta reserva a SYSTEM_ADMIN; un
   * Master común ya no puede dispararlos. SCHEDULED_SCAN deja pasar
   * cualquier categoría igual que antes dejaba DEEP_SCAN (brain/engine.ts,
   * detectorAllowedForMode cae a `true` por default) y además cierra
   * automáticamente lo que pricing-detector ya no vuelve a ver, así que
   * este refresh también limpia bandeja vieja. trigger:"PRICING_REFRESH"
   * identifica el origen en BrainScanRun sin inventar un modo nuevo.
   */
  async function recalcularAhora() {
    setScanning(true);
    try {
      const res = await apiFetch("/api/master/brain/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "PRICING",
          branchId: branchId || undefined,
          mode: "SCHEDULED_SCAN",
          trigger: "PRICING_REFRESH",
          // detectPricingDecisions hace un await secuencial de
          // checkStockGroupPricingHealth por cada grupo de fusión activo
          // (hasta 200) además de las 3 consultas batch — margen extra
          // para que una sucursal con muchas fusiones no corte el scan a
          // la mitad (maxDuration de la ruta es 60s).
          timeoutMs: 25000,
        }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo recalcular.");
      const result = unwrapApiData(raw) as { created: number; updated: number; reopened: number; errors: Array<{ detector?: string; message: string }> };
      if (result.errors.length > 0) {
        toast.error(`Recalculado con avisos: ${result.errors[0].message}`, { duration: 8000 });
      } else {
        const total = result.created + result.updated + result.reopened;
        toast.success(total > 0
          ? `Recalculado — ${total} decisión${total === 1 ? "" : "es"} nueva${total === 1 ? "" : "s"} o actualizada${total === 1 ? "" : "s"}.`
          : "Recalculado — sin novedades.");
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo recalcular.");
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    apiFetch("/api/catalog/categories").then((r) => (r.ok ? r.json() : null)).then((raw) => { if (raw) setCategories(unwrapApiData(raw) as Category[]); }).catch(() => {});
  }, []);

  const rowsByReason = useMemo(() => {
    const map: Record<Reason, TrayRowDto[]> = { BELOW_COST: [], NO_COST: [], MARGIN_POLICY: [], COST_STALE: [] };
    for (const row of data?.rows ?? []) map[row.reason].push(row);
    return map;
  }, [data]);

  // ↑/↓ mueven entre filas — orden plano, el mismo en que se renderizan los grupos.
  const flatRowOrder = useMemo(() => REASON_GROUPS.flatMap((g) => rowsByReason[g.key].map((r) => r.decisionId)), [rowsByReason]);

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

  function focusRow(decisionId: string | undefined) {
    if (!decisionId) return;
    rowInputRefs.current[decisionId]?.focus();
  }

  function moveSelection(fromDecisionId: string, direction: -1 | 1) {
    const idx = flatRowOrder.indexOf(fromDecisionId);
    if (idx === -1) return;
    focusRow(flatRowOrder[idx + direction]);
  }

  const summary = useMemo(() => {
    if (selectedRows.length === 0) return null;
    return buildBatchSummary(selectedRows.map((r) => ({ previousPrice: r.currentPrice, newPrice: parsePriceInput(priceInputs[r.decisionId] ?? "") })));
  }, [selectedRows, priceInputs]);

  async function applySelection() {
    setApplying(true);
    try {
      const items = [...selected].map((decisionId) => {
        const price = parsePriceInput(priceInputs[decisionId] ?? "");
        const method = methodByRow[decisionId] ?? "SUGGESTED";
        return price !== null ? { decisionId, price, method } : { decisionId };
      });
      const res = await apiFetch("/api/master/pricing/tray/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, reason: "Aplicado desde la bandeja de precios" }),
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

  async function applyOneDecision(decisionId: string, price: number, method: PriceApplyMethod) {
    setApplyingSingle(decisionId);
    try {
      const res = await apiFetch("/api/master/pricing/tray/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ decisionId, price, method }], reason: "Aplicado desde la bandeja de precios" }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo aplicar el precio.");
      const result = unwrapApiData(raw) as ApplyResponse;
      if (result.failed.length > 0) throw new Error(result.failed[0].reason);
      toast.success("Precio aplicado.");
      if (expandedRow === decisionId) setExpandedRow(null);
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo aplicar el precio.");
    } finally {
      setApplyingSingle(null);
    }
  }

  /** Enter en el input, o botón "Aplicar": aplica, con confirmación si el cambio pasa de ±30%. */
  function requestApply(row: TrayRowDto) {
    const price = parsePriceInput(priceInputs[row.decisionId] ?? "");
    if (price === null) return;
    const method = methodByRow[row.decisionId] ?? "SUGGESTED";
    if (shouldConfirmBigChange(row.currentPrice, price)) {
      setPendingBigChange({ decisionId: row.decisionId, price, method });
      return;
    }
    void applyOneDecision(row.decisionId, price, method);
  }

  async function keepDecisions(decisionIds: string[], note: string) {
    setKeeping(true);
    try {
      const res = await apiFetch("/api/master/pricing/tray/keep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionIds, note }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo mantener el precio.");
      const result = unwrapApiData(raw) as KeepResponse;
      if (result.rejected.length === 0) {
        toast.success(`${result.kept.length} precio(s) mantenido(s).`);
      } else {
        toast.error(`${result.kept.length} mantenido(s), ${result.rejected.length} rechazado(s): ${result.rejected[0].reason}`);
      }
      setKeepTarget(null);
      setKeepNote("");
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo mantener el precio.");
    } finally {
      setKeeping(false);
    }
  }

  async function applyAlsoInBranches(row: TrayRowDto) {
    const price = parsePriceInput(priceInputs[row.decisionId] ?? "");
    if (price === null || alsoBranchIds.size === 0) return;
    setApplyingSingle(row.decisionId);
    try {
      const res = await apiFetch("/api/master/pricing/tray/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ decisionId: row.decisionId, price, method: methodByRow[row.decisionId] ?? "MANUAL", alsoBranchIds: [...alsoBranchIds] }],
          reason: "Aplicado desde la bandeja de precios",
        }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo aplicar en las otras sucursales.");
      const result = unwrapApiData(raw) as ApplyResponse & { applied: Array<{ alsoBranches?: Array<{ branchId: string; applied: boolean; error?: string }> }> };
      const alsoResults = result.applied[0]?.alsoBranches ?? [];
      const failedAlso = alsoResults.filter((b) => !b.applied);
      toast.success(failedAlso.length === 0
        ? `Aplicado acá y en ${alsoResults.length} sucursal(es) más.`
        : `Aplicado acá; ${failedAlso.length} de ${alsoResults.length} sucursal(es) fallaron.`);
      setAlsoBranchesFor(null);
      setAlsoBranchIds(new Set());
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo aplicar en las otras sucursales.");
    } finally {
      setApplyingSingle(null);
    }
  }

  /** "Usar método ▾ en seleccionadas": precio de ESE método en cada fila seleccionada, solo donde esté disponible. */
  async function applyMethodToSelection(method: PriceApplyMethod) {
    setBatchMethodMenuOpen(false);
    const rows = selectedRows;
    const contexts = await Promise.all(rows.map((row) => ensureContext(row.decisionId)));
    const touchedIds = new Set<string>();
    setPriceInputs((prev) => {
      const next = { ...prev };
      rows.forEach((row, i) => {
        const ctx = contexts[i];
        const refs: ReferenceChip[] = ctx ? ctx.references.map((r) => ({ method: r.method, label: r.label, price: r.price, available: r.available })) : referencesFor(row);
        const price = priceForMethod(refs, method);
        if (price !== null) { next[row.decisionId] = String(price); touchedIds.add(row.decisionId); }
      });
      return next;
    });
    setMethodByRow((prev) => {
      const next = { ...prev };
      for (const decisionId of touchedIds) next[decisionId] = method;
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {/* Parte C.4.3 — "quitar el lenguaje que trata la política como verdad". */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-[var(--color-text-muted)]">Revisá y decidí. Las referencias son guía.</p>
        <button
          type="button"
          onClick={() => setGainOrderPreference(gainOrderPreference === "cost" ? "price" : "cost")}
          className="text-xs font-medium text-[var(--color-master-600)] hover:underline"
        >
          Mostrar primero: {gainOrderPreference === "cost" ? "% sobre costo" : "% sobre precio"}
        </button>
      </div>
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
        {/* PARTE A (prompt-precios-mejoras-bandeja-visibilidad.md) — distinto
            de "Actualizar" (arriba, solo re-lee la bandeja guardada): esto
            dispara un escaneo real sobre la sucursal/categoría elegidas
            ahora mismo. El flujo completo: cambiás costo global o política
            → "Recalcular ahora" acá → la bandeja se llena → selección
            múltiple → Confirmar. */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="ml-auto"
          onClick={() => void recalcularAhora()}
          loading={scanning}
          icon={<Calculator className="h-4 w-4" />}
          title={branchId ? undefined : "Sin sucursal elegida, recalcula en todas"}
        >
          Recalcular ahora
        </Button>
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
                        <tr className="hidden border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)] xl:table-row">
                          <th className="w-8 px-3 py-2" />
                          <th className="px-3 py-2">Producto</th>
                          <th className="px-3 py-2">Sucursal</th>
                          <th className="px-3 py-2 text-right">Costo</th>
                          <th className="px-3 py-2 text-right">Precio actual</th>
                          <th className="px-3 py-2">Precio nuevo</th>
                          <th className="px-3 py-2 text-right">Vendido 90d</th>
                          <th className="w-14 px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <TrayRow
                            key={row.decisionId}
                            row={row}
                            priceInput={priceInputs[row.decisionId] ?? ""}
                            onPriceInputChange={(value) => { setPriceInputs((prev) => ({ ...prev, [row.decisionId]: value })); setMethodByRow((prev) => ({ ...prev, [row.decisionId]: "MANUAL" })); }}
                            method={methodByRow[row.decisionId] ?? "SUGGESTED"}
                            onSelectReference={(method, price) => { setPriceInputs((prev) => ({ ...prev, [row.decisionId]: String(price) })); setMethodByRow((prev) => ({ ...prev, [row.decisionId]: method })); }}
                            references={referencesFor(row)}
                            selected={selected.has(row.decisionId)}
                            onToggleSelect={() => toggleRow(row.decisionId, row.applicable)}
                            expanded={expandedRow === row.decisionId}
                            onToggleExpand={() => (expandedRow === row.decisionId ? setExpandedRow(null) : openDetail(row.decisionId))}
                            onApply={() => requestApply(row)}
                            onKeep={() => setKeepTarget([row.decisionId])}
                            onOpenMenu={() => setRowMenuFor((prev) => (prev === row.decisionId ? null : row.decisionId))}
                            gainOrderPreference={gainOrderPreference}
                            onEnterKey={() => requestApply(row)}
                            onArrowKey={(direction) => moveSelection(row.decisionId, direction)}
                            registerInputRef={(el) => { rowInputRefs.current[row.decisionId] = el; }}
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
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-[var(--color-text-muted)]">{selected.size} producto{selected.size === 1 ? "" : "s"} seleccionado{selected.size === 1 ? "" : "s"}</span>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Button type="button" variant="ghost" size="sm" onClick={() => setBatchMethodMenuOpen((v) => !v)} icon={<ChevronDown className="h-3.5 w-3.5" />}>Usar método</Button>
                {batchMethodMenuOpen && (
                  <div className="absolute bottom-full right-0 mb-1 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-modal)]">
                    {(Object.keys(REFERENCE_LABELS) as PriceApplyMethod[]).filter((m) => m !== "MANUAL").map((m) => (
                      <button key={m} type="button" onClick={() => void applyMethodToSelection(m)} className="block w-full px-3 py-2 text-left text-xs hover:bg-[var(--color-surface-alt)]">{REFERENCE_LABELS[m]}</button>
                    ))}
                  </div>
                )}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setKeepTarget([...selected])}>Mantener seleccionadas</Button>
              <Button type="button" variant="success" onClick={() => setConfirming(true)}>
                Aplicar seleccionados ({selected.size})
              </Button>
            </div>
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
              <p><strong className="text-[var(--color-text)]">{summary.count}</strong> producto{summary.count === 1 ? "" : "s"} · <strong className="text-[var(--color-success-700)]">{summary.upCount} suben</strong> · <strong className="text-[var(--color-danger-600)]">{summary.downCount} bajan</strong>{summary.sameCount > 0 ? ` · ${summary.sameCount} sin cambio` : ""}</p>
              <p>Promedio: <strong className="text-[var(--color-text)]">{fmt(summary.avgBefore)} → {fmt(summary.avgAfter)}</strong></p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={applying}>Cancelar</Button>
              <Button type="button" variant="success" onClick={() => void applySelection()} loading={applying}>Confirmar</Button>
            </div>
          </div>
        </div>
      )}

      {/* "⋯" — Ver detalle / Enviar a carga de precios / Aplicar también en… */}
      {rowMenuFor && (() => {
        const row = (data?.rows ?? []).find((r) => r.decisionId === rowMenuFor);
        if (!row) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setRowMenuFor(null)}>
            <div className="w-full max-w-xs space-y-1 rounded-t-xl bg-[var(--color-surface)] p-2 shadow-2xl sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => { openDetail(row.decisionId); setRowMenuFor(null); }} className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[var(--color-surface-alt)]">Ver detalle</button>
              <button type="button" onClick={() => { onSendToLoads({ branchId: row.branchId, products: [{ productId: row.productId, sku: row.productSku, name: row.productName }] }); setRowMenuFor(null); }} className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[var(--color-surface-alt)]">Enviar a carga de precios</button>
              {row.applicable && (
                <button type="button" onClick={() => { setAlsoBranchesFor(row.decisionId); setAlsoBranchIds(new Set()); setRowMenuFor(null); }} className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[var(--color-surface-alt)]">Aplicar también en…</button>
              )}
              <button type="button" onClick={() => setRowMenuFor(null)} className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">Cancelar</button>
            </div>
          </div>
        );
      })()}

      {/* Detalle (Fase 4.2) */}
      {expandedRow && (() => {
        const row = (data?.rows ?? []).find((r) => r.decisionId === expandedRow);
        if (!row) return null;
        return (
          <TrayDetailDrawer
            row={row}
            onClose={() => setExpandedRow(null)}
            rowProps={{
              row,
              priceInput: priceInputs[row.decisionId] ?? "",
              onPriceInputChange: (value) => { setPriceInputs((prev) => ({ ...prev, [row.decisionId]: value })); setMethodByRow((prev) => ({ ...prev, [row.decisionId]: "MANUAL" })); },
              method: methodByRow[row.decisionId] ?? "SUGGESTED",
              onSelectReference: (method, price) => { setPriceInputs((prev) => ({ ...prev, [row.decisionId]: String(price) })); setMethodByRow((prev) => ({ ...prev, [row.decisionId]: method })); },
              references: referencesFor(row),
              selected: selected.has(row.decisionId),
              onToggleSelect: () => toggleRow(row.decisionId, row.applicable),
              expanded: true,
              onToggleExpand: () => setExpandedRow(null),
              onApply: () => requestApply(row),
              onKeep: () => setKeepTarget([row.decisionId]),
              onOpenMenu: () => {},
              gainOrderPreference,
              onEnterKey: () => requestApply(row),
              registerInputRef: () => {},
            }}
          />
        );
      })()}

      {/* "Mantener" — nota obligatoria, con chips rápidos */}
      {keepTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Mantener {keepTarget.length === 1 ? "el precio actual" : `${keepTarget.length} precios`}</h3>
            <div className="flex flex-wrap gap-1.5">
              {KEEP_NOTE_CHIPS.map((chip) => (
                <button key={chip} type="button" onClick={() => setKeepNote(chip)} className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">{chip}</button>
              ))}
            </div>
            <textarea value={keepNote} onChange={(e) => setKeepNote(e.target.value)} rows={2} placeholder="Nota (mínimo 5 caracteres)" className="hm-input w-full rounded-lg text-sm" />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => { setKeepTarget(null); setKeepNote(""); }} disabled={keeping}>Cancelar</Button>
              <Button type="button" variant="success" onClick={() => void keepDecisions(keepTarget, keepNote)} loading={keeping} disabled={keepNote.trim().length < 5}>Confirmar</Button>
            </div>
          </div>
        </div>
      )}

      {/* "Aplicar también en…" */}
      {alsoBranchesFor && (() => {
        const row = (data?.rows ?? []).find((r) => r.decisionId === alsoBranchesFor);
        if (!row) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Aplicar también en otras sucursales</h3>
              <p className="text-xs text-[var(--color-text-muted)]">{money(parsePriceInput(priceInputs[row.decisionId] ?? "") ?? 0)} para {row.productName} — cada sucursal valida su propio costo.</p>
              <div className="flex flex-wrap gap-2">
                {branches.filter((b) => b.id !== row.branchId).map((b) => {
                  const active = alsoBranchIds.has(b.id);
                  return (
                    <label key={b.id} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${active ? "border-[var(--color-master-600)] bg-[var(--color-master-50)] text-[var(--color-master-700)]" : "border-[var(--color-border)] text-[var(--color-text-muted)]"}`}>
                      <input type="checkbox" className="hidden" checked={active} onChange={() => setAlsoBranchIds((prev) => { const next = new Set(prev); if (next.has(b.id)) next.delete(b.id); else next.add(b.id); return next; })} />
                      {b.code} · {b.name}
                    </label>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => { setAlsoBranchesFor(null); setAlsoBranchIds(new Set()); }} disabled={applyingSingle === row.decisionId}>Cancelar</Button>
                <Button type="button" variant="success" onClick={() => void applyAlsoInBranches(row)} loading={applyingSingle === row.decisionId} disabled={alsoBranchIds.size === 0}>Aplicar</Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Enter sube/baja más de ±30% — confirmar antes de aplicar (Fase 4.3). */}
      {pendingBigChange && (() => {
        const row = (data?.rows ?? []).find((r) => r.decisionId === pendingBigChange.decisionId);
        if (!row) { setPendingBigChange(null); return null; }
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-sm space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">¿Confirmar cambio grande?</h3>
              <p className="text-sm text-[var(--color-text-muted)]">
                {row.productName}: {fmt(row.currentPrice)} → <strong className="text-[var(--color-text)]">{fmt(pendingBigChange.price)}</strong> — más de 30% de cambio.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setPendingBigChange(null)}>Cancelar</Button>
                <Button type="button" variant="success" onClick={() => { const p = pendingBigChange; setPendingBigChange(null); void applyOneDecision(p.decisionId, p.price, p.method); }}>Confirmar</Button>
              </div>
            </div>
          </div>
        );
      })()}
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

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── TAB: PRECIOS VIGENTES (prompt-precios-vigentes-catalogo.md, Parte C) ── */
/* Bandeja = lo que está mal. Precios vigentes = lo que hay. USA los mismos  */
/* números que resuelve el backend (effective-pricing.ts + resolveCatalog-  */
/* DisplayCost) — acá solo se muestran, no se recalculan.                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

type CurrentPriceSource = "BRANCH" | "STANDARD" | "FUSION_DERIVED" | "MISSING";
type CurrentCostSource = "BRANCH" | "GLOBAL_AVERAGE" | "GLOBAL" | "LAST_PURCHASE" | "WAC_ESTIMATE" | "NONE";

type CurrentPriceRow = {
  productId: string;
  sku: string;
  name: string;
  categoryName: string;
  effectiveCost: number;
  effectivePrice: number | null;
  priceSource: CurrentPriceSource;
  /** Parte B (prompt-precios-mejoras-bandeja-visibilidad.md) — de dónde sale effectiveCost; BRANCH = costo manual propio de esta sucursal. */
  costSource: CurrentCostSource;
  /** Solo con costSource BRANCH y auditoría encontrada para ese BranchProductSetting. */
  branchCostSetBy: string | null;
  branchCostSetAt: string | null;
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
  /** Parte B.3 — contador del encabezado: "N productos con costo manual por sucursal". */
  branchCostCount: number;
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

function CurrentPricesTab({ branchId, onOpenCalculator, onSendToLoads }: { branchId: string; onOpenCalculator: (productId: string) => void; onSendToLoads: (seed: LoadSeed) => void }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CurrentPricesResponse | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [priceSourceFilter, setPriceSourceFilter] = useState<CurrentPriceSource | "">("");
  const [sort, setSort] = useState<CurrentPricesSort>("name");
  const [page, setPage] = useState(1);
  // Puente a "Carga de precios" — selección de esta página, no de todo el
  // filtro (ver prompt-carga-precios.md, reporte de cierre: "seleccionar
  // todos los N del filtro" quedó fuera de alcance para no arriesgar un
  // truncado silencioso si el filtro trae más productos que el límite de
  // una sola página).
  const [selectedForLoad, setSelectedForLoad] = useState<Set<string>>(new Set());
  const [downloading, runDownload] = useSubmitting();

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
      setSelectedForLoad(new Set());
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

  /** Fase 4 (prompt-carga-precios.md) — "Descargar lista para actualizar": mismos filtros de esta pantalla, .xlsx con una columna PrecioNuevo en blanco para llenar y volver a subir desde Carga de precios. */
  async function downloadTemplate() {
    await runDownload(async () => {
      try {
        const params = new URLSearchParams();
        params.set("branchId", branchId);
        if (categoryFilter) params.set("categoryId", categoryFilter);
        if (debouncedQ) params.set("q", debouncedQ);
        if (priceSourceFilter) params.set("priceSource", priceSourceFilter);
        const res = await apiFetch(`/api/master/pricing/current/export?${params.toString()}`);
        const raw = await res.json().catch(() => null);
        if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo descargar la lista.");
        const result = unwrapApiData(raw) as { filename: string; base64: string; rowCount: number };
        const byteChars = atob(result.base64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = result.filename;
        link.click();
        URL.revokeObjectURL(url);
        toast.success(`Descargado — ${result.rowCount} producto${result.rowCount === 1 ? "" : "s"}.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo descargar la lista.");
      }
    });
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
          {/* Parte B.3 — contador de un vistazo, sin recorrer la tabla:
              cuántas excepciones de costo manual hay activas en esta
              sucursal. Informativo, no filtra (no hay filtro de costSource
              en esta pantalla todavía). */}
          {data.totals.branchCostCount > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-info-200)] bg-[var(--color-info-50)] px-3 py-1 text-xs font-medium text-[var(--color-info-700)]"
              title="Productos cuyo costo efectivo en esta sucursal viene de un costo manual propio (branchCost), no del costo global."
            >
              {data.totals.branchCostCount} con costo manual por sucursal
            </span>
          )}
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
        <Button type="button" variant="ghost" size="sm" onClick={() => void downloadTemplate()} loading={downloading}>Descargar lista para actualizar</Button>
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
                  <th className="px-3 py-2"></th>
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
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedForLoad.has(row.productId)}
                          onChange={() => setSelectedForLoad((prev) => {
                            const next = new Set(prev);
                            if (next.has(row.productId)) next.delete(row.productId); else next.add(row.productId);
                            return next;
                          })}
                          aria-label={`Seleccionar ${row.name} para carga de precios`}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="block truncate font-medium text-[var(--color-text)]">{row.name}</span>
                        <span className="block text-xs text-[var(--color-text-soft)]">{row.sku}</span>
                      </td>
                      <td className="px-3 py-2.5 text-[var(--color-text-muted)]">{row.categoryName}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Parte B (prompt-precios-mejoras-bandeja-visibilidad.md) — no
                              bloquea ni oculta branchCost, solo lo hace visible: costSource
                              BRANCH significa que esta sucursal NO sigue el costo global. */}
                          {row.costSource === "BRANCH" && (
                            <span
                              className="inline-flex items-center rounded-full border border-[var(--color-info-200)] bg-[var(--color-info-50)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-info-700)]"
                              title={
                                row.branchCostSetBy
                                  ? `Este producto NO usa el costo global en esta sucursal — costo manual fijado por ${row.branchCostSetBy}${row.branchCostSetAt ? ` el ${fmtDate(row.branchCostSetAt)}` : ""}.`
                                  : "Este producto NO usa el costo global en esta sucursal — alguien fijó un costo manual aquí."
                              }
                            >
                              Manual
                            </span>
                          )}
                          {row.effectiveCost > 0 ? fmt(row.effectiveCost) : <span className="text-[var(--color-text-soft)]">—</span>}
                        </div>
                      </td>
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

      {selectedForLoad.size > 0 && data && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-2xl md:pl-[calc(var(--sidebar-width,0px)+1rem)]">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <span className="text-sm text-[var(--color-text-muted)]">{selectedForLoad.size} producto{selectedForLoad.size === 1 ? "" : "s"} seleccionado{selectedForLoad.size === 1 ? "" : "s"}</span>
            <Button
              type="button"
              variant="primary"
              onClick={() => onSendToLoads({
                branchId,
                products: data.rows.filter((r) => selectedForLoad.has(r.productId)).map((r) => ({ productId: r.productId, sku: r.sku, name: r.name })),
              })}
            >
              Agregar a carga de precios ({selectedForLoad.size})
            </Button>
          </div>
        </div>
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
