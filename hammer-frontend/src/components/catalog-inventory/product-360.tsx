"use client";

import Link from "next/link";
import type { Route } from "next";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  DollarSign,
  Warehouse,
  AlertTriangle,
  Calculator,
  Printer,
  Pencil,
} from "lucide-react";
import toast from "react-hot-toast";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { printProductLabels } from "@/lib/client/print-product-labels";
import { money, qty, fmtDateTime, fmtDayMonth } from "@/lib/format";
import { useInventoryScope } from "@/hooks/use-inventory-scope";
import { buildAttentionItems, countOpenBrainDecisions, marginTone, resolveProfileTab, type ProfileTab } from "@/lib/inventory/product-profile-logic";
import { isInboundMovement, movementLabel } from "@/components/catalog-inventory/movement-history-helpers";
import { CostOnlyCorrectionModal } from "@/components/pricing/cost-only-correction-modal";
import { ProductEditDrawer } from "@/components/catalog-inventory/product-edit-drawer";
import type { Category, ProductRow } from "@/components/catalog-inventory/catalog-inventory-admin";

// Fase 5 (prompt-flujo-velocidad.md): las 3 pestañas más pesadas de esta
// ficha de producto (Kardex, historial de costo, historial de precio) se
// extrajeron a sus propios archivos para poder cargarlas diferido — solo
// se montan cuando el usuario abre esa pestaña específica, no en cada
// visita a la ficha. ssr:false porque las tres arman su propio estado del
// lado del cliente (fetch propio contra la API).
const KardexTab = dynamic(() => import("@/components/catalog-inventory/kardex-tab").then((m) => m.KardexTab), {
  ssr: false,
  loading: () => <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">Cargando…</p>,
});
const WacHistoryTab = dynamic(() => import("@/components/catalog-inventory/wac-history-tab").then((m) => m.WacHistoryTab), {
  ssr: false,
  loading: () => <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">Cargando…</p>,
});
const PriceHistoryTab = dynamic(() => import("@/components/catalog-inventory/price-history-tab").then((m) => m.PriceHistoryTab), {
  ssr: false,
  loading: () => <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">Cargando…</p>,
});
// prompt-codigos-y-duplicados.md Fase 2 — "Códigos" (varios códigos por
// producto, Fase 1): mismo patrón diferido que las 3 pestañas de arriba.
const ProductBarcodesTab = dynamic(() => import("@/components/catalog-inventory/product-barcodes-tab").then((m) => m.ProductBarcodesTab), {
  ssr: false,
  loading: () => <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">Cargando…</p>,
});

/* ── Types ── */
// export: kardex-tab.tsx, wac-history-tab.tsx y price-history-tab.tsx
// (Fase 5) importan estos dos tipos — el resto de sus tipos son propios.
export type Branch = { id: string; code: string; name: string };
export type ProductDetail = {
  product: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    isActive: boolean;
    standardSalePrice: string;
    barcode: string | null;
    category?: { id: string; name: string };
    /** Fusión del producto — el panel "Editar producto" muestra la unidad de venta real. */
    stockConversion?: ProductRow["stockConversion"];
    inventoryBalances: Array<{
      id: string;
      quantityOnHand: string;
      weightedAverageCost: string;
      inventoryValue: string;
      branch: Branch;
    }>;
    inventoryMovements: Array<{
      id: string;
      createdAt: string;
      movementType: string;
      quantity: string;
      unitCost: string;
      referenceType: string;
      referenceId: string;
      branch: Branch;
    }>;
    branchProductSettings: Array<{
      id: string;
      isAvailable: boolean;
      branchCost?: string | null;
      branchPrice?: string | null;
      branch: Branch;
    }>;
    reorderPolicies: Array<{
      id: string;
      minQuantity: string;
      reorderPoint: string;
      targetQuantity: string;
      branch: Branch;
    }>;
    brainDecisions: Array<{
      id: string;
      createdAt: string;
      status: string;
      severity: string;
      category: string;
      title: string;
      branch?: Branch | null;
    }>;
  };
  auditLogs: Array<{
    id: string;
    occurredAt: string;
    module: string;
    action: string;
    entityType: string;
    actor?: { username: string; fullName?: string | null } | null;
    branch?: Branch | null;
  }>;
};
type Tab = ProfileTab;

// Los tipos de datos de Kardex/historial de costo/historial de precio y sus
// helpers (movementLabel, MovementIcon, etc.) se movieron a
// kardex-tab.tsx / wac-history-tab.tsx / price-history-tab.tsx /
// movement-history-helpers.tsx (Fase 5, prompt-flujo-velocidad.md) junto
// con los componentes que los usan — ya no viven acá.

/* ── Tab config ── */
// 9 → 6: los historiales de precio y costo viven en Precios y costos; Brain y
// Auditoría en Actividad (los ?tab= viejos se mapean en resolveProfileTab).
const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "Resumen" },
  { id: "pricing", label: "Precios y costos" },
  { id: "stock", label: "Existencias" },
  { id: "movements", label: "Kardex" },
  { id: "barcodes", label: "Códigos" },
  { id: "activity", label: "Actividad" },
];

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── Main Component ── */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function Product360({ productId }: { productId: string }) {
  const [data, setData] = useState<ProductDetail | null>(null);
  const searchParams = useSearchParams();
  // prompt-codigos-y-duplicados.md Fase 2 — "Códigos..." en
  // catalog-inventory-admin.tsx enlaza directo a ?tab=barcodes; cualquier
  // otro ?tab= con un valor válido también funciona (no solo ese caso).
  const [tab, setTab] = useState<Tab>(() => resolveProfileTab(searchParams.get("tab")));
  // prompt-codigos-editar-eliminar.md Fase 3.3 — el menú rápido del chip de
  // código en catalog-inventory-admin.tsx enlaza a ?tab=barcodes&editPrimary=1
  // para abrir el editor del código principal ya desplegado, sin duplicar el
  // formulario de edición fuera de la pestaña Códigos.
  const autoEditPrimaryBarcode = searchParams.get("editPrimary") === "1";
  const [error, setError] = useState("");
  const [printingLabel, setPrintingLabel] = useState(false);
  // D · Fase 3 (prompt-completo-pendientes-2026-10.md) — "Corregir costo" en
  // la pestaña de Precios y Costos: qué sucursal tiene el modal abierto.
  const [correctingBranchId, setCorrectingBranchId] = useState<string | null>(null);
  // "Editar producto" — mismo panel que la lista; las categorías se piden al abrirlo.
  const [editCategories, setEditCategories] = useState<Category[] | null>(null);
  const sessionState = useSession();
  const scope = useInventoryScope();
  // Precio/costo/margen por sucursal para la franja y "Para atender" del Resumen.
  // Se pide al abrir el perfil (en cualquier pestaña) y otra vez al volver a Resumen,
  // así no queda viejo tras editar en Precios y costos.
  const [pricing, setPricing] = useState<BranchPricingStatus | null>(null);
  const pricingRequested = useRef(false);
  useEffect(() => {
    if (tab !== "general" && pricingRequested.current) return;
    let cancelled = false;
    apiFetch(`/api/master/pricing/product/${productId}/branches`)
      .then(async (res) => {
        const raw = await res.json();
        if (!res.ok) throw new Error(raw?.error?.message ?? "pricing");
        if (cancelled) return;
        pricingRequested.current = true;
        setPricing(unwrapApiData(raw) as BranchPricingStatus);
      })
      .catch(() => { /* la franja muestra "—"; Precios y costos avisa el error al abrirla */ });
    return () => { cancelled = true; };
  }, [productId, tab]);

  async function toggleBranchAssignment(branchId: string, isAvailable: boolean) {
    const res = await apiFetch(`/api/catalog/products/${productId}/branch-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId, isAvailable }),
    });
    if (!res.ok) {
      toast.error("No se pudo actualizar la asignación de sucursal.");
      return;
    }
    toast.success(isAvailable ? "Asignado a la sucursal" : "Asignación quitada");
    await reloadProduct();
  }

  function openEditor() {
    apiFetch("/api/catalog/categories")
      .then((res) => res.json())
      .then((raw) => setEditCategories(unwrapApiData(raw) as Category[]))
      .catch(() => toast.error("No se pudieron cargar las categorías."));
  }

  const reloadProduct = useCallback(() => {
    return fetch(`/api/master/catalog-inventory/products/${productId}`, { cache: "no-store" })
      .then(async (response) => {
        const raw = await response.json();
        if (!response.ok) throw new Error(raw.message ?? "No se pudo cargar el producto.");
        setData(raw.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar el producto."));
  }, [productId]);

  useEffect(() => { void reloadProduct(); }, [reloadProduct]);

  /* ── Loading / Error states ── */
  if (error) {
    return (
      <Card className="p-8 text-center">
        <AlertTriangle className="h-10 w-10 mx-auto text-red-500 mb-3" />
        <p className="text-sm font-semibold text-[var(--color-danger-700)]">{error}</p>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card className="p-8 text-center">
        <div className="h-8 w-8 mx-auto mb-3 animate-spin rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-info-600)]" />
        <p className="text-sm text-[var(--color-text-muted)]">Cargando Producto 360…</p>
      </Card>
    );
  }

  const product = data.product;
  const totalStock = product.inventoryBalances.reduce((s, i) => s + Number(i.quantityOnHand), 0);
  const totalValue = product.inventoryBalances.reduce((s, i) => s + Number(i.inventoryValue), 0);

  async function handlePrintLabel() {
    if (sessionState.status !== "authenticated") {
      toast.error("No se pudo determinar la sucursal para la etiqueta.");
      return;
    }
    const branchId = getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId);
    if (!branchId) {
      toast.error("No tenés una sucursal asignada para imprimir.");
      return;
    }

    let barcode = product.barcode;
    if (!barcode) {
      const confirmed = window.confirm(
        `"${product.name}" no tiene código de fábrica. ¿Generar un código interno (HMR-${product.sku}) para poder imprimir la etiqueta?`,
      );
      if (!confirmed) return;
      try {
        const res = await apiFetch(`/api/catalog/products/${product.id}/internal-barcode`, { method: "POST" });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? "No se pudo generar el código interno.");
        const updated = unwrapApiData(body) as { barcode: string };
        barcode = updated.barcode;
        setData((prev) => (prev ? { ...prev, product: { ...prev.product, barcode: updated.barcode } } : prev));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo generar el código interno.");
        return;
      }
    }

    setPrintingLabel(true);
    try {
      await printProductLabels({
        products: [{ id: product.id, name: product.name, sku: product.sku, barcode, standardSalePrice: Number(product.standardSalePrice) }],
        branchId,
      });
    } catch {
      toast.error("No se pudo generar la etiqueta.");
    } finally {
      setPrintingLabel(false);
    }
  }

  // ── Sucursal elegida en la barra de Inventario ("Toda la red" = null) ──
  const scopeBranchId = scope.mode === "branch" ? scope.branchId : null;
  const scopeCode = scope.mode === "branch" ? scope.branchCode : null;
  const scopeBalance = scopeBranchId ? product.inventoryBalances.find((b) => b.branch.id === scopeBranchId) : undefined;
  const stockInScope = scopeBranchId ? Number(scopeBalance?.quantityOnHand ?? 0) : totalStock;
  const valueInScope = scopeBranchId ? Number(scopeBalance?.inventoryValue ?? 0) : totalValue;
  const pricingRow = scopeBranchId ? pricing?.branches.find((r) => r.branchId === scopeBranchId) ?? null : null;
  const standardPrice = Number(product.standardSalePrice) > 0 ? Number(product.standardSalePrice) : null;
  const priceInScope = scopeBranchId ? pricingRow?.effectivePrice ?? null : standardPrice;
  const costInScope = pricingRow?.effectiveCost ?? null;
  const marginInScope = pricingRow?.marginPercent ?? null;
  const minPolicy = scopeBranchId ? product.reorderPolicies.find((p) => p.branch.id === scopeBranchId) : undefined;
  const minInScope = minPolicy ? Number(minPolicy.minQuantity) : null;
  // En una fusión el saldo puede no estar en la unidad de este producto: sin unidad antes que con la equivocada.
  const unitSuffix = product.stockConversion ? "" : ` ${product.unit.toLowerCase()}`;
  const openBrain = countOpenBrainDecisions(product.brainDecisions);
  const pricingLoaded = pricing !== null;
  const attention = buildAttentionItems({
    branchCode: pricingLoaded ? scopeCode : null,
    effectiveCost: costInScope,
    effectivePrice: priceInScope,
    marginPercent: marginInScope,
    hasBarcode: Boolean(product.barcode),
    stockInScope,
    minQuantity: minInScope,
    openBrainDecisions: openBrain,
  });
  const maxBranchQty = Math.max(1, ...product.inventoryBalances.map((b) => Number(b.quantityOnHand)));
  const recentMovements = product.inventoryMovements.filter((m) => !scopeBranchId || m.branch.id === scopeBranchId).slice(0, 4);
  const assignedCodes = product.branchProductSettings.filter((s) => s.isAvailable).map((s) => s.branch.code);
  const branchesForHistory = [...new Map(product.inventoryBalances.map((b) => [b.branch.id, b.branch])).values()].sort((a, b) => a.code.localeCompare(b.code));
  const where = scopeCode ?? "la red";

  return (
    <section className="space-y-4 animate-fade-in-up">
      {/* ── Volver + encabezado: el nombre manda, el SKU baja a la línea de datos ── */}
      <div className="space-y-2">
        <Link
          href={"/app/master/catalog-inventory?tab=products" as Route}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-master-700)] hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Productos
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {/* style: globals.css fija h1 fuera de @layer y le gana a text-* */}
            <h1 className="text-[var(--color-text)]" style={{ fontSize: "1.375rem", lineHeight: 1.25 }}>{product.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
              <span className="font-mono">{product.sku}</span>
              <span>{product.category?.name ?? "Sin categoría"}</span>
              <span>{product.unit}</span>
              {product.barcode ? <span className="font-mono">{product.barcode}</span> : null}
              <Badge variant={product.isActive ? "success" : "warning"}>{product.isActive ? "Activo" : "Inactivo"}</Badge>
            </p>
          </div>
          {/* text-xs aquí: `button { font: inherit }` fuera de @layer anula el tamaño del Button */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Button variant="secondary" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={openEditor}>
              Editar
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Printer className="h-4 w-4" />}
              onClick={() => void handlePrintLabel()}
              disabled={printingLabel}
              loading={printingLabel}
            >
              {product.barcode ? "Imprimir etiqueta" : "Generar código y etiqueta"}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Franja de 5 números de la sucursal elegida ── */}
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] sm:grid-cols-3 lg:grid-cols-5">
        <Stat label={`Stock en ${where}`} value={`${qty(stockInScope)}${unitSuffix}`} sub={scopeBranchId ? `${qty(totalStock)} en toda la red` : `${product.inventoryBalances.filter((b) => Number(b.quantityOnHand) > 0).length} sucursales con stock`} />
        <Stat
          label={scopeCode ? `Precio ${scopeCode}` : "Precio general"}
          value={priceInScope === null ? "—" : money(priceInScope)}
          sub={scopeBranchId ? (!pricingLoaded ? "…" : pricingRow?.followsStandard ? "sigue el general" : pricingRow ? "precio propio" : "sin asignar") : "referencia de la red"}
        />
        <Stat label={scopeCode ? `Costo ${scopeCode}` : "Costo"} value={costInScope === null ? "—" : money(costInScope)} sub={scopeBranchId ? (pricingLoaded && costInScope === null ? "sin costo" : "") : "elegí una sucursal"} />
        <Stat
          label="Margen"
          value={marginInScope === null ? "—" : `${marginInScope.toFixed(1)}%`}
          tone={marginTone(marginInScope)}
          sub={marginInScope !== null && marginInScope < 20 ? "bajo el 20%" : ""}
        />
        <Stat label={`Valor en ${where}`} value={money(valueInScope)} sub="a costo" />
      </div>

      {/* ── Pestañas: 6 (historiales dentro de Precios; Brain + Auditoría = Actividad) ── */}
      <div role="tablist" aria-label="Secciones del producto" className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)] text-sm">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 font-semibold transition-colors ${
              tab === id
                ? "border-[var(--color-master-600)] text-[var(--color-master-700)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {label}
            {id === "activity" && openBrain > 0 ? (
              <span className="rounded-full bg-[var(--color-warning-100)] px-1.5 text-[10px] font-bold text-[var(--color-warning-700)]">{openBrain}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ═══ RESUMEN ═══ */}
      {tab === "general" && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Card className="space-y-3 p-4">
            <SectionRule title="Existencias por sucursal" action={{ label: "Ver todo", onClick: () => setTab("stock") }} />
            {product.inventoryBalances.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">Sin existencias registradas en ninguna sucursal.</p>
            ) : (
              <div className="space-y-2">
                {product.inventoryBalances.map((b) => {
                  const q = Number(b.quantityOnHand);
                  const policy = product.reorderPolicies.find((p) => p.branch.id === b.branch.id);
                  const min = policy ? Number(policy.minQuantity) : null;
                  const atMin = min !== null && min > 0 && q <= min;
                  const isScope = b.branch.id === scopeBranchId;
                  return (
                    <div key={b.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)_4.5rem_4.5rem] items-center gap-3 text-sm">
                      <span className={isScope ? "font-bold text-[var(--color-text)]" : "text-[var(--color-text-secondary)]"} title={b.branch.name}>{b.branch.code}</span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-alt)]">
                        <span
                          className={`block h-full rounded-full ${atMin ? "bg-[var(--color-warning-600)]" : "bg-[var(--color-master-600)]"}`}
                          style={{ width: `${Math.max(0, Math.min(100, (q / maxBranchQty) * 100))}%` }}
                        />
                      </span>
                      <span className={`text-right tabular-nums ${isScope ? "font-bold" : ""}`}>{qty(q)}</span>
                      <span className="text-right text-xs tabular-nums text-[var(--color-text-soft)]">{min !== null ? `mín ${qty(min)}` : ""}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <SectionRule title={`Últimos movimientos en ${where}`} action={{ label: "Kardex", onClick: () => setTab("movements") }} />
            {recentMovements.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">Sin movimientos.</p>
            ) : (
              <div>
                {recentMovements.map((m) => {
                  const inbound = isInboundMovement(m.movementType);
                  const amount = Math.abs(Number(m.quantity));
                  return (
                    <div key={m.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-3 border-b border-dashed border-[var(--color-border)] py-1.5 text-sm last:border-b-0">
                      <span className="text-xs tabular-nums text-[var(--color-text-soft)]">{fmtDayMonth(m.createdAt)}</span>
                      <span className="truncate text-[var(--color-text-secondary)]">
                        {movementLabel(m.movementType).label}
                        {scopeBranchId ? null : <span className="text-[var(--color-text-soft)]"> · {m.branch.code}</span>}
                      </span>
                      <span className={`text-right font-bold tabular-nums ${inbound ? "text-[var(--color-success-700)]" : "text-[var(--color-text)]"}`}>
                        {inbound ? "+" : "−"}{qty(amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <SectionRule title="Para atender" />
            {attention.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">{pricingLoaded || !scopeBranchId ? "Nada pendiente." : "Revisando…"}</p>
            ) : (
              <div className="space-y-1.5">
                {attention.map((item) => (
                  <div key={item.key} className="flex items-center gap-2.5 rounded-lg bg-[var(--color-warning-50)] px-3 py-2 text-sm text-[var(--color-text)]">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning-600)]" aria-hidden="true" />
                    <span className="min-w-0 flex-1">{item.label}</span>
                    {/* text-xs en el contenedor: `button { font: inherit }` fuera de @layer le gana a text-* en el botón */}
                    <span className="shrink-0 text-xs">
                      <button type="button" onClick={() => setTab(item.tab)} className="font-semibold text-[var(--color-master-700)] hover:underline">{item.action}</button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <SectionRule title="Datos" />
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
              <dt className="text-[var(--color-text-muted)]">Unidad</dt>
              <dd>
                {product.unit}
                {product.stockConversion ? (
                  <span className="text-[var(--color-text-muted)]"> · fusión {product.stockConversion.stockGroupName}, se vende por {product.stockConversion.saleUnit}</span>
                ) : null}
              </dd>
              <dt className="text-[var(--color-text-muted)]">Categoría</dt>
              <dd>{product.category?.name ?? "Sin categoría"}</dd>
              <dt className="text-[var(--color-text-muted)]">Asignado a</dt>
              <dd>{assignedCodes.length > 0 ? assignedCodes.join(", ") : <span className="text-[var(--color-text-muted)]">ninguna sucursal a mano</span>}</dd>
            </dl>
            <p className="text-xs text-[var(--color-text-soft)]">Nombre, categoría, SKU y unidad se cambian con <b>Editar</b>.</p>
          </Card>
        </div>
      )}

      {/* ═══ EXISTENCIAS ═══ */}
      {tab === "stock" && (
        <Card noPadding>
          {product.inventoryBalances.length === 0 ? (
            <div className="p-8 text-center">
              <Warehouse className="h-10 w-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
              <p className="text-sm font-medium text-[var(--color-text-secondary)]">Sin existencias registradas</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="hm-sheet-table">
                <thead>
                  <tr>
                    <th>Sucursal</th>
                    <th className="text-right!">Cantidad</th>
                    <th className="text-right!">Mínimo</th>
                    <th className="text-right!">Costo promedio</th>
                    <th className="text-right!">Valor inventario</th>
                  </tr>
                </thead>
                <tbody>
                  {product.inventoryBalances.map((b) => {
                    const policy = product.reorderPolicies.find((p) => p.branch.id === b.branch.id);
                    return (
                      <tr key={b.id} className={b.branch.id === scopeBranchId ? "bg-[var(--color-master-50)]" : undefined}>
                        <td>
                          <span className="font-semibold text-[var(--color-text)]">{b.branch.code}</span>
                          <span className="ml-2 text-[var(--color-text-secondary)]">{b.branch.name}</span>
                        </td>
                        <td className="text-right font-mono font-semibold">{qty(b.quantityOnHand)}</td>
                        <td className="text-right font-mono text-[var(--color-text-muted)]">{policy ? qty(policy.minQuantity) : "—"}</td>
                        <td className="text-right font-mono">{money(b.weightedAverageCost)}</td>
                        <td className="text-right font-mono font-semibold text-[var(--color-text)]">{money(b.inventoryValue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--color-border-strong)] bg-[var(--color-surface-alt)]">
                    <td className="font-bold text-[var(--color-text)]">Total</td>
                    <td className="text-right font-mono font-bold text-[var(--color-text)]">{qty(totalStock)}</td>
                    <td></td>
                    <td></td>
                    <td className="text-right font-mono font-bold text-[var(--color-text)]">{money(totalValue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ═══ KARDEX ═══ */}
      {tab === "movements" && <KardexTab productId={product.id} fallbackMovements={product.inventoryMovements} />}

      {/* ═══ PRECIOS Y COSTOS — con su historial de precio y de costo debajo ═══ */}
      {tab === "pricing" && (
        <div className="space-y-5">
          {/* Una sola lista por sucursal: precio, costo, margen y sus
              acciones. Antes había una tabla aparte de "Disponibilidad y
              costo" que repetía las sucursales con otro costo. */}
          {correctingBranchId && (
            <CostOnlyCorrectionModal
              productId={product.id}
              branchId={correctingBranchId}
              productName={product.name}
              onClose={() => setCorrectingBranchId(null)}
              onDone={() => { setCorrectingBranchId(null); toast.success("Costo corregido."); void reloadProduct(); }}
            />
          )}

          <BranchPricingBlock
            productId={product.id}
            standardSalePriceFallback={product.standardSalePrice}
            assignedBranchIds={new Set(product.branchProductSettings.filter((s) => s.isAvailable).map((s) => s.branch.id))}
            onToggleAssignment={toggleBranchAssignment}
            onCorrectCost={setCorrectingBranchId}
            onStandardPriceSaved={() => void reloadProduct()}
          />

          {/* PriceHistoryTab trae su propio título "Historial de precio". */}
          <PriceHistoryTab productId={product.id} branches={branchesForHistory} />
          <div className="space-y-3">
            <SectionRule title="Historial de costo" />
            <WacHistoryTab productId={product.id} branches={branchesForHistory} />
          </div>
        </div>
      )}

      {editCategories && (
        <ProductEditDrawer
          product={{ ...product, hasHistory: totalStock !== 0 || product.inventoryBalances.length > 0 }}
          categories={editCategories}
          onClose={() => setEditCategories(null)}
          onSaved={() => { setEditCategories(null); void reloadProduct(); }}
        />
      )}

      {/* ═══ CÓDIGOS (Fase 2, prompt-codigos-y-duplicados.md) ═══ */}
      {tab === "barcodes" && (
        <ProductBarcodesTab
          productId={product.id}
          productName={product.name}
          productSku={product.sku}
          productUnit={product.unit}
          productTotalStock={totalStock}
          standardSalePrice={Number(product.standardSalePrice)}
          autoEditPrimary={autoEditPrimaryBarcode}
        />
      )}

      {/* ═══ ACTIVIDAD: decisiones del Brain arriba, bitácora de cambios abajo ═══ */}
      {tab === "activity" && (
        <div className="space-y-5">
          <div className="space-y-3">
            <SectionRule title="Decisiones del Brain" />
            <Card noPadding>
              {product.brainDecisions.length === 0 ? (
                <p className="p-6 text-center text-sm text-[var(--color-text-muted)]">Sin decisiones del Brain para este producto.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="hm-sheet-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Estado</th>
                        <th>Severidad</th>
                        <th>Categoría</th>
                        <th>Decisión</th>
                        <th>Sucursal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {product.brainDecisions.map((d) => (
                        <tr key={d.id}>
                          <td className="whitespace-nowrap">{fmtDateTime(d.createdAt)}</td>
                          <td><Badge variant={d.status === "EXECUTED" ? "success" : d.status === "OPEN" || d.status === "MANUAL_REVIEW" ? "warning" : "neutral"}>{d.status}</Badge></td>
                          <td><Badge variant={d.severity === "HIGH" ? "danger" : d.severity === "MEDIUM" ? "warning" : "info"}>{d.severity}</Badge></td>
                          <td className="text-[var(--color-text-secondary)]">{d.category}</td>
                          <td className="font-medium text-[var(--color-text)]">{d.title}</td>
                          <td>{d.branch?.code ?? <span className="text-[var(--color-text-muted)]">GLOBAL</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-3">
            <SectionRule title="Bitácora de cambios" />
            <Card noPadding>
              {data.auditLogs.length === 0 ? (
                <p className="p-6 text-center text-sm text-[var(--color-text-muted)]">Sin registros de auditoría.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="hm-sheet-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Módulo</th>
                        <th>Acción</th>
                        <th>Sucursal</th>
                        <th>Usuario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.auditLogs.map((log) => (
                        <tr key={log.id}>
                          <td className="whitespace-nowrap">{fmtDateTime(log.occurredAt)}</td>
                          <td><Badge variant="info">{log.module}</Badge></td>
                          <td className="font-medium text-[var(--color-text)]">{log.action}</td>
                          <td>{log.branch?.code ?? <span className="text-[var(--color-text-muted)]">GLOBAL</span>}</td>
                          <td className="text-[var(--color-text-secondary)]">
                            {log.actor ? `${log.actor.fullName || log.actor.username}` : <span className="text-[var(--color-text-muted)]">Sistema</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── Precio por sucursal (Fase 3, prompt-motor-precios-lote-herencia-gobierno.md) ── */
/* La herencia YA existe (effective-pricing.ts) — esto es lo que faltaba:   */
/* que "sigue el general" vs "excepción declarada" sea visible y reversible. */
/* ═══════════════════════════════════════════════════════════════════════════ */
type BranchPricingRow = {
  branchId: string;
  branchName: string;
  followsStandard: boolean;
  effectivePrice: number | null;
  priceExceptionReason: string | null;
  priceExceptionAt: string | null;
  effectiveCost: number | null;
  marginPercent: number | null;
  /** B.3 (prompt-huecos-fase1-fase3-despliegue.md) — branchPrice de un camino de antes de este fix, sin motivo. No se inventa uno: se marca para que Master lo agregue o vuelva al general. */
  hasUnexplainedException: boolean;
};
type BranchPricingStatus = { standardSalePrice: number | null; branches: BranchPricingRow[] };

function BranchPricingBlock({
  productId,
  standardSalePriceFallback,
  assignedBranchIds,
  onToggleAssignment,
  onCorrectCost,
  onStandardPriceSaved,
}: {
  productId: string;
  standardSalePriceFallback: string;
  assignedBranchIds: Set<string>;
  onToggleAssignment: (branchId: string, isAvailable: boolean) => Promise<void>;
  onCorrectCost: (branchId: string) => void;
  onStandardPriceSaved: () => void;
}) {
  const [data, setData] = useState<BranchPricingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [exceptionFormBranchId, setExceptionFormBranchId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [reasonInput, setReasonInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Precio general (standardSalePrice) — el que siguen todas las sucursales sin precio propio.
  const [standardInput, setStandardInput] = useState<string | null>(null);

  async function saveStandardPrice(overridePriceConfirmed = false) {
    const price = Number(standardInput);
    if (!price || price <= 0) { toast.error("El precio debe ser mayor que 0."); return; }
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/catalog/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ standardSalePrice: price, overridePriceConfirmed: overridePriceConfirmed || undefined }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) {
        // Mismo aviso que la pestaña Fusiones: desviarse del precio implícito de la fusión se confirma, no se bloquea.
        if (raw?.error?.code === "PRICE_DEVIATES_FROM_FUSION" && !overridePriceConfirmed) {
          if (window.confirm(`${raw.error.message}\n\n¿Confirmás que este precio es intencional?`)) {
            setSubmitting(false);
            await saveStandardPrice(true);
          }
          return;
        }
        throw new Error(raw?.error?.message ?? "No se pudo guardar el precio general.");
      }
      toast.success("Precio general actualizado.");
      setStandardInput(null);
      onStandardPriceSaved();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar el precio general.");
    } finally {
      setSubmitting(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/master/pricing/product/${productId}/branches`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar el precio por sucursal.");
      setData(unwrapApiData(raw) as BranchPricingStatus);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cargar el precio por sucursal.");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  async function followStandard(branchId: string) {
    try {
      const res = await apiFetch("/api/master/pricing/follow-standard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, branchIds: [branchId] }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo volver al precio general.");
      toast.success("Vuelve a seguir el precio general.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo volver al precio general.");
    }
  }

  async function submitException(branchId: string) {
    const price = Number(priceInput);
    if (!price || price <= 0) { toast.error("El precio debe ser mayor que 0."); return; }
    if (reasonInput.trim().length < 3) { toast.error("El motivo debe tener al menos 3 caracteres."); return; }

    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/master/pricing/product/${productId}/branches/${branchId}/set-price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price, reason: reasonInput.trim() }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo guardar el precio de la sucursal.");
      toast.success("Precio de la sucursal guardado.");
      setExceptionFormBranchId(null);
      setPriceInput("");
      setReasonInput("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar el precio de la sucursal.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-[var(--color-border-strong)] p-8 text-center shadow-sm">
        <p className="text-sm text-[var(--color-text-muted)] animate-pulse">Cargando precio por sucursal…</p>
      </div>
    );
  }
  if (!data) return null;

  const standardPrice = data.standardSalePrice ?? Number(standardSalePriceFallback);
  const followingCount = data.branches.filter((b) => b.followsStandard).length;

  return (
    <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text)] px-5 py-3">
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          <h2 className="font-semibold" style={{ fontSize: "0.9375rem" }}>Precio y costo por sucursal</h2>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span>Precio general: <strong>{money(standardPrice)}</strong> · {followingCount} de {data.branches.length} sucursales lo siguen</span>
          {standardInput === null ? (
            <Button size="sm" variant="secondary" onClick={() => setStandardInput(String(standardPrice || ""))}>
              Cambiar precio general
            </Button>
          ) : null}
        </div>
        {standardInput !== null ? (
          <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-[var(--color-surface)] p-3 text-[var(--color-text)]">
            <label className="text-xs font-semibold text-[var(--color-text-muted)]">
              Nuevo precio general
              <Input type="number" step="0.01" min="0.01" value={standardInput} onChange={(e) => setStandardInput(e.target.value)} className="mt-1 w-36" autoFocus />
            </label>
            <p className="flex-1 text-xs text-[var(--color-text-muted)]">Cambia el precio de las {followingCount} sucursales que siguen el general. Las que tienen precio propio no cambian.</p>
            <Button size="sm" variant="success" loading={submitting} onClick={() => void saveStandardPrice()}>Guardar</Button>
            <Button size="sm" variant="ghost" onClick={() => setStandardInput(null)} disabled={submitting}>Cancelar</Button>
          </div>
        ) : null}
      </div>

      <div className="divide-y divide-[var(--color-border)]">
        {data.branches.map((b) => (
          <div key={b.branchId} className="px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="min-w-[9rem] font-medium text-[var(--color-text)]">{b.branchName}</span>
                {b.followsStandard ? (
                  <Badge variant="neutral">Sigue el general</Badge>
                ) : b.hasUnexplainedException ? (
                  <Badge variant="danger">Precio propio sin motivo</Badge>
                ) : (
                  <Badge variant="warning">Precio propio</Badge>
                )}
                {/* isAvailable = asignación manual (BranchProductSetting): no
                    es "disponible/no disponible" — sin ella el producto igual
                    aparece en la sucursal si tiene stock o historial. Antes
                    vivía en la pestaña oculta catalog-inventory?tab=pricing. */}
                <button
                  type="button"
                  title={assignedBranchIds.has(b.branchId) ? "Quitar la asignación manual de esta sucursal" : "Mostrar el producto en esta sucursal aunque no tenga stock ni historial"}
                  onClick={() => void onToggleAssignment(b.branchId, !assignedBranchIds.has(b.branchId))}
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold transition-colors ${
                    assignedBranchIds.has(b.branchId)
                      ? "bg-[var(--color-success-100)] text-[var(--color-success-700)] hover:bg-[var(--color-success-200)]"
                      : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {assignedBranchIds.has(b.branchId) ? "★ Asignado a la sucursal" : "○ Asignar a la sucursal"}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="font-mono font-semibold text-[var(--color-text)]">{b.effectivePrice === null ? "—" : money(b.effectivePrice)}</span>
                <span className="text-[var(--color-text-muted)]">costo {b.effectiveCost === null ? "—" : money(b.effectiveCost)}</span>
                <span className="text-[var(--color-text-muted)]">margen {b.marginPercent === null ? "—" : `${b.marginPercent.toFixed(0)}%`}</span>
                <button type="button" onClick={() => onCorrectCost(b.branchId)} className="text-xs font-semibold text-[var(--color-primary-600)] underline underline-offset-2">Corregir costo</button>
                {/* Fase 4.1 (prompt-mudanza-zona-precios.md) — el editor de acá se queda
                    (editar el precio mientras se mira el producto es correcto); este
                    enlace abre la Calculadora de la zona Precios con el producto y la
                    sucursal ya cargados, para quien quiera partir de costos y margen. */}
                <Link
                  href={`/app/master/pricing?tab=calculator&productId=${productId}&branchId=${b.branchId}` as Route}
                  className="flex items-center gap-1 text-xs font-medium text-[var(--color-info-700)] hover:underline"
                >
                  <Calculator className="h-3 w-3" aria-hidden="true" />
                  Calcular precio con costos y margen
                </Link>
                {/* "Cambiar precio aquí" fija (o cambia) el precio propio de
                    esta sucursal, con motivo. Antes una sucursal que ya tenía
                    precio propio solo podía "Volver al general": no había
                    forma de cambiarlo sin perderlo primero. */}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { setExceptionFormBranchId(b.branchId); setPriceInput(b.followsStandard || b.effectivePrice === null ? "" : String(b.effectivePrice)); setReasonInput(""); }}
                >
                  {b.hasUnexplainedException ? "Agregar motivo" : "Cambiar precio aquí"}
                </Button>
                {!b.followsStandard && (
                  <Button size="sm" variant="ghost" onClick={() => void followStandard(b.branchId)}>
                    Volver al general
                  </Button>
                )}
              </div>
            </div>

            {!b.followsStandard && b.priceExceptionReason && (
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                &ldquo;{b.priceExceptionReason}&rdquo; · desde {b.priceExceptionAt ? fmtDateTime(b.priceExceptionAt) : "—"}
              </p>
            )}
            {b.hasUnexplainedException && (
              <p className="mt-1 flex items-center gap-1 text-xs text-[var(--color-danger-600)]">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                Este precio se fijó antes de que el motivo fuera obligatorio. No se sabe si fue deliberado.
              </p>
            )}

            {exceptionFormBranchId === b.branchId && (
              <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-[var(--color-surface-alt)] p-3">
                <label className="text-xs font-semibold text-[var(--color-text-muted)]">
                  Precio en {b.branchName}
                  <Input type="number" step="0.01" min="0.01" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} className="mt-1 w-32" />
                </label>
                <label className="flex-1 text-xs font-semibold text-[var(--color-text-muted)]">
                  Motivo (mínimo 3 caracteres) — obligatorio
                  <Input value={reasonInput} onChange={(e) => setReasonInput(e.target.value)} placeholder="Flete, acuerdo local, competencia…" className="mt-1" />
                </label>
                <Button size="sm" variant="success" loading={submitting} onClick={() => void submitException(b.branchId)}>Guardar</Button>
                <Button size="sm" variant="ghost" onClick={() => setExceptionFormBranchId(null)} disabled={submitting}>Cancelar</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── KPI Mini Card ── */
/* ═══════════════════════════════════════════════════════════════════════════ */
// export: wac-history-tab.tsx (Fase 5) también la usa.
export function KpiMini({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  /** Ya no pinta nada (era el color de la barra en gradiente); se conserva para no tocar a quien la llama. */
  accent?: "emerald" | "blue" | "indigo" | "amber";
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-muted)]">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 text-xl font-extrabold tabular-nums text-[var(--color-text)]">{value}</p>
    </div>
  );
}

const STAT_TONE = {
  neutral: "text-[var(--color-text)]",
  success: "text-[var(--color-success-700)]",
  warning: "text-[var(--color-warning-700)]",
  danger: "text-[var(--color-danger-700)]",
} as const;

/** Una celda de la franja de números del perfil (las celdas comparten borde, no son tarjetas sueltas). */
function Stat({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: string; tone?: keyof typeof STAT_TONE }) {
  return (
    <div className="min-w-0 border-b border-r border-[var(--color-border)] px-4 py-3 -mb-px -mr-px">
      <p className="truncate text-xs font-semibold text-[var(--color-text-muted)]">{label}</p>
      <p className={`mt-0.5 truncate text-xl font-extrabold tabular-nums ${STAT_TONE[tone]}`}>{value}</p>
      <p className="truncate text-xs text-[var(--color-text-soft)]">{sub || " "}</p>
    </div>
  );
}

/** Título de sección con regla (hm-section-rule) y, opcional, un enlace a la pestaña que la amplía. */
function SectionRule({ title, action }: { title: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="hm-section-rule min-w-0 flex-1" style={{ fontSize: "0.75rem" }}>{title}</h2>
      {action ? (
        <span className="shrink-0 text-xs">
          <button type="button" onClick={action.onClick} className="font-semibold text-[var(--color-master-700)] hover:underline">{action.label}</button>
        </span>
      ) : null}
    </div>
  );
}
