"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Check, ChevronLeft, ChevronRight, DollarSign, History, Package,
  Plus, RefreshCcw, Save,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, qty, fmtDateTime } from "@/lib/format";
import { tokenize } from "@/lib/product-search";
import { numberOrNull } from "@/components/catalog-inventory/catalog-inventory-admin";
import { IntakeSheet } from "@/components/inventory-intake/intake-sheet";
import { IntakeHistoryPanel } from "@/components/inventory-intake/intake-history-panel";
import type { Branch, Movement, Pagination, ProductRow } from "@/components/catalog-inventory/catalog-inventory-admin";

/**
 * Fase 5 (prompt-flujo-velocidad.md): extraído de catalog-inventory-admin.tsx
 * (era la pestaña "movements") para poder cargarlo con next/dynamic — solo
 * se monta cuando el usuario abre esa pestaña. Incluye los helpers de Kardex
 * (MOV_LABELS, movKardexLabel, REF_LABELS, fmtRef, isKardexIn) que solo este
 * panel usaba. Mismo comportamiento, solo movido.
 *
 * Fase 2 (prompt-entrada-inventario.md): OpeningBalanceModal (el modal viejo
 * de "Carga inicial", con Una/Varias sucursales) se reemplaza acá por
 * IntakeSheet — sumar, contar o cargar, unificado. La limpieza del código
 * muerto que deja (createOpeningBalanceBulk/opening-balance/bulk en
 * hammer-api) es Fase 3.
 */

/* ─── Kardex helpers ─────────────────────────────────────── */
const MOV_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  PURCHASE_IN:        { label: "Compra",          color: "#16a34a", bg: "#f0fdf4" },
  SALE_OUT:           { label: "Venta",            color: "#dc2626", bg: "#fef2f2" },
  ADJUSTMENT_IN:      { label: "Ajuste +",         color: "#2563eb", bg: "#eff6ff" },
  ADJUSTMENT_OUT:     { label: "Ajuste −",         color: "#ea580c", bg: "#fff7ed" },
  RETURN_IN:          { label: "Devolución +",     color: "#16a34a", bg: "#f0fdf4" },
  RETURN_OUT:         { label: "Devolución −",     color: "#dc2626", bg: "#fef2f2" },
  TRANSFER_IN:        { label: "Traslado +",       color: "#7c3aed", bg: "#f5f3ff" },
  TRANSFER_OUT:       { label: "Traslado −",       color: "#7c3aed", bg: "#f5f3ff" },
  TIMBER_INTAKE_IN:   { label: "Entrada madera",   color: "#92400e", bg: "#fffbeb" },
  PRODUCTION_CONSUME: { label: "Consumo prod.",    color: "#dc2626", bg: "#fef2f2" },
  PRODUCTION_OUTPUT:  { label: "Salida prod.",     color: "#16a34a", bg: "#f0fdf4" },
  PRODUCTION_WASTE:   { label: "Merma prod.",      color: "#ea580c", bg: "#fff7ed" },
  PACKAGE_IN:         { label: "Paquete +",        color: "#2563eb", bg: "#eff6ff" },
  PACKAGE_SALE_OUT:   { label: "Paquete venta",    color: "#dc2626", bg: "#fef2f2" },
  PACKAGE_OPENED:     { label: "Paquete abierto",  color: "#6b7280", bg: "#f9fafb" },
  PACKAGE_CLOSED:     { label: "Paquete cerrado",  color: "#6b7280", bg: "#f9fafb" },
  LOOSE_UNIT_SALE_OUT:{ label: "Unidad suelta −",  color: "#dc2626", bg: "#fef2f2" },
  LOOSE_ADJUSTMENT:   { label: "Ajuste suelto",    color: "#ea580c", bg: "#fff7ed" },
  // prompt-codigos-y-duplicados.md Fase 3 — unificar productos duplicados.
  PRODUCT_MERGE_IN:   { label: "Unificación +",    color: "#2563eb", bg: "#eff6ff" },
  PRODUCT_MERGE_OUT:  { label: "Unificación −",    color: "#ea580c", bg: "#fff7ed" },
};
function movKardexLabel(type: string) {
  return MOV_LABELS[type] ?? { label: type, color: "#6b7280", bg: "#f9fafb" };
}
const REF_LABELS: Record<string, string> = {
  OPENING_BALANCE:       "Carga inicial",
  OPENING_BALANCE_BULK:  "Carga inicial masiva",
  MANUAL_ADJUSTMENT:     "Ajuste manual",
  SALE:                  "Venta",
  SALE_RETURN:           "Devolución venta",
  PURCHASE:              "Compra",
  TRANSFER:              "Traslado",
  PRODUCTION:            "Producción",
  IMPORT:                "Importación",
  MANUAL:                "Manual",
};
function fmtRef(type: string, id: string) {
  const label = REF_LABELS[type] ?? type;
  const shortId = id.startsWith("OPENING-BULK-")
    ? `Lote #${id.split("-").pop()}`
    : id.length > 16 ? `${id.slice(0, 14)}…` : id;
  return { label, shortId };
}
// Fase 3 (prompt-entrada-inventario.md) — "Entrada IM-000123 (Sumar/Conteo/Carga inicial)".
const INTAKE_KIND_LABELS: Record<string, string> = {
  ADD_STOCK: "Sumar",
  ADJUSTMENT_IN: "Sumar",
  PHYSICAL_COUNT: "Conteo",
  OPENING_BALANCE: "Carga inicial",
};
function isKardexIn(type: string) {
  return type.endsWith("_IN") || type === "PURCHASE_IN" || type === "PRODUCTION_OUTPUT";
}

/* ═══════════════════════════════════════════════════════════
   MOVEMENTS PANEL
   ═══════════════════════════════════════════════════════════ */
export function MovementsPanel({
  view,
  branches,
  products,
  movements,
  selectedBranchId,
  initialDialog,
  onInitialDialogHandled,
  onSelectBranch,
  onDone,
}: {
  /** prompt-inventario-unificado.md Commit 1 — Kardex/Entradas/Conteos ahora son 3 URLs reales (antes compartían tab=movements con un selector interno duplicado de la barra superior); la barra decide la vista, este panel ya no tiene su propio selector de pestaña. */
  view: "kardex" | "intakes" | "counts";
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
    // Fusión de Inventario v2, Fase 1.3: conteo físico dual ("conté X cajas
    // cerradas + Y sueltas") para productos de un grupo con paquetes.
    closedPackageCount: "0",
    looseUnitCount: "0",
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
  // Factor de conversión entre saleUnit y baseUnit del propio grupo — nunca
  // hardcodeado por código de grupo (ver shared-stock-format.ts). null cuando
  // no hay fusión o el factor es 1 (mostrar ambas unidades sería redundante).
  const adjustmentConversionFactor = (() => {
    const raw = Number(adjustmentProduct?.stockConversion?.conversionFactor ?? 0);
    return raw > 0 && raw !== 1 ? raw : null;
  })();
  const isBaseUnit = !!adjustmentProduct?.stockConversion && adjustment.unit === adjustmentProduct.stockConversion.baseUnit;
  const currentBaseStock = currentBaseStockForProduct(adjustmentProduct);
  const changeBaseQty = Number.isFinite(adjustmentQty)
    ? (adjustmentProduct?.stockConversion && !isBaseUnit ? adjustmentQty * Number(adjustmentProduct.stockConversion.conversionFactor || 1) : adjustmentQty)
    : 0;
  const direction = ["ADJUSTMENT_OUT", "DAMAGE"].includes(adjustment.adjustmentType) ? -1 : 1;
  const previewFinalBase = adjustment.adjustmentType === "PHYSICAL_COUNT" ? changeBaseQty : currentBaseStock + (direction * changeBaseQty);

  // Fusión de Inventario v2, Fase 1.3: conteo físico dual — solo aplica en
  // PHYSICAL_COUNT sobre un producto de grupo con paquetes ("cajas cerradas +
  // sueltas"), un solo campo de cantidad para todo lo demás.
  const isDualPhysicalCount = adjustment.adjustmentType === "PHYSICAL_COUNT" && Boolean(adjustmentProduct?.stockConversion?.tracksPackages);
  const currentBranchBalance = adjustmentProduct?.allSharedInventoryBalances?.find((item) => item.branchId === activeBranchId);
  const currentClosedCount = numberOrNull(currentBranchBalance?.closedPackageQuantity) ?? 0;
  const currentLooseCount = numberOrNull(currentBranchBalance?.looseUnitQuantity) ?? 0;

  async function submitAdjustment(event: React.FormEvent) {
    event.preventDefault();
    if (!activeBranchId) { toast.error("Selecciona una sucursal."); return; }
    if (!adjustment.productId) { toast.error("Selecciona un producto."); return; }
    if (!adjustment.reason.trim()) { toast.error("El motivo es obligatorio."); return; }
    const closedCountValue = Number(adjustment.closedPackageCount);
    const looseCountValue = Number(adjustment.looseUnitCount);
    if (isDualPhysicalCount) {
      if (!Number.isFinite(closedCountValue) || closedCountValue < 0 || !Number.isFinite(looseCountValue) || looseCountValue < 0) {
        toast.error("Las cajas y sueltas contadas no pueden ser negativas.");
        return;
      }
    } else {
      if (!Number.isFinite(adjustmentQty) || adjustmentQty <= 0) { toast.error("La cantidad debe ser mayor que cero."); return; }
      if (previewFinalBase < 0) { toast.error("La salida supera el stock disponible."); return; }
    }
    setSubmitting(true);
    try {
      const response = await apiFetch("/api/inventory/manual-adjustment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: activeBranchId,
          productId: adjustment.productId,
          adjustmentType: adjustment.adjustmentType,
          reason: adjustment.reason.trim(),
          notes: adjustment.notes.trim() || undefined,
          ...(isDualPhysicalCount
            ? { physicalCount: { closedPackageQuantity: closedCountValue, looseUnitQuantity: looseCountValue } }
            : { quantity: adjustmentQty, unit: adjustment.unit }),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? payload?.message ?? "No se pudo registrar el ajuste.");
      toast.success("Ajuste manual registrado.");
      setShowAdjustment(false);
      setAdjustment((prev) => ({ ...prev, quantity: "1", reason: "", notes: "", closedPackageCount: "0", looseUnitCount: "0" }));
      await onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
    <Card noPadding>
      <div className="flex items-center justify-between px-4 py-3" style={{ background: "var(--color-surface-alt)", borderBottom: "0.5px solid var(--color-border)" }}>
        <div className="flex items-center gap-2">
          <History className="h-4 w-4" style={{ color: "var(--color-master-600)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Movimientos / Kardex</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={() => setShowAdjustment(true)} icon={<Plus className="h-4 w-4" />}>Ajuste de salida</Button>
          <Button variant="success" size="sm" onClick={() => setShowOpening(true)} icon={<Package className="h-4 w-4" />}>Entrada de inventario</Button>
        </div>
      </div>
      {view === "intakes" ? (
        <div className="p-4">
          <IntakeHistoryPanel />
        </div>
      ) : view === "counts" ? (
        <div className="p-4">
          <IntakeHistoryPanel kindFilter="PHYSICAL_COUNT" />
        </div>
      ) : (
      <div className="p-4 space-y-4">
        {/* Antes había acá un <select> de sucursal propio, duplicado del
            de la barra superior (prompt-inventario-unificado.md bug #4) —
            selectedBranchId ya viene de useInventoryScope() en el padre. 6
            controles de filtro de ancho similar — auto-fit se acomoda solo
            a cualquier ancho en vez de necesitar más breakpoints (mismo
            patrón que pos-catalog-panel.tsx). */}
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
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
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="hm-table min-w-[1100px] w-full">
            <thead>
              <tr>
                <th className="w-[140px]">Fecha</th>
                <th>Producto</th>
                <th className="w-[90px]">Sucursal</th>
                <th className="w-[140px]">Tipo</th>
                <th className="text-right w-[90px]">Entrada</th>
                <th className="text-right w-[90px]">Salida</th>
                <th className="text-right w-[90px]">Costo unit.</th>
                <th className="w-[70px]">Unidad</th>
                <th className="w-[120px]">Referencia</th>
                <th>Motivo / nota</th>
                <th className="w-[110px]">Usuario</th>
              </tr>
            </thead>
            <tbody>
              {pagedMovements.map((item) => {
                const qty_ = Number(item.inputQuantity ?? item.quantity);
                const isIn = isKardexIn(item.movementType);
                const lbl = movKardexLabel(item.movementType);
                const ref = fmtRef(item.referenceType, item.referenceId);
                const unit = item.inputUnit ?? item.baseUnit ?? "UN";
                const nota = [item.reason, item.notes].filter(Boolean).join(" · ") || null;
                return (
                  <tr key={item.id} className="group hover:bg-[var(--color-surface-alt)]">
                    <td className="whitespace-nowrap text-xs text-[var(--color-text-secondary)]">
                      {fmtDateTime(item.createdAt)}
                    </td>
                    <td>
                      <div className="font-medium text-[var(--color-text)] leading-tight">{item.product.name}</div>
                      <div className="font-mono text-[10px] text-[var(--color-text-muted)]">{item.product.sku}</div>
                    </td>
                    <td>
                      <span className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-bold"
                        style={{ background: "var(--color-master-50)", color: "var(--color-master-700)" }}>
                        {item.branch.code}
                      </span>
                    </td>
                    <td>
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{ background: lbl.bg, color: lbl.color }}>
                        {lbl.label}
                      </span>
                    </td>
                    <td className="text-right font-mono font-semibold" style={{ color: "#16a34a" }}>
                      {isIn ? `+${qty(qty_)}` : ""}
                    </td>
                    <td className="text-right font-mono font-semibold" style={{ color: "#dc2626" }}>
                      {!isIn ? `−${qty(qty_)}` : ""}
                    </td>
                    <td className="text-right font-mono text-xs text-[var(--color-text-secondary)]">
                      {money(item.unitCost)}
                    </td>
                    <td className="text-xs text-[var(--color-text-muted)] font-mono">{unit}</td>
                    <td>
                      {item.intakeDocument ? (
                        <button
                          type="button"
                          onClick={() => { setMovementSearch(item.referenceId); resetMovementPage(); }}
                          className="text-left hover:underline"
                          title="Filtrar el kardex por este documento de entrada"
                        >
                          <div className="text-[11px] font-medium text-[var(--color-master-700)]">Entrada {item.intakeDocument.code}</div>
                          <div className="text-[10px] text-[var(--color-text-muted)]">{INTAKE_KIND_LABELS[item.intakeDocument.kind] ?? item.intakeDocument.kind}</div>
                        </button>
                      ) : (
                        <>
                          <div className="text-[11px] font-medium text-[var(--color-text-secondary)]">{ref.label}</div>
                          <div className="font-mono text-[10px] text-[var(--color-text-muted)]">{ref.shortId}</div>
                        </>
                      )}
                    </td>
                    <td className="max-w-[180px]">
                      {nota ? (
                        <span className="text-xs text-[var(--color-text-secondary)] line-clamp-2" title={nota}>{nota}</span>
                      ) : (
                        <span className="text-xs text-[var(--color-text-muted)]">—</span>
                      )}
                    </td>
                    <td className="text-xs text-[var(--color-text-secondary)]">
                      {item.userName ?? <span className="text-[var(--color-text-muted)]">Sistema</span>}
                    </td>
                  </tr>
                );
              })}
              {pagedMovements.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-10 text-center text-sm text-[var(--color-text-muted)]">
                    {loadingMovements ? "Cargando movimientos…" : "Sin movimientos para los filtros seleccionados."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      )}
      </Card>
      {/* Modales fuera del Card para evitar cualquier contexto de apilamiento del shadow/border */}
      {showAdjustment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form className="w-full max-w-2xl rounded-xl bg-[var(--color-surface)] shadow-2xl" onSubmit={(event) => submitAdjustment(event).catch((error) => toast.error(error instanceof Error ? error.message : "No se pudo registrar ajuste."))}>
            <div className="border-b border-[var(--color-border)] px-5 py-4">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Registrar ajuste manual</h3>
              <p className="text-xs text-[var(--color-text-muted)]">Solo modifica cantidad/volumen. No se edita costo desde Kardex.</p>
            </div>
            <div className="grid gap-3 p-5 md:grid-cols-2">
              <select className="hm-input" value={activeBranchId} onChange={(e) => onSelectBranch(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}</select>
              <select className="hm-input" value={adjustment.productId} onChange={(e) => {
                const nextProduct = products.find((p) => p.id === e.target.value);
                setAdjustment({ ...adjustment, productId: e.target.value, unit: nextProduct?.stockConversion?.saleUnit ?? nextProduct?.unit ?? "UN" });
              }}>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}</select>
              <select className="hm-input" value={adjustment.adjustmentType} onChange={(e) => {
                const nextType = e.target.value;
                // Al entrar a conteo fisico dual, precarga la composicion
                // ACTUAL para que el usuario solo corrija lo que cambio.
                const prefillDual = nextType === "PHYSICAL_COUNT" && adjustmentProduct?.stockConversion?.tracksPackages
                  ? { closedPackageCount: String(currentClosedCount), looseUnitCount: String(currentLooseCount) }
                  : {};
                setAdjustment({ ...adjustment, adjustmentType: nextType, ...prefillDual });
              }}>
                <option value="ADJUSTMENT_IN">Entrada manual</option>
                <option value="ADJUSTMENT_OUT">Salida manual</option>
                <option value="PHYSICAL_COUNT">Correccion por conteo fisico</option>
                <option value="DAMAGE">Merma / dano</option>
                <option value="RETURN">Devolucion</option>
                <option value="OTHER">Otro</option>
              </select>
              {isDualPhysicalCount ? (
                <div className="md:col-span-2 grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-[var(--color-text-muted)]">
                      {adjustmentProduct?.stockConversion?.packageUnit ?? "Cajas"} cerradas contadas
                    </label>
                    <Input type="number" min="0" step="1" value={adjustment.closedPackageCount} onChange={(e) => setAdjustment({ ...adjustment, closedPackageCount: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[var(--color-text-muted)]">
                      {adjustmentProduct?.stockConversion?.baseUnit ?? "Sueltas"} contadas
                    </label>
                    <Input type="number" min="0" step="0.0001" value={adjustment.looseUnitCount} onChange={(e) => setAdjustment({ ...adjustment, looseUnitCount: e.target.value })} placeholder="0" />
                  </div>
                </div>
              ) : (
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
              )}
              <Input className="md:col-span-2" value={adjustment.reason} onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })} placeholder="Motivo obligatorio" />
              <Input className="md:col-span-2" value={adjustment.notes} onChange={(e) => setAdjustment({ ...adjustment, notes: e.target.value })} placeholder="Observacion opcional" />
              <div className="md:col-span-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-sm">
                <div className="font-semibold text-[var(--color-text)]">Vista previa</div>
                {isDualPhysicalCount ? (
                  <div className="mt-1 grid gap-1 text-xs text-[var(--color-text-muted)] sm:grid-cols-2">
                    <span>Composicion actual: {qty(currentClosedCount)} {adjustmentProduct?.stockConversion?.packageUnit} + {qty(currentLooseCount)} {adjustmentProduct?.stockConversion?.baseUnit}</span>
                    <span>Composicion nueva: {qty(Number(adjustment.closedPackageCount) || 0)} {adjustmentProduct?.stockConversion?.packageUnit} + {qty(Number(adjustment.looseUnitCount) || 0)} {adjustmentProduct?.stockConversion?.baseUnit}</span>
                  </div>
                ) : (
                  <div className="mt-1 grid gap-1 text-xs text-[var(--color-text-muted)] sm:grid-cols-3">
                    <span>Actual: {qty(currentBaseStock)} {adjustmentProduct?.stockConversion?.baseUnit ?? adjustmentProduct?.unit ?? ""}</span>
                    <span>Cambio base: {qty(direction * changeBaseQty)}</span>
                    <span>Final: {qty(previewFinalBase)} {adjustmentProduct?.stockConversion?.baseUnit ?? adjustmentProduct?.unit ?? ""}</span>
                  </div>
                )}
                {adjustmentProduct?.stockConversion && !isDualPhysicalCount ? (
                  <div className="mt-2 text-xs text-[var(--color-text-muted)]">
                    Stock final convertible: {qty(previewFinalBase)} {adjustmentProduct.stockConversion.baseUnit.toLowerCase()}
                    {adjustmentConversionFactor ? ` / ${qty(previewFinalBase / adjustmentConversionFactor)} ${adjustmentProduct.stockConversion.saleUnit.toLowerCase()}` : ""}
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
        <IntakeSheet
          branches={branches}
          fallbackProducts={products}
          activeBranchId={activeBranchId}
          onSelectBranch={onSelectBranch}
          onClose={() => setShowOpening(false)}
          onDone={onDone}
          onViewKardex={(intakeId) => {
            // setMovementSearch dispara el useEffect existente (depende de
            // movementSearch) — no hace falta llamar loadMovements a mano.
            setMovementSearch(intakeId);
            resetMovementPage();
          }}
        />
      ) : null}
    </>
  );
}
