"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  Plus, CheckCircle, Loader2, X, Search, Send, Ban, Package,
  ArrowRight, Eye, RefreshCw, Factory, ShoppingCart,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, qty, fmtDate, fmtDateTime } from "@/lib/format";

/* ══════════════════════════════════════════════════════════════
 * Tipos
 * ══════════════════════════════════════════════════════════════ */

type Product = { id: string; sku: string; name: string; unit: string; isTimber?: boolean };
type Branch = { id: string; code: string; name: string; isDefaultSupplier?: boolean };
type Supplier = { id: string; name: string; ruc?: string | null; paymentTerms?: string | null };

type SignalSource = {
  type: "TRANSFER" | "PRODUCTION" | "PURCHASE";
  quantity: number;
  branchId?: string;
  branchName?: string;
  supplierId?: string | null;
  supplierName?: string | null;
};
type InboundDocument = {
  kind: "PURCHASE_ORDER" | "TRANSFER";
  documentId: string;
  documentNumber: string;
  originLabel: string | null;
  pendingQuantity: number;
  createdAt: string;
  expectedAt: string;
};
type ReplenishmentSignal = {
  productId: string;
  sku: string;
  name: string;
  branchId: string;
  mode: "AUTO" | "MANUAL_OVERRIDE" | "EXCLUDED";
  stockOnHand: number;
  averageDailyDemand: number;
  abcClass: "A" | "B" | "C";
  xyzClass: "X" | "Y" | "Z";
  combinedClass: string;
  leadTimeDays: number;
  coverageDaysRemaining: number | null;
  reorderPoint: number;
  targetQuantity: number;
  inboundQuantity: number;
  inboundDocuments: InboundDocument[];
  grossNeed: number;
  netNeed: number;
  estimatedCost: number | null;
  severity: "CRITICAL" | "LOW" | "COVERED" | "NO_DEMAND";
  sources: SignalSource[];
  message: string;
  warnings: string[];
};

type DraftItem = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  currentStock: number;
  criticality: string;
  recommendedSource: string;
  sourceBranchId: string | null;
  suggestedQuantity: number;
  finalQuantity: number | null;
  reason: string;
  warnings: string[];
  status: string;
  linkedTransferId: string | null;
  linkedPurchaseOrderId: string | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierRuc: string | null;
  supplierPaymentTerms: string | null;
  estimatedUnitCost: number | null;
  addedManually: boolean;
};
type DraftType = {
  id: string;
  branchId: string;
  branchName: string;
  status: string;
  summary: { total: number; criticalCount: number; lowCount: number; pendingCount: number };
  items: DraftItem[];
};

type TransferLine = {
  id?: string;
  productId: string;
  product?: Product;
  quantityRequested: number;
  quantityDispatched: number;
  quantityReceived: number;
  unitCostSnapshot: number;
};
type Transfer = {
  id: string;
  transferNumber: string;
  status: string;
  fromBranch: { id: string; code: string; name: string };
  toBranch: { id: string; code: string; name: string };
  requestedBy: { username: string; fullName: string };
  approvedBy: { username: string; fullName: string } | null;
  notes: string | null;
  lines: (TransferLine & { product: Product })[];
  createdAt: string;
  approvedAt: string | null;
  dispatchedAt: string | null;
  receivedAt: string | null;
};
type TransferOpportunity = {
  productId: string;
  sku: string;
  name: string;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  availableToTransfer: number;
  suggestedTransferQty: number;
  toBranchStockOnHand: number;
  fromBranchStockOnHand: number;
  estimatedPurchaseCostAvoided: number | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  message: string;
};
type TransferLineForm = { productId: string; quantity: string };

type InboundDocumentRow = {
  kind: "PURCHASE_ORDER" | "TRANSFER";
  documentId: string;
  documentNumber: string;
  originLabel: string;
  productCount: number;
  totalPendingQuantity: number;
  estimatedValue: number;
  createdAt: string;
  expectedAt: string;
  status: "APPROVED" | "IN_TRANSIT" | "PARTIALLY_RECEIVED";
};

type ParamRow = {
  productId: string;
  sku: string;
  name: string;
  mode: "AUTO" | "MANUAL_OVERRIDE" | "EXCLUDED";
  reorderPoint: number | null;
  targetQuantity: number | null;
  safetyStock: number | null;
  leadTimeDays: number | null;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
};

/* ══════════════════════════════════════════════════════════════
 * Helpers
 * ══════════════════════════════════════════════════════════════ */

function getErr(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const ASSUMED_LATE_THRESHOLD_DAYS = 7;

function SeverityChip({ severity }: { severity: ReplenishmentSignal["severity"] }) {
  const cfg = {
    CRITICAL: { cls: "hm-badge-danger", label: "Crítico" },
    LOW: { cls: "hm-badge-warning", label: "Bajo" },
    COVERED: { cls: "hm-badge-info", label: "Cubierto en camino" },
    NO_DEMAND: { cls: "hm-badge-neutral", label: "Sin demanda" },
  }[severity];
  return <span className={`hm-badge ${cfg.cls}`}>{cfg.label}</span>;
}

function SourceChip({ source }: { source: SignalSource | undefined }) {
  if (!source) return <span className="hm-badge hm-badge-neutral">No comprar</span>;
  if (source.type === "TRANSFER") return <span className="hm-badge hm-badge-info">↔ Traslado · {source.branchName ?? "otra sucursal"}</span>;
  if (source.type === "PRODUCTION") return <span className="hm-badge hm-badge-master">⚙ Producción</span>;
  return <span className="hm-badge hm-badge-master">🛒 Compra{source.supplierName ? ` · ${source.supplierName}` : ""}</span>;
}

const TRANSFER_STATUS_CFG: Record<string, { cls: string; label: string }> = {
  DRAFT: { cls: "hm-badge-warning", label: "Borrador" },
  APPROVED: { cls: "hm-badge-success", label: "Aprobado" },
  IN_TRANSIT: { cls: "hm-badge-info", label: "En tránsito" },
  PARTIALLY_RECEIVED: { cls: "hm-badge-info", label: "Parc. recibido" },
  RECEIVED: { cls: "hm-badge-success", label: "Recibido" },
  CANCELLED: { cls: "hm-badge-danger", label: "Cancelado" },
  REJECTED: { cls: "hm-badge-danger", label: "Rechazado" },
};
function TransferStatusBadge({ status }: { status: string }) {
  const c = TRANSFER_STATUS_CFG[status] ?? { cls: "hm-badge-neutral", label: status };
  return <span className={`hm-badge ${c.cls}`}>{c.label}</span>;
}

/* ══════════════════════════════════════════════════════════════
 * TAB 1 — SEÑALES
 * ══════════════════════════════════════════════════════════════ */

function SignalsTab({ branchId, onAdded }: { branchId: string; onAdded: () => void }) {
  const [signals, setSignals] = useState<ReplenishmentSignal[]>([]);
  const [summary, setSummary] = useState({ criticalCount: 0, lowCount: 0, coveredCount: 0, noDemandCount: 0 });
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<"" | ReplenishmentSignal["severity"]>("");
  const [search, setSearch] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addingBulk, setAddingBulk] = useState(false);

  const fetchSignals = useCallback(async () => {
    if (!branchId) return;
    try {
      setLoading(true);
      const res = await apiFetch(`/api/inventory/replenishment/signals?branchId=${branchId}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al cargar señales");
      const data = unwrapApiData(raw);
      setSignals(Array.isArray(data?.signals) ? data.signals : []);
      setSummary(data?.summary ?? { criticalCount: 0, lowCount: 0, coveredCount: 0, noDemandCount: 0 });
    } catch (error) {
      toast.error(getErr(error, "Error al cargar señales"));
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { fetchSignals(); }, [fetchSignals]);

  const filtered = useMemo(() => {
    return signals.filter((s) => {
      if (severityFilter && s.severity !== severityFilter) return false;
      const q = search.trim().toLowerCase();
      if (q && !s.name.toLowerCase().includes(q) && !s.sku.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [signals, severityFilter, search]);

  const actionable = signals.filter((s) => (s.severity === "CRITICAL" || s.severity === "LOW") && s.sources.length > 0);

  async function addToPlan(list: ReplenishmentSignal[]) {
    if (list.length === 0) return;
    try {
      const res = await apiFetch("/api/master/replenishment/drafts/add-signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, signals: list }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al agregar al plan");
      toast.success(`${list.length} señal${list.length === 1 ? "" : "es"} agregada${list.length === 1 ? "" : "s"} al plan`);
      onAdded();
    } catch (error) {
      toast.error(getErr(error, "Error al agregar al plan"));
    }
  }

  async function handleAddOne(signal: ReplenishmentSignal) {
    setAddingId(signal.productId);
    await addToPlan([signal]);
    setAddingId(null);
  }

  async function handleAddBulk() {
    setAddingBulk(true);
    await addToPlan(actionable);
    setAddingBulk(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="hm-kpi-filter" data-active={severityFilter === ""} onClick={() => setSeverityFilter("")}>
          <b>{signals.length}</b> Todos
        </button>
        <button type="button" className="hm-kpi-filter" data-active={severityFilter === "CRITICAL"} onClick={() => setSeverityFilter("CRITICAL")}>
          <b>{summary.criticalCount}</b> Críticos
        </button>
        <button type="button" className="hm-kpi-filter" data-active={severityFilter === "LOW"} onClick={() => setSeverityFilter("LOW")}>
          <b>{summary.lowCount}</b> Bajos
        </button>
        <button type="button" className="hm-kpi-filter" data-active={severityFilter === "COVERED"} onClick={() => setSeverityFilter("COVERED")}>
          <b>{summary.coveredCount}</b> Cubiertos
        </button>
        <button type="button" className="hm-kpi-filter" data-active={severityFilter === "NO_DEMAND"} onClick={() => setSeverityFilter("NO_DEMAND")}>
          <b>{summary.noDemandCount}</b> Sin demanda
        </button>
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-soft)]" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto..." className="hm-input w-full rounded-lg pl-8 text-sm" />
        </div>
        <button onClick={fetchSignals} className="hm-icon-btn" title="Actualizar"><RefreshCw className="h-4 w-4" /></button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-text-muted)]">
          {signals.length === 0 ? "Sin señales activas para esta sucursal. El inventario está balanceado." : "Ninguna señal coincide con el filtro."}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
          <table className="hm-sheet-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Severidad</th>
                <th className="hm-num">Stock</th>
                <th className="hm-num">Demanda/día</th>
                <th>Cobertura</th>
                <th className="hm-num">En camino</th>
                <th className="hm-num">Necesidad neta</th>
                <th>Fuente sugerida</th>
                <th className="text-center">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.productId}>
                  <td>
                    <span className="font-medium text-[var(--color-text)]">{s.name}</span>
                    <span className="ml-1.5 font-mono text-[0.68rem] text-[var(--color-text-muted)]">{s.sku} · {s.combinedClass}</span>
                  </td>
                  <td><SeverityChip severity={s.severity} /></td>
                  <td className={`hm-num ${s.severity === "CRITICAL" ? "text-[var(--color-danger-700)] font-semibold" : s.severity === "LOW" ? "text-[var(--color-warning-700)]" : ""}`}>{qty(s.stockOnHand)}</td>
                  <td className="hm-num">{s.averageDailyDemand.toFixed(1)}</td>
                  <td>
                    {s.coverageDaysRemaining === null ? (
                      <span className="text-[0.7rem] text-[var(--color-text-soft)]">sin ventas</span>
                    ) : (
                      <span className={`text-[0.7rem] font-mono ${s.coverageDaysRemaining < s.leadTimeDays ? "text-[var(--color-danger-700)]" : "text-[var(--color-text-muted)]"}`}>{s.coverageDaysRemaining.toFixed(1)} d</span>
                    )}
                  </td>
                  <td className="hm-num">{s.inboundQuantity > 0 ? qty(s.inboundQuantity) : <span className="text-[var(--color-text-soft)]">0</span>}</td>
                  <td className="hm-num font-semibold">{qty(s.netNeed)}</td>
                  <td><SourceChip source={s.sources[0]} /></td>
                  <td className="text-center">
                    {s.netNeed > 0 && s.sources.length > 0 ? (
                      <button
                        onClick={() => handleAddOne(s)}
                        disabled={addingId === s.productId}
                        className="rounded-lg border border-[var(--color-master-200)] bg-[var(--color-master-50)] px-2.5 py-1 text-xs font-semibold text-[var(--color-master-700)] hover:bg-[var(--color-master-100)] disabled:opacity-50"
                      >
                        {addingId === s.productId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "+ Al plan"}
                      </button>
                    ) : (
                      <span className="text-xs text-[var(--color-text-soft)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2.5 text-[0.78rem] text-[var(--color-text-muted)]">
            <span>Necesidad neta ya descuenta lo comprometido en camino.</span>
            {actionable.length > 0 && (
              <button
                onClick={handleAddBulk}
                disabled={addingBulk}
                className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-master-700)] disabled:opacity-50"
              >
                {addingBulk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Agregar {actionable.length} señal{actionable.length === 1 ? "" : "es"} al plan
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 * TAB 2 — PLAN
 * ══════════════════════════════════════════════════════════════ */

function PlanTab({ branchId, products, refreshKey }: { branchId: string; products: Product[]; refreshKey: number }) {
  const [draft, setDraft] = useState<DraftType | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualQuery, setManualQuery] = useState("");
  const [manualProductId, setManualProductId] = useState("");
  const [manualQty, setManualQty] = useState("1");
  const [manualSource, setManualSource] = useState<"PURCHASE" | "TRANSFER" | "PRODUCTION">("PURCHASE");

  const fetchDraft = useCallback(async () => {
    if (!branchId) return;
    try {
      setLoading(true);
      const listRes = await apiFetch(`/api/master/replenishment/drafts?branchId=${branchId}&status=DRAFT&limit=1`);
      const listRaw = await listRes.json();
      if (!listRes.ok) throw new Error(listRaw.error?.message ?? "Error al cargar el plan");
      const list = unwrapApiData(listRaw);
      if (!Array.isArray(list) || list.length === 0) { setDraft(null); return; }
      const detailRes = await apiFetch(`/api/master/replenishment/drafts/${list[0].id}`);
      const detailRaw = await detailRes.json();
      if (!detailRes.ok) throw new Error(detailRaw.error?.message ?? "Error al cargar el plan");
      setDraft(unwrapApiData(detailRaw));
    } catch (error) {
      toast.error(getErr(error, "Error al cargar el plan"));
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { fetchDraft(); }, [fetchDraft, refreshKey]);

  async function updateQuantity(itemId: string, value: string) {
    if (!draft) return;
    const finalQuantity = parseFloat(value);
    if (!Number.isFinite(finalQuantity) || finalQuantity < 0) return;
    try {
      const res = await apiFetch(`/api/master/replenishment/drafts/${draft.id}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalQuantity }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? "Error al editar cantidad"); }
      fetchDraft();
    } catch (error) {
      toast.error(getErr(error, "Error al editar cantidad"));
    }
  }

  async function removeItem(itemId: string) {
    if (!draft) return;
    try {
      const res = await apiFetch(`/api/master/replenishment/drafts/${draft.id}/items/${itemId}`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? "Error al quitar línea"); }
      toast.success("Línea quitada del plan");
      fetchDraft();
    } catch (error) {
      toast.error(getErr(error, "Error al quitar línea"));
    }
  }

  async function discardPlan() {
    if (!draft) return;
    try {
      setActionLoading("discard");
      const res = await apiFetch(`/api/master/replenishment/drafts/${draft.id}/discard`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? "Error al descartar"); }
      toast.success("Plan descartado");
      setConfirmDiscard(false);
      fetchDraft();
    } catch (error) {
      toast.error(getErr(error, "Error al descartar"));
    } finally {
      setActionLoading(null);
    }
  }

  async function convertPlan() {
    if (!draft) return;
    try {
      setActionLoading("convert");
      const res = await apiFetch(`/api/master/replenishment/drafts/${draft.id}/convert`, { method: "POST" });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? "Error al convertir el plan");
      const data = unwrapApiData(raw);
      const pos = data?.purchaseOrdersCreated?.length ?? 0;
      const trs = data?.transfersCreated?.length ?? 0;
      toast.success(`Convertido: ${pos} pedido${pos === 1 ? "" : "s"} + ${trs} traslado${trs === 1 ? "" : "s"}${data?.warnings?.length ? ` · ${data.warnings.length} advertencia(s)` : ""}`);
      fetchDraft();
    } catch (error) {
      toast.error(getErr(error, "Error al convertir el plan"));
    } finally {
      setActionLoading(null);
    }
  }

  async function addManualItem() {
    if (!manualProductId || parseFloat(manualQty) <= 0) { toast.error("Selecciona un producto y una cantidad válida."); return; }
    try {
      setActionLoading("manual");
      const res = await apiFetch("/api/master/replenishment/drafts/add-manual-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, productId: manualProductId, quantity: parseFloat(manualQty), source: manualSource }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? "Error al agregar producto");
      toast.success("Producto agregado al plan");
      setShowManualForm(false);
      setManualProductId("");
      setManualQuery("");
      setManualQty("1");
      fetchDraft();
    } catch (error) {
      toast.error(getErr(error, "Error al agregar producto"));
    } finally {
      setActionLoading(null);
    }
  }

  const filteredManualProducts = manualQuery.trim()
    ? products.filter((p) => p.sku.toLowerCase().includes(manualQuery.toLowerCase()) || p.name.toLowerCase().includes(manualQuery.toLowerCase())).slice(0, 8)
    : [];

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" /></div>;
  }

  if (!draft || draft.items.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center">
        <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-[var(--color-text-muted)]" />
        <p className="font-medium text-[var(--color-text-secondary)]">No hay un plan activo para esta sucursal.</p>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Andá a la pestaña Señales y agregá productos al plan.</p>
      </div>
    );
  }

  const purchaseItems = draft.items.filter((i) => i.recommendedSource === "SUPPLIER");
  const transferItems = draft.items.filter((i) => i.recommendedSource === "OTHER_BRANCH" || i.recommendedSource === "CENTRAL");
  const productionItems = draft.items.filter((i) => i.recommendedSource === "PRODUCTION");

  const supplierGroups = new Map<string, DraftItem[]>();
  for (const item of purchaseItems) {
    const key = item.supplierId ?? "__sin_proveedor__";
    if (!supplierGroups.has(key)) supplierGroups.set(key, []);
    supplierGroups.get(key)!.push(item);
  }
  const transferGroups = new Map<string, DraftItem[]>();
  for (const item of transferItems) {
    const key = item.sourceBranchId ?? "__sin_origen__";
    if (!transferGroups.has(key)) transferGroups.set(key, []);
    transferGroups.get(key)!.push(item);
  }

  function ItemRow({ item }: { item: DraftItem }) {
    const estimated = (item.finalQuantity ?? 0) * (item.estimatedUnitCost ?? 0);
    return (
      <tr>
        <td>
          <span className="font-medium text-[var(--color-text)]">{item.productName}</span>
          <span className="ml-1.5 font-mono text-[0.68rem] text-[var(--color-text-muted)]">{item.sku}</span>
          {item.addedManually && <span className="ml-1.5 hm-badge hm-badge-neutral">manual</span>}
        </td>
        <td className="hm-num text-[var(--color-text-muted)]">{qty(item.suggestedQuantity)}</td>
        <td className="hm-num">
          <input
            type="number"
            min="0"
            step="1"
            value={item.finalQuantity ?? 0}
            onChange={(e) => updateQuantity(item.id, e.target.value)}
            className="hm-input w-20 rounded-lg text-right text-sm"
          />
        </td>
        <td className="hm-num">{item.estimatedUnitCost !== null ? money(item.estimatedUnitCost) : <span className="text-[var(--color-text-soft)]">—</span>}</td>
        <td className="hm-num font-semibold">{item.estimatedUnitCost !== null ? money(estimated) : "—"}</td>
        <td className="text-center">
          <button onClick={() => removeItem(item.id)} className="hm-icon-btn hm-icon-btn-danger" title="Quitar del plan"><X className="h-4 w-4" /></button>
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Plan de compra · {draft.branchName}</h2>
        <span className="hm-badge hm-badge-neutral">{draft.items.length} línea{draft.items.length === 1 ? "" : "s"}</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setShowManualForm((v) => !v)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">
            <Plus className="mr-1 inline h-3.5 w-3.5" /> Agregar manual
          </button>
          {confirmDiscard ? (
            <>
              <button onClick={discardPlan} disabled={actionLoading === "discard"} className="rounded-lg bg-[var(--color-danger-600)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-danger-700)] disabled:opacity-50">Confirmar</button>
              <button onClick={() => setConfirmDiscard(false)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-semibold text-[var(--color-text-secondary)]">Cancelar</button>
            </>
          ) : (
            <button onClick={() => setConfirmDiscard(true)} className="rounded-lg border border-[var(--color-danger-200)] px-3 py-1.5 text-sm font-semibold text-[var(--color-danger-600)] hover:bg-[var(--color-danger-50)]">Descartar plan</button>
          )}
          <button
            onClick={convertPlan}
            disabled={actionLoading === "convert"}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] disabled:opacity-50"
          >
            {actionLoading === "convert" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            Convertir en {supplierGroups.size} pedido{supplierGroups.size === 1 ? "" : "s"} + {transferGroups.size} traslado{transferGroups.size === 1 ? "" : "s"}
          </button>
        </div>
      </div>

      {showManualForm && (
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="relative min-w-[220px] flex-1">
              <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Producto</label>
              <input
                type="text"
                value={manualProductId ? (products.find((p) => p.id === manualProductId)?.name ?? "") : manualQuery}
                onChange={(e) => { setManualQuery(e.target.value); setManualProductId(""); }}
                placeholder="Buscar por SKU o nombre..."
                className="hm-input w-full rounded-lg text-sm"
              />
              {filteredManualProducts.length > 0 && !manualProductId && (
                <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-lg">
                  {filteredManualProducts.map((p) => (
                    <button key={p.id} type="button" onClick={() => { setManualProductId(p.id); setManualQuery(""); }} className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[0.78rem] hover:bg-[var(--color-surface-alt)]">
                      <span className="font-mono text-[0.68rem] text-[var(--color-text-muted)]">{p.sku}</span>
                      <span className="flex-1 truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Cantidad</label>
              <input type="number" min="1" value={manualQty} onChange={(e) => setManualQty(e.target.value)} className="hm-input w-24 rounded-lg text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Fuente</label>
              <select value={manualSource} onChange={(e) => setManualSource(e.target.value as typeof manualSource)} className="hm-input rounded-lg text-sm">
                <option value="PURCHASE">Compra</option>
                <option value="TRANSFER">Traslado</option>
                <option value="PRODUCTION">Producción</option>
              </select>
            </div>
            <button onClick={addManualItem} disabled={actionLoading === "manual"} className="rounded-lg bg-[var(--color-master-600)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] disabled:opacity-50">
              {actionLoading === "manual" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Agregar"}
            </button>
          </div>
        </div>
      )}

      {Array.from(supplierGroups.entries()).map(([supplierKey, items]) => {
        const first = items[0];
        const total = items.reduce((acc, i) => acc + (i.finalQuantity ?? 0) * (i.estimatedUnitCost ?? 0), 0);
        return (
          <div key={supplierKey} className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden">
            <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-2.5">
              <b className="text-sm text-[var(--color-text)]">{first.supplierName ?? "Sin proveedor asignado"}</b>
              {first.supplierRuc && <span className="font-mono text-[0.68rem] text-[var(--color-text-muted)]">RUC {first.supplierRuc}</span>}
              {first.supplierPaymentTerms && <span className="text-[0.7rem] text-[var(--color-text-muted)]">{first.supplierPaymentTerms}</span>}
              <span className="hm-num ml-auto font-semibold text-[var(--color-text)]">{money(total)}</span>
            </div>
            <table className="hm-sheet-table">
              <thead><tr><th>Producto</th><th className="hm-num">Necesidad</th><th className="hm-num">A pedir</th><th className="hm-num">Últ. costo s/IVA</th><th className="hm-num">Estimado</th><th></th></tr></thead>
              <tbody>{items.map((item) => <ItemRow key={item.id} item={item} />)}</tbody>
            </table>
          </div>
        );
      })}

      {Array.from(transferGroups.entries()).map(([branchKey, items]) => (
        <div key={branchKey} className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden">
          <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-2.5">
            <b className="text-sm text-[var(--color-text)]">Traslado desde sucursal</b>
            <span className="font-mono text-[0.68rem] text-[var(--color-text-muted)]">{branchKey === "__sin_origen__" ? "sin origen definido" : branchKey}</span>
          </div>
          <table className="hm-sheet-table">
            <thead><tr><th>Producto</th><th className="hm-num">Necesidad</th><th className="hm-num">A trasladar</th><th></th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><span className="font-medium text-[var(--color-text)]">{item.productName}</span> <span className="ml-1 font-mono text-[0.68rem] text-[var(--color-text-muted)]">{item.sku}</span></td>
                  <td className="hm-num text-[var(--color-text-muted)]">{qty(item.suggestedQuantity)}</td>
                  <td className="hm-num"><input type="number" min="0" value={item.finalQuantity ?? 0} onChange={(e) => updateQuantity(item.id, e.target.value)} className="hm-input w-20 rounded-lg text-right text-sm" /></td>
                  <td className="text-center"><button onClick={() => removeItem(item.id)} className="hm-icon-btn hm-icon-btn-danger"><X className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {productionItems.length > 0 && (
        <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-2.5">
            <Factory className="h-4 w-4 text-[var(--color-text-muted)]" />
            <b className="text-sm text-[var(--color-text)]">Producción interna (solo marcado, sin orden automática)</b>
          </div>
          <table className="hm-sheet-table">
            <thead><tr><th>Producto</th><th className="hm-num">Cantidad</th><th></th></tr></thead>
            <tbody>
              {productionItems.map((item) => (
                <tr key={item.id}>
                  <td><span className="font-medium text-[var(--color-text)]">{item.productName}</span> <span className="ml-1 font-mono text-[0.68rem] text-[var(--color-text-muted)]">{item.sku}</span></td>
                  <td className="hm-num">{qty(item.finalQuantity ?? item.suggestedQuantity)}</td>
                  <td className="text-center"><button onClick={() => removeItem(item.id)} className="hm-icon-btn hm-icon-btn-danger"><X className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="hm-alert hm-alert-info text-[0.8125rem]">
        Al convertir se crean pedidos de compra en borrador (uno por proveedor, con costo real) y traslados en borrador (uno por origen). Los apruebas y recibís normalmente — esas líneas pasan a &quot;En camino&quot; para que el motor no las vuelva a sugerir.
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 * TAB 3 — TRASLADOS (oportunidades + gestión real de traslados)
 * ══════════════════════════════════════════════════════════════ */

function TransitTab({ branchId, branches, products }: { branchId: string; branches: Branch[]; products: Product[] }) {
  const [allTransfers, setAllTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ id: string; kind: "approve" | "dispatch" | "receive" | "cancel" } | null>(null);
  // Fusión de Inventario v2, Fase 1.4: sin esta confirmación explícita, un
  // despacho con sueltas insuficientes (aunque el total de cajas+sueltas
  // alcance) falla en vez de abrir una caja en silencio.
  const [allowAutoOpenDispatch, setAllowAutoOpenDispatch] = useState(false);

  const [suggestions, setSuggestions] = useState<TransferOpportunity[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const [showModal, setShowModal] = useState(false);
  const [modalFromBranchId, setModalFromBranchId] = useState("");
  const [modalToBranchId, setModalToBranchId] = useState("");
  const [modalNotes, setModalNotes] = useState("");
  const [modalLines, setModalLines] = useState<TransferLineForm[]>([]);
  const [modalProductSearch, setModalProductSearch] = useState("");

  const centralBranchId = branches.find((b) => b.isDefaultSupplier)?.id ?? "";

  const fetchTransfers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch("/api/master/transfers");
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? "Error al cargar traslados");
      setAllTransfers(Array.isArray(unwrapApiData(raw)) ? unwrapApiData(raw) : []);
    } catch (error) {
      toast.error(getErr(error, "Error al cargar traslados"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTransfers(); }, [fetchTransfers]);

  useEffect(() => {
    if (!branchId) { setSuggestions([]); return; }
    setSuggestionsLoading(true);
    apiFetch(`/api/inventory/replenishment/transfers?branchId=${branchId}`)
      .then((r) => r.json())
      .then((json) => setSuggestions(Array.isArray(unwrapApiData(json)?.opportunities) ? unwrapApiData(json).opportunities : []))
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false));
  }, [branchId]);

  const transfers = statusFilter ? allTransfers.filter((t) => t.status === statusFilter) : allTransfers;
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { "": allTransfers.length };
    for (const t of allTransfers) counts[t.status] = (counts[t.status] ?? 0) + 1;
    return counts;
  }, [allTransfers]);

  const openCreate = (toId?: string) => {
    setModalFromBranchId(centralBranchId || branches[0]?.id || "");
    setModalToBranchId(toId || branches.find((b) => b.id !== centralBranchId)?.id || "");
    setModalNotes("");
    setModalLines([]);
    setModalProductSearch("");
    setSelectedTransfer(null);
    setShowModal(true);
  };

  const openFromSuggestion = (opp: TransferOpportunity) => {
    setModalFromBranchId(centralBranchId || opp.fromBranchId);
    setModalToBranchId(opp.toBranchId);
    setModalNotes("");
    setModalLines([{ productId: opp.productId, quantity: String(Math.ceil(Number(opp.suggestedTransferQty))) }]);
    setModalProductSearch("");
    setShowModal(true);
  };

  const removeModalLine = (i: number) => setModalLines((prev) => prev.filter((_, idx) => idx !== i));
  const updateModalLine = (i: number, value: string) => setModalLines((prev) => { const next = [...prev]; next[i] = { ...next[i], quantity: value }; return next; });
  const addProductToModal = (productId: string) => {
    if (modalLines.some((l) => l.productId === productId)) { toast("Ese producto ya está en la lista."); return; }
    setModalLines((prev) => [...prev, { productId, quantity: "1" }]);
    setModalProductSearch("");
  };

  const openDetail = (t: Transfer) => {
    setSelectedTransfer(t);
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  async function handleCreate() {
    try {
      setActionLoading("create");
      const lines = modalLines.filter((l) => l.productId).map((l) => ({ productId: l.productId, quantity: parseFloat(l.quantity) || 0 }));
      if (!modalFromBranchId || !modalToBranchId) throw new Error("Seleccione origen y destino");
      if (modalFromBranchId === modalToBranchId) throw new Error("Origen y destino deben ser diferentes");
      if (!lines.length) throw new Error("Agregue al menos una línea");
      const res = await apiFetch("/api/master/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromBranchId: modalFromBranchId, toBranchId: modalToBranchId, notes: modalNotes || undefined, lines }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? "Error al crear traslado");
      toast.success("Traslado creado");
      setShowModal(false);
      fetchTransfers();
    } catch (error) {
      toast.error(getErr(error, "Error al crear traslado"));
    } finally {
      setActionLoading(null);
    }
  }

  async function runAction(id: string, kind: "approve" | "dispatch" | "receive" | "cancel") {
    const endpoints = { approve: "approve", dispatch: "dispatch", receive: "receive", cancel: "cancel" };
    const successMsgs = { approve: "Traslado aprobado", dispatch: "Traslado despachado", receive: "Recepción confirmada", cancel: "Traslado cancelado" };
    try {
      setActionLoading(id);
      const res = await apiFetch(`/api/master/transfers/${id}/${endpoints[kind]}`, {
        method: "POST",
        ...(kind === "receive" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updateBranchCost: true }) } : {}),
        ...(kind === "dispatch" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowAutoOpen: allowAutoOpenDispatch }) } : {}),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? "Error al procesar la acción");
      toast.success(successMsgs[kind]);
      setConfirmAction(null);
      if (selectedTransfer?.id === id) setSelectedTransfer(null);
      fetchTransfers();
    } catch (error) {
      toast.error(getErr(error, "Error al procesar la acción"));
    } finally {
      setActionLoading(null);
    }
  }

  const filteredProducts = modalProductSearch.trim()
    ? products.filter((p) => p.sku.toLowerCase().includes(modalProductSearch.toLowerCase()) || p.name.toLowerCase().includes(modalProductSearch.toLowerCase())).slice(0, 10)
    : [];

  function ConfirmOrActions({ id, status }: { id: string; status: string }) {
    if (confirmAction?.id === id) {
      return (
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => runAction(id, confirmAction.kind)} disabled={actionLoading === id} className="hm-icon-btn text-[var(--color-success-600)]">
            {actionLoading === id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
          </button>
          <button onClick={() => setConfirmAction(null)} className="hm-icon-btn"><X className="h-4 w-4" /></button>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center gap-1">
        <button onClick={() => openDetail(allTransfers.find((t) => t.id === id)!)} className="hm-icon-btn" title="Ver detalle"><Eye className="h-4 w-4" /></button>
        {status === "DRAFT" && (
          <>
            <button onClick={() => setConfirmAction({ id, kind: "approve" })} className="hm-icon-btn text-[var(--color-success-600)]" title="Aprobar"><CheckCircle className="h-4 w-4" /></button>
            <button onClick={() => setConfirmAction({ id, kind: "cancel" })} className="hm-icon-btn hm-icon-btn-danger" title="Cancelar"><Ban className="h-4 w-4" /></button>
          </>
        )}
        {status === "APPROVED" && (
          <>
            <button onClick={() => setConfirmAction({ id, kind: "dispatch" })} className="hm-icon-btn text-[var(--color-info-700)]" title="Despachar"><Send className="h-4 w-4" /></button>
            <button onClick={() => setConfirmAction({ id, kind: "cancel" })} className="hm-icon-btn hm-icon-btn-danger" title="Cancelar"><Ban className="h-4 w-4" /></button>
          </>
        )}
        {(status === "IN_TRANSIT" || status === "PARTIALLY_RECEIVED") && (
          <button onClick={() => setConfirmAction({ id, kind: "receive" })} className="hm-icon-btn text-[var(--color-success-700)]" title="Confirmar recepción"><Package className="h-4 w-4" /></button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section>
        <h4 className="hm-section-rule mb-2.5">Oportunidades de traslado — la fuente nunca queda bajo su propio punto de reorden</h4>
        {suggestionsLoading ? (
          <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-[var(--color-master-500)]" /></div>
        ) : suggestions.length === 0 ? (
          <p className="rounded-lg bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-muted)]">Sin oportunidades de traslado para esta sucursal ahora mismo.</p>
        ) : (
          <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden">
            <table className="hm-sheet-table">
              <thead><tr><th>Producto</th><th>Ruta</th><th className="hm-num">Puede dar</th><th className="hm-num">Sugerido</th><th className="hm-num">Compra evitada</th><th className="text-center">Acción</th></tr></thead>
              <tbody>
                {suggestions.map((opp) => (
                  <tr key={`${opp.fromBranchId}-${opp.productId}`}>
                    <td><span className="font-medium text-[var(--color-text)]">{opp.name}</span> <span className="ml-1 font-mono text-[0.68rem] text-[var(--color-text-muted)]">{opp.sku}</span></td>
                    <td className="text-[0.78rem]">{opp.fromBranchName.split(" - ")[0]} <ArrowRight className="inline h-3 w-3" /> {opp.toBranchName.split(" - ")[0]}</td>
                    <td className="hm-num text-[var(--color-success-700)] font-semibold">{qty(opp.availableToTransfer)}</td>
                    <td className="hm-num font-semibold">{qty(opp.suggestedTransferQty)}</td>
                    <td className="hm-num text-[var(--color-success-700)]">{opp.estimatedPurchaseCostAvoided !== null ? money(opp.estimatedPurchaseCostAvoided) : "—"}</td>
                    <td className="text-center">
                      <button onClick={() => openFromSuggestion(opp)} className="rounded-lg border border-[var(--color-master-200)] bg-[var(--color-master-50)] px-2.5 py-1 text-xs font-semibold text-[var(--color-master-700)] hover:bg-[var(--color-master-100)]">Crear traslado</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <h4 className="hm-section-rule flex-1">Traslados</h4>
          <button onClick={fetchTransfers} className="hm-icon-btn" title="Actualizar"><RefreshCw className="h-4 w-4" /></button>
          <button onClick={() => openCreate()} className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-master-700)]">
            <Plus className="h-4 w-4" /> Nuevo traslado
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {(["", "DRAFT", "APPROVED", "IN_TRANSIT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"] as const).map((s) => (
            <button key={s} type="button" className="hm-kpi-filter" data-active={statusFilter === s} onClick={() => setStatusFilter(s)}>
              <b>{statusCounts[s] ?? 0}</b> {s === "" ? "Todos" : TRANSFER_STATUS_CFG[s]?.label ?? s}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" /></div>
        ) : transfers.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-text-muted)]">No hay traslados con este filtro.</div>
        ) : (
          <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden">
            <table className="hm-sheet-table">
              <thead><tr><th>Traslado</th><th>Ruta</th><th>Estado</th><th className="hm-num">Líneas</th><th>Creado</th><th className="text-center">Acciones</th></tr></thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id} className={`cursor-pointer ${selectedTransfer?.id === t.id ? "bg-[var(--color-master-50)]" : ""}`} onClick={() => openDetail(t)}>
                    <td className="font-mono text-xs font-bold text-[var(--color-text)]">{t.transferNumber}</td>
                    <td className="text-[0.78rem]">{t.fromBranch.code} <ArrowRight className="inline h-3 w-3" /> {t.toBranch.code}</td>
                    <td><TransferStatusBadge status={t.status} /></td>
                    <td className="hm-num">{t.lines.length}</td>
                    <td className="text-[0.75rem] text-[var(--color-text-secondary)]">{fmtDateTime(t.createdAt)}</td>
                    <td className="text-center" onClick={(e) => e.stopPropagation()}><ConfirmOrActions id={t.id} status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedTransfer && (
        <section ref={detailRef} className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <b className="text-sm text-[var(--color-text)]">Traslado {selectedTransfer.transferNumber}</b>
              <TransferStatusBadge status={selectedTransfer.status} />
            </div>
            <button onClick={() => setSelectedTransfer(null)} className="hm-icon-btn"><X className="h-4 w-4" /></button>
          </div>
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-[var(--color-surface-muted)] p-3">
                <p className="mb-1 text-[0.68rem] font-bold uppercase text-[var(--color-text-muted)]">Origen</p>
                <p className="font-semibold text-[var(--color-text)]">{selectedTransfer.fromBranch.code} — {selectedTransfer.fromBranch.name}</p>
              </div>
              <div className="rounded-lg bg-[var(--color-surface-muted)] p-3">
                <p className="mb-1 text-[0.68rem] font-bold uppercase text-[var(--color-text-muted)]">Destino</p>
                <p className="font-semibold text-[var(--color-text)]">{selectedTransfer.toBranch.code} — {selectedTransfer.toBranch.name}</p>
              </div>
              <div className="rounded-lg bg-[var(--color-surface-muted)] p-3">
                <p className="mb-1 text-[0.68rem] font-bold uppercase text-[var(--color-text-muted)]">Solicitado por</p>
                <p className="font-semibold text-[var(--color-text)]">{selectedTransfer.requestedBy.fullName || selectedTransfer.requestedBy.username}</p>
              </div>
            </div>
            {selectedTransfer.notes && <p className="rounded-lg bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-secondary)]">{selectedTransfer.notes}</p>}
            <table className="hm-sheet-table">
              <thead><tr><th>Producto</th><th className="hm-num">Solicitada</th><th className="hm-num">Enviada</th><th className="hm-num">Recibida</th><th className="hm-num">Costo unit.</th></tr></thead>
              <tbody>
                {selectedTransfer.lines.map((line, i) => (
                  <tr key={i}>
                    <td><span className="font-medium text-[var(--color-text)]">{line.product.name}</span> <span className="ml-1 font-mono text-[0.68rem] text-[var(--color-text-muted)]">{line.product.sku}</span></td>
                    <td className="hm-num font-semibold">{Number(line.quantityRequested)}</td>
                    <td className="hm-num">{Number(line.quantityDispatched) || "—"}</td>
                    <td className="hm-num">{Number(line.quantityReceived) || "—"}</td>
                    <td className="hm-num">{Number(line.unitCostSnapshot) > 0 ? money(line.unitCostSnapshot) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {["DRAFT", "APPROVED", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(selectedTransfer.status) && (
              <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
                {selectedTransfer.status === "DRAFT" && (
                  <>
                    <button onClick={() => runAction(selectedTransfer.id, "approve")} disabled={!!actionLoading} className="flex items-center gap-2 rounded-lg bg-[var(--color-success-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-success-700)] disabled:opacity-50"><CheckCircle className="h-4 w-4" /> Aprobar</button>
                    <button onClick={() => runAction(selectedTransfer.id, "cancel")} className="ml-auto flex items-center gap-2 rounded-lg border border-[var(--color-danger-200)] px-4 py-2 text-sm font-semibold text-[var(--color-danger-600)] hover:bg-[var(--color-danger-50)]"><Ban className="h-4 w-4" /> Cancelar</button>
                  </>
                )}
                {selectedTransfer.status === "APPROVED" && (
                  <div className="flex w-full flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                      <input type="checkbox" checked={allowAutoOpenDispatch} onChange={(e) => setAllowAutoOpenDispatch(e.target.checked)} />
                      Abrir cajas/paquetes cerrados si faltan sueltas para completar
                    </label>
                    <button onClick={() => runAction(selectedTransfer.id, "dispatch")} disabled={!!actionLoading} className="flex items-center gap-2 rounded-lg bg-[var(--color-info-700)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-info-800)] disabled:opacity-50"><Send className="h-4 w-4" /> Despachar</button>
                    <button onClick={() => runAction(selectedTransfer.id, "cancel")} className="ml-auto flex items-center gap-2 rounded-lg border border-[var(--color-danger-200)] px-4 py-2 text-sm font-semibold text-[var(--color-danger-600)] hover:bg-[var(--color-danger-50)]"><Ban className="h-4 w-4" /> Cancelar</button>
                  </div>
                )}
                {(selectedTransfer.status === "IN_TRANSIT" || selectedTransfer.status === "PARTIALLY_RECEIVED") && (
                  <button onClick={() => runAction(selectedTransfer.id, "receive")} disabled={!!actionLoading} className="flex items-center gap-2 rounded-lg bg-[var(--color-success-700)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-success-800)] disabled:opacity-50"><Package className="h-4 w-4" /> Confirmar recepción</button>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgb(28_25_23/0.45)] px-4 py-8">
          <div className="w-full max-w-xl rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-modal)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
              <h2 className="text-base font-bold text-[var(--color-text)]">Nuevo traslado entre sucursales</h2>
              <button onClick={() => setShowModal(false)} className="hm-icon-btn"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">Sucursal origen</label>
                  <select value={modalFromBranchId} onChange={(e) => setModalFromBranchId(e.target.value)} className="hm-input w-full rounded-lg text-sm">
                    <option value="">Seleccionar...</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.isDefaultSupplier ? "★ " : ""}{b.code} — {b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">Sucursal destino</label>
                  <select value={modalToBranchId} onChange={(e) => setModalToBranchId(e.target.value)} className="hm-input w-full rounded-lg text-sm">
                    <option value="">Seleccionar...</option>
                    {branches.filter((b) => b.id !== modalFromBranchId).map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">Notas (opcional)</label>
                <textarea value={modalNotes} onChange={(e) => setModalNotes(e.target.value)} rows={2} className="hm-input w-full rounded-lg text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">Buscar y agregar productos</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-soft)]" />
                  <input type="text" value={modalProductSearch} onChange={(e) => setModalProductSearch(e.target.value)} placeholder="SKU o nombre..." className="hm-input w-full rounded-lg pl-8 text-sm" />
                </div>
                {filteredProducts.length > 0 && (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[var(--color-border)]">
                    {filteredProducts.map((p) => (
                      <button key={p.id} type="button" onClick={() => addProductToModal(p.id)} disabled={modalLines.some((l) => l.productId === p.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--color-surface-alt)] disabled:opacity-40">
                        <span><span className="font-mono font-semibold">{p.sku}</span> <span className="text-[var(--color-text-secondary)]">{p.name}</span></span>
                        {modalLines.some((l) => l.productId === p.id) ? <CheckCircle className="h-3.5 w-3.5 text-[var(--color-success-500)]" /> : <Plus className="h-3.5 w-3.5 text-[var(--color-master-600)]" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {modalLines.length > 0 && (
                <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
                  {modalLines.map((line, idx) => {
                    const p = products.find((x) => x.id === line.productId);
                    return (
                      <div key={idx} className="flex items-center gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{p?.name ?? line.productId}</p></div>
                        <input type="number" min="0.01" value={line.quantity} onChange={(e) => updateModalLine(idx, e.target.value)} className="hm-input w-20 rounded-lg text-right text-sm" />
                        <button onClick={() => removeModalLine(idx)} className="hm-icon-btn hm-icon-btn-danger"><X className="h-4 w-4" /></button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-3">
                <button onClick={() => setShowModal(false)} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">Cancelar</button>
                <button onClick={handleCreate} disabled={actionLoading === "create" || modalLines.length === 0} className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] disabled:opacity-50">
                  {actionLoading === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Crear traslado
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 * TAB — MADERA (aparte del motor general: pedido especial por viaje/trip,
 * no por punto de reposición automático)
 * ══════════════════════════════════════════════════════════════ */

type TimberReplenishmentItem = {
  productId: string;
  sku: string;
  name: string;
  stockOnHand: number;
  unitsSoldLast30Days: number;
  unitsSoldLast90Days: number;
  lastSoldAt: string | null;
};

function TimberTab({ branchId }: { branchId: string }) {
  const [items, setItems] = useState<TimberReplenishmentItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    if (!branchId) return;
    try {
      setLoading(true);
      const res = await apiFetch(`/api/inventory/replenishment/timber-signals?branchId=${branchId}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al cargar madera");
      const data = unwrapApiData(raw);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      toast.error(getErr(error, "Error al cargar madera"));
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="hm-kpi-filter" data-active={false}><b>{items.length}</b> dimensión{items.length === 1 ? "" : "es"} en cero</span>
          <button onClick={fetchItems} className="hm-icon-btn" title="Actualizar"><RefreshCw className="h-4 w-4" /></button>
        </div>
        <Link
          href="/app/master/timber/new"
          className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-master-700)]"
        >
          <Plus className="h-3.5 w-3.5" /> Planificar viaje de madera
        </Link>
      </div>
      <p className="text-[0.78rem] text-[var(--color-text-muted)]">
        La madera se compra por viaje con dimensiones específicas, no por punto de reposición automático — por eso está aparte del resto del motor.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-text-muted)]">
          Ninguna dimensión de madera está en cero en esta sucursal.
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
          <table className="hm-sheet-table">
            <thead>
              <tr>
                <th>Dimensión</th>
                <th className="hm-num">Stock</th>
                <th className="hm-num">Vendido 30d</th>
                <th className="hm-num">Vendido 90d</th>
                <th>Última venta</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.productId}>
                  <td>
                    <span className="font-medium text-[var(--color-text)]">{item.name}</span>
                    <span className="ml-1.5 font-mono text-[0.68rem] text-[var(--color-text-muted)]">{item.sku}</span>
                  </td>
                  <td className="hm-num font-semibold text-[var(--color-danger-700)]">{qty(item.stockOnHand)}</td>
                  <td className="hm-num">{qty(item.unitsSoldLast30Days)}</td>
                  <td className="hm-num">{qty(item.unitsSoldLast90Days)}</td>
                  <td className="text-[0.75rem] text-[var(--color-text-muted)]">{item.lastSoldAt ? fmtDate(item.lastSoldAt) : "Sin ventas registradas"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 * TAB 4 — EN CAMINO
 * ══════════════════════════════════════════════════════════════ */

function InboundTab({ branchId }: { branchId: string }) {
  const [docs, setDocs] = useState<InboundDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyLate, setOnlyLate] = useState(false);

  const fetchDocs = useCallback(async () => {
    if (!branchId) return;
    try {
      setLoading(true);
      const res = await apiFetch(`/api/inventory/replenishment/inbound-documents?branchId=${branchId}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? "Error al cargar documentos en camino");
      setDocs(Array.isArray(unwrapApiData(raw)) ? unwrapApiData(raw) : []);
    } catch (error) {
      toast.error(getErr(error, "Error al cargar documentos en camino"));
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  function daysLate(expectedAt: string) {
    const diffMs = Date.now() - new Date(expectedAt).getTime();
    return Math.floor(diffMs / (24 * 60 * 60 * 1000)) - ASSUMED_LATE_THRESHOLD_DAYS;
  }

  const rows = onlyLate ? docs.filter((d) => daysLate(d.expectedAt) > 0) : docs;
  const totalCommitted = docs.reduce((acc, d) => acc + d.estimatedValue, 0);
  const lateCount = docs.filter((d) => daysLate(d.expectedAt) > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="hm-kpi-filter" data-active={!onlyLate} onClick={() => setOnlyLate(false)}>
          <b>{docs.length}</b> Documentos
        </button>
        <span className="hm-kpi-filter" data-active={false}><b>{money(totalCommitted)}</b> comprometido</span>
        <button type="button" className="hm-kpi-filter" data-active={onlyLate} onClick={() => setOnlyLate((v) => !v)}>
          <b className="text-[var(--color-danger-700)]">{lateCount}</b> atrasado{lateCount === 1 ? "" : "s"}
        </button>
        <button onClick={fetchDocs} className="hm-icon-btn ml-auto" title="Actualizar"><RefreshCw className="h-4 w-4" /></button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-text-muted)]">
          {docs.length === 0 ? "Nada comprometido en camino hacia esta sucursal." : "Ningún documento atrasado."}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden">
          <table className="hm-sheet-table">
            <thead>
              <tr><th>Documento</th><th>Origen</th><th className="hm-num">Productos</th><th className="hm-num">Pendiente</th><th className="hm-num">Valor est.</th><th>Esperado</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const late = daysLate(d.expectedAt);
                return (
                  <tr key={d.documentId}>
                    <td className="font-mono text-xs font-bold text-[var(--color-text)]">{d.documentNumber}</td>
                    <td><span className="hm-badge hm-badge-master">{d.kind === "PURCHASE_ORDER" ? "Compra" : "Traslado"}</span> <span className="ml-1 text-[0.75rem] text-[var(--color-text-muted)]">{d.originLabel}</span></td>
                    <td className="hm-num">{d.productCount}</td>
                    <td className="hm-num font-semibold">{qty(d.totalPendingQuantity)}</td>
                    <td className="hm-num">{money(d.estimatedValue)}</td>
                    <td className="text-[0.75rem]">{fmtDate(d.expectedAt)}</td>
                    <td>
                      {late > 0 ? (
                        <span className="hm-badge hm-badge-danger">Atrasado {late} d</span>
                      ) : d.status === "IN_TRANSIT" || d.status === "PARTIALLY_RECEIVED" ? (
                        <span className="hm-badge hm-badge-info">En tránsito</span>
                      ) : (
                        <span className="hm-badge hm-badge-success">En plazo</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 * TAB 5 — PARÁMETROS
 * ══════════════════════════════════════════════════════════════ */

function ParamsTab({ branchId, suppliers }: { branchId: string; suppliers: Supplier[] }) {
  const [rows, setRows] = useState<ParamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [onlyOverride, setOnlyOverride] = useState(false);
  const [edits, setEdits] = useState<Record<string, { reorderPoint: string; targetQuantity: string; leadTimeDays: string; preferredSupplierId: string }>>({});
  const [saving, setSaving] = useState(false);

  const fetchParams = useCallback(async () => {
    if (!branchId) return;
    try {
      setLoading(true);
      const res = await apiFetch(`/api/master/replenishment/params?branchId=${branchId}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? "Error al cargar parámetros");
      setRows(Array.isArray(unwrapApiData(raw)) ? unwrapApiData(raw) : []);
      setEdits({});
    } catch (error) {
      toast.error(getErr(error, "Error al cargar parámetros"));
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { fetchParams(); }, [fetchParams]);

  const filtered = rows.filter((r) => {
    if (onlyOverride && r.mode === "AUTO") return false;
    const q = search.trim().toLowerCase();
    if (q && !r.name.toLowerCase().includes(q) && !r.sku.toLowerCase().includes(q)) return false;
    return true;
  });

  function startOverride(row: ParamRow) {
    setEdits((prev) => ({
      ...prev,
      [row.productId]: {
        reorderPoint: String(row.reorderPoint ?? 0),
        targetQuantity: String(row.targetQuantity ?? 0),
        leadTimeDays: String(row.leadTimeDays ?? 3),
        preferredSupplierId: row.preferredSupplierId ?? "",
      },
    }));
  }

  async function saveOverride(productId: string) {
    const edit = edits[productId];
    if (!edit) return;
    try {
      const res = await apiFetch("/api/master/reorder/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          productId,
          reorderPoint: parseFloat(edit.reorderPoint) || 0,
          targetQuantity: parseFloat(edit.targetQuantity) || 0,
          leadTimeDays: parseInt(edit.leadTimeDays, 10) || 0,
          preferredSupplierId: edit.preferredSupplierId || null,
        }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? "Error al guardar override");
      toast.success("Override guardado");
      fetchParams();
    } catch (error) {
      toast.error(getErr(error, "Error al guardar override"));
    }
  }

  async function toggleExcluded(row: ParamRow) {
    try {
      setSaving(true);
      const res = await apiFetch("/api/master/replenishment/params/excluded", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, productId: row.productId, excluded: row.mode !== "EXCLUDED" }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? "Error al cambiar modo"); }
      fetchParams();
    } catch (error) {
      toast.error(getErr(error, "Error al cambiar modo"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-soft)]" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por SKU o nombre..." className="hm-input w-full rounded-lg pl-8 text-sm" />
        </div>
        <button type="button" className="hm-kpi-filter" data-active={onlyOverride} onClick={() => setOnlyOverride((v) => !v)}>
          Solo con override
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" /></div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden">
          <table className="hm-sheet-table">
            <thead>
              <tr><th>Producto</th><th>Modo</th><th className="hm-num">Pto. reorden</th><th className="hm-num">Objetivo</th><th className="hm-num">Lead time</th><th>Proveedor pref.</th><th className="text-center">Acción</th></tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const editing = edits[row.productId];
                return (
                  <tr key={row.productId}>
                    <td><span className="font-medium text-[var(--color-text)]">{row.name}</span> <span className="ml-1 font-mono text-[0.68rem] text-[var(--color-text-muted)]">{row.sku}</span></td>
                    <td>
                      {row.mode === "AUTO" && <span className="hm-badge hm-badge-success">Auto · demanda</span>}
                      {row.mode === "MANUAL_OVERRIDE" && <span className="hm-badge hm-badge-warning">Override manual</span>}
                      {row.mode === "EXCLUDED" && <span className="hm-badge hm-badge-neutral">Excluido</span>}
                    </td>
                    {editing ? (
                      <>
                        <td className="hm-num"><input type="number" min="0" value={editing.reorderPoint} onChange={(e) => setEdits((p) => ({ ...p, [row.productId]: { ...editing, reorderPoint: e.target.value } }))} className="hm-input w-20 rounded-lg text-right text-sm" /></td>
                        <td className="hm-num"><input type="number" min="0" value={editing.targetQuantity} onChange={(e) => setEdits((p) => ({ ...p, [row.productId]: { ...editing, targetQuantity: e.target.value } }))} className="hm-input w-20 rounded-lg text-right text-sm" /></td>
                        <td className="hm-num"><input type="number" min="0" value={editing.leadTimeDays} onChange={(e) => setEdits((p) => ({ ...p, [row.productId]: { ...editing, leadTimeDays: e.target.value } }))} className="hm-input w-16 rounded-lg text-right text-sm" /></td>
                        <td>
                          <select value={editing.preferredSupplierId} onChange={(e) => setEdits((p) => ({ ...p, [row.productId]: { ...editing, preferredSupplierId: e.target.value } }))} className="hm-input rounded-lg text-sm">
                            <option value="">Sin proveedor</option>
                            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </td>
                        <td className="text-center">
                          <button onClick={() => saveOverride(row.productId)} className="rounded-lg bg-[var(--color-master-600)] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[var(--color-master-700)]">Guardar</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="hm-num text-[var(--color-text-muted)]">{row.reorderPoint !== null ? qty(row.reorderPoint) : "—"} {row.mode === "AUTO" && <span className="text-[0.6rem]">calc.</span>}</td>
                        <td className="hm-num text-[var(--color-text-muted)]">{row.targetQuantity !== null ? qty(row.targetQuantity) : "—"} {row.mode === "AUTO" && <span className="text-[0.6rem]">calc.</span>}</td>
                        <td className="hm-num">{row.leadTimeDays ?? "—"}</td>
                        <td className="text-[0.8rem]">{row.preferredSupplierName ?? "—"}</td>
                        <td className="text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button onClick={() => startOverride(row)} disabled={row.mode === "EXCLUDED"} className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] disabled:opacity-40">Override</button>
                            <button onClick={() => toggleExcluded(row)} disabled={saving} className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] disabled:opacity-40">
                              {row.mode === "EXCLUDED" ? "Reactivar" : "Excluir"}
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 * PÁGINA PRINCIPAL — REPOSICIÓN INTELIGENTE
 * ══════════════════════════════════════════════════════════════ */

type MainTab = "signals" | "plan" | "transit" | "inbound" | "params" | "timber";

const MAIN_TABS: Array<{ key: MainTab; label: string }> = [
  { key: "signals", label: "Señales" },
  { key: "plan", label: "Plan" },
  { key: "transit", label: "Traslados" },
  { key: "inbound", label: "En camino" },
  { key: "params", label: "Parámetros" },
  { key: "timber", label: "Madera" },
];

export default function ReplenishmentPage() {
  const [activeTab, setActiveTab] = useState<MainTab>("signals");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branchId, setBranchId] = useState("");
  const [planRefreshKey, setPlanRefreshKey] = useState(0);

  const fetchMeta = useCallback(async () => {
    try {
      const [bRes, pRes, sRes] = await Promise.all([
        fetch("/api/branches"),
        fetch("/api/catalog/products"),
        fetch("/api/suppliers"),
      ]);
      const bData = unwrapApiData(await bRes.json());
      const pData = unwrapApiData(await pRes.json());
      const sData = unwrapApiData(await sRes.json());
      const branchList = Array.isArray(bData) ? bData : [];
      setBranches(branchList);
      // La madera se compra por pedido especial (viaje/trip con dimensiones
      // especificas, ver pestana Madera) — no debe aparecer en los
      // buscadores manuales de Plan/Traslados como si fuera un producto de
      // compra rutinaria.
      setProducts(Array.isArray(pData) ? (pData as Product[]).filter((p) => !p.isTimber) : []);
      setSuppliers(Array.isArray(sData) ? sData : []);
      const firstNonCentral = branchList.find((b: Branch) => !b.isDefaultSupplier) ?? branchList[0];
      if (firstNonCentral) setBranchId(firstNonCentral.id);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[1.1875rem] font-bold tracking-[-0.02em] text-[var(--color-text)]">Reposición Inteligente</h1>
          <p className="text-[0.78rem] text-[var(--color-text-muted)]">Un solo motor por demanda real — señales, plan, traslados y parámetros en un mismo lugar.</p>
        </div>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="hm-input rounded-lg text-sm" aria-label="Sucursal">
          {branches.map((b) => <option key={b.id} value={b.id}>{b.isDefaultSupplier ? "★ " : ""}{b.code} — {b.name}</option>)}
        </select>
      </div>

      <div className="erp-tabs-pill w-fit">
        {MAIN_TABS.map((tab) => (
          <button key={tab.key} type="button" data-active={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {!branchId ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" /></div>
      ) : (
        <>
          {activeTab === "signals" && <SignalsTab branchId={branchId} onAdded={() => setPlanRefreshKey((k) => k + 1)} />}
          {activeTab === "plan" && <PlanTab branchId={branchId} products={products} refreshKey={planRefreshKey} />}
          {activeTab === "transit" && <TransitTab branchId={branchId} branches={branches} products={products} />}
          {activeTab === "inbound" && <InboundTab branchId={branchId} />}
          {activeTab === "params" && <ParamsTab branchId={branchId} suppliers={suppliers} />}
          {activeTab === "timber" && <TimberTab branchId={branchId} />}
        </>
      )}
    </section>
  );
}
