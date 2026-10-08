"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Plus, RefreshCcw, Search, X } from "lucide-react";
import toast from "react-hot-toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useSubmitting } from "@/lib/client/use-submitting";
import { nextGridRowIndex } from "@/lib/pricing-load-grid-nav";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";

/**
 * prompt-carga-precios.md Fase 3 — pestaña "Carga de precios" de la Zona
 * Precios: lista de cargas, armar una nueva (a mano o sembrada desde
 * Precios vigentes vía `seed`), y el editor (planilla con autoguardado,
 * regla masiva, aplicar/cancelar). El cálculo de margen/aviso/bloqueo
 * SIEMPRE sale de la vista previa del backend (GET .../batches/[id]) — esta
 * pantalla nunca recalcula esos números, solo los muestra (mismo criterio
 * que la Calculadora de esta misma zona: el servidor calcula, el cliente
 * pinta).
 */

const fmt = (v: number | null) => (v === null ? "—" : money(v));
const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-NI", { dateStyle: "short", timeStyle: "short" }) : "—");

type Branch = { id: string; code: string; name: string };
type BatchStatus = "DRAFT" | "APPLYING" | "APPLIED" | "PARTIAL" | "CANCELLED";
type BatchTarget = "BRANCHES" | "GENERAL";

export type LoadSeedProduct = { productId: string; sku: string; name: string };
export type LoadSeed = { branchId: string; products: LoadSeedProduct[] };

type BatchListRow = {
  id: string; code: string; status: BatchStatus; target: BatchTarget; branchIds: string[];
  reason: string; source: string; createdByName: string; appliedByName: string | null;
  createdAt: string; appliedAt: string | null; linesTotal: number; linesApplied: number;
};

type ClassificationResult =
  | { status: "SKIPPED"; reason: string }
  | { status: "BLOCKED"; reason: string }
  | { status: "PENDING"; warnings: string[]; marginNew: number | null; changePercent: number | null };

type PreviewLine = {
  id: string; productId: string; productSku: string; productName: string;
  branchId: string | null; branchCode: string | null;
  costSnapshot: number | null; currentPriceSnapshot: number | null; priceSourceSnapshot: string;
  newPrice: number | null; status: "PENDING" | "APPLIED" | "CONFLICT" | "BLOCKED" | "SKIPPED";
  dbMessage: string | null; marginCurrent: number | null; marginNew: number | null; changePercent: number | null;
  classification: ClassificationResult;
};

type PreviewTotals = { total: number; toApply: number; blocked: number; withWarning: number; withoutNewPrice: number };

type BatchPreview = {
  batch: { id: string; code: string; status: BatchStatus; target: BatchTarget; branchIds: string[]; reason: string };
  lines: PreviewLine[];
  totals: PreviewTotals;
};

const STATUS_BADGE: Record<BatchStatus, { label: string; className: string }> = {
  DRAFT: { label: "Borrador", className: "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)]" },
  APPLYING: { label: "Aplicando…", className: "bg-[var(--color-info-50)] text-[var(--color-info-700)] border-[var(--color-info-200)]" },
  APPLIED: { label: "Aplicada", className: "bg-[var(--color-success-50)] text-[var(--color-success-700)] border-[var(--color-success-200)]" },
  PARTIAL: { label: "Parcial", className: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)] border-[var(--color-warning-200)]" },
  CANCELLED: { label: "Cancelada", className: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)] border-[var(--color-danger-200)]" },
};

const LINE_STATUS_BADGE: Record<PreviewLine["status"], { label: string; className: string }> = {
  PENDING: { label: "Pendiente", className: "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)]" },
  APPLIED: { label: "Aplicada", className: "bg-[var(--color-success-50)] text-[var(--color-success-700)] border-[var(--color-success-200)]" },
  CONFLICT: { label: "Conflicto", className: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)] border-[var(--color-warning-200)]" },
  BLOCKED: { label: "Bloqueada", className: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)] border-[var(--color-danger-200)]" },
  SKIPPED: { label: "Sin precio", className: "bg-[var(--color-surface-alt)] text-[var(--color-text-soft)] border-[var(--color-border)]" },
};

export function PriceLoadTab({ branches, seed, onSeedConsumed }: { branches: Branch[]; seed: LoadSeed | null; onSeedConsumed: () => void }) {
  const [view, setView] = useState<"list" | "new" | "detail">(seed ? "new" : "list");
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);
  const [listRefreshToken, setListRefreshToken] = useState(0);

  useEffect(() => { if (seed) setView("new"); }, [seed]);

  function openBatch(id: string) {
    setOpenBatchId(id);
    setView("detail");
  }

  function backToList() {
    setOpenBatchId(null);
    setView("list");
    setListRefreshToken((t) => t + 1);
  }

  return (
    <div>
      {view === "list" && (
        <PriceLoadList key={listRefreshToken} onOpenBatch={openBatch} onNewBatch={() => setView("new")} />
      )}
      {view === "new" && (
        <PriceLoadNewForm
          branches={branches}
          seed={seed}
          onCreated={(id) => { onSeedConsumed(); openBatch(id); }}
          onCancel={() => { onSeedConsumed(); setView("list"); }}
        />
      )}
      {view === "detail" && openBatchId && (
        <PriceLoadEditor batchId={openBatchId} branches={branches} onBack={backToList} />
      )}
    </div>
  );
}

/* ── Lista de cargas ── */

const STATUS_FILTERS: Array<{ key: BatchStatus | ""; label: string }> = [
  { key: "", label: "Todas" },
  { key: "DRAFT", label: "Borrador" },
  { key: "APPLYING", label: "Aplicando" },
  { key: "APPLIED", label: "Aplicada" },
  { key: "PARTIAL", label: "Parcial" },
  { key: "CANCELLED", label: "Cancelada" },
];

function PriceLoadList({ onOpenBatch, onNewBatch }: { onOpenBatch: (id: string) => void; onNewBatch: () => void }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<BatchListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<BatchStatus | "">("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      params.set("limit", "50");
      const res = await apiFetch(`/api/master/pricing/batches?${params.toString()}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudieron cargar las cargas de precios.");
      const data = unwrapApiData(raw) as { rows: BatchListRow[]; total: number };
      setRows(data.rows);
      setTotal(data.total);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar las cargas de precios.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map(({ key, label }) => (
            <button
              key={key || "all"}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === key
                  ? "border-[var(--color-pay)] bg-[var(--color-pay)]/10 text-[var(--color-pay)]"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => void load()} disabled={loading} icon={<RefreshCcw className="h-4 w-4" />}>Actualizar</Button>
          <Button type="button" variant="primary" size="sm" onClick={onNewBatch} icon={<Plus className="h-4 w-4" />}>Nueva carga</Button>
        </div>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Cargando…</p>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm font-medium text-[var(--color-text)]">
            {statusFilter ? "No hay cargas con ese estado." : "Todavía no hay cargas de precios."}
          </p>
          {!statusFilter && (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Creá una desde aquí, o desde Precios vigentes seleccionando productos.</p>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="hm-table w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Destino</th>
                  <th className="px-3 py-2">Motivo</th>
                  <th className="px-3 py-2">Creada por</th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2 text-right">Líneas</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const badge = STATUS_BADGE[row.status];
                  return (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-alt)]"
                      onClick={() => onOpenBatch(row.id)}
                    >
                      <td className="px-3 py-2.5 font-medium text-[var(--color-text)]" data-label="Código">{row.code}</td>
                      <td className="px-3 py-2.5" data-label="Estado">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
                      </td>
                      <td className="px-3 py-2.5 text-[var(--color-text-muted)]" data-label="Destino">
                        {row.target === "GENERAL" ? "General" : `${row.branchIds.length} sucursal${row.branchIds.length === 1 ? "" : "es"}`}
                      </td>
                      <td className="px-3 py-2.5 max-w-xs truncate text-[var(--color-text-muted)]" data-label="Motivo" title={row.reason}>{row.reason}</td>
                      <td className="px-3 py-2.5 text-[var(--color-text-muted)]" data-label="Creada por">{row.createdByName}</td>
                      <td className="px-3 py-2.5 text-[var(--color-text-muted)]" data-label="Fecha">{fmtDateTime(row.createdAt)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" data-label="Líneas">{row.linesApplied}/{row.linesTotal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)]">{total} carga{total === 1 ? "" : "s"}</div>
        </Card>
      )}
    </div>
  );
}

/* ── Buscador de productos (compartido por el formulario nuevo y el editor) ── */

type ProductOption = { id: string; sku: string; name: string };

function ProductPicker({ onAdd, excludeIds }: { onAdd: (p: ProductOption) => void; excludeIds: Set<string> }) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { setOptions([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch(`/api/catalog/products?isActive=true&q=${encodeURIComponent(q.trim())}&limit=20`);
        const raw = await res.json();
        if (res.ok) setOptions(unwrapApiData(raw) as ProductOption[]);
      } catch {
        // búsqueda best-effort — un error de red no bloquea el formulario
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="space-y-2">
      <div className="relative w-full sm:w-[320px]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-soft)]" aria-hidden="true" />
        <input className="hm-input pl-8" placeholder="Buscar producto por SKU o nombre" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {q.trim().length >= 2 && (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)]">
          {searching ? (
            <p className="p-3 text-xs text-[var(--color-text-muted)]">Buscando…</p>
          ) : options.length === 0 ? (
            <p className="p-3 text-xs text-[var(--color-text-muted)]">Sin resultados.</p>
          ) : (
            options.map((opt) => {
              const already = excludeIds.has(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={already}
                  onClick={() => { onAdd(opt); setQ(""); setOptions([]); }}
                  className="flex w-full items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2 text-left text-sm last:border-0 hover:bg-[var(--color-surface-alt)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="truncate">{opt.name} <span className="text-[var(--color-text-soft)]">· {opt.sku}</span></span>
                  {already ? <span className="text-xs text-[var(--color-text-soft)]">ya agregado</span> : <Plus className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* ── Armar una carga nueva ── */

function PriceLoadNewForm({
  branches,
  seed,
  onCreated,
  onCancel,
}: {
  branches: Branch[];
  seed: LoadSeed | null;
  onCreated: (batchId: string) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState<BatchTarget>(seed ? "BRANCHES" : "BRANCHES");
  const [selectedBranchIds, setSelectedBranchIds] = useState<Set<string>>(new Set(seed ? [seed.branchId] : []));
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<Map<string, ProductOption>>(new Map((seed?.products ?? []).map((p) => [p.productId, { id: p.productId, sku: p.sku, name: p.name }])));
  const [creating, runCreate] = useSubmitting();

  function toggleBranch(id: string) {
    setSelectedBranchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function addItem(p: ProductOption) {
    setItems((prev) => {
      const next = new Map(prev);
      next.set(p.id, p);
      return next;
    });
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }

  async function submit() {
    if (reason.trim().length < 3) { toast.error("El motivo necesita al menos 3 caracteres."); return; }
    if (target === "BRANCHES" && selectedBranchIds.size === 0) { toast.error("Elegí al menos una sucursal."); return; }
    if (items.size === 0) { toast.error("Agregá al menos un producto."); return; }

    await runCreate(async () => {
      try {
        const res = await apiFetch("/api/master/pricing/batches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target,
            branchIds: target === "BRANCHES" ? [...selectedBranchIds] : [],
            reason: reason.trim(),
            source: "MANUAL",
            items: [...items.keys()].map((productId) => ({ productId, newPrice: null })),
          }),
        });
        const raw = await res.json().catch(() => null);
        if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo crear la carga.");
        const data = unwrapApiData(raw) as { batchId: string; code: string };
        toast.success(`Carga ${data.code} creada.`);
        onCreated(data.batchId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo crear la carga.");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} icon={<ArrowLeft className="h-4 w-4" />}>Volver</Button>
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Nueva carga de precios</h2>
      </div>

      <Card className="space-y-4 p-4">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]">Destino</span>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="load-target" checked={target === "BRANCHES"} onChange={() => setTarget("BRANCHES")} />
              Sucursales (precio propio)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="load-target" checked={target === "GENERAL"} onChange={() => setTarget("GENERAL")} />
              General (precio de catálogo)
            </label>
          </div>
        </div>

        {target === "BRANCHES" && (
          <div>
            <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]">Sucursales</span>
            <div className="flex flex-wrap gap-2">
              {branches.map((b) => (
                <label key={b.id} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${selectedBranchIds.has(b.id) ? "border-[var(--color-pay)] bg-[var(--color-pay)]/10 text-[var(--color-pay)]" : "border-[var(--color-border)] text-[var(--color-text-muted)]"}`}>
                  <input type="checkbox" className="hidden" checked={selectedBranchIds.has(b.id)} onChange={() => toggleBranch(b.id)} />
                  {b.code} · {b.name}
                </label>
              ))}
            </div>
          </div>
        )}

        <div>
          <label htmlFor="load-reason" className="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]">Motivo (obligatorio)</label>
          <textarea id="load-reason" className="hm-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Por qué se hace esta carga de precios" />
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]">Productos ({items.size})</span>
          <ProductPicker onAdd={addItem} excludeIds={new Set(items.keys())} />
          {items.size > 0 && (
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {[...items.values()].map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-surface-alt)] px-3 py-1.5 text-sm">
                  <span className="truncate">{item.name} <span className="text-[var(--color-text-soft)]">· {item.sku}</span></span>
                  <button type="button" onClick={() => removeItem(item.id)} className="shrink-0 text-[var(--color-text-soft)] hover:text-[var(--color-danger-600)]" aria-label={`Quitar ${item.name}`}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={creating}>Cancelar</Button>
          <Button type="button" variant="primary" onClick={() => void submit()} loading={creating}>Crear carga</Button>
        </div>
      </Card>
    </div>
  );
}

/* ── Editor de una carga (planilla, regla masiva, aplicar) ── */

const ROUNDING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "NONE", label: "Sin redondeo" },
  { value: "NEAREST_1", label: "Al entero" },
  { value: "NEAREST_5", label: "Múltiplo de 5" },
  { value: "NEAREST_10", label: "Múltiplo de 10" },
  { value: "NEAREST_50", label: "Múltiplo de 50" },
  { value: "NEAREST_100", label: "Múltiplo de 100" },
  { value: "ENDING_9", label: "Terminado en 9" },
  { value: "ENDING_90", label: "Terminado en 90" },
  { value: "ENDING_99", label: "Terminado en 99" },
];

type RuleKind = "PERCENT_ON_PRICE" | "MARKUP_ON_COST" | "TARGET_MARGIN" | "FIXED";

function PriceLoadEditor({ batchId, branches, onBack }: { batchId: string; branches: Branch[]; onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [applying, runApply] = useSubmitting();
  const [ruleKind, setRuleKind] = useState<RuleKind>("PERCENT_ON_PRICE");
  const [ruleValue, setRuleValue] = useState("");
  const [rounding, setRounding] = useState("NONE");
  const [applyingRule, runApplyRule] = useSubmitting();
  const [applyResult, setApplyResult] = useState<{ status: BatchStatus; totals: Record<string, number> } | null>(null);

  const dirtyRef = useRef<Map<string, number | null>>(new Map());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/master/pricing/batches/${batchId}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar la carga.");
      setPreview(unwrapApiData(raw) as BatchPreview);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar la carga.");
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => { void load(); }, [load]);

  const isDraft = preview?.batch.status === "DRAFT";

  const flushDirty = useCallback(async () => {
    const dirty = dirtyRef.current;
    if (dirty.size === 0) return;
    const updates = [...dirty.entries()].map(([lineId, newPrice]) => ({ lineId, newPrice }));
    dirtyRef.current = new Map();
    try {
      const res = await apiFetch(`/api/master/pricing/batches/${batchId}/lines`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ update: updates }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo guardar el cambio de precio.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el cambio de precio.");
    }
  }, [batchId, load]);

  function scheduleFlush() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { void flushDirty(); }, 600);
  }

  function onPriceInputChange(lineId: string, raw: string) {
    const parsed = raw.trim() === "" ? null : Number(raw);
    setPreview((prev) => {
      if (!prev) return prev;
      return { ...prev, lines: prev.lines.map((l) => (l.id === lineId ? { ...l, newPrice: Number.isFinite(parsed) ? parsed : null } : l)) };
    });
    dirtyRef.current.set(lineId, Number.isFinite(parsed as number) ? (parsed as number) : null);
    scheduleFlush();
  }

  function onGridKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const total = preview?.lines.length ?? 0;
    const next = nextGridRowIndex(index, total, e.key);
    if (next === null) return;
    e.preventDefault();
    rowRefs.current.get(next)?.focus();
  }

  function toggleLine(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function removeSelected() {
    if (selected.size === 0) return;
    try {
      const res = await apiFetch(`/api/master/pricing/batches/${batchId}/lines`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remove: [...selected] }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudieron quitar las líneas.");
      setSelected(new Set());
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron quitar las líneas.");
    }
  }

  function addItem(p: ProductOption) {
    void (async () => {
      try {
        const res = await apiFetch(`/api/master/pricing/batches/${batchId}/lines`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ add: [{ productId: p.id, newPrice: null }] }),
        });
        const raw = await res.json().catch(() => null);
        if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo agregar el producto.");
        await load();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo agregar el producto.");
      }
    })();
  }

  async function applyRule() {
    const percentOrPrice = Number(ruleValue);
    if (!Number.isFinite(percentOrPrice)) { toast.error("Ingresá un valor numérico para la regla."); return; }
    await runApplyRule(async () => {
      try {
        const rule = ruleKind === "FIXED"
          ? { kind: "FIXED", price: percentOrPrice, rounding }
          : { kind: ruleKind, percent: percentOrPrice, rounding };
        const res = await apiFetch(`/api/master/pricing/batches/${batchId}/rule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lineIds: selected.size > 0 ? [...selected] : undefined, rule }),
        });
        const raw = await res.json().catch(() => null);
        if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo aplicar la regla.");
        const result = unwrapApiData(raw) as { updated: number; skipped: number };
        toast.success(`${result.updated} precio${result.updated === 1 ? "" : "s"} calculado${result.updated === 1 ? "" : "s"}${result.skipped > 0 ? ` · ${result.skipped} sin datos suficientes` : ""}.`);
        await load();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo aplicar la regla.");
      }
    });
  }

  async function cancelDraft() {
    if (!window.confirm("¿Cancelar este borrador? No se puede deshacer.")) return;
    try {
      const res = await apiFetch(`/api/master/pricing/batches/${batchId}/cancel`, { method: "POST" });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cancelar la carga.");
      toast.success("Carga cancelada.");
      onBack();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cancelar la carga.");
    }
  }

  async function applyBatch() {
    await runApply(async () => {
      try {
        const res = await apiFetch(`/api/master/pricing/batches/${batchId}/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acknowledgeWarnings }),
        });
        const raw = await res.json().catch(() => null);
        if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo aplicar la carga.");
        const result = unwrapApiData(raw) as { status: BatchStatus; totals: Record<string, number> };
        setApplyResult(result);
        setConfirming(false);
        toast.success(result.status === "APPLIED" ? "Carga aplicada por completo." : "Carga aplicada — algunas líneas quedaron en conflicto o bloqueadas.");
        await load();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo aplicar la carga.");
      }
    });
  }

  /** "Rehacer conflictos en nueva carga" — arma un borrador nuevo con los mismos productos×destino que quedaron en CONFLICT, para recalcular contra el precio vigente de verdad. */
  async function redoConflicts() {
    if (!preview) return;
    const conflictLines = preview.lines.filter((l) => l.status === "CONFLICT");
    if (conflictLines.length === 0) return;
    try {
      const res = await apiFetch("/api/master/pricing/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: preview.batch.target,
          branchIds: preview.batch.target === "GENERAL" ? [] : [...new Set(conflictLines.map((l) => l.branchId).filter((b): b is string => b != null))],
          reason: `Rehacer conflictos de ${preview.batch.code}`,
          source: "MANUAL",
          items: conflictLines.map((l) => ({ productId: l.productId, newPrice: null })),
        }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo armar la nueva carga.");
      const data = unwrapApiData(raw) as { batchId: string; code: string };
      toast.success(`Carga ${data.code} creada con los ${conflictLines.length} conflicto(s).`);
      setApplyResult(null);
      onBack();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo armar la nueva carga.");
    }
  }

  if (loading || !preview) {
    return <p className="py-12 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Cargando…</p>;
  }

  const { batch, lines, totals } = preview;
  const badge = STATUS_BADGE[batch.status];
  const branchLabel = batch.target === "GENERAL" ? "General" : batch.branchIds.map((id) => branches.find((b) => b.id === id)?.code ?? id).join(", ");
  const conflictCount = lines.filter((l) => l.status === "CONFLICT").length;

  return (
    <div className="space-y-5 pb-28">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack} icon={<ArrowLeft className="h-4 w-4" />}>Volver</Button>
        <h2 className="text-sm font-semibold text-[var(--color-text)]">{batch.code}</h2>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
      </div>

      <Card className="space-y-1 p-4 text-sm">
        <p><span className="text-[var(--color-text-muted)]">Destino:</span> {branchLabel}</p>
        <p><span className="text-[var(--color-text-muted)]">Motivo:</span> {batch.reason}</p>
      </Card>

      {applyResult && (
        <Card className={`p-4 ${applyResult.status === "APPLIED" ? "border-[var(--color-success-200)] bg-[var(--color-success-50)]" : "border-[var(--color-warning-200)] bg-[var(--color-warning-50)]"}`}>
          <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Resultado de la aplicación</h3>
          <div className="flex flex-wrap gap-3 text-xs text-[var(--color-text-muted)]">
            {Object.entries(applyResult.totals).map(([status, count]) => (
              <span key={status}><strong className="text-[var(--color-text)]">{count}</strong> {status.toLowerCase()}</span>
            ))}
          </div>
          {conflictCount > 0 && (
            <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => void redoConflicts()}>
              Rehacer {conflictCount} conflicto{conflictCount === 1 ? "" : "s"} en nueva carga
            </Button>
          )}
        </Card>
      )}

      {isDraft && (
        <Card className="space-y-3 p-4">
          <span className="block text-xs font-medium text-[var(--color-text-muted)]">Agregar producto a la carga</span>
          <ProductPicker onAdd={addItem} excludeIds={new Set(lines.map((l) => l.productId))} />
        </Card>
      )}

      {isDraft && (
        <Card className="flex flex-wrap items-end gap-2 p-4">
          <div className="w-[180px]">
            <label htmlFor="load-rule-kind" className="mb-1 block text-xs text-[var(--color-text-muted)]">Regla masiva</label>
            <select id="load-rule-kind" className="hm-input" value={ruleKind} onChange={(e) => setRuleKind(e.target.value as RuleKind)}>
              <option value="PERCENT_ON_PRICE">% sobre precio actual</option>
              <option value="MARKUP_ON_COST">% de markup sobre costo</option>
              <option value="TARGET_MARGIN">Margen objetivo %</option>
              <option value="FIXED">Precio fijo</option>
            </select>
          </div>
          <div className="w-[120px]">
            <label htmlFor="load-rule-value" className="mb-1 block text-xs text-[var(--color-text-muted)]">{ruleKind === "FIXED" ? "Precio" : "Porcentaje"}</label>
            <input id="load-rule-value" type="number" step="0.01" className="hm-input" value={ruleValue} onChange={(e) => setRuleValue(e.target.value)} />
          </div>
          <div className="w-[160px]">
            <label htmlFor="load-rule-rounding" className="mb-1 block text-xs text-[var(--color-text-muted)]">Redondeo</label>
            <select id="load-rule-rounding" className="hm-input" value={rounding} onChange={(e) => setRounding(e.target.value)}>
              {ROUNDING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => void applyRule()} loading={applyingRule}>
            Calcular {selected.size > 0 ? `seleccionadas (${selected.size})` : "todas"}
          </Button>
          {selected.size > 0 && (
            <Button type="button" variant="danger" size="sm" onClick={() => void removeSelected()}>Quitar seleccionadas ({selected.size})</Button>
          )}
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="hm-table w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                {isDraft && <th className="px-3 py-2"></th>}
                <th className="px-3 py-2">Producto</th>
                {batch.target === "BRANCHES" && <th className="px-3 py-2">Sucursal</th>}
                <th className="px-3 py-2 text-right">Costo</th>
                <th className="px-3 py-2 text-right">Precio vigente</th>
                <th className="px-3 py-2 text-right">Precio nuevo</th>
                <th className="px-3 py-2 text-right">Margen nuevo</th>
                <th className="px-3 py-2 text-right">Cambio</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const lineBadge = LINE_STATUS_BADGE[line.status];
                const reason = line.classification.status !== "PENDING" ? line.classification.reason : (line.classification.warnings[0] ?? null);
                const editable = isDraft && line.status !== "BLOCKED";
                return (
                  <tr key={line.id} className="border-b border-[var(--color-border)] last:border-0">
                    {isDraft && (
                      <td className="px-3 py-2.5" data-label="">
                        <input type="checkbox" checked={selected.has(line.id)} onChange={() => toggleLine(line.id)} />
                      </td>
                    )}
                    <td className="px-3 py-2.5" data-label="Producto">
                      <span className="block truncate font-medium text-[var(--color-text)]">{line.productName}</span>
                      <span className="block text-xs text-[var(--color-text-soft)]">{line.productSku}</span>
                    </td>
                    {batch.target === "BRANCHES" && <td className="px-3 py-2.5 text-[var(--color-text-muted)]" data-label="Sucursal">{line.branchCode}</td>}
                    <td className="px-3 py-2.5 text-right tabular-nums" data-label="Costo">{fmt(line.costSnapshot)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums" data-label="Precio vigente">{fmt(line.currentPriceSnapshot)}</td>
                    <td className="px-3 py-2.5 text-right" data-label="Precio nuevo">
                      {editable ? (
                        <input
                          ref={(el) => { if (el) rowRefs.current.set(index, el); else rowRefs.current.delete(index); }}
                          type="number"
                          step="0.01"
                          min="0"
                          className="hm-input h-11 w-28 text-right"
                          value={line.newPrice ?? ""}
                          onChange={(e) => onPriceInputChange(line.id, e.target.value)}
                          onKeyDown={(e) => onGridKeyDown(e, index)}
                        />
                      ) : (
                        <span className="tabular-nums">{fmt(line.newPrice)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums" data-label="Margen nuevo">{fmtPct(line.marginNew)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums" data-label="Cambio">{line.changePercent === null ? "—" : `${line.changePercent >= 0 ? "+" : ""}${line.changePercent.toFixed(1)}%`}</td>
                    <td className="px-3 py-2.5" data-label="Estado">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${lineBadge.className}`} title={reason ?? undefined}>
                        {lineBadge.label}
                      </span>
                      {reason && line.status === "PENDING" && (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-[var(--color-warning-700)]" title={reason}>
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {isDraft && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-2xl md:pl-[calc(var(--sidebar-width,0px)+1rem)]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--color-text-muted)]">
              <span><strong className="text-[var(--color-text)]">{totals.toApply}</strong> a aplicar</span>
              {totals.blocked > 0 && <span className="text-[var(--color-danger-600)]"><strong>{totals.blocked}</strong> bloqueadas</span>}
              {totals.withWarning > 0 && <span className="text-[var(--color-warning-700)]"><strong>{totals.withWarning}</strong> con aviso</span>}
              {totals.withoutNewPrice > 0 && <span><strong>{totals.withoutNewPrice}</strong> sin precio</span>}
            </div>
            <div className="flex items-center gap-3">
              {totals.withWarning > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                  <input type="checkbox" checked={acknowledgeWarnings} onChange={(e) => setAcknowledgeWarnings(e.target.checked)} />
                  Revisé los avisos
                </label>
              )}
              <Button type="button" variant="ghost" onClick={() => void cancelDraft()}>Cancelar borrador</Button>
              <Button
                type="button"
                variant="success"
                onClick={() => setConfirming(true)}
                disabled={totals.toApply === 0 || (totals.withWarning > 0 && !acknowledgeWarnings)}
              >
                Aplicar carga
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Confirmar aplicación de la carga</h3>
            <p className="text-sm text-[var(--color-text-muted)]">Esto escribe precios reales. Antes de confirmar:</p>
            <div className="space-y-1.5 rounded-lg bg-[var(--color-surface-alt)] p-3 text-sm">
              <p><strong className="text-[var(--color-text)]">{totals.toApply}</strong> precio{totals.toApply === 1 ? "" : "s"} se van a aplicar</p>
              {totals.blocked > 0 && <p><strong className="text-[var(--color-danger-600)]">{totals.blocked}</strong> quedarán bloqueados</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={applying}>Cancelar</Button>
              <Button type="button" variant="success" onClick={() => void applyBatch()} loading={applying}>Confirmar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
