"use client";

import Link from "next/link";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  BarChart3, Boxes, Check, ChevronDown, ChevronUp, DollarSign,
  FileUp, History, Loader2, Package, Pencil, Plus, RefreshCcw, Save, Search,
  Settings2, Shuffle, Tags, TrendingUp, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, qty } from "@/lib/format";

/* ───────────────────────── Types ───────────────────────── */
type Branch = { id: string; code: string; name: string };
type Category = { id: string; code: string; name: string; isActive: boolean };
type ProductRow = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  isActive: boolean;
  baseCost: number;
  basePrice: number;
  totalStock: number;
  branchesWithStock: number;
  inventoryValue: number;
  category?: { name: string };
  inventoryBalances: Array<{ id: string; branchId: string; quantityOnHand: string; weightedAverageCost: string; branch: Branch }>;
  branchProductSettings: Array<{ branchId: string; branchCost?: string | null; branchPrice?: string | null; isAvailable: boolean; branch: Branch }>;
};
type Movement = {
  id: string;
  createdAt: string;
  movementType: string;
  quantity: string;
  unitCost: string;
  referenceType: string;
  referenceId: string;
  product: { id: string; sku: string; name: string };
  branch: Branch;
};
type Transfer = { id: string; transferNumber: string; status: string; createdAt: string; fromBranch: Branch; toBranch: Branch; lines: Array<{ product: { sku: string; name: string }; quantityRequested: string }> };
type ReorderAlert = { id: string; reason: string; alertType: string; currentQuantity: string; suggestedQuantity: string; product: { sku: string; name: string }; branch: Branch };
type AuditRow = { id: string; occurredAt: string; module: string; action: string; entityType: string; actor?: { username: string; fullName: string } | null; branch?: Branch | null };
type ImportPreviewItem = {
  rowNumber: number;
  sku: string;
  name: string;
  action: string;
  targetBranchCode: string;
  quantity: number | null;
  unitCost: number | null;
  standardSalePrice: number | null;
  status: "READY" | "ERROR" | "EXECUTED" | "SKIPPED" | "FAILED" | "ROLLED_BACK";
  messages?: string[];
  executionMessage?: string | null;
};
type ImportSummary = {
  parsedRows?: number;
  expandedRows?: number;
  existingProducts?: number;
  newProducts?: number;
  readyRows?: number;
  errorRows?: number;
  ready?: number;
  errors?: number;
  status?: string;
  executedLines?: number;
  skippedLines?: number;
  failedLines?: number;
  createdProducts?: number;
  updatedProducts?: number;
  inventoryMovements?: number;
  priceUpdates?: number;
  costUpdates?: number;
};
type CenterData = {
  branches: Branch[];
  categories: Category[];
  kpis: {
    activeProducts: number;
    skusWithoutInventory: number;
    criticalStockProducts: number;
    zeroStockProducts: number;
    totalInventoryValue: number;
    productsWithoutCost: number;
    productsWithoutPrice: number;
  };
  products: ProductRow[];
  balances: ProductRow["inventoryBalances"];
  movements: Movement[];
  transfers: Transfer[];
  reorderAlerts: ReorderAlert[];
  auditLogs: AuditRow[];
};

type Tab = "summary" | "products" | "categories" | "import" | "stock" | "movements" | "pricing" | "transfers" | "reorder" | "audit";

const TABS: Array<{ id: Tab; label: string; icon: typeof BarChart3 }> = [
  { id: "summary", label: "Resumen", icon: BarChart3 },
  { id: "products", label: "Productos", icon: Package },
  { id: "categories", label: "Categorías", icon: Tags },
  { id: "import", label: "Importar", icon: FileUp },
  { id: "stock", label: "Existencias", icon: Boxes },
  { id: "movements", label: "Movimientos / Kardex", icon: History },
  { id: "pricing", label: "Precios y costos", icon: TrendingUp },
  { id: "transfers", label: "Transferencias", icon: Shuffle },
  { id: "reorder", label: "Reposicion", icon: Settings2 },
  { id: "audit", label: "Auditoria", icon: BarChart3 },
];

const FILTERS = [
  { value: "", label: "Todos" },
  { value: "LOW_STOCK", label: "Stock bajo" },
  { value: "ZERO_STOCK", label: "Stock cero" },
  { value: "NEGATIVE_STOCK", label: "Stock negativo" },
  { value: "NO_COST", label: "Sin costo" },
  { value: "NO_PRICE", label: "Sin precio" },
];


function statusFor(total: number) {
  if (total < 0) return { label: "Negativo", variant: "danger" as const };
  if (total === 0) return { label: "Cero", variant: "warning" as const };
  if (total <= 1) return { label: "Critico", variant: "warning" as const };
  return { label: "OK", variant: "success" as const };
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */
export function CatalogInventoryAdmin() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<CenterData | null>(null);
  const [tab, setTab] = useState<Tab>((searchParams.get("tab") as Tab) || "summary");
  const [q, setQ] = useState("");
  const [branchId, setBranchId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  /* ── Inline edit state for product rows ── */
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", standardSalePrice: "" });
  const [savingProduct, setSavingProduct] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (branchId) params.set("branchId", branchId);
    if (categoryId) params.set("categoryId", categoryId);
    if (filter) params.set("filter", filter);
    const response = await fetch(`/api/master/catalog-inventory${params.toString() ? `?${params}` : ""}`, { cache: "no-store" });
    const raw = await response.json();
    if (!response.ok) throw new Error(raw.message ?? "No se pudo cargar Catalogo e Inventario.");
    setData(unwrapApiData(raw));
    setLoading(false);
  }, [branchId, categoryId, filter, q]);

  useEffect(() => {
    load().catch((error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar Catalogo e Inventario.");
      setLoading(false);
    });
  }, [load]);

  async function toggleProduct(product: ProductRow) {
    const response = await apiFetch(`/api/catalog/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !product.isActive }),
    });
    if (!response.ok) throw new Error("No se pudo actualizar el producto.");
    toast.success(product.isActive ? "Producto desactivado" : "Producto activado");
    await load();
  }

  async function updateBranchPrice(product: ProductRow, branch: Branch, field: "branchPrice" | "branchCost", value: string) {
    const numeric = value.trim() === "" ? null : Number(value);
    if (numeric !== null && (!Number.isFinite(numeric) || numeric < 0)) {
      toast.error("No se permiten costos o precios negativos.");
      return;
    }
    const response = await apiFetch("/api/master/catalog-inventory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId: branch.id, productId: product.id, [field]: numeric }),
    });
    if (!response.ok) {
      toast.error("No se pudo guardar la configuracion por sucursal.");
      return;
    }
    toast.success(`${field === "branchCost" ? "Costo" : "Precio"} guardado para ${branch.code}`);
    await load();
  }

  /* ── Inline product edit handlers ── */
  function startEditing(product: ProductRow) {
    setEditingProductId(product.id);
    setEditDraft({ name: product.name, standardSalePrice: String(product.basePrice || "") });
  }
  function cancelEditing() {
    setEditingProductId(null);
    setEditDraft({ name: "", standardSalePrice: "" });
  }
  async function saveProductEdit(product: ProductRow) {
    if (!editDraft.name.trim()) { toast.error("El nombre es obligatorio."); return; }
    setSavingProduct(true);
    try {
      const body: Record<string, unknown> = {};
      if (editDraft.name.trim() !== product.name) body.name = editDraft.name.trim();
      const newPrice = Number(editDraft.standardSalePrice);
      if (editDraft.standardSalePrice && newPrice !== product.basePrice) body.standardSalePrice = newPrice;
      if (Object.keys(body).length === 0) { cancelEditing(); return; }
      const response = await apiFetch(`/api/catalog/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.message ?? "No se pudo actualizar el producto.");
      }
      toast.success("Producto actualizado");
      cancelEditing();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al guardar producto.");
    } finally {
      setSavingProduct(false);
    }
  }

  /* ── Estado para creación manual de producto ── */
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "",
    sku: "",
    categoryId: "",
    unit: "UN",
    standardSalePrice: "",
    description: "",
    allowsFraction: false,
  });
  const [creating, setCreating] = useState(false);

  async function handleCreateProduct() {
    if (!newProduct.name.trim() || !newProduct.categoryId || !newProduct.standardSalePrice) {
      toast.error("Nombre, categoría y precio son obligatorios.");
      return;
    }
    setCreating(true);
    try {
      const response = await apiFetch("/api/catalog/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProduct.name.trim(),
          sku: newProduct.sku.trim() || undefined,
          categoryId: newProduct.categoryId,
          unit: newProduct.unit || "UN",
          standardSalePrice: Number(newProduct.standardSalePrice),
          description: newProduct.description.trim() || undefined,
          allowsFraction: newProduct.allowsFraction,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "No se pudo crear el producto.");
      }
      toast.success("Producto creado exitosamente.");
      setNewProduct({ name: "", sku: "", categoryId: "", unit: "UN", standardSalePrice: "", description: "", allowsFraction: false });
      setShowCreateForm(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al crear producto.");
    } finally {
      setCreating(false);
    }
  }

  const matrix = useMemo(() => {
    const branches = data?.branches ?? [];
    return (data?.products ?? []).map((product) => {
      const byBranch = new Map(product.inventoryBalances.map((balance) => [balance.branchId, Number(balance.quantityOnHand)]));
      return { product, branches: branches.map((branch) => ({ branch, quantity: byBranch.get(branch.id) ?? 0 })) };
    });
  }, [data]);

  return (
    <section className="space-y-5">
      {/* ── Header card con gradiente ── */}
      <Card noPadding>
        <div className="hm-card-header-blue">
          <h1 className="text-xl font-bold tracking-tight">Catálogo e Inventario</h1>
          <p className="mt-1 text-sm opacity-90">Centro MASTER para productos, existencias, precios, movimientos, transferencias y reposición.</p>
        </div>
        <div className="p-4 sm:p-5">
          <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.5fr)_minmax(180px,1fr)_minmax(180px,1fr)_auto]">
            <Input className="h-10" placeholder="🔍 Buscar SKU o producto" value={q} onChange={(event) => setQ(event.target.value)} />
            <select className="hm-input h-10" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">Todas las sucursales</option>
              {data?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}
            </select>
            <select className="hm-input h-10" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">Todas las categorias</option>
              {data?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <Button className="h-10 justify-center sm:col-span-2 lg:col-span-1" variant="primary" onClick={() => load().catch((e) => toast.error(e.message))} loading={loading} icon={<Search className="h-4 w-4" />}>Aplicar</Button>
          </div>
        </div>
      </Card>

      {/* ── Tabs ── */}
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="overflow-x-auto">
          <div className="flex min-w-max gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] p-1.5">
        {TABS.map((item) => {
          const Icon = item.icon;
          const isActive = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[var(--color-master-600)] text-white shadow-sm"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
          </div>
        </div>
      </div>

      {loading || !data ? <Card className="p-4 text-sm text-[var(--color-text-muted)]">Cargando centro de catalogo e inventario...</Card> : null}

      {/* ════════════ TAB: RESUMEN ════════════ */}
      {data && tab === "summary" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Productos activos" value={data.kpis.activeProducts} />
            <Kpi label="SKUs sin inventario" value={data.kpis.skusWithoutInventory} />
            <Kpi label="Stock critico" value={data.kpis.criticalStockProducts} />
            <Kpi label="Stock cero" value={data.kpis.zeroStockProducts} />
            <Kpi label="Valor inventario" value={money(data.kpis.totalInventoryValue)} />
            <Kpi label="Sin costo" value={data.kpis.productsWithoutCost} />
            <Kpi label="Sin precio" value={data.kpis.productsWithoutPrice} />
            <Kpi label="Movimientos recientes" value={data.movements.length} />
          </div>
          <Card noPadding>
            <div className="hm-card-header-purple">
              <h2 className="text-sm font-semibold">Últimos movimientos</h2>
            </div>
            <div className="p-4">
              <CompactMovements movements={data.movements.slice(0, 10)} />
            </div>
          </Card>
        </div>
      ) : null}

      {/* ════════════ TAB: PRODUCTOS (con edición inline) ════════════ */}
      {data && tab === "products" ? (
        <>
        {/* ── Panel para crear producto manual ── */}
        <Card noPadding>
          <div className="hm-card-header-green">
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-semibold w-full"
              onClick={() => setShowCreateForm(!showCreateForm)}
            >
              <Plus className="h-4 w-4" />
              Crear producto manualmente
              {showCreateForm ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
            </button>
          </div>
          {showCreateForm && (
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <Input
                  label="Nombre del producto *"
                  value={newProduct.name}
                  onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                  placeholder="Ej: Cemento Canal 42.5 kg"
                />
                <Input
                  label="SKU (opcional, se genera automáticamente)"
                  value={newProduct.sku}
                  onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })}
                  placeholder="Ej: CEM-001"
                />
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Categoría *</label>
                  <select
                    className="hm-input w-full"
                    value={newProduct.categoryId}
                    onChange={(e) => setNewProduct({ ...newProduct, categoryId: e.target.value })}
                  >
                    <option value="">Seleccionar categoría</option>
                    {(data.categories ?? []).map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Unidad</label>
                  <select
                    className="hm-input w-full"
                    value={newProduct.unit}
                    onChange={(e) => setNewProduct({ ...newProduct, unit: e.target.value })}
                  >
                    <option value="UN">UN — Unidad</option>
                    <option value="KG">KG — Kilogramo</option>
                    <option value="LB">LB — Libra</option>
                    <option value="M">M — Metro</option>
                    <option value="M2">M2 — Metro cuadrado</option>
                    <option value="M3">M3 — Metro cúbico</option>
                    <option value="L">L — Litro</option>
                    <option value="GAL">GAL — Galón</option>
                    <option value="BOLSA">BOLSA</option>
                    <option value="SACO">SACO</option>
                    <option value="ROLLO">ROLLO</option>
                    <option value="CAJA">CAJA</option>
                    <option value="PAR">PAR</option>
                    <option value="JUEGO">JUEGO</option>
                  </select>
                </div>
                <Input
                  label="Precio de venta (C$) *"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={newProduct.standardSalePrice}
                  onChange={(e) => setNewProduct({ ...newProduct, standardSalePrice: e.target.value })}
                  placeholder="Ej: 350.00"
                />
                <Input
                  label="Descripción (opcional)"
                  value={newProduct.description}
                  onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })}
                  placeholder="Descripción breve del producto"
                />
              </div>
              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newProduct.allowsFraction}
                    onChange={(e) => setNewProduct({ ...newProduct, allowsFraction: e.target.checked })}
                  />
                  Permite fracciones (venta por peso/medida)
                </label>
              </div>
              <div className="flex gap-3">
                <Button variant="success" onClick={handleCreateProduct} disabled={creating} icon={<Save className="h-4 w-4" />}>
                  {creating ? "Creando…" : "Crear producto"}
                </Button>
                <Button variant="ghost" onClick={() => setShowCreateForm(false)} icon={<X className="h-4 w-4" />}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card noPadding>
          <div className="hm-card-header-blue">
            <h2 className="text-sm font-semibold flex items-center gap-2"><Package className="h-4 w-4" /> Productos ({data.products.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="hm-table min-w-[1100px] w-full">
              <thead>
                <tr>
                  <th>SKU</th><th>Producto</th><th>Categoria</th><th>Unidad</th><th>Stock total</th><th>Suc.</th><th>Costo base</th><th>Precio base</th><th>Estado</th><th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((product) => {
                  const isEditing = editingProductId === product.id;
                  return (
                  <tr key={product.id}>
                    <td className="font-semibold">{product.sku}</td>
                    <td>
                      {isEditing ? (
                        <Input className="h-8 min-w-[200px]" value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} />
                      ) : product.name}
                    </td>
                    <td>{product.category?.name ?? "Sin categoria"}</td>
                    <td>{product.unit}</td>
                    <td>{qty(product.totalStock)}</td>
                    <td>{product.branchesWithStock}</td>
                    <td>{money(product.baseCost)}</td>
                    <td>
                      {isEditing ? (
                        <Input className="h-8 w-28" type="number" min="0" step="0.01" value={editDraft.standardSalePrice} onChange={(e) => setEditDraft({ ...editDraft, standardSalePrice: e.target.value })} />
                      ) : money(product.basePrice)}
                    </td>
                    <td><Badge variant={product.isActive ? "success" : "warning"}>{product.isActive ? "Activo" : "Inactivo"}</Badge></td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        {isEditing ? (
                          <>
                            <Button variant="success" size="sm" onClick={() => saveProductEdit(product)} loading={savingProduct} icon={<Check className="h-3.5 w-3.5" />}>Guardar</Button>
                            <Button variant="ghost" size="sm" onClick={cancelEditing} icon={<X className="h-3.5 w-3.5" />}>Cancelar</Button>
                          </>
                        ) : (
                          <>
                            <Button variant="secondary" size="sm" onClick={() => startEditing(product)} icon={<Pencil className="h-3.5 w-3.5" />}>Editar</Button>
                            <Link href={`/app/master/catalog-inventory/products/${product.id}` as Route} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--color-border)] px-2 text-xs font-medium hover:bg-[var(--color-surface-alt)]">
                              <Search className="h-3 w-3" /> Ver
                            </Link>
                            <Button variant="ghost" size="sm" onClick={() => setTab("pricing")} icon={<DollarSign className="h-3.5 w-3.5" />}>Precio</Button>
                            <Button variant={product.isActive ? "danger" : "success"} size="sm" onClick={() => toggleProduct(product).catch((error) => toast.error(error.message))}>
                              {product.isActive ? "Desactivar" : "Activar"}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {data.products.length === 0 ? <tr><td colSpan={10} className="text-center py-6 text-[var(--color-text-muted)]">No hay productos que coincidan con los filtros.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
        </>
      ) : null}

      {data && tab === "categories" ? <CategoriesPanel categories={data.categories} onDone={load} /> : null}

      {data && tab === "import" ? <UnifiedImportPanel branches={data.branches} categories={data.categories} onDone={load} /> : null}

      {/* ════════════ TAB: EXISTENCIAS ════════════ */}
      {data && tab === "stock" ? (
        <Card noPadding>
          <div className="hm-card-header-teal">
            <h2 className="text-sm font-semibold flex items-center gap-2"><Boxes className="h-4 w-4" /> Matriz de existencias</h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <select className="hm-input" value={filter} onChange={(event) => setFilter(event.target.value)}>
                {FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <Button variant="ghost" onClick={() => load().catch((e) => toast.error(e.message))} icon={<RefreshCcw className="h-4 w-4" />}>Refrescar</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="hm-table min-w-[900px] w-full">
                <thead><tr><th>Producto</th>{data.branches.map((branch) => <th key={branch.id}>{branch.code}</th>)}<th>Total</th><th>Estado</th></tr></thead>
                <tbody>
                  {matrix.map((row) => {
                    const total = row.branches.reduce((sum, item) => sum + item.quantity, 0);
                    const state = statusFor(total);
                    return <tr key={row.product.id}><td className="font-medium">{row.product.sku} · {row.product.name}</td>{row.branches.map((item) => <td key={item.branch.id}>{qty(item.quantity)}</td>)}<td className="font-semibold">{qty(total)}</td><td><Badge variant={state.variant}>{state.label}</Badge></td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      ) : null}

      {data && tab === "movements" ? <MovementsPanel branches={data.branches} products={data.products} movements={data.movements} onDone={load} /> : null}
      {data && tab === "pricing" ? <PricingPanel branches={data.branches} products={data.products} onSave={updateBranchPrice} /> : null}
      {data && tab === "transfers" ? <TransfersPanel transfers={data.transfers} /> : null}
      {data && tab === "reorder" ? <ReorderPanel alerts={data.reorderAlerts} /> : null}
      {data && tab === "audit" ? <AuditPanel logs={data.auditLogs} /> : null}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   KPI card
   ═══════════════════════════════════════════════════════════ */
function Kpi({ label, value }: { label: string; value: string | number }) {
  return <Card className="min-h-[104px] p-4"><p className="text-xs font-medium text-[var(--color-text-muted)]">{label}</p><p className="mt-3 break-words text-2xl font-bold leading-tight text-[var(--color-text)]">{value}</p></Card>;
}

/* ═══════════════════════════════════════════════════════════
   Compact movements list
   ═══════════════════════════════════════════════════════════ */
function CompactMovements({ movements }: { movements: Movement[] }) {
  if (!movements.length) return <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-5"><p className="text-sm text-[var(--color-text-muted)]">Sin movimientos recientes.</p></div>;
  return <div className="space-y-2">{movements.map((item) => <div key={item.id} className="grid gap-2 rounded border border-[var(--color-border)] p-2 text-xs md:grid-cols-6"><span>{new Date(item.createdAt).toLocaleString("es-NI")}</span><span>{item.product.sku}</span><span className="md:col-span-2">{item.product.name}</span><span>{item.branch.code}</span><span>{item.movementType} · {qty(item.quantity)}</span></div>)}</div>;
}

/* ═══════════════════════════════════════════════════════════
   UNIFIED IMPORT PANEL
   ═══════════════════════════════════════════════════════════ */
function UnifiedImportPanel({ branches, categories, onDone }: { branches: Branch[]; categories: Category[]; onDone: () => Promise<void> }) {
  const [importType, setImportType] = useState("CATALOG_WITH_INITIAL_INVENTORY");
  const [destinationMode, setDestinationMode] = useState("SINGLE");
  const [defaultBranchId, setDefaultBranchId] = useState(branches[0]?.id ?? "");
  const [filePayload, setFilePayload] = useState<{ fileContent?: string; fileBase64?: string }>({});
  const [batchId, setBatchId] = useState("");
  const [items, setItems] = useState<ImportPreviewItem[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [previewCsv, setPreviewCsv] = useState("");
  const [errorCsv, setErrorCsv] = useState("");
  const [createMissingProducts, setCreateMissingProducts] = useState(true);
  const [defaultCategoryId, setDefaultCategoryId] = useState(categories[0]?.id ?? "");

  async function onFile(file: File | null) {
    if (!file) return;
    if (file.name.toLowerCase().endsWith(".xlsx")) {
      const buffer = await file.arrayBuffer();
      let binary = "";
      new Uint8Array(buffer).forEach((byte) => { binary += String.fromCharCode(byte); });
      setFilePayload({ fileBase64: btoa(binary) });
    } else {
      setFilePayload({ fileContent: await file.text() });
    }
    setBatchId("");
    setItems([]);
    setSummary(null);
    setPreviewCsv("");
    setErrorCsv("");
  }

  async function preview() {
    const response = await apiFetch("/api/master/catalog-inventory/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "preview",
        importType,
        destinationMode,
        defaultBranchId,
        createMissingProducts,
        defaultCategoryId: defaultCategoryId || undefined,
        defaultUnit: "UN",
        defaultStandardSalePrice: 1,
        ...filePayload,
      }),
    });
    const raw = await response.json();
    if (!response.ok) throw new Error(raw.message ?? "No se pudo generar preview.");
    const result = unwrapApiData(raw);
    setBatchId(result.batchId ?? "");
    setItems(result.items ?? []);
    setSummary(result.summary ?? null);
    setPreviewCsv(result.previewCsv ?? "");
    setErrorCsv("");
    toast.success("Preview generado.");
  }

  async function execute() {
    if (!batchId || !summary || Number(summary.readyRows ?? summary.ready ?? 0) <= 0 || summary.status !== "PREVIEWED") {
      toast.error("Genera un preview vigente con lineas READY antes de ejecutar.");
      return;
    }
    const confirmed = window.confirm("CONFIRMACION FUERTE: esta importacion modificara catalogo, precios o inventario usando las lineas READY guardadas en BD. Continua solo si ya revisaste el preview.");
    if (!confirmed) return;

    const response = await apiFetch("/api/master/catalog-inventory/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "execute", batchId }),
    });
    const raw = await response.json();
    if (!response.ok) throw new Error(raw.message ?? "No se pudo ejecutar importacion.");
    const result = unwrapApiData(raw);
    const nextSummary: ImportSummary = {
      status: result.status,
      executedLines: result.executedLines,
      skippedLines: result.skippedLines,
      failedLines: result.failedLines,
      createdProducts: result.createdProducts,
      updatedProducts: result.updatedProducts,
      inventoryMovements: result.inventoryMovements,
      priceUpdates: result.priceUpdates,
      costUpdates: result.costUpdates,
    };
    setSummary(nextSummary);
    setErrorCsv(result.errorCsv ?? "");
    toast.success(`Importación ejecutada — Ejecutadas: ${result.executedLines}, Omitidas: ${result.skippedLines}, Fallidas: ${result.failedLines}`);
    await onDone();
  }

  function downloadCsv(content: string, filename: string) {
    if (!content) return;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  const readyRows = Number(summary?.readyRows ?? summary?.ready ?? 0);
  const canExecute = Boolean(batchId && summary?.status === "PREVIEWED" && readyRows > 0);

  return (
    <Card noPadding>
      <div className="hm-card-header-amber">
        <h2 className="text-sm font-semibold flex items-center gap-2"><FileUp className="h-4 w-4" /> Importación masiva</h2>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid gap-2 md:grid-cols-4">
          <Input type="file" accept=".xlsx,.csv,.tsv,.txt" onChange={(event) => onFile(event.target.files?.[0] ?? null)} />
          <select className="hm-input" value={importType} onChange={(event) => { setImportType(event.target.value); setBatchId(""); setItems([]); setSummary(null); }}>
            <option value="CATALOG_ONLY">Solo catalogo</option><option value="CATALOG_WITH_INITIAL_INVENTORY">Catalogo + inventario inicial</option><option value="INVENTORY_ONLY">Solo inventario</option><option value="PRICES_COSTS_ONLY">Solo precios/costos</option><option value="PHYSICAL_COUNT">Ajuste por conteo fisico</option>
          </select>
          <select className="hm-input" value={destinationMode} onChange={(event) => { setDestinationMode(event.target.value); setBatchId(""); setItems([]); setSummary(null); }}>
            <option value="SINGLE">Una sucursal</option><option value="ALL">Todas</option><option value="FILE">Sucursal del archivo</option>
          </select>
          <select className="hm-input" value={defaultBranchId} onChange={(event) => { setDefaultBranchId(event.target.value); setBatchId(""); setItems([]); setSummary(null); }}>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}
          </select>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={createMissingProducts} onChange={(event) => setCreateMissingProducts(event.target.checked)} /> Crear productos si no existen</label>
          <select className="hm-input" value={defaultCategoryId} onChange={(event) => setDefaultCategoryId(event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => preview().catch((error) => toast.error(error.message))} icon={<Search className="h-4 w-4" />}>Preview</Button>
            <Button variant="success" onClick={() => execute().catch((error) => toast.error(error.message))} disabled={!canExecute} icon={<Check className="h-4 w-4" />}>Ejecutar</Button>
          </div>
        </div>
        {summary ? <div className="grid gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-xs md:grid-cols-5"><span>Filas: {summary.parsedRows ?? "-"}</span><span>Expandidas: {summary.expandedRows ?? "-"}</span><span>Existentes: {summary.existingProducts ?? "-"}</span><span>Nuevos: {summary.newProducts ?? "-"}</span><span>READY/ERROR: {summary.readyRows ?? summary.ready ?? 0}/{summary.errorRows ?? summary.errors ?? 0}</span><span>Estado: {summary.status ?? "-"}</span><span>Ejecutadas: {summary.executedLines ?? 0}</span><span>Omitidas: {summary.skippedLines ?? 0}</span><span>Fallidas: {summary.failedLines ?? 0}</span><span>Movimientos: {summary.inventoryMovements ?? 0}</span></div> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" disabled={!previewCsv} onClick={() => downloadCsv(previewCsv, `preview-importacion-${batchId || "catalogo"}.csv`)} icon={<FileUp className="h-4 w-4" />}>CSV preview</Button>
          <Button variant="ghost" disabled={!errorCsv} onClick={() => downloadCsv(errorCsv, `errores-importacion-${batchId || "catalogo"}.csv`)} icon={<FileUp className="h-4 w-4" />}>CSV errores</Button>
        </div>
        {items.length ? <div className="overflow-x-auto"><table className="hm-table min-w-[980px] w-full text-xs"><thead><tr><th>Fila</th><th>SKU</th><th>Producto</th><th>Accion</th><th>Sucursal</th><th>Cantidad</th><th>Costo</th><th>Precio</th><th>Estado</th><th>Mensajes</th></tr></thead><tbody>{items.slice(0, 200).map((item, index) => <tr key={`${item.rowNumber}-${index}`}><td>{item.rowNumber}</td><td>{item.sku}</td><td>{item.name}</td><td>{item.action}</td><td>{item.targetBranchCode}</td><td>{item.quantity ?? ""}</td><td>{item.unitCost ?? ""}</td><td>{item.standardSalePrice ?? ""}</td><td><Badge variant={item.status === "READY" || item.status === "EXECUTED" ? "success" : item.status === "ERROR" || item.status === "FAILED" ? "danger" : "warning"}>{item.status}</Badge></td><td>{item.messages?.join(" | ") || "OK"}</td></tr>)}</tbody></table></div> : null}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
   MOVEMENTS PANEL
   ═══════════════════════════════════════════════════════════ */
function MovementsPanel({ branches, products, movements, onDone }: { branches: Branch[]; products: ProductRow[]; movements: Movement[]; onDone: () => Promise<void> }) {
  const [form, setForm] = useState({ branchId: branches[0]?.id ?? "", productId: products[0]?.id ?? "", movementType: "ADJUSTMENT_IN", quantity: "1", unitCost: "1", referenceType: "MASTER_ADJUSTMENT", referenceId: "MANUAL" });
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const response = await apiFetch("/api/inventory/movements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, quantity: Number(form.quantity), unitCost: Number(form.unitCost) }) });
    if (!response.ok) throw new Error("No se pudo registrar el movimiento.");
    toast.success("Movimiento registrado");
    await onDone();
  }
  return (
    <Card noPadding>
      <div className="hm-card-header-purple">
        <h2 className="text-sm font-semibold flex items-center gap-2"><History className="h-4 w-4" /> Movimientos / Kardex</h2>
      </div>
      <div className="p-4 space-y-4">
        <form className="grid gap-2 md:grid-cols-6" onSubmit={(event) => submit(event).catch((e) => toast.error(e.message))}>
          <select className="hm-input" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select>
          <select className="hm-input" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select>
          <select className="hm-input" value={form.movementType} onChange={(e) => setForm({ ...form, movementType: e.target.value })}><option>ADJUSTMENT_IN</option><option>ADJUSTMENT_OUT</option><option>PURCHASE_IN</option><option>RETURN_IN</option><option>RETURN_OUT</option></select>
          <Input type="number" min="0.0001" step="0.0001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          <Input type="number" min="0" step="0.0001" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} />
          <Button type="submit" icon={<Plus className="h-4 w-4" />}>Registrar</Button>
        </form>
        <CompactMovements movements={movements} />
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
   PRICING PANEL — FULL REWRITE
   Pre-populates inputs with current branchProductSettings,
   uses controlled state, shows save button per cell, toast.
   ═══════════════════════════════════════════════════════════ */
type PricingDraft = Record<string, Record<string, { cost: string; price: string; dirty: boolean }>>;

function buildPricingDraft(products: ProductRow[], branches: Branch[]): PricingDraft {
  const draft: PricingDraft = {};
  for (const product of products) {
    draft[product.id] = {};
    const settingsMap = new Map(product.branchProductSettings.map((s) => [s.branchId, s]));
    for (const branch of branches) {
      const setting = settingsMap.get(branch.id);
      draft[product.id][branch.id] = {
        cost: setting?.branchCost ?? "",
        price: setting?.branchPrice ?? "",
        dirty: false,
      };
    }
  }
  return draft;
}

function PricingPanel({ branches, products, onSave }: { branches: Branch[]; products: ProductRow[]; onSave: (product: ProductRow, branch: Branch, field: "branchPrice" | "branchCost", value: string) => Promise<void> }) {
  const [draft, setDraft] = useState<PricingDraft>(() => buildPricingDraft(products, branches));
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Re-sync draft when products change (after a save + reload)
  useEffect(() => {
    setDraft(buildPricingDraft(products, branches));
  }, [products, branches]);

  function updateCell(productId: string, branchId: string, field: "cost" | "price", value: string) {
    setDraft((prev) => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        [branchId]: { ...prev[productId][branchId], [field]: value, dirty: true },
      },
    }));
  }

  async function saveCell(product: ProductRow, branch: Branch, field: "cost" | "price") {
    const cell = draft[product.id]?.[branch.id];
    if (!cell) return;
    const apiField = field === "cost" ? "branchCost" : "branchPrice";
    const key = `${product.id}-${branch.id}-${field}`;
    setSavingKey(key);
    try {
      await onSave(product, branch, apiField as "branchCost" | "branchPrice", cell[field]);
    } finally {
      setSavingKey(null);
    }
  }

  async function saveAllDirty(product: ProductRow) {
    const cells = draft[product.id];
    if (!cells) return;
    let saved = 0;
    for (const branch of branches) {
      const cell = cells[branch.id];
      if (!cell?.dirty) continue;
      // Save both cost and price if changed
      const origSetting = product.branchProductSettings.find((s) => s.branchId === branch.id);
      if (cell.cost !== (origSetting?.branchCost ?? "")) {
        await onSave(product, branch, "branchCost", cell.cost);
        saved++;
      }
      if (cell.price !== (origSetting?.branchPrice ?? "")) {
        await onSave(product, branch, "branchPrice", cell.price);
        saved++;
      }
    }
    if (saved === 0) toast("Sin cambios pendientes", { icon: "ℹ️" });
  }

  return (
    <Card noPadding>
      <div className="hm-card-header-green">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <DollarSign className="h-4 w-4" /> Precios y costos por sucursal
        </h2>
        <p className="mt-0.5 text-xs opacity-90">Edite los valores y presione el botón 💾 para guardar cada celda, o &quot;Guardar fila&quot; para guardar todos los cambios de un producto.</p>
      </div>
      <div className="overflow-x-auto p-4">
        <table className="hm-table min-w-[1100px] w-full">
          <thead>
            <tr>
              <th className="min-w-[200px]">Producto</th>
              <th>Costo base</th>
              <th>Precio base</th>
              <th>Margen</th>
              {branches.map((b) => (
                <th key={b.id} className="min-w-[180px] text-center">
                  <span className="block">{b.code}</span>
                  <span className="block text-[10px] font-normal opacity-70">Costo / Precio</span>
                </th>
              ))}
              <th className="min-w-[100px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const margin = p.baseCost > 0 ? (((p.basePrice - p.baseCost) / p.baseCost) * 100).toFixed(1) + "%" : "N/D";
              const hasDirty = branches.some((b) => draft[p.id]?.[b.id]?.dirty);
              return (
                <tr key={p.id}>
                  <td className="font-medium">{p.sku} · {p.name}</td>
                  <td>{money(p.baseCost)}</td>
                  <td>{money(p.basePrice)}</td>
                  <td>
                    <Badge variant={p.baseCost > 0 && p.basePrice > p.baseCost ? "success" : "warning"}>{margin}</Badge>
                  </td>
                  {branches.map((b) => {
                    const cell = draft[p.id]?.[b.id] ?? { cost: "", price: "", dirty: false };
                    const costKey = `${p.id}-${b.id}-cost`;
                    const priceKey = `${p.id}-${b.id}-price`;
                    return (
                      <td key={b.id} className="py-2">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <Input
                              className="h-7 text-xs flex-1"
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Costo"
                              value={cell.cost}
                              onChange={(e) => updateCell(p.id, b.id, "cost", e.target.value)}
                            />
                            <button
                              type="button"
                              title="Guardar costo"
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-success-600)] text-white hover:bg-[var(--color-success-700)] disabled:opacity-50 transition-colors"
                              disabled={savingKey === costKey}
                              onClick={() => saveCell(p, b, "cost")}
                            >
                              {savingKey === costKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            </button>
                          </div>
                          <div className="flex items-center gap-1">
                            <Input
                              className="h-7 text-xs flex-1"
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Precio"
                              value={cell.price}
                              onChange={(e) => updateCell(p.id, b.id, "price", e.target.value)}
                            />
                            <button
                              type="button"
                              title="Guardar precio"
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-info-600)] text-white hover:bg-[var(--color-info-700)] disabled:opacity-50 transition-colors"
                              disabled={savingKey === priceKey}
                              onClick={() => saveCell(p, b, "price")}
                            >
                              {savingKey === priceKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            </button>
                          </div>
                        </div>
                      </td>
                    );
                  })}
                  <td>
                    <Button
                      variant={hasDirty ? "success" : "ghost"}
                      size="sm"
                      onClick={() => saveAllDirty(p)}
                      icon={<Save className="h-3.5 w-3.5" />}
                    >
                      Guardar fila
                    </Button>
                  </td>
                </tr>
              );
            })}
            {products.length === 0 ? (
              <tr><td colSpan={4 + branches.length + 1} className="py-6 text-center text-[var(--color-text-muted)]">No hay productos.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
   TRANSFERS PANEL
   ═══════════════════════════════════════════════════════════ */
function TransfersPanel({ transfers }: { transfers: Transfer[] }) {
  return (
    <Card noPadding>
      <div className="hm-card-header-blue">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Shuffle className="h-4 w-4" /> Transferencias</h2>
      </div>
      <div className="p-4 space-y-2">
        {transfers.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)] py-4 text-center">Sin transferencias registradas.</p>
        ) : transfers.map((transfer) => (
          <div key={transfer.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
            <div className="flex justify-between gap-2"><strong>{transfer.transferNumber}</strong><Badge>{transfer.status}</Badge></div>
            <p className="text-xs text-[var(--color-text-muted)]">{transfer.fromBranch.code} → {transfer.toBranch.code} · {new Date(transfer.createdAt).toLocaleDateString("es-NI")}</p>
            <p className="text-xs">{transfer.lines.map((line) => `${line.product.sku} (${qty(line.quantityRequested)})`).join(", ")}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
   REORDER PANEL
   ═══════════════════════════════════════════════════════════ */
function ReorderPanel({ alerts }: { alerts: ReorderAlert[] }) {
  return (
    <Card noPadding>
      <div className="hm-card-header-amber">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Settings2 className="h-4 w-4" /> Alertas de reposición</h2>
      </div>
      <div className="p-4 space-y-2">
        {alerts.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)] py-4 text-center">Sin alertas de reposición.</p>
        ) : alerts.map((alert) => (
          <div key={alert.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
            <div className="flex justify-between"><strong>{alert.product.sku} · {alert.product.name}</strong><Badge variant="warning">{alert.alertType}</Badge></div>
            <p className="text-xs text-[var(--color-text-muted)]">{alert.branch.code} · Actual {qty(alert.currentQuantity)} · Sugerido {qty(alert.suggestedQuantity)}</p>
            <p className="text-xs">{alert.reason}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
   CATEGORIES PANEL
   ═══════════════════════════════════════════════════════════ */
function CategoriesPanel({ categories, onDone }: { categories: Category[]; onDone: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function createCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!code.trim() || !name.trim()) { toast.error("Código y nombre son obligatorios."); return; }
    setSaving(true);
    try {
      const res = await apiFetch("/api/catalog/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), name: name.trim() }),
      });
      if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.message ?? "No se pudo crear la categoría."); }
      setCode("");
      setName("");
      toast.success("Categoría creada exitosamente.");
      await onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al crear categoría.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item: Category) {
    try {
      await apiFetch(`/api/catalog/categories/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      toast.success(`Categoría ${item.isActive ? "archivada" : "activada"}.`);
      await onDone();
    } catch {
      toast.error("No se pudo actualizar la categoría.");
    }
  }

  return (
    <div className="space-y-4">
      <Card noPadding>
        <div className="hm-card-header-purple">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Tags className="h-4 w-4" /> Crear nueva categoría</h2>
        </div>
        <div className="p-4">
          <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={createCategory}>
            <Input placeholder="Código (ej: FER)" value={code} onChange={(e) => setCode(e.target.value)} required />
            <Input placeholder="Nombre (ej: Ferretería)" value={name} onChange={(e) => setName(e.target.value)} required />
            <Button type="submit" variant="success" disabled={saving} icon={<Save className="h-4 w-4" />}>{saving ? "Creando…" : "Crear categoría"}</Button>
          </form>
        </div>
      </Card>
      <Card noPadding>
        <div className="hm-card-header-teal">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Tags className="h-4 w-4" /> Categorías ({categories.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="hm-table min-w-[600px] w-full">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Estado</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((item) => (
                <tr key={item.id}>
                  <td className="font-semibold">{item.code}</td>
                  <td>{item.name}</td>
                  <td><Badge variant={item.isActive ? "success" : "warning"}>{item.isActive ? "Activo" : "Inactivo"}</Badge></td>
                  <td className="text-right">
                    <Button variant={item.isActive ? "danger" : "success"} size="sm" onClick={() => toggleActive(item)} icon={item.isActive ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}>
                      {item.isActive ? "Archivar" : "Activar"}
                    </Button>
                  </td>
                </tr>
              ))}
              {categories.length === 0 ? <tr><td colSpan={4} className="py-6 text-center text-[var(--color-text-muted)]">No hay categorías registradas.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   AUDIT PANEL
   ═══════════════════════════════════════════════════════════ */
function AuditPanel({ logs }: { logs: AuditRow[] }) {
  return (
    <Card noPadding>
      <div className="hm-card-header-red">
        <h2 className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Auditoría</h2>
      </div>
      <div className="overflow-x-auto p-4">
        <table className="hm-table min-w-[760px] w-full">
          <thead>
            <tr><th>Fecha</th><th>Módulo</th><th>Acción</th><th>Entidad</th><th>Sucursal</th><th>Usuario</th></tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.occurredAt).toLocaleString("es-NI")}</td>
                <td>{log.module}</td>
                <td>{log.action}</td>
                <td>{log.entityType}</td>
                <td>{log.branch?.code ?? "GLOBAL"}</td>
                <td>{log.actor ? `${log.actor.fullName || log.actor.username}` : "sistema"}</td>
              </tr>
            ))}
            {logs.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-[var(--color-text-muted)]">Sin registros de auditoría.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}