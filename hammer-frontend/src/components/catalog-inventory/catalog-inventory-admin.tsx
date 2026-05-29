"use client";

import Link from "next/link";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Boxes, ChevronDown, ChevronUp, FileUp, History, Package, Plus, RefreshCcw, Search, Settings2, Shuffle, Tags, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, qty } from "@/lib/format";

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

export function CatalogInventoryAdmin() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<CenterData | null>(null);
  const [tab, setTab] = useState<Tab>((searchParams.get("tab") as Tab) || "summary");
  const [q, setQ] = useState("");
  const [branchId, setBranchId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

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
      setFeedback(error instanceof Error ? error.message : "No se pudo cargar Catalogo e Inventario.");
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
    await load();
  }

  async function updateBranchPrice(product: ProductRow, branch: Branch, field: "branchPrice" | "branchCost", value: string) {
    const numeric = value.trim() === "" ? null : Number(value);
    if (numeric !== null && (!Number.isFinite(numeric) || numeric < 0)) {
      setFeedback("No se permiten costos o precios negativos.");
      return;
    }
    const response = await apiFetch("/api/master/catalog-inventory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId: branch.id, productId: product.id, [field]: numeric }),
    });
    if (!response.ok) {
      setFeedback("No se pudo guardar la configuracion por sucursal.");
      return;
    }
    setFeedback("Configuracion guardada.");
    await load();
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
      setFeedback("Nombre, categoría y precio son obligatorios.");
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
      setFeedback("Producto creado exitosamente.");
      setNewProduct({ name: "", sku: "", categoryId: "", unit: "UN", standardSalePrice: "", description: "", allowsFraction: false });
      setShowCreateForm(false);
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Error al crear producto.");
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
      <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Catalogo e Inventario</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">Centro MASTER para productos, existencias, precios, movimientos, transferencias y reposicion.</p>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.5fr)_minmax(180px,1fr)_minmax(180px,1fr)_auto] xl:max-w-[820px]">
          <Input className="h-10" placeholder="Buscar SKU o producto" value={q} onChange={(event) => setQ(event.target.value)} />
          <select className="h-10 min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">Todas las sucursales</option>
            {data?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}
          </select>
          <select className="h-10 min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Todas las categorias</option>
            {data?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <Button className="h-10 justify-center sm:col-span-2 lg:col-span-1" variant="secondary" onClick={() => load().catch((error) => setFeedback(error.message))} loading={loading} icon={<Search className="h-4 w-4" />}>Aplicar</Button>
        </div>
      </div>
      </Card>

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

      {feedback ? <Card className="border-[var(--color-info-300)] bg-[var(--color-info-50)] p-3 text-sm text-[var(--color-info-700)]">{feedback}</Card> : null}
      {loading || !data ? <Card className="p-4 text-sm text-[var(--color-text-muted)]">Cargando centro de catalogo e inventario...</Card> : null}

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
          <Card className="p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Ultimos movimientos</h2>
            <div className="mt-3">
              <CompactMovements movements={data.movements.slice(0, 10)} />
            </div>
          </Card>
        </div>
      ) : null}

      {data && tab === "products" ? (
        <>
        {/* ── Panel para crear producto manual ── */}
        <Card className="p-4">
          <button
            type="button"
            className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)] w-full"
            onClick={() => setShowCreateForm(!showCreateForm)}
          >
            <Plus className="h-4 w-4" />
            Crear producto manualmente
            {showCreateForm ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
          </button>
          {showCreateForm && (
            <div className="mt-4 space-y-4">
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
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
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
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
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
                <Button variant="success" onClick={handleCreateProduct} disabled={creating}>
                  {creating ? "Creando…" : "Crear producto"}
                </Button>
                <Button variant="ghost" onClick={() => setShowCreateForm(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card noPadding>
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full text-sm">
              <thead className="text-left text-xs font-bold uppercase text-[var(--color-text-secondary)]">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="px-3 py-3">SKU</th><th>Producto</th><th>Categoria</th><th>Unidad</th><th>Stock total</th><th>Suc.</th><th>Costo base</th><th>Precio base</th><th>Estado</th><th className="text-right pr-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((product) => (
                  <tr key={product.id} className="border-b border-[var(--color-border)]">
                    <td className="px-3 py-3 font-semibold">{product.sku}</td>
                    <td>{product.name}</td>
                    <td>{product.category?.name ?? "Sin categoria"}</td>
                    <td>{product.unit}</td>
                    <td>{qty(product.totalStock)}</td>
                    <td>{product.branchesWithStock}</td>
                    <td>{money(product.baseCost)}</td>
                    <td>{money(product.basePrice)}</td>
                    <td><Badge variant={product.isActive ? "success" : "warning"}>{product.isActive ? "Activo" : "Inactivo"}</Badge></td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <Link href={`/app/master/catalog-inventory/products/${product.id}` as Route} className="rounded border border-[var(--color-border)] px-2 py-1 text-xs">Ver</Link>
                        <button className="rounded border border-[var(--color-border)] px-2 py-1 text-xs" onClick={() => setTab("stock")}>Existencias</button>
                        <button className="rounded border border-[var(--color-border)] px-2 py-1 text-xs" onClick={() => setTab("movements")}>Ajustar</button>
                        <button className="rounded border border-[var(--color-border)] px-2 py-1 text-xs" onClick={() => setTab("pricing")}>Precio</button>
                        <button className="rounded border border-[var(--color-border)] px-2 py-1 text-xs" onClick={() => toggleProduct(product).catch((error) => setFeedback(error.message))}>{product.isActive ? "Desactivar" : "Activar"}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        </>
      ) : null}

      {data && tab === "categories" ? <CategoriesPanel categories={data.categories} onDone={load} /> : null}

      {data && tab === "import" ? <UnifiedImportPanel branches={data.branches} categories={data.categories} onDone={load} /> : null}

      {data && tab === "stock" ? (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" value={filter} onChange={(event) => setFilter(event.target.value)}>
              {FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <Button variant="ghost" onClick={() => load().catch((error) => setFeedback(error.message))} icon={<RefreshCcw className="h-4 w-4" />}>Refrescar</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead><tr className="border-b border-[var(--color-border)] text-left text-xs font-bold uppercase text-[var(--color-text-secondary)]"><th className="py-2">Producto</th>{data.branches.map((branch) => <th key={branch.id}>{branch.code}</th>)}<th>Total</th><th>Estado</th></tr></thead>
              <tbody>
                {matrix.map((row) => {
                  const total = row.branches.reduce((sum, item) => sum + item.quantity, 0);
                  const state = statusFor(total);
                  return <tr key={row.product.id} className="border-b border-[var(--color-border)]"><td className="py-2 font-medium">{row.product.sku} · {row.product.name}</td>{row.branches.map((item) => <td key={item.branch.id}>{qty(item.quantity)}</td>)}<td>{qty(total)}</td><td><Badge variant={state.variant}>{state.label}</Badge></td></tr>;
                })}
              </tbody>
            </table>
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

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <Card className="min-h-[104px] p-4"><p className="text-xs font-medium text-[var(--color-text-muted)]">{label}</p><p className="mt-3 break-words text-2xl font-bold leading-tight text-[var(--color-text)]">{value}</p></Card>;
}

function CompactMovements({ movements }: { movements: Movement[] }) {
  if (!movements.length) return <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-5"><p className="text-sm text-[var(--color-text-muted)]">Sin movimientos recientes.</p></div>;
  return <div className="space-y-2">{movements.map((item) => <div key={item.id} className="grid gap-2 rounded border border-[var(--color-border)] p-2 text-xs md:grid-cols-6"><span>{new Date(item.createdAt).toLocaleString("es-NI")}</span><span>{item.product.sku}</span><span className="md:col-span-2">{item.product.name}</span><span>{item.branch.code}</span><span>{item.movementType} · {qty(item.quantity)}</span></div>)}</div>;
}

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
  const [feedback, setFeedback] = useState("");

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
    const data = unwrapApiData(raw);
    setBatchId(data.batchId ?? "");
    setItems(data.items ?? []);
    setSummary(data.summary ?? null);
    setPreviewCsv(data.previewCsv ?? "");
    setErrorCsv("");
    setFeedback("Preview generado.");
  }

  async function execute() {
    if (!batchId || !summary || Number(summary.readyRows ?? summary.ready ?? 0) <= 0 || summary.status !== "PREVIEWED") {
      setFeedback("Genera un preview vigente con lineas READY antes de ejecutar.");
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
    setFeedback(`Importacion ejecutada. Lineas: ${result.executedLines}, omitidas: ${result.skippedLines}, fallidas: ${result.failedLines}. Movimientos: ${result.inventoryMovements}.`);
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

  return <Card className="space-y-4 p-4">
    <div className="grid gap-2 md:grid-cols-4">
      <Input type="file" accept=".xlsx,.csv,.tsv,.txt" onChange={(event) => onFile(event.target.files?.[0] ?? null)} />
      <select className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" value={importType} onChange={(event) => { setImportType(event.target.value); setBatchId(""); setItems([]); setSummary(null); }}>
        <option value="CATALOG_ONLY">Solo catalogo</option><option value="CATALOG_WITH_INITIAL_INVENTORY">Catalogo + inventario inicial</option><option value="INVENTORY_ONLY">Solo inventario</option><option value="PRICES_COSTS_ONLY">Solo precios/costos</option><option value="PHYSICAL_COUNT">Ajuste por conteo fisico</option>
      </select>
      <select className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" value={destinationMode} onChange={(event) => { setDestinationMode(event.target.value); setBatchId(""); setItems([]); setSummary(null); }}>
        <option value="SINGLE">Una sucursal</option><option value="ALL">Todas</option><option value="FILE">Sucursal del archivo</option>
      </select>
      <select className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" value={defaultBranchId} onChange={(event) => { setDefaultBranchId(event.target.value); setBatchId(""); setItems([]); setSummary(null); }}>
        {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}
      </select>
    </div>
    <div className="grid gap-2 md:grid-cols-3">
      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={createMissingProducts} onChange={(event) => setCreateMissingProducts(event.target.checked)} /> Crear productos si no existen</label>
      <select className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" value={defaultCategoryId} onChange={(event) => setDefaultCategoryId(event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
      <div className="flex gap-2"><Button variant="secondary" onClick={() => preview().catch((error) => setFeedback(error.message))}>Preview</Button><Button variant="success" onClick={() => execute().catch((error) => setFeedback(error.message))} disabled={!canExecute}>Ejecutar</Button></div>
    </div>
    {feedback ? <p className="rounded border border-[var(--color-border)] p-2 text-sm">{feedback}</p> : null}
    {summary ? <div className="grid gap-2 text-xs md:grid-cols-5"><span>Filas: {summary.parsedRows ?? "-"}</span><span>Expandidas: {summary.expandedRows ?? "-"}</span><span>Existentes: {summary.existingProducts ?? "-"}</span><span>Nuevos: {summary.newProducts ?? "-"}</span><span>READY/ERROR: {summary.readyRows ?? summary.ready ?? 0}/{summary.errorRows ?? summary.errors ?? 0}</span><span>Estado: {summary.status ?? "-"}</span><span>Ejecutadas: {summary.executedLines ?? 0}</span><span>Omitidas: {summary.skippedLines ?? 0}</span><span>Fallidas: {summary.failedLines ?? 0}</span><span>Movimientos: {summary.inventoryMovements ?? 0}</span></div> : null}
    <div className="flex flex-wrap gap-2">
      <Button variant="ghost" disabled={!previewCsv} onClick={() => downloadCsv(previewCsv, `preview-importacion-${batchId || "catalogo"}.csv`)}>CSV preview</Button>
      <Button variant="ghost" disabled={!errorCsv} onClick={() => downloadCsv(errorCsv, `errores-importacion-${batchId || "catalogo"}.csv`)}>CSV errores</Button>
    </div>
    {items.length ? <div className="overflow-x-auto"><table className="min-w-[980px] w-full text-xs"><thead><tr className="border-b text-left"><th>Fila</th><th>SKU</th><th>Producto</th><th>Accion</th><th>Sucursal</th><th>Cantidad</th><th>Costo</th><th>Precio</th><th>Estado</th><th>Mensajes</th></tr></thead><tbody>{items.slice(0, 200).map((item, index) => <tr key={`${item.rowNumber}-${index}`} className="border-b"><td>{item.rowNumber}</td><td>{item.sku}</td><td>{item.name}</td><td>{item.action}</td><td>{item.targetBranchCode}</td><td>{item.quantity ?? ""}</td><td>{item.unitCost ?? ""}</td><td>{item.standardSalePrice ?? ""}</td><td>{item.status}</td><td>{item.messages?.join(" | ") || "OK"}</td></tr>)}</tbody></table></div> : null}
  </Card>;
}

function MovementsPanel({ branches, products, movements, onDone }: { branches: Branch[]; products: ProductRow[]; movements: Movement[]; onDone: () => Promise<void> }) {
  const [form, setForm] = useState({ branchId: branches[0]?.id ?? "", productId: products[0]?.id ?? "", movementType: "ADJUSTMENT_IN", quantity: "1", unitCost: "1", referenceType: "MASTER_ADJUSTMENT", referenceId: "MANUAL" });
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const response = await apiFetch("/api/inventory/movements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, quantity: Number(form.quantity), unitCost: Number(form.unitCost) }) });
    if (!response.ok) throw new Error("No se pudo registrar el movimiento.");
    await onDone();
  }
  return <Card className="space-y-4 p-4"><form className="grid gap-2 md:grid-cols-6" onSubmit={(event) => submit(event).catch(() => undefined)}><select className="rounded border px-2 py-2" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select><select className="rounded border px-2 py-2" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select><select className="rounded border px-2 py-2" value={form.movementType} onChange={(e) => setForm({ ...form, movementType: e.target.value })}><option>ADJUSTMENT_IN</option><option>ADJUSTMENT_OUT</option><option>PURCHASE_IN</option><option>RETURN_IN</option><option>RETURN_OUT</option></select><Input type="number" min="0.0001" step="0.0001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /><Input type="number" min="0" step="0.0001" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} /><Button type="submit">Registrar</Button></form><CompactMovements movements={movements} /></Card>;
}

function PricingPanel({ branches, products, onSave }: { branches: Branch[]; products: ProductRow[]; onSave: (product: ProductRow, branch: Branch, field: "branchPrice" | "branchCost", value: string) => Promise<void> }) {
  return <Card className="p-4"><div className="overflow-x-auto"><table className="min-w-[1100px] w-full text-sm"><thead><tr className="border-b text-left"><th>Producto</th><th>Costo base</th><th>Precio base</th><th>Margen</th>{branches.map((b) => <th key={b.id}>{b.code}</th>)}</tr></thead><tbody>{products.map((p) => <tr key={p.id} className="border-b"><td className="py-2">{p.sku} · {p.name}</td><td>{money(p.baseCost)}</td><td>{money(p.basePrice)}</td><td>{p.baseCost > 0 ? `${(((p.basePrice - p.baseCost) / p.baseCost) * 100).toFixed(1)}%` : "N/D"}</td>{branches.map((b) => <td key={b.id} className="min-w-[150px] py-2"><div className="flex gap-1"><Input className="h-8" placeholder="Costo" onBlur={(e) => e.currentTarget.value && onSave(p, b, "branchCost", e.currentTarget.value)} /><Input className="h-8" placeholder="Precio" onBlur={(e) => e.currentTarget.value && onSave(p, b, "branchPrice", e.currentTarget.value)} /></div></td>)}</tr>)}</tbody></table></div></Card>;
}

function TransfersPanel({ transfers }: { transfers: Transfer[] }) {
  return <Card className="p-4"><div className="space-y-2">{transfers.map((transfer) => <div key={transfer.id} className="rounded border border-[var(--color-border)] p-3 text-sm"><div className="flex justify-between gap-2"><strong>{transfer.transferNumber}</strong><Badge>{transfer.status}</Badge></div><p className="text-xs text-[var(--color-text-muted)]">{transfer.fromBranch.code} a {transfer.toBranch.code} · {new Date(transfer.createdAt).toLocaleDateString("es-NI")}</p><p className="text-xs">{transfer.lines.map((line) => `${line.product.sku} (${qty(line.quantityRequested)})`).join(", ")}</p></div>)}</div></Card>;
}

function ReorderPanel({ alerts }: { alerts: ReorderAlert[] }) {
  return <Card className="p-4"><div className="space-y-2">{alerts.map((alert) => <div key={alert.id} className="rounded border border-[var(--color-border)] p-3 text-sm"><div className="flex justify-between"><strong>{alert.product.sku} · {alert.product.name}</strong><Badge variant="warning">{alert.alertType}</Badge></div><p className="text-xs text-[var(--color-text-muted)]">{alert.branch.code} · Actual {qty(alert.currentQuantity)} · Sugerido {qty(alert.suggestedQuantity)}</p><p className="text-xs">{alert.reason}</p></div>)}</div></Card>;
}

function CategoriesPanel({ categories, onDone }: { categories: Category[]; onDone: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function createCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!code.trim() || !name.trim()) { setFeedback("Código y nombre son obligatorios."); return; }
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch("/api/catalog/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), name: name.trim() }),
      });
      if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.message ?? "No se pudo crear la categoría."); }
      setCode("");
      setName("");
      setFeedback("Categoría creada exitosamente.");
      await onDone();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Error al crear categoría.");
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
      setFeedback(`Categoría ${item.isActive ? "archivada" : "activada"}.`);
      await onDone();
    } catch {
      setFeedback("No se pudo actualizar la categoría.");
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">Crear nueva categoría</h2>
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={createCategory}>
          <Input placeholder="Código (ej: FER)" value={code} onChange={(e) => setCode(e.target.value)} required />
          <Input placeholder="Nombre (ej: Ferretería)" value={name} onChange={(e) => setName(e.target.value)} required />
          <Button type="submit" variant="success" disabled={saving}>{saving ? "Creando…" : "Crear categoría"}</Button>
        </form>
        {feedback ? <p className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-2 text-sm">{feedback}</p> : null}
      </Card>
      <Card noPadding>
        <div className="overflow-x-auto">
          <table className="min-w-[600px] w-full text-sm">
            <thead className="text-left text-xs font-bold uppercase text-[var(--color-text-secondary)]">
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-3 py-3">Código</th>
                <th>Nombre</th>
                <th>Estado</th>
                <th className="text-right pr-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((item) => (
                <tr key={item.id} className="border-b border-[var(--color-border)]">
                  <td className="px-3 py-3 font-semibold">{item.code}</td>
                  <td>{item.name}</td>
                  <td><Badge variant={item.isActive ? "success" : "warning"}>{item.isActive ? "Activo" : "Inactivo"}</Badge></td>
                  <td className="px-3 text-right">
                    <button className="rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-surface-alt)]" onClick={() => toggleActive(item)}>
                      {item.isActive ? "Archivar" : "Activar"}
                    </button>
                  </td>
                </tr>
              ))}
              {categories.length === 0 ? <tr><td colSpan={4} className="px-3 py-6 text-center text-[var(--color-text-muted)]">No hay categorías registradas.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function AuditPanel({ logs }: { logs: AuditRow[] }) {
  return <Card className="p-4"><div className="overflow-x-auto"><table className="min-w-[760px] w-full text-sm"><thead><tr className="border-b text-left"><th>Fecha</th><th>Modulo</th><th>Accion</th><th>Entidad</th><th>Sucursal</th><th>Usuario</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id} className="border-b"><td className="py-2">{new Date(log.occurredAt).toLocaleString("es-NI")}</td><td>{log.module}</td><td>{log.action}</td><td>{log.entityType}</td><td>{log.branch?.code ?? "GLOBAL"}</td><td>{log.actor ? `${log.actor.fullName || log.actor.username} (usuario: ${log.actor.username})` : "sistema"}</td></tr>)}</tbody></table></div></Card>;
}
