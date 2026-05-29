"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Truck,
  Plus,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

/* ── Types ── */
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
  toBranch: { id: string; code: string; name: string };
  requestedBy: { username: string; fullName: string };
  approvedBy: { username: string; fullName: string } | null;
  notes: string | null;
  lines: (TransferLine & { product: Product })[];
  createdAt: string;
  approvedAt: string | null;
};
type Branch = { id: string; code: string; name: string };
type TransferLineForm = { productId: string; quantity: string };

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/* ── Status Badge ── */
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    DRAFT: { bg: "bg-[var(--color-warning-100)]", text: "text-[var(--color-warning-700)]", label: "Borrador" },
    REQUESTED: { bg: "bg-orange-100", text: "text-orange-800", label: "Solicitado" },
    APPROVED: { bg: "bg-[var(--color-success-50)]", text: "text-[var(--color-success-700)]", label: "Aprobado" },
    IN_TRANSIT: { bg: "bg-[var(--color-info-50)]", text: "text-[var(--color-info-700)]", label: "En Tránsito" },
    RECEIVED: { bg: "bg-[var(--color-success-50)]", text: "text-emerald-800", label: "Recibido" },
    CANCELLED: { bg: "bg-[var(--color-danger-50)]", text: "text-[var(--color-danger-700)]", label: "Cancelado" },
    REJECTED: { bg: "bg-[var(--color-danger-50)]", text: "text-[var(--color-danger-700)]", label: "Rechazado" },
  };
  const c = cfg[status] || { bg: "bg-[var(--color-surface-alt)]", text: "text-[var(--color-text)]", label: status };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

/* ── Main Page ── */
export default function TransfersPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Form state
  const [formFromBranchId, setFormFromBranchId] = useState("");
  const [formToBranchId, setFormToBranchId] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formLines, setFormLines] = useState<TransferLineForm[]>([]);

  const fetchTransfers = useCallback(async () => {
    try {
      setLoading(true);
      const url = filterStatus
        ? `/api/master/transfers?status=${filterStatus}`
        : "/api/master/transfers";
      const res = await fetch(url);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al cargar envíos");
      const transfers = unwrapApiData(raw);
      setTransfers(Array.isArray(transfers) ? transfers : []);
    } catch (error) {
      setError(getErrorMessage(error, "Error al cargar envíos"));
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
      setProducts(Array.isArray(prodJson) ? prodJson : []);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchTransfers(); }, [fetchTransfers]);
  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  const openCreate = () => {
    setFormFromBranchId(branches[0]?.id || "");
    setFormToBranchId(branches[1]?.id || "");
    setFormNotes("");
    setFormLines([{ productId: "", quantity: "1" }]);
    setShowModal(true);
    setSelectedTransfer(null);
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
        }));

      if (!formFromBranchId || !formToBranchId) throw new Error("Seleccione origen y destino");
      if (formFromBranchId === formToBranchId) throw new Error("Origen y destino deben ser diferentes");
      if (!lines.length) throw new Error("Agregue al menos una línea");

      const res = await apiFetch("/api/master/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromBranchId: formFromBranchId,
          toBranchId: formToBranchId,
          notes: formNotes || undefined,
          lines,
        }),
      });
      const rawCreate = await res.json();
      if (!res.ok) throw new Error(rawCreate.error?.message ?? rawCreate.message ?? "Error al crear envío");

      setSuccess("Envío creado exitosamente");
      setShowModal(false);
      fetchTransfers();
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      setError(getErrorMessage(error, "Error al crear envío"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = async (id: string) => {
    if (!confirm("¿Aprobar este envío? El inventario se moverá entre sucursales.")) return;
    try {
      setActionLoading(id);
      setError(null);
      const res = await apiFetch(`/api/master/transfers/${id}/approve`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? e.message ?? "Error al aprobar"); }
      setSuccess("Envío aprobado e inventario actualizado");
      fetchTransfers();
      setSelectedTransfer(null);
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      setError(getErrorMessage(error, "Error al aprobar"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm("¿Cancelar este envío?")) return;
    try {
      setActionLoading(id);
      const res = await apiFetch(`/api/master/transfers/${id}/cancel`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? e.message ?? "Error al cancelar"); }
      setSuccess("Envío cancelado");
      fetchTransfers();
      setSelectedTransfer(null);
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      setError(getErrorMessage(error, "Error al cancelar"));
    } finally {
      setActionLoading(null);
    }
  };

  const addLine = () => setFormLines([...formLines, { productId: "", quantity: "1" }]);
  const removeLine = (idx: number) => setFormLines(formLines.filter((_, i) => i !== idx));
  const updateLine = (idx: number, field: keyof TransferLineForm, value: string) => {
    const updated = [...formLines];
    updated[idx] = { ...updated[idx], [field]: value };
    setFormLines(updated);
  };

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
              Envíos entre Sucursales
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              Crear y aprobar envíos de mercadería entre sucursales.
            </p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-[var(--color-master-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] transition-colors"
        >
          <Plus className="h-4 w-4" />
          Crear Envío
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] px-4 py-3 text-sm text-[var(--color-danger-700)] flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-[var(--color-danger-600)] hover:text-[var(--color-danger-700)]">✕</button>
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-[var(--color-success-200)] bg-[var(--color-success-50)] px-4 py-3 text-sm text-[var(--color-success-700)] flex items-center gap-2">
          <CheckCircle className="h-4 w-4 flex-shrink-0" /> {success}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 text-sm">
        {["", "DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`rounded-lg border px-3 py-1.5 font-medium transition-colors ${
              filterStatus === s
                ? "bg-[var(--color-master-600)] text-white border-[var(--color-master-600)]"
                : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"
            }`}
          >
            {s === "" ? "Todos" : s === "DRAFT" ? "Borradores" : s === "IN_TRANSIT" ? "En Tránsito" : s === "RECEIVED" ? "Recibidos" : "Cancelados"}
          </button>
        ))}
      </div>

      {/* Transfers Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" />
          <span className="ml-2 text-sm text-[var(--color-text-muted)]">Cargando envíos...</span>
        </div>
      ) : transfers.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <Truck className="h-12 w-12 mx-auto text-[var(--color-text-muted)] mb-3" />
          <p className="text-[var(--color-text-muted)]">No hay envíos registrados.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-secondary)]">Envío</th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-secondary)]">Ruta</th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-secondary)]">Estado</th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-secondary)]">Productos</th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-secondary)]">Fecha</th>
                <th className="px-4 py-3 text-center font-semibold text-[var(--color-text-secondary)]">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] cursor-pointer transition-colors"
                  onClick={() => setSelectedTransfer(t)}
                >
                  <td className="px-4 py-3 font-mono text-xs font-medium text-[var(--color-text)]">
                    {t.transferNumber}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-[var(--color-text)]">
                      <span className="font-medium">{t.fromBranch.code}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                      <span className="font-medium">{t.toBranch.code}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">{t.lines.length} líneas</td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                    {new Date(t.createdAt).toLocaleDateString("es-NI")}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {t.status === "DRAFT" && (
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleApprove(t.id); }}
                          disabled={actionLoading === t.id}
                          className="rounded bg-[var(--color-success-600)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--color-success-700)] disabled:opacity-50"
                        >
                          {actionLoading === t.id ? "..." : "Aprobar"}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCancel(t.id); }}
                          disabled={actionLoading === t.id}
                          className="rounded bg-[var(--color-danger-600)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--color-danger-700)] disabled:opacity-50"
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
      {selectedTransfer && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[var(--color-text)]">
                Envío {selectedTransfer.transferNumber}
              </h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                Creado por {selectedTransfer.requestedBy.fullName ? `${selectedTransfer.requestedBy.fullName} (usuario: ${selectedTransfer.requestedBy.username})` : selectedTransfer.requestedBy.username} — {new Date(selectedTransfer.createdAt).toLocaleString("es-NI")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={selectedTransfer.status} />
              <button onClick={() => setSelectedTransfer(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">✕</button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-[var(--color-text-muted)]">Origen:</span>
              <span className="ml-1 font-medium text-[var(--color-text)]">{selectedTransfer.fromBranch.code} — {selectedTransfer.fromBranch.name}</span>
            </div>
            <div>
              <span className="text-[var(--color-text-muted)]">Destino:</span>
              <span className="ml-1 font-medium text-[var(--color-text)]">{selectedTransfer.toBranch.code} — {selectedTransfer.toBranch.name}</span>
            </div>
            <div>
              <span className="text-[var(--color-text-muted)]">Fecha:</span>
              <span className="ml-1 font-medium text-[var(--color-text)]">{new Date(selectedTransfer.createdAt).toLocaleDateString("es-NI")}</span>
            </div>
          </div>

          {selectedTransfer.notes && (
            <p className="text-sm text-[var(--color-text-secondary)] italic">{selectedTransfer.notes}</p>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="py-2 text-left font-semibold text-[var(--color-text-secondary)]">Producto</th>
                <th className="py-2 text-left font-semibold text-[var(--color-text-secondary)]">SKU</th>
                <th className="py-2 text-right font-semibold text-[var(--color-text-secondary)]">Cant. Solicitada</th>
                <th className="py-2 text-right font-semibold text-[var(--color-text-secondary)]">Cant. Enviada</th>
                <th className="py-2 text-right font-semibold text-[var(--color-text-secondary)]">Cant. Recibida</th>
              </tr>
            </thead>
            <tbody>
              {selectedTransfer.lines.map((line, i) => (
                <tr key={i} className="border-b border-[var(--color-border)]">
                  <td className="py-2 text-[var(--color-text)]">{line.product.name}</td>
                  <td className="py-2 font-mono text-xs text-[var(--color-text-muted)]">{line.product.sku}</td>
                  <td className="py-2 text-right text-[var(--color-text)]">{Number(line.quantityRequested)}</td>
                  <td className="py-2 text-right text-[var(--color-text)]">{Number(line.quantityDispatched)}</td>
                  <td className="py-2 text-right text-[var(--color-text)]">{Number(line.quantityReceived)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {selectedTransfer.status === "DRAFT" && (
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => handleApprove(selectedTransfer.id)}
                disabled={!!actionLoading}
                className="flex items-center gap-2 rounded-lg bg-[var(--color-success-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-success-700)] disabled:opacity-50"
              >
                <CheckCircle className="h-4 w-4" /> Aprobar Envío
              </button>
              <button
                onClick={() => handleCancel(selectedTransfer.id)}
                disabled={!!actionLoading}
                className="flex items-center gap-2 rounded-lg bg-[var(--color-danger-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-danger-700)] disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" /> Cancelar Envío
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
              <h2 className="text-lg font-bold text-[var(--color-text)]">Crear Envío entre Sucursales</h2>
              <button onClick={() => setShowModal(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xl">✕</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Sucursal Origen</label>
                <select
                  value={formFromBranchId}
                  onChange={(e) => setFormFromBranchId(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
                >
                  <option value="">Seleccionar...</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Sucursal Destino</label>
                <select
                  value={formToBranchId}
                  onChange={(e) => setFormToBranchId(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
                >
                  <option value="">Seleccionar...</option>
                  {branches.filter((b) => b.id !== formFromBranchId).map((b) => (
                    <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                  ))}
                </select>
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
                <h3 className="text-sm font-semibold text-[var(--color-text)]">Productos a Enviar</h3>
                <button
                  onClick={addLine}
                  className="flex items-center gap-1 text-xs font-medium text-[var(--color-master-600)] hover:text-[var(--color-master-700)]"
                >
                  <Plus className="h-3.5 w-3.5" /> Agregar línea
                </button>
              </div>

              {formLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-8">
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
                  <div className="col-span-3">
                    {idx === 0 && <label className="block text-xs text-[var(--color-text-muted)] mb-1">Cantidad</label>}
                    <input
                      type="number"
                      min="1"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, "quantity", e.target.value)}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-sm text-[var(--color-text)]"
                    />
                  </div>
                  <div className="col-span-1 text-center">
                    {formLines.length > 1 && (
                      <button onClick={() => removeLine(idx)} className="text-[var(--color-danger-600)] hover:text-[var(--color-danger-700)] text-lg">✕</button>
                    )}
                  </div>
                </div>
              ))}
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
                {actionLoading === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                Crear Envío
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
