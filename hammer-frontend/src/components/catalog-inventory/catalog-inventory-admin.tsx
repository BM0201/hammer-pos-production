"use client";

import Link from "next/link";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle, BarChart3, Boxes, Building2, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  CheckCircle2, DollarSign, Download, FileSpreadsheet, FileUp, History, Info, Loader2, Package, Pencil,
  Plus, RefreshCcw, Save, Search, Settings2, Shuffle, Sparkles, Tags, Trash2,
  TrendingUp, Wand2, X, Zap,
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
  barcode?: string | null;
  name: string;
  unit: string;
  isActive: boolean;
  baseCost: number;
  globalCost?: number | null;
  basePrice: number;
  totalStock: number;
  branchesWithStock: number;
  inventoryValue: number;
  category?: { id?: string; name: string };
  inventoryBalances: Array<{ id: string; branchId: string; quantityOnHand: string; weightedAverageCost: string; branch: Branch }>;
  branchProductSettings: Array<{ branchId: string; branchCost?: string | null; branchPrice?: string | null; isAvailable: boolean; branch: Branch }>;
  stockConversion?: {
    stockGroupId: string;
    stockGroupCode: string;
    stockGroupName: string;
    baseUnit: string;
    packageUnit?: string | null;
    saleUnit: string;
    conversionFactor: string | number;
    conversionFactorToBase?: string | number | null;
    tracksPackages?: boolean;
    approximateFactor?: boolean;
    minimumClosedPackageReserve?: string | number | null;
    autoOpenForUnitSale?: boolean;
    isPackagePresentation?: boolean;
    isCanonical: boolean;
  } | null;
  sharedStock?: {
    baseQuantity: number;
    saleQuantity: number;
    baseUnit: string;
    saleUnit: string;
    packageStock?: {
      closedPackageQuantity: number;
      looseUnitQuantity: number;
      minimumClosedPackageReserve?: number;
      autoOpenForUnitSale?: boolean;
      autoOpenablePackages?: number;
      autoOpenableUnitsTotal?: number;
      equivalentBaseQuantity: number;
      conversionFactor: number;
      packageUnit: string;
      baseUnit: string;
    } | null;
  } | null;
  allSharedInventoryBalances?: Array<{
    branchId: string;
    inventoryProductId: string;
    quantityOnHand: string | null;
    closedPackageQuantity?: string | null;
    looseUnitQuantity?: string | null;
    weightedAverageCost: string | null;
  }>;
};
type Movement = {
  id: string;
  createdAt: string;
  movementType: string;
  quantity: string;
  unitCost: string;
  referenceType: string;
  referenceId: string;
  notes?: string | null;
  product: { id: string; sku: string; name: string };
  branch: Branch;
};
type Transfer = {
  id: string;
  transferNumber: string;
  status: string;
  notes?: string | null;
  createdAt: string;
  fromBranch: Branch;
  toBranch: Branch;
  lines: Array<{
    id: string;
    product: { id: string; sku: string; name: string };
    quantityRequested: string | number;
    quantityShipped?: string | number | null;
    quantityReceived?: string | number | null;
    unitCostSnapshot?: string | number | null;
  }>;
};
type ReorderAlert = { id: string; reason: string; alertType: string; currentQuantity: string; suggestedQuantity: string; product: { sku: string; name: string }; branch: Branch };
type AuditRow = { id: string; occurredAt: string; module: string; action: string; entityType: string; actor?: { username: string; fullName: string } | null; branch?: Branch | null };
type ReplenishmentRecommendation = {
  productId: string;
  sku: string;
  barcode?: string | null;
  name: string;
  categoryName?: string | null;
  branchId: string;
  stockOnHand: number;
  availableStock: number;
  unitsSoldLast30Days: number;
  unitsSoldLast90Days: number;
  averageDailyDemand: number;
  abcClass: "A" | "B" | "C";
  xyzClass: "X" | "Y" | "Z";
  combinedClass: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  leadTimeDays: number;
  safetyDays: number;
  coverageDays: number;
  reorderPoint: number;
  targetStock: number;
  suggestedOrderQty: number;
  effectiveCost: number | null;
  effectivePrice: number | null;
  grossMarginPercent: number | null;
  estimatedPurchaseCost: number | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  recommendationType: "BUY" | "TRANSFER_IN" | "DO_NOT_BUY" | "ON_DEMAND" | "OVERSTOCK" | "REVIEW_PRICE";
  message: string;
  warnings: string[];
  recommendedActions: string[];
};
type ReplenishmentSummary = {
  urgentCount: number;
  highCount: number;
  buyCount: number;
  transferInCount: number;
  overstockCount: number;
  onDemandCount: number;
  reviewPriceCount: number;
  estimatedTotalPurchaseCost: number;
};
type TransferOpportunity = {
  productId: string;
  sku: string;
  barcode?: string | null;
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
  estimatedTransferCost: number | null;
  estimatedPurchaseCostAvoided: number | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  message: string;
  warnings: string[];
};
type ImportPreviewItem = {
  rowNumber: number;
  sku: string;
  barcode?: string | null;
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
type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
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
  pagination?: Pagination;
};

type BranchPricingCostRow = {
  standardSalePrice: number;
  branchPrice: number | null;
  effectivePrice: number;
  priceSource: "GLOBAL" | "BRANCH";
  baseWeightedAverageCost: number | null;
  weightedAverageCost: number | null;
  branchCost: number | null;
  effectiveCost: number | null;
  costSource: "GLOBAL" | "NONE";
  effectiveMarginPercent: number | null;
  isConvertibleStock: boolean;
  baseUnit?: string | null;
  conversionFactor?: number | null;
  warnings: string[];
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

function ironQuintalFactor(product: ProductRow) {
  const code = product.stockConversion?.stockGroupCode ?? "";
  if (code.includes("1_2")) return 8;
  if (code.includes("3_8")) return 14;
  if (code.includes("1_4")) return 30;
  return Number(product.stockConversion?.conversionFactor ?? 0) > 1 ? Number(product.stockConversion?.conversionFactor) : null;
}

function renderSharedStock(product: ProductRow) {
  const shared = product.sharedStock;
  const conversion = product.stockConversion;
  if (!shared || !conversion) return null;
  if (conversion.tracksPackages && shared.packageStock) {
    if (!conversion.isPackagePresentation) {
      return {
        primary: `${qty(shared.packageStock.looseUnitQuantity)} ${shared.packageStock.baseUnit.toLowerCase()} sueltos fisicos`,
        secondary: `abrible ${qty(shared.packageStock.autoOpenableUnitsTotal ?? 0)} ${shared.packageStock.baseUnit.toLowerCase()} | cerrados ${qty(shared.packageStock.closedPackageQuantity)} ${(conversion.packageUnit ?? "KILO").toLowerCase()} | total ${qty(shared.packageStock.equivalentBaseQuantity)} ${shared.packageStock.baseUnit.toLowerCase()}`,
        chip: `1 ${conversion.packageUnit ?? shared.packageStock.packageUnit} = ${qty(shared.packageStock.conversionFactor)} ${shared.packageStock.baseUnit} aprox.`,
      };
    }
    return {
      primary: `${qty(shared.packageStock.closedPackageQuantity)} ${(conversion.packageUnit ?? "KILO").toLowerCase()} cerrados`,
      secondary: `${qty(shared.packageStock.looseUnitQuantity)} ${shared.packageStock.baseUnit.toLowerCase()} sueltos fisicos | abrible ${qty(shared.packageStock.autoOpenableUnitsTotal ?? 0)} | total ${qty(shared.packageStock.equivalentBaseQuantity)} ${shared.packageStock.baseUnit.toLowerCase()}`,
      chip: `1 ${conversion.packageUnit ?? shared.saleUnit} = ${qty(shared.packageStock.conversionFactor)} ${shared.packageStock.baseUnit} aprox.`,
    };
  }
  const factor = ironQuintalFactor(product);
  const primary = `${qty(shared.saleQuantity)} ${shared.saleUnit.toLowerCase()}`;
  const secondary = conversion.saleUnit === shared.baseUnit && factor
    ? `${qty(shared.baseQuantity / factor)} quintales`
    : `${qty(shared.baseQuantity)} ${shared.baseUnit.toLowerCase()}`;
  return { primary, secondary, chip: factor ? `1 quintal = ${factor} varillas` : "Stock compartido" };
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoneyOrNd(value: number | null) {
  return value === null ? "N/D" : money(value);
}

function formatMarginOrNd(value: number | null) {
  return value === null ? "N/D" : `${value.toFixed(1)}%`;
}

function marginBadgeVariant(value: number | null) {
  if (value === null) return "neutral" as const;
  if (value < 0) return "danger" as const;
  if (value < 20) return "warning" as const;
  return "success" as const;
}

function buildBranchPricingCostRow(product: ProductRow, branch: Branch): BranchPricingCostRow {
  const setting = product.branchProductSettings.find((item) => item.branchId === branch.id);
  const branchPrice = numberOrNull(setting?.branchPrice);
  const branchCost = numberOrNull(setting?.branchCost);
  const standardSalePrice = Number(product.basePrice) || 0;
  const effectivePrice = branchPrice ?? standardSalePrice;
  const sharedWac = numberOrNull(product.allSharedInventoryBalances?.find((item) => item.branchId === branch.id)?.weightedAverageCost);
  const directWac = numberOrNull(product.inventoryBalances.find((item) => item.branchId === branch.id)?.weightedAverageCost);
  const baseWeightedAverageCost = sharedWac ?? directWac;
  const conversionFactor = numberOrNull(product.stockConversion?.conversionFactor) ?? 1;
  const weightedAverageCost = baseWeightedAverageCost === null
    ? null
    : baseWeightedAverageCost * (product.stockConversion ? conversionFactor : 1);
  const effectiveCost = numberOrNull(product.baseCost);
  const effectiveMarginPercent = effectivePrice > 0 && effectiveCost !== null && effectiveCost > 0
    ? ((effectivePrice - effectiveCost) / effectivePrice) * 100
    : null;
  const warnings: string[] = [];
  if (effectiveCost === null) warnings.push("No se puede calcular margen sin costo efectivo.");
  if (effectiveCost !== null && effectivePrice < effectiveCost) warnings.push("Precio bajo costo.");

  return {
    standardSalePrice,
    branchPrice,
    effectivePrice,
    priceSource: branchPrice !== null ? "BRANCH" : "GLOBAL",
    baseWeightedAverageCost,
    weightedAverageCost,
    branchCost,
    effectiveCost,
    costSource: effectiveCost !== null ? "GLOBAL" : "NONE",
    effectiveMarginPercent,
    isConvertibleStock: Boolean(product.stockConversion),
    baseUnit: product.stockConversion?.baseUnit ?? null,
    conversionFactor,
    warnings,
  };
}

/* ── Pagination Bar ── */
function PaginationBar({ pagination, onPageChange }: { pagination: Pagination; onPageChange: (p: number) => void }) {
  const { page, totalPages, total } = pagination;
  if (totalPages <= 1) return null;

  const MAX_VISIBLE = 5;
  let start = Math.max(1, page - Math.floor(MAX_VISIBLE / 2));
  const end = Math.min(totalPages, start + MAX_VISIBLE - 1);
  if (end - start + 1 < MAX_VISIBLE) start = Math.max(1, end - MAX_VISIBLE + 1);

  const pages: number[] = [];
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-3">
      <span className="text-xs text-[var(--color-text-muted)]">
        {total} producto{total !== 1 ? "s" : ""} · Página {page} de {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="inline-flex items-center justify-center rounded-md border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs font-medium transition hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span className="sr-only">Anterior</span>
        </button>
        {start > 1 && (
          <>
            <button type="button" onClick={() => onPageChange(1)} className="inline-flex items-center justify-center rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-xs font-medium transition hover:bg-gray-50">1</button>
            {start > 2 && <span className="px-1 text-xs text-[var(--color-text-muted)]">…</span>}
          </>
        )}
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            className={`inline-flex items-center justify-center rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
              p === page
                ? "border-[var(--color-master-600)] bg-[var(--color-master-600)] text-white"
                : "border-[var(--color-border)] bg-white hover:bg-gray-50"
            }`}
          >
            {p}
          </button>
        ))}
        {end < totalPages && (
          <>
            {end < totalPages - 1 && <span className="px-1 text-xs text-[var(--color-text-muted)]">…</span>}
            <button type="button" onClick={() => onPageChange(totalPages)} className="inline-flex items-center justify-center rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-xs font-medium transition hover:bg-gray-50">{totalPages}</button>
          </>
        )}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex items-center justify-center rounded-md border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs font-medium transition hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="sr-only">Siguiente</span>
        </button>
      </div>
    </div>
  );
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
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  /* Scroll active tab into view when tab changes (prevents hidden tab on mobile) */
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [tab]);

  /* ── Inline edit state for product rows ── */
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", categoryId: "", sku: "", applySuggestedSku: false });
  const [editSkuPreview, setEditSkuPreview] = useState("");
  const [savingProduct, setSavingProduct] = useState(false);
  const [focusedPricingProductId, setFocusedPricingProductId] = useState<string | null>(null);
  const [movementDialog, setMovementDialog] = useState<"adjustment" | "opening" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (branchId) params.set("branchId", branchId);
    if (categoryId) params.set("categoryId", categoryId);
    if (filter) params.set("filter", filter);
    params.set("page", String(page));
    params.set("limit", "50");
    const response = await fetch(`/api/master/catalog-inventory?${params}`, { cache: "no-store" });
    const raw = await response.json();
    if (!response.ok) throw new Error(raw.message ?? "No se pudo cargar Catalogo e Inventario.");
    setData(unwrapApiData(raw));
    setLoading(false);
  }, [branchId, categoryId, filter, q, page]);

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

  async function updateBranchPrice(product: ProductRow, branch: Branch, field: "branchPrice", value: string) {
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
    toast.success(`Precio guardado para ${branch.code}`);
    await load();
  }

  async function updateGlobalCost(product: ProductRow, value: string) {
    const numeric = value.trim() === "" ? null : Number(value);
    if (numeric !== null && (!Number.isFinite(numeric) || numeric < 0)) {
      toast.error("El costo universal no puede ser negativo.");
      return;
    }
    const response = await apiFetch(`/api/catalog/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ globalCost: numeric }),
    });
    if (!response.ok) {
      toast.error("No se pudo guardar el costo universal.");
      return;
    }
    toast.success(`Costo universal actualizado para ${product.sku}`);
    await load();
  }

  async function toggleBranchAssignment(product: ProductRow, branchId: string, isAvailable: boolean) {
    const res = await apiFetch(`/api/catalog/products/${product.id}/branch-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId, isAvailable }),
    });
    if (!res.ok) {
      toast.error("No se pudo actualizar la asignación de sucursal.");
      return;
    }
    toast.success(isAvailable ? `${product.sku} asignado a esta sucursal` : `${product.sku} desasignado de esta sucursal`);
    await load();
  }

  /* ── Inline product edit handlers ── */
  function startEditing(product: ProductRow) {
    setEditingProductId(product.id);
    setEditDraft({ name: product.name, categoryId: product.category?.id ?? "", sku: product.sku, applySuggestedSku: false });
    setEditSkuPreview("");
  }
  function cancelEditing() {
    setEditingProductId(null);
    setEditDraft({ name: "", categoryId: "", sku: "", applySuggestedSku: false });
    setEditSkuPreview("");
  }
  async function saveProductEdit(product: ProductRow) {
    if (!editDraft.name.trim()) { toast.error("El nombre es obligatorio."); return; }
    setSavingProduct(true);
    try {
      const body: Record<string, unknown> = {};
      if (editDraft.name.trim() !== product.name) body.name = editDraft.name.trim();
      if (editDraft.categoryId && editDraft.categoryId !== product.category?.id) body.categoryId = editDraft.categoryId;
      if (editDraft.applySuggestedSku && editSkuPreview) {
        const hasHistory = product.totalStock !== 0 || product.inventoryBalances.length > 0;
        if (hasHistory) {
          const confirmed = window.confirm("Este producto ya tiene historial o inventario. Cambiar el SKU no borra movimientos, pero puede afectar reportes externos. Deseas actualizar el SKU?");
          if (!confirmed) {
            setSavingProduct(false);
            return;
          }
        }
        body.skuUpdateMode = "USE_SUGGESTED";
        body.suggestedSku = editSkuPreview;
      } else if (editDraft.categoryId && editDraft.categoryId !== product.category?.id) {
        body.skuUpdateMode = "KEEP_CURRENT";
      }
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
  const [skuPreview, setSkuPreview] = useState("");
  const [skuStatus, setSkuStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const skuCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!editingProductId || !editDraft.name.trim() || !editDraft.categoryId) {
      setEditSkuPreview("");
      return;
    }
    const currentProduct = data?.products.find((product) => product.id === editingProductId);
    const categoryChanged = Boolean(currentProduct && editDraft.categoryId !== currentProduct.category?.id);
    const nameChanged = Boolean(currentProduct && editDraft.name.trim() !== currentProduct.name);
    if (!categoryChanged && !nameChanged) {
      setEditSkuPreview("");
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/catalog/products/sku-suggestion?name=${encodeURIComponent(editDraft.name.trim())}&categoryId=${encodeURIComponent(editDraft.categoryId)}&productId=${encodeURIComponent(editingProductId)}`);
        if (!response.ok) return;
        const raw = await response.json();
        const result = unwrapApiData(raw);
        setEditSkuPreview(result.suggestedSku ?? "");
      } catch {
        setEditSkuPreview("");
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [data?.products, editDraft.categoryId, editDraft.name, editingProductId]);

  // Auto-preview SKU when name + category change
  useEffect(() => {
    if (!newProduct.name.trim() || !newProduct.categoryId || newProduct.sku.trim()) {
      setSkuPreview("");
      return;
    }
    if (skuCheckTimer.current) clearTimeout(skuCheckTimer.current);
    skuCheckTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/catalog/products?previewSku=true&productName=${encodeURIComponent(newProduct.name.trim())}&categoryId=${encodeURIComponent(newProduct.categoryId)}`, { cache: "no-store" });
        if (res.ok) {
          const raw = await res.json();
          const data = unwrapApiData(raw);
          setSkuPreview(data.sku ?? "");
        }
      } catch { /* silent */ }
    }, 500);
    return () => { if (skuCheckTimer.current) clearTimeout(skuCheckTimer.current); };
  }, [newProduct.name, newProduct.categoryId, newProduct.sku]);

  // Validate manual SKU uniqueness with debounce
  useEffect(() => {
    const sku = newProduct.sku.trim();
    if (!sku) { setSkuStatus("idle"); return; }
    setSkuStatus("checking");
    if (skuCheckTimer.current) clearTimeout(skuCheckTimer.current);
    skuCheckTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/catalog/products?checkSku=${encodeURIComponent(sku)}`, { cache: "no-store" });
        if (res.ok) {
          const raw = await res.json();
          const data = unwrapApiData(raw);
          setSkuStatus(data.available ? "available" : "taken");
        }
      } catch { setSkuStatus("idle"); }
    }, 400);
    return () => { if (skuCheckTimer.current) clearTimeout(skuCheckTimer.current); };
  }, [newProduct.sku]);

  async function handleCreateProduct() {
    if (!newProduct.name.trim() || !newProduct.categoryId || !newProduct.standardSalePrice) {
      toast.error("Nombre, categoría y precio son obligatorios.");
      return;
    }
    if (skuStatus === "taken") {
      toast.error("El SKU ingresado ya existe. Cambialo o déjalo vacío para generar automáticamente.");
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
        throw new Error(body?.error?.message ?? body?.message ?? "No se pudo crear el producto.");
      }
      toast.success("Producto creado exitosamente.");
      setNewProduct({ name: "", sku: "", categoryId: "", unit: "UN", standardSalePrice: "", description: "", allowsFraction: false });
      setSkuPreview("");
      setSkuStatus("idle");
      setShowCreateForm(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al crear producto.");
    } finally {
      setCreating(false);
    }
  }

  /* ── Eliminar/desactivar producto ── */
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);

  async function handleDeleteProduct(product: ProductRow) {
    const confirmed = window.confirm(
      `¿Estás seguro de eliminar "${product.sku} · ${product.name}"?\n\nSi tiene ventas o movimientos se desactivará en su lugar.`
    );
    if (!confirmed) return;
    setDeletingProductId(product.id);
    try {
      const response = await apiFetch(`/api/catalog/products/${product.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? "No se pudo eliminar el producto.");
      }
      const result = unwrapApiData(await response.json());
      if (result.action === "DELETED") {
        toast.success(result.reason, { duration: 4000 });
      } else {
        toast(result.reason, { icon: "⚠️", duration: 5000 });
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al eliminar producto.");
    } finally {
      setDeletingProductId(null);
    }
  }

  /* ── Borrado masivo de productos ── */
  const [showMassDeleteDialog, setShowMassDeleteDialog] = useState(false);
  const [massDeleteConfirmation, setMassDeleteConfirmation] = useState("");
  const [massDeleting, setMassDeleting] = useState(false);
  const totalProductCount = data?.pagination?.total ?? data?.products.length ?? 0;
  const massDeletePhrase = `Borrar los ${totalProductCount} productos`;

  async function handleMassDelete() {
    if (massDeleteConfirmation !== massDeletePhrase) {
      toast.error("La frase de confirmación no coincide.");
      return;
    }
    setMassDeleting(true);
    try {
      const response = await apiFetch("/api/master/catalog-inventory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: massDeleteConfirmation, expectedCount: totalProductCount }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? "No se pudo ejecutar el borrado masivo.");
      }
      const result = unwrapApiData(await response.json());
      toast.success(`${result.deleted} productos eliminados exitosamente.`, { duration: 5000 });
      setShowMassDeleteDialog(false);
      setMassDeleteConfirmation("");
      setPage(1);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al borrar productos.");
    } finally {
      setMassDeleting(false);
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
      {/* ── Encabezado plano ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-medium" style={{ color: "var(--color-text)" }}>Catálogo e inventario</h1>
          <p className="text-sm" style={{ color: "var(--color-text-muted)", marginTop: "2px" }}>Productos, precios, existencias y movimientos</p>
        </div>
        {data && branchId && (() => {
          const activeBranch = data.branches.find((b) => b.id === branchId);
          return activeBranch ? (
            <div className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs" style={{ border: "0.5px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
              <Building2 className="h-3.5 w-3.5" style={{ color: "var(--color-text-muted)" }} />
              <span>{activeBranch.name}</span>
            </div>
          ) : null;
        })()}
      </div>

      {/* ── Barra de filtros ── */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1" style={{ minWidth: "180px" }}>
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: "var(--color-text-muted)" }} />
          <input
            className="hm-input h-10 w-full"
            style={{ paddingLeft: "2rem" }}
            placeholder="Buscar SKU o producto"
            value={q}
            onChange={(event) => { setQ(event.target.value); setPage(1); }}
          />
        </div>
        <select className="hm-input h-10" style={{ minWidth: "160px" }} value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1); }}>
          <option value="">Todas las sucursales</option>
          {data?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}
        </select>
        <select className="hm-input h-10" style={{ minWidth: "150px" }} value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}>
          <option value="">Todas las categorias</option>
          {data?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <button
          type="button"
          disabled={loading}
          className="h-10 inline-flex items-center gap-2 rounded-lg px-4 text-sm font-medium whitespace-nowrap transition-opacity disabled:opacity-60"
          style={{
            background: "color-mix(in srgb, var(--color-master-600) 12%, transparent)",
            color: "var(--color-master-700)",
            border: "0.5px solid var(--color-master-600)",
          }}
          onClick={() => load().catch((e: Error) => toast.error(e.message))}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Aplicar
        </button>
      </div>

      {/* ── Tabs — subrayado ── */}
      <div className="overflow-x-auto" style={{ borderBottom: "0.5px solid var(--color-border)" }}>
        <div className="flex min-w-max">
          {TABS.map((item) => {
            const Icon = item.icon;
            const isActive = tab === item.id;
            return (
              <button
                key={item.id}
                ref={isActive ? activeTabRef : null}
                type="button"
                onClick={() => setTab(item.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "0 14px 10px",
                  fontSize: "0.8125rem",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  background: "none",
                  border: "none",
                  borderBottom: isActive
                    ? "2px solid var(--color-master-600)"
                    : "2px solid transparent",
                  color: isActive ? "var(--color-master-600)" : "var(--color-text-secondary)",
                  cursor: "pointer",
                  transition: "color 140ms ease, border-color 140ms ease",
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = "var(--color-text)"; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = "var(--color-text-secondary)"; }}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {loading || !data ? <Card className="p-4 text-sm text-[var(--color-text-muted)]">Cargando centro de catalogo e inventario...</Card> : null}

      {/* ════════════ TAB: RESUMEN ════════════ */}
      {data && tab === "summary" ? (
        <div className="space-y-5">
          <InventorySummary
            kpis={data.kpis}
            onNavigate={(t, f) => { setTab(t); if (f !== undefined) setFilter(f); setPage(1); }}
          />
          <Card noPadding>
            <div className="flex items-center gap-2 px-4 py-3" style={{ background: "var(--color-surface-alt)", borderBottom: "0.5px solid var(--color-border)" }}>
              <History className="h-4 w-4" style={{ color: "var(--color-master-600)" }} />
              <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Últimos movimientos</h2>
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
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <Input
                  label="Nombre del producto *"
                  value={newProduct.name}
                  onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                  placeholder="Ej: Cemento Canal 42.5 kg"
                />
                <div>
                  <Input
                    label="SKU (opcional, se genera automáticamente)"
                    value={newProduct.sku}
                    onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })}
                    placeholder="Dejar vacío para auto-generar"
                  />
                  {/* SKU validation feedback */}
                  {newProduct.sku.trim() && skuStatus === "checking" && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-[var(--color-text-muted)]"><Loader2 className="h-3 w-3 animate-spin" /> Verificando SKU…</p>
                  )}
                  {newProduct.sku.trim() && skuStatus === "available" && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600 font-medium"><Check className="h-3 w-3" /> SKU disponible</p>
                  )}
                  {newProduct.sku.trim() && skuStatus === "taken" && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-red-600 font-medium"><AlertTriangle className="h-3 w-3" /> SKU duplicado — ya existe</p>
                  )}
                  {/* Auto SKU preview */}
                  {!newProduct.sku.trim() && skuPreview && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-blue-600 font-medium"><Sparkles className="h-3 w-3" /> Auto-SKU: <code className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-xs text-blue-700">{skuPreview}</code></p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--color-text-secondary)] mb-1">Categoría *</label>
                  <select
                    className="hm-input w-full"
                    value={newProduct.categoryId}
                    onChange={(e) => setNewProduct({ ...newProduct, categoryId: e.target.value })}
                  >
                    <option value="">Seleccionar categoría</option>
                    {(data.categories ?? []).filter(c => c.isActive).map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--color-text-secondary)] mb-1">Unidad</label>
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
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-[var(--color-master-600)] focus:ring-[var(--color-master-500)]"
                    checked={newProduct.allowsFraction}
                    onChange={(e) => setNewProduct({ ...newProduct, allowsFraction: e.target.checked })}
                  />
                  Permite fracciones (venta por peso/medida)
                </label>
              </div>
              <div className="flex gap-3 border-t border-[var(--color-border)] pt-4">
                <Button variant="success" onClick={handleCreateProduct} disabled={creating || skuStatus === "taken"} icon={<Save className="h-4 w-4" />}>
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
          <div className="hm-card-header-blue flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2"><Package className="h-4 w-4" /> Productos ({data.pagination?.total ?? data.products.length})</h2>
            {totalProductCount > 0 && (
              <Button variant="danger" size="sm" onClick={() => { setMassDeleteConfirmation(""); setShowMassDeleteDialog(true); }} icon={<Trash2 className="h-3.5 w-3.5" />}>
                Borrar todos
              </Button>
            )}
          </div>

          {/* ── Diálogo de confirmación de borrado masivo ── */}
          {showMassDeleteDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden animate-scale-in">
                <div className="hm-card-header-red px-5 py-3.5">
                  <h3 className="text-white font-bold flex items-center gap-2 relative z-10"><AlertTriangle className="h-5 w-5" /> Borrado masivo de productos</h3>
                </div>
                <div className="p-5 space-y-4">
                  <p className="text-sm text-gray-700">
                    Esta acción eliminará <strong className="text-red-600">{totalProductCount} productos</strong> y todos sus datos asociados (inventario, movimientos, ventas, configuraciones).
                  </p>
                  <p className="text-sm text-gray-700 font-semibold">
                    Esta acción es irreversible.
                  </p>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5">
                      Para confirmar, escriba exactamente:
                    </label>
                    <p className="mb-2 rounded bg-red-50 border border-red-200 px-3 py-2 text-sm font-mono text-red-700 select-all">
                      {massDeletePhrase}
                    </p>
                    <Input
                      value={massDeleteConfirmation}
                      onChange={(e) => setMassDeleteConfirmation(e.target.value)}
                      placeholder="Escriba la frase de confirmación..."
                      className="w-full"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      variant="secondary"
                      onClick={() => { setShowMassDeleteDialog(false); setMassDeleteConfirmation(""); }}
                      disabled={massDeleting}
                    >
                      Cancelar
                    </Button>
                    <Button
                      variant="danger"
                      onClick={handleMassDelete}
                      disabled={massDeleteConfirmation !== massDeletePhrase || massDeleting}
                      loading={massDeleting}
                      icon={<Trash2 className="h-4 w-4" />}
                    >
                      {massDeleting ? "Borrando..." : "Borrar todos los productos"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="hm-table min-w-[1100px] w-full">
              <thead>
                <tr>
                  <th>SKU</th><th>Producto</th><th>Categoria</th><th>Unidad principal</th><th>Stock resumen</th><th>Estado</th><th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((product) => {
                  const isEditing = editingProductId === product.id;
                  const sharedStock = renderSharedStock(product);
                  return (
                  <tr key={product.id}>
                    <td className="font-semibold">{product.sku}</td>
                    <td>
                      {isEditing ? (
                        <div className="space-y-2">
                          <Input className="h-8 min-w-[220px]" value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value, applySuggestedSku: false })} />
                          {editSkuPreview ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[0.68rem] text-amber-800">
                              <div>La categoria cambio. El SKU actual puede no corresponder a la nueva categoria.</div>
                              <div className="mt-1">
                                Categoria: <strong>{product.category?.name ?? "Sin categoria"}</strong> a{" "}
                                <strong>{data.categories.find((category) => category.id === editDraft.categoryId)?.name ?? "Sin categoria"}</strong>
                              </div>
                              <div>SKU actual: <strong className="font-mono">{product.sku}</strong></div>
                              <label className="mt-1 flex items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={editDraft.applySuggestedSku}
                                  onChange={(event) => setEditDraft({ ...editDraft, applySuggestedSku: event.target.checked })}
                                />
                                Actualizar SKU a <strong className="font-mono">{editSkuPreview}</strong>
                              </label>
                            </div>
                          ) : null}
                        </div>
                      ) : product.name}
                    </td>
                    <td>
                      {isEditing ? (
                        <select
                          className="hm-input h-8 min-w-[180px] text-xs"
                          value={editDraft.categoryId}
                          onChange={(event) => setEditDraft({ ...editDraft, categoryId: event.target.value, applySuggestedSku: false })}
                        >
                          <option value="">Sin categoria</option>
                          {data.categories.filter((category) => category.isActive).map((category) => (
                            <option key={category.id} value={category.id}>{category.name}</option>
                          ))}
                        </select>
                      ) : product.category?.name ?? "Sin categoria"}
                    </td>
                    <td>{product.stockConversion?.saleUnit ?? product.unit}</td>
                    <td>
                      <div>{sharedStock?.primary ?? qty(product.totalStock)}</div>
                      {sharedStock ? (
                        <div className="mt-1 space-y-1 text-[0.65rem] text-[var(--color-text-muted)]">
                          <div>Equivale a {sharedStock.secondary}</div>
                          <div className="inline-flex rounded border border-[var(--color-border)] px-1.5 py-0.5 font-medium">Stock compartido - {sharedStock.chip}</div>
                        </div>
                      ) : null}
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
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setFocusedPricingProductId(product.id);
                                setTab("pricing");
                              }}
                              icon={<DollarSign className="h-3.5 w-3.5" />}
                            >
                              Precio
                            </Button>
                            <Button variant={product.isActive ? "danger" : "success"} size="sm" onClick={() => toggleProduct(product).catch((error) => toast.error(error.message))}>
                              {product.isActive ? "Desactivar" : "Activar"}
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleDeleteProduct(product)}
                              disabled={deletingProductId === product.id}
                              icon={deletingProductId === product.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            >
                              Eliminar
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {data.products.length === 0 ? <tr><td colSpan={7} className="text-center py-6 text-[var(--color-text-muted)]">No hay productos que coincidan con los filtros.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {data.pagination && <PaginationBar pagination={data.pagination} onPageChange={setPage} />}
        </Card>
        </>
      ) : null}

      {data && tab === "categories" ? <CategoriesPanel categories={data.categories} onDone={load} /> : null}

      {data && tab === "import" ? <UnifiedImportPanel branches={data.branches} categories={data.categories} onDone={load} /> : null}

      {/* ════════════ TAB: EXISTENCIAS ════════════ */}
      {data && tab === "stock" ? (
        <Card noPadding>
          <div className="flex items-center gap-2 px-4 py-3" style={{ background: "var(--color-surface-alt)", borderBottom: "0.5px solid var(--color-border)" }}>
            <Boxes className="h-4 w-4" style={{ color: "var(--color-master-600)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Matriz de existencias</h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <select className="hm-input" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}>
                {FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <Button variant="primary" onClick={() => { setMovementDialog("adjustment"); setTab("movements"); }} icon={<Plus className="h-4 w-4" />}>Ajuste manual</Button>
              <Button variant="success" onClick={() => { setMovementDialog("opening"); setTab("movements"); }} icon={<Package className="h-4 w-4" />}>Carga inicial</Button>
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

      {data && tab === "movements" ? <MovementsPanel branches={data.branches} products={data.products} movements={data.movements} selectedBranchId={branchId} initialDialog={movementDialog} onInitialDialogHandled={() => setMovementDialog(null)} onSelectBranch={setBranchId} onDone={load} /> : null}
      {data && tab === "pricing" ? (
        <>
          <PricingPanel
            branches={data.branches}
            products={data.products}
            selectedBranchId={branchId}
            focusedProductId={focusedPricingProductId}
            onSelectBranch={(nextBranchId) => { setBranchId(nextBranchId); setPage(1); }}
            onSave={updateBranchPrice}
            onSaveGlobalCost={updateGlobalCost}
            onToggleBranchAssignment={toggleBranchAssignment}
          />
          {data.pagination && <PaginationBar pagination={data.pagination} onPageChange={setPage} />}
        </>
      ) : null}
      {data && tab === "transfers" ? <TransfersPanel branches={data.branches} /> : null}
      {data && tab === "reorder" ? <ReplenishmentPanel alerts={data.reorderAlerts} branches={data.branches} selectedBranchId={branchId} /> : null}
      {data && tab === "audit" ? <AuditPanel logs={data.auditLogs} /> : null}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   KPI card
   ═══════════════════════════════════════════════════════════ */
function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="min-h-[104px] p-4 hover:shadow-lg transition-shadow">
      <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-2.5 break-words text-2xl font-bold leading-tight text-[var(--color-text)]">{value}</p>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
   Inventory Summary — command center for the Resumen tab
   ═══════════════════════════════════════════════════════════ */
type InventorySummaryProps = {
  kpis: CenterData["kpis"];
  onNavigate: (tab: Tab, filter?: string) => void;
};

function InventorySummary({ kpis, onNavigate }: InventorySummaryProps) {
  const total = kpis.activeProducts || 1;
  const goodStock = Math.max(0, total - kpis.zeroStockProducts - kpis.criticalStockProducts);
  const criticalPct = Math.round((kpis.criticalStockProducts / total) * 100);
  const zeroPct = Math.round((kpis.zeroStockProducts / total) * 100);
  const goodPct = Math.max(0, 100 - criticalPct - zeroPct);

  const qualityIssues = kpis.productsWithoutCost + kpis.productsWithoutPrice;
  const qualityPct = qualityIssues > 0 ? Math.round((qualityIssues / (total * 2)) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* ── Fila superior: 4 métricas clave ── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* Total activos */}
        <button
          type="button"
          className="group text-left rounded-xl p-4 transition-all duration-[140ms]"
          style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}
          onClick={() => onNavigate("products")}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-master-600)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
        >
          <p className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Productos activos</p>
          <p className="mt-2 text-3xl font-bold" style={{ color: "var(--color-text)" }}>{kpis.activeProducts.toLocaleString()}</p>
          <p className="mt-1 text-xs" style={{ color: "var(--color-master-600)" }}>Ver catálogo →</p>
        </button>

        {/* Stock crítico */}
        <button
          type="button"
          className="group text-left rounded-xl p-4 transition-all duration-[140ms]"
          style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}
          onClick={() => onNavigate("products", "LOW_STOCK")}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-warning-500)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
        >
          <p className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Stock crítico</p>
          <p className="mt-2 text-3xl font-bold" style={{ color: kpis.criticalStockProducts > 0 ? "var(--color-warning-600)" : "var(--color-text)" }}>
            {kpis.criticalStockProducts.toLocaleString()}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--color-warning-500)" }}>
            {kpis.criticalStockProducts > 0 ? "Requieren reposición →" : "Sin alertas"}
          </p>
        </button>

        {/* Stock cero */}
        <button
          type="button"
          className="group text-left rounded-xl p-4 transition-all duration-[140ms]"
          style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}
          onClick={() => onNavigate("products", "ZERO_STOCK")}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-danger-500)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
        >
          <p className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Sin stock</p>
          <p className="mt-2 text-3xl font-bold" style={{ color: kpis.zeroStockProducts > 0 ? "var(--color-danger-600)" : "var(--color-text)" }}>
            {kpis.zeroStockProducts.toLocaleString()}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--color-danger-500)" }}>
            {kpis.zeroStockProducts > 0 ? "Revisar existencias →" : "Todo abastecido"}
          </p>
        </button>

        {/* Valor inventario */}
        <div
          className="rounded-xl p-4"
          style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}
        >
          <p className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Valor inventario</p>
          <p className="mt-2 text-2xl font-bold leading-tight" style={{ color: "var(--color-text)" }}>{money(kpis.totalInventoryValue)}</p>
          <p className="mt-1 flex items-center gap-1 text-xs" style={{ color: "var(--color-success-600)" }}>
            <DollarSign className="h-3 w-3" />
            Costo promedio ponderado
          </p>
        </div>
      </div>

      {/* ── Barra de distribución de stock ── */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Distribución de stock</p>
          <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>{total.toLocaleString()} SKUs totales</p>
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded-full gap-0.5">
          {goodPct > 0 && (
            <div
              className="h-full rounded-l-full transition-all duration-[260ms] ease-out"
              style={{ width: `${goodPct}%`, background: "var(--color-success-500)" }}
              title={`En buen estado: ${goodStock} SKUs (${goodPct}%)`}
            />
          )}
          {criticalPct > 0 && (
            <div
              className="h-full transition-all duration-[260ms] ease-out"
              style={{ width: `${criticalPct}%`, background: "var(--color-warning-500)" }}
              title={`Stock crítico: ${kpis.criticalStockProducts} SKUs (${criticalPct}%)`}
            />
          )}
          {zeroPct > 0 && (
            <div
              className="h-full rounded-r-full transition-all duration-[260ms] ease-out"
              style={{ width: `${zeroPct}%`, background: "var(--color-danger-500)" }}
              title={`Sin stock: ${kpis.zeroStockProducts} SKUs (${zeroPct}%)`}
            />
          )}
          {goodPct === 0 && criticalPct === 0 && zeroPct === 0 && (
            <div className="h-full w-full rounded-full" style={{ background: "var(--color-border)" }} />
          )}
        </div>
        <div className="flex gap-4 text-xs flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--color-success-500)" }} />
            <span style={{ color: "var(--color-text-secondary)" }}>Buen stock ({goodPct}%)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--color-warning-500)" }} />
            <span style={{ color: "var(--color-text-secondary)" }}>Crítico ({criticalPct}%)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--color-danger-500)" }} />
            <span style={{ color: "var(--color-text-secondary)" }}>Sin stock ({zeroPct}%)</span>
          </span>
        </div>
      </div>

      {/* ── Calidad de datos ── */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Calidad de datos</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {/* SKUs sin inventario */}
          <button
            type="button"
            className="flex items-start gap-3 rounded-lg p-3 text-left transition-colors duration-[140ms]"
            style={{ background: "var(--color-surface-alt)", border: "0.5px solid var(--color-border)" }}
            onClick={() => onNavigate("products", "NO_STOCK")}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-master-400)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: kpis.skusWithoutInventory > 0 ? "var(--color-warning-500)" : "var(--color-text-muted)" }} />
            <div>
              <p className="text-lg font-bold leading-none" style={{ color: "var(--color-text)" }}>{kpis.skusWithoutInventory}</p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-secondary)" }}>SKUs sin registro</p>
            </div>
          </button>

          {/* Sin costo */}
          <button
            type="button"
            className="flex items-start gap-3 rounded-lg p-3 text-left transition-colors duration-[140ms]"
            style={{ background: "var(--color-surface-alt)", border: "0.5px solid var(--color-border)" }}
            onClick={() => onNavigate("products", "NO_COST")}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-master-400)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: kpis.productsWithoutCost > 0 ? "var(--color-danger-500)" : "var(--color-text-muted)" }} />
            <div>
              <p className="text-lg font-bold leading-none" style={{ color: "var(--color-text)" }}>{kpis.productsWithoutCost}</p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-secondary)" }}>Sin costo asignado</p>
            </div>
          </button>

          {/* Sin precio */}
          <button
            type="button"
            className="flex items-start gap-3 rounded-lg p-3 text-left transition-colors duration-[140ms]"
            style={{ background: "var(--color-surface-alt)", border: "0.5px solid var(--color-border)" }}
            onClick={() => onNavigate("pricing")}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-master-400)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
          >
            {kpis.productsWithoutPrice === 0 ? (
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--color-success-500)" }} />
            ) : (
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--color-warning-500)" }} />
            )}
            <div>
              <p className="text-lg font-bold leading-none" style={{ color: "var(--color-text)" }}>{kpis.productsWithoutPrice}</p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-secondary)" }}>Sin precio de venta</p>
            </div>
          </button>
        </div>
        {qualityIssues === 0 && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: "color-mix(in srgb, var(--color-success-500) 10%, transparent)", color: "var(--color-success-600)" }}>
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            Todos los productos tienen costo y precio configurados
          </div>
        )}
        {qualityIssues > 0 && qualityPct > 0 && (
          <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {qualityPct}% del catálogo tiene datos incompletos — afecta márgenes y reportes
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Compact movements list
   ═══════════════════════════════════════════════════════════ */
function CompactMovements({ movements }: { movements: Movement[] }) {
  if (!movements.length) return <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] px-4 py-6 text-center"><p className="text-sm text-[var(--color-text-muted)]">Sin movimientos recientes.</p></div>;
  return <div className="space-y-1.5">{movements.map((item) => <div key={item.id} className="grid gap-2 rounded-lg border border-[var(--color-border)] p-2.5 text-xs md:grid-cols-6 hover:bg-[var(--color-surface-alt)] transition-colors"><span className="text-[var(--color-text-soft)]">{new Date(item.createdAt).toLocaleString("es-NI")}</span><span className="font-mono font-medium text-[var(--color-info-700)]">{item.product.sku}</span><span className="md:col-span-2 font-medium">{item.product.name}</span><span className="text-[var(--color-text-muted)]">{item.branch.code}</span><span className="font-medium">{item.movementType} · {qty(item.quantity)}</span></div>)}</div>;
}

/* ═══════════════════════════════════════════════════════════
   UNIFIED IMPORT PANEL — SIMPLIFIED
   Solo requiere Nombre + Categoría. SKU se genera automáticamente.
   ═══════════════════════════════════════════════════════════ */

const IMPORT_TEMPLATES: Record<string, { headers: string[]; example: string[] }> = {
  CATALOG_ONLY: {
    headers: ["nombre", "categoria"],
    example: ["Cemento Canal 42.5kg", "CEMENTO"],
  },
  CATALOG_WITH_INITIAL_INVENTORY: {
    headers: ["nombre", "categoria", "cantidad", "costo"],
    example: ["Cemento Canal 42.5kg", "CEMENTO", "50", "185"],
  },
  INVENTORY_ONLY: {
    headers: ["sku", "cantidad", "costo"],
    example: ["CEM-CEM-425KG-0001", "50", "185"],
  },
  PRICES_COSTS_ONLY: {
    headers: ["sku", "costo", "precio"],
    example: ["CEM-CEM-425KG-0001", "185", "220"],
  },
  PHYSICAL_COUNT: {
    headers: ["sku", "cantidad"],
    example: ["CEM-CEM-425KG-0001", "48"],
  },
};

function downloadTemplate(importType: string) {
  const tmpl = IMPORT_TEMPLATES[importType] ?? IMPORT_TEMPLATES.CATALOG_ONLY;
  const csv = [tmpl.headers.join(","), tmpl.example.join(",")].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `plantilla-importacion-${importType.toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const IMPORT_TYPE_LABELS: Record<string, { label: string; desc: string; color: string }> = {
  CATALOG_ONLY: { label: "Solo Catálogo", desc: "Crear o actualizar productos. Solo necesitas nombre y categoría.", color: "text-blue-600" },
  CATALOG_WITH_INITIAL_INVENTORY: { label: "Catálogo + Inventario", desc: "Crear productos con stock inicial. Necesitas nombre, categoría, cantidad y costo.", color: "text-emerald-600" },
  INVENTORY_ONLY: { label: "Solo Inventario", desc: "Agregar stock a productos existentes (requiere SKU).", color: "text-amber-600" },
  PRICES_COSTS_ONLY: { label: "Solo Precios/Costos", desc: "Actualizar precios y costos (requiere SKU).", color: "text-purple-600" },
  PHYSICAL_COUNT: { label: "Conteo Físico", desc: "Ajustar stock por conteo real (requiere SKU).", color: "text-red-600" },
};

type AnalysisResult = {
  totalRows: number;
  missingCategories: string[];
  newProductCount: number;
  autoSkuCount: number;
  defaultCategoryName: string | null;
};

function UnifiedImportPanel({ branches, categories, onDone }: { branches: Branch[]; categories: Category[]; onDone: () => Promise<void> }) {
  const [step, setStep] = useState<"config" | "preview" | "done">("config");
  const [importType, setImportType] = useState("CATALOG_WITH_INITIAL_INVENTORY");
  const [destinationMode, setDestinationMode] = useState("SINGLE");
  const [defaultBranchId, setDefaultBranchId] = useState(branches[0]?.id ?? "");
  const [filePayload, setFilePayload] = useState<{ fileContent?: string; fileBase64?: string }>({});
  const [fileName, setFileName] = useState("");
  const [batchId, setBatchId] = useState("");
  const [items, setItems] = useState<ImportPreviewItem[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [previewCsv, setPreviewCsv] = useState("");
  const [errorCsv, setErrorCsv] = useState("");
  const [defaultCategoryId, setDefaultCategoryId] = useState(categories[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [showAnalysisDialog, setShowAnalysisDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isCatalogType = importType === "CATALOG_ONLY" || importType === "CATALOG_WITH_INITIAL_INVENTORY";
  const needsBranchSelection = importType !== "CATALOG_ONLY" && importType !== "PRICES_COSTS_ONLY";
  const typeInfo = IMPORT_TYPE_LABELS[importType] ?? IMPORT_TYPE_LABELS.CATALOG_ONLY;

  function resetState() {
    setBatchId("");
    setItems([]);
    setSummary(null);
    setPreviewCsv("");
    setErrorCsv("");
    setAnalysis(null);
    setShowAnalysisDialog(false);
    setStep("config");
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    if (file.name.toLowerCase().endsWith(".xlsx")) {
      const buffer = await file.arrayBuffer();
      let binary = "";
      new Uint8Array(buffer).forEach((byte) => { binary += String.fromCharCode(byte); });
      setFilePayload({ fileBase64: btoa(binary) });
    } else {
      setFilePayload({ fileContent: await file.text() });
    }
    resetState();
    setStep("config");
  }

  async function analyzeFile() {
    setLoading(true);
    try {
      const response = await apiFetch("/api/master/catalog-inventory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "analyze",
          importType,
          destinationMode,
          defaultCategoryId: defaultCategoryId || undefined,
          ...filePayload,
        }),
      });
      const raw = await response.json();
      if (!response.ok) throw new Error(raw.message ?? "No se pudo analizar el archivo.");
      const result = unwrapApiData(raw) as AnalysisResult;
      // If there are missing categories or new products → show dialog
      if (result.missingCategories.length > 0 || result.autoSkuCount > 0) {
        setAnalysis(result);
        setShowAnalysisDialog(true);
      } else {
        // Nothing special → go straight to preview
        await runPreview();
      }
    } finally {
      setLoading(false);
    }
  }

  async function createCategoriesAndPreview() {
    setShowAnalysisDialog(false);
    setLoading(true);
    try {
      // Create missing categories if any
      if (analysis && analysis.missingCategories.length > 0) {
        const response = await apiFetch("/api/master/catalog-inventory/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "create-categories", categoryCodes: analysis.missingCategories }),
        });
        const raw = await response.json();
        if (!response.ok) throw new Error(raw.message ?? "No se pudo crear las categorías.");
        const result = unwrapApiData(raw);
        toast.success(`${result.created?.length ?? 0} categoría(s) creada(s) automáticamente`);
      }
      // Then run preview
      await runPreview();
    } finally {
      setLoading(false);
    }
  }

  async function runPreview() {
    setLoading(true);
    try {
      const response = await apiFetch("/api/master/catalog-inventory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "preview",
          importType,
          destinationMode,
          defaultBranchId,
          createMissingProducts: true,
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
      setAnalysis(null);
      setStep("preview");
      toast.success(`Preview generado — ${result.summary?.readyRows ?? result.summary?.ready ?? 0} filas listas`);
    } finally {
      setLoading(false);
    }
  }

  async function execute() {
    if (!batchId || !summary || Number(summary.readyRows ?? summary.ready ?? 0) <= 0 || summary.status !== "PREVIEWED") {
      toast.error("Genera un preview vigente con líneas READY antes de ejecutar.");
      return;
    }
    const confirmed = window.confirm("¿Confirmas la importación? Esta acción modificará catálogo, precios o inventario de forma permanente.");
    if (!confirmed) return;
    setLoading(true);
    try {
      const response = await apiFetch("/api/master/catalog-inventory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "execute", batchId }),
      });
      const raw = await response.json();
      if (!response.ok) throw new Error(raw.message ?? "No se pudo ejecutar importación.");
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
      setStep("done");
      toast.success(`✅ Importación completa — ${result.executedLines} ejecutadas, ${result.createdProducts ?? 0} productos creados`);
      await onDone();
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv(content: string, filename: string) {
    if (!content) return;
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const readyRows = Number(summary?.readyRows ?? summary?.ready ?? 0);
  const errorRows = Number(summary?.errorRows ?? summary?.errors ?? 0);
  const canExecute = Boolean(batchId && summary?.status === "PREVIEWED" && readyRows > 0);
  const hasFile = Boolean(filePayload.fileBase64 || filePayload.fileContent);

  return (
    <div className="space-y-4">
      {/* ── Step 1: Info Banner ── */}
      <Card noPadding>
        <div className="hm-card-header-blue px-5 py-4">
          <h2 className="text-base font-bold flex items-center gap-2"><Zap className="h-5 w-5" /> Importación Simplificada</h2>
          <p className="text-white/85 text-xs mt-1 relative z-10">Solo necesitas <strong>Nombre</strong> y <strong>Categoría</strong>. El SKU se genera automáticamente.</p>
        </div>
        <div className="p-4 space-y-4">

          {/* ── Quick guide ── */}
          <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-blue-900 space-y-1">
              <p className="font-semibold">¿Cómo funciona?</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Descarga la <strong>plantilla</strong> según el tipo de importación</li>
                <li>Llena los datos en Excel o CSV (mínimo: <strong>nombre</strong> y <strong>categoría</strong>)</li>
                <li>Sube el archivo → <strong>Preview</strong> para verificar → <strong>Ejecutar</strong></li>
              </ol>
              <p className="text-blue-700 mt-1">💡 <strong>SKU automático:</strong> Si no incluyes columna SKU, el sistema genera códigos inteligentes basados en el nombre del producto (ej: <code className="bg-blue-100 px-1 rounded">CEM-CEM-425KG-0001</code>).</p>
            </div>
          </div>

          {/* ── Import type selector ── */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Tipo de importación</label>
            <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-5">
              {Object.entries(IMPORT_TYPE_LABELS).map(([key, info]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setImportType(key); resetState(); }}
                  className={`text-left rounded-lg border-2 p-3 transition-all text-xs ${
                    importType === key
                      ? "border-blue-500 bg-blue-50 shadow-sm"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  <span className={`font-semibold block ${importType === key ? "text-blue-700" : "text-gray-800"}`}>{info.label}</span>
                  <span className="text-gray-500 block mt-0.5 leading-tight">{info.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Template + File Upload side by side ── */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Template download */}
            <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50 p-4 text-center">
              <FileSpreadsheet className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
              <p className="text-xs font-semibold text-emerald-800">Plantilla {typeInfo.label}</p>
              <p className="text-xs text-emerald-600 mt-1">
                Columnas: <strong>{(IMPORT_TEMPLATES[importType] ?? IMPORT_TEMPLATES.CATALOG_ONLY).headers.join(", ")}</strong>
              </p>
              <button
                type="button"
                onClick={() => downloadTemplate(importType)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
              >
                <Download className="h-3.5 w-3.5" /> Descargar Plantilla CSV
              </button>
            </div>

            {/* File upload */}
            <div
              className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors cursor-pointer ${
                hasFile ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-blue-50/50"
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv,.tsv,.txt"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
              <FileUp className={`h-8 w-8 mx-auto mb-2 ${hasFile ? "text-blue-600" : "text-gray-400"}`} />
              {hasFile ? (
                <>
                  <p className="text-xs font-semibold text-blue-800">{fileName}</p>
                  <p className="text-xs text-blue-600 mt-1">Archivo cargado ✓ — Clic para cambiar</p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-gray-600">Subir archivo Excel o CSV</p>
                  <p className="text-xs text-gray-500 mt-1">Clic aquí o arrastra tu archivo (.xlsx, .csv)</p>
                </>
              )}
            </div>
          </div>

          {/* ── Branch + Category config ── */}
          <div className="grid gap-3 md:grid-cols-3">
            {needsBranchSelection ? (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Sucursal destino</label>
                <select className="hm-input w-full" value={destinationMode} onChange={(e) => { setDestinationMode(e.target.value); resetState(); }}>
                  <option value="SINGLE">Una sucursal</option><option value="ALL">Todas las sucursales</option><option value="FILE">Desde el archivo (columna sucursal)</option>
                </select>
              </div>
            ) : null}
            {needsBranchSelection && destinationMode === "SINGLE" ? (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Sucursal</label>
                <select className="hm-input w-full" value={defaultBranchId} onChange={(e) => { setDefaultBranchId(e.target.value); resetState(); }}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                </select>
              </div>
            ) : null}
            {isCatalogType ? (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Categoría por defecto</label>
                <select className="hm-input w-full" value={defaultCategoryId} onChange={(e) => setDefaultCategoryId(e.target.value)}>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <p className="text-[10px] text-gray-500 mt-0.5">Se usa si el archivo no trae columna categoría</p>
              </div>
            ) : null}
          </div>

          {/* ── Advanced toggle ── */}
          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
            <Settings2 className="h-3.5 w-3.5" /> Opciones avanzadas {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showAdvanced ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs space-y-2">
              <p className="text-gray-600">El sistema auto-genera SKU, crea productos nuevos y usa unidad &quot;UN&quot; por defecto. Columnas opcionales en tu archivo:</p>
              <div className="grid gap-1 md:grid-cols-2">
                <span className="text-gray-500">• <strong>sku</strong> — código manual (si prefieres no auto-generar)</span>
                <span className="text-gray-500">• <strong>unidad</strong> — unidad de medida (UN, KG, M, etc.)</span>
                <span className="text-gray-500">• <strong>precio</strong> — precio de venta sugerido</span>
                <span className="text-gray-500">• <strong>sucursal</strong> — código de sucursal (modo &quot;Desde archivo&quot;)</span>
              </div>
            </div>
          ) : null}

          {/* ── Action buttons ── */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-200">
            <Button
              variant="secondary"
              onClick={() => analyzeFile().catch((e) => toast.error(e.message))}
              disabled={!hasFile || loading}
              icon={loading && step === "config" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            >
              {loading && step === "config" ? "Analizando..." : "Preview"}
            </Button>
            {step === "preview" ? (
              <Button
                variant="success"
                onClick={() => execute().catch((e) => toast.error(e.message))}
                disabled={!canExecute || loading}
                icon={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              >
                {loading ? "Ejecutando..." : `Ejecutar (${readyRows} filas)`}
              </Button>
            ) : null}
            {step !== "config" ? (
              <Button variant="ghost" onClick={() => { resetState(); setFilePayload({}); setFileName(""); if (fileInputRef.current) fileInputRef.current.value = ""; }} icon={<RefreshCcw className="h-4 w-4" />}>Nueva importación</Button>
            ) : null}
          </div>
        </div>
      </Card>

      {/* ── Analysis Dialog (pre-import confirmation) ── */}
      {showAnalysisDialog && analysis ? (
        <Card noPadding>
          <div className="hm-card-header-amber px-5 py-4">
            <h2 className="text-base font-bold flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> Análisis pre-importación</h2>
            <p className="text-white/85 text-xs mt-1 relative z-10">Se detectaron situaciones que requieren tu confirmación antes de continuar.</p>
          </div>
          <div className="p-5 space-y-4">
            {/* Missing categories */}
            {analysis.missingCategories.length > 0 ? (
              <div className="rounded-lg border-2 border-orange-300 bg-orange-50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-orange-800">
                  <Tags className="h-5 w-5" />
                  <h3 className="text-sm font-bold">Hay categorías que no están creadas para el SKU. ¿Crearlas?</h3>
                </div>
                <p className="text-xs text-orange-700">
                  Se detectaron <strong>{analysis.missingCategories.length}</strong> categoría(s) que no existen en el sistema. Si confirmas, se crearán automáticamente:
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {analysis.missingCategories.map((code) => (
                    <span key={code} className="inline-flex items-center rounded-full bg-orange-200 px-2.5 py-1 text-xs font-semibold text-orange-900">
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* New products with auto-SKU */}
            {analysis.autoSkuCount > 0 ? (
              <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-blue-800">
                  <Wand2 className="h-5 w-5" />
                  <h3 className="text-sm font-bold">Hay productos que serán creados y tendrán su SKU basado en su categoría</h3>
                </div>
                <p className="text-xs text-blue-700">
                  Se detectaron <strong>{analysis.autoSkuCount} producto{analysis.autoSkuCount !== 1 ? "s" : ""}</strong> sin SKU que se crearán con un código generado automáticamente basado en su categoría y nombre.
                </p>
                <p className="text-xs text-blue-600 flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5" />
                  Ejemplo: <code className="bg-blue-100 px-1.5 py-0.5 rounded font-mono text-[11px]">ALM-CEM-425KG-0001</code>
                </p>
              </div>
            ) : null}

            {/* New products total (with manual SKU) */}
            {analysis.newProductCount > analysis.autoSkuCount ? (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 text-emerald-800">
                  <Package className="h-5 w-5" />
                  <h3 className="text-sm font-bold">{analysis.newProductCount - analysis.autoSkuCount} producto{analysis.newProductCount - analysis.autoSkuCount !== 1 ? "s" : ""} nuevos con SKU manual</h3>
                </div>
                <p className="text-xs text-emerald-700 mt-1">
                  Estos productos tienen SKU en el archivo y se crearán con ese código.
                </p>
              </div>
            ) : null}

            {/* Summary */}
            <div className="flex items-center gap-3 rounded-lg bg-gray-50 border border-gray-200 p-3">
              <Info className="h-4 w-4 text-gray-500 flex-shrink-0" />
              <p className="text-xs text-gray-600">
                Total de filas: <strong>{analysis.totalRows}</strong> · Productos nuevos: <strong>{analysis.newProductCount}</strong> · Categorías por crear: <strong>{analysis.missingCategories.length}</strong>
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-3 border-t border-gray-200">
              <Button
                variant="success"
                onClick={() => createCategoriesAndPreview().catch((e) => toast.error(e.message))}
                disabled={loading}
                icon={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              >
                {loading ? "Procesando..." : analysis.missingCategories.length > 0 ? "Crear categorías y continuar" : "Continuar con preview"}
              </Button>
              <Button variant="ghost" onClick={() => { setShowAnalysisDialog(false); setAnalysis(null); }} icon={<X className="h-4 w-4" />}>
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {/* ── Preview Results ── */}
      {summary ? (
        <Card noPadding>
          <div className={`px-5 py-3 ${step === "done" ? "hm-card-header-green" : "hm-card-header-amber"}`}>
            <h3 className="text-sm font-bold flex items-center gap-2">
              {step === "done" ? <><Check className="h-4 w-4" /> Importación Completada</> : <><Search className="h-4 w-4" /> Resultado del Preview</>}
            </h3>
          </div>
          <div className="p-4 space-y-3">
            {/* Summary cards */}
            <div className="grid gap-2 md:grid-cols-5">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-center">
                <span className="text-lg font-bold text-gray-800">{summary.parsedRows ?? items.length}</span>
                <p className="text-[10px] text-gray-500">Filas leídas</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-center">
                <span className="text-lg font-bold text-emerald-700">{readyRows}</span>
                <p className="text-[10px] text-emerald-600">Listas (READY)</p>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-center">
                <span className="text-lg font-bold text-red-700">{errorRows}</span>
                <p className="text-[10px] text-red-600">Con errores</p>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-center">
                <span className="text-lg font-bold text-blue-700">{summary.newProducts ?? 0}</span>
                <p className="text-[10px] text-blue-600">Productos nuevos</p>
              </div>
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-2.5 text-center">
                <span className="text-lg font-bold text-purple-700">{summary.existingProducts ?? 0}</span>
                <p className="text-[10px] text-purple-600">Ya existentes</p>
              </div>
            </div>

            {step === "done" ? (
              <div className="grid gap-2 md:grid-cols-4 text-xs">
                <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2"><strong className="text-emerald-700">{summary.executedLines ?? 0}</strong> ejecutadas</div>
                <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2"><strong className="text-blue-700">{summary.createdProducts ?? 0}</strong> productos creados</div>
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2"><strong className="text-amber-700">{summary.inventoryMovements ?? 0}</strong> movimientos</div>
                <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2"><strong className="text-gray-700">{summary.skippedLines ?? 0}</strong> omitidas</div>
              </div>
            ) : null}

            {/* CSV downloads */}
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" disabled={!previewCsv} onClick={() => downloadCsv(previewCsv, `preview-importacion-${batchId || "catalogo"}.csv`)} icon={<Download className="h-3.5 w-3.5" />}>Descargar preview CSV</Button>
              <Button variant="ghost" size="sm" disabled={!errorCsv} onClick={() => downloadCsv(errorCsv, `errores-importacion-${batchId || "catalogo"}.csv`)} icon={<Download className="h-3.5 w-3.5" />}>Descargar errores CSV</Button>
            </div>

            {/* Preview table with pagination */}
            {items.length ? <ImportPreviewTable items={items} /> : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   IMPORT PREVIEW TABLE (paginated, 50 per page)
   ═══════════════════════════════════════════════════════════ */
const PREVIEW_PAGE_SIZE = 50;

function ImportPreviewTable({ items }: { items: ImportPreviewItem[] }) {
  const [previewPage, setPreviewPage] = useState(1);
  const totalPreviewPages = Math.ceil(items.length / PREVIEW_PAGE_SIZE);
  const pagedItems = items.slice((previewPage - 1) * PREVIEW_PAGE_SIZE, previewPage * PREVIEW_PAGE_SIZE);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="hm-table min-w-[980px] w-full text-xs">
          <thead className="sticky top-0 bg-white z-10">
            <tr>
              <th className="w-12">Fila</th>
              <th>SKU <span title="Auto-generado"><Wand2 className="h-3 w-3 inline text-blue-500 ml-1" /></span></th>
              <th>Producto</th>
              <th>Acción</th>
              <th>Sucursal</th>
              <th className="w-16">Cant.</th>
              <th className="w-16">Costo</th>
              <th className="w-16">Precio</th>
              <th className="w-20">Estado</th>
              <th>Mensajes</th>
            </tr>
          </thead>
          <tbody>
            {pagedItems.map((item, index) => (
              <tr key={`${item.rowNumber}-${index}`} className={item.status === "ERROR" || item.status === "FAILED" ? "bg-red-50" : ""}>
                <td className="text-center">{item.rowNumber}</td>
                <td className="font-mono text-[10px]">{item.sku}</td>
                <td>{item.name}</td>
                <td><Badge variant={item.action === "Crear producto" ? "info" : item.action === "Error" ? "danger" : "warning"}>{item.action}</Badge></td>
                <td>{item.targetBranchCode}</td>
                <td className="text-right">{item.quantity ?? ""}</td>
                <td className="text-right">{item.unitCost ?? ""}</td>
                <td className="text-right">{item.standardSalePrice ?? ""}</td>
                <td>
                  <Badge variant={item.status === "READY" || item.status === "EXECUTED" ? "success" : item.status === "ERROR" || item.status === "FAILED" ? "danger" : "warning"}>
                    {item.status}
                  </Badge>
                </td>
                <td className="text-[10px] text-gray-600">{item.messages?.join(" | ") || "OK"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      {totalPreviewPages > 1 ? (
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-500">
            Mostrando {(previewPage - 1) * PREVIEW_PAGE_SIZE + 1}–{Math.min(previewPage * PREVIEW_PAGE_SIZE, items.length)} de {items.length} filas
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPreviewPage(Math.max(1, previewPage - 1))}
              disabled={previewPage === 1}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            {Array.from({ length: totalPreviewPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPreviewPages || Math.abs(p - previewPage) <= 2)
              .reduce<(number | "...")[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] ?? 0) > 1) acc.push("...");
                acc.push(p);
                return acc;
              }, [])
              .map((p, idx) =>
                p === "..." ? (
                  <span key={`ellipsis-${idx}`} className="px-1 text-xs text-gray-400">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPreviewPage(p)}
                    className={`min-w-[32px] rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      previewPage === p
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            <button
              onClick={() => setPreviewPage(Math.min(totalPreviewPages, previewPage + 1))}
              disabled={previewPage === totalPreviewPages}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   OPENING BALANCE MODAL — FULL REWRITE (Carga inicial)
   Flujo simple solicitado por el usuario:
   1) Buscar producto y hacer clic -> se agrega a la tabla al instante.
   2) Editar cantidad / costo / precio directamente en la tabla (inline).
   3) Agregar mas productos repitiendo el paso 1.
   4) "Guardar carga inicial" envia todas las lineas de una sola vez.
   ═══════════════════════════════════════════════════════════ */
type OpeningLine = {
  productId: string;
  sku: string;
  name: string;
  categoryName: string;
  unit: string;
  saleUnit: string;
  baseUnit: string;
  hasConversion: boolean;
  conversionFactor: number;
  currentBaseStock: number;
  cantidad: string;
  costo: string;
  precioVenta: string;
};

function OpeningBalanceModal({
  branches,
  fallbackProducts,
  activeBranchId,
  onSelectBranch,
  onClose,
  onDone,
}: {
  branches: Branch[];
  fallbackProducts: ProductRow[];
  activeBranchId: string;
  onSelectBranch: (branchId: string) => void;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"SET_PHYSICAL_STOCK" | "ADD_OPENING_STOCK">("SET_PHYSICAL_STOCK");
  const [reason, setReason] = useState("Carga inicial de inventario");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ProductRow[]>(fallbackProducts.slice(0, 12));
  const [searchLoading, setSearchLoading] = useState(false);
  const [lines, setLines] = useState<OpeningLine[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const activeBranch = branches.find((branch) => branch.id === activeBranchId) ?? branches[0];

  function currentBaseStockOf(product: ProductRow): number {
    if (product.stockConversion) {
      return numberOrNull(product.allSharedInventoryBalances?.find((item) => item.branchId === activeBranchId)?.quantityOnHand) ?? 0;
    }
    return numberOrNull(product.inventoryBalances.find((item) => item.branchId === activeBranchId)?.quantityOnHand) ?? 0;
  }

  // Buscador con debounce contra el catalogo (mismo endpoint que ya se usaba).
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams();
      const term = search.trim();
      if (term) params.set("q", term);
      if (activeBranchId) params.set("branchId", activeBranchId);
      params.set("page", "1");
      params.set("limit", "20");
      setSearchLoading(true);
      try {
        const response = await fetch(`/api/master/catalog-inventory?${params}`, { cache: "no-store", signal: controller.signal });
        const raw = await response.json().catch(() => null);
        if (!response.ok) throw new Error(raw?.error?.message ?? raw?.message ?? "No se pudo buscar productos.");
        const payload = unwrapApiData(raw) as CenterData;
        setSearchResults(payload.products ?? []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSearchResults(fallbackProducts.slice(0, 12));
        }
      } finally {
        setSearchLoading(false);
      }
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeBranchId, search, fallbackProducts]);

  // Al hacer clic en un resultado: se agrega de inmediato a la tabla (o hace foco si ya existe).
  function addProduct(product: ProductRow) {
    setLines((prev) => {
      if (prev.some((line) => line.productId === product.id)) {
        toast("Ese producto ya esta en la lista.");
        return prev;
      }
      const pricing = activeBranch ? buildBranchPricingCostRow(product, activeBranch) : null;
      const saleUnit = product.stockConversion?.saleUnit ?? product.unit ?? "UN";
      const baseUnit = product.stockConversion?.baseUnit ?? product.unit ?? "UN";
      const newLine: OpeningLine = {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        categoryName: product.category?.name ?? "Sin categoria",
        unit: saleUnit,
        saleUnit,
        baseUnit,
        hasConversion: !!product.stockConversion,
        conversionFactor: Number(product.stockConversion?.conversionFactor ?? 1) || 1,
        currentBaseStock: currentBaseStockOf(product),
        cantidad: "1",
        costo: pricing?.effectiveCost != null ? String(pricing.effectiveCost) : "",
        precioVenta: pricing?.effectivePrice != null ? String(pricing.effectivePrice) : "",
      };
      return [...prev, newLine];
    });
  }

  function updateLine(productId: string, patch: Partial<OpeningLine>) {
    setLines((prev) => prev.map((line) => (line.productId === productId ? { ...line, ...patch } : line)));
  }

  function removeLine(productId: string) {
    setLines((prev) => prev.filter((line) => line.productId !== productId));
  }

  // Calcula la vista previa de una linea (stock final, margen, alertas).
  function computeLine(line: OpeningLine) {
    const cantidad = Number(line.cantidad);
    const costo = numberOrNull(line.costo);
    const precio = numberOrNull(line.precioVenta);
    const isBaseUnit = line.hasConversion && line.unit === line.baseUnit;
    const enteredBase = line.hasConversion && !isBaseUnit ? cantidad * line.conversionFactor : cantidad;
    const finalBase = mode === "SET_PHYSICAL_STOCK" ? enteredBase : line.currentBaseStock + enteredBase;
    const deltaBase = finalBase - line.currentBaseStock;
    const margin = costo != null && costo > 0 && precio != null && precio > 0 ? ((precio - costo) / precio) * 100 : null;
    const priceBelowCost = costo != null && precio != null && precio > 0 && precio < costo;
    const validQuantity = Number.isFinite(cantidad) && cantidad > 0;
    return { cantidad, costo, precio, enteredBase, finalBase, deltaBase, margin, priceBelowCost, validQuantity };
  }

  const summary = useMemo(() => {
    let totalValue = 0;
    let withoutCost = 0;
    let withoutPrice = 0;
    let belowCost = 0;
    let invalidQty = 0;
    for (const line of lines) {
      const c = computeLine(line);
      totalValue += c.finalBase * (c.costo ?? 0);
      if (c.costo == null || c.costo <= 0) withoutCost += 1;
      if (c.precio == null || c.precio <= 0) withoutPrice += 1;
      if (c.priceBelowCost) belowCost += 1;
      if (!c.validQuantity) invalidQty += 1;
    }
    return { totalProducts: lines.length, totalValue, withoutCost, withoutPrice, belowCost, invalidQty };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, mode]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!activeBranchId) { toast.error("Selecciona una sucursal."); return; }
    if (!reason.trim() || reason.trim().length < 5) { toast.error("El motivo es obligatorio (minimo 5 caracteres)."); return; }
    if (lines.length === 0) { toast.error("Agrega al menos un producto a la carga."); return; }
    if (summary.invalidQty > 0) { toast.error("Hay productos con cantidad invalida. Corrigelos antes de guardar."); return; }
    if (summary.belowCost > 0 && !window.confirm("Hay productos con precio por debajo del costo. Confirma explicitamente que deseas continuar.")) {
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch("/api/inventory/opening-balance/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: activeBranchId,
          mode,
          reason: reason.trim(),
          notes: notes.trim() || undefined,
          lines: lines.map((line) => {
            const costo = numberOrNull(line.costo);
            const precio = numberOrNull(line.precioVenta);
            const hasCost = costo != null && costo > 0;
            const hasPrice = precio != null && precio > 0;
            return {
              productId: line.productId,
              quantity: Number(line.cantidad),
              unit: line.unit,
              unitCost: hasCost ? costo : null,
              costMode: hasCost ? "SET_WAC" : "QUANTITY_ONLY",
              salePrice: hasPrice ? precio : null,
              priceMode: hasPrice ? "SET_BRANCH_PRICE" : "NO_PRICE_CHANGE",
            };
          }),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? payload?.message ?? "No se pudo registrar la carga inicial.");
      const result = unwrapApiData(payload);
      toast.success(`Carga inicial completa: ${result.processed} procesados, ${result.skipped} sin cambio.`);
      setLines([]);
      onClose();
      await onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onSubmit={(event) => submit(event).catch((error) => toast.error(error instanceof Error ? error.message : "No se pudo registrar la carga inicial."))}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold">Carga inicial de inventario</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Busca un producto, da clic para agregarlo y edita cantidad, costo y precio en la tabla. Al final guarda toda la carga.</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Encabezado: sucursal + modo + motivo */}
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Sucursal</label>
              <select className="hm-input w-full" value={activeBranchId} onChange={(e) => onSelectBranch(e.target.value)}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Modo de carga</label>
              <select className="hm-input w-full" value={mode} onChange={(e) => setMode(e.target.value as "SET_PHYSICAL_STOCK" | "ADD_OPENING_STOCK")}>
                <option value="SET_PHYSICAL_STOCK">Fijar stock fisico final (recomendado)</option>
                <option value="ADD_OPENING_STOCK">Sumar al stock actual</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Motivo (obligatorio)</label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo de la carga inicial" />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Nota (opcional)</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observacion opcional" />
            </div>
          </div>

          {/* Buscador de productos */}
          <div className="rounded-lg border border-[var(--color-border)] p-3">
            <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Buscar producto</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--color-text-muted)]" />
              <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, SKU, codigo de barras o categoria" />
            </div>
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-white">
              {searchLoading ? (
                <div className="flex items-center gap-2 px-3 py-3 text-xs text-[var(--color-text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando productos...</div>
              ) : searchResults.length > 0 ? searchResults.map((product) => {
                const row = activeBranch ? buildBranchPricingCostRow(product, activeBranch) : null;
                const branchStock = product.stockConversion
                  ? product.allSharedInventoryBalances?.find((item) => item.branchId === activeBranchId)?.quantityOnHand
                  : product.inventoryBalances.find((item) => item.branchId === activeBranchId)?.quantityOnHand;
                const stock = branchStock === null || branchStock === undefined ? 0 : Number(branchStock);
                const alreadyAdded = lines.some((line) => line.productId === product.id);
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addProduct(product)}
                    disabled={alreadyAdded}
                    className={`block w-full border-b border-[var(--color-border)] px-3 py-2 text-left text-xs transition ${alreadyAdded ? "cursor-not-allowed bg-emerald-50 opacity-70" : "bg-white hover:bg-amber-50"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-[var(--color-text)]">{product.name}</div>
                        <div className="text-[var(--color-text-muted)]">SKU {product.sku}{product.barcode ? ` - Barra ${product.barcode}` : ""} - {product.category?.name ?? "Sin categoria"} - {product.unit}</div>
                      </div>
                      <div className="flex items-center gap-3 text-right text-[var(--color-text-muted)]">
                        <div>
                          <div>Stock {qty(stock)}</div>
                          <div>Precio {formatMoneyOrNd(row?.effectivePrice ?? null)}</div>
                          <div>Costo {formatMoneyOrNd(row?.effectiveCost ?? null)}</div>
                        </div>
                        {alreadyAdded
                          ? <Check className="h-4 w-4 text-emerald-600" />
                          : <Plus className="h-4 w-4 text-amber-600" />}
                      </div>
                    </div>
                  </button>
                );
              }) : (
                <div className="px-3 py-3 text-xs text-[var(--color-text-muted)]">Sin resultados para la busqueda.</div>
              )}
            </div>
          </div>

          {/* Tabla editable de la carga */}
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table className="hm-table min-w-[1100px] w-full">
              <thead>
                <tr>
                  <th>Producto</th><th>SKU</th><th>Cantidad</th><th>Unidad</th><th>Costo unitario</th><th>Precio venta</th><th>Stock actual</th><th>Stock final</th><th>Margen est.</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const c = computeLine(line);
                  return (
                    <tr key={line.productId} className={c.priceBelowCost ? "bg-red-50" : !c.validQuantity ? "bg-amber-50" : undefined}>
                      <td><div className="font-medium">{line.name}</div><div className="text-xs text-[var(--color-text-muted)]">{line.categoryName}</div></td>
                      <td className="font-mono text-xs">{line.sku}</td>
                      <td>
                        <Input type="number" min="0.0001" step="0.0001" className="w-24" value={line.cantidad} onChange={(e) => updateLine(line.productId, { cantidad: e.target.value })} />
                      </td>
                      <td>
                        {line.hasConversion ? (
                          <select className="hm-input w-28" value={line.unit} onChange={(e) => updateLine(line.productId, { unit: e.target.value })}>
                            <option value={line.saleUnit}>{line.saleUnit}</option>
                            <option value={line.baseUnit}>{line.baseUnit}</option>
                          </select>
                        ) : <span className="text-xs">{line.unit}</span>}
                      </td>
                      <td>
                        <Input type="number" min="0" step="0.01" className="w-28" value={line.costo} onChange={(e) => updateLine(line.productId, { costo: e.target.value })} placeholder="Sin cambio" />
                      </td>
                      <td>
                        <Input type="number" min="0" step="0.01" className="w-28" value={line.precioVenta} onChange={(e) => updateLine(line.productId, { precioVenta: e.target.value })} placeholder="Sin cambio" />
                      </td>
                      <td>{qty(line.currentBaseStock)} {line.hasConversion ? line.baseUnit.toLowerCase() : ""}</td>
                      <td>{qty(c.finalBase)} {line.hasConversion ? line.baseUnit.toLowerCase() : ""}</td>
                      <td><Badge variant={marginBadgeVariant(c.margin)}>{formatMarginOrNd(c.margin)}</Badge></td>
                      <td>
                        <Button type="button" variant="danger" size="sm" onClick={() => removeLine(line.productId)} icon={<Trash2 className="h-3.5 w-3.5" />}>Quitar</Button>
                      </td>
                    </tr>
                  );
                })}
                {lines.length === 0 ? (
                  <tr><td colSpan={10} className="py-8 text-center text-sm text-[var(--color-text-muted)]">Busca un producto arriba y da clic para agregarlo a la carga.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {/* Resumen */}
          <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-5">
            <Kpi label="Productos" value={summary.totalProducts} />
            <Kpi label="Valor estimado" value={money(summary.totalValue)} />
            <Kpi label="Sin costo" value={summary.withoutCost} />
            <Kpi label="Sin precio" value={summary.withoutPrice} />
            <Kpi label="Bajo costo" value={summary.belowCost} />
          </div>
          {summary.withoutCost > 0 || summary.withoutPrice > 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
              Hay productos sin costo o sin precio. Quedaran registrados solo con stock, pero deben revisarse luego en Precios y costos.
            </div>
          ) : null}
          {summary.belowCost > 0 ? (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">
              Hay productos con precio por debajo del costo. Se pedira confirmacion explicita antes de guardar.
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="success" loading={submitting} disabled={lines.length === 0} icon={<Check className="h-4 w-4" />}>Guardar carga inicial</Button>
        </div>
      </form>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MOVEMENTS PANEL
   ═══════════════════════════════════════════════════════════ */
function MovementsPanel({
  branches,
  products,
  movements,
  selectedBranchId,
  initialDialog,
  onInitialDialogHandled,
  onSelectBranch,
  onDone,
}: {
  branches: Branch[];
  products: ProductRow[];
  movements: Movement[];
  selectedBranchId?: string;
  initialDialog?: "adjustment" | "opening" | null;
  onInitialDialogHandled?: () => void;
  onSelectBranch: (branchId: string) => void;
  onDone: () => Promise<void>;
}) {
  const [productId, setProductId] = useState("");
  const [movementType, setMovementType] = useState("");
  const [movementSearch, setMovementSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [movementPage, setMovementPage] = useState(1);
  const [movementLimit, setMovementLimit] = useState(30);
  const [pagedMovements, setPagedMovements] = useState<Movement[]>(movements);
  const [movementPagination, setMovementPagination] = useState<Pagination>({ page: 1, limit: 30, total: movements.length, totalPages: 1 });
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [showAdjustment, setShowAdjustment] = useState(false);
  const [showOpening, setShowOpening] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const activeBranchId = selectedBranchId || branches[0]?.id || "";
  const firstProduct = products[0];
  const [adjustment, setAdjustment] = useState({
    productId: firstProduct?.id ?? "",
    adjustmentType: "ADJUSTMENT_IN",
    quantity: "1",
    unit: firstProduct?.stockConversion?.saleUnit ?? firstProduct?.unit ?? "UN",
    reason: "",
    notes: "",
  });


  useEffect(() => {
    if (initialDialog === "adjustment") setShowAdjustment(true);
    if (initialDialog === "opening") setShowOpening(true);
    if (initialDialog) onInitialDialogHandled?.();
  }, [initialDialog, onInitialDialogHandled]);

  const loadMovements = useCallback(async () => {
    if (!activeBranchId) return;
    setLoadingMovements(true);
    try {
      const params = new URLSearchParams({
        branchId: activeBranchId,
        page: String(movementPage),
        limit: String(movementLimit),
      });
      if (productId) params.set("productId", productId);
      if (movementType) params.set("movementType", movementType);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (movementSearch.trim()) params.set("search", movementSearch.trim());
      const response = await apiFetch(`/api/master/catalog-inventory/movements?${params}`);
      const raw = await response.json();
      if (!response.ok) throw new Error(raw?.error?.message ?? raw?.message ?? "No se pudo cargar Kardex.");
      const payload = unwrapApiData(raw) as { rows: Movement[]; pagination: Pagination };
      setPagedMovements(payload.rows);
      setMovementPagination(payload.pagination);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar Kardex.");
    } finally {
      setLoadingMovements(false);
    }
  }, [activeBranchId, dateFrom, dateTo, movementLimit, movementPage, movementSearch, movementType, productId]);

  useEffect(() => {
    void loadMovements();
  }, [loadMovements]);

  const resetMovementPage = () => setMovementPage(1);
  const adjustmentProduct = adjustment.productId ? products.find((product) => product.id === adjustment.productId) : undefined;
  function currentBaseStockForProduct(product?: ProductRow) {
    if (!product) return 0;
    if (product.stockConversion) {
      return numberOrNull(product.allSharedInventoryBalances?.find((item) => item.branchId === activeBranchId)?.quantityOnHand) ?? 0;
    }
    return numberOrNull(product.inventoryBalances.find((item) => item.branchId === activeBranchId)?.quantityOnHand) ?? 0;
  }
  const adjustmentQty = Number(adjustment.quantity);
  const adjustmentFactor = adjustmentProduct ? ironQuintalFactor(adjustmentProduct) : null;
  const isBaseUnit = !!adjustmentProduct?.stockConversion && adjustment.unit === adjustmentProduct.stockConversion.baseUnit;
  const currentBaseStock = currentBaseStockForProduct(adjustmentProduct);
  const changeBaseQty = Number.isFinite(adjustmentQty)
    ? (adjustmentProduct?.stockConversion && !isBaseUnit ? adjustmentQty * Number(adjustmentProduct.stockConversion.conversionFactor || 1) : adjustmentQty)
    : 0;
  const direction = ["ADJUSTMENT_OUT", "DAMAGE"].includes(adjustment.adjustmentType) ? -1 : 1;
  const previewFinalBase = adjustment.adjustmentType === "PHYSICAL_COUNT" ? changeBaseQty : currentBaseStock + (direction * changeBaseQty);

  async function submitAdjustment(event: React.FormEvent) {
    event.preventDefault();
    if (!activeBranchId) { toast.error("Selecciona una sucursal."); return; }
    if (!adjustment.productId) { toast.error("Selecciona un producto."); return; }
    if (!adjustment.reason.trim()) { toast.error("El motivo es obligatorio."); return; }
    if (!Number.isFinite(adjustmentQty) || adjustmentQty <= 0) { toast.error("La cantidad debe ser mayor que cero."); return; }
    if (previewFinalBase < 0) { toast.error("La salida supera el stock disponible."); return; }
    setSubmitting(true);
    try {
      const response = await apiFetch("/api/inventory/manual-adjustment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: activeBranchId,
          productId: adjustment.productId,
          adjustmentType: adjustment.adjustmentType,
          quantity: adjustmentQty,
          unit: adjustment.unit,
          reason: adjustment.reason.trim(),
          notes: adjustment.notes.trim() || undefined,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? payload?.message ?? "No se pudo registrar el ajuste.");
      toast.success("Ajuste manual registrado.");
      setShowAdjustment(false);
      setAdjustment((prev) => ({ ...prev, quantity: "1", reason: "", notes: "" }));
      await onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card noPadding>
      <div className="flex items-center justify-between px-4 py-3" style={{ background: "var(--color-surface-alt)", borderBottom: "0.5px solid var(--color-border)" }}>
        <div className="flex items-center gap-2">
          <History className="h-4 w-4" style={{ color: "var(--color-master-600)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Movimientos / Kardex</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={() => setShowAdjustment(true)} icon={<Plus className="h-4 w-4" />}>Ajuste manual</Button>
          <Button variant="success" size="sm" onClick={() => setShowOpening(true)} icon={<Package className="h-4 w-4" />}>Carga inicial</Button>
        </div>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-7">
          <select className="hm-input" value={activeBranchId} onChange={(e) => { onSelectBranch(e.target.value); resetMovementPage(); }}>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}</select>
          <select className="hm-input" value={productId} onChange={(e) => { setProductId(e.target.value); resetMovementPage(); }}><option value="">Todos los productos</option>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}</select>
          <select className="hm-input" value={movementType} onChange={(e) => { setMovementType(e.target.value); resetMovementPage(); }}><option value="">Todos los tipos</option><option value="PURCHASE_IN">Compra / entrada</option><option value="SALE_OUT">Venta / salida</option><option value="ADJUSTMENT_IN">Ajuste entrada / carga inicial</option><option value="ADJUSTMENT_OUT">Ajuste salida</option><option value="RETURN_IN">Devolucion entrada</option><option value="RETURN_OUT">Devolucion salida</option><option value="TRANSFER_IN">Traslado entrada</option><option value="TRANSFER_OUT">Traslado salida</option></select>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); resetMovementPage(); }} />
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); resetMovementPage(); }} />
          <Input value={movementSearch} onChange={(e) => { setMovementSearch(e.target.value); resetMovementPage(); }} placeholder="Buscar ref./nota/producto" />
          <select className="hm-input" value={movementLimit} onChange={(e) => { setMovementLimit(Number(e.target.value)); resetMovementPage(); }}><option value="30">30</option><option value="50">50</option><option value="100">100</option></select>
          <div className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)]">Los costos se ajustan desde Precios y costos, no desde Kardex.</div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
          <span>{movementPagination.total} movimientos · pagina {movementPagination.page} de {movementPagination.totalPages}</span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={movementPage <= 1 || loadingMovements} onClick={() => setMovementPage((p) => Math.max(1, p - 1))} icon={<ChevronLeft className="h-3.5 w-3.5" />}>Anterior</Button>
            <Button variant="secondary" size="sm" disabled={movementPage >= movementPagination.totalPages || loadingMovements} onClick={() => setMovementPage((p) => p + 1)} icon={<ChevronRight className="h-3.5 w-3.5" />}>Siguiente</Button>
            <Button variant="ghost" size="sm" loading={loadingMovements} onClick={() => void loadMovements()} icon={<RefreshCcw className="h-3.5 w-3.5" />}>Actualizar</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="hm-table min-w-[980px] w-full">
            <thead><tr><th>Fecha</th><th>Producto</th><th>SKU</th><th>Sucursal</th><th>Tipo</th><th>Entrada</th><th>Salida</th><th>Saldo final</th><th>Unidad</th><th>Usuario</th><th>Referencia</th><th>Motivo / nota</th></tr></thead>
            <tbody>
              {pagedMovements.map((item) => {
                const quantity = Number(item.quantity);
                const isIn = ["PURCHASE_IN", "RETURN_IN", "ADJUSTMENT_IN", "TRANSFER_IN", "TIMBER_INTAKE_IN"].includes(item.movementType);
                const visibleType = item.referenceType === "OPENING_BALANCE" ? "Carga inicial" : item.referenceType === "MANUAL_ADJUSTMENT" ? "Ajuste manual" : item.movementType;
                return <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString("es-NI")}</td><td className="font-medium">{item.product.name}</td><td className="font-mono text-xs">{item.product.sku}</td><td>{item.branch.code}</td><td>{visibleType}</td><td>{isIn ? qty(quantity) : "-"}</td><td>{!isIn ? qty(quantity) : "-"}</td><td className="text-[var(--color-text-muted)]">-</td><td>Unidad</td><td className="text-[var(--color-text-muted)]">-</td><td>{item.referenceType} / {item.referenceId}</td><td>{item.notes ?? "-"}</td></tr>;
              })}
              {pagedMovements.length === 0 ? <tr><td colSpan={12} className="py-8 text-center text-sm text-[var(--color-text-muted)]">{loadingMovements ? "Cargando movimientos..." : "Sin movimientos para los filtros seleccionados."}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      {showAdjustment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form className="w-full max-w-2xl rounded-xl bg-white shadow-2xl" onSubmit={(event) => submitAdjustment(event).catch((error) => toast.error(error instanceof Error ? error.message : "No se pudo registrar ajuste."))}>
            <div className="border-b border-[var(--color-border)] px-5 py-4">
              <h3 className="text-sm font-semibold">Registrar ajuste manual</h3>
              <p className="text-xs text-[var(--color-text-muted)]">Solo modifica cantidad/volumen. No se edita costo desde Kardex.</p>
            </div>
            <div className="grid gap-3 p-5 md:grid-cols-2">
              <select className="hm-input" value={activeBranchId} onChange={(e) => onSelectBranch(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}</select>
              <select className="hm-input" value={adjustment.productId} onChange={(e) => {
                const nextProduct = products.find((p) => p.id === e.target.value);
                setAdjustment({ ...adjustment, productId: e.target.value, unit: nextProduct?.stockConversion?.saleUnit ?? nextProduct?.unit ?? "UN" });
              }}>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}</select>
              <select className="hm-input" value={adjustment.adjustmentType} onChange={(e) => setAdjustment({ ...adjustment, adjustmentType: e.target.value })}>
                <option value="ADJUSTMENT_IN">Entrada manual</option>
                <option value="ADJUSTMENT_OUT">Salida manual</option>
                <option value="PHYSICAL_COUNT">Correccion por conteo fisico</option>
                <option value="DAMAGE">Merma / dano</option>
                <option value="RETURN">Devolucion</option>
                <option value="OTHER">Otro</option>
              </select>
              <div className="grid grid-cols-[1fr_140px] gap-2">
                <Input type="number" min="0.0001" step="0.0001" value={adjustment.quantity} onChange={(e) => setAdjustment({ ...adjustment, quantity: e.target.value })} placeholder="Cantidad" />
                <select className="hm-input" value={adjustment.unit} onChange={(e) => setAdjustment({ ...adjustment, unit: e.target.value })}>
                  {adjustmentProduct?.stockConversion ? (
                    <>
                      <option value={adjustmentProduct.stockConversion.saleUnit}>{adjustmentProduct.stockConversion.saleUnit}</option>
                      <option value={adjustmentProduct.stockConversion.baseUnit}>{adjustmentProduct.stockConversion.baseUnit}</option>
                    </>
                  ) : <option value={adjustmentProduct?.unit ?? "UN"}>{adjustmentProduct?.unit ?? "UN"}</option>}
                </select>
              </div>
              <Input className="md:col-span-2" value={adjustment.reason} onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })} placeholder="Motivo obligatorio" />
              <Input className="md:col-span-2" value={adjustment.notes} onChange={(e) => setAdjustment({ ...adjustment, notes: e.target.value })} placeholder="Observacion opcional" />
              <div className="md:col-span-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-sm">
                <div className="font-semibold">Vista previa</div>
                <div className="mt-1 grid gap-1 text-xs text-[var(--color-text-muted)] sm:grid-cols-3">
                  <span>Actual: {qty(currentBaseStock)} {adjustmentProduct?.stockConversion?.baseUnit ?? adjustmentProduct?.unit ?? ""}</span>
                  <span>Cambio base: {qty(direction * changeBaseQty)}</span>
                  <span>Final: {qty(previewFinalBase)} {adjustmentProduct?.stockConversion?.baseUnit ?? adjustmentProduct?.unit ?? ""}</span>
                </div>
                {adjustmentProduct?.stockConversion ? (
                  <div className="mt-2 text-xs text-[var(--color-text-muted)]">
                    Stock final convertible: {qty(previewFinalBase)} varillas{adjustmentFactor ? ` / ${qty(previewFinalBase / adjustmentFactor)} quintales` : ""}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-4">
              <Button type="button" variant="ghost" onClick={() => setShowAdjustment(false)}>Cancelar</Button>
              <Button type="submit" variant="success" loading={submitting} icon={<Check className="h-4 w-4" />}>Confirmar ajuste</Button>
            </div>
          </form>
        </div>
      ) : null}
      {showOpening ? (
        <OpeningBalanceModal
          branches={branches}
          fallbackProducts={products}
          activeBranchId={activeBranchId}
          onSelectBranch={onSelectBranch}
          onClose={() => setShowOpening(false)}
          onDone={onDone}
        />
      ) : null}    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
   PRICING PANEL — FULL REWRITE
   Pre-populates inputs with current branchProductSettings,
   uses controlled state, shows save button per cell, toast.
   ═══════════════════════════════════════════════════════════ */
type PricingDraft = Record<string, Record<string, { price: string; dirty: boolean }>>;

function buildPricingDraft(products: ProductRow[], branches: Branch[]): PricingDraft {
  const draft: PricingDraft = {};
  for (const product of products) {
    draft[product.id] = {};
    const settingsMap = new Map(product.branchProductSettings.map((s) => [s.branchId, s]));
    for (const branch of branches) {
      const setting = settingsMap.get(branch.id);
      draft[product.id][branch.id] = {
        price: setting?.branchPrice ?? "",
        dirty: false,
      };
    }
  }
  return draft;
}

function PricingPanel({
  branches,
  products,
  selectedBranchId,
  focusedProductId,
  onSelectBranch,
  onSave,
  onSaveGlobalCost,
  onToggleBranchAssignment,
}: {
  branches: Branch[];
  products: ProductRow[];
  selectedBranchId?: string;
  focusedProductId?: string | null;
  onSelectBranch: (branchId: string) => void;
  onSave: (product: ProductRow, branch: Branch, field: "branchPrice", value: string) => Promise<void>;
  onSaveGlobalCost?: (product: ProductRow, value: string) => Promise<void>;
  onToggleBranchAssignment?: (product: ProductRow, branchId: string, isAvailable: boolean) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PricingDraft>(() => buildPricingDraft(products, branches));
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const [globalCostDraft, setGlobalCostDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(products.map((p) => [p.id, p.globalCost != null ? String(p.globalCost) : ""]))
  );
  const [comparisonMode, setComparisonMode] = useState(false);
  const [productFilter, setProductFilter] = useState("");
  const productsRef = useRef(products);
  const activeBranch = useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId) ?? branches[0],
    [branches, selectedBranchId],
  );
  const pricingBranches = useMemo(() => activeBranch ? [activeBranch] : [], [activeBranch]);
  const filteredProducts = useMemo(() => products.filter((product) => {
    if (focusedProductId && product.id !== focusedProductId) return false;
    const term = productFilter.trim().toLowerCase();
    if (!term) return true;
    return product.name.toLowerCase().includes(term)
      || product.sku.toLowerCase().includes(term)
      || (product.category?.name ?? "").toLowerCase().includes(term);
  }), [focusedProductId, productFilter, products]);

  // Re-sync draft when products reference changes (after external load)
  useEffect(() => {
    if (productsRef.current !== products) {
      productsRef.current = products;
      setDraft(buildPricingDraft(products, branches));
      setGlobalCostDraft(Object.fromEntries(products.map((p) => [p.id, p.globalCost != null ? String(p.globalCost) : ""])));
    }
  }, [products, branches]);

  function updateCell(productId: string, branchId: string, field: "price", value: string) {
    setDraft((prev) => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        [branchId]: { ...prev[productId][branchId], [field]: value, dirty: true },
      },
    }));
  }

  async function saveCell(product: ProductRow, branch: Branch, field: "price") {
    const cell = draft[product.id]?.[branch.id];
    if (!cell) return;
    const apiField = "branchPrice";
    const key = `${product.id}-${branch.id}-${field}`;
    setSavingKey(key);
    try {
      await onSave(product, branch, apiField, cell[field]);
      // Mark cell as no longer dirty after successful save (optimistic)
      setDraft((prev) => ({
        ...prev,
        [product.id]: {
          ...prev[product.id],
          [branch.id]: { ...prev[product.id][branch.id], dirty: false },
        },
      }));
    } finally {
      setSavingKey(null);
    }
  }

  async function saveAllDirty(product: ProductRow) {
    const cells = draft[product.id];
    if (!cells) return;
    let saved = 0;
    for (const branch of pricingBranches) {
      const cell = cells[branch.id];
      if (!cell?.dirty) continue;
      const origSetting = product.branchProductSettings.find((s) => s.branchId === branch.id);
      if (cell.price !== (origSetting?.branchPrice ?? "")) {
        await onSave(product, branch, "branchPrice", cell.price);
        saved++;
      }
    }
    if (saved > 0) {
      // Mark all cells for this product as not dirty
      setDraft((prev) => {
        const updated = { ...prev[product.id] };
        for (const branch of pricingBranches) {
          if (updated[branch.id]) updated[branch.id] = { ...updated[branch.id], dirty: false };
        }
        return { ...prev, [product.id]: updated };
      });
    } else {
      toast("Sin cambios pendientes", { icon: "ℹ️" });
    }
  }

  return (
    <Card noPadding>
      <div className="hm-card-header-green">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <DollarSign className="h-4 w-4" /> Precios por sucursal y costo global
        </h2>
        <p className="mt-0.5 text-xs opacity-90">Edita precios por sucursal. Los margenes usan el costo global efectivo.</p>
      </div>
      {/* Branch pricing filters */}
      <div className="grid gap-2 px-4 pt-3 md:grid-cols-[240px_1fr_auto_auto]">
        <select className="hm-input" value={activeBranch?.id ?? ""} onChange={(event) => onSelectBranch(event.target.value)}>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>)}
        </select>
        <Input value={productFilter} onChange={(event) => setProductFilter(event.target.value)} placeholder="Buscar producto, SKU o categoria" />
        <Button variant={comparisonMode ? "secondary" : "ghost"} onClick={() => setComparisonMode((value) => !value)}>Vista comparativa</Button>
        <Button variant="ghost" onClick={() => setProductFilter("")}>Limpiar</Button>
      </div>
      {comparisonMode ? (
        <div className="overflow-x-auto p-4">
          <table className="hm-table min-w-[900px] w-full">
            <thead><tr><th>Producto</th><th>Precio global</th>{branches.map((branch) => <th key={branch.id}>{branch.code} precio / costo global</th>)}<th>Modo</th></tr></thead>
            <tbody>
              {filteredProducts.map((product) => (
                <tr key={product.id}>
                  <td className="font-medium">{product.sku} - {product.name}</td>
                  <td>{money(product.basePrice)}</td>
                  {branches.map((branch) => {
                    const row = buildBranchPricingCostRow(product, branch);
                    return (
                      <td key={branch.id} className="text-xs">
                        <div>Precio: {formatMoneyOrNd(row.effectivePrice)} ({row.priceSource === "BRANCH" ? "Sucursal" : "Global"})</div>
                        <div>Costo global: {formatMoneyOrNd(row.effectiveCost)}</div>
                        <div>Margen: {formatMarginOrNd(row.effectiveMarginPercent)}</div>
                      </td>
                    );
                  })}
                  <td className="text-xs text-[var(--color-text-muted)]">Solo lectura</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="overflow-x-auto p-4">
        <table className="hm-table min-w-[1200px] w-full">
          <thead>
            <tr>
              <th className="min-w-[220px]">Producto</th>
              <th>Precio global</th>
              <th>Precio sucursal</th>
              <th>Precio efectivo</th>
              <th>WAC referencia</th>
              <th title="Costo que aplica a todas las sucursales. Se puede sobreescribir por sucursal.">Costo universal ↕</th>
              <th>Margen efectivo</th>
              <th>Fuente</th>
              <th>Alertas</th>
              <th title="Asignación manual: activa el producto en esta sucursal aunque no tenga stock ni historial">Asignado ★</th>
              <th className="min-w-[100px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((p) => {
              if (!activeBranch) return null;
              const row = buildBranchPricingCostRow(p, activeBranch);
              const cell = draft[p.id]?.[activeBranch.id] ?? { cost: "", price: "", dirty: false };
              const priceKey = `${p.id}-${activeBranch.id}-price`;
              const hasDirty = Boolean(cell.dirty);
              return (
                <tr key={p.id}>
                  <td className="font-medium">
                    <div>{p.sku} - {p.name}</div>
                    {row.isConvertibleStock ? (
                      <div className="mt-1 flex flex-wrap gap-1 text-[0.65rem]">
                        <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5">Stock compartido</span>
                        {row.conversionFactor && row.conversionFactor > 1 ? <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5">WAC convertido x {row.conversionFactor}</span> : null}
                      </div>
                    ) : null}
                  </td>
                  <td>{formatMoneyOrNd(row.standardSalePrice)}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-1">
                      <Input className={`h-7 text-xs flex-1 ${cell.dirty ? "ring-2 ring-amber-300/60" : ""}`} type="number" min="0" step="0.01" placeholder="Precio" value={cell.price} onChange={(e) => updateCell(p.id, activeBranch.id, "price", e.target.value)} />
                      <button type="button" title="Guardar precio" className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white transition-all disabled:opacity-50 ${savingKey === priceKey ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700 shadow-sm hover:shadow"}`} disabled={savingKey === priceKey} onClick={() => saveCell(p, activeBranch, "price")}>
                        {savingKey === priceKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      </button>
                    </div>
                  </td>
                  <td>{formatMoneyOrNd(row.effectivePrice)}</td>
                  <td>
                    <div>{formatMoneyOrNd(row.weightedAverageCost)}</div>
                    {row.isConvertibleStock ? <div className="text-[0.65rem] text-[var(--color-text-muted)]">Base: {formatMoneyOrNd(row.baseWeightedAverageCost)} / {row.baseUnit}</div> : null}
                  </td>
                  <td className="py-1.5">
                    {onSaveGlobalCost ? (
                      <div className="flex items-center gap-1">
                        <Input
                          className={`h-7 text-xs flex-1 ${globalCostDraft[p.id] !== (p.globalCost != null ? String(p.globalCost) : "") ? "ring-2 ring-amber-300/60" : ""}`}
                          type="number" min="0" step="0.01"
                          placeholder="Sin costo univ."
                          value={globalCostDraft[p.id] ?? ""}
                          onChange={(e) => setGlobalCostDraft((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          title="Costo universal — aplica a todas las sucursales sin override"
                        />
                        <button type="button" title="Guardar costo universal"
                          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white transition-all disabled:opacity-50 ${savingKey === `${p.id}-global-cost` ? "bg-gray-400" : "bg-emerald-600 hover:bg-emerald-700 shadow-sm"}`}
                          disabled={savingKey === `${p.id}-global-cost`}
                          onClick={async () => {
                            setSavingKey(`${p.id}-global-cost`);
                            try { await onSaveGlobalCost(p, globalCostDraft[p.id] ?? ""); } finally { setSavingKey(null); }
                          }}
                        >
                          {savingKey === `${p.id}-global-cost` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        </button>
                      </div>
                    ) : formatMoneyOrNd(row.effectiveCost)}
                  </td>
                  <td><Badge variant={marginBadgeVariant(row.effectiveMarginPercent)}>{formatMarginOrNd(row.effectiveMarginPercent)}</Badge></td>
                  <td className="text-xs">
                    <div>Precio: {row.priceSource === "BRANCH" ? "Sucursal" : "Global"}</div>
                    <div>Costo: {row.costSource === "GLOBAL" ? "Global" : "Sin costo"}</div>
                  </td>
                  <td>
                    <div className="flex flex-col gap-1 text-xs">
                      {row.warnings.length === 0 ? <span className="text-[var(--color-text-muted)]">OK</span> : row.warnings.map((warning) => <Badge key={warning} variant={warning.includes("bajo costo") ? "danger" : "warning"}>{warning}</Badge>)}
                    </div>
                  </td>
                  <td className="text-center">
                    {onToggleBranchAssignment && activeBranch ? (() => {
                      const setting = p.branchProductSettings.find((s) => s.branchId === activeBranch.id);
                      const isAssigned = setting?.isAvailable === true;
                      const key = `assign-${p.id}-${activeBranch.id}`;
                      return (
                        <button
                          type="button"
                          title={isAssigned ? "Desasignar de esta sucursal" : "Asignar a esta sucursal manualmente"}
                          disabled={assigningKey === key}
                          onClick={async () => {
                            setAssigningKey(key);
                            try { await onToggleBranchAssignment(p, activeBranch.id, !isAssigned); } finally { setAssigningKey(null); }
                          }}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold transition-colors ${
                            isAssigned
                              ? "bg-[var(--color-success-100)] text-[var(--color-success-700)] hover:bg-[var(--color-success-200)]"
                              : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                          }`}
                        >
                          {assigningKey === key ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                          {isAssigned ? "★ Sí" : "○ No"}
                        </button>
                      );
                    })() : null}
                  </td>
                  <td>
                    <Button variant={hasDirty ? "success" : "ghost"} size="sm" onClick={() => saveAllDirty(p)} icon={<Save className="h-3.5 w-3.5" />}>Guardar fila</Button>
                  </td>
                </tr>
              );
            })}
            {filteredProducts.length === 0 ? (
              <tr><td colSpan={11} className="py-6 text-center text-[var(--color-text-muted)]">No hay productos.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
   TRANSFERS PANEL — redirect shortcut to dedicated page
   The full transfer management lives at /app/master/transfers
   ═══════════════════════════════════════════════════════════ */
function TransfersPanel({ branches }: { branches: Branch[] }) {
  const [summary, setSummary] = useState<{ total: number; draft: number; transit: number } | null>(null);

  useEffect(() => {
    apiFetch("/api/master/transfers").then(async (res) => {
      if (!res.ok) return;
      const raw = await res.json();
      const list = (unwrapApiData(raw) as Transfer[]) ?? [];
      setSummary({
        total: list.length,
        draft: list.filter((t) => t.status === "DRAFT" || t.status === "APPROVED").length,
        transit: list.filter((t) => t.status === "IN_TRANSIT" || t.status === "PARTIALLY_RECEIVED").length,
      });
    }).catch(() => { /* non-critical */ });
  }, []);

  return (
    <Card noPadding>
      <div className="hm-card-header-blue">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Shuffle className="h-4 w-4" /> Envíos entre sucursales</h2>
      </div>
      <div className="p-6 space-y-4">
        {summary && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-center">
              <p className="text-2xl font-bold text-[var(--color-text)]">{summary.total}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Total envíos</p>
            </div>
            <div className="rounded-xl border border-[var(--color-warning-200)] bg-[color-mix(in_srgb,var(--color-warning-50)_40%,white)] p-3 text-center">
              <p className="text-2xl font-bold text-[var(--color-warning-700)]">{summary.draft}</p>
              <p className="text-xs text-[var(--color-warning-600)] mt-0.5">Pendientes</p>
            </div>
            <div className="rounded-xl border border-[var(--color-info-200)] bg-[color-mix(in_srgb,var(--color-info-50)_40%,white)] p-3 text-center">
              <p className="text-2xl font-bold text-[var(--color-info-700)]">{summary.transit}</p>
              <p className="text-xs text-[var(--color-info-600)] mt-0.5">En tránsito</p>
            </div>
          </div>
        )}
        <div className="rounded-xl border border-[var(--color-master-200)] bg-[var(--color-master-50)] p-4 text-sm text-[var(--color-master-800)]">
          <p className="font-semibold mb-1">Centro de Envíos</p>
          <p className="text-xs leading-relaxed text-[var(--color-master-700)]">
            La gestión completa de envíos entre sucursales — incluyendo sugerencias inteligentes de reabastecimiento, despacho desde la central y seguimiento — se realiza en la sección dedicada.
          </p>
        </div>
        <Link
          href={"/app/master/transfers" as Route}
          className="flex items-center justify-center gap-2 w-full rounded-xl bg-[var(--color-master-600)] hover:bg-[var(--color-master-700)] px-4 py-3 text-sm font-semibold text-white transition-colors"
        >
          <Shuffle className="h-4 w-4" />
          Ir a Envíos Sucursales
          <ChevronRight className="h-4 w-4" />
        </Link>
        {branches.length > 0 && (
          <p className="text-xs text-center text-[var(--color-text-muted)]">
            {branches.length} sucursal{branches.length !== 1 ? "es" : ""} registrada{branches.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
   REORDER PANEL
   ═══════════════════════════════════════════════════════════ */
function ReplenishmentPanel({ alerts, branches, selectedBranchId }: { alerts: ReorderAlert[]; branches: Branch[]; selectedBranchId?: string }) {
  const [branchId, setBranchId] = useState(selectedBranchId || branches[0]?.id || "");
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<ReplenishmentRecommendation[]>([]);
  const [summary, setSummary] = useState<ReplenishmentSummary | null>(null);
  const [transfers, setTransfers] = useState<TransferOpportunity[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [selectedTransferKeys, setSelectedTransferKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (selectedBranchId) setBranchId(selectedBranchId);
  }, [selectedBranchId]);

  async function analyze() {
    if (!branchId) {
      toast.error("Selecciona una sucursal para analizar reposicion.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/replenishment/recommendations?branchId=${branchId}&includeTransferOpportunities=true`, { cache: "no-store" });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo analizar reposicion.");
      const data = unwrapApiData(raw) as { recommendations: ReplenishmentRecommendation[]; summary: ReplenishmentSummary };
      setRecommendations(data.recommendations);
      setSummary(data.summary);
      setSelectedProductIds(new Set(data.recommendations.filter((item) => item.recommendationType === "BUY" && item.suggestedOrderQty > 0).map((item) => item.productId)));
      toast.success("Analisis de reposicion actualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al analizar reposicion.");
    } finally {
      setLoading(false);
    }
  }

  async function loadTransfers() {
    if (!branchId) {
      toast.error("Selecciona una sucursal.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/replenishment/transfers?branchId=${branchId}`, { cache: "no-store" });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudieron cargar traslados sugeridos.");
      const data = unwrapApiData(raw) as { opportunities: TransferOpportunity[] };
      setTransfers(data.opportunities);
      setSelectedTransferKeys(new Set(data.opportunities.map((item) => `${item.fromBranchId}:${item.productId}`)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al cargar traslados.");
    } finally {
      setLoading(false);
    }
  }

  async function createPurchaseDraft() {
    const items = recommendations
      .filter((item) => selectedProductIds.has(item.productId) && item.recommendationType === "BUY" && item.suggestedOrderQty > 0)
      .map((item) => ({ productId: item.productId, quantity: item.suggestedOrderQty }));
    if (!branchId || items.length === 0) {
      toast.error("Selecciona al menos un producto con recomendacion de compra.");
      return;
    }
    const res = await apiFetch("/api/inventory/replenishment/create-purchase-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId, items, notes: "Borrador creado desde Reposicion inteligente" }),
    });
    const raw = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(raw?.error?.message ?? "No se pudo crear el borrador de compra.");
      return;
    }
    const data = unwrapApiData(raw);
    toast.success(`Borrador de compra ${data.purchaseOrderId} creado (${data.status}).`);
  }

  async function createTransferDraft() {
    const selected = transfers.filter((item) => selectedTransferKeys.has(`${item.fromBranchId}:${item.productId}`));
    if (selected.length === 0) {
      toast.error("Selecciona al menos un traslado sugerido.");
      return;
    }
    const first = selected[0];
    const sameRoute = selected.every((item) => item.fromBranchId === first.fromBranchId && item.toBranchId === first.toBranchId);
    if (!sameRoute) {
      toast.error("Selecciona traslados de la misma sucursal origen y destino para crear un borrador.");
      return;
    }
    const res = await apiFetch("/api/inventory/replenishment/create-transfer-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromBranchId: first.fromBranchId,
        toBranchId: first.toBranchId,
        items: selected.map((item) => ({ productId: item.productId, quantity: item.suggestedTransferQty })),
        notes: "Borrador creado desde Reposicion inteligente",
      }),
    });
    const raw = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(raw?.error?.message ?? "No se pudo crear el borrador de traslado.");
      return;
    }
    const data = unwrapApiData(raw);
    toast.success(`Borrador de traslado ${data.transferId} creado (${data.status}).`);
  }

  function toggleProduct(productId: string) {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  function toggleTransfer(key: string) {
    setSelectedTransferKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <Card noPadding>
        <div className="hm-card-header-amber">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Settings2 className="h-4 w-4" /> Reposicion inteligente</h2>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <select className="hm-input h-10 min-w-[220px]" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">Seleccionar sucursal</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>)}
            </select>
            <Button variant="primary" onClick={analyze} loading={loading} icon={<Sparkles className="h-4 w-4" />}>Analizar reposicion</Button>
            <Button variant="secondary" onClick={loadTransfers} loading={loading} icon={<Shuffle className="h-4 w-4" />}>Ver traslados sugeridos</Button>
            <Button variant="success" onClick={createPurchaseDraft} disabled={selectedProductIds.size === 0} icon={<Plus className="h-4 w-4" />}>Crear borrador de compra</Button>
            <Button variant="secondary" onClick={createTransferDraft} disabled={selectedTransferKeys.size === 0} icon={<Shuffle className="h-4 w-4" />}>Crear borrador de traslado</Button>
          </div>

          {summary ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Urgentes" value={summary.urgentCount} />
              <Kpi label="Compras sugeridas" value={summary.buyCount} />
              <Kpi label="Traslados sugeridos" value={summary.transferInCount} />
              <Kpi label="Sobrestock" value={summary.overstockCount} />
              <Kpi label="Bajo pedido" value={summary.onDemandCount} />
              <Kpi label="Revisar precio" value={summary.reviewPriceCount} />
              <Kpi label="Alta prioridad" value={summary.highCount} />
              <Kpi label="Costo compra est." value={money(summary.estimatedTotalPurchaseCost)} />
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="hm-table min-w-[1250px] w-full">
              <thead>
                <tr>
                  <th></th><th>SKU</th><th>Producto</th><th>Stock disp.</th><th>Ventas 30/90</th><th>ABC-XYZ</th><th>Punto rep.</th><th>Objetivo</th><th>Sugerido</th><th>Tipo</th><th>Prioridad</th><th>Mensaje</th>
                </tr>
              </thead>
              <tbody>
                {recommendations.map((item) => (
                  <tr key={item.productId}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedProductIds.has(item.productId)}
                        disabled={item.recommendationType !== "BUY" || item.suggestedOrderQty <= 0}
                        onChange={() => toggleProduct(item.productId)}
                      />
                    </td>
                    <td className="font-mono font-semibold">{item.sku}</td>
                    <td><div className="font-medium">{item.name}</div><div className="text-xs text-[var(--color-text-muted)]">{item.categoryName ?? "Sin categoria"}</div></td>
                    <td>{qty(item.availableStock)}</td>
                    <td>{qty(item.unitsSoldLast30Days)} / {qty(item.unitsSoldLast90Days)}</td>
                    <td><Badge variant={item.riskLevel === "CRITICAL" || item.riskLevel === "HIGH" ? "warning" : "info"}>{item.combinedClass}</Badge></td>
                    <td>{qty(item.reorderPoint)}</td>
                    <td>{qty(item.targetStock)}</td>
                    <td className="font-semibold">{qty(item.suggestedOrderQty)}</td>
                    <td>{item.recommendationType}</td>
                    <td><Badge variant={item.priority === "URGENT" ? "danger" : item.priority === "HIGH" ? "warning" : "success"}>{item.priority}</Badge></td>
                    <td className="max-w-[320px]">
                      <div>{item.message}</div>
                      {item.warnings.length > 0 ? <div className="mt-1 text-xs text-amber-700">{item.warnings[0]}</div> : null}
                    </td>
                  </tr>
                ))}
                {recommendations.length === 0 ? <tr><td colSpan={12} className="py-6 text-center text-[var(--color-text-muted)]">Ejecuta el analisis para ver recomendaciones.</td></tr> : null}
              </tbody>
            </table>
          </div>

          {transfers.length > 0 ? (
            <div className="rounded-xl border border-[var(--color-border)] p-3">
              <h3 className="mb-2 text-sm font-semibold">Traslados sugeridos</h3>
              <div className="overflow-x-auto">
                <table className="hm-table min-w-[900px] w-full">
                  <thead><tr><th></th><th>Producto</th><th>Origen</th><th>Destino</th><th>Disponible</th><th>Trasladar</th><th>Ahorro compra</th><th>Prioridad</th></tr></thead>
                  <tbody>
                    {transfers.map((item) => {
                      const key = `${item.fromBranchId}:${item.productId}`;
                      return (
                        <tr key={key}>
                          <td><input type="checkbox" checked={selectedTransferKeys.has(key)} onChange={() => toggleTransfer(key)} /></td>
                          <td><span className="font-semibold">{item.sku}</span> - {item.name}</td>
                          <td>{item.fromBranchName}</td>
                          <td>{item.toBranchName}</td>
                          <td>{qty(item.availableToTransfer)}</td>
                          <td className="font-semibold">{qty(item.suggestedTransferQty)}</td>
                          <td>{item.estimatedPurchaseCostAvoided === null ? "N/A" : money(item.estimatedPurchaseCostAvoided)}</td>
                          <td><Badge variant={item.priority === "URGENT" ? "danger" : item.priority === "HIGH" ? "warning" : "success"}>{item.priority}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      <ReorderPanel alerts={alerts} />
    </div>
  );
}

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
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /** Generate smart code from name: first 3 uppercase consonants/letters */
  function autoCode(name: string): string {
    const clean = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
    if (clean.length <= 3) return clean || "CAT";
    // Take first 3 unique-ish chars
    return clean.slice(0, 3);
  }

  async function createCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!newName.trim()) { toast.error("Nombre es obligatorio."); return; }
    const code = autoCode(newName);
    setSaving(true);
    try {
      const res = await apiFetch("/api/catalog/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: newName.trim() }),
      });
      if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.message ?? "No se pudo crear la categoría."); }
      setNewName("");
      toast.success("Categoría creada exitosamente.");
      await onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al crear categoría.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(item: Category) {
    setEditingId(item.id);
    setEditCode(item.code);
    setEditName(item.name);
  }

  async function saveEdit() {
    if (!editingId || !editCode.trim() || !editName.trim()) { toast.error("Código y nombre son obligatorios."); return; }
    setSavingEdit(true);
    try {
      const res = await apiFetch(`/api/catalog/categories/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: editCode.trim(), name: editName.trim() }),
      });
      if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.message ?? "No se pudo actualizar."); }
      toast.success("Categoría actualizada.");
      setEditingId(null);
      await onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al actualizar.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(item: Category) {
    const confirmed = window.confirm(`¿Eliminar la categoría "${item.name}"? Si tiene productos asociados se desactivará en lugar de eliminarse.`);
    if (!confirmed) return;
    setDeletingId(item.id);
    try {
      const res = await apiFetch(`/api/catalog/categories/${item.id}`, { method: "DELETE" });
      if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.message ?? "No se pudo eliminar."); }
      const result = unwrapApiData(await res.json());
      if (result.action === "DELETED") {
        toast.success("🗑️ " + result.reason);
      } else {
        toast.success("⚠️ " + result.reason);
      }
      await onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al eliminar categoría.");
    } finally {
      setDeletingId(null);
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
        <div className="flex items-center gap-2 px-4 py-3" style={{ background: "var(--color-surface-alt)", borderBottom: "0.5px solid var(--color-border)" }}>
          <Tags className="h-4 w-4" style={{ color: "var(--color-master-600)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Crear nueva categoría</h2>
        </div>
        <div className="p-4">
          <form className="flex items-end gap-3" onSubmit={createCategory}>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre de la categoría</label>
              <Input placeholder="Ej: Ferretería, Cemento, Pintura..." value={newName} onChange={(e) => setNewName(e.target.value)} required />
            </div>
            {newName.trim() ? (
              <div className="text-xs text-gray-500 pb-2">
                Código: <strong className="text-gray-800">{autoCode(newName)}</strong>
              </div>
            ) : null}
            <Button type="submit" variant="success" disabled={saving} icon={<Save className="h-4 w-4" />}>{saving ? "Creando…" : "Crear"}</Button>
          </form>
        </div>
      </Card>
      <Card noPadding>
        <div className="flex items-center gap-2 px-4 py-3" style={{ background: "var(--color-surface-alt)", borderBottom: "0.5px solid var(--color-border)" }}>
          <Tags className="h-4 w-4" style={{ color: "var(--color-master-600)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Categorías ({categories.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="hm-table min-w-[700px] w-full">
            <thead>
              <tr>
                <th className="w-28">Código</th>
                <th>Nombre</th>
                <th className="w-24">Estado</th>
                <th className="text-right w-64">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((item) => (
                <tr key={item.id}>
                  {editingId === item.id ? (
                    <>
                      <td>
                        <Input className="text-xs h-8" value={editCode} onChange={(e) => setEditCode(e.target.value)} />
                      </td>
                      <td>
                        <Input className="text-xs h-8" value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </td>
                      <td><Badge variant={item.isActive ? "success" : "warning"}>{item.isActive ? "Activo" : "Inactivo"}</Badge></td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button variant="success" size="sm" onClick={saveEdit} disabled={savingEdit} icon={<Check className="h-3.5 w-3.5" />}>
                            {savingEdit ? "..." : "Guardar"}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} icon={<X className="h-3.5 w-3.5" />}>Cancelar</Button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="font-mono text-xs font-semibold">{item.code}</td>
                      <td>{item.name}</td>
                      <td><Badge variant={item.isActive ? "success" : "warning"}>{item.isActive ? "Activo" : "Inactivo"}</Badge></td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(item)} icon={<Pencil className="h-3.5 w-3.5" />}>Editar</Button>
                          <Button variant={item.isActive ? "secondary" : "success"} size="sm" onClick={() => toggleActive(item)} icon={item.isActive ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}>
                            {item.isActive ? "Archivar" : "Activar"}
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => handleDelete(item)} disabled={deletingId === item.id} icon={<Trash2 className="h-3.5 w-3.5" />}>
                            {deletingId === item.id ? "..." : "Eliminar"}
                          </Button>
                        </div>
                      </td>
                    </>
                  )}
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
