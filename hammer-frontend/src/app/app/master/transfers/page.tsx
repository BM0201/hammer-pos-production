"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import {
  Truck, Plus, CheckCircle, Loader2, ArrowRight, X,
  Package, Building2, FileText, Eye, Send, Ban, Sparkles,
  RefreshCw, Clock,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/format";

/* ─── Types ─── */

type Product = { id: string; sku: string; name: string; unit: string };

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
  toBranch:   { id: string; code: string; name: string };
  requestedBy: { username: string; fullName: string };
  approvedBy:  { username: string; fullName: string } | null;
  notes:       string | null;
  lines:       (TransferLine & { product: Product })[];
  createdAt:   string;
  approvedAt:  string | null;
  dispatchedAt: string | null;
  receivedAt:  string | null;
};

type Branch = { id: string; code: string; name: string };

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
  toBranchReorderPoint: number;
  fromBranchStockOnHand: number;
  fromBranchReorderPoint: number;
  estimatedPurchaseCostAvoided: number | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  message: string;
  warnings: string[];
};

type TransferLineForm = { productId: string; quantity: string };

/* ─── Helpers ─── */

function getErr(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const NIO = new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" });

/* ─── Status Badge ─── */

const STATUS_CFG: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT:              { bg: "bg-[var(--color-warning-100)]",  text: "text-[var(--color-warning-700)]",  label: "Borrador"       },
  APPROVED:           { bg: "bg-[var(--color-success-50)]",   text: "text-[var(--color-success-700)]",  label: "Aprobado"       },
  IN_TRANSIT:         { bg: "bg-[var(--color-info-50)]",      text: "text-[var(--color-info-700)]",     label: "En Tránsito"    },
  PARTIALLY_RECEIVED: { bg: "bg-blue-50",                     text: "text-blue-800",                    label: "Parc. Recibido" },
  RECEIVED:           { bg: "bg-[var(--color-success-50)]",   text: "text-emerald-800",                 label: "Recibido"       },
  CANCELLED:          { bg: "bg-[var(--color-danger-50)]",    text: "text-[var(--color-danger-700)]",   label: "Cancelado"      },
  REJECTED:           { bg: "bg-[var(--color-danger-50)]",    text: "text-[var(--color-danger-700)]",   label: "Rechazado"      },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? { bg: "bg-[var(--color-surface-alt)]", text: "text-[var(--color-text)]", label: status };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

/* ─── Priority Badge ─── */

const PRIORITY_CFG: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  LOW:    { bg: "bg-slate-100",                   text: "text-slate-600",                   dot: "bg-slate-400",                   label: "Baja"    },
  MEDIUM: { bg: "bg-[var(--color-info-50)]",      text: "text-[var(--color-info-700)]",     dot: "bg-[var(--color-info-400)]",     label: "Media"   },
  HIGH:   { bg: "bg-[var(--color-warning-100)]",  text: "text-[var(--color-warning-700)]",  dot: "bg-[var(--color-warning-500)]",  label: "Alta"    },
  URGENT: { bg: "bg-[var(--color-danger-50)]",    text: "text-[var(--color-danger-700)]",   dot: "bg-[var(--color-danger-500)]",   label: "Urgente" },
};

function PriorityBadge({ priority }: { priority: TransferOpportunity["priority"] }) {
  const c = PRIORITY_CFG[priority] ?? PRIORITY_CFG.LOW;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${c.bg} ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

/* ─── Opportunity Card ─── */

function OpportunityCard({ opp, onAdd }: { opp: TransferOpportunity; onAdd: (o: TransferOpportunity) => void }) {
  const originCode = opp.fromBranchName.split(" - ")[0] ?? opp.fromBranchName;
  const destCode   = opp.toBranchName.split(" - ")[0]   ?? opp.toBranchName;
  return (
    <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-[var(--color-text)] leading-tight line-clamp-2">{opp.name}</p>
          <span className="hm-chip hm-chip-info text-[10px] mt-1 inline-block">{opp.sku}</span>
        </div>
        <PriorityBadge priority={opp.priority} />
      </div>

      <div className="flex items-stretch gap-2">
        <div className="flex-1 rounded-lg bg-blue-50 border border-blue-100 px-2.5 py-2 text-center">
          <p className="text-[10px] font-bold uppercase text-blue-500 mb-0.5">Origen</p>
          <p className="font-bold text-blue-800 text-sm">{originCode}</p>
          <p className="text-blue-600 tabular-nums font-semibold text-xs">{Number(opp.fromBranchStockOnHand).toFixed(0)} uds</p>
        </div>
        <div className="flex items-center">
          <ArrowRight className="h-4 w-4 text-[var(--color-text-muted)]" />
        </div>
        <div className="flex-1 rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-2 text-center">
          <p className="text-[10px] font-bold uppercase text-emerald-500 mb-0.5">Destino</p>
          <p className="font-bold text-emerald-800 text-sm">{destCode}</p>
          <p className="text-emerald-600 tabular-nums font-semibold text-xs">{Number(opp.toBranchStockOnHand).toFixed(0)} uds</p>
        </div>
      </div>

      <div className="rounded-lg bg-[var(--color-surface-alt)] px-3 py-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)] mb-0.5">Cantidad sugerida</p>
          <p className="text-lg font-extrabold text-[var(--color-master-700)] tabular-nums">
            {Math.ceil(Number(opp.suggestedTransferQty))}
            <span className="text-sm font-normal text-[var(--color-text-muted)] ml-1">uds</span>
          </p>
        </div>
        {opp.estimatedPurchaseCostAvoided != null && Number(opp.estimatedPurchaseCostAvoided) > 0 && (
          <div className="text-right">
            <p className="text-[10px] text-[var(--color-text-muted)]">Ahorro est.</p>
            <p className="text-xs font-bold text-[var(--color-success-700)]">{NIO.format(Number(opp.estimatedPurchaseCostAvoided))}</p>
          </div>
        )}
      </div>

      {opp.message && (
        <p className="text-[11px] text-[var(--color-text-secondary)] italic leading-snug">{opp.message}</p>
      )}

      <button
        onClick={() => onAdd(opp)}
        className="w-full rounded-lg bg-[var(--color-master-600)] py-2 text-xs font-bold text-white hover:bg-[var(--color-master-700)] transition-colors flex items-center justify-center gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" />
        Crear envío desde esta sugerencia
      </button>
    </div>
  );
}

/* ─── Status accent bar ─── */

function statusAccentClass(status: string) {
  switch (status) {
    case "DRAFT":              return "bg-[var(--color-warning-400)]";
    case "APPROVED":           return "bg-[var(--color-success-400)]";
    case "IN_TRANSIT":         return "bg-[var(--color-info-400)]";
    case "PARTIALLY_RECEIVED": return "bg-blue-400";
    case "RECEIVED":           return "bg-emerald-500";
    default:                   return "bg-[var(--color-danger-400)]";
  }
}

/* ─── Main Page ─── */

export default function TransfersPage() {
  const [allTransfers, setAllTransfers]     = useState<Transfer[]>([]);
  const [loading, setLoading]               = useState(true);
  const [filterStatus, setFilterStatus]     = useState<string>("");
  const [actionLoading, setActionLoading]   = useState<string | null>(null);
  const [branches, setBranches]             = useState<Branch[]>([]);
  const [products, setProducts]             = useState<Product[]>([]);

  const [showSuggestions, setShowSuggestions]       = useState(false);
  const [suggestBranchId, setSuggestBranchId]       = useState("");
  const [suggestions, setSuggestions]               = useState<TransferOpportunity[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggPriority, setSuggPriority]             = useState<"ALL" | "HIGH" | "URGENT">("ALL");

  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const [showModal, setShowModal]                 = useState(false);
  const [modalFromBranchId, setModalFromBranchId] = useState("");
  const [modalToBranchId, setModalToBranchId]     = useState("");
  const [modalNotes, setModalNotes]               = useState("");
  const [modalLines, setModalLines]               = useState<TransferLineForm[]>([{ productId: "", quantity: "1" }]);

  /* ── Derived ── */
  const transfers     = filterStatus ? allTransfers.filter((t) => t.status === filterStatus) : allTransfers;
  const draftCount    = allTransfers.filter((t) => t.status === "DRAFT").length;
  const approvedCount = allTransfers.filter((t) => t.status === "APPROVED").length;
  const transitCount  = allTransfers.filter((t) => t.status === "IN_TRANSIT" || t.status === "PARTIALLY_RECEIVED").length;
  const receivedCount = allTransfers.filter((t) => t.status === "RECEIVED").length;

  const filteredSuggestions = suggestions.filter((s) => {
    if (suggPriority === "URGENT") return s.priority === "URGENT";
    if (suggPriority === "HIGH")   return s.priority === "URGENT" || s.priority === "HIGH";
    return true;
  });

  /* ── Fetch ── */
  const fetchTransfers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/master/transfers");
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al cargar envíos");
      const data = unwrapApiData(raw);
      setAllTransfers(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(getErr(error, "Error al cargar envíos"));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMeta = useCallback(async () => {
    try {
      const [bRes, pRes] = await Promise.all([
        fetch("/api/branches"),
        fetch("/api/catalog/products"),
      ]);
      const bData = unwrapApiData(await bRes.json());
      const pData = unwrapApiData(await pRes.json());
      setBranches(Array.isArray(bData) ? bData : []);
      setProducts(Array.isArray(pData) ? pData : []);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchTransfers(); }, [fetchTransfers]);
  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  useEffect(() => {
    if (!suggestBranchId) { setSuggestions([]); return; }
    setSuggestionsLoading(true);
    fetch(`/api/inventory/replenishment/transfers?branchId=${suggestBranchId}`)
      .then((r) => r.json())
      .then((json) => {
        const data = unwrapApiData(json);
        setSuggestions(Array.isArray(data?.opportunities) ? data.opportunities : []);
      })
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false));
  }, [suggestBranchId]);

  /* ── Modal helpers ── */
  const openCreate = () => {
    setModalFromBranchId(branches[0]?.id || "");
    setModalToBranchId(branches[1]?.id || "");
    setModalNotes("");
    setModalLines([{ productId: "", quantity: "1" }]);
    setSelectedTransfer(null);
    setShowModal(true);
  };

  const openFromSuggestion = (opp: TransferOpportunity) => {
    setModalFromBranchId(opp.fromBranchId);
    setModalToBranchId(suggestBranchId);
    setModalNotes("");
    setModalLines([{ productId: opp.productId, quantity: String(Math.ceil(Number(opp.suggestedTransferQty))) }]);
    setSelectedTransfer(null);
    setShowModal(true);
  };

  const addModalLine    = () => setModalLines((prev) => [...prev, { productId: "", quantity: "1" }]);
  const removeModalLine = (i: number) => setModalLines((prev) => prev.filter((_, idx) => idx !== i));
  const updateModalLine = (i: number, field: keyof TransferLineForm, value: string) =>
    setModalLines((prev) => { const next = [...prev]; next[i] = { ...next[i], [field]: value }; return next; });

  const openDetail = (t: Transfer) => {
    setSelectedTransfer(t);
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  /* ── Actions ── */
  const handleCreate = async () => {
    try {
      setActionLoading("create");
      const lines = modalLines.filter((l) => l.productId).map((l) => ({
        productId: l.productId,
        quantity: parseFloat(l.quantity) || 0,
      }));
      if (!modalFromBranchId || !modalToBranchId) throw new Error("Seleccione origen y destino");
      if (modalFromBranchId === modalToBranchId)  throw new Error("Origen y destino deben ser diferentes");
      if (!lines.length) throw new Error("Agregue al menos una línea de producto");
      const res = await apiFetch("/api/master/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromBranchId: modalFromBranchId, toBranchId: modalToBranchId, notes: modalNotes || undefined, lines }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al crear envío");
      toast.success("Envío creado exitosamente");
      setShowModal(false);
      fetchTransfers();
    } catch (error) {
      toast.error(getErr(error, "Error al crear envío"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = async (id: string) => {
    if (!confirm("¿Aprobar este envío? El inventario se descontará al despacharlo.")) return;
    try {
      setActionLoading(id);
      const res = await apiFetch(`/api/master/transfers/${id}/approve`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? e.message ?? "Error al aprobar"); }
      toast.success("Envío aprobado");
      fetchTransfers();
      setSelectedTransfer(null);
    } catch (error) { toast.error(getErr(error, "Error al aprobar")); }
    finally { setActionLoading(null); }
  };

  const handleDispatch = async (id: string) => {
    if (!confirm("¿Despachar este envío? Se descontará stock de la sucursal origen.")) return;
    try {
      setActionLoading(id);
      const res = await apiFetch(`/api/master/transfers/${id}/dispatch`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? e.message ?? "Error al despachar"); }
      toast.success("Envío despachado — stock descontado");
      fetchTransfers();
      setSelectedTransfer(null);
    } catch (error) { toast.error(getErr(error, "Error al despachar")); }
    finally { setActionLoading(null); }
  };

  const handleReceive = async (id: string) => {
    if (!confirm("¿Confirmar recepción? Se ingresará stock a la sucursal destino.")) return;
    try {
      setActionLoading(id);
      const res = await apiFetch(`/api/master/transfers/${id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateBranchCost: true }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al recibir");
      toast.success("Recepción confirmada — stock actualizado");
      fetchTransfers();
      setSelectedTransfer(null);
    } catch (error) { toast.error(getErr(error, "Error al recibir")); }
    finally { setActionLoading(null); }
  };

  const handleCancel = async (id: string) => {
    if (!confirm("¿Cancelar este envío?")) return;
    try {
      setActionLoading(id);
      const res = await apiFetch(`/api/master/transfers/${id}/cancel`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? e.message ?? "Error al cancelar"); }
      toast.success("Envío cancelado");
      fetchTransfers();
      setSelectedTransfer(null);
    } catch (error) { toast.error(getErr(error, "Error al cancelar")); }
    finally { setActionLoading(null); }
  };

  /* ── Render ── */
  return (
    <section className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="h-8 w-1 rounded-full flex-shrink-0"
            style={{ background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))" }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Envíos entre Sucursales</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Gestión y aprobación de traslados de mercadería.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowSuggestions((v) => {
                if (!v && !suggestBranchId && branches.length > 0) setSuggestBranchId(branches[0].id);
                return !v;
              });
            }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
              showSuggestions
                ? "bg-[var(--color-master-50)] border-[var(--color-master-300)] text-[var(--color-master-700)]"
                : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
            }`}
          >
            <Sparkles className="h-4 w-4" />
            Sugerencias
          </button>
          <button onClick={fetchTransfers} className="hm-icon-btn" title="Actualizar lista">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Crear Envío
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Borradores",  value: draftCount,    border: "border-[var(--color-warning-200)]",  bar: "bg-[var(--color-warning-400)]",  iconBg: "bg-[var(--color-warning-100)]",  iconColor: "text-[var(--color-warning-700)]",  num: "text-[var(--color-warning-700)]",  icon: <FileText className="h-4 w-4" />    },
          { label: "Aprobados",   value: approvedCount,  border: "border-[var(--color-success-200)]",  bar: "bg-[var(--color-success-400)]",  iconBg: "bg-[var(--color-success-100)]",  iconColor: "text-[var(--color-success-700)]",  num: "text-[var(--color-success-700)]",  icon: <CheckCircle className="h-4 w-4" /> },
          { label: "En Tránsito", value: transitCount,   border: "border-[var(--color-info-200)]",     bar: "bg-[var(--color-info-400)]",     iconBg: "bg-[var(--color-info-100)]",     iconColor: "text-[var(--color-info-700)]",     num: "text-[var(--color-info-700)]",     icon: <Truck className="h-4 w-4" />       },
          { label: "Recibidos",   value: receivedCount,  border: "border-[var(--color-master-200)]",   bar: "bg-[var(--color-master-400)]",   iconBg: "bg-[var(--color-master-100)]",   iconColor: "text-[var(--color-master-700)]",   num: "text-[var(--color-master-700)]",   icon: <Package className="h-4 w-4" />     },
        ].map((k) => (
          <div key={k.label} className={`hm-kpi-tile relative border ${k.border} overflow-hidden`}>
            <div className={`absolute top-0 left-0 right-0 h-0.5 ${k.bar}`} />
            <div className="flex items-center justify-between mb-2 pt-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{k.label}</span>
              <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${k.iconBg} ${k.iconColor}`}>{k.icon}</span>
            </div>
            <p className={`hm-num-xl ${k.num}`}>{loading ? "–" : k.value}</p>
          </div>
        ))}
      </div>

      {/* Suggestions Panel */}
      {showSuggestions && (
        <div className="rounded-xl border border-[var(--color-master-200)] bg-[var(--color-master-50)] overflow-hidden">
          <div className="px-5 py-3 flex items-center gap-3 border-b border-[var(--color-master-200)]">
            <Sparkles className="h-5 w-5 text-[var(--color-master-600)] flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="font-bold text-[var(--color-master-800)]">Sugerencias de Reabastecimiento</h2>
              <p className="text-xs text-[var(--color-master-600)]">Basadas en niveles de stock y puntos de reorden por sucursal</p>
            </div>
            <button onClick={() => setShowSuggestions(false)} className="ml-auto hm-icon-btn flex-shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm font-semibold text-[var(--color-master-800)] flex items-center gap-1.5 flex-shrink-0">
                <Building2 className="h-4 w-4" />
                Sucursal a reponer:
              </label>
              <select
                value={suggestBranchId}
                onChange={(e) => setSuggestBranchId(e.target.value)}
                className="rounded-lg border border-[var(--color-master-300)] bg-white px-3 py-1.5 text-sm text-[var(--color-text)] min-w-[200px] focus:outline-none focus:border-[var(--color-master-500)]"
              >
                <option value="">Seleccionar sucursal...</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
              {suggestions.length > 0 && (
                <div className="flex gap-1 ml-auto">
                  {(["ALL", "HIGH", "URGENT"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setSuggPriority(p)}
                      className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                        suggPriority === p
                          ? "bg-[var(--color-master-600)] text-white"
                          : "bg-white border border-[var(--color-master-200)] text-[var(--color-master-700)] hover:bg-[var(--color-master-100)]"
                      }`}
                    >
                      {p === "ALL" ? "Todas" : p === "HIGH" ? "Alta+" : "Urgentes"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {suggestionsLoading ? (
              <div className="flex items-center justify-center py-8 gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--color-master-500)]" />
                <span className="text-sm text-[var(--color-master-700)]">Analizando inventario...</span>
              </div>
            ) : !suggestBranchId ? (
              <div className="py-8 text-center text-sm text-[var(--color-master-700)] opacity-60">
                Selecciona una sucursal destino para ver las oportunidades de reabastecimiento.
              </div>
            ) : filteredSuggestions.length === 0 ? (
              <div className="py-8 text-center">
                <Package className="h-8 w-8 mx-auto text-[var(--color-master-400)] mb-2" />
                <p className="text-sm font-semibold text-[var(--color-master-700)]">Sin sugerencias de transferencia</p>
                <p className="text-xs text-[var(--color-master-600)] mt-1">
                  {suggestions.length > 0 ? "Ninguna coincide con el filtro seleccionado." : "El inventario está balanceado o no hay excedentes disponibles."}
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-xs text-[var(--color-master-700)]">
                  <span className="font-semibold">{filteredSuggestions.length} oportunidades identificadas</span>
                  {filteredSuggestions.filter((s) => s.priority === "URGENT").length > 0 && (
                    <span className="font-bold text-[var(--color-danger-700)]">
                      — {filteredSuggestions.filter((s) => s.priority === "URGENT").length} urgentes
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {filteredSuggestions.map((opp) => (
                    <OpportunityCard
                      key={`${opp.fromBranchId}-${opp.productId}`}
                      opp={opp}
                      onAdd={openFromSuggestion}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Filter Pills */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { key: "",                   label: "Todos",        count: allTransfers.length },
          { key: "DRAFT",              label: "Borradores",   count: draftCount },
          { key: "APPROVED",           label: "Aprobados",    count: approvedCount },
          { key: "IN_TRANSIT",         label: "En Tránsito",  count: transitCount },
          { key: "PARTIALLY_RECEIVED", label: "Parciales",    count: allTransfers.filter((t) => t.status === "PARTIALLY_RECEIVED").length },
          { key: "RECEIVED",           label: "Recibidos",    count: receivedCount },
          { key: "CANCELLED",          label: "Cancelados",   count: allTransfers.filter((t) => t.status === "CANCELLED").length },
        ].map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setFilterStatus(key)}
            className={filterStatus === key ? "erp-tabs-pill erp-tabs-pill-active" : "erp-tabs-pill"}
          >
            {label}
            {!loading && count > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                filterStatus === key ? "bg-white/25 text-white" : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"
              }`}>{count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Transfers Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" />
          <span className="text-sm text-[var(--color-text-muted)]">Cargando envíos...</span>
        </div>
      ) : transfers.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center">
          <div className="hm-icon-wrap-md mx-auto mb-3">
            <Truck className="h-6 w-6 text-[var(--color-text-muted)]" />
          </div>
          <p className="font-semibold text-[var(--color-text-secondary)]">
            No hay envíos{filterStatus ? ` con estado "${STATUS_CFG[filterStatus]?.label ?? filterStatus}"` : " registrados"}.
          </p>
          {!filterStatus && (
            <button onClick={openCreate} className="mt-3 text-sm text-[var(--color-master-600)] hover:underline font-medium">
              Crear el primer envío →
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
          <div className="hm-card-header-blue px-5 py-3 flex items-center gap-2">
            <Truck className="h-5 w-5" />
            <h2 className="font-semibold">Listado de Envíos</h2>
            <span className="ml-auto text-xs opacity-80 tabular-nums">{transfers.length} registros</span>
          </div>
          <div className="overflow-x-auto">
            <table className="hm-table">
              <thead>
                <tr>
                  <th>Envío</th>
                  <th>Ruta</th>
                  <th>Estado</th>
                  <th>Líneas</th>
                  <th>Creado</th>
                  <th className="text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => openDetail(t)}
                    className={`border-b border-[var(--color-border)] cursor-pointer transition-colors ${
                      selectedTransfer?.id === t.id
                        ? "bg-[var(--color-master-50)]"
                        : "hover:bg-[var(--color-surface-alt)]"
                    }`}
                  >
                    <td className="font-mono text-xs font-bold text-[var(--color-text)]">{t.transferNumber}</td>
                    <td>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">{t.fromBranch.code}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100">{t.toBranch.code}</span>
                      </span>
                    </td>
                    <td><StatusBadge status={t.status} /></td>
                    <td className="text-xs text-[var(--color-text-secondary)]">
                      <span className="inline-flex items-center gap-1"><Package className="h-3.5 w-3.5" />{t.lines.length}</span>
                    </td>
                    <td className="text-xs text-[var(--color-text-secondary)] tabular-nums">{fmtDateTime(t.createdAt)}</td>
                    <td className="text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openDetail(t)} className="hm-icon-btn text-[var(--color-info-600)]" title="Ver detalle">
                          <Eye className="h-4 w-4" />
                        </button>
                        {t.status === "DRAFT" && (
                          <>
                            <button
                              onClick={() => handleApprove(t.id)}
                              disabled={actionLoading === t.id}
                              className="hm-icon-btn text-[var(--color-success-600)] hover:bg-[var(--color-success-50)] disabled:opacity-50"
                              title="Aprobar"
                            >
                              {actionLoading === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                            </button>
                            <button
                              onClick={() => handleCancel(t.id)}
                              disabled={actionLoading === t.id}
                              className="hm-icon-btn text-[var(--color-danger-600)] hover:bg-[var(--color-danger-50)] disabled:opacity-50"
                              title="Cancelar"
                            >
                              <Ban className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {t.status === "APPROVED" && (
                          <>
                            <button
                              onClick={() => handleDispatch(t.id)}
                              disabled={actionLoading === t.id}
                              className="hm-icon-btn text-[var(--color-info-700)] hover:bg-[var(--color-info-50)] disabled:opacity-50"
                              title="Despachar"
                            >
                              {actionLoading === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </button>
                            <button
                              onClick={() => handleCancel(t.id)}
                              disabled={actionLoading === t.id}
                              className="hm-icon-btn text-[var(--color-danger-600)] hover:bg-[var(--color-danger-50)] disabled:opacity-50"
                              title="Cancelar"
                            >
                              <Ban className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {(t.status === "IN_TRANSIT" || t.status === "PARTIALLY_RECEIVED") && (
                          <button
                            onClick={() => handleReceive(t.id)}
                            disabled={actionLoading === t.id}
                            className="hm-icon-btn text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                            title="Confirmar recepción"
                          >
                            {actionLoading === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Panel */}
      {selectedTransfer && (
        <div ref={detailRef} className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-lg">
          <div className={`h-1 ${statusAccentClass(selectedTransfer.status)}`} />
          <div className="hm-card-header-purple px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-5 w-5 flex-shrink-0" />
              <h2 className="font-bold truncate">Envío {selectedTransfer.transferNumber}</h2>
              <StatusBadge status={selectedTransfer.status} />
            </div>
            <button onClick={() => setSelectedTransfer(null)} className="text-white/80 hover:text-white transition-colors ml-2 flex-shrink-0">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            {/* Route cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
                <p className="text-xs font-bold uppercase text-blue-500 mb-1 flex items-center gap-1"><Building2 className="h-3 w-3" />Origen</p>
                <p className="font-bold text-[var(--color-text)]">{selectedTransfer.fromBranch.code}</p>
                <p className="text-xs text-blue-700 mt-0.5">{selectedTransfer.fromBranch.name}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                <p className="text-xs font-bold uppercase text-emerald-500 mb-1 flex items-center gap-1"><Building2 className="h-3 w-3" />Destino</p>
                <p className="font-bold text-[var(--color-text)]">{selectedTransfer.toBranch.code}</p>
                <p className="text-xs text-emerald-700 mt-0.5">{selectedTransfer.toBranch.name}</p>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                <p className="text-xs font-bold uppercase text-slate-500 mb-1">Solicitado por</p>
                <p className="font-semibold text-[var(--color-text)] text-sm">
                  {selectedTransfer.requestedBy.fullName || selectedTransfer.requestedBy.username}
                </p>
                {selectedTransfer.approvedBy && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    Aprobado: {selectedTransfer.approvedBy.fullName || selectedTransfer.approvedBy.username}
                  </p>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4">
              <p className="text-xs font-bold uppercase text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />Línea de Tiempo
              </p>
              <div className="flex flex-wrap gap-x-8 gap-y-3">
                {[
                  { label: "Creado",     ts: selectedTransfer.createdAt,    show: true  },
                  { label: "Aprobado",   ts: selectedTransfer.approvedAt,   show: !!selectedTransfer.approvedAt   },
                  { label: "Despachado", ts: selectedTransfer.dispatchedAt, show: !!selectedTransfer.dispatchedAt },
                  { label: "Recibido",   ts: selectedTransfer.receivedAt,   show: !!selectedTransfer.receivedAt   },
                ].filter((item) => item.show).map(({ label, ts }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full flex-shrink-0 ${ts ? "bg-[var(--color-success-500)]" : "bg-[var(--color-border-strong)]"}`} />
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
                      <p className="text-xs text-[var(--color-text-secondary)] tabular-nums">{ts ? fmtDateTime(ts) : "—"}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedTransfer.notes && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm flex items-start gap-2">
                <FileText className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <span className="text-[var(--color-text-secondary)]">{selectedTransfer.notes}</span>
              </div>
            )}

            {/* Lines table */}
            <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
              <table className="hm-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>SKU</th>
                    <th className="text-right">Solicitada</th>
                    <th className="text-right">Enviada</th>
                    <th className="text-right">Recibida</th>
                    <th className="text-right">Costo Unit.</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTransfer.lines.map((line, i) => {
                    const qReq = Number(line.quantityRequested);
                    const qDis = Number(line.quantityDispatched);
                    const qRec = Number(line.quantityReceived);
                    const cost = Number(line.unitCostSnapshot);
                    return (
                      <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                        <td className="font-medium text-[var(--color-text)] text-sm">{line.product.name}</td>
                        <td className="font-mono text-xs text-[var(--color-text-muted)]">{line.product.sku}</td>
                        <td className="text-right font-mono font-semibold tabular-nums">{qReq}</td>
                        <td className={`text-right font-mono tabular-nums ${qDis > 0 && qDis < qReq ? "text-[var(--color-warning-700)]" : qDis >= qReq ? "text-[var(--color-success-700)]" : "text-[var(--color-text-muted)]"}`}>
                          {qDis > 0 ? qDis : "—"}
                        </td>
                        <td className={`text-right font-mono tabular-nums ${qRec > 0 && qRec < qReq ? "text-[var(--color-warning-700)]" : qRec >= qReq ? "text-[var(--color-success-700)]" : "text-[var(--color-text-muted)]"}`}>
                          {qRec > 0 ? qRec : "—"}
                        </td>
                        <td className="text-right text-xs font-mono tabular-nums text-[var(--color-text-secondary)]">
                          {cost > 0 ? NIO.format(cost) : <span className="text-[var(--color-text-muted)]">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Action buttons */}
            {["DRAFT", "APPROVED", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(selectedTransfer.status) && (
              <div className="flex flex-wrap gap-3 pt-1 border-t border-[var(--color-border)]">
                {selectedTransfer.status === "DRAFT" && (
                  <>
                    <button
                      onClick={() => handleApprove(selectedTransfer.id)}
                      disabled={!!actionLoading}
                      className="flex items-center gap-2 rounded-lg bg-[var(--color-success-600)] px-5 py-2.5 text-sm font-bold text-white hover:bg-[var(--color-success-700)] shadow-sm transition-all disabled:opacity-50"
                    >
                      {actionLoading === selectedTransfer.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                      Aprobar Envío
                    </button>
                    <button
                      onClick={() => handleCancel(selectedTransfer.id)}
                      disabled={!!actionLoading}
                      className="flex items-center gap-2 rounded-lg border border-[var(--color-danger-300)] px-5 py-2.5 text-sm font-semibold text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)] transition-all disabled:opacity-50"
                    >
                      <Ban className="h-4 w-4" /> Cancelar Envío
                    </button>
                  </>
                )}
                {selectedTransfer.status === "APPROVED" && (
                  <>
                    <button
                      onClick={() => handleDispatch(selectedTransfer.id)}
                      disabled={!!actionLoading}
                      className="flex items-center gap-2 rounded-lg bg-[var(--color-info-700)] px-5 py-2.5 text-sm font-bold text-white hover:bg-[var(--color-info-800)] shadow-sm transition-all disabled:opacity-50"
                    >
                      {actionLoading === selectedTransfer.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Despachar Envío
                    </button>
                    <button
                      onClick={() => handleCancel(selectedTransfer.id)}
                      disabled={!!actionLoading}
                      className="flex items-center gap-2 rounded-lg border border-[var(--color-danger-300)] px-5 py-2.5 text-sm font-semibold text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)] transition-all disabled:opacity-50"
                    >
                      <Ban className="h-4 w-4" /> Cancelar
                    </button>
                  </>
                )}
                {(selectedTransfer.status === "IN_TRANSIT" || selectedTransfer.status === "PARTIALLY_RECEIVED") && (
                  <button
                    onClick={() => handleReceive(selectedTransfer.id)}
                    disabled={!!actionLoading}
                    className="flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 shadow-sm transition-all disabled:opacity-50"
                  >
                    {actionLoading === selectedTransfer.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                    Confirmar Recepción
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto pt-8 pb-8 px-4">
          <div className="w-full max-w-2xl rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border-strong)] shadow-2xl">
            <div className="hm-card-header-blue px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-base font-bold flex items-center gap-2">
                <Send className="h-5 w-5" />
                Nuevo Envío entre Sucursales
              </h2>
              <button onClick={() => setShowModal(false)} className="text-white/80 hover:text-white transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-[var(--color-text-secondary)] mb-1.5">
                    <Building2 className="h-3.5 w-3.5 inline mr-1 text-blue-600" />Sucursal Origen
                  </label>
                  <select
                    value={modalFromBranchId}
                    onChange={(e) => setModalFromBranchId(e.target.value)}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-master-400)]"
                  >
                    <option value="">Seleccionar...</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[var(--color-text-secondary)] mb-1.5">
                    <Building2 className="h-3.5 w-3.5 inline mr-1 text-emerald-600" />Sucursal Destino
                  </label>
                  <select
                    value={modalToBranchId}
                    onChange={(e) => setModalToBranchId(e.target.value)}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-master-400)]"
                  >
                    <option value="">Seleccionar...</option>
                    {branches.filter((b) => b.id !== modalFromBranchId).map((b) => (
                      <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-secondary)] mb-1.5">
                  <FileText className="h-3.5 w-3.5 inline mr-1" />Notas (opcional)
                </label>
                <textarea
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                  rows={2}
                  placeholder="Instrucciones adicionales..."
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] resize-none focus:outline-none focus:border-[var(--color-master-400)]"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-1.5">
                    <Package className="h-4 w-4 text-[var(--color-master-600)]" />
                    Productos a Transferir
                  </h3>
                  <button
                    onClick={addModalLine}
                    className="flex items-center gap-1 text-xs font-semibold text-[var(--color-master-600)] hover:text-[var(--color-master-700)] transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" /> Agregar línea
                  </button>
                </div>
                <div className="space-y-2">
                  {modalLines.map((line, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-8">
                        {idx === 0 && <label className="block text-xs text-[var(--color-text-muted)] mb-1">Producto</label>}
                        <select
                          value={line.productId}
                          onChange={(e) => updateModalLine(idx, "productId", e.target.value)}
                          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-master-400)]"
                        >
                          <option value="">Seleccionar producto...</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                        </select>
                      </div>
                      <div className="col-span-3">
                        {idx === 0 && <label className="block text-xs text-[var(--color-text-muted)] mb-1">Cantidad</label>}
                        <input
                          type="number"
                          min="0.01"
                          step="1"
                          value={line.quantity}
                          onChange={(e) => updateModalLine(idx, "quantity", e.target.value)}
                          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-master-400)]"
                        />
                      </div>
                      <div className="col-span-1 flex items-center justify-center pb-0.5">
                        {modalLines.length > 1 && (
                          <button onClick={() => removeModalLine(idx)} className="hm-icon-btn text-[var(--color-danger-600)]">
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-[var(--color-border)]">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex items-center gap-2 rounded-lg border border-[var(--color-border-strong)] px-4 py-2.5 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] transition-colors"
                >
                  <X className="h-4 w-4" /> Cancelar
                </button>
                <button
                  onClick={handleCreate}
                  disabled={actionLoading === "create"}
                  className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-6 py-2.5 text-sm font-bold text-white hover:bg-[var(--color-master-700)] shadow-md hover:shadow-lg transition-all disabled:opacity-50"
                >
                  {actionLoading === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Crear Envío
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
