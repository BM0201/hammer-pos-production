"use client";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
  Package,
  Plus,
  CheckCircle,
  XCircle,
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
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, fmtDateTime } from "@/lib/format";

/* ── Types ── */
type Product = { id: string; sku: string; name: string; unit: string };
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
};
type PurchaseOrder = {
  id: string;
  orderNumber: string;
  date: string;
  supplier: string | null;
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
};
type Branch = { id: string; code: string; name: string };
type PurchaseOrderLineForm = { productId: string; quantity: string; unitCostBeforeTax: string; taxRate: string };

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/* ── Status Badge ── */
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    DRAFT: { bg: "bg-[var(--color-warning-100)]", text: "text-[var(--color-warning-700)]", label: "Borrador" },
    PENDING: { bg: "bg-orange-100", text: "text-orange-800", label: "Pendiente" },
    APPROVED: { bg: "bg-[var(--color-success-50)]", text: "text-[var(--color-success-700)]", label: "Aprobado" },
    RECEIVED: { bg: "bg-[var(--color-info-50)]", text: "text-[var(--color-info-700)]", label: "Recibido" },
    CANCELLED: { bg: "bg-[var(--color-danger-50)]", text: "text-[var(--color-danger-700)]", label: "Cancelado" },
  };
  const c = cfg[status] || { bg: "bg-[var(--color-surface-alt)]", text: "text-[var(--color-text)]", label: status };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

/* ── Main Page ── */
export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Form state
  const [formBranchId, setFormBranchId] = useState("");
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
      const url = filterStatus
        ? `/api/master/purchase-orders?status=${filterStatus}`
        : "/api/master/purchase-orders";
      const res = await fetch(url);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al cargar pedidos");
      const orders = unwrapApiData(raw);
      setOrders(Array.isArray(orders) ? orders : []);
    } catch (error) {
      setError(getErrorMessage(error, "Error al cargar pedidos"));
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  const fetchMeta = useCallback(async () => {
    try {
      const [branchRes, prodRes] = await Promise.all([
        fetch("/api/master/users"),
        fetch("/api/catalog/products"),
      ]);
      const branchJson = unwrapApiData(await branchRes.json());
      const prodJson = unwrapApiData(await prodRes.json());
      if (branchJson?.branches) setBranches(branchJson.branches);
      const prods = Array.isArray(prodJson) ? prodJson : [];
      setProducts(prods);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  const openCreate = () => {
    setFormBranchId(branches[0]?.id || "");
    setFormSupplier("");
    setFormNotes("");
    setPurchaseTaxTreatment("INCLUDE_IN_COST");
    setFreightAmount("0");
    setOtherChargesAmount("0");
    setGlobalDiscountAmount("0");
    setFormLines([{ productId: "", quantity: "1", unitCostBeforeTax: "0", taxRate: "15" }]);
    setShowModal(true);
    setSelectedOrder(null);
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

      const res = await apiFetch("/api/master/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: formBranchId,
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

      toast.success("✅ Pedido creado exitosamente");
      setShowModal(false);
      fetchOrders();
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al crear pedido"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = async (id: string) => {
    if (!confirm("¿Aprobar este pedido? El inventario se recibirá en un paso separado.")) return;
    try {
      setActionLoading(id);
      setError(null);
      const res = await apiFetch(`/api/master/purchase-orders/${id}/approve`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? e.message ?? "Error al aprobar"); }
      toast.success("✅ Pedido aprobado");
      fetchOrders();
      setSelectedOrder(null);
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al aprobar"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleReceive = async (id: string) => {
    if (!confirm("¿Recibir inventario de este pedido?")) return;
    try {
      setActionLoading(id);
      setError(null);
      const res = await apiFetch(`/api/master/purchase-orders/${id}/receive`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? e.message ?? "Error al recibir inventario"); }
      toast.success("✅ Inventario recibido");
      fetchOrders();
      setSelectedOrder(null);
    } catch (error) {
      toast.error(getErrorMessage(error, "Error al recibir inventario"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm("¿Cancelar este pedido?")) return;
    try {
      setActionLoading(id);
      const res = await apiFetch(`/api/master/purchase-orders/${id}/cancel`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? e.message ?? "Error al cancelar"); }
      toast.success("Pedido cancelado");
      fetchOrders();
      setSelectedOrder(null);
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

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="h-8 w-1 rounded-full"
            style={{
              background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))",
            }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">
              Pedidos de Compra
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              Crear, aprobar pedidos y recibir mercadería al inventario.
            </p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] transition-colors"
        >
          <Plus className="h-4 w-4" />
          Crear Pedido
        </button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] px-4 py-3 text-sm text-[var(--color-danger-700)] flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-[var(--color-danger-600)] hover:text-[var(--color-danger-700)]"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 text-sm">
        {["", "DRAFT", "APPROVED", "RECEIVED", "CANCELLED"].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`rounded-lg border px-3 py-1.5 font-medium transition-colors ${
              filterStatus === s
                ? "bg-[var(--color-master-600)] text-white border-[var(--color-master-600)]"
                : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"
            }`}
          >
            {s === "" ? "Todos" : s === "DRAFT" ? "Borradores" : s === "APPROVED" ? "Aprobados" : s === "RECEIVED" ? "Recibidos" : "Cancelados"}
          </button>
        ))}
      </div>

      {/* Orders Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" />
          <span className="ml-2 text-sm text-[var(--color-text-muted)]">Cargando pedidos...</span>
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <FileText className="h-12 w-12 mx-auto text-[var(--color-text-muted)] mb-3" />
          <p className="text-[var(--color-text-muted)]">No hay pedidos de compra.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
          <div className="hm-card-header-green px-5 py-3 flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            <h2 className="font-semibold">Pedidos de Compra</h2>
            <span className="ml-auto text-xs opacity-80">{orders.length} registros</span>
          </div>
          <table className="hm-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Sucursal</th>
                <th>Estado</th>
                <th className="text-right">Total</th>
                <th className="text-center">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr
                  key={order.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedOrder(order)}
                >
                  <td className="font-mono text-xs font-bold text-[var(--color-text)]">
                    {order.orderNumber}
                  </td>
                  <td className="text-[var(--color-text-secondary)]">
                    {fmtDateTime(order.date)}
                  </td>
                  <td className="text-[var(--color-text)]">{order.supplier || <span className="text-[var(--color-text-muted)]">—</span>}</td>
                  <td>
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[var(--color-master-50)] text-[var(--color-master-700)] text-xs font-bold">
                      {order.branch.code}
                    </span>
                  </td>
                  <td><StatusBadge status={order.status} /></td>
                  <td className="text-right font-mono font-semibold text-[var(--color-text)]">
                    {money(order.total)}
                  </td>
                  <td className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); }}
                        className="rounded-lg p-1.5 text-[var(--color-info-600)] hover:bg-[var(--color-info-50)] transition-colors"
                        title="Ver detalle"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {order.status === "DRAFT" && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleApprove(order.id); }}
                            disabled={actionLoading === order.id}
                            className="rounded-lg p-1.5 text-[var(--color-success-600)] hover:bg-[var(--color-success-50)] transition-colors disabled:opacity-50"
                            title="Aprobar"
                          >
                            {actionLoading === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCancel(order.id); }}
                            disabled={actionLoading === order.id}
                            className="rounded-lg p-1.5 text-[var(--color-danger-600)] hover:bg-[var(--color-danger-50)] transition-colors disabled:opacity-50"
                            title="Cancelar"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      {order.status === "APPROVED" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleReceive(order.id); }}
                          disabled={actionLoading === order.id}
                          className="rounded-lg p-1.5 text-[var(--color-info-700)] hover:bg-[var(--color-info-50)] transition-colors disabled:opacity-50"
                          title="Recibir inventario"
                        >
                          {actionLoading === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Panel */}
      {selectedOrder && (
        <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-md">
          <div className="hm-card-header-amber px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ReceiptText className="h-5 w-5" />
              <h2 className="font-semibold">Pedido {selectedOrder.orderNumber}</h2>
              <StatusBadge status={selectedOrder.status} />
            </div>
            <button onClick={() => setSelectedOrder(null)} className="text-white/80 hover:text-white transition-colors"><X className="h-5 w-5" /></button>
          </div>

          <div className="p-5 space-y-4">
            {/* Meta */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <p className="text-xs font-bold uppercase text-slate-600 mb-1"><Truck className="h-3 w-3 inline mr-1" />Proveedor</p>
                <p className="font-semibold text-[var(--color-text)]">{selectedOrder.supplier || "—"}</p>
              </div>
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
                <p className="text-xs font-bold uppercase text-blue-600 mb-1"><Building2 className="h-3 w-3 inline mr-1" />Sucursal</p>
                <p className="font-semibold text-[var(--color-text)]">{selectedOrder.branch.code} — {selectedOrder.branch.name}</p>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <p className="text-xs font-bold uppercase text-slate-600 mb-1">Creado por</p>
                <p className="font-medium text-[var(--color-text)]">{selectedOrder.createdBy.fullName || selectedOrder.createdBy.username}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{fmtDateTime(selectedOrder.createdAt)}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                <p className="text-xs font-bold uppercase text-emerald-600 mb-1"><DollarSign className="h-3 w-3 inline mr-1" />Total</p>
                <p className="text-xl font-extrabold text-[var(--color-text)]">{money(selectedOrder.total)}</p>
              </div>
            </div>

            {/* Financial breakdown */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] p-3 text-xs">
              <div><span className="font-bold text-[var(--color-text-secondary)]">Modo IVA</span><p className="font-medium text-[var(--color-text)]">{selectedOrder.purchaseTaxTreatment === "SEPARATE_CREDIT" ? "Crédito fiscal" : "Incluido en costo"}</p></div>
              <div><span className="font-bold text-[var(--color-text-secondary)]">Subtotal sin IVA</span><p className="font-medium text-[var(--color-text)]">{money(selectedOrder.subtotalBeforeTax ?? 0)}</p></div>
              <div><span className="font-bold text-[var(--color-text-secondary)]">IVA</span><p className="font-medium text-[var(--color-text)]">{money(selectedOrder.taxAmount ?? 0)}</p></div>
              <div><span className="font-bold text-[var(--color-text-secondary)]">Flete / otros</span><p className="font-medium text-[var(--color-text)]">{money((Number(selectedOrder.freightAmount ?? 0) + Number(selectedOrder.otherChargesAmount ?? 0)))}</p></div>
              <div><span className="font-bold text-[var(--color-text-secondary)]">Descuento</span><p className="font-medium text-red-600">{money(selectedOrder.globalDiscountAmount ?? 0)}</p></div>
            </div>

            {selectedOrder.notes && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-[var(--color-text-secondary)] flex items-start gap-2">
                <FileText className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                {selectedOrder.notes}
              </div>
            )}

            {/* Lines table */}
            <table className="hm-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>SKU</th>
                  <th className="text-right">Cant.</th>
                  <th className="text-right">Costo s/IVA</th>
                  <th className="text-right">IVA unit.</th>
                  <th className="text-right">Costo c/IVA</th>
                  <th className="text-right">Costo final</th>
                  <th className="text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {selectedOrder.lines.map((line, i) => (
                  <tr key={i}>
                    <td className="font-medium text-[var(--color-text)]">{line.product.name}</td>
                    <td className="font-mono text-xs text-[var(--color-text-muted)]">{line.product.sku}</td>
                    <td className="text-right font-mono">{Number(line.quantity)}</td>
                    <td className="text-right font-mono">{money(line.unitCostBeforeTax ?? line.unitCost)}</td>
                    <td className="text-right font-mono">{money(line.unitTaxAmount ?? 0)}</td>
                    <td className="text-right font-mono">{money(line.costWithTax ?? line.unitCost)}</td>
                    <td className="text-right font-mono">{money(line.finalUnitCost ?? line.unitCost)}</td>
                    <td className="text-right font-mono font-bold text-[var(--color-text)]">{money(line.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Actions */}
            {(selectedOrder.status === "DRAFT" || selectedOrder.status === "APPROVED") && (
              <div className="flex gap-3 pt-2 border-t border-[var(--color-border)]">
                {selectedOrder.status === "DRAFT" && (
                  <>
                    <button
                      onClick={() => handleApprove(selectedOrder.id)}
                      disabled={!!actionLoading}
                      className="flex items-center gap-2 rounded-lg bg-[var(--color-success-600)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-success-700)] shadow-md hover:shadow-lg transition-all disabled:opacity-50"
                    >
                      {actionLoading === selectedOrder.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                      Aprobar Pedido
                    </button>
                    <button
                      onClick={() => handleCancel(selectedOrder.id)}
                      disabled={!!actionLoading}
                      className="flex items-center gap-2 rounded-lg bg-[var(--color-danger-600)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-danger-700)] shadow-md hover:shadow-lg transition-all disabled:opacity-50"
                    >
                      <Ban className="h-4 w-4" /> Cancelar
                    </button>
                  </>
                )}
                {selectedOrder.status === "APPROVED" && (
                  <button
                    onClick={() => handleReceive(selectedOrder.id)}
                    disabled={!!actionLoading}
                    className="flex items-center gap-2 rounded-lg bg-[var(--color-info-700)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-info-800)] shadow-md hover:shadow-lg transition-all disabled:opacity-50"
                  >
                    {actionLoading === selectedOrder.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                    Recibir Inventario
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-strong)] shadow-2xl overflow-hidden">
            <div className="hm-card-header-green px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2"><ShoppingCart className="h-5 w-5" /> Crear Pedido de Compra</h2>
              <button onClick={() => setShowModal(false)} className="text-white/80 hover:text-white transition-colors"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-5">

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Sucursal Destino</label>
                <select
                  value={formBranchId}
                  onChange={(e) => setFormBranchId(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
                >
                  <option value="">Seleccionar...</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Proveedor</label>
                <input
                  type="text"
                  value={formSupplier}
                  onChange={(e) => setFormSupplier(e.target.value)}
                  placeholder="Nombre del proveedor"
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Notas</label>
              <textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
              />
            </div>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <label className="text-sm font-medium text-[var(--color-text-secondary)] md:col-span-2">
                  Modo IVA
                  <select
                    value={purchaseTaxTreatment}
                    onChange={(e) => setPurchaseTaxTreatment(e.target.value as "INCLUDE_IN_COST" | "SEPARATE_CREDIT")}
                    className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
                  >
                    <option value="INCLUDE_IN_COST">Incluir IVA en costo del producto</option>
                    <option value="SEPARATE_CREDIT">Separar IVA como credito fiscal</option>
                  </select>
                </label>
                <label className="text-sm font-medium text-[var(--color-text-secondary)]">
                  Flete
                  <input type="number" min="0" step="0.01" value={freightAmount} onChange={(e) => setFreightAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]" />
                </label>
                <label className="text-sm font-medium text-[var(--color-text-secondary)]">
                  Otros cargos
                  <input type="number" min="0" step="0.01" value={otherChargesAmount} onChange={(e) => setOtherChargesAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]" />
                </label>
                <label className="text-sm font-medium text-[var(--color-text-secondary)]">
                  Descuento global
                  <input type="number" min="0" step="0.01" value={globalDiscountAmount} onChange={(e) => setGlobalDiscountAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]" />
                </label>
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                Para cuota fija, el modo por defecto incluye el IVA de compra en el costo real del producto.
              </p>
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

              {formLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-4">
                    {idx === 0 && <label className="block text-xs text-[var(--color-text-muted)] mb-1">Producto</label>}
                    <select
                      value={line.productId}
                      onChange={(e) => updateLine(idx, "productId", e.target.value)}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-sm text-[var(--color-text)]"
                    >
                      <option value="">Seleccionar producto...</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    {idx === 0 && <label className="block text-xs text-[var(--color-text-muted)] mb-1">Cantidad</label>}
                    <input
                      type="number"
                      min="1"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, "quantity", e.target.value)}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-sm text-[var(--color-text)]"
                    />
                  </div>
                  <div className="col-span-2">
                    {idx === 0 && <label className="block text-xs text-[var(--color-text-muted)] mb-1">Costo sin IVA</label>}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitCostBeforeTax}
                      onChange={(e) => updateLine(idx, "unitCostBeforeTax", e.target.value)}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-sm text-[var(--color-text)]"
                    />
                  </div>
                  <div className="col-span-1">
                    {idx === 0 && <label className="block text-xs text-[var(--color-text-muted)] mb-1">IVA %</label>}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.taxRate}
                      onChange={(e) => updateLine(idx, "taxRate", e.target.value)}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-sm text-[var(--color-text)]"
                    />
                  </div>
                  <div className="col-span-2 text-right">
                    {idx === 0 && <label className="block text-xs text-[var(--color-text-muted)] mb-1">Subtotal</label>}
                    <span className="text-sm font-medium text-[var(--color-text)]">
                      C${((parseFloat(line.quantity) || 0) * (parseFloat(line.unitCostBeforeTax) || 0)).toFixed(2)}
                    </span>
                  </div>
                  <div className="col-span-1 text-center">
                    {formLines.length > 1 && (
                      <button onClick={() => removeLine(idx)} className="text-[var(--color-danger-600)] hover:text-[var(--color-danger-700)] text-lg">✕</button>
                    )}
                  </div>
                </div>
              ))}

              <div className="flex justify-end border-t border-[var(--color-border)] pt-3">
                <div className="text-right text-sm">
                  <p className="text-[var(--color-text-muted)]">Subtotal sin IVA: C${formSubtotalBeforeTax.toFixed(2)}</p>
                  <p className="text-[var(--color-text-muted)]">IVA: C${formTaxAmount.toFixed(2)}</p>
                  <p className="text-lg font-bold text-[var(--color-text)]">Total pagado: C${formTotalPaid.toFixed(2)}</p>
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
