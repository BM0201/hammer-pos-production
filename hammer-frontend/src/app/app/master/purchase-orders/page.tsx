"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import toast from "react-hot-toast";
import {
  Plus,
  CheckCircle,
  Loader2,
  FileText,
  AlertTriangle,
  X,
  ShoppingCart,
  Building2,
  Eye,
  Ban,
  PackageCheck,
  Truck,
  DollarSign,
  ReceiptText,
  Search,
  Printer,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { openPrintableDocument, recordPrintAudit } from "@/lib/printing";
import { money, qty, fmtDate, fmtDateTime } from "@/lib/format";

/* ── Types ── */
type Product = { id: string; sku: string; name: string; unit: string };
type Supplier = {
  id: string;
  name: string;
  commercialName?: string | null;
  ruc?: string | null;
  phone?: string | null;
  email?: string | null;
  contactName?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  accountHolder?: string | null;
  paymentTerms?: string | null;
};
type POLine = {
  id?: string;
  productId: string;
  product?: Product;
  quantity: number;
  unitCost: number;
  unitCostBeforeTax?: number;
  taxRate?: number;
  unitTaxAmount?: number;
  costWithTax?: number;
  allocatedFreightPerUnit?: number;
  allocatedOtherChargesPerUnit?: number;
  allocatedDiscountPerUnit?: number;
  finalUnitCost?: number;
  subtotal: number;
  receivedQuantity?: number;
  pendingQuantity?: number;
};
type PurchaseOrder = {
  id: string;
  orderNumber: string;
  date: string;
  supplierId?: string | null;
  supplier: string | null;
  supplierRef?: Supplier | null;
  supplierNameSnapshot?: string | null;
  status: string;
  total: number;
  subtotalBeforeTax: number;
  taxAmount: number;
  freightAmount: number;
  otherChargesAmount: number;
  globalDiscountAmount: number;
  purchaseTaxTreatment: "INCLUDE_IN_COST" | "SEPARATE_CREDIT" | string;
  notes: string | null;
  branch: { id: string; code: string; name: string };
  createdBy: { username: string; fullName: string };
  lines: (POLine & { product: Product })[];
  createdAt: string;
  receptionState?: "NONE" | "PARTIAL" | "FULL";
};
type Branch = { id: string; code: string; name: string };
type PurchaseOrderLineForm = { productId: string; quantity: string; unitCostBeforeTax: string; taxRate: string };
type DateRange = "" | "today" | "7d" | "30d";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function withinDateRange(dateIso: string, range: DateRange): boolean {
  if (!range) return true;
  const date = new Date(dateIso);
  const now = new Date();
  if (range === "today") return date.toDateString() === now.toDateString();
  const days = range === "7d" ? 7 : 30;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return date >= cutoff;
}

/** Espejo cliente de la prorrata de costo final que hace createPurchaseOrder — solo para previsualizar, no autoritativo. */
function estimateFinalUnitCosts(
  lines: PurchaseOrderLineForm[],
  freightAmount: number,
  otherChargesAmount: number,
  globalDiscountAmount: number,
  taxTreatment: "INCLUDE_IN_COST" | "SEPARATE_CREDIT",
): number[] {
  const parsed = lines.map((l) => {
    const quantity = parseFloat(l.quantity) || 0;
    const unitCostBeforeTax = parseFloat(l.unitCostBeforeTax) || 0;
    const taxRate = parseFloat(l.taxRate) || 0;
    const unitTaxAmount = unitCostBeforeTax * (taxRate / 100);
    const subtotalBeforeTax = quantity * unitCostBeforeTax;
    return { quantity, unitCostBeforeTax, unitTaxAmount, subtotalBeforeTax };
  });
  const subtotalBeforeTaxTotal = parsed.reduce((acc, l) => acc + l.subtotalBeforeTax, 0);
  const totalAllocationBase = subtotalBeforeTaxTotal > 0 ? subtotalBeforeTaxTotal : parsed.reduce((acc, l) => acc + l.quantity, 0);
  return parsed.map((l) => {
    if (l.quantity <= 0) return 0;
    const weight = totalAllocationBase > 0 ? (subtotalBeforeTaxTotal > 0 ? l.subtotalBeforeTax : l.quantity) / totalAllocationBase : 0;
    const allocFreight = (freightAmount * weight) / l.quantity;
    const allocOther = (otherChargesAmount * weight) / l.quantity;
    const allocDiscount = (globalDiscountAmount * weight) / l.quantity;
    return Math.max(0, l.unitCostBeforeTax + (taxTreatment === "INCLUDE_IN_COST" ? l.unitTaxAmount : 0) + allocFreight + allocOther - allocDiscount);
  });
}

/* ── Status Badge ── */
function StatusBadge({ status, receptionState }: { status: string; receptionState?: string }) {
  if (status === "APPROVED" && receptionState === "PARTIAL") {
    return <span className="hm-badge hm-badge-warning">Recibido parcial</span>;
  }
  const cfg: Record<string, { className: string; label: string }> = {
    DRAFT: { className: "hm-badge hm-badge-warning", label: "Borrador" },
    APPROVED: { className: "hm-badge hm-badge-success", label: "Aprobado" },
    RECEIVED: { className: "hm-badge hm-badge-info", label: "Recibido" },
    CANCELLED: { className: "hm-badge hm-badge-danger", label: "Cancelado" },
  };
  const c = cfg[status] ?? { className: "hm-badge hm-badge-neutral", label: status };
  return <span className={c.className}>{c.label}</span>;
}

/* ── Combobox de producto (búsqueda por SKU/nombre, sin librerías nuevas) ── */
function ProductCombobox({
  products,
  value,
  onSelect,
}: {
  products: Product[];
  value: Product | null;
  onSelect: (product: Product) => void;
}) {
  const [query, setQuery] = useState(value ? `${value.sku} — ${value.name}` : "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(value ? `${value.sku} — ${value.name}` : "");
  }, [value?.id]);

  useEffect(() => () => { if (blurTimeout.current) clearTimeout(blurTimeout.current); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = !q ? products : products.filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
    return base.slice(0, 30);
  }, [products, query]);

  function selectProduct(p: Product) {
    onSelect(p);
    setQuery(`${p.sku} — ${p.name}`);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimeout.current = setTimeout(() => setOpen(false), 150); }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlight]) selectProduct(filtered[highlight]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Buscar por SKU o nombre..."
        className="hm-input w-full rounded-lg text-sm"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-lg">
          {filtered.map((p, i) => (
            <button
              type="button"
              key={p.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectProduct(p)}
              className={`flex w-full items-center gap-2 border-b border-[var(--color-border)] px-2.5 py-2 text-left text-[0.78rem] last:border-b-0 ${
                i === highlight ? "bg-[var(--color-master-50)]" : "hover:bg-[var(--color-surface-alt)]"
              }`}
            >
              <span className="min-w-[4.5rem] font-mono text-[0.68rem] text-[var(--color-text-muted)]">{p.sku}</span>
              <span className="flex-1 truncate text-[var(--color-text)]">{p.name}</span>
              <span className="text-[0.68rem] text-[var(--color-text-soft)]">{p.unit}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Modal de recepción parcial (Fase B1) ── */
function ReceivePurchaseOrderModal({
  order,
  onClose,
  onSubmitted,
}: {
  order: PurchaseOrder;
  onClose: () => void;
  onSubmitted: () => Promise<void> | void;
}) {
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.lines.map((l) => [l.id as string, String(l.pendingQuantity ?? 0)])),
  );
  const [allowOverReceive, setAllowOverReceive] = useState(false);
  const [freightAmount, setFreightAmount] = useState("0");
  const [otherChargesAmount, setOtherChargesAmount] = useState("0");
  const [notes, setNotes] = useState("");
  const [updateGlobalCost, setUpdateGlobalCost] = useState(true);
  const [createPriceReviewAlerts, setCreatePriceReviewAlerts] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const totalToReceive = order.lines.reduce((acc, line) => acc + (parseFloat(quantities[line.id as string] ?? "0") || 0), 0);
  const linesWithQty = order.lines.filter((line) => (parseFloat(quantities[line.id as string] ?? "0") || 0) > 0).length;

  async function handleSubmit() {
    const items = order.lines
      .map((line) => ({
        purchaseOrderLineId: line.id as string,
        productId: line.productId,
        quantityReceived: parseFloat(quantities[line.id as string] ?? "0") || 0,
      }))
      .filter((item) => item.quantityReceived > 0);

    if (items.length === 0) {
      setLocalError("Ingrese al menos una cantidad a recibir.");
      return;
    }

    if (!allowOverReceive) {
      const overLine = order.lines.find((line) => {
        const requested = parseFloat(quantities[line.id as string] ?? "0") || 0;
        return requested > (line.pendingQuantity ?? 0) + 1e-6;
      });
      if (overLine) {
        setLocalError(`La cantidad a recibir de "${overLine.product.name}" supera lo pendiente. Active "Permitir sobre-recepción" o ajuste la cantidad.`);
        return;
      }
    }

    try {
      setSubmitting(true);
      setLocalError(null);
      const res = await apiFetch(`/api/master/purchase-orders/${order.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: order.branch.id,
          items,
          freightAmount: parseFloat(freightAmount) || 0,
          otherChargesAmount: parseFloat(otherChargesAmount) || 0,
          updateBranchCost: updateGlobalCost,
          updateGlobalCost,
          createPriceReviewAlerts,
          allowOverReceive,
          notes: notes || undefined,
        }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al recibir inventario");
      const data = unwrapApiData(raw);
      const warningCount = Array.isArray(data?.warnings) ? data.warnings.length : 0;
      toast.success(
        `Recibidas ${items.length} línea${items.length === 1 ? "" : "s"}${warningCount ? ` · ${warningCount} alerta${warningCount === 1 ? "" : "s"} de precio` : ""}`,
      );
      await onSubmitted();
      onClose();
    } catch (error) {
      setLocalError(getErrorMessage(error, "Error al recibir inventario"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgb(28_25_23/0.45)] p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-modal)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Recibir pedido ${order.orderNumber}`}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-[1.0625rem] font-bold tracking-tight text-[var(--color-text)]">Recepción de mercadería</h2>
            <p className="text-[0.78rem] text-[var(--color-text-soft)]">
              Pedido {order.orderNumber} · {(order.supplierRef?.name ?? order.supplierNameSnapshot ?? order.supplier) || "sin proveedor"}
            </p>
          </div>
          <button onClick={onClose} className="hm-icon-btn" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {localError && (
            <div className="hm-alert hm-alert-danger text-[0.8125rem]">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {localError}
            </div>
          )}

          <table className="hm-sheet-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="hm-num">Pedida</th>
                <th className="hm-num">Recibida</th>
                <th className="hm-num">Pendiente</th>
                <th className="hm-num">A recibir</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <span className="font-medium text-[var(--color-text)]">{line.product.name}</span>
                    <span className="ml-1.5 font-mono text-[0.68rem] text-[var(--color-text-muted)]">{line.product.sku}</span>
                  </td>
                  <td className="hm-num">{qty(line.quantity)}</td>
                  <td className="hm-num">{qty(line.receivedQuantity ?? 0)}</td>
                  <td className={`hm-num ${(line.pendingQuantity ?? 0) > 0 ? "text-[var(--color-warning-700)]" : ""}`}>{qty(line.pendingQuantity ?? 0)}</td>
                  <td className="hm-num">
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      max={allowOverReceive ? undefined : (line.pendingQuantity ?? 0)}
                      value={quantities[line.id as string] ?? "0"}
                      onChange={(e) => setQuantities((current) => ({ ...current, [line.id as string]: e.target.value }))}
                      className="hm-input w-24 rounded-lg text-right text-sm"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <label className="flex items-start gap-2 text-[0.8125rem] text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={allowOverReceive} onChange={(e) => setAllowOverReceive(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span>
              Permitir sobre-recepción
              <span className="block text-[0.72rem] text-[var(--color-text-muted)]">
                Permite recibir más cantidad de la pendiente (ajustes o mercadería adicional del proveedor).
              </span>
            </span>
          </label>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-[0.8125rem] font-medium text-[var(--color-text-secondary)]">
              Flete de esta recepción
              <input type="number" min="0" step="0.01" value={freightAmount} onChange={(e) => setFreightAmount(e.target.value)} className="hm-input mt-1 w-full rounded-lg text-sm" />
            </label>
            <label className="text-[0.8125rem] font-medium text-[var(--color-text-secondary)]">
              Otros cargos de esta recepción
              <input type="number" min="0" step="0.01" value={otherChargesAmount} onChange={(e) => setOtherChargesAmount(e.target.value)} className="hm-input mt-1 w-full rounded-lg text-sm" />
            </label>
          </div>

          <label className="block text-[0.8125rem] font-medium text-[var(--color-text-secondary)]">
            Notas de esta recepción
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="hm-input mt-1 w-full rounded-lg text-sm" />
          </label>

          <div className="flex flex-wrap gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2.5 text-[0.8125rem] text-[var(--color-text-secondary)]">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={updateGlobalCost} onChange={(e) => setUpdateGlobalCost(e.target.checked)} className="h-4 w-4" />
              Actualizar costo global con la recepción
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={createPriceReviewAlerts} onChange={(e) => setCreatePriceReviewAlerts(e.target.checked)} className="h-4 w-4" />
              Revisar precio vs costo al recibir
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-5 py-4">
          <p className="text-[0.78rem] text-[var(--color-text-soft)]">
            {linesWithQty} línea{linesWithQty === 1 ? "" : "s"} · {qty(totalToReceive)} unidades a recibir
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              Confirmar recepción
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  // Lista operable (Fase B4): filtrado 100% cliente — ver nota en resumen final
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("");

  // Detalle como drawer (Fase C4)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<PurchaseOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  // Modal de recepción parcial (Fase B1)
  const [receiveOrder, setReceiveOrder] = useState<PurchaseOrder | null>(null);

  const [supplierQuery, setSupplierQuery] = useState("");
  const [showSupplierQuickCreate, setShowSupplierQuickCreate] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState({
    name: "",
    ruc: "",
    phone: "",
    email: "",
    contactName: "",
    bankName: "",
    bankAccountNumber: "",
    accountHolder: "",
    paymentTerms: "",
  });

  // Form state
  const [formBranchId, setFormBranchId] = useState("");
  const [formSupplierId, setFormSupplierId] = useState("");
  const [formSupplier, setFormSupplier] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formLines, setFormLines] = useState<PurchaseOrderLineForm[]>([]);
  const [purchaseTaxTreatment, setPurchaseTaxTreatment] = useState<"INCLUDE_IN_COST" | "SEPARATE_CREDIT">("INCLUDE_IN_COST");
  const [freightAmount, setFreightAmount] = useState("0");
  const [otherChargesAmount, setOtherChargesAmount] = useState("0");
  const [globalDiscountAmount, setGlobalDiscountAmount] = useState("0");

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch("/api/master/purchase-orders");
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al cargar pedidos");
      const data = unwrapApiData(raw);
      setOrders(Array.isArray(data) ? data : []);
    } catch (error) {
      setError(getErrorMessage(error, "Error al cargar pedidos"));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMeta = useCallback(async () => {
    try {
      const [branchRes, prodRes, supplierRes] = await Promise.all([
        fetch("/api/master/users"),
        fetch("/api/catalog/products"),
        fetch("/api/suppliers"),
      ]);
      const branchJson = unwrapApiData(await branchRes.json());
      const prodJson = unwrapApiData(await prodRes.json());
      const supplierJson = unwrapApiData(await supplierRes.json());
      if (branchJson?.branches) setBranches(branchJson.branches);
      const prods = Array.isArray(prodJson) ? prodJson : [];
      setProducts(prods);
      setSuppliers(Array.isArray(supplierJson) ? supplierJson : []);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetailLoading(true);
      const res = await apiFetch(`/api/master/purchase-orders/${id}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al cargar el pedido");
      setSelectedOrderDetail(unwrapApiData(raw) as PurchaseOrder);
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al cargar el pedido"));
      setSelectedOrderId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedOrderId) { setSelectedOrderDetail(null); return; }
    loadDetail(selectedOrderId);
  }, [selectedOrderId, loadDetail]);

  async function openReceiveModal(id: string) {
    try {
      setActionLoading(id);
      const res = await apiFetch(`/api/master/purchase-orders/${id}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al cargar el pedido");
      setReceiveOrder(unwrapApiData(raw) as PurchaseOrder);
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al cargar el pedido"));
    } finally {
      setActionLoading(null);
    }
  }

  async function handlePrint(id: string) {
    try {
      await openPrintableDocument(`/api/printing/purchase-orders/${id}/receipt?format=HTML`);
      await recordPrintAudit({ entityType: "PurchaseOrder", entityId: id, documentType: "PURCHASE_RECEIPT" });
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo imprimir el pedido"));
    }
  }

  const openCreate = () => {
    setFormBranchId(branches[0]?.id || "");
    setFormSupplierId("");
    setFormSupplier("");
    setSupplierQuery("");
    setShowSupplierQuickCreate(false);
    setSupplierDraft({ name: "", ruc: "", phone: "", email: "", contactName: "", bankName: "", bankAccountNumber: "", accountHolder: "", paymentTerms: "" });
    setFormNotes("");
    setPurchaseTaxTreatment("INCLUDE_IN_COST");
    setFreightAmount("0");
    setOtherChargesAmount("0");
    setGlobalDiscountAmount("0");
    setFormLines([{ productId: "", quantity: "1", unitCostBeforeTax: "0", taxRate: "15" }]);
    setShowModal(true);
  };

  const handleCreate = async () => {
    try {
      setActionLoading("create");
      setError(null);
      const lines = formLines
        .filter((l) => l.productId)
        .map((l) => ({
          productId: l.productId,
          quantity: parseFloat(l.quantity) || 0,
          unitCostBeforeTax: parseFloat(l.unitCostBeforeTax) || 0,
          taxRate: parseFloat(l.taxRate) || 0,
        }));

      if (!formBranchId) throw new Error("Seleccione una sucursal");
      if (!lines.length) throw new Error("Agregue al menos una línea");

      const invalidLineIndex = lines.findIndex((line) => line.quantity <= 0 || line.unitCostBeforeTax < 0);
      if (invalidLineIndex >= 0) throw new Error(`Revise cantidad y costo de la linea ${invalidLineIndex + 1}.`);

      const res = await apiFetch("/api/master/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: formBranchId,
          supplierId: formSupplierId || undefined,
          supplier: formSupplier || undefined,
          notes: formNotes || undefined,
          purchaseTaxTreatment,
          freightAmount: parseFloat(freightAmount) || 0,
          otherChargesAmount: parseFloat(otherChargesAmount) || 0,
          globalDiscountAmount: parseFloat(globalDiscountAmount) || 0,
          lines,
        }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al crear pedido");

      toast.success("Pedido creado exitosamente");
      setShowModal(false);
      fetchOrders();
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al crear pedido"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleQuickCreateSupplier = async () => {
    try {
      if (!supplierDraft.name.trim()) throw new Error("Nombre del proveedor requerido");
      setActionLoading("supplier");
      const res = await apiFetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(supplierDraft),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al crear proveedor");
      const supplier = unwrapApiData(raw) as Supplier;
      setSuppliers((current) => [supplier, ...current.filter((item) => item.id !== supplier.id)]);
      setFormSupplierId(supplier.id);
      setFormSupplier(supplier.name);
      setSupplierQuery("");
      setShowSupplierQuickCreate(false);
      setSupplierDraft({ name: "", ruc: "", phone: "", email: "", contactName: "", bankName: "", bankAccountNumber: "", accountHolder: "", paymentTerms: "" });
      toast.success("Proveedor creado");
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al crear proveedor"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      setActionLoading(id);
      setError(null);
      const res = await apiFetch(`/api/master/purchase-orders/${id}/approve`, { method: "POST" });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al aprobar");
      toast.success("Pedido aprobado");
      setConfirmApproveId(null);
      await fetchOrders();
      if (selectedOrderId === id) await loadDetail(id);
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al aprobar"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      setActionLoading(id);
      const res = await apiFetch(`/api/master/purchase-orders/${id}/cancel`, { method: "POST" });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al cancelar");
      toast.success("Pedido cancelado");
      setConfirmCancelId(null);
      if (selectedOrderId === id) setSelectedOrderId(null);
      await fetchOrders();
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al cancelar"));
    } finally {
      setActionLoading(null);
    }
  };

  const addLine = () => setFormLines([...formLines, { productId: "", quantity: "1", unitCostBeforeTax: "0", taxRate: "15" }]);
  const removeLine = (idx: number) => setFormLines(formLines.filter((_, i) => i !== idx));
  const updateLine = (idx: number, field: keyof PurchaseOrderLineForm, value: string) => {
    const updated = [...formLines];
    updated[idx] = { ...updated[idx], [field]: value };
    setFormLines(updated);
  };

  const formSubtotalBeforeTax = formLines.reduce((acc, l) => acc + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitCostBeforeTax) || 0), 0);
  const formTaxAmount = formLines.reduce((acc, l) => {
    const unitCostBeforeTax = parseFloat(l.unitCostBeforeTax) || 0;
    const taxRate = parseFloat(l.taxRate) || 0;
    return acc + (parseFloat(l.quantity) || 0) * unitCostBeforeTax * (taxRate / 100);
  }, 0);
  const formTotalPaid = formSubtotalBeforeTax + formTaxAmount + (parseFloat(freightAmount) || 0) + (parseFloat(otherChargesAmount) || 0) - (parseFloat(globalDiscountAmount) || 0);
  const filteredSuppliers = suppliers.filter((supplier) => {
    const q = supplierQuery.trim().toLowerCase();
    if (!q) return true;
    return [supplier.name, supplier.commercialName, supplier.ruc, supplier.phone, supplier.contactName]
      .some((value) => value?.toLowerCase().includes(q));
  });
  const selectedSupplier = suppliers.find((supplier) => supplier.id === formSupplierId) ?? null;
  const estimatedFinalUnitCosts = useMemo(
    () => estimateFinalUnitCosts(formLines, parseFloat(freightAmount) || 0, parseFloat(otherChargesAmount) || 0, parseFloat(globalDiscountAmount) || 0, purchaseTaxTreatment),
    [formLines, freightAmount, otherChargesAmount, globalDiscountAmount, purchaseTaxTreatment],
  );

  // Fase B4: filtros de lista — todo client-side (el endpoint de lista no soporta querystring adicional)
  const scopedOrders = useMemo(() => {
    return orders.filter((o) => {
      if (branchFilter && o.branch.id !== branchFilter) return false;
      if (!withinDateRange(o.date, dateRange)) return false;
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const matchesNumber = o.orderNumber.toLowerCase().includes(q);
        const matchesSupplier = ((o.supplierRef?.name ?? o.supplierNameSnapshot ?? o.supplier) || "").toLowerCase().includes(q);
        if (!matchesNumber && !matchesSupplier) return false;
      }
      return true;
    });
  }, [orders, branchFilter, dateRange, searchQuery]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { "": scopedOrders.length, DRAFT: 0, APPROVED: 0, RECEIVED: 0, CANCELLED: 0 };
    for (const o of scopedOrders) counts[o.status] = (counts[o.status] ?? 0) + 1;
    return counts;
  }, [scopedOrders]);

  const filteredOrders = useMemo(
    () => (statusFilter ? scopedOrders.filter((o) => o.status === statusFilter) : scopedOrders),
    [scopedOrders, statusFilter],
  );

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[1.1875rem] font-bold tracking-[-0.02em] text-[var(--color-text)]">Pedidos de Compra</h1>
          <p className="text-[0.78rem] text-[var(--color-text-muted)]">Crear, aprobar pedidos y recibir mercadería al inventario.</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nuevo pedido
        </button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] px-4 py-3 text-sm text-[var(--color-danger-700)] flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-[var(--color-danger-600)] hover:text-[var(--color-danger-700)]"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Filtros: estado (KPI-filter), búsqueda, sucursal, rango de fecha */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="hm-kpi-filter" data-active={statusFilter === ""} onClick={() => setStatusFilter("")}>
          <b>{statusCounts[""] ?? 0}</b> Todos
        </button>
        <button type="button" className="hm-kpi-filter" data-active={statusFilter === "DRAFT"} onClick={() => setStatusFilter("DRAFT")}>
          <b>{statusCounts.DRAFT ?? 0}</b> Borradores
        </button>
        <button type="button" className="hm-kpi-filter" data-active={statusFilter === "APPROVED"} onClick={() => setStatusFilter("APPROVED")}>
          <b>{statusCounts.APPROVED ?? 0}</b> Aprobados
        </button>
        <button type="button" className="hm-kpi-filter" data-active={statusFilter === "RECEIVED"} onClick={() => setStatusFilter("RECEIVED")}>
          <b>{statusCounts.RECEIVED ?? 0}</b> Recibidos
        </button>
        <button type="button" className="hm-kpi-filter" data-active={statusFilter === "CANCELLED"} onClick={() => setStatusFilter("CANCELLED")}>
          <b>{statusCounts.CANCELLED ?? 0}</b> Cancelados
        </button>

        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-soft)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por número o proveedor..."
            className="hm-input w-full rounded-lg pl-8 text-sm"
          />
        </div>

        <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="hm-input rounded-lg text-sm" aria-label="Filtrar por sucursal">
          <option value="">Todas las sucursales</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.code} · {b.name}</option>
          ))}
        </select>

        <div className="flex gap-1">
          {([["", "Todo"], ["today", "Hoy"], ["7d", "7 días"], ["30d", "30 días"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setDateRange(value)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                dateRange === value
                  ? "border-[var(--color-master-600)] bg-[var(--color-master-50)] text-[var(--color-master-700)]"
                  : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Orders Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" />
          <span className="ml-2 text-sm text-[var(--color-text-muted)]">Cargando pedidos...</span>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <FileText className="h-12 w-12 mx-auto text-[var(--color-text-muted)] mb-3" />
          <p className="text-[var(--color-text-muted)]">{orders.length === 0 ? "No hay pedidos de compra." : "No hay pedidos que coincidan con los filtros."}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-2.5">
            <span className="text-sm font-semibold text-[var(--color-text)]">Pedidos</span>
            <span className="text-xs text-[var(--color-text-muted)]">{filteredOrders.length} de {orders.length}</span>
          </div>
          <table className="hm-sheet-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Sucursal</th>
                <th>Estado</th>
                <th>Recepción</th>
                <th className="hm-num">Total</th>
                <th className="text-center">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr
                  key={order.id}
                  className={`cursor-pointer ${selectedOrderId === order.id ? "bg-[var(--color-master-50)]" : ""}`}
                  onClick={() => setSelectedOrderId(order.id)}
                >
                  <td className="font-mono text-xs font-bold text-[var(--color-text)]">
                    {order.orderNumber}
                  </td>
                  <td className="hm-num">{fmtDate(order.date)}</td>
                  <td className="text-[var(--color-text)]">{(order.supplierRef?.name ?? order.supplierNameSnapshot ?? order.supplier) || <span className="text-[var(--color-text-muted)]">—</span>}</td>
                  <td>
                    <span className="inline-flex items-center justify-center rounded-lg bg-[var(--color-master-50)] px-2 py-0.5 text-xs font-bold text-[var(--color-master-700)]">
                      {order.branch.code}
                    </span>
                  </td>
                  <td><StatusBadge status={order.status} receptionState={order.receptionState} /></td>
                  <td>
                    {order.status === "APPROVED" && order.receptionState === "PARTIAL" ? (
                      <span className="text-xs text-[var(--color-warning-700)]">Parcial</span>
                    ) : null}
                  </td>
                  <td className="hm-num font-semibold text-[var(--color-text)]">
                    {money(order.total)}
                  </td>
                  <td className="text-center" onClick={(e) => e.stopPropagation()}>
                    {confirmApproveId === order.id ? (
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => handleApprove(order.id)} disabled={actionLoading === order.id} className="hm-icon-btn text-[var(--color-success-600)]" title="Confirmar aprobación">
                          {actionLoading === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                        </button>
                        <button onClick={() => setConfirmApproveId(null)} className="hm-icon-btn" title="Cancelar"><X className="h-4 w-4" /></button>
                      </div>
                    ) : confirmCancelId === order.id ? (
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => handleCancel(order.id)} disabled={actionLoading === order.id} className="hm-icon-btn hm-icon-btn-danger" title="Confirmar cancelación">
                          {actionLoading === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                        </button>
                        <button onClick={() => setConfirmCancelId(null)} className="hm-icon-btn" title="Volver"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setSelectedOrderId(order.id)} className="hm-icon-btn" title="Ver detalle">
                          <Eye className="h-4 w-4" />
                        </button>
                        {order.status === "DRAFT" && (
                          <>
                            <button onClick={() => setConfirmApproveId(order.id)} className="hm-icon-btn text-[var(--color-success-600)]" title="Aprobar">
                              <CheckCircle className="h-4 w-4" />
                            </button>
                            <button onClick={() => setConfirmCancelId(order.id)} className="hm-icon-btn hm-icon-btn-danger" title="Cancelar">
                              <Ban className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {order.status === "APPROVED" && (
                          <button onClick={() => openReceiveModal(order.id)} disabled={actionLoading === order.id} className="hm-icon-btn text-[var(--color-info-700)]" title="Recibir inventario">
                            {actionLoading === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                          </button>
                        )}
                        {(order.status === "APPROVED" || order.status === "RECEIVED") && (
                          <button onClick={() => handlePrint(order.id)} className="hm-icon-btn" title="Imprimir recepción">
                            <Printer className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Drawer (Fase C4) */}
      {selectedOrderId && (
        <>
          <div className="fixed inset-0 z-40 bg-[rgb(28_25_23/0.45)] transition-opacity duration-200" onClick={() => setSelectedOrderId(null)} aria-hidden="true" />
          <aside
            className="fixed bottom-0 right-0 top-0 z-50 flex w-[min(720px,100vw)] flex-col border-l border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-modal)] transition-transform duration-300 motion-reduce:transition-none"
            style={{ transitionTimingFunction: "var(--ease-drawer)" }}
            role="dialog"
            aria-modal="true"
            aria-label={selectedOrderDetail ? `Pedido ${selectedOrderDetail.orderNumber}` : "Detalle de pedido"}
          >
            <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 pb-4 pt-5">
              <ReceiptText className="h-5 w-5 text-[var(--color-text-muted)]" />
              <div className="min-w-0">
                <h2 className="truncate text-[1.0625rem] font-bold tracking-tight text-[var(--color-text)]">
                  Pedido {selectedOrderDetail?.orderNumber ?? "…"}
                </h2>
                {selectedOrderDetail && <StatusBadge status={selectedOrderDetail.status} receptionState={selectedOrderDetail.receptionState} />}
              </div>
              <button onClick={() => setSelectedOrderId(null)} className="hm-icon-btn ml-auto" aria-label="Cerrar detalle"><X className="h-4 w-4" /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {detailLoading && !selectedOrderDetail ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-[var(--color-master-500)]" />
                </div>
              ) : selectedOrderDetail ? (
                <>
                  {/* Resumen */}
                  <section className="mb-6">
                    <h4 className="hm-section-rule mb-2.5">Resumen</h4>
                    <div className="space-y-1.5 text-[0.8125rem]">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[var(--color-text-secondary)]"><Truck className="h-3.5 w-3.5" />Proveedor</span>
                        <span className="font-medium text-[var(--color-text)]">{(selectedOrderDetail.supplierRef?.name ?? selectedOrderDetail.supplierNameSnapshot ?? selectedOrderDetail.supplier) || "—"}</span>
                      </div>
                      {selectedOrderDetail.supplierRef?.phone && (
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--color-text-secondary)]">Teléfono</span>
                          <span className="text-[var(--color-text)]">{selectedOrderDetail.supplierRef.phone}</span>
                        </div>
                      )}
                      {selectedOrderDetail.supplierRef?.ruc && (
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--color-text-secondary)]">RUC</span>
                          <span className="text-[var(--color-text)]">{selectedOrderDetail.supplierRef.ruc}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[var(--color-text-secondary)]"><Building2 className="h-3.5 w-3.5" />Sucursal</span>
                        <span className="font-medium text-[var(--color-text)]">{selectedOrderDetail.branch.code} — {selectedOrderDetail.branch.name}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-text-secondary)]">Creado por</span>
                        <span className="text-[var(--color-text)]">{selectedOrderDetail.createdBy.fullName || selectedOrderDetail.createdBy.username} · {fmtDateTime(selectedOrderDetail.createdAt)}</span>
                      </div>
                    </div>

                    <div className="mt-3 rounded-lg bg-[var(--color-surface-muted)] p-3 text-[0.8125rem]">
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-text-secondary)]">Modo IVA</span>
                        <span className="text-[var(--color-text)]">{selectedOrderDetail.purchaseTaxTreatment === "SEPARATE_CREDIT" ? "Crédito fiscal" : "Incluido en costo"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-text-secondary)]">Subtotal sin IVA</span>
                        <span className="hm-num text-[var(--color-text)]">{money(selectedOrderDetail.subtotalBeforeTax ?? 0)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-text-secondary)]">IVA</span>
                        <span className="hm-num text-[var(--color-text)]">{money(selectedOrderDetail.taxAmount ?? 0)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-text-secondary)]">Flete / otros</span>
                        <span className="hm-num text-[var(--color-text)]">{money(Number(selectedOrderDetail.freightAmount ?? 0) + Number(selectedOrderDetail.otherChargesAmount ?? 0))}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-text-secondary)]">Descuento</span>
                        <span className="hm-num text-[var(--color-danger-600)]">{money(selectedOrderDetail.globalDiscountAmount ?? 0)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between border-t border-[var(--color-border)] pt-2">
                        <span className="font-semibold text-[var(--color-text-secondary)]">Total</span>
                        <span className="hm-num text-[1.125rem] font-extrabold text-[var(--color-text)]">{money(selectedOrderDetail.total)}</span>
                      </div>
                    </div>
                  </section>

                  {/* Líneas */}
                  <section className="mb-6">
                    <h4 className="hm-section-rule mb-2.5">Líneas</h4>
                    <table className="hm-sheet-table">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th className="hm-num">Cant.</th>
                          <th className="hm-num">Recibida</th>
                          <th className="hm-num">Pendiente</th>
                          <th className="hm-num">Costo final</th>
                          <th className="hm-num">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedOrderDetail.lines.map((line, i) => (
                          <tr key={line.id ?? i}>
                            <td>
                              <span className="font-medium text-[var(--color-text)]">{line.product.name}</span>
                              <span className="ml-1.5 font-mono text-[0.68rem] text-[var(--color-text-muted)]">{line.product.sku}</span>
                            </td>
                            <td className="hm-num">{qty(line.quantity)}</td>
                            <td className="hm-num">{qty(line.receivedQuantity ?? 0)}</td>
                            <td className={`hm-num ${(line.pendingQuantity ?? 0) > 0 ? "text-[var(--color-warning-700)]" : ""}`}>{qty(line.pendingQuantity ?? 0)}</td>
                            <td className="hm-num">{money(line.finalUnitCost ?? line.unitCost)}</td>
                            <td className="hm-num font-semibold text-[var(--color-text)]">{money(line.subtotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>

                  {/* Notas */}
                  {selectedOrderDetail.notes && (
                    <section className="mb-6">
                      <h4 className="hm-section-rule mb-2.5">Notas</h4>
                      <p className="rounded-lg bg-[var(--color-surface-muted)] p-3 text-[0.8125rem] text-[var(--color-text-secondary)]">{selectedOrderDetail.notes}</p>
                    </section>
                  )}

                  {/* Acciones */}
                  <section>
                    <h4 className="hm-section-rule mb-2.5">Acciones</h4>

                    {confirmApproveId === selectedOrderDetail.id ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-info-200)] bg-[var(--color-info-50)] px-3 py-2 text-sm">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-[var(--color-info-700)]" />
                        <span className="text-[var(--color-info-700)]">¿Aprobar este pedido? El inventario se recibirá en un paso separado.</span>
                        <button onClick={() => handleApprove(selectedOrderDetail.id)} disabled={actionLoading === selectedOrderDetail.id} className="ml-auto rounded-lg bg-[var(--color-success-600)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-success-700)] disabled:opacity-50">
                          Confirmar
                        </button>
                        <button onClick={() => setConfirmApproveId(null)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">
                          Cancelar
                        </button>
                      </div>
                    ) : confirmCancelId === selectedOrderDetail.id ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] px-3 py-2 text-sm">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-[var(--color-danger-700)]" />
                        <span className="text-[var(--color-danger-700)]">¿Cancelar este pedido? Esta acción no se puede deshacer.</span>
                        <button onClick={() => handleCancel(selectedOrderDetail.id)} disabled={actionLoading === selectedOrderDetail.id} className="ml-auto rounded-lg bg-[var(--color-danger-600)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-danger-700)] disabled:opacity-50">
                          Confirmar
                        </button>
                        <button onClick={() => setConfirmCancelId(null)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {selectedOrderDetail.status === "DRAFT" && (
                          <button onClick={() => setConfirmApproveId(selectedOrderDetail.id)} className="flex items-center gap-2 rounded-lg bg-[var(--color-success-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-success-700)]">
                            <CheckCircle className="h-4 w-4" /> Aprobar
                          </button>
                        )}
                        {selectedOrderDetail.status === "APPROVED" && (
                          <button
                            onClick={() => openReceiveModal(selectedOrderDetail.id)}
                            disabled={actionLoading === selectedOrderDetail.id}
                            className="flex items-center gap-2 rounded-lg bg-[var(--color-info-700)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-info-800)] disabled:opacity-50"
                          >
                            {actionLoading === selectedOrderDetail.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Recibir
                          </button>
                        )}
                        {(selectedOrderDetail.status === "APPROVED" || selectedOrderDetail.status === "RECEIVED") && (
                          <button onClick={() => handlePrint(selectedOrderDetail.id)} className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">
                            <Printer className="h-4 w-4" /> Imprimir
                          </button>
                        )}
                        {selectedOrderDetail.status === "DRAFT" && (
                          <button onClick={() => setConfirmCancelId(selectedOrderDetail.id)} className="ml-auto flex items-center gap-2 rounded-lg border border-[var(--color-danger-200)] px-4 py-2 text-sm font-semibold text-[var(--color-danger-600)] hover:bg-[var(--color-danger-50)]">
                            <Ban className="h-4 w-4" /> Cancelar
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                </>
              ) : null}
            </div>
          </aside>
        </>
      )}

      {/* Receive Modal (Fase B1) */}
      {receiveOrder && (
        <ReceivePurchaseOrderModal
          order={receiveOrder}
          onClose={() => setReceiveOrder(null)}
          onSubmitted={async () => {
            await fetchOrders();
            if (selectedOrderId === receiveOrder.id) await loadDetail(receiveOrder.id);
          }}
        />
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(28_25_23/0.45)] p-4">
          <div className="w-full max-w-6xl max-h-[92vh] overflow-y-auto rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-strong)] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--color-text)]"><ShoppingCart className="h-5 w-5" /> Crear pedido de compra</h2>
                <p className="text-xs text-[var(--color-text-muted)]">Compra a proveedor para recepcion futura de inventario.</p>
              </div>
              <button onClick={() => setShowModal(false)} className="hm-icon-btn"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-5">
            <div className="hm-alert hm-alert-warning">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              Para inventario existente inicial, usa Existencias / Carga inicial. No crees pedidos falsos.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Sucursal Destino</label>
                <select
                  value={formBranchId}
                  onChange={(e) => setFormBranchId(e.target.value)}
                  className="hm-input w-full rounded-lg text-sm"
                >
                  <option value="">Seleccionar...</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Proveedor</label>
                <div className="flex gap-2">
                  <select
                    value={formSupplierId}
                    onChange={(e) => {
                      const supplier = suppliers.find((item) => item.id === e.target.value) ?? null;
                      setFormSupplierId(e.target.value);
                      setFormSupplier(supplier?.name ?? "");
                    }}
                    className="hm-input min-w-0 flex-1 rounded-lg text-sm"
                  >
                    <option value="">Sin proveedor registrado</option>
                    {filteredSuppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.ruc ? ` · ${supplier.ruc}` : ""}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowSupplierQuickCreate((value) => !value)}
                    className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
                    title="Registrar proveedor"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <input
                  type="search"
                  value={supplierQuery}
                  onChange={(e) => setSupplierQuery(e.target.value)}
                  placeholder="Buscar proveedor por nombre, RUC o teléfono"
                  className="hm-input mt-2 w-full rounded-lg text-sm"
                />
              </div>
            </div>

            {selectedSupplier && (
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-xs md:grid-cols-4">
                <div><span className="font-bold text-[var(--color-text-secondary)]">Contacto</span><p>{selectedSupplier.contactName || selectedSupplier.phone || "—"}</p></div>
                <div><span className="font-bold text-[var(--color-text-secondary)]">RUC</span><p>{selectedSupplier.ruc || "—"}</p></div>
                <div><span className="font-bold text-[var(--color-text-secondary)]">Banco</span><p>{selectedSupplier.bankName || "—"}</p></div>
                <div><span className="font-bold text-[var(--color-text-secondary)]">Cuenta / plazo</span><p>{selectedSupplier.bankAccountNumber || selectedSupplier.paymentTerms || "—"}</p></div>
              </div>
            )}

            {showSupplierQuickCreate && (
              <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">Registrar proveedor</h3>
                  <button type="button" onClick={() => setShowSupplierQuickCreate(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><X className="h-4 w-4" /></button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {([
                    ["name", "Nombre"],
                    ["ruc", "RUC"],
                    ["phone", "Teléfono"],
                    ["email", "Email"],
                    ["contactName", "Contacto"],
                    ["bankName", "Banco"],
                    ["bankAccountNumber", "Cuenta bancaria"],
                    ["accountHolder", "Titular"],
                    ["paymentTerms", "Plazo de pago"],
                  ] as const).map(([field, label]) => (
                    <label key={field} className="text-xs font-medium text-[var(--color-text-secondary)]">
                      {label}
                      <input
                        value={supplierDraft[field]}
                        onChange={(e) => setSupplierDraft((draft) => ({ ...draft, [field]: e.target.value }))}
                        className="hm-input mt-1 w-full rounded-lg text-sm"
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={handleQuickCreateSupplier}
                    disabled={actionLoading === "supplier"}
                    className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] disabled:opacity-50"
                  >
                    {actionLoading === "supplier" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Guardar proveedor
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Notas</label>
              <textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={2}
                className="hm-input w-full rounded-lg text-sm"
              />
            </div>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                <DollarSign className="h-4 w-4" /> Configuracion de costos
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <label className="text-sm font-medium text-[var(--color-text-secondary)] md:col-span-2">
                  Modo IVA
                  <select
                    value={purchaseTaxTreatment}
                    onChange={(e) => setPurchaseTaxTreatment(e.target.value as "INCLUDE_IN_COST" | "SEPARATE_CREDIT")}
                    className="hm-input mt-1 w-full rounded-lg text-sm"
                  >
                    <option value="INCLUDE_IN_COST">Incluir IVA en costo del producto</option>
                    <option value="SEPARATE_CREDIT">Separar IVA como credito fiscal</option>
                  </select>
                </label>
                <label className="text-sm font-medium text-[var(--color-text-secondary)]">
                  Flete
                  <input type="number" min="0" step="0.01" value={freightAmount} onChange={(e) => setFreightAmount(e.target.value)} className="hm-input mt-1 w-full rounded-lg text-sm" />
                </label>
                <label className="text-sm font-medium text-[var(--color-text-secondary)]">
                  Otros cargos
                  <input type="number" min="0" step="0.01" value={otherChargesAmount} onChange={(e) => setOtherChargesAmount(e.target.value)} className="hm-input mt-1 w-full rounded-lg text-sm" />
                </label>
                <label className="text-sm font-medium text-[var(--color-text-secondary)]">
                  Descuento global
                  <input type="number" min="0" step="0.01" value={globalDiscountAmount} onChange={(e) => setGlobalDiscountAmount(e.target.value)} className="hm-input mt-1 w-full rounded-lg text-sm" />
                </label>
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                El flete y otros cargos se distribuyen entre lineas para calcular costo aterrizado. El modo por defecto incluye el IVA de compra en el costo real del producto.
              </p>
            </div>

            <div
              className="sticky top-0 z-10 grid gap-2 rounded-xl border border-[var(--color-border-strong)] p-3 shadow-sm backdrop-blur md:grid-cols-6"
              style={{ background: "color-mix(in srgb, var(--color-surface) 92%, transparent)" }}
            >
              <div className="text-xs"><span className="text-[var(--color-text-muted)]">Lineas</span><p className="hm-num font-bold">{formLines.filter((line) => line.productId).length}</p></div>
              <div className="text-xs"><span className="text-[var(--color-text-muted)]">Subtotal</span><p className="hm-num font-bold">{money(formSubtotalBeforeTax)}</p></div>
              <div className="text-xs"><span className="text-[var(--color-text-muted)]">IVA</span><p className="hm-num font-bold">{money(formTaxAmount)}</p></div>
              <div className="text-xs"><span className="text-[var(--color-text-muted)]">Cargos</span><p className="hm-num font-bold">{money((parseFloat(freightAmount) || 0) + (parseFloat(otherChargesAmount) || 0))}</p></div>
              <div className="text-xs"><span className="text-[var(--color-text-muted)]">Descuento</span><p className="hm-num font-bold text-[var(--color-danger-600)]">{money(parseFloat(globalDiscountAmount) || 0)}</p></div>
              <div className="text-xs"><span className="text-[var(--color-text-muted)]">Total estimado</span><p className="hm-num text-base font-extrabold">{money(formTotalPaid)}</p></div>
            </div>

            {/* Lines */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">Líneas del Pedido</h3>
                <button
                  onClick={addLine}
                  className="flex items-center gap-1 text-xs font-medium text-[var(--color-master-600)] hover:text-[var(--color-master-700)]"
                >
                  <Plus className="h-3.5 w-3.5" /> Agregar línea
                </button>
              </div>

              {formLines.map((line, idx) => {
                const selectedProduct = products.find((p) => p.id === line.productId) ?? null;
                const usedElsewhere = !!line.productId && formLines.filter((l) => l.productId === line.productId).length > 1;
                const lineSubtotal = (parseFloat(line.quantity) || 0) * (parseFloat(line.unitCostBeforeTax) || 0);
                return (
                  <div key={idx} className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--color-border)] p-3 md:grid-cols-12 md:items-end md:border-0 md:p-0">
                    <div className="md:col-span-4">
                      {idx === 0 && <label className="block text-xs text-[var(--color-text-muted)] mb-1">Producto</label>}
                      <ProductCombobox products={products} value={selectedProduct} onSelect={(p) => updateLine(idx, "productId", p.id)} />
                      {selectedProduct && <p className="mt-1 text-[0.68rem] text-[var(--color-text-muted)]">Unidad: {selectedProduct.unit}</p>}
                      {usedElsewhere && <p className="mt-1 text-[0.68rem] text-[var(--color-warning-700)]">Este producto ya está en otra línea.</p>}
                    </div>
                    <div className="md:col-span-2">
                      {idx === 0 && <label className="block text-xs text-[var(--color-text-muted)] mb-1">Cantidad</label>}
                      <input
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={(e) => updateLine(idx, "quantity", e.target.value)}
                        className="hm-input w-full rounded-lg text-sm"
                      />
                    </div>
                    <div className="md:col-span-2">
                      {idx === 0 && <label className="block text-xs text-[var(--color-text-muted)] mb-1">Costo sin IVA</label>}
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitCostBeforeTax}
                        onChange={(e) => updateLine(idx, "unitCostBeforeTax", e.target.value)}
                        className="hm-input w-full rounded-lg text-sm"
                      />
                    </div>
                    <div className="md:col-span-1">
                      {idx === 0 && <label className="block text-xs text-[var(--color-text-muted)] mb-1">IVA %</label>}
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.taxRate}
                        onChange={(e) => updateLine(idx, "taxRate", e.target.value)}
                        className="hm-input w-full rounded-lg text-sm"
                      />
                    </div>
                    <div className="md:col-span-2 md:text-right">
                      {idx === 0 && <label className="block text-xs text-[var(--color-text-muted)] mb-1">Subtotal</label>}
                      <span className="hm-num block text-sm font-medium text-[var(--color-text)]">{money(lineSubtotal)}</span>
                      <span className="block text-[0.65rem] text-[var(--color-text-muted)]">Costo final unit. estimado: {money(estimatedFinalUnitCosts[idx] ?? 0)}</span>
                    </div>
                    <div className="flex justify-end md:col-span-1 md:justify-center">
                      {formLines.length > 1 && (
                        <button onClick={() => removeLine(idx)} className="hm-icon-btn hm-icon-btn-danger" title="Quitar línea">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="flex justify-end border-t border-[var(--color-border)] pt-3">
                <div className="text-right text-sm">
                  <p className="text-[var(--color-text-muted)]">Subtotal sin IVA: <span className="hm-num inline-block">{money(formSubtotalBeforeTax)}</span></p>
                  <p className="text-[var(--color-text-muted)]">IVA: <span className="hm-num inline-block">{money(formTaxAmount)}</span></p>
                  <p className="text-lg font-bold text-[var(--color-text)]">Total pagado: <span className="hm-num inline-block">{money(formTotalPaid)}</span></p>
                </div>
              </div>
            </div>
            </div>{/* end p-6 */}

            <div className="flex justify-end gap-3 border-t border-[var(--color-border)] px-6 py-4 bg-[var(--color-surface-alt)]">
              <button
                onClick={() => setShowModal(false)}
                className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-5 py-2.5 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] shadow-md hover:shadow-lg transition-all"
              >
                <X className="h-4 w-4" />
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={actionLoading === "create"}
                className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] shadow-md hover:shadow-lg transition-all disabled:opacity-50"
              >
                {actionLoading === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                Crear Pedido
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
