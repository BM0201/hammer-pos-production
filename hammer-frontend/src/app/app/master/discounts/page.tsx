"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Percent,
  Plus,
  Search,
  Loader2,
  Edit2,
  Trash2,
  Tag,
  Calendar,
  Building2,
  ToggleLeft,
  ToggleRight,
  X,
  Lightbulb,
  Sparkles,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import toast from "react-hot-toast";
import { Save, Check } from "lucide-react";

/* ── Types ── */
type Discount = {
  id: string;
  name: string;
  description: string | null;
  type: "PERCENTAGE" | "FIXED_AMOUNT";
  value: string;
  productIds: string | null;
  abcCategories: string | null;
  xyzCategories: string | null;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
  branchId: string | null;
  branch: { id: string; code: string; name: string } | null;
  createdBy: { id: string; username: string; fullName: string };
  createdAt: string;
  updatedAt: string;
};

type Branch = { id: string; code: string; name: string };
type Product = { id: string; sku: string; name: string };
type DiscountSuggestion = {
  productId: string;
  sku: string;
  name: string;
  abcClassification: string;
  xyzClassification: string;
  recommendedType: "PERCENTAGE";
  recommendedValue: number;
  reason: string;
  status: "SUGGESTED_NOT_APPLIED";
};
type DiscountSuggestionInsufficient = {
  productId: string;
  sku: string;
  name: string;
  reason: string;
};
type SuggestionEnvelope = {
  generatedAt: string;
  suggested: DiscountSuggestion[];
  insufficientData: DiscountSuggestionInsufficient[];
};

type FormData = {
  name: string;
  description: string;
  type: "PERCENTAGE" | "FIXED_AMOUNT";
  value: string;
  productIds: string[];
  abcCategories: string[];
  xyzCategories: string[];
  startDate: string;
  endDate: string;
  active: boolean;
  branchId: string;
};

const emptyForm: FormData = {
  name: "",
  description: "",
  type: "PERCENTAGE",
  value: "",
  productIds: [],
  abcCategories: [],
  xyzCategories: [],
  startDate: "",
  endDate: "",
  active: true,
  branchId: "",
};

const ABC_OPTIONS = ["A", "B", "C"];
const XYZ_OPTIONS = ["X", "Y", "Z"];

function TypeBadge({ type }: { type: string }) {
  return type === "PERCENTAGE" ? (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-[var(--color-info-50)] text-[var(--color-info-700)]">
      <Percent className="h-3 w-3" /> Porcentaje
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-[var(--color-info-50)] text-purple-800">
      C$ Monto Fijo
    </span>
  );
}

/* ── Main Page ── */
export default function DiscountsPage() {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  
  const [filterActive, setFilterActive] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [suggestions, setSuggestions] = useState<DiscountSuggestion[]>([]);
  const [insufficientSuggestions, setInsufficientSuggestions] = useState<DiscountSuggestionInsufficient[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [suggestionsGeneratedAt, setSuggestionsGeneratedAt] = useState<string | null>(null);

  const loadDiscounts = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterActive !== "all" ? `?active=${filterActive}` : "";
      const res = await fetch(`/api/master/discounts${params}`);
      const raw = await res.json();
      if (res.ok) { const d = unwrapApiData(raw); setDiscounts(Array.isArray(d) ? d : []); }
      else toast.error(raw.error?.message ?? raw.message ?? "Error al cargar descuentos");
    } catch {
      toast.error("Error de conexión");
    }
    setLoading(false);
  }, [filterActive]);

  const loadBranches = useCallback(async () => {
    try {
      const res = await fetch("/api/branches");
      const raw = await res.json();
      if (res.ok) { const d = unwrapApiData(raw); setBranches(Array.isArray(d) ? d : []); }
    } catch { /* ignore */ }
  }, []);

  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/catalog/products?isActive=true");
      const raw = await res.json();
      if (res.ok) { const d = unwrapApiData(raw); setProducts(Array.isArray(d) ? d : []); }
    } catch { /* ignore */ }
  }, []);

  const loadSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    try {
      const res = await fetch("/api/master/discounts/suggestions?limit=18");
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "No se pudo cargar sugerencias");
      const data: SuggestionEnvelope = unwrapApiData(raw) ?? { generatedAt: "", suggested: [], insufficientData: [] };
      setSuggestions(data.suggested ?? []);
      setInsufficientSuggestions(data.insufficientData ?? []);
      setSuggestionsGeneratedAt(data.generatedAt ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar sugerencias del sistema");
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  useEffect(() => { loadDiscounts(); }, [loadDiscounts]);
  useEffect(() => { loadBranches(); loadProducts(); loadSuggestions(); }, [loadBranches, loadProducts, loadSuggestions]);

  function openCreate() {
    setForm(emptyForm);
    setEditingId(null);
    setShowModal(true);
  }

  function openCreateFromSuggestion(suggestion: DiscountSuggestion) {
    setForm({
      ...emptyForm,
      name: `Sugerencia ${suggestion.abcClassification}${suggestion.xyzClassification} · ${suggestion.sku}`,
      description: `Sugerencia del sistema: ${suggestion.reason}`,
      type: suggestion.recommendedType,
      value: String(suggestion.recommendedValue),
      productIds: [suggestion.productId],
      abcCategories: [suggestion.abcClassification],
      xyzCategories: [suggestion.xyzClassification],
      active: true,
    });
    setEditingId(null);
    setShowModal(true);
  }

  function openEdit(d: Discount) {
    setForm({
      name: d.name,
      description: d.description ?? "",
      type: d.type,
      value: String(d.value),
      productIds: d.productIds ? d.productIds.split(",") : [],
      abcCategories: d.abcCategories ? d.abcCategories.split(",") : [],
      xyzCategories: d.xyzCategories ? d.xyzCategories.split(",") : [],
      startDate: d.startDate ? d.startDate.slice(0, 10) : "",
      endDate: d.endDate ? d.endDate.slice(0, 10) : "",
      active: d.active,
      branchId: d.branchId ?? "",
    });
    setEditingId(d.id);
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.value) {
      toast.error("Nombre y valor son requeridos");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        type: form.type,
        value: Number(form.value),
        productIds: form.productIds.length > 0 ? form.productIds : undefined,
        abcCategories: form.abcCategories.length > 0 ? form.abcCategories : undefined,
        xyzCategories: form.xyzCategories.length > 0 ? form.xyzCategories : undefined,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        active: form.active,
        branchId: form.branchId || null,
      };

      const url = editingId ? `/api/master/discounts/${editingId}` : "/api/master/discounts";
      const method = editingId ? "PUT" : "POST";
      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setShowModal(false);
        toast.success(editingId ? "Descuento actualizado" : "Descuento creado");
        loadDiscounts();
        loadSuggestions();
      } else {
        const errJson = await res.json();
        toast.error(errJson.error?.message ?? errJson.message ?? "Error al guardar");
      }
    } catch {
      toast.error("Error de conexión");
    }
    setBusy(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar este descuento?")) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/master/discounts/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Descuento eliminado");
        loadDiscounts();
        loadSuggestions();
      } else {
        const errJson = await res.json();
        toast.error(errJson.error?.message ?? errJson.message ?? "Error al eliminar");
      }
    } catch {
      toast.error("Error de conexión");
    }
    setBusy(false);
  }

  async function handleToggleActive(d: Discount) {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/master/discounts/${d.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !d.active }),
      });
      if (res.ok) {
        loadDiscounts();
        loadSuggestions();
      }
      else toast.error("Error al cambiar estado");
    } catch {
      toast.error("Error de conexión");
    }
    setBusy(false);
  }

  function toggleArrayItem(arr: string[], item: string): string[] {
    return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];
  }

  const filtered = discounts.filter(d =>
    d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (d.description ?? "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      {/* ── Header ── */}
      <div
        className="w-full py-8 px-6"
        style={{
          background: "linear-gradient(135deg, var(--color-master-400), var(--color-master-600))",
        }}
      >
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <Tag className="h-7 w-7 text-white/90" />
            <h1 className="text-2xl font-bold text-white">Descuentos</h1>
          </div>
          <p className="text-white/80 text-sm">
            Gestión de descuentos comerciales con soporte de sugerencias ABC-XYZ
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* System Suggestions */}
        <section className="rounded-xl border border-[var(--color-master-100)] bg-[var(--color-master-50)] p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--color-master-800)]">
                <Lightbulb className="h-4 w-4" />
                Sugerencias del sistema (ABC-XYZ)
              </h2>
              <p className="mt-1 text-xs text-[var(--color-master-700)]">
                Recomendaciones revisables; no se aplican automáticamente sin intervención humana.
              </p>
              {suggestionsGeneratedAt && (
                <p className="mt-1 text-[11px] text-[var(--color-master-600)]">
                  Último cálculo: {new Date(suggestionsGeneratedAt).toLocaleString()}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={loadSuggestions}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--color-master-200)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-master-700)]"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Recalcular
            </button>
          </div>

          {suggestionsLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-[var(--color-master-700)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Evaluando productos con ABC-XYZ y señales de rotación/stock...
            </div>
          ) : suggestions.length === 0 ? (
            <div className="mt-4 rounded-lg border border-[var(--color-master-200)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-master-700)]">
              No hay sugerencias activas por ahora (productos con descuento vigente o sin patrón de incentivo recomendado).
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--color-master-100)] bg-[var(--color-surface)]">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-master-100)] bg-[var(--color-master-50)]">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--color-master-700)]">Producto</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-[var(--color-master-700)]">ABC</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-[var(--color-master-700)]">XYZ</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--color-master-700)]">Recomendación</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--color-master-700)]">Justificación</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-[var(--color-master-700)]">Estado</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--color-master-700)]">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((suggestion) => (
                    <tr key={suggestion.productId} className="border-b border-[var(--color-master-100)] last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-medium text-[var(--color-text)]">{suggestion.name}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">{suggestion.sku}</p>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="rounded bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-700">
                          {suggestion.abcClassification}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="rounded bg-cyan-100 px-2 py-0.5 text-xs font-bold text-cyan-700">
                          {suggestion.xyzClassification}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-[var(--color-master-800)]">
                        {suggestion.recommendedType === "PERCENTAGE" ? `${suggestion.recommendedValue}%` : suggestion.recommendedValue}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">{suggestion.reason}</td>
                      <td className="px-3 py-2 text-center">
                        <span className="rounded-full bg-[var(--color-warning-100)] px-2 py-0.5 text-xs font-semibold text-[var(--color-warning-700)]">
                          Sugerido / no aplicado
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => openCreateFromSuggestion(suggestion)}
                          className="rounded-md bg-[var(--color-master-600)] px-2.5 py-1.5 text-xs font-semibold text-white"
                        >
                          Crear desde sugerencia
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!suggestionsLoading && insufficientSuggestions.length > 0 && (
            <div className="mt-3 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2">
              <p className="text-xs font-semibold text-[var(--color-warning-700)]">Sin data suficiente (muestra):</p>
              <ul className="mt-1 space-y-1 text-xs text-[var(--color-warning-700)]">
                {insufficientSuggestions.slice(0, 5).map((item) => (
                  <li key={item.productId}>
                    {item.sku} — {item.name}: {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Notices via react-hot-toast */}

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-soft)]" />
            <input
              type="text"
              placeholder="Buscar descuento..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-master-500)]"
            />
          </div>
          <select
            value={filterActive}
            onChange={(e) => setFilterActive(e.target.value)}
            className="px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm"
          >
            <option value="all">Todos</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
          </select>
          <button
            onClick={openCreate}
            className="ml-auto flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ background: "var(--color-master-600)" }}
          >
            <Plus className="h-4 w-4" /> Crear Descuento
          </button>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" />
            <span className="ml-2 text-sm text-[var(--color-text-muted)]">Cargando...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-[var(--color-text-muted)]">
            <Tag className="h-12 w-12 mx-auto mb-3 text-[var(--color-text-soft)]" />
            <p className="font-semibold">No hay descuentos</p>
            <p className="text-sm mt-1">Crea uno usando el botón superior</p>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
            <div className="hm-card-header-purple px-5 py-3 flex items-center gap-2">
              <Tag className="h-4 w-4" />
              <span className="text-sm font-bold">Descuentos registrados</span>
              <span className="ml-auto rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold">{filtered.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="hm-table w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">Nombre</th>
                    <th className="text-left">Tipo</th>
                    <th className="text-right">Valor</th>
                    <th className="text-left">Criterios</th>
                    <th className="text-left">Vigencia</th>
                    <th className="text-left">Sucursal</th>
                    <th className="text-center">Estado</th>
                    <th className="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {filtered.map((d) => (
                    <tr key={d.id} className="hover:bg-[var(--color-surface-alt)] transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--color-text)]">{d.name}</div>
                        {d.description && <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{d.description}</div>}
                      </td>
                      <td className="px-4 py-3"><TypeBadge type={d.type} /></td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {d.type === "PERCENTAGE" ? `${d.value}%` : `C$${Number(d.value).toFixed(2)}`}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {d.productIds && <span className="text-xs bg-[var(--color-surface-alt)] rounded px-1.5 py-0.5">{d.productIds.split(",").length} productos</span>}
                          {d.abcCategories && <span className="text-xs bg-orange-100 text-orange-700 rounded px-1.5 py-0.5">ABC: {d.abcCategories}</span>}
                          {d.xyzCategories && <span className="text-xs bg-teal-100 text-teal-700 rounded px-1.5 py-0.5">XYZ: {d.xyzCategories}</span>}
                          {!d.productIds && !d.abcCategories && !d.xyzCategories && <span className="text-xs text-[var(--color-text-soft)]">Todos</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                        {d.startDate || d.endDate ? (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {d.startDate ? new Date(d.startDate).toLocaleDateString() : "∞"}
                            {" → "}
                            {d.endDate ? new Date(d.endDate).toLocaleDateString() : "∞"}
                          </div>
                        ) : (
                          <span className="text-[var(--color-text-soft)]">Sin límite</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {d.branch ? (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" /> {d.branch.name}
                          </span>
                        ) : (
                          <span className="text-[var(--color-text-soft)]">Todas</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleToggleActive(d)}
                          disabled={busy}
                          className="inline-flex items-center gap-1"
                          title={d.active ? "Desactivar" : "Activar"}
                        >
                          {d.active ? (
                            <ToggleRight className="h-6 w-6 text-[var(--color-success-700)]" />
                          ) : (
                            <ToggleLeft className="h-6 w-6 text-[var(--color-text-soft)]" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(d)}
                            className="p-1.5 rounded-lg hover:bg-[var(--color-info-50)] text-[var(--color-info-700)]"
                            title="Editar"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(d.id)}
                            disabled={busy}
                            className="p-1.5 rounded-lg hover:bg-[var(--color-danger-50)] text-[var(--color-danger-600)]"
                            title="Eliminar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-[var(--color-surface)] rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto border border-[var(--color-border-strong)] overflow-hidden">
            <div className="hm-card-header-purple px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Tag className="h-5 w-5" />
                {editingId ? "Editar Descuento" : "Crear Descuento"}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-white/80 hover:text-white transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-4 space-y-5">
              {/* Name & Description */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Nombre *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-master-500)]"
                    placeholder="Ej: Descuento Productos A"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Descripción</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-master-500)]"
                    placeholder="Descripción opcional"
                  />
                </div>
              </div>

              {/* Type & Value */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Tipo *</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as "PERCENTAGE" | "FIXED_AMOUNT" })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm"
                  >
                    <option value="PERCENTAGE">Porcentaje (%)</option>
                    <option value="FIXED_AMOUNT">Monto Fijo (C$)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
                    Valor * {form.type === "PERCENTAGE" ? "(% descuento)" : "(C$ descuento)"}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-master-500)]"
                    placeholder={form.type === "PERCENTAGE" ? "10" : "50.00"}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Sucursal</label>
                  <select
                    value={form.branchId}
                    onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm"
                  >
                    <option value="">Todas las sucursales</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Fecha inicio</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Fecha fin</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm"
                  />
                </div>
              </div>

              {/* ABC Categories */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">Categorías ABC (opcional)</label>
                <div className="flex gap-2">
                  {ABC_OPTIONS.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setForm({ ...form, abcCategories: toggleArrayItem(form.abcCategories, cat) })}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                        form.abcCategories.includes(cat)
                          ? "bg-orange-100 text-orange-800 border-orange-300"
                          : "bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* XYZ Categories */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">Categorías XYZ (opcional)</label>
                <div className="flex gap-2">
                  {XYZ_OPTIONS.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setForm({ ...form, xyzCategories: toggleArrayItem(form.xyzCategories, cat) })}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                        form.xyzCategories.includes(cat)
                          ? "bg-teal-100 text-teal-800 border-teal-300"
                          : "bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Product selection (simplified) */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                  Productos específicos (opcional)
                </label>
                <select
                  multiple
                  value={form.productIds}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                    setForm({ ...form, productIds: selected });
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm h-32"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Ctrl+Click para seleccionar múltiples. Dejar vacío = todos los productos.
                </p>
              </div>

              {/* Active toggle */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, active: !form.active })}
                  className="flex items-center gap-2"
                >
                  {form.active ? (
                    <ToggleRight className="h-6 w-6 text-[var(--color-success-700)]" />
                  ) : (
                    <ToggleLeft className="h-6 w-6 text-[var(--color-text-soft)]" />
                  )}
                  <span className="text-sm font-medium text-[var(--color-text)]">
                    {form.active ? "Activo" : "Inactivo"}
                  </span>
                </button>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[var(--color-border)] text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] shadow-md hover:shadow-lg transition-all"
                >
                  <X className="h-4 w-4" />
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all disabled:opacity-50 bg-[var(--color-master-600)] hover:bg-[var(--color-master-700)]"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  {editingId ? "Guardar Cambios" : "Crear Descuento"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
