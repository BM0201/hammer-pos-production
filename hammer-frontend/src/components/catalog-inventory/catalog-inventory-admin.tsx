"use client";

import Link from "next/link";
import type { Route } from "next";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle, BarChart3, Boxes, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  CheckCircle2, Copy, DollarSign, Download, FileSpreadsheet, FileUp, History, Info, Loader2, Merge, Package, Pencil,
  Plus, RefreshCcw, Save, ScanLine, Search, Settings2, Shuffle, Sparkles, Tags, Trash2,
  TrendingUp, Wand2, X, Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, qty, fmtDateTime } from "@/lib/format";
import { tokenize } from "@/lib/product-search";
import { formatSharedStock } from "@/lib/inventory/shared-stock-format";
import { UNDO_WINDOW_MS, type BarcodeKind } from "@/lib/barcode-manager-logic";
import { useInventoryScope } from "@/hooks/use-inventory-scope";
import { ProductEditDrawer } from "./product-edit-drawer";
import { normalizePresentationUnit } from "@/lib/inventory/presentation-units";
import { UnitPicker } from "@/components/inventory/unit-picker";

// Fase 5 (prompt-flujo-velocidad.md): FusionPricingPanel solo se monta con
// la pestaña "fusion" activa (línea ~1568) — carga diferida para que su
// bundle no viaje con el resto de esta página (4400+ líneas) en cada visita
// a catalog-inventory, aunque el usuario nunca abra esa pestaña. ssr:false
// porque el panel arma su propio estado del lado del cliente (fetch propio),
// no hay contenido que valga la pena renderizar en el servidor.
const FusionPricingPanel = dynamic(
  () => import("@/components/catalog-inventory/fusion-pricing-panel").then((m) => m.FusionPricingPanel),
  { ssr: false, loading: () => <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">Cargando…</p> },
);
// Mismo criterio para el resto de las pestañas pesadas de esta página:
// cada una solo se monta cuando el usuario la abre.
const CategoriesPanel = dynamic(() => import("@/components/catalog-inventory/categories-panel").then((m) => m.CategoriesPanel), { ssr: false });
const UnifiedImportPanel = dynamic(() => import("@/components/catalog-inventory/unified-import-panel").then((m) => m.UnifiedImportPanel), { ssr: false });
const MovementsPanel = dynamic(() => import("@/components/catalog-inventory/movements-panel").then((m) => m.MovementsPanel), { ssr: false });
const TransfersPanel = dynamic(() => import("@/components/catalog-inventory/transfers-panel").then((m) => m.TransfersPanel), { ssr: false });
const ReplenishmentPanel = dynamic(() => import("@/components/catalog-inventory/replenishment-panel").then((m) => m.ReplenishmentPanel), { ssr: false });
const AuditPanel = dynamic(() => import("@/components/catalog-inventory/audit-panel").then((m) => m.AuditPanel), { ssr: false });
const DuplicatesPanel = dynamic(() => import("@/components/catalog-inventory/duplicates-panel").then((m) => m.DuplicatesPanel), { ssr: false });

/* ───────────────────────── Types ───────────────────────── */
export type Branch = { id: string; code: string; name: string };
export type Category = { id: string; code: string; name: string; isActive: boolean };
export type ProductRow = {
  id: string;
  sku: string;
  barcode?: string | null;
  // prompt-codigos-y-duplicados.md Fase 2 — todos los códigos del producto
  // (principal + secundarios), para el chip "+N códigos" de la fila.
  barcodes?: string[];
  name: string;
  unit: string;
  isActive: boolean;
  /** Renombrado desde baseCost (docs/COSTO-UNA-FUENTE.md) — null cuando
   * costScope es "NETWORK" (sin sucursal elegida), nunca 0 de relleno. */
  effectiveCost: number | null;
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
  /**
   * prompt-precios-costos-una-sola-fuente.md — el mismo motor que usa la
   * venta (branchCost > WAC > averageCost > globalCost > lastPurchaseCost,
   * fusión-aware), UNA fila por sucursal activa — nunca recalculado en el
   * navegador (la cascada de red sin branchCost era la causa del margen
   * que no cuadraba).
   */
  branchEffectivePricing?: Array<{
    branchId: string;
    effectiveCost: number | null;
    costSource: "BRANCH" | "GLOBAL_AVERAGE" | "GLOBAL" | "LAST_PURCHASE" | "WAC_ESTIMATE" | "NONE";
    effectivePrice: number | null;
    priceSource: "BRANCH" | "STANDARD" | "MISSING" | "FUSION_DERIVED";
    branchCost: number | null;
    branchPrice: number | null;
    isFusionMember: boolean;
    sellability: "OK" | "BELOW_COST" | "NO_COST";
  }>;
};
export type Movement = {
  id: string;
  createdAt: string;
  movementType: string;
  quantity: string;
  unitCost: string;
  referenceType: string;
  referenceId: string;
  notes?: string | null;
  reason?: string | null;
  inputUnit?: string | null;
  inputQuantity?: string | null;
  baseUnit?: string | null;
  userName?: string | null;
  product: { id: string; sku: string; name: string };
  branch: Branch;
  /** Fase 3 (prompt-entrada-inventario.md) — solo cuando referenceType es MULTI_BRANCH_INTAKE. */
  intakeDocument?: { code: string; kind: string } | null;
};
export type Transfer = {
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
export type ReorderAlert = { id: string; reason: string; alertType: string; currentQuantity: string; suggestedQuantity: string; product: { sku: string; name: string }; branch: Branch };
export type AuditRow = { id: string; occurredAt: string; module: string; action: string; entityType: string; actor?: { username: string; fullName: string } | null; branch?: Branch | null };
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
export type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
export type CenterData = {
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
    missingPriceCount: number;
  };
  /**
   * docs/COSTO-UNA-FUENTE.md — alcance de effectiveCost/hasNoCost en
   * products[]. "BRANCH": hay sucursal en contexto, costBranchId/
   * costBranchName la identifican. "NETWORK": no hay ninguna elegida —
   * effectiveCost/hasNoCost de cada fila no reflejan ninguna sucursal en
   * particular (nunca un promedio), la interfaz debe anunciarlo, no
   * mostrar un número como si fuera "el" costo.
   */
  costScope: "BRANCH" | "NETWORK";
  costBranchId: string | null;
  costBranchName: string | null;
  products: ProductRow[];
  balances: ProductRow["inventoryBalances"];
  movements: Movement[];
  transfers: Transfer[];
  reorderAlerts: ReorderAlert[];
  auditLogs: AuditRow[];
  pagination?: Pagination;
};

type Tab = "summary" | "products" | "categories" | "import" | "stock" | "kardex" | "intakes" | "counts" | "fusion" | "transfers" | "reorder" | "duplicates" | "audit";

const TABS: Array<{ id: Tab; label: string; icon: typeof BarChart3 }> = [
  { id: "summary", label: "Resumen", icon: BarChart3 },
  { id: "products", label: "Productos", icon: Package },
  { id: "categories", label: "Categorías", icon: Tags },
  { id: "import", label: "Importar", icon: FileUp },
  { id: "stock", label: "Existencias", icon: Boxes },
  // prompt-inventario-unificado.md Commit 1 — antes una sola pestaña
  // "movements" con Kardex/Entradas como sub-pestañas internas (y
  // "Conteos" sin ningún lugar propio); ahora 3 URLs reales, una por
  // subsección de la barra superior.
  { id: "kardex", label: "Kardex", icon: History },
  { id: "intakes", label: "Entradas", icon: History },
  { id: "counts", label: "Conteos", icon: History },
  // "Precios y costos" (tab=pricing) se retiró: era una pestaña sin lugar en
  // la barra, con un buscador que solo filtraba los 50 productos cargados.
  // Precio/costo por producto → perfil (Precios y costos); en lote → zona
  // Precios. Los links viejos se redirigen (RETIRED_PRICING_TAB_HREF).
  // "Ese apartado de Fusiones, es para poner el precio, no es otra
  // pestaña para crear" — a diferencia de Fusión de Inventario (crear
  // fusiones, editar presentaciones/factores — sigue en su propia
  // pantalla, enlazada desde acá), esta pestaña hace UNA sola cosa: poner
  // el costo global de cada presentación (FusionPricingPanel), sin WAC de
  // por medio, para que corregir ese número no exija saltar de pantalla.
  { id: "fusion", label: "Fusiones", icon: Merge },
  { id: "transfers", label: "Transferencias", icon: Shuffle },
  { id: "reorder", label: "Reposicion", icon: Settings2 },
  // prompt-codigos-y-duplicados.md Fase 4 — distinta de Fusiones (arriba):
  // esto sugiere que DOS PRODUCTOS DISTINTOS son el mismo (error de alta),
  // Fusiones es UN producto con varias presentaciones (factor real).
  { id: "duplicates", label: "Duplicados", icon: Copy },
  { id: "audit", label: "Auditoria", icon: BarChart3 },
];

/** Destino de los links viejos a ?tab=pricing — la edición de precios en lote vive en la zona Precios. */
const RETIRED_PRICING_TAB_HREF = "/app/master/pricing?tab=current";

/** La URL es la única fuente de la pestaña; `movements` (links viejos) cae en Kardex, igual que en la barra. */
function resolveTab(raw: string | null): Tab {
  if (raw === "movements") return "kardex";
  return TABS.some((t) => t.id === raw) ? (raw as Tab) : "summary";
}

const FILTERS = [
  { value: "", label: "Todos" },
  { value: "LOW_STOCK", label: "Stock bajo" },
  { value: "ZERO_STOCK", label: "Stock cero" },
  { value: "NEGATIVE_STOCK", label: "Stock negativo" },
  { value: "NO_COST", label: "Sin costo" },
  { value: "NO_PRICE", label: "Sin precio" },
  // prompt-codigos-y-duplicados.md Fase 2 — producto sin ningún código de
  // barras (ni principal ni secundario). Mismo mecanismo que el resto de
  // estos filtros (?filter=, computado en memoria del lado del servidor).
  { value: "NO_CODE", label: "Sin código" },
];


function statusFor(total: number) {
  if (total < 0) return { label: "Negativo", variant: "danger" as const };
  if (total === 0) return { label: "Cero", variant: "warning" as const };
  if (total <= 1) return { label: "Critico", variant: "warning" as const };
  return { label: "OK", variant: "success" as const };
}

export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function marginBadgeVariant(value: number | null) {
  if (value === null) return "neutral" as const;
  if (value < 0) return "danger" as const;
  if (value < 20) return "warning" as const;
  return "success" as const;
}

/**
 * docs/COSTO-UNA-FUENTE.md, ciclo de blindaje, C.1 — "—" siempre que no
 * hay un número real que mostrar, sea porque costScope es NETWORK (nadie
 * eligió sucursal) o porque, con sucursal elegida, este producto
 * específico no tiene costo/precio resuelto. El guion es deliberado:
 * "N/D" suena a error de datos, "—" es "no aplica sin sucursal".
 */
function formatCostOrDash(value: number | null) {
  return value === null ? "—" : money(value);
}

function formatMarginOrDash(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

/** Precio y margen efectivos de un producto para la sucursal en contexto
 * (costScope=BRANCH) — deriva de branchEffectivePricing (ya calculado por
 * el backend, getEffectiveProductPricingBatch), nunca recalculado acá.
 * effectiveCost vive aparte, a nivel de fila (product.effectiveCost),
 * para la misma sucursal. */
function effectivePriceAndMargin(product: ProductRow, costBranchId: string | null): { price: number | null; margin: number | null } {
  if (!costBranchId) return { price: null, margin: null };
  const entry = product.branchEffectivePricing?.find((item) => item.branchId === costBranchId);
  const price = entry?.effectivePrice ?? null;
  const cost = product.effectiveCost;
  const margin = cost !== null && cost > 0 && price !== null && price > 0 ? ((price - cost) / price) * 100 : null;
  return { price, margin };
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
  const router = useRouter();
  const pathname = usePathname();
  const scope = useInventoryScope();
  const [data, setData] = useState<CenterData | null>(null);
  // La pestaña sale SIEMPRE de la URL: un setTab interno dejaba la barra
  // marcando otra sección, rompía "Atrás" y volver a tocar la misma
  // píldora no hacía nada (la URL no cambiaba).
  const tab = resolveTab(searchParams.get("tab"));
  const isRetiredPricingTab = searchParams.get("tab") === "pricing";
  useEffect(() => {
    if (isRetiredPricingTab) router.replace(RETIRED_PRICING_TAB_HREF as Route);
  }, [isRetiredPricingTab, router]);
  const urlFilter = searchParams.get("filter") ?? "";
  function goTab(next: Tab, nextFilter?: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    if (nextFilter) params.set("filter", nextFilter);
    else params.delete("filter");
    router.push(`${pathname}?${params}` as Route);
  }
  // El texto de búsqueda llega de la barra superior ("Ver los N resultados
  // en la lista" → ?q=) — esta pantalla ya no tiene buscador propio.
  const q = searchParams.get("q") ?? "";
  function clearSearch() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    router.push(`${pathname}?${params}` as Route);
  }
  // prompt-inventario-unificado.md Commit 1 §4 — ya no hay <select> de
  // sucursal propio acá: lo da la barra (useInventoryScope). `branchId` es
  // la sucursal concreta que necesitan Kardex y Reposición; la carga del
  // centro en "Toda la red" va SIN sucursal (stock de toda la red, costos "—").
  const branchId = (scope.mode === "branch" ? scope.branchId : scope.branches[0]?.id) ?? "";
  const loadBranchId = scope.mode === "branch" ? branchId : "";
  const [categoryId, setCategoryId] = useState("");
  // Pendientes (Calidad) llega con ?filter=NO_COST ya en la URL.
  const [filter, setFilter] = useState(urlFilter);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [stockSearch, setStockSearch] = useState("");

  // Al cambiar de pestaña o de filtro en la URL, el filtro vuelve a ser el
  // de la URL y la página a 1 — antes "Pendientes → Lista" seguía filtrando
  // sin código aunque la barra dijera "Lista".
  useEffect(() => {
    setFilter(urlFilter);
    setPage(1);
  }, [tab, urlFilter, q]);

  /* ── Panel de edición (ProductEditDrawer) ── */
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [movementDialog, setMovementDialog] = useState<"adjustment" | "opening" | null>(null);

  /* prompt-codigos-editar-eliminar.md Fase 3.3 — menú rápido del chip de
     código en la fila (Editar / Quitar / Ir a Códigos). "Quitar" es la única
     acción realmente en línea (consulta el código principal al vuelo y lo
     borra con deshacer); "Editar" navega a la ficha con el editor ya abierto
     — reutiliza el formulario completo en vez de duplicar la UI de edición
     dentro de esta tabla densa. */
  const [codeMenuProductId, setCodeMenuProductId] = useState<string | null>(null);
  const [codeMenuConfirmId, setCodeMenuConfirmId] = useState<string | null>(null);
  const [codeMenuBusyId, setCodeMenuBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (loadBranchId) params.set("branchId", loadBranchId);
    if (categoryId) params.set("categoryId", categoryId);
    if (filter) params.set("filter", filter);
    params.set("page", String(page));
    params.set("limit", "50");
    const response = await fetch(`/api/master/catalog-inventory?${params}`, { cache: "no-store" });
    const raw = await response.json();
    if (!response.ok) throw new Error(raw.message ?? "No se pudo cargar Catalogo e Inventario.");
    setData(unwrapApiData(raw));
    setLoading(false);
  }, [loadBranchId, categoryId, filter, q, page]);

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


  async function removePrimaryBarcodeQuick(product: ProductRow) {
    setCodeMenuBusyId(product.id);
    try {
      const listRes = await apiFetch(`/api/catalog/products/${product.id}/barcodes`);
      const listRaw = await listRes.json().catch(() => null);
      if (!listRes.ok) throw new Error(listRaw?.error?.message ?? "No se pudieron cargar los códigos.");
      const rows = unwrapApiData(listRaw) as Array<{ id: string; isPrimary: boolean }>;
      const primary = rows.find((r) => r.isPrimary) ?? rows[0];
      if (!primary) { toast.error("Este producto ya no tiene códigos."); return; }

      const delRes = await apiFetch(`/api/catalog/products/${product.id}/barcodes/${primary.id}`, { method: "DELETE" });
      const delRaw = await delRes.json().catch(() => null);
      if (!delRes.ok) throw new Error(delRaw?.error?.message ?? "No se pudo quitar el código.");
      const { removed } = unwrapApiData(delRaw) as { removed: { code: string; kind: BarcodeKind; wasPrimary: boolean } };

      toast((t) => (
        <span className="flex items-center gap-3">
          Código {removed.code} quitado.
          <button
            type="button"
            className="font-semibold text-[var(--color-info-600)] hover:underline"
            onClick={async () => {
              toast.dismiss(t.id);
              try {
                const restoreRes = await apiFetch(`/api/catalog/products/${product.id}/barcodes/restore`, {
                  method: "POST",
                  body: JSON.stringify({ code: removed.code, kind: removed.kind, makePrimary: removed.wasPrimary }),
                });
                if (!restoreRes.ok) throw new Error();
                toast.success("Código restaurado.");
                await load();
              } catch {
                toast.error("No se pudo deshacer — es posible que otro usuario ya haya tomado ese código.");
              }
            }}
          >
            Deshacer
          </button>
        </span>
      ), { duration: UNDO_WINDOW_MS });

      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo quitar el código.");
    } finally {
      setCodeMenuBusyId(null);
      setCodeMenuConfirmId(null);
      setCodeMenuProductId(null);
    }
  }

  /* ── Estado para creación manual de producto ── */
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "",
    sku: "",
    categoryId: "",
    unit: "UNIDAD",
    standardSalePrice: "",
    description: "",
    allowsFraction: false,
  });
  const [presentation, setPresentation] = useState<{ enabled: boolean; base: { id: string; sku: string; name: string; unit: string } | null; factor: string }>({ enabled: false, base: null, factor: "" });
  const [baseSearch, setBaseSearch] = useState("");
  const [baseResults, setBaseResults] = useState<Array<{ id: string; sku: string; name: string; unit: string }>>([]);
  // Busca en el servidor (no en la página de 50 cargada) — mismo endpoint que el asistente de fusión.
  useEffect(() => {
    const term = baseSearch.trim();
    if (!term) { setBaseResults([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiFetch(`/api/catalog/products?isActive=true&limit=20&q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((raw) => {
          const list = unwrapApiData(raw);
          setBaseResults(Array.isArray(list) ? list.map((p: { id: string; sku: string; name: string; unit: string }) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit })) : []);
        })
        .catch(() => {});
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [baseSearch]);
  const [creating, setCreating] = useState(false);
  const [skuPreview, setSkuPreview] = useState("");
  const [skuStatus, setSkuStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const skuCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (!newProduct.unit.trim()) {
      toast.error("Indicá por qué unidad se vende (UNIDAD, QUINTAL, METRO…).");
      return;
    }
    if (presentation.enabled) {
      if (!presentation.base) { toast.error("Elegí el producto del que este es otra presentación."); return; }
      if (!(Number(presentation.factor) > 0)) { toast.error(`Indicá cuántas ${presentation.base.unit} trae 1 ${newProduct.unit.toUpperCase()}.`); return; }
      if (normalizePresentationUnit(newProduct.unit) === normalizePresentationUnit(presentation.base.unit)) {
        toast.error(`Las dos presentaciones no pueden venderse por la misma unidad (${presentation.base.unit}).`);
        return;
      }
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
          unit: newProduct.unit.trim(),
          standardSalePrice: Number(newProduct.standardSalePrice),
          description: newProduct.description.trim() || undefined,
          allowsFraction: newProduct.allowsFraction,
          presentationOf: presentation.enabled && presentation.base
            ? { baseProductId: presentation.base.id, saleUnit: newProduct.unit.trim(), factor: Number(presentation.factor) }
            : undefined,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? body?.message ?? "No se pudo crear el producto.");
      }
      toast.success(presentation.enabled ? "Producto creado y fusionado como presentación." : "Producto creado exitosamente.");
      setNewProduct({ name: "", sku: "", categoryId: "", unit: "UNIDAD", standardSalePrice: "", description: "", allowsFraction: false });
      setPresentation({ enabled: false, base: null, factor: "" });
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

  // docs/COSTO-UNA-FUENTE.md, C.3 — código de la sucursal en contexto de
  // costo, para el encabezado "Costo · RIV" (data.costBranchName ya viene
  // del backend, pero el código — más corto, el mismo criterio que
  // "PRECIO DE VENTA · RIV" en Precios y costos — solo vive en branches[]).
  const costBranchCode = data?.costBranchId ? data.branches.find((branch) => branch.id === data.costBranchId)?.code ?? null : null;

  const matrix = useMemo(() => {
    const branches = data?.branches ?? [];
    const tokens = tokenize(stockSearch);
    const products = tokens.length > 0
      ? (data?.products ?? []).filter((p) => {
          const text = `${p.name} ${p.sku}`.toUpperCase();
          return tokens.every((token) => text.includes(token));
        })
      : (data?.products ?? []);
    return products.map((product) => {
      // allSharedInventoryBalances trae TODAS las sucursales (inventoryBalances
      // viene filtrado por la sucursal de la barra — por eso el resto salía
      // en 0) y, en una fusión, el saldo del canónico en unidad base: se
      // divide por el factor para mostrarlo en la unidad de este producto.
      const factor = Number(product.stockConversion?.conversionFactor) || 1;
      const byBranch = new Map((product.allSharedInventoryBalances ?? []).map((balance) => [balance.branchId, (Number(balance.quantityOnHand) || 0) / factor]));
      return { product, branches: branches.map((branch) => ({ branch, quantity: byBranch.get(branch.id) ?? 0 })) };
    });
  }, [data, stockSearch]);

  return (
    <section className="space-y-5">
      {/* ── Filtros ── el título, la sucursal y el buscador los da la barra
          superior (InventoryTopbar); acá queda solo la categoría y, si se
          llegó desde "Ver los N resultados", el texto buscado con su ✕.
          Cada control en su propio contenedor de ancho fijo: .hm-input
          declara width:100% y sin eso ocupaba la fila entera. */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-[170px]">
          <label htmlFor="cat-category" className="mb-1 block text-xs" style={{ color: "var(--color-text-muted)" }}>Categoría</label>
          <select id="cat-category" className="hm-input h-10" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}>
            <option value="">Todas las categorías</option>
            {data?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </div>
        {q.trim() ? (
          <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--color-master-300)] bg-[var(--color-master-50)] pl-3 pr-1 text-sm text-[var(--color-master-700)]">
            <Search className="h-3.5 w-3.5" />
            Resultados para «{q.trim()}»
            <button type="button" onClick={clearSearch} aria-label="Quitar búsqueda" className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--color-master-100)]">
              <X className="h-4 w-4" />
            </button>
          </span>
        ) : null}
      </div>

      {/* docs/COSTO-UNA-FUENTE.md, C.2 — una línea de texto, no una alerta
          ámbar: sin sucursal elegida es el estado normal de esta vista, no
          un error. */}
      {data && data.costScope === "NETWORK" ? (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Mostrando existencias de todas las sucursales. Los costos y precios dependen de la sucursal — elegí una para verlos.
        </p>
      ) : null}

      {loading || !data ? <Card className="p-4 text-sm text-[var(--color-text-muted)]">Cargando centro de catalogo e inventario...</Card> : null}

      {/* ════════════ TAB: RESUMEN ════════════ */}
      {data && tab === "summary" ? (
        <div className="space-y-5">
          <InventorySummary
            kpis={data.kpis}
            onNavigate={(t, f) => goTab(t, f)}
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
        {/* prompt-alta-productos-qr.md Fase 2 — alta en serie con lector
            USB/Bluetooth (escribe el código como teclado + Enter): pantalla
            aparte porque el flujo es secuencial (código → ¿existe? →
            guardar → siguiente código), no encaja en este formulario de un
            solo producto a la vez. */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={"/app/master/catalog/products/quick-add" as Route}
            className="inline-flex items-center gap-2 self-start rounded-lg border border-[var(--color-master-300)] bg-[var(--color-master-50)] px-4 py-2 text-sm font-semibold text-[var(--color-master-700)] hover:bg-[var(--color-master-100)]"
          >
            <ScanLine className="h-4 w-4" />
            Escanear productos
          </Link>
          {/* prompt-codigos-y-duplicados.md Fase 2 — mismo patrón que
              onlyMissing/onToggleOnlyMissing de PricingPanel (NO_BRANCH_PRICE):
              un toggle en la pestaña donde realmente importa, no otro valor
              más perdido en el select genérico de la pestaña Existencias. */}
          <Button
            variant={filter === "NO_CODE" ? "primary" : "secondary"}
            size="sm"
            onClick={() => { setFilter((prev) => (prev === "NO_CODE" ? "" : "NO_CODE")); setPage(1); }}
          >
            {filter === "NO_CODE" ? "Mostrando: sin código" : "Sin código"}
          </Button>
        </div>
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
                  <p className="block text-xs font-bold text-[var(--color-text-secondary)] mb-1">Se vende por *</p>
                  <UnitPicker value={newProduct.unit} onChange={(unit) => setNewProduct({ ...newProduct, unit })} label="Se vende por" />
                </div>
                <Input
                  label="Precio inicial (sucursal principal) *"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={newProduct.standardSalePrice}
                  onChange={(e) => setNewProduct({ ...newProduct, standardSalePrice: e.target.value })}
                  placeholder="Ej: 350.00"
                  hint="Este valor se usa solo para prellenar el precio en la sucursal donde crees el producto. Cada sucursal puede tener su propio precio en Precios y costos."
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
              {/* Nace fusionado: el producto nuevo es otra forma de vender un
                  producto que ya existe (el QUINTAL de una VARILLA) y comparte
                  su inventario — antes había que crearlo suelto y armar la
                  fusión aparte en Presentaciones. */}
              <div className="space-y-2.5 rounded-lg border border-[var(--color-border)] p-3">
                <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300"
                    checked={presentation.enabled}
                    onChange={(e) => setPresentation({ ...presentation, enabled: e.target.checked })}
                  />
                  Es otra presentación de un producto que ya existe (ej. el QUINTAL de una VARILLA)
                </label>
                {presentation.enabled && (
                  <>
                    {presentation.base ? (
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-surface-alt)] px-3 py-2 text-sm">
                        <span><span className="font-mono text-xs text-[var(--color-text-muted)]">{presentation.base.sku}</span> {presentation.base.name} <span className="text-[var(--color-text-muted)]">· se vende por {presentation.base.unit}</span></span>
                        <button type="button" className="text-xs font-semibold text-[var(--color-info-600)] hover:underline" onClick={() => setPresentation({ ...presentation, base: null })}>Cambiar</button>
                      </div>
                    ) : (
                      <div className="relative">
                        <input
                          className="hm-input w-full"
                          value={baseSearch}
                          onChange={(e) => setBaseSearch(e.target.value)}
                          placeholder="Buscar el producto que ya existe (SKU o nombre)…"
                          aria-label="Producto que ya existe"
                        />
                        {baseResults.length > 0 && (
                          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-lg">
                            {baseResults.map((p) => (
                              <button
                                type="button"
                                key={p.id}
                                onClick={() => { setPresentation({ ...presentation, base: p }); setBaseSearch(""); setBaseResults([]); }}
                                className="flex w-full items-center gap-2 border-b border-[var(--color-border)] px-2.5 py-2 text-left text-xs last:border-b-0 hover:bg-[var(--color-surface-alt)]"
                              >
                                <span className="min-w-[4.5rem] font-mono text-[var(--color-text-muted)]">{p.sku}</span>
                                <span className="flex-1 truncate">{p.name}</span>
                                <span className="text-[var(--color-text-soft)]">{p.unit}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <label className="flex flex-wrap items-center gap-1.5 text-sm">
                      1 <b>{newProduct.unit.trim().toUpperCase() || "…"}</b> =
                      <input
                        type="number"
                        min="0"
                        step="any"
                        className="hm-input h-8 w-24 text-right"
                        value={presentation.factor}
                        onChange={(e) => setPresentation({ ...presentation, factor: e.target.value })}
                        aria-label="Cuántas unidades del producto base trae"
                      />
                      <b>{presentation.base?.unit ?? "…"}</b>
                    </label>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Nace sin stock propio: se vende descontando del inventario de {presentation.base?.name ?? "ese producto"}.
                    </p>
                  </>
                )}
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
                  <th>SKU</th><th>Producto</th><th>Categoria</th><th>Unidad principal</th><th>Stock resumen</th>
                  {/* docs/COSTO-UNA-FUENTE.md, C.1/C.3 — con sucursal elegida, el
                      encabezado la nombra (igual que "PRECIO DE VENTA · RIV" en
                      Precios y costos); sin ninguna, un ícono con tooltip explica
                      por qué la columna está vacía en vez de dejarlo sin decir. */}
                  <th title={data.costScope === "NETWORK" ? "Elegí una sucursal para ver costos y precios" : undefined}>
                    Costo{data.costScope === "BRANCH" && costBranchCode ? ` · ${costBranchCode}` : ""}
                    {data.costScope === "NETWORK" ? (
                      <Info className="ml-1 inline h-3 w-3 align-text-top" style={{ color: "var(--color-text-muted)" }} />
                    ) : null}
                  </th>
                  <th title={data.costScope === "NETWORK" ? "Elegí una sucursal para ver costos y precios" : undefined}>
                    Precio{data.costScope === "BRANCH" && costBranchCode ? ` · ${costBranchCode}` : ""}
                    {data.costScope === "NETWORK" ? (
                      <Info className="ml-1 inline h-3 w-3 align-text-top" style={{ color: "var(--color-text-muted)" }} />
                    ) : null}
                  </th>
                  <th>Margen</th>
                  <th>Estado</th><th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((product) => {
                  const sharedStock = formatSharedStock(product);
                  const { price: rowEffectivePrice, margin: rowMarginPercent } = effectivePriceAndMargin(product, data.costBranchId);
                  return (
                  <tr key={product.id}>
                    <td>
                      <span className="font-semibold">{product.sku}</span>
                      {/* prompt-codigos-y-duplicados.md Fase 2 — no se agrega
                          el código al editor inline (editDraft no lo toca):
                          se gestiona desde la ficha, donde el historial y el
                          chequeo de duplicados tienen contexto completo. */}
                      <div className="relative mt-1 flex items-center gap-1.5 text-[0.68rem]">
                        <button
                          type="button"
                          onClick={() => { setCodeMenuProductId((id) => (id === product.id ? null : product.id)); setCodeMenuConfirmId(null); }}
                          className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-alt)]"
                        >
                          {product.barcode ? (
                            <>
                              {product.barcode}
                              {(product.barcodes?.length ?? 0) > 1 && ` +${(product.barcodes?.length ?? 1) - 1}`}
                            </>
                          ) : (
                            "Sin código"
                          )}
                        </button>
                        <Link
                          href={`/app/master/catalog-inventory/products/${product.id}?tab=barcodes` as Route}
                          className="font-medium text-[var(--color-info-600)] hover:underline"
                        >
                          Códigos…
                        </Link>

                        {codeMenuProductId === product.id && (
                          <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-xl">
                            {product.barcode ? (
                              <>
                                <Link
                                  href={`/app/master/catalog-inventory/products/${product.id}?tab=barcodes&editPrimary=1` as Route}
                                  onClick={() => setCodeMenuProductId(null)}
                                  className="flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-surface-alt)]"
                                >
                                  <Pencil className="h-3 w-3" /> Editar
                                </Link>
                                {codeMenuConfirmId === product.id ? (
                                  <div className="px-3 py-2">
                                    <p className="mb-1.5 text-[var(--color-text-muted)]">¿Quitar {product.barcode}?</p>
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        disabled={codeMenuBusyId === product.id}
                                        onClick={() => void removePrimaryBarcodeQuick(product)}
                                        className="font-semibold text-[var(--color-danger-600)] hover:underline disabled:opacity-50"
                                      >
                                        {codeMenuBusyId === product.id ? "Quitando…" : "Sí, quitar"}
                                      </button>
                                      <button type="button" onClick={() => setCodeMenuConfirmId(null)} className="text-[var(--color-text-muted)] hover:underline">
                                        Cancelar
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setCodeMenuConfirmId(product.id)}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--color-danger-600)] hover:bg-[var(--color-danger-50)]"
                                  >
                                    <Trash2 className="h-3 w-3" /> Quitar
                                  </button>
                                )}
                              </>
                            ) : null}
                            <Link
                              href={`/app/master/catalog-inventory/products/${product.id}?tab=barcodes` as Route}
                              onClick={() => setCodeMenuProductId(null)}
                              className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--color-surface-alt)]"
                            >
                              <ScanLine className="h-3 w-3" /> Ir a Códigos
                            </Link>
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      {product.name}
                    </td>
                    <td>
                      {product.category?.name ?? "Sin categoria"}
                    </td>
                    <td>
                      {product.stockConversion?.saleUnit ?? product.unit}
                    </td>
                    <td>
                      <div>{sharedStock?.primary ?? qty(product.totalStock)}</div>
                      {sharedStock ? (
                        <div className="mt-1 space-y-1 text-[0.65rem] text-[var(--color-text-muted)]">
                          <div>{sharedStock.secondary}</div>
                          <div className="inline-flex rounded border border-[var(--color-border)] px-1.5 py-0.5 font-medium">
                            {sharedStock.chip}
                          </div>
                        </div>
                      ) : null}
                    </td>
                    <td className="font-mono text-xs">{formatCostOrDash(product.effectiveCost)}</td>
                    <td className="font-mono text-xs">{formatCostOrDash(rowEffectivePrice)}</td>
                    <td><Badge variant={marginBadgeVariant(rowMarginPercent)}>{formatMarginOrDash(rowMarginPercent)}</Badge></td>
                    <td><Badge variant={product.isActive ? "success" : "warning"}>{product.isActive ? "Activo" : "Inactivo"}</Badge></td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <>
                          <Button variant="secondary" size="sm" onClick={() => setEditingProductId(product.id)} icon={<Pencil className="h-3.5 w-3.5" />}>Editar</Button>
                          <Link href={`/app/master/catalog-inventory/products/${product.id}` as Route} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--color-border)] px-2 text-xs font-medium hover:bg-[var(--color-surface-alt)]">
                            <Search className="h-3 w-3" /> Ver
                          </Link>
                          <Link href={`/app/master/catalog-inventory/products/${product.id}?tab=pricing` as Route} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium hover:bg-[var(--color-surface-alt)]">
                            <DollarSign className="h-3.5 w-3.5" /> Precio
                          </Link>
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
                    </div>
                    </td>
                  </tr>
                  );
                })}
                {data.products.length === 0 ? <tr><td colSpan={10} className="text-center py-6 text-[var(--color-text-muted)]">No hay productos que coincidan con los filtros.</td></tr> : null}
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
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--color-text-muted)" }} />
                <input
                  className="hm-input h-9 pl-8"
                  style={{ minWidth: "200px" }}
                  placeholder="Filtrar en esta página..."
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                />
              </div>
              <select className="hm-input h-9" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}>
                {FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <Button variant="primary" onClick={() => { setMovementDialog("adjustment"); goTab("kardex"); }} icon={<Plus className="h-4 w-4" />}>Ajuste manual</Button>
              <Button variant="success" onClick={() => { setMovementDialog("opening"); goTab("intakes"); }} icon={<Package className="h-4 w-4" />}>Carga inicial</Button>
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
          {data.pagination && <PaginationBar pagination={data.pagination} onPageChange={setPage} />}
        </Card>
      ) : null}

      {data && (tab === "kardex" || tab === "intakes" || tab === "counts") ? (
        <MovementsPanel view={tab} branches={data.branches} products={data.products} movements={data.movements} selectedBranchId={branchId} initialDialog={movementDialog} onInitialDialogHandled={() => setMovementDialog(null)} onSelectBranch={(nextBranchId) => scope.setScope({ mode: "branch", branchId: nextBranchId })} onDone={load} />
      ) : null}
      {/* "Ese apartado de Fusiones, es para poner el precio, no es otra
          pestaña para crear" — FusionPricingPanel es autónomo (carga sus
          propios grupos vía /api/inventory/stock-groups) y hace SOLO eso:
          poner el costo global de cada presentación. Crear fusiones o
          editar su estructura sigue en Fusión de Inventario, enlazada
          desde el propio panel — no se movió acá. */}
      {tab === "fusion" ? <FusionPricingPanel /> : null}
      {data && tab === "transfers" ? <TransfersPanel branches={data.branches} /> : null}
      {data && tab === "reorder" ? <ReplenishmentPanel branches={data.branches} selectedBranchId={branchId} /> : null}
      {data && tab === "duplicates" ? <DuplicatesPanel onMerged={() => void load()} /> : null}
      {data && tab === "audit" ? <AuditPanel logs={data.auditLogs} /> : null}

      {(() => {
        const editingProduct = editingProductId ? data?.products.find((p) => p.id === editingProductId) : undefined;
        return editingProduct && data ? (
          <ProductEditDrawer
            product={{ ...editingProduct, hasHistory: editingProduct.totalStock !== 0 || editingProduct.inventoryBalances.length > 0 }}
            categories={data.categories}
            onClose={() => setEditingProductId(null)}
            onSaved={() => { setEditingProductId(null); void load(); }}
          />
        ) : null;
      })()}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   KPI card
   ═══════════════════════════════════════════════════════════ */
export function Kpi({ label, value }: { label: string; value: string | number }) {
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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

      {/* ── Análisis financiero MOVIDO a Finanzas & Contabilidad ──
          Inventario solo muestra stock/costo/disponibilidad. La venta potencial,
          ganancia bruta potencial y margen viven ahora en Finanzas (fuente única). */}
      <a
        href="/app/master/finance?tab=summary"
        className="flex items-center justify-between gap-3 rounded-xl p-4 transition-colors duration-[140ms]"
        style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}
      >
        <div className="flex items-center gap-2.5">
          <TrendingUp className="h-4 w-4" style={{ color: "var(--color-info-600)" }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Ver análisis financiero en Finanzas &amp; Contabilidad</p>
            <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              Venta potencial, ganancia bruta potencial, margen, gastos y utilidad operativa.
            </p>
          </div>
        </div>
        <span className="text-sm font-semibold" style={{ color: "var(--color-info-600)" }}>→</span>
      </a>

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
            onClick={() => onNavigate("products", "NO_PRICE")}
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
  return <div className="space-y-1.5">{movements.map((item) => <div key={item.id} className="grid gap-2 rounded-lg border border-[var(--color-border)] p-2.5 text-xs md:grid-cols-6 hover:bg-[var(--color-surface-alt)] transition-colors"><span className="text-[var(--color-text-soft)]">{fmtDateTime(item.createdAt)}</span><span className="font-mono font-medium text-[var(--color-info-700)]">{item.product.sku}</span><span className="md:col-span-2 font-medium">{item.product.name}</span><span className="text-[var(--color-text-muted)]">{item.branch.code}</span><span className="font-medium">{item.movementType} · {qty(item.quantity)}</span></div>)}</div>;
}
