"use client";

import Link from "next/link";
import type { Route } from "next";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle, BarChart3, Boxes, Building2, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  CheckCircle2, DollarSign, Download, FileSpreadsheet, FileUp, History, Info, Loader2, Merge, Package, Pencil,
  Plus, RefreshCcw, Save, Search, Settings2, Shuffle, Sparkles, Tags, Trash2,
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
const PricingPanel = dynamic(() => import("@/components/catalog-inventory/pricing-panel").then((m) => m.PricingPanel), { ssr: false });
const TransfersPanel = dynamic(() => import("@/components/catalog-inventory/transfers-panel").then((m) => m.TransfersPanel), { ssr: false });
const ReplenishmentPanel = dynamic(() => import("@/components/catalog-inventory/replenishment-panel").then((m) => m.ReplenishmentPanel), { ssr: false });
const AuditPanel = dynamic(() => import("@/components/catalog-inventory/audit-panel").then((m) => m.AuditPanel), { ssr: false });

/* ───────────────────────── Types ───────────────────────── */
export type Branch = { id: string; code: string; name: string };
export type Category = { id: string; code: string; name: string; isActive: boolean };
export type ProductRow = {
  id: string;
  sku: string;
  barcode?: string | null;
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
   * fusión-aware), UNA fila por sucursal activa. buildBranchPricingCostRow
   * lo usa en vez de recalcular con la cascada de costo de red (sin
   * branchCost, borrada en docs/COSTO-UNA-FUENTE.md) como hacía antes —
   * la causa real del margen que no cuadraba.
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

export type BranchPricingCostRow = {
  referencePrice: number;
  branchPrice: number | null;
  effectivePrice: number | null;
  priceSource: "BRANCH" | "STANDARD" | "MISSING" | "FUSION_DERIVED";
  baseWeightedAverageCost: number | null;
  weightedAverageCost: number | null;
  branchCost: number | null;
  effectiveCost: number | null;
  costSource: "BRANCH" | "GLOBAL_AVERAGE" | "GLOBAL" | "LAST_PURCHASE" | "WAC_ESTIMATE" | "NONE";
  /** prompt-precios-costos-una-sola-fuente.md B.3 — de dónde sale el costo con el que se calculó el margen, para que un margen que no cuadra se explique en la fila en vez de en una investigación aparte. */
  costExplanation: string;
  effectiveMarginPercent: number | null;
  isConvertibleStock: boolean;
  baseUnit?: string | null;
  conversionFactor?: number | null;
  warnings: string[];
};

function costSourceLabel(source: BranchPricingCostRow["costSource"], branchCode: string): string {
  switch (source) {
    case "BRANCH": return `Costo cargado en ${branchCode}`;
    case "WAC_ESTIMATE": return `Promedio de compras en ${branchCode}`;
    case "GLOBAL_AVERAGE": return "Promedio general del producto";
    case "GLOBAL": return "Costo de compra general";
    case "LAST_PURCHASE": return "Última compra registrada";
    default: return "Sin costo";
  }
}

type Tab = "summary" | "products" | "categories" | "import" | "stock" | "movements" | "pricing" | "fusion" | "transfers" | "reorder" | "audit";

const TABS: Array<{ id: Tab; label: string; icon: typeof BarChart3 }> = [
  { id: "summary", label: "Resumen", icon: BarChart3 },
  { id: "products", label: "Productos", icon: Package },
  { id: "categories", label: "Categorías", icon: Tags },
  { id: "import", label: "Importar", icon: FileUp },
  { id: "stock", label: "Existencias", icon: Boxes },
  { id: "movements", label: "Movimientos / Kardex", icon: History },
  { id: "pricing", label: "Precios y costos", icon: TrendingUp },
  // "Ese apartado de Fusiones, es para poner el precio, no es otra
  // pestaña para crear" — a diferencia de Fusión de Inventario (crear
  // fusiones, editar presentaciones/factores — sigue en su propia
  // pantalla, enlazada desde acá), esta pestaña hace UNA sola cosa: poner
  // el costo global de cada presentación (FusionPricingPanel), sin WAC de
  // por medio, para que corregir ese número no exija saltar de pantalla.
  { id: "fusion", label: "Fusiones", icon: Merge },
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

export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatMoneyOrNd(value: number | null) {
  return value === null ? "N/D" : money(value);
}

export function formatMarginOrNd(value: number | null) {
  return value === null ? "N/D" : `${value.toFixed(1)}%`;
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
 * específico no tiene costo/precio resuelto. A diferencia de
 * formatMoneyOrNd/formatMarginOrNd (que muestran "N/D" en la tabla de
 * Precios y costos), acá el guion es deliberado: "N/D" suena a error de
 * datos, "—" es "no aplica sin sucursal" — la distinción que este ciclo
 * existe para hacer explícita.
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

export function buildBranchPricingCostRow(product: ProductRow, branch: Branch): BranchPricingCostRow {
  const setting = product.branchProductSettings.find((item) => item.branchId === branch.id);
  // prompt-precios-costos-una-sola-fuente.md — antes effectiveCost salía de
  // una cascada de costo de red (WAC > averageCost > globalCost >
  // lastPurchaseCost, SIN branchCost, borrada en docs/COSTO-UNA-FUENTE.md)
  // mientras esta misma fila mostraba branchCost de la sucursal — dos
  // costos distintos en una fila, el bug real detrás de un margen que no
  // cuadraba con lo que se veía en pantalla. entry es el mismo motor que
  // resuelve precio/costo efectivo
  // para la venta (branchCost > WAC > averageCost > globalCost >
  // lastPurchaseCost, fusión-aware) — branchEffectivePricing lo trae
  // calculado desde el backend (getEffectiveProductPricingBatch), no se
  // reimplementa acá.
  const entry = product.branchEffectivePricing?.find((item) => item.branchId === branch.id) ?? null;
  const branchPrice = numberOrNull(setting?.branchPrice);
  const branchCost = numberOrNull(setting?.branchCost);
  const referencePrice = Number(product.basePrice) || 0;
  const sharedWac = numberOrNull(product.allSharedInventoryBalances?.find((item) => item.branchId === branch.id)?.weightedAverageCost);
  const directWac = numberOrNull(product.inventoryBalances.find((item) => item.branchId === branch.id)?.weightedAverageCost);
  const baseWeightedAverageCost = sharedWac ?? directWac;
  const conversionFactor = numberOrNull(product.stockConversion?.conversionFactor) ?? 1;
  const weightedAverageCost = baseWeightedAverageCost === null
    ? null
    : baseWeightedAverageCost * (product.stockConversion ? conversionFactor : 1);

  const effectiveCost = entry?.effectiveCost ?? null;
  const costSource = entry?.costSource ?? "NONE";
  const costExplanation = entry?.isFusionMember && product.stockConversion
    ? `Derivado de ${product.stockConversion.baseUnit} × ${Number(product.stockConversion.conversionFactor)}`
    : costSourceLabel(costSource, branch.code);
  // Respaldo defensivo si branchEffectivePricing no vino (dato viejo en
  // caché, o algún llamador que todavía no lo pide) — mismo fallback a
  // standardSalePrice que ya hace el motor de venta (effective-pricing.ts),
  // para no volver a colapsar en "N/D" un producto que sí se vende al
  // precio general.
  const effectivePrice = entry?.effectivePrice ?? branchPrice ?? (referencePrice > 0 ? referencePrice : null);
  const priceSource: BranchPricingCostRow["priceSource"] = entry?.priceSource
    ?? (branchPrice !== null ? "BRANCH" : referencePrice > 0 ? "STANDARD" : "MISSING");
  const effectiveMarginPercent = effectivePrice !== null && effectivePrice > 0 && effectiveCost !== null && effectiveCost > 0
    ? ((effectivePrice - effectiveCost) / effectivePrice) * 100
    : null;

  const warnings: string[] = [];
  // "Sin precio en esta sucursal" es sobre branchPrice (la excepción propia
  // de ESTA sucursal), no sobre effectivePrice — "sigue el precio general"
  // es un estado válido, no "sin precio" (mismo criterio que hasNoBranchPrice
  // en catalog-inventory/service.ts). Antes era equivalente por accidente
  // (effectivePrice ERA branchPrice a secas); ahora que effectivePrice cae a
  // STANDARD, hay que decidirlo explícito para no perder el aviso.
  if (branchPrice === null) warnings.push("Sin precio en esta sucursal");
  if (effectiveCost === null) warnings.push("No se puede calcular margen sin costo efectivo.");
  if (entry?.sellability === "BELOW_COST") warnings.push("Precio bajo costo.");

  return {
    referencePrice,
    branchPrice,
    effectivePrice,
    priceSource,
    baseWeightedAverageCost,
    weightedAverageCost,
    branchCost,
    effectiveCost,
    costSource,
    costExplanation,
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
  const [debouncedQ, setDebouncedQ] = useState("");
  const [branchId, setBranchId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [stockSearch, setStockSearch] = useState("");
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  /* Scroll active tab into view when tab changes (prevents hidden tab on mobile) */
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [tab]);

  /* Debounce the text search so each keystroke doesn't fire an API request */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(timer);
  }, [q]);

  /* ── Inline edit state for product rows ── */
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", categoryId: "", sku: "", applySuggestedSku: false });
  const [editSkuPreview, setEditSkuPreview] = useState("");
  const [savingProduct, setSavingProduct] = useState(false);
  const [generatingSku, setGeneratingSku] = useState(false);
  const [focusedPricingProductId, setFocusedPricingProductId] = useState<string | null>(null);
  const [movementDialog, setMovementDialog] = useState<"adjustment" | "opening" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
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
  }, [branchId, categoryId, filter, debouncedQ, page]);

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

  async function updateBranchPrice(product: ProductRow, branch: Branch, field: "branchPrice", value: string, reason?: string, overridePriceConfirmed = false) {
    const numeric = value.trim() === "" ? null : Number(value);
    if (numeric !== null && (!Number.isFinite(numeric) || numeric < 0)) {
      toast.error("No se permiten costos o precios negativos.");
      return;
    }
    const response = await apiFetch("/api/master/catalog-inventory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // Parte B (prompt-huecos-fase1-fase3-despliegue.md) — priceExceptionReason
      // viaja junto con branchPrice: setBranchPriceTx exige motivo cuando se
      // fija un precio (numeric !== null); al limpiarlo a null no hace falta.
      body: JSON.stringify({ branchId: branch.id, productId: product.id, [field]: numeric, priceExceptionReason: numeric !== null ? reason : undefined, overridePriceConfirmed: overridePriceConfirmed || undefined }),
    });
    if (!response.ok) {
      const raw = await response.json().catch(() => null);
      // Parte C (prompt-precios-costos-una-sola-fuente.md) — un 409 es una
      // pregunta del servidor, no un error genérico: cada uno de estos
      // guards existe por una razón concreta y distinta, y quien lo ve
      // necesita saber CUÁL para poder actuar, no solo que "algo falló".
      if (raw?.error?.code === "BELOW_COST_NOT_ALLOWED") {
        // El costo/fuente ya están en el cliente (buildBranchPricingCostRow,
        // el mismo motor que acaba de calcular el margen de esta fila) — no
        // hace falta que el backend los mande de vuelta en el error.
        const row = buildBranchPricingCostRow(product, branch);
        toast.error(
          row.effectiveCost !== null
            ? `El costo vigente es ${money(row.effectiveCost)} (${row.costExplanation}). Corregí el costo o subí el precio.`
            : (raw?.error?.message ?? "El precio no puede ser menor al costo."),
          { duration: 8000 },
        );
        return;
      }
      if (raw?.error?.code === "FUSION_COST_WRITE_NOT_ALLOWED") {
        toast.error("Esta presentación es un miembro derivado de una fusión: el costo se carga en el producto canónico, no aquí.", { duration: 8000 });
        return;
      }
      // prompt-costos-precios-fusion.md §2.2 — el override sigue permitido
      // (vender por metro más barato que por lata suelta es legítimo), solo
      // deja de ser invisible: se confirma explícito antes de guardarlo.
      if (raw?.error?.code === "FUSION_PRICE_OVERRIDE_CONFIRMATION_REQUIRED" && !overridePriceConfirmed) {
        const confirmed = window.confirm(`${raw.error.message}\n\n¿Confirmás que el precio es correcto tal cual lo escribiste?`);
        if (confirmed) {
          await updateBranchPrice(product, branch, field, value, reason, true);
        }
        return;
      }
      toast.error(raw?.error?.message ?? "No se pudo guardar la configuracion por sucursal.");
      return;
    }
    toast.success(`Precio guardado para ${branch.code}`);
    await load();
  }

  async function updateGlobalCost(product: ProductRow, value: string, allowHighUnitCost = false) {
    const numeric = value.trim() === "" ? null : Number(value);
    if (numeric !== null && (!Number.isFinite(numeric) || numeric < 0)) {
      toast.error("El costo universal no puede ser negativo.");
      return;
    }
    const response = await apiFetch(`/api/catalog/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ globalCost: numeric, allowHighUnitCost: allowHighUnitCost || undefined }),
    });
    if (!response.ok) {
      const raw = await response.json().catch(() => null);
      // "asegura el motor de mejor manera" — este producto tiene una
      // presentación en bulto (fusión), y el costo nuevo se parece al
      // costo del BULTO completo, no al de la unidad base. Sin este
      // reintento, un costo alto legítimo (el bulto de verdad subió de
      // precio) quedaría bloqueado sin salida — mismo error que ya
      // arreglamos para standardSalePrice, no lo repetimos acá.
      if (raw?.error?.code === "SUSPECTED_PACKAGE_COST_AS_UNIT_COST") {
        const confirmed = window.confirm(`${raw.error.message}\n\n¿Confirmás que el costo es correcto tal cual lo escribiste?`);
        if (confirmed) {
          await updateGlobalCost(product, value, true);
          return;
        }
        return;
      }
      // Parte C — este producto es un miembro DERIVADO de una fusión (el
      // costo se edita en el canónico); la UI ya oculta este input para
      // derivados, así que en la práctica esto solo puede pasar por una
      // fusión creada/cambiada en el momento entre que se cargó la fila y
      // se guardó — un mensaje claro en vez de uno genérico igual ayuda.
      if (raw?.error?.code === "FUSION_COST_WRITE_NOT_ALLOWED") {
        toast.error("Esta presentación es un miembro derivado de una fusión: el costo se carga en el producto canónico, no aquí.", { duration: 8000 });
        return;
      }
      toast.error(raw?.error?.message ?? "No se pudo guardar el costo universal.");
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

  async function regenerateSku(product: ProductRow) {
    const name = editDraft.name.trim() || product.name;
    const catId = editDraft.categoryId || product.category?.id || "";
    if (!catId) {
      toast.error("Selecciona una categoría primero para regenerar el SKU.");
      return;
    }
    setGeneratingSku(true);
    try {
      const response = await fetch(
        `/api/catalog/products/sku-suggestion?name=${encodeURIComponent(name)}&categoryId=${encodeURIComponent(catId)}&productId=${encodeURIComponent(product.id)}`
      );
      if (!response.ok) throw new Error("No se pudo generar el SKU.");
      const raw = await response.json();
      const result = unwrapApiData(raw);
      if (result.suggestedSku) {
        setEditSkuPreview(result.suggestedSku);
        setEditDraft((prev) => ({ ...prev, applySuggestedSku: true }));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al generar SKU.");
    } finally {
      setGeneratingSku(false);
    }
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
      const byBranch = new Map(product.inventoryBalances.map((balance) => [balance.branchId, Number(balance.quantityOnHand)]));
      return { product, branches: branches.map((branch) => ({ branch, quantity: byBranch.get(branch.id) ?? 0 })) };
    });
  }, [data, stockSearch]);

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

      {/* ── Barra de filtros ──
          El mismo bug de layout que tenía la Bandeja de precios
          (master/pricing/page.tsx): .hm-input declara width:100%
          (globals.css:588) y el minWidth inline no limita nada cuando el
          ancho ya es 100% — cada control ocupaba la fila entera y
          flex-wrap los mandaba a línea propia. Solución copiada de ahí:
          cada control en su propio contenedor con ancho fijo (no en el
          input/select directo). Sin botón "Aplicar" — branchId y
          categoryId ya disparan setPage(1) y el useEffect de load()
          recarga solo (línea ~546); q ya tiene su propio debounce
          (350ms, línea ~517). Un botón que a veces hacía falta y a veces
          no enseñaba a desconfiar de los filtros. */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-[240px]">
          <label htmlFor="cat-search" className="mb-1 block text-xs" style={{ color: "var(--color-text-muted)" }}>Buscar</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: "var(--color-text-muted)" }} />
            <input
              id="cat-search"
              className="hm-input h-10 w-full"
              style={{ paddingLeft: "2rem" }}
              placeholder="Buscar SKU o producto"
              value={q}
              onChange={(event) => { setQ(event.target.value); setPage(1); }}
            />
          </div>
        </div>
        <div className="w-[190px]">
          <label htmlFor="cat-branch" className="mb-1 block text-xs" style={{ color: "var(--color-text-muted)" }}>Sucursal</label>
          <select id="cat-branch" className="hm-input h-10" value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1); }}>
            <option value="">Todas las sucursales</option>
            {data?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}
          </select>
        </div>
        <div className="w-[170px]">
          <label htmlFor="cat-category" className="mb-1 block text-xs" style={{ color: "var(--color-text-muted)" }}>Categoría</label>
          <select id="cat-category" className="hm-input h-10" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}>
            <option value="">Todas las categorias</option>
            {data?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </div>
      </div>

      {/* docs/COSTO-UNA-FUENTE.md, C.2 — una línea de texto, no una alerta
          ámbar: sin sucursal elegida es el estado normal de esta vista, no
          un error. */}
      {data && data.costScope === "NETWORK" ? (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Mostrando existencias de todas las sucursales. Los costos y precios dependen de la sucursal — elegí una para verlos.
        </p>
      ) : null}

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
                  const isEditing = editingProductId === product.id;
                  const sharedStock = formatSharedStock(product);
                  const { price: rowEffectivePrice, margin: rowMarginPercent } = effectivePriceAndMargin(product, data.costBranchId);
                  const categoryChanged = isEditing && editDraft.categoryId !== (product.category?.id ?? "");
                  return (
                  <tr key={product.id}>
                    <td>
                      {isEditing ? (
                        <div className="space-y-1.5 min-w-[160px]">
                          <div className="font-mono text-xs">
                            {editDraft.applySuggestedSku && editSkuPreview ? (
                              <>
                                <span className="line-through text-[var(--color-text-muted)]">{product.sku}</span>
                                <span className="ml-1.5 font-semibold" style={{ color: "var(--color-success-600)" }}>→ {editSkuPreview}</span>
                              </>
                            ) : (
                              <span className="font-semibold text-[var(--color-text)]">{product.sku}</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => regenerateSku(product)}
                            disabled={generatingSku}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.68rem] font-medium border transition-colors disabled:opacity-50"
                            style={{
                              background: "color-mix(in srgb, var(--color-master-600) 8%, transparent)",
                              color: "var(--color-master-700)",
                              borderColor: "color-mix(in srgb, var(--color-master-600) 30%, transparent)",
                            }}
                          >
                            {generatingSku ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
                            Regenerar SKU
                          </button>
                          {editDraft.applySuggestedSku && editSkuPreview ? (
                            <label className="flex cursor-pointer items-center gap-1.5 text-[0.68rem] text-[var(--color-text-secondary)]">
                              <input
                                type="checkbox"
                                checked={editDraft.applySuggestedSku}
                                onChange={(e) => setEditDraft({ ...editDraft, applySuggestedSku: e.target.checked })}
                              />
                              Aplicar nuevo SKU
                            </label>
                          ) : null}
                        </div>
                      ) : (
                        <span className="font-semibold">{product.sku}</span>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <div className="space-y-2">
                          <Input className="h-8 min-w-[220px]" value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value, applySuggestedSku: false })} />
                          {editSkuPreview && categoryChanged ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[0.68rem] text-amber-800">
                              <div>La categoria cambio. El SKU puede no corresponder a la nueva categoria.</div>
                              <div className="mt-1">
                                <strong>{product.category?.name ?? "Sin categoria"}</strong>{" → "}
                                <strong>{data.categories.find((category) => category.id === editDraft.categoryId)?.name ?? "Sin categoria"}</strong>
                              </div>
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
            missingPriceCount={data.kpis.missingPriceCount}
            onlyMissing={filter === "NO_BRANCH_PRICE"}
            onToggleOnlyMissing={() => { setFilter((prev) => (prev === "NO_BRANCH_PRICE" ? "" : "NO_BRANCH_PRICE")); setPage(1); }}
            onSelectBranch={(nextBranchId) => { setBranchId(nextBranchId); setPage(1); }}
            onSave={updateBranchPrice}
            onSaveGlobalCost={updateGlobalCost}
            onToggleBranchAssignment={toggleBranchAssignment}
          />
          {data.pagination && <PaginationBar pagination={data.pagination} onPageChange={setPage} />}
        </>
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
      {data && tab === "audit" ? <AuditPanel logs={data.auditLogs} /> : null}
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
  return <div className="space-y-1.5">{movements.map((item) => <div key={item.id} className="grid gap-2 rounded-lg border border-[var(--color-border)] p-2.5 text-xs md:grid-cols-6 hover:bg-[var(--color-surface-alt)] transition-colors"><span className="text-[var(--color-text-soft)]">{fmtDateTime(item.createdAt)}</span><span className="font-mono font-medium text-[var(--color-info-700)]">{item.product.sku}</span><span className="md:col-span-2 font-medium">{item.product.name}</span><span className="text-[var(--color-text-muted)]">{item.branch.code}</span><span className="font-medium">{item.movementType} · {qty(item.quantity)}</span></div>)}</div>;
}
