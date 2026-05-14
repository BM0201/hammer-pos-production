"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Package,
  Plus,
  CheckCircle,
  XCircle,
  Search,
  Loader2,
  FileText,
  Truck,
  AlertTriangle,
} from "lucide-react";
import { apiFetch } from "@/lib/client/api";

/* ── Types ── */
type Product = { id: string; sku: string; name: string; unit: string };
type POLine = {
  id?: string;
  productId: string;
  product?: Product;
  quantity: number;
  unitCost: number;
  subtotal: number;
};
type PurchaseOrder = {
  id: string;
  orderNumber: string;
  date: string;
  supplier: string | null;
  status: string;
  total: number;
  notes: string | null;
  branch: { id: string; code: string; name: string };
  createdBy: { username: string; fullName: string };
  lines: (POLine & { product: Product })[];
  createdAt: string;
};
type Branch = { id: string; code: string; name: string };

/* ── Status Badge ── */
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    DRAFT: { bg: "bg-yellow-100", text: "text-yellow-800", label: "Borrador" },
    APPROVED: { bg: "bg-green-100", text: "text-green-800", label: "Aprobado" },
    RECEIVED: { bg: "bg-blue-100", text: "text-blue-800", label: "Recibido" },
    CANCELLED: { bg: "bg-red-100", text: "text-red-800", label: "Cancelado" },
  };
  const c = cfg[status] || { bg: "bg-gray-100", text: "text-gray-800", label: status };
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
  const [success, setSuccess] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Form state
  const [formBranchId, setFormBranchId] = useState("");
  const [formSupplier, setFormSupplier] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formLines, setFormLines] = useState<{ productId: string; quantity: string; unitCost: string }[]>([]);
  const [productSearch, setProductSearch] = useState("");

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      const url = filterStatus
        ? `/api/master/purchase-orders?status=${filterStatus}`
        : "/api/master/purchase-orders";
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al cargar pedidos");
      setOrders(json.data || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  const fetchMeta = useCallback(async () => {
    try {
      const [branchRes, prodRes] = await Promise.all([
        apiFetch("/api/master/users"),
        apiFetch("/api/catalog/products"),
      ]);
      const branchJson = await branchRes.json();
      const prodJson = await prodRes.json();
      if (branchJson.data?.branches) setBranches(branchJson.data.branches);
      if (prodJson.data) setProducts(Array.isArray(prodJson.data) ? prodJson.data : []);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  const openCreate = () => {
    setFormBranchId(branches[0]?.id || "");
    setFormSupplier("");
    setFormNotes("");
    setFormLines([{ productId: "", quantity: "1", unitCost: "0" }]);
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
          unitCost: parseFloat(l.unitCost) || 0,
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
          lines,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al crear pedido");

      setSuccess("Pedido creado exitosamente");
      setShowModal(false);
      fetchOrders();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = async (id: string) => {
    if (!confirm("¿Aprobar este pedido? Los productos se agregarán al inventario.")) return;
    try {
      setActionLoading(id);
      setError(null);
      const res = await apiFetch(`/api/master/purchase-orders/${id}/approve`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al aprobar");
      setSuccess("Pedido aprobado e inventario actualizado");
      fetchOrders();
      setSelectedOrder(null);
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm("¿Cancelar este pedido?")) return;
    try {
      setActionLoading(id);
      const res = await apiFetch(`/api/master/purchase-orders/${id}/cancel`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al cancelar");
      setSuccess("Pedido cancelado");
      fetchOrders();
      setSelectedOrder(null);
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const addLine = () => setFormLines([...formLines, { productId: "", quantity: "1", unitCost: "0" }]);
  const removeLine = (idx: number) => setFormLines(formLines.filter((_, i) => i !== idx));
  const updateLine = (idx: number, field: string, value: string) => {
    const updated = [...formLines];
    (updated[idx] as any)[field] = value;
    setFormLines(updated);
  };

  const filteredProducts = productSearch
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
          p.sku.toLowerCase().includes(productSearch.toLowerCase()),
      )
    : products;

  const formTotal = formLines.reduce((acc, l) => {
    return acc + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitCost) || 0);
  }, 0);

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
              Crear, aprobar pedidos y registrar ingreso de mercadería al inventario.
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

      {/* Messages */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">✕</button>
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 flex items-center gap-2">
          <CheckCircle className="h-4 w-4 flex-shrink-0" /> {success}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 text-sm">
        {["", "DRAFT", "APPROVED", "CANCELLED"].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`rounded-lg border px-3 py-1.5 font-medium transition-colors ${
              filterStatus === s
                ? "bg-[var(--color-master-600)] text-white border-[var(--color-master-600)]"
                : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"
            }`}
          >
            {s === "" ? "Todos" : s === "DRAFT" ? "Borradores" : s === "APPROVED" ? "Aprobados" : "Cancelados"}
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
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-secondary)]">Pedido</th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-secondary)]">Fecha</th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-secondary)]">Proveedor</th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-secondary)]">Sucursal</th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-secondary)]">Estado</th>
                <th className="px-4 py-3 text-right font-semibold text-[var(--color-text-secondary)]">Total</th>
                <th className="px-4 py-3 text-center font-semibold text-[var(--color-text-secondary)]">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr
                  key={order.id}
                  className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] cursor-pointer transition-colors"
                  onClick={() => setSelectedOrder(order)}
                >
                  <td className="px-4 py-3 font-mono text-xs font-medium text-[var(--color-text)]">
                    {order.orderNumber}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                    {new Date(order.date).toLocaleDateString("es-NI")}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text)]">{order.supplier || "—"}</td>
                  <td className="px-4 py-3 text-[var(--color-text)]">{order.branch.code}</td>
                  <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
                  <td className="px-4 py-3 text-right font-semibold text-[var(--color-text)]">
                    C${Number(order.total).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {order.status === "DRAFT" && (
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleApprove(order.id); }}
                          disabled={actionLoading === order.id}
                          className="rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          {actionLoading === order.id ? "..." : "Aprobar"}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCancel(order.id); }}
                          disabled={actionLoading === order.id}
                          className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Panel */}
      {selectedOrder && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[var(--color-text)]">
                Pedido {selectedOrder.orderNumber}
              </h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                Creado por {selectedOrder.createdBy.fullName} — {new Date(selectedOrder.createdAt).toLocaleString("es-NI")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={selectedOrder.status} />
              <button onClick={() => setSelectedOrder(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">✕</button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-[var(--color-text-muted)]">Proveedor:</span> <span className="font-medium text-[var(--color-text)]">{selectedOrder.supplier || "—"}</span></div>
            <div><span className="text-[var(--color-text-muted)]">Sucursal:</span> <span className="font-medium text-[var(--color-text)]">{selectedOrder.branch.code}</span></div>
            <div><span className="text-[var(--color-text-muted)]">Fecha:</span> <span className="font-medium text-[var(--color-text)]">{new Date(selectedOrder.date).toLocaleDateString("es-NI")}</span></div>
            <div><span className="text-[var(--color-text-muted)]">Total:</span> <span className="font-bold text-[var(--color-text)]">C${Number(selectedOrder.total).toFixed(2)}</span></div>
          </div>

          {selectedOrder.notes && (
            <p className="text-sm text-[var(--color-text-secondary)] italic">{selectedOrder.notes}</p>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="py-2 text-left font-semibold text-[var(--color-text-secondary)]">Producto</th>
                <th className="py-2 text-left font-semibold text-[var(--color-text-secondary)]">SKU</th>
                <th className="py-2 text-right font-semibold text-[var(--color-text-secondary)]">Cantidad</th>
                <th className="py-2 text-right font-semibold text-[var(--color-text-secondary)]">Costo Unit.</th>
                <th className="py-2 text-right font-semibold text-[var(--color-text-secondary)]">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {selectedOrder.lines.map((line, i) => (
                <tr key={i} className="border-b border-[var(--color-border)]">
                  <td className="py-2 text-[var(--color-text)]">{line.product.name}</td>
                  <td className="py-2 font-mono text-xs text-[var(--color-text-muted)]">{line.product.sku}</td>
                  <td className="py-2 text-right text-[var(--color-text)]">{Number(line.quantity)}</td>
                  <td className="py-2 text-right text-[var(--color-text)]">C${Number(line.unitCost).toFixed(2)}</td>
                  <td className="py-2 text-right font-semibold text-[var(--color-text)]">C${Number(line.subtotal).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {selectedOrder.status === "DRAFT" && (
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => handleApprove(selectedOrder.id)}
                disabled={!!actionLoading}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                <CheckCircle className="h-4 w-4" /> Aprobar Pedido
              </button>
              <button
                onClick={() => handleCancel(selectedOrder.id)}
                disabled={!!actionLoading}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" /> Cancelar Pedido
              </button>
            </div>
          )}
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--color-text)]">Crear Pedido de Compra</h2>
              <button onClick={() => setShowModal(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xl">✕</button>
            </div>

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
                  <div className="col-span-5">
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
                    {idx === 0 && <label className="block text-xs text-[var(--color-text-muted)] mb-1">Costo Unit.</label>}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitCost}
                      onChange={(e) => updateLine(idx, "unitCost", e.target.value)}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-sm text-[var(--color-text)]"
                    />
                  </div>
                  <div className="col-span-2 text-right">
                    {idx === 0 && <label className="block text-xs text-[var(--color-text-muted)] mb-1">Subtotal</label>}
                    <span className="text-sm font-medium text-[var(--color-text)]">
                      C${((parseFloat(line.quantity) || 0) * (parseFloat(line.unitCost) || 0)).toFixed(2)}
                    </span>
                  </div>
                  <div className="col-span-1 text-center">
                    {formLines.length > 1 && (
                      <button onClick={() => removeLine(idx)} className="text-red-500 hover:text-red-700 text-lg">✕</button>
                    )}
                  </div>
                </div>
              ))}

              <div className="flex justify-end border-t border-[var(--color-border)] pt-3">
                <span className="text-lg font-bold text-[var(--color-text)]">Total: C${formTotal.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={actionLoading === "create"}
                className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-6 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] disabled:opacity-50"
              >
                {actionLoading === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                Crear Pedido
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
