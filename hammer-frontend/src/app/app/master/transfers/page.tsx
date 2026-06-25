"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import {
  Truck, Plus, CheckCircle, Loader2, ArrowRight, X,
  Package, Building2, FileText, Eye, Send, Ban, Sparkles,
  RefreshCw, Clock, Search, Star, ShoppingCart, TrendingDown,
  AlertTriangle, BarChart2, Settings, Layers, ArrowLeftRight,
  ShieldAlert, ChevronDown, Factory, ClipboardList, ThumbsUp,
  MinusCircle, Save, ChevronRight, BadgeCheck,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/format";

/* ─── Shared Types ─── */

type Product = { id: string; sku: string; name: string; unit: string };

type Branch = { id: string; code: string; name: string; isDefaultSupplier?: boolean };

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

type ReplenishmentCriticality = "CRITICAL" | "LOW" | "PREVENTIVE" | "OBSERVE" | "NORMAL" | "DO_NOT_RECOMMEND" | "MANUAL_REVIEW";

type SourceOption = {
  type: "CENTRAL" | "OTHER_BRANCH" | "SUPPLIER" | "PRODUCTION" | "DO_NOT_REPLENISH" | "MANUAL_REVIEW";
  branchId?: string;
  branchName?: string;
  availableStock?: number;
  suggestedQuantity?: number;
  reason: string;
};

type Recommendation = {
  productId: string;
  sku: string;
  name: string;
  categoryId?: string | null;
  categoryName?: string | null;
  branchId: string;
  stockOnHand: number;
  availableStock: number;
  unitsSoldLast30Days: number;
  unitsSoldLast60Days: number;
  unitsSoldLast90Days: number;
  averageDailyDemand: number;
  lastSoldAt: string | null;
  abcClass: string;
  xyzClass: string;
  combinedClass: string;
  reorderPoint: number;
  targetStock: number;
  suggestedOrderQty: number;
  effectiveCost: number | null;
  estimatedPurchaseCost: number | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  criticality: ReplenishmentCriticality;
  recommendationType: string;
  recommendedSource: SourceOption["type"];
  sourceOptions: SourceOption[];
  message: string;
  warnings: string[];
  hasProductionRecipe: boolean;
};

type RecommendationSummary = {
  criticalCount: number;
  lowCount: number;
  preventiveCount: number;
  urgentCount: number;
  timberAlert?: { totalCount: number; zeroStockCount: number; lowStockItems: Array<{ productId: string; name: string; sku: string; stockOnHand: number }> };
  buyCount: number;
  transferInCount: number;
  estimatedTotalPurchaseCost: number;
};

type DraftItem = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  categoryName: string | null;
  currentStock: number;
  salesLast30Days: number;
  salesLast60Days: number;
  salesLast90Days: number;
  criticality: string;
  recommendedSource: string;
  suggestedQuantity: number;
  finalQuantity: number | null;
  reason: string;
  warnings: string[];
  requiresManualReview: boolean;
  status: string;
  linkedTransferId: string | null;
  linkedPurchaseOrderId: string | null;
  notes: string | null;
};

type DraftType = {
  id: string;
  branchId: string;
  branchName: string;
  status: string;
  includePreventive: boolean;
  generatedAt: string;
  createdAt: string;
  approvedAt: string | null;
  convertedAt: string | null;
  createdBy: { id: string; fullName: string; username: string };
  approvedBy: { id: string; fullName: string; username: string } | null;
  summary: {
    total: number;
    criticalCount: number;
    lowCount: number;
    preventiveCount: number;
    pendingCount: number;
    approvedCount: number;
    ignoredCount: number;
    manualReviewCount: number;
  };
  items: DraftItem[];
};

/* ─── Helpers ─── */

function getErr(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const NIO = new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" });

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-NI", { day: "2-digit", month: "short", year: "2-digit" });
}

/* ─── Criticality Badge ─── */

const CRITICALITY_CFG: Record<ReplenishmentCriticality, { bg: string; text: string; label: string; dot: string }> = {
  CRITICAL:         { bg: "bg-red-100",    text: "text-red-700",    dot: "bg-red-500",    label: "CRÍTICO"     },
  LOW:              { bg: "bg-orange-100", text: "text-orange-700", dot: "bg-orange-500", label: "BAJO STOCK"  },
  PREVENTIVE:       { bg: "bg-yellow-100", text: "text-yellow-700", dot: "bg-yellow-500", label: "PREVENTIVO"  },
  OBSERVE:          { bg: "bg-slate-100",  text: "text-slate-600",  dot: "bg-slate-400",  label: "OBSERVAR"    },
  NORMAL:           { bg: "bg-green-100",  text: "text-green-700",  dot: "bg-green-500",  label: "NORMAL"      },
  DO_NOT_RECOMMEND: { bg: "bg-gray-100",   text: "text-gray-500",   dot: "bg-gray-400",   label: "NO REPONER"  },
  MANUAL_REVIEW:    { bg: "bg-purple-100", text: "text-purple-700", dot: "bg-purple-500", label: "REV. MANUAL" },
};

function CriticalityBadge({ criticality }: { criticality: ReplenishmentCriticality }) {
  const c = CRITICALITY_CFG[criticality] ?? CRITICALITY_CFG.NORMAL;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${c.bg} ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
      {c.label}
    </span>
  );
}

/* ─── Source Badge ─── */

const SOURCE_CFG: Record<SourceOption["type"], { bg: string; text: string; label: string }> = {
  CENTRAL:          { bg: "bg-blue-100",   text: "text-blue-700",   label: "Desde Central"  },
  OTHER_BRANCH:     { bg: "bg-sky-100",    text: "text-sky-700",    label: "Traslado"        },
  SUPPLIER:         { bg: "bg-indigo-100", text: "text-indigo-700", label: "Compra"          },
  PRODUCTION:       { bg: "bg-teal-100",   text: "text-teal-700",   label: "Producción"      },
  DO_NOT_REPLENISH: { bg: "bg-gray-100",   text: "text-gray-500",   label: "No reponer"      },
  MANUAL_REVIEW:    { bg: "bg-amber-100",  text: "text-amber-700",  label: "Rev. manual"     },
};

function SourceBadge({ source }: { source: SourceOption["type"] }) {
  const c = SOURCE_CFG[source] ?? SOURCE_CFG.DO_NOT_REPLENISH;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

/* ─── Transfer Status Badge ─── */

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

/* ─── Opportunity Card ─── */

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
        <div className="flex items-center"><ArrowRight className="h-4 w-4 text-[var(--color-text-muted)]" /></div>
        <div className="flex-1 rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-2 text-center">
          <p className="text-[10px] font-bold uppercase text-emerald-500 mb-0.5">Destino</p>
          <p className="font-bold text-emerald-800 text-sm">{destCode}</p>
          <p className="text-emerald-600 tabular-nums font-semibold text-xs">{Number(opp.toBranchStockOnHand).toFixed(0)} uds</p>
        </div>
      </div>
      <div className="rounded-lg bg-[var(--color-surface-alt)] px-3 py-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)] mb-0.5">Qty sugerida</p>
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
      {opp.message && <p className="text-[11px] text-[var(--color-text-secondary)] italic leading-snug">{opp.message}</p>}
      <button
        onClick={() => onAdd(opp)}
        className="w-full rounded-lg bg-[var(--color-master-600)] py-2 text-xs font-bold text-white hover:bg-[var(--color-master-700)] transition-colors flex items-center justify-center gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" /> Crear traslado desde esta sugerencia
      </button>
    </div>
  );
}

/* ───────────────────────────────────────────
   TAB 1 — RECOMENDACIONES
─────────────────────────────────────────── */

/* ─── Draft Item Status Badge ─── */

const DRAFT_ITEM_STATUS_CFG: Record<string, { bg: string; text: string; label: string }> = {
  PENDING_REVIEW:          { bg: "bg-blue-100",   text: "text-blue-700",   label: "Pendiente"        },
  APPROVED:                { bg: "bg-green-100",  text: "text-green-700",  label: "Aprobado"         },
  IGNORED:                 { bg: "bg-gray-100",   text: "text-gray-500",   label: "Ignorado"         },
  QUANTITY_EDITED:         { bg: "bg-yellow-100", text: "text-yellow-700", label: "Qty Editada"      },
  TRANSFER_CREATED:        { bg: "bg-sky-100",    text: "text-sky-700",    label: "Traslado Creado"  },
  PURCHASE_REQUEST_CREATED:{ bg: "bg-indigo-100", text: "text-indigo-700", label: "Compra Creada"    },
  PRODUCTION_ORDER_CREATED:{ bg: "bg-teal-100",   text: "text-teal-700",   label: "Producción"       },
  MANUAL_REVIEW_REQUIRED:  { bg: "bg-purple-100", text: "text-purple-700", label: "Rev. Manual"      },
};

function DraftItemStatusBadge({ status }: { status: string }) {
  const cfg = DRAFT_ITEM_STATUS_CFG[status] ?? { bg: "bg-gray-100", text: "text-gray-500", label: status };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

const DRAFT_STATUS_CFG: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT:                       { bg: "bg-blue-100",   text: "text-blue-700",   label: "Borrador"      },
  REVIEWED:                    { bg: "bg-yellow-100", text: "text-yellow-700", label: "Revisado"      },
  APPROVED:                    { bg: "bg-green-100",  text: "text-green-700",  label: "Aprobado"      },
  PARTIALLY_APPROVED:          { bg: "bg-lime-100",   text: "text-lime-700",   label: "Parcialmente"  },
  CONVERTED_TO_TRANSFER:       { bg: "bg-sky-100",    text: "text-sky-700",    label: "Convertido"    },
  CONVERTED_TO_PURCHASE_REQUEST:{ bg: "bg-indigo-100",text: "text-indigo-700", label: "Convertido"    },
  CONVERTED_TO_PRODUCTION_ORDER:{ bg: "bg-teal-100",  text: "text-teal-700",   label: "Convertido"   },
  CANCELLED:                   { bg: "bg-red-100",    text: "text-red-700",    label: "Cancelado"     },
};

function DraftPanel({
  draft,
  editingQtys,
  savingItem,
  approvingDraft,
  convertingDraft,
  onQtyChange,
  onSaveQty,
  onIgnoreItem,
  onApprove,
  onConvert,
  onClose,
}: {
  draft: DraftType;
  editingQtys: Record<string, string>;
  savingItem: string | null;
  approvingDraft: boolean;
  convertingDraft: boolean;
  onQtyChange: (id: string, val: string) => void;
  onSaveQty: (item: DraftItem) => void;
  onIgnoreItem: (item: DraftItem) => void;
  onApprove: () => void;
  onConvert: () => void;
  onClose: () => void;
}) {
  const statusCfg = DRAFT_STATUS_CFG[draft.status] ?? { bg: "bg-gray-100", text: "text-gray-500", label: draft.status };
  const isEditable = draft.status === "DRAFT" || draft.status === "REVIEWED";
  const canApprove = isEditable && draft.summary.pendingCount === 0;
  const canConvert = draft.status === "APPROVED";
  const isConverted = draft.convertedAt !== null;

  return (
    <div className="rounded-xl border border-[var(--color-master-200)] bg-[var(--color-surface)] shadow-md overflow-hidden">
      {/* Header */}
      <div className="hm-card-header-blue px-5 py-3 flex items-center gap-3">
        <ClipboardList className="h-5 w-5" />
        <span className="font-semibold">Borrador de Reposición</span>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${statusCfg.bg} ${statusCfg.text}`}>
          {statusCfg.label}
        </span>
        <span className="text-xs opacity-75 ml-1">{draft.branchName}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs opacity-75">
            {draft.summary.pendingCount} pendientes · {draft.summary.ignoredCount} ignorados · {draft.summary.manualReviewCount} manuales
          </span>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-white/10 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] px-5 py-3 flex flex-wrap gap-4 text-xs">
        <span className="flex items-center gap-1"><span className="font-bold text-red-600">{draft.summary.criticalCount}</span> <span className="text-[var(--color-text-muted)]">críticos</span></span>
        <span className="flex items-center gap-1"><span className="font-bold text-orange-600">{draft.summary.lowCount}</span> <span className="text-[var(--color-text-muted)]">bajo stock</span></span>
        <span className="flex items-center gap-1"><span className="font-bold text-yellow-600">{draft.summary.preventiveCount}</span> <span className="text-[var(--color-text-muted)]">preventivos</span></span>
        <span className="flex items-center gap-1"><span className="font-bold text-purple-600">{draft.summary.manualReviewCount}</span> <span className="text-[var(--color-text-muted)]">rev. manual</span></span>
        <div className="ml-auto flex gap-2">
          {isEditable && !canApprove && (
            <span className="text-[var(--color-text-muted)] text-[11px] italic flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-yellow-500" />
              {draft.summary.pendingCount} ítem(s) pendientes de revisión
            </span>
          )}
          {isEditable && (
            <button
              onClick={onApprove}
              disabled={approvingDraft || !canApprove}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-40 transition-colors"
            >
              {approvingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}
              Aprobar Borrador
            </button>
          )}
          {canConvert && !isConverted && (
            <button
              onClick={onConvert}
              disabled={convertingDraft}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--color-master-600)] hover:bg-[var(--color-master-700)] text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-40 transition-colors"
            >
              {convertingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Convertir a Traslados/Compras
            </button>
          )}
          {isConverted && (
            <span className="flex items-center gap-1 text-green-700 text-xs font-semibold">
              <CheckCircle className="h-4 w-4" /> Convertido
            </span>
          )}
        </div>
      </div>

      {/* Items Table */}
      <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
        <table className="hm-table">
          <thead className="sticky top-0 z-10">
            <tr>
              <th>Producto</th>
              <th className="text-right">Stock</th>
              <th className="text-right">V.30d</th>
              <th>Criticidad</th>
              <th>Fuente</th>
              <th className="text-right">Sug.</th>
              <th className="text-right">Final</th>
              <th>Estado</th>
              {isEditable && <th className="text-center">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {draft.items.map((item) => {
              const ignored = item.status === "IGNORED";
              const isManual = item.requiresManualReview;
              const savedOrConverted = ["TRANSFER_CREATED", "PURCHASE_REQUEST_CREATED", "PRODUCTION_ORDER_CREATED"].includes(item.status);
              return (
                <tr
                  key={item.id}
                  className={`border-b border-[var(--color-border)] text-sm transition-colors ${
                    ignored ? "opacity-40" : isManual ? "bg-purple-50/40" : ""
                  }`}
                >
                  <td>
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--color-text)] truncate max-w-[180px]">{item.productName}</p>
                      <p className="text-[10px] font-mono text-[var(--color-text-muted)]">{item.sku}</p>
                      {item.categoryName && <p className="text-[10px] text-[var(--color-text-muted)]">{item.categoryName}</p>}
                    </div>
                  </td>
                  <td className={`text-right font-mono tabular-nums text-xs ${item.currentStock === 0 ? "text-red-600 font-bold" : "text-[var(--color-text)]"}`}>
                    {item.currentStock}
                  </td>
                  <td className="text-right font-mono tabular-nums text-xs text-[var(--color-text-secondary)]">{item.salesLast30Days}</td>
                  <td><CriticalityBadge criticality={item.criticality as ReplenishmentCriticality} /></td>
                  <td><SourceBadge source={item.recommendedSource as SourceOption["type"]} /></td>
                  <td className="text-right font-mono tabular-nums text-xs text-[var(--color-text-muted)]">{item.suggestedQuantity}</td>
                  <td className="text-right">
                    {isEditable && !ignored && !savedOrConverted ? (
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={editingQtys[item.id] ?? String(item.finalQuantity ?? item.suggestedQuantity)}
                        onChange={(e) => onQtyChange(item.id, e.target.value)}
                        className={`w-20 rounded border text-right font-mono text-sm px-2 py-0.5 ${
                          isManual ? "border-purple-300 bg-purple-50" : "border-[var(--color-border)]"
                        } focus:outline-none focus:border-[var(--color-master-400)]`}
                      />
                    ) : (
                      <span className="font-mono tabular-nums text-sm">{item.finalQuantity ?? "—"}</span>
                    )}
                  </td>
                  <td><DraftItemStatusBadge status={item.status} /></td>
                  {isEditable && (
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        {!ignored && !savedOrConverted && (
                          <button
                            onClick={() => onSaveQty(item)}
                            disabled={savingItem === item.id}
                            className="hm-icon-btn text-green-600 hover:bg-green-50 disabled:opacity-50"
                            title="Guardar cantidad"
                          >
                            {savingItem === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        {!savedOrConverted && (
                          <button
                            onClick={() => onIgnoreItem(item)}
                            disabled={savingItem === item.id}
                            className={`hm-icon-btn disabled:opacity-50 ${ignored ? "text-blue-600 hover:bg-blue-50" : "text-gray-500 hover:bg-gray-100"}`}
                            title={ignored ? "Restaurar ítem" : "Ignorar ítem"}
                          >
                            {ignored ? <ThumbsUp className="h-3.5 w-3.5" /> : <MinusCircle className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer note for manual review items */}
      {draft.summary.manualReviewCount > 0 && (
        <div className="px-5 py-2 bg-purple-50 border-t border-purple-100 flex items-center gap-2 text-xs text-purple-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {draft.summary.manualReviewCount} producto(s) marcados como Rev. Manual no se convertirán automáticamente — revísalos antes de convertir.
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────
   TAB 1 — RECOMENDACIONES DE REPOSICIÓN
─────────────────────────────────────────── */

function RecommendationsTab({
  branches,
  centralBranchId,
  onCreateTransfer,
}: {
  branches: Branch[];
  centralBranchId: string;
  products: Product[];
  onCreateTransfer: (productId: string, fromBranchId: string, toBranchId: string, qty: number) => void;
}) {
  const [branchId, setBranchId]                   = useState("");
  const [recommendations, setRecommendations]     = useState<Recommendation[]>([]);
  const [summary, setSummary]                     = useState<RecommendationSummary | null>(null);
  const [loading, setLoading]                     = useState(false);
  const [filterCriticality, setFilterCriticality] = useState<ReplenishmentCriticality | "ALL">("ALL");
  const [search, setSearch]                       = useState("");
  const [expandedRow, setExpandedRow]             = useState<string | null>(null);
  const [actionLoading, setActionLoading]         = useState<string | null>(null);

  // Draft state
  const [showDraftOptions, setShowDraftOptions]   = useState(false);
  const [includePreventive, setIncludePreventive] = useState(false);
  const [generatingDraft, setGeneratingDraft]     = useState(false);
  const [currentDraft, setCurrentDraft]           = useState<DraftType | null>(null);
  const [showDraftPanel, setShowDraftPanel]       = useState(false);
  const [editingQtys, setEditingQtys]             = useState<Record<string, string>>({});
  const [savingItem, setSavingItem]               = useState<string | null>(null);
  const [approvingDraft, setApprovingDraft]       = useState(false);
  const [convertingDraft, setConvertingDraft]     = useState(false);

  const loadDraft = useCallback(async (draftId: string) => {
    try {
      const res = await apiFetch(`/api/master/replenishment/drafts/${draftId}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? "Error al cargar borrador");
      setCurrentDraft(unwrapApiData(raw) as DraftType);
    } catch (err) {
      toast.error(getErr(err, "Error al cargar borrador"));
    }
  }, []);

  const handleGenerateDraft = async () => {
    if (!branchId) { toast.error("Selecciona una sucursal primero"); return; }
    setGeneratingDraft(true);
    try {
      const res = await apiFetch("/api/master/replenishment/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, includePreventive }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al generar borrador");
      const draft = unwrapApiData(raw) as DraftType;
      setCurrentDraft(draft);
      setEditingQtys(
        Object.fromEntries(draft.items.map((i) => [i.id, String(i.finalQuantity ?? i.suggestedQuantity)]))
      );
      setShowDraftPanel(true);
      setShowDraftOptions(false);
      toast.success(`Borrador generado: ${draft.summary.total} productos`);
    } catch (err) {
      toast.error(getErr(err, "Error al generar borrador"));
    } finally {
      setGeneratingDraft(false);
    }
  };

  const handleSaveQty = async (item: DraftItem) => {
    if (!currentDraft) return;
    const raw = editingQtys[item.id];
    const qty = parseFloat(raw ?? "");
    if (isNaN(qty) || qty < 0) { toast.error("Cantidad inválida"); return; }
    setSavingItem(item.id);
    try {
      const res = await apiFetch(
        `/api/master/replenishment/drafts/${currentDraft.id}/items/${item.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ finalQuantity: qty }),
        }
      );
      if (!res.ok) throw new Error((await res.json()).error?.message ?? "Error");
      await loadDraft(currentDraft.id);
      toast.success("Cantidad guardada");
    } catch (err) {
      toast.error(getErr(err, "Error al guardar cantidad"));
    } finally {
      setSavingItem(null);
    }
  };

  const handleIgnoreItem = async (item: DraftItem) => {
    if (!currentDraft) return;
    setSavingItem(item.id);
    try {
      const res = await apiFetch(
        `/api/master/replenishment/drafts/${currentDraft.id}/items/${item.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: item.status === "IGNORED" ? "PENDING_REVIEW" : "IGNORED" }),
        }
      );
      if (!res.ok) throw new Error((await res.json()).error?.message ?? "Error");
      await loadDraft(currentDraft.id);
    } catch (err) {
      toast.error(getErr(err, "Error al actualizar ítem"));
    } finally {
      setSavingItem(null);
    }
  };

  const handleApproveDraft = async () => {
    if (!currentDraft) return;
    if (!confirm("¿Aprobar este borrador? Solo se pueden convertir borradores aprobados.")) return;
    setApprovingDraft(true);
    try {
      const res = await apiFetch(
        `/api/master/replenishment/drafts/${currentDraft.id}/approve`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al aprobar");
      await loadDraft(currentDraft.id);
      toast.success("Borrador aprobado");
    } catch (err) {
      toast.error(getErr(err, "Error al aprobar"));
    } finally {
      setApprovingDraft(false);
    }
  };

  const handleConvertDraft = async () => {
    if (!currentDraft) return;
    if (!confirm("¿Convertir borrador? Se crearán traslados y/o pedidos de compra. Esta acción no se puede deshacer.")) return;
    setConvertingDraft(true);
    try {
      const res = await apiFetch(
        `/api/master/replenishment/drafts/${currentDraft.id}/convert`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al convertir");
      const result = unwrapApiData(raw) as { transfersCreated: string[]; purchaseOrdersCreated: string[]; warnings: string[] };
      await loadDraft(currentDraft.id);
      const parts = [];
      if (result.transfersCreated.length) parts.push(`${result.transfersCreated.length} traslado(s)`);
      if (result.purchaseOrdersCreated.length) parts.push(`${result.purchaseOrdersCreated.length} compra(s)`);
      toast.success(`Convertido: ${parts.join(", ") || "procesado"}`, { duration: 6000 });
      if (result.warnings.length) {
        result.warnings.forEach((w) => toast(w, { icon: "⚠️", duration: 8000 }));
      }
    } catch (err) {
      toast.error(getErr(err, "Error al convertir"));
    } finally {
      setConvertingDraft(false);
    }
  };

  const fetchRecommendations = useCallback(async (bid: string) => {
    if (!bid) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/replenishment/recommendations?branchId=${bid}&includeTransferOpportunities=true`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error");
      const data = unwrapApiData(raw);
      setRecommendations(Array.isArray(data?.recommendations) ? data.recommendations : []);
      setSummary(data?.summary ?? null);
    } catch (error) {
      toast.error(getErr(error, "Error al cargar recomendaciones"));
      setRecommendations([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (branchId) fetchRecommendations(branchId);
    else { setRecommendations([]); setSummary(null); }
  }, [branchId, fetchRecommendations]);

  const filtered = recommendations.filter((r) => {
    if (filterCriticality !== "ALL" && r.criticality !== filterCriticality) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q) || (r.categoryName ?? "").toLowerCase().includes(q);
    }
    return true;
  });

  const handleCreatePurchase = async (rec: Recommendation) => {
    if (!confirm(`¿Crear borrador de compra para "${rec.name}" (${rec.suggestedOrderQty} uds)?`)) return;
    setActionLoading(`buy-${rec.productId}`);
    try {
      const res = await apiFetch("/api/inventory/replenishment/create-purchase-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, items: [{ productId: rec.productId, quantity: rec.suggestedOrderQty }] }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al crear compra");
      toast.success("Borrador de compra creado — revisa Pedidos de Compra");
    } catch (error) {
      toast.error(getErr(error, "Error al crear compra"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateTransferFromRec = (rec: Recommendation) => {
    const srcOpt = rec.sourceOptions.find((o) => o.type === "OTHER_BRANCH" || o.type === "CENTRAL");
    const fromId = srcOpt?.branchId ?? centralBranchId ?? "";
    onCreateTransfer(rec.productId, fromId, branchId, rec.suggestedOrderQty);
  };

  const criticalityFilters: Array<{ key: ReplenishmentCriticality | "ALL"; label: string; count?: number }> = [
    { key: "ALL",              label: "Todas",       count: recommendations.length },
    { key: "CRITICAL",         label: "Críticos",    count: summary?.criticalCount },
    { key: "LOW",              label: "Bajo Stock",  count: summary?.lowCount },
    { key: "PREVENTIVE",       label: "Preventivos", count: summary?.preventiveCount },
    { key: "OBSERVE",          label: "Observar"     },
    { key: "NORMAL",           label: "Normal"       },
    { key: "DO_NOT_RECOMMEND", label: "No Reponer"   },
  ];

  return (
    <div className="space-y-5">
      {/* Branch selector */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-[var(--color-text-secondary)] flex items-center gap-1.5">
          <Building2 className="h-4 w-4" /> Analizar sucursal:
        </label>
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] min-w-[220px] focus:outline-none focus:border-[var(--color-master-400)]"
        >
          <option value="">Seleccionar sucursal a analizar...</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.isDefaultSupplier ? "★ " : ""}{b.code} — {b.name}
            </option>
          ))}
        </select>
        {branchId && (
          <>
            <button
              onClick={() => fetchRecommendations(branchId)}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Actualizar
            </button>
            <div className="relative">
              <button
                onClick={() => setShowDraftOptions((v) => !v)}
                disabled={loading || generatingDraft}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--color-master-600)] hover:bg-[var(--color-master-700)] text-white px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {generatingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
                Generar Borrador
                <ChevronDown className={`h-3 w-3 transition-transform ${showDraftOptions ? "rotate-180" : ""}`} />
              </button>
              {showDraftOptions && (
                <div className="absolute right-0 top-full mt-1 z-20 w-72 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-lg p-4 space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">Opciones del borrador</p>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includePreventive}
                      onChange={(e) => setIncludePreventive(e.target.checked)}
                      className="rounded"
                    />
                    <span className="font-medium">Incluir Preventivos</span>
                    <span className="text-xs text-[var(--color-text-muted)]">(reposición anticipada)</span>
                  </label>
                  <button
                    onClick={handleGenerateDraft}
                    disabled={generatingDraft}
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-[var(--color-master-600)] hover:bg-[var(--color-master-700)] text-white py-2 text-sm font-semibold transition-colors disabled:opacity-50"
                  >
                    {generatingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
                    {generatingDraft ? "Generando..." : "Generar Borrador"}
                  </button>
                  {currentDraft && (
                    <button
                      onClick={() => { setShowDraftPanel(true); setShowDraftOptions(false); }}
                      className="w-full flex items-center justify-center gap-2 rounded-lg border border-[var(--color-master-300)] text-[var(--color-master-700)] py-2 text-sm font-semibold hover:bg-[var(--color-master-50)] transition-colors"
                    >
                      <Eye className="h-4 w-4" />
                      Ver borrador actual ({currentDraft.summary.total} productos)
                    </button>
                  )}
                </div>
              )}
            </div>
            {currentDraft && !showDraftOptions && (
              <button
                onClick={() => setShowDraftPanel((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-master-300)] bg-[var(--color-master-50)] text-[var(--color-master-700)] px-3 py-2 text-sm font-semibold hover:bg-[var(--color-master-100)] transition-colors"
              >
                <ClipboardList className="h-4 w-4" />
                Borrador ({currentDraft.summary.total})
                <ChevronDown className={`h-3 w-3 transition-transform ${showDraftPanel ? "rotate-180" : ""}`} />
              </button>
            )}
          </>
        )}
      </div>

      {/* Draft Panel */}
      {showDraftPanel && currentDraft && (
        <DraftPanel
          draft={currentDraft}
          editingQtys={editingQtys}
          savingItem={savingItem}
          approvingDraft={approvingDraft}
          convertingDraft={convertingDraft}
          onQtyChange={(id, val) => setEditingQtys((prev) => ({ ...prev, [id]: val }))}
          onSaveQty={handleSaveQty}
          onIgnoreItem={handleIgnoreItem}
          onApprove={handleApproveDraft}
          onConvert={handleConvertDraft}
          onClose={() => setShowDraftPanel(false)}
        />
      )}

      {!branchId ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-12 text-center">
          <BarChart2 className="h-10 w-10 mx-auto text-[var(--color-master-300)] mb-3" />
          <p className="font-semibold text-[var(--color-text-secondary)]">Selecciona una sucursal para ver las recomendaciones de reposición</p>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">El análisis usa demanda real (30/60/90 días) + clasificación ABC-XYZ</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-16 gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" />
          <span className="text-sm text-[var(--color-text-muted)]">Analizando inventario y demanda...</span>
        </div>
      ) : (
        <>
          {/* KPI Strip */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {[
                { label: "Críticos",    value: summary.criticalCount,    bg: "bg-red-50",      text: "text-red-700",    border: "border-red-200",    bar: "bg-red-500",    icon: <AlertTriangle className="h-4 w-4" /> },
                { label: "Bajo Stock",  value: summary.lowCount,         bg: "bg-orange-50",   text: "text-orange-700", border: "border-orange-200", bar: "bg-orange-500", icon: <TrendingDown className="h-4 w-4" />   },
                { label: "Preventivos", value: summary.preventiveCount,          bg: "bg-yellow-50",   text: "text-yellow-700", border: "border-yellow-200", bar: "bg-yellow-400", icon: <ShieldAlert className="h-4 w-4" />    },
                { label: "Madera c/Agot.", value: summary.timberAlert?.zeroStockCount ?? 0, bg: "bg-amber-50", text: "text-amber-700",  border: "border-amber-200",  bar: "bg-amber-500",  icon: <Layers className="h-4 w-4" />   },
                { label: "Compras",     value: summary.buyCount,         bg: "bg-indigo-50",   text: "text-indigo-700", border: "border-indigo-200", bar: "bg-indigo-500", icon: <ShoppingCart className="h-4 w-4" />   },
                { label: "Traslados",   value: summary.transferInCount,  bg: "bg-sky-50",      text: "text-sky-700",    border: "border-sky-200",    bar: "bg-sky-500",    icon: <ArrowLeftRight className="h-4 w-4" /> },
              ].map((k) => (
                <div key={k.label} className={`relative rounded-xl border ${k.border} ${k.bg} p-3 overflow-hidden`}>
                  <div className={`absolute top-0 left-0 right-0 h-0.5 ${k.bar}`} />
                  <div className="flex items-center justify-between mb-1 pt-0.5">
                    <span className={`text-[10px] font-bold uppercase tracking-wide ${k.text}`}>{k.label}</span>
                    <span className={k.text}>{k.icon}</span>
                  </div>
                  <p className={`text-2xl font-extrabold tabular-nums ${k.text}`}>{k.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar producto, SKU o categoría..."
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-9 pr-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-master-400)]"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {criticalityFilters.map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setFilterCriticality(key)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                    filterCriticality === key
                      ? "bg-[var(--color-master-600)] text-white"
                      : "border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
                  }`}
                >
                  {label}{count !== undefined && count > 0 ? ` (${count})` : ""}
                </button>
              ))}
            </div>
          </div>

          {/* Timber Alert Banner */}
          {summary?.timberAlert && (summary.timberAlert.totalCount > 0 || summary.timberAlert.zeroStockCount > 0) && (
            <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
              summary.timberAlert.zeroStockCount > 0
                ? "border-amber-300 bg-amber-50"
                : "border-amber-200 bg-amber-50/60"
            }`}>
              <Layers className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-800">
                  Módulo de Madera — {summary.timberAlert.totalCount} producto{summary.timberAlert.totalCount !== 1 ? "s" : ""} registrado{summary.timberAlert.totalCount !== 1 ? "s" : ""}
                  {summary.timberAlert.zeroStockCount > 0 && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-amber-600 text-white text-[10px] font-bold px-2 py-0.5">
                      {summary.timberAlert.zeroStockCount} agotado{summary.timberAlert.zeroStockCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  La madera se compra por viajes con cubicación y precio por pulgada/pie tablar. Gestiona el reabastecimiento desde el Módulo de Madera.
                </p>
                {summary.timberAlert.lowStockItems.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {summary.timberAlert.lowStockItems.slice(0, 5).map((item) => (
                      <span key={item.productId} className="inline-flex items-center gap-1 rounded bg-amber-100 border border-amber-300 text-amber-800 text-[11px] font-mono px-1.5 py-0.5">
                        {item.sku} <span className="text-red-600 font-bold">✕0</span>
                      </span>
                    ))}
                    {summary.timberAlert.lowStockItems.length > 5 && (
                      <span className="text-[11px] text-amber-700">+{summary.timberAlert.lowStockItems.length - 5} más</span>
                    )}
                  </div>
                )}
              </div>
              <a
                href="/app/master/timber/trips"
                className="flex-shrink-0 flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <ChevronRight className="h-3.5 w-3.5" />
                Crear Viaje de Madera
              </a>
            </div>
          )}

          {/* Recommendations Table */}
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center">
              <Package className="h-8 w-8 mx-auto text-[var(--color-text-muted)] mb-2" />
              <p className="font-semibold text-[var(--color-text-secondary)]">
                {recommendations.length === 0
                  ? "No hay productos con balance de inventario en esta sucursal."
                  : "Ningún producto coincide con los filtros seleccionados."}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
              <div className="hm-card-header-blue px-5 py-3 flex items-center gap-2">
                <BarChart2 className="h-5 w-5" />
                <h2 className="font-semibold">Análisis de Reposición</h2>
                <span className="ml-auto text-xs opacity-80">{filtered.length} productos</span>
              </div>
              <div className="overflow-x-auto">
                <table className="hm-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Categoría</th>
                      <th className="text-right">Stock</th>
                      <th className="text-right">V.30d</th>
                      <th className="text-right">V.60d</th>
                      <th className="text-right">V.90d</th>
                      <th>Ú. Venta</th>
                      <th>Criticidad</th>
                      <th className="text-right">Qty Sug.</th>
                      <th>Fuente</th>
                      <th className="text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((rec) => (
                      <>
                        <tr
                          key={rec.productId}
                          className={`border-b border-[var(--color-border)] cursor-pointer transition-colors ${
                            expandedRow === rec.productId
                              ? "bg-[var(--color-master-50)]"
                              : rec.criticality === "CRITICAL"
                              ? "bg-red-50/40 hover:bg-red-50"
                              : "hover:bg-[var(--color-surface-alt)]"
                          }`}
                          onClick={() => setExpandedRow(expandedRow === rec.productId ? null : rec.productId)}
                        >
                          <td>
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-[var(--color-text)] truncate max-w-[200px]">{rec.name}</p>
                                <p className="text-[10px] font-mono text-[var(--color-text-muted)]">{rec.sku} · {rec.abcClass}{rec.xyzClass}</p>
                              </div>
                            </div>
                          </td>
                          <td className="text-xs text-[var(--color-text-secondary)]">
                            {rec.categoryName ?? <span className="text-[var(--color-text-muted)]">—</span>}
                          </td>
                          <td className={`text-right font-mono font-bold tabular-nums text-sm ${
                            rec.stockOnHand === 0 ? "text-red-600" : rec.stockOnHand <= rec.reorderPoint ? "text-orange-600" : "text-[var(--color-text)]"
                          }`}>
                            {rec.stockOnHand}
                          </td>
                          <td className="text-right font-mono tabular-nums text-xs text-[var(--color-text-secondary)]">{rec.unitsSoldLast30Days}</td>
                          <td className="text-right font-mono tabular-nums text-xs text-[var(--color-text-muted)]">{rec.unitsSoldLast60Days}</td>
                          <td className="text-right font-mono tabular-nums text-xs text-[var(--color-text-muted)]">{rec.unitsSoldLast90Days}</td>
                          <td className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmtDate(rec.lastSoldAt)}</td>
                          <td><CriticalityBadge criticality={rec.criticality} /></td>
                          <td className={`text-right font-mono font-bold tabular-nums ${rec.suggestedOrderQty > 0 ? "text-[var(--color-master-700)]" : "text-[var(--color-text-muted)]"}`}>
                            {rec.suggestedOrderQty > 0 ? rec.suggestedOrderQty : "—"}
                          </td>
                          <td><SourceBadge source={rec.recommendedSource} /></td>
                          <td className="text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1">
                              {(rec.recommendedSource === "OTHER_BRANCH" || rec.recommendedSource === "CENTRAL") && rec.suggestedOrderQty > 0 && (
                                <button
                                  onClick={() => handleCreateTransferFromRec(rec)}
                                  className="hm-icon-btn text-sky-600 hover:bg-sky-50"
                                  title="Crear traslado"
                                >
                                  <ArrowLeftRight className="h-4 w-4" />
                                </button>
                              )}
                              {rec.recommendedSource === "SUPPLIER" && rec.suggestedOrderQty > 0 && (
                                <button
                                  onClick={() => handleCreatePurchase(rec)}
                                  disabled={actionLoading === `buy-${rec.productId}`}
                                  className="hm-icon-btn text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                                  title="Crear compra"
                                >
                                  {actionLoading === `buy-${rec.productId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                                </button>
                              )}
                              {rec.hasProductionRecipe && rec.suggestedOrderQty > 0 && (
                                <span className="hm-icon-btn text-teal-600 cursor-default" title="Tiene receta de producción">
                                  <Factory className="h-4 w-4" />
                                </span>
                              )}
                              <button
                                onClick={() => setExpandedRow(expandedRow === rec.productId ? null : rec.productId)}
                                className="hm-icon-btn text-[var(--color-text-muted)]"
                                title="Ver detalle"
                              >
                                <ChevronDown className={`h-4 w-4 transition-transform ${expandedRow === rec.productId ? "rotate-180" : ""}`} />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {expandedRow === rec.productId && (
                          <tr key={`${rec.productId}-detail`} className="bg-[var(--color-surface-alt)]">
                            <td colSpan={11} className="px-5 py-4">
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                                <div className="space-y-2">
                                  <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)] tracking-wide">Análisis de Stock</p>
                                  <div className="space-y-1 text-xs">
                                    <p><span className="text-[var(--color-text-muted)]">Punto de reorden:</span> <strong>{rec.reorderPoint.toFixed(1)}</strong></p>
                                    <p><span className="text-[var(--color-text-muted)]">Stock objetivo:</span> <strong>{rec.targetStock.toFixed(1)}</strong></p>
                                    <p><span className="text-[var(--color-text-muted)]">Demanda diaria:</span> <strong>{rec.averageDailyDemand.toFixed(2)}/día</strong></p>
                                    {rec.estimatedPurchaseCost != null && rec.estimatedPurchaseCost > 0 && (
                                      <p><span className="text-[var(--color-text-muted)]">Costo estimado compra:</span> <strong>{NIO.format(rec.estimatedPurchaseCost)}</strong></p>
                                    )}
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)] tracking-wide">Fuentes disponibles</p>
                                  <div className="space-y-1.5">
                                    {rec.sourceOptions.map((opt, i) => (
                                      <div key={i} className="flex items-start gap-2 text-xs">
                                        <SourceBadge source={opt.type} />
                                        <span className="text-[var(--color-text-secondary)] text-[11px] leading-snug">{opt.reason}</span>
                                      </div>
                                    ))}
                                    {rec.sourceOptions.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">Sin opciones de reposición disponibles.</p>}
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)] tracking-wide">Mensaje del sistema</p>
                                  <p className="text-xs text-[var(--color-text-secondary)] italic">{rec.message}</p>
                                  {rec.warnings.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                      {rec.warnings.map((w, i) => (
                                        <div key={i} className="flex items-start gap-1.5 text-xs text-[var(--color-warning-700)]">
                                          <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                                          <span>{w}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────
   TAB 2 — TRASLADOS Y APROBACIONES
─────────────────────────────────────────── */

function TransfersTab({
  branches,
  products,
  centralBranchId,
  preselectedProduct,
  preselectedFrom,
  preselectedTo,
  preselectedQty,
  onPreselectedHandled,
}: {
  branches: Branch[];
  products: Product[];
  centralBranchId: string;
  preselectedProduct?: string;
  preselectedFrom?: string;
  preselectedTo?: string;
  preselectedQty?: number;
  onPreselectedHandled: () => void;
}) {
  const [allTransfers, setAllTransfers]     = useState<Transfer[]>([]);
  const [loading, setLoading]               = useState(true);
  const [filterStatus, setFilterStatus]     = useState<string>("");
  const [actionLoading, setActionLoading]   = useState<string | null>(null);

  const [showSuggestions, setShowSuggestions]       = useState(true);
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
  const [modalLines, setModalLines]               = useState<TransferLineForm[]>([]);
  const [modalProductSearch, setModalProductSearch] = useState("");

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

  useEffect(() => { fetchTransfers(); }, [fetchTransfers]);

  useEffect(() => {
    if (branches.length > 1 && !suggestBranchId) {
      const firstDest = branches.find((b) => !b.isDefaultSupplier);
      if (firstDest) setSuggestBranchId(firstDest.id);
    }
  }, [branches, suggestBranchId]);

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

  /* Handle preselected product from recommendations tab */
  useEffect(() => {
    if (!preselectedProduct || !preselectedFrom || !preselectedTo) return;
    setModalFromBranchId(preselectedFrom);
    setModalToBranchId(preselectedTo);
    setModalNotes("");
    setModalLines([{ productId: preselectedProduct, quantity: String(preselectedQty ?? 1) }]);
    setModalProductSearch("");
    setSelectedTransfer(null);
    setShowModal(true);
    onPreselectedHandled();
  }, [preselectedProduct, preselectedFrom, preselectedTo, preselectedQty, onPreselectedHandled]);

  const openCreate = (toId?: string) => {
    const from = centralBranchId || branches[0]?.id || "";
    const to   = toId || branches.find((b) => b.id !== from)?.id || "";
    setModalFromBranchId(from);
    setModalToBranchId(to);
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
    setSelectedTransfer(null);
    setShowModal(true);
  };

  const removeModalLine = (i: number) => setModalLines((prev) => prev.filter((_, idx) => idx !== i));
  const updateModalLine = (i: number, field: keyof TransferLineForm, value: string) =>
    setModalLines((prev) => { const next = [...prev]; next[i] = { ...next[i], [field]: value }; return next; });

  const addProductToModal = (productId: string) => {
    if (modalLines.some((l) => l.productId === productId)) { toast("Ese producto ya está en la lista."); return; }
    setModalLines((prev) => [...prev, { productId, quantity: "1" }]);
    setModalProductSearch("");
  };

  const openDetail = (t: Transfer) => {
    setSelectedTransfer(t);
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const handleCreate = async () => {
    try {
      setActionLoading("create");
      const lines = modalLines.filter((l) => l.productId).map((l) => ({ productId: l.productId, quantity: parseFloat(l.quantity) || 0 }));
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
      toast.success("Traslado creado exitosamente");
      setShowModal(false);
      fetchTransfers();
    } catch (error) { toast.error(getErr(error, "Error al crear envío")); }
    finally { setActionLoading(null); }
  };

  const handleApprove = async (id: string) => {
    if (!confirm("¿Aprobar este traslado? El inventario se descontará al despacharlo.")) return;
    try {
      setActionLoading(id);
      const res = await apiFetch(`/api/master/transfers/${id}/approve`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? e.message ?? "Error al aprobar"); }
      toast.success("Traslado aprobado");
      fetchTransfers();
      setSelectedTransfer(null);
    } catch (error) { toast.error(getErr(error, "Error al aprobar")); }
    finally { setActionLoading(null); }
  };

  const handleDispatch = async (id: string) => {
    if (!confirm("¿Despachar este traslado? Se descontará stock de la sucursal origen.")) return;
    try {
      setActionLoading(id);
      const res = await apiFetch(`/api/master/transfers/${id}/dispatch`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? e.message ?? "Error al despachar"); }
      toast.success("Traslado despachado — stock descontado");
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
    if (!confirm("¿Cancelar este traslado?")) return;
    try {
      setActionLoading(id);
      const res = await apiFetch(`/api/master/transfers/${id}/cancel`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? e.message ?? "Error al cancelar"); }
      toast.success("Traslado cancelado");
      fetchTransfers();
      setSelectedTransfer(null);
    } catch (error) { toast.error(getErr(error, "Error al cancelar")); }
    finally { setActionLoading(null); }
  };

  const filteredProducts = modalProductSearch.trim()
    ? products.filter((p) =>
        p.sku.toLowerCase().includes(modalProductSearch.toLowerCase()) ||
        p.name.toLowerCase().includes(modalProductSearch.toLowerCase())
      ).slice(0, 12)
    : [];

  return (
    <div className="space-y-5">
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

      {/* Actions row */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setShowSuggestions((v) => !v)}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
            showSuggestions
              ? "bg-[var(--color-master-50)] border-[var(--color-master-300)] text-[var(--color-master-700)]"
              : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
          }`}
        >
          <Sparkles className="h-4 w-4" /> Sugerencias inteligentes
        </button>
        <div className="flex items-center gap-2">
          <button onClick={fetchTransfers} className="hm-icon-btn" title="Actualizar"><RefreshCw className="h-4 w-4" /></button>
          <button
            onClick={() => openCreate()}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" /> Nuevo Traslado
          </button>
        </div>
      </div>

      {/* Suggestions Panel */}
      {showSuggestions && (
        <div className="rounded-xl border border-[var(--color-master-200)] bg-[var(--color-master-50)] overflow-hidden">
          <div className="px-5 py-3 flex items-center gap-3 border-b border-[var(--color-master-200)]">
            <Sparkles className="h-5 w-5 text-[var(--color-master-600)] flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="font-bold text-[var(--color-master-800)]">Oportunidades de Traslado Identificadas</h2>
              <p className="text-xs text-[var(--color-master-600)]">Basadas en stock crítico y excedentes en otras sucursales</p>
            </div>
            <button onClick={() => setShowSuggestions(false)} className="ml-auto hm-icon-btn flex-shrink-0"><X className="h-4 w-4" /></button>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm font-semibold text-[var(--color-master-800)] flex items-center gap-1.5 flex-shrink-0">
                <Building2 className="h-4 w-4" /> Sucursal a reponer:
              </label>
              <select
                value={suggestBranchId}
                onChange={(e) => setSuggestBranchId(e.target.value)}
                className="rounded-lg border border-[var(--color-master-300)] bg-white px-3 py-1.5 text-sm text-[var(--color-text)] min-w-[200px] focus:outline-none focus:border-[var(--color-master-500)]"
              >
                <option value="">Seleccionar sucursal...</option>
                {branches
                  .filter((b) => !centralBranchId || b.id !== centralBranchId)
                  .map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
              {suggestBranchId && centralBranchId && (
                <button
                  onClick={() => openCreate(suggestBranchId)}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--color-master-600)] px-3 py-1.5 text-xs font-bold text-white hover:bg-[var(--color-master-700)] transition-colors"
                >
                  <Send className="h-3.5 w-3.5" /> Traslado a {branches.find((b) => b.id === suggestBranchId)?.code}
                </button>
              )}
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
                Selecciona una sucursal destino para ver las oportunidades de traslado.
              </div>
            ) : filteredSuggestions.length === 0 ? (
              <div className="py-8 text-center">
                <Package className="h-8 w-8 mx-auto text-[var(--color-master-400)] mb-2" />
                <p className="text-sm font-semibold text-[var(--color-master-700)]">Sin oportunidades de traslado</p>
                <p className="text-xs text-[var(--color-master-600)] mt-1">
                  {suggestions.length > 0 ? "Ninguna coincide con el filtro." : "El inventario está balanceado o no hay excedentes disponibles."}
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
          { key: "",                   label: "Todos",       count: allTransfers.length },
          { key: "DRAFT",              label: "Borradores",  count: draftCount },
          { key: "APPROVED",           label: "Aprobados",   count: approvedCount },
          { key: "IN_TRANSIT",         label: "En Tránsito", count: transitCount },
          { key: "PARTIALLY_RECEIVED", label: "Parciales",   count: allTransfers.filter((t) => t.status === "PARTIALLY_RECEIVED").length },
          { key: "RECEIVED",           label: "Recibidos",   count: receivedCount },
          { key: "CANCELLED",          label: "Cancelados",  count: allTransfers.filter((t) => t.status === "CANCELLED").length },
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
          <span className="text-sm text-[var(--color-text-muted)]">Cargando traslados...</span>
        </div>
      ) : transfers.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center">
          <div className="hm-icon-wrap-md mx-auto mb-3">
            <Truck className="h-6 w-6 text-[var(--color-text-muted)]" />
          </div>
          <p className="font-semibold text-[var(--color-text-secondary)]">
            No hay traslados{filterStatus ? ` con estado "${STATUS_CFG[filterStatus]?.label ?? filterStatus}"` : " registrados"}.
          </p>
          {!filterStatus && (
            <button onClick={() => openCreate()} className="mt-3 text-sm text-[var(--color-master-600)] hover:underline font-medium">
              Crear el primer traslado →
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
          <div className="hm-card-header-blue px-5 py-3 flex items-center gap-2">
            <Truck className="h-5 w-5" />
            <h2 className="font-semibold">Listado de Traslados</h2>
            <span className="ml-auto text-xs opacity-80 tabular-nums">{transfers.length} registros</span>
          </div>
          <div className="overflow-x-auto">
            <table className="hm-table">
              <thead>
                <tr>
                  <th>Traslado</th>
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
                      selectedTransfer?.id === t.id ? "bg-[var(--color-master-50)]" : "hover:bg-[var(--color-surface-alt)]"
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
                        <button onClick={() => openDetail(t)} className="hm-icon-btn text-[var(--color-info-600)]" title="Ver detalle"><Eye className="h-4 w-4" /></button>
                        {t.status === "DRAFT" && (
                          <>
                            <button onClick={() => handleApprove(t.id)} disabled={actionLoading === t.id} className="hm-icon-btn text-[var(--color-success-600)] hover:bg-[var(--color-success-50)] disabled:opacity-50" title="Aprobar">
                              {actionLoading === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                            </button>
                            <button onClick={() => handleCancel(t.id)} disabled={actionLoading === t.id} className="hm-icon-btn text-[var(--color-danger-600)] hover:bg-[var(--color-danger-50)] disabled:opacity-50" title="Cancelar">
                              <Ban className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {t.status === "APPROVED" && (
                          <>
                            <button onClick={() => handleDispatch(t.id)} disabled={actionLoading === t.id} className="hm-icon-btn text-[var(--color-info-700)] hover:bg-[var(--color-info-50)] disabled:opacity-50" title="Despachar">
                              {actionLoading === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </button>
                            <button onClick={() => handleCancel(t.id)} disabled={actionLoading === t.id} className="hm-icon-btn text-[var(--color-danger-600)] hover:bg-[var(--color-danger-50)] disabled:opacity-50" title="Cancelar">
                              <Ban className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {(t.status === "IN_TRANSIT" || t.status === "PARTIALLY_RECEIVED") && (
                          <button onClick={() => handleReceive(t.id)} disabled={actionLoading === t.id} className="hm-icon-btn text-emerald-700 hover:bg-emerald-50 disabled:opacity-50" title="Confirmar recepción">
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
              <h2 className="font-bold truncate">Traslado {selectedTransfer.transferNumber}</h2>
              <StatusBadge status={selectedTransfer.status} />
            </div>
            <button onClick={() => setSelectedTransfer(null)} className="text-white/80 hover:text-white transition-colors ml-2 flex-shrink-0">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="p-5 space-y-5">
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
                <p className="font-semibold text-[var(--color-text)] text-sm">{selectedTransfer.requestedBy.fullName || selectedTransfer.requestedBy.username}</p>
                {selectedTransfer.approvedBy && (
                  <p className="text-xs text-slate-500 mt-0.5">Aprobado: {selectedTransfer.approvedBy.fullName || selectedTransfer.approvedBy.username}</p>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4">
              <p className="text-xs font-bold uppercase text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />Línea de Tiempo</p>
              <div className="flex flex-wrap gap-x-8 gap-y-3">
                {[
                  { label: "Creado",     ts: selectedTransfer.createdAt,    show: true },
                  { label: "Aprobado",   ts: selectedTransfer.approvedAt,   show: !!selectedTransfer.approvedAt },
                  { label: "Despachado", ts: selectedTransfer.dispatchedAt, show: !!selectedTransfer.dispatchedAt },
                  { label: "Recibido",   ts: selectedTransfer.receivedAt,   show: !!selectedTransfer.receivedAt },
                ].filter((item) => item.show).map(({ label, ts }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full flex-shrink-0 bg-[var(--color-success-500)]" />
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
            <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
              <table className="hm-table">
                <thead>
                  <tr>
                    <th>Producto</th><th>SKU</th>
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
                        <td className={`text-right font-mono tabular-nums ${qDis > 0 && qDis < qReq ? "text-[var(--color-warning-700)]" : qDis >= qReq ? "text-[var(--color-success-700)]" : "text-[var(--color-text-muted)]"}`}>{qDis > 0 ? qDis : "—"}</td>
                        <td className={`text-right font-mono tabular-nums ${qRec > 0 && qRec < qReq ? "text-[var(--color-warning-700)]" : qRec >= qReq ? "text-[var(--color-success-700)]" : "text-[var(--color-text-muted)]"}`}>{qRec > 0 ? qRec : "—"}</td>
                        <td className="text-right text-xs font-mono tabular-nums text-[var(--color-text-secondary)]">{cost > 0 ? NIO.format(cost) : <span className="text-[var(--color-text-muted)]">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {["DRAFT", "APPROVED", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(selectedTransfer.status) && (
              <div className="flex flex-wrap gap-3 pt-1 border-t border-[var(--color-border)]">
                {selectedTransfer.status === "DRAFT" && (
                  <>
                    <button onClick={() => handleApprove(selectedTransfer.id)} disabled={!!actionLoading} className="flex items-center gap-2 rounded-lg bg-[var(--color-success-600)] px-5 py-2.5 text-sm font-bold text-white hover:bg-[var(--color-success-700)] shadow-sm transition-all disabled:opacity-50">
                      {actionLoading === selectedTransfer.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />} Aprobar Traslado
                    </button>
                    <button onClick={() => handleCancel(selectedTransfer.id)} disabled={!!actionLoading} className="flex items-center gap-2 rounded-lg border border-[var(--color-danger-300)] px-5 py-2.5 text-sm font-semibold text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)] transition-all disabled:opacity-50">
                      <Ban className="h-4 w-4" /> Cancelar
                    </button>
                  </>
                )}
                {selectedTransfer.status === "APPROVED" && (
                  <>
                    <button onClick={() => handleDispatch(selectedTransfer.id)} disabled={!!actionLoading} className="flex items-center gap-2 rounded-lg bg-[var(--color-info-700)] px-5 py-2.5 text-sm font-bold text-white hover:bg-[var(--color-info-800)] shadow-sm transition-all disabled:opacity-50">
                      {actionLoading === selectedTransfer.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Despachar Traslado
                    </button>
                    <button onClick={() => handleCancel(selectedTransfer.id)} disabled={!!actionLoading} className="flex items-center gap-2 rounded-lg border border-[var(--color-danger-300)] px-5 py-2.5 text-sm font-semibold text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)] transition-all disabled:opacity-50">
                      <Ban className="h-4 w-4" /> Cancelar
                    </button>
                  </>
                )}
                {(selectedTransfer.status === "IN_TRANSIT" || selectedTransfer.status === "PARTIALLY_RECEIVED") && (
                  <button onClick={() => handleReceive(selectedTransfer.id)} disabled={!!actionLoading} className="flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 shadow-sm transition-all disabled:opacity-50">
                    {actionLoading === selectedTransfer.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />} Confirmar Recepción
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto pt-6 pb-8 px-4">
          <div className="w-full max-w-2xl rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border-strong)] shadow-2xl">
            <div className="hm-card-header-blue px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-base font-bold flex items-center gap-2">
                <Send className="h-5 w-5" /> Nuevo Traslado entre Sucursales
              </h2>
              <button onClick={() => setShowModal(false)} className="text-white/80 hover:text-white transition-colors"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-[var(--color-text-secondary)] mb-1.5">
                    <Building2 className="h-3.5 w-3.5 inline mr-1 text-blue-600" />Sucursal Origen
                  </label>
                  <select value={modalFromBranchId} onChange={(e) => setModalFromBranchId(e.target.value)} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-master-400)]">
                    <option value="">Seleccionar...</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.isDefaultSupplier ? "★ " : ""}{b.code} — {b.name}{b.isDefaultSupplier ? " (Central)" : ""}</option>)}
                  </select>
                  {modalFromBranchId && branches.find((b) => b.id === modalFromBranchId)?.isDefaultSupplier && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-[var(--color-master-700)] font-semibold">
                      <Star className="h-3 w-3" /> Sucursal central
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[var(--color-text-secondary)] mb-1.5">
                    <Building2 className="h-3.5 w-3.5 inline mr-1 text-emerald-600" />Sucursal Destino
                  </label>
                  <select value={modalToBranchId} onChange={(e) => setModalToBranchId(e.target.value)} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-master-400)]">
                    <option value="">Seleccionar...</option>
                    {branches.filter((b) => b.id !== modalFromBranchId).map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-secondary)] mb-1.5">
                  <FileText className="h-3.5 w-3.5 inline mr-1" />Notas (opcional)
                </label>
                <textarea value={modalNotes} onChange={(e) => setModalNotes(e.target.value)} rows={2} placeholder="Instrucciones adicionales..." className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] resize-none focus:outline-none focus:border-[var(--color-master-400)]" />
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-1.5">
                  <Package className="h-4 w-4 text-[var(--color-master-600)]" /> Buscar y agregar productos
                </h3>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]" />
                  <input type="text" value={modalProductSearch} onChange={(e) => setModalProductSearch(e.target.value)} placeholder="Buscar por SKU o nombre..." className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-9 pr-3 py-2.5 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-master-400)]" />
                </div>
                {filteredProducts.length > 0 && (
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden max-h-40 overflow-y-auto divide-y divide-[var(--color-border)]">
                    {filteredProducts.map((p) => (
                      <button key={p.id} type="button" onClick={() => addProductToModal(p.id)} disabled={modalLines.some((l) => l.productId === p.id)} className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--color-surface-alt)] transition-colors flex items-center justify-between gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
                        <span>
                          <span className="font-mono font-semibold text-[var(--color-text)]">{p.sku}</span>
                          <span className="ml-2 text-[var(--color-text-secondary)]">{p.name}</span>
                          <span className="ml-1 text-[var(--color-text-muted)]">· {p.unit}</span>
                        </span>
                        {modalLines.some((l) => l.productId === p.id) ? <CheckCircle className="h-3.5 w-3.5 text-[var(--color-success-500)]" /> : <Plus className="h-3.5 w-3.5 text-[var(--color-master-600)]" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {modalLines.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
                  <div className="bg-[var(--color-surface-alt)] px-3 py-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                    Productos seleccionados — {modalLines.length}
                  </div>
                  <div className="divide-y divide-[var(--color-border)]">
                    {modalLines.map((line, idx) => {
                      const p = products.find((x) => x.id === line.productId);
                      return (
                        <div key={idx} className="flex items-center gap-3 px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono font-semibold text-[var(--color-text)]">{p?.sku ?? line.productId}</p>
                            <p className="text-xs text-[var(--color-text-secondary)] truncate">{p?.name ?? "—"}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <input type="number" min="0.01" step="1" value={line.quantity} onChange={(e) => updateModalLine(idx, "quantity", e.target.value)} className="w-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-center text-[var(--color-text)] focus:outline-none focus:border-[var(--color-master-400)]" />
                            <span className="text-xs text-[var(--color-text-muted)]">{p?.unit ?? ""}</span>
                            <button onClick={() => removeModalLine(idx)} className="hm-icon-btn text-[var(--color-danger-600)]"><X className="h-4 w-4" /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {modalLines.length === 0 && !modalProductSearch && (
                <p className="text-center text-sm text-[var(--color-text-muted)] py-2">Busca un producto arriba para agregarlo al traslado.</p>
              )}
              <div className="flex justify-end gap-3 pt-2 border-t border-[var(--color-border)]">
                <button onClick={() => setShowModal(false)} className="flex items-center gap-2 rounded-lg border border-[var(--color-border-strong)] px-4 py-2.5 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] transition-colors">
                  <X className="h-4 w-4" /> Cancelar
                </button>
                <button onClick={handleCreate} disabled={actionLoading === "create" || modalLines.length === 0 || !modalFromBranchId || !modalToBranchId} className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-6 py-2.5 text-sm font-bold text-white hover:bg-[var(--color-master-700)] shadow-md hover:shadow-lg transition-all disabled:opacity-50">
                  {actionLoading === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Crear Traslado {modalLines.length > 0 ? `(${modalLines.length} producto${modalLines.length !== 1 ? "s" : ""})` : ""}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────
   TAB 3 — CONFIGURACIÓN
─────────────────────────────────────────── */

function ConfigTab({ branches }: { branches: Branch[] }) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h3 className="font-bold text-[var(--color-text)] mb-1 flex items-center gap-2">
          <Settings className="h-5 w-5 text-[var(--color-master-600)]" /> Configuración de Reposición
        </h3>
        <p className="text-sm text-[var(--color-text-muted)] mb-5">
          Los parámetros globales (tiempo de entrega, días de cobertura) se configuran por sucursal en la sección de Inventario.
          Los puntos de reorden por producto se gestionan en el Catálogo e Inventario bajo la columna de configuración de sucursal.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { label: "Parámetros por producto", desc: "Punto de reorden, stock mínimo y máximo", href: "/app/master/catalog-inventory", icon: <Package className="h-5 w-5" />, color: "text-[var(--color-master-700)]", bg: "bg-[var(--color-master-50)]", border: "border-[var(--color-master-200)]" },
            { label: "Pedidos de Compra", desc: "Gestionar órdenes a proveedores externos", href: "/app/master/purchase-orders", icon: <ShoppingCart className="h-5 w-5" />, color: "text-indigo-700", bg: "bg-indigo-50", border: "border-indigo-200" },
            { label: "Analytics ABC-XYZ", desc: "Clasificación comercial de productos", href: "/app/master/analytics/abc-xyz", icon: <BarChart2 className="h-5 w-5" />, color: "text-teal-700", bg: "bg-teal-50", border: "border-teal-200" },
          ].map((link) => (
            <a key={link.href} href={link.href} className={`rounded-xl border ${link.border} ${link.bg} p-4 flex items-start gap-3 hover:shadow-md transition-shadow`}>
              <span className={`flex-shrink-0 mt-0.5 ${link.color}`}>{link.icon}</span>
              <div>
                <p className={`font-semibold text-sm ${link.color}`}>{link.label}</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{link.desc}</p>
              </div>
            </a>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h3 className="font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-[var(--color-master-600)]" /> Sucursales activas
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {branches.map((b) => (
            <div key={b.id} className={`rounded-lg border px-3 py-2.5 flex items-center gap-2 ${b.isDefaultSupplier ? "bg-[var(--color-master-50)] border-[var(--color-master-200)]" : "bg-[var(--color-surface-alt)] border-[var(--color-border)]"}`}>
              {b.isDefaultSupplier && <Star className="h-3.5 w-3.5 text-[var(--color-master-600)] flex-shrink-0" />}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text)] truncate">{b.code} — {b.name}</p>
                {b.isDefaultSupplier && <p className="text-[10px] text-[var(--color-master-600)] font-medium">Sucursal Central</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────
   MAIN PAGE — REPOSICIÓN INTELIGENTE
─────────────────────────────────────────── */

type ActiveTab = "recommendations" | "transfers" | "config";

export default function ReplenishmentPage() {
  const [activeTab, setActiveTab]         = useState<ActiveTab>("recommendations");
  const [branches, setBranches]           = useState<Branch[]>([]);
  const [products, setProducts]           = useState<Product[]>([]);
  const [centralBranchId, setCentralBranchId] = useState<string>("");

  /* State for cross-tab communication: recommendations → transfers */
  const [pendingTransfer, setPendingTransfer] = useState<{
    productId: string; fromBranchId: string; toBranchId: string; qty: number;
  } | null>(null);

  const fetchMeta = useCallback(async () => {
    try {
      const [bRes, pRes] = await Promise.all([fetch("/api/branches"), fetch("/api/catalog/products")]);
      const bData = unwrapApiData(await bRes.json()) as Branch[];
      const pData = unwrapApiData(await pRes.json());
      const branchList = Array.isArray(bData) ? bData : [];
      setBranches(branchList);
      setProducts(Array.isArray(pData) ? pData : []);
      const central = branchList.find((b) => b.isDefaultSupplier);
      if (central) setCentralBranchId(central.id);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  const handleCreateTransferFromRec = (productId: string, fromBranchId: string, toBranchId: string, qty: number) => {
    setPendingTransfer({ productId, fromBranchId, toBranchId, qty });
    setActiveTab("transfers");
  };

  const tabs: Array<{ key: ActiveTab; label: string; icon: React.ReactNode }> = [
    { key: "recommendations", label: "Recomendaciones", icon: <Sparkles className="h-4 w-4" /> },
    { key: "transfers",       label: "Traslados",        icon: <Truck className="h-4 w-4" />    },
    { key: "config",          label: "Configuración",    icon: <Settings className="h-4 w-4" /> },
  ];

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-1 rounded-full flex-shrink-0"
            style={{ background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-700))" }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Reposición Inteligente</h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              Suministro, compras y traslados basados en demanda real por sucursal
              {centralBranchId && (
                <> · Central: <strong className="text-[var(--color-master-700)]">{branches.find((b) => b.id === centralBranchId)?.name}</strong></>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              activeTab === tab.key
                ? "border-[var(--color-master-600)] text-[var(--color-master-700)]"
                : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "recommendations" && (
        <RecommendationsTab
          branches={branches}
          centralBranchId={centralBranchId}
          products={products}
          onCreateTransfer={handleCreateTransferFromRec}
        />
      )}
      {activeTab === "transfers" && (
        <TransfersTab
          branches={branches}
          products={products}
          centralBranchId={centralBranchId}
          preselectedProduct={pendingTransfer?.productId}
          preselectedFrom={pendingTransfer?.fromBranchId}
          preselectedTo={pendingTransfer?.toBranchId}
          preselectedQty={pendingTransfer?.qty}
          onPreselectedHandled={() => setPendingTransfer(null)}
        />
      )}
      {activeTab === "config" && <ConfigTab branches={branches} />}
    </section>
  );
}
