"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Check, ChevronLeft, ChevronRight, DollarSign, History, Loader2, Package,
  Plus, RefreshCcw, Save, Search, Trash2, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, qty, fmtDateTime } from "@/lib/format";
import { tokenize } from "@/lib/product-search";
import { Kpi, numberOrNull, buildBranchPricingCostRow, formatMoneyOrNd, formatMarginOrNd, marginBadgeVariant } from "@/components/catalog-inventory/catalog-inventory-admin";
import type { Branch, Movement, Pagination, ProductRow, CenterData } from "@/components/catalog-inventory/catalog-inventory-admin";

/**
 * Fase 5 (prompt-flujo-velocidad.md): extraído de catalog-inventory-admin.tsx
 * (era la pestaña "movements") para poder cargarlo con next/dynamic — solo
 * se monta cuando el usuario abre esa pestaña. Incluye OpeningBalanceModal
 * (el modal de carga inicial que abre desde acá) y los helpers de Kardex
 * (MOV_LABELS, movKardexLabel, REF_LABELS, fmtRef, isKardexIn) que solo
 * este panel usaba. Mismo comportamiento, solo movido.
 */

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
  /**
   * "que el WAC deje de moverse sin que nadie lo decida" (Parte C.2) — el
   * costo promedio efectivo ANTES de cargar esta línea (el mismo motor que
   * ya usa Precios y costos: branchCost > WAC > averageCost > globalCost),
   * capturado al agregar el producto. Si `costo` termina distinto de este
   * valor, esta línea va a REEMPLAZAR el costo promedio, no solo cargar
   * existencias — se compara contra esto, no se reinventa.
   */
  baselineCost: number | null;
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
  const [showDropdown, setShowDropdown] = useState(false);
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

  // Al hacer clic en un resultado: se agrega a la tabla. El dropdown se mantiene abierto
  // para poder agregar multiples productos sin necesidad de reabrir la busqueda.
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
        baselineCost: pricing?.effectiveCost ?? null,
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
    // Parte C.2 — esta línea va a REEMPLAZAR el costo promedio (costMode
    // SET_WAC se dispara con cualquier costo > 0) si lo que se tecleó
    // difiere de lo que ya regía antes de agregarla. Con baselineCost null
    // (producto sin costo previo) cualquier costo > 0 SÍ cambia el
    // promedio (de nada a algo), así que también cuenta.
    const willChangeWac = costo != null && costo > 0
      && (line.baselineCost == null || Math.abs(costo - line.baselineCost) > 0.01);
    return { cantidad, costo, precio, enteredBase, finalBase, deltaBase, margin, priceBelowCost, validQuantity, willChangeWac };
  }

  const summary = useMemo(() => {
    let totalValue = 0;
    let withoutCost = 0;
    let withoutPrice = 0;
    let belowCost = 0;
    let invalidQty = 0;
    let wacChanges = 0;
    for (const line of lines) {
      const c = computeLine(line);
      totalValue += c.finalBase * (c.costo ?? 0);
      if (c.costo == null || c.costo <= 0) withoutCost += 1;
      if (c.precio == null || c.precio <= 0) withoutPrice += 1;
      if (c.priceBelowCost) belowCost += 1;
      if (!c.validQuantity) invalidQty += 1;
      if (c.willChangeWac) wacChanges += 1;
    }
    return { totalProducts: lines.length, totalValue, withoutCost, withoutPrice, belowCost, invalidQty, wacChanges };
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
    const allApiLines = lines.map((line) => {
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
    });

    // Split into chunks of 15 to avoid Vercel serverless timeouts on large loads
    const CHUNK_SIZE = 15;
    const chunks: typeof allApiLines[] = [];
    for (let i = 0; i < allApiLines.length; i += CHUNK_SIZE) {
      chunks.push(allApiLines.slice(i, i + CHUNK_SIZE));
    }

    setSubmitting(true);
    const progressToastId = "opening-balance-bulk";
    toast.loading(
      chunks.length > 1 ? `Procesando lote 1 de ${chunks.length}...` : "Guardando carga inicial...",
      { id: progressToastId }
    );

    try {
      let totalProcessed = 0;
      let totalSkipped = 0;

      for (let i = 0; i < chunks.length; i++) {
        if (chunks.length > 1) {
          toast.loading(`Procesando lote ${i + 1} de ${chunks.length}...`, { id: progressToastId });
        }
        const response = await apiFetch("/api/inventory/opening-balance/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branchId: activeBranchId,
            mode,
            reason: reason.trim(),
            notes: notes.trim() || undefined,
            lines: chunks[i],
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error?.message ?? payload?.message ?? "No se pudo registrar la carga inicial.");
        const result = unwrapApiData(payload);
        totalProcessed += result.processed;
        totalSkipped += result.skipped;
      }

      toast.success(`Carga inicial completa: ${totalProcessed} procesados, ${totalSkipped} sin cambio.`, { id: progressToastId });
      setLines([]);
      onClose();
      await onDone();
    } catch (error) {
      toast.dismiss(progressToastId);
      throw error;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-[var(--color-surface)] shadow-2xl"
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

          {/* Buscador de productos — multi-select: el dropdown se queda abierto */}
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-semibold text-[var(--color-text-muted)]">Buscar y agregar productos</label>
              {showDropdown && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setShowDropdown(false); setSearch(""); }}
                  className="flex items-center gap-1 rounded-lg bg-[var(--color-master-600)] px-2.5 py-1 text-xs font-bold text-white hover:bg-[var(--color-master-700)]"
                >
                  <Check className="h-3 w-3" /> Listo
                </button>
              )}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--color-text-muted)]" />
              <Input
                className="pl-9 pr-4"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nombre, SKU, codigo de barras o categoria"
                onFocus={() => setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 160)}
              />
              {showDropdown && (
                <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
                  {lines.length > 0 && (
                    <div className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-master-50)] px-3 py-1.5 text-[11px] font-bold text-[var(--color-master-700)]">
                      {lines.length} producto{lines.length > 1 ? "s" : ""} en la lista · Clic en &quot;Listo&quot; cuando termines
                    </div>
                  )}
                  {searchLoading ? (
                    <div className="flex items-center gap-2 px-3 py-3 text-xs text-[var(--color-text-muted)]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando...
                    </div>
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
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addProduct(product)}
                        disabled={alreadyAdded}
                        className={`block w-full border-b border-[var(--color-border)] px-3 py-2.5 text-left text-xs transition last:border-0 ${
                          alreadyAdded
                            ? "bg-[var(--color-success-50)] opacity-70"
                            : "hover:bg-[var(--color-surface-alt)]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-[var(--color-text)]">{product.name}</div>
                            <div className="text-[var(--color-text-muted)]">
                              {product.sku}{product.barcode ? ` · ${product.barcode}` : ""} · {product.category?.name ?? "Sin categoria"} · {product.unit}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 text-right text-[var(--color-text-muted)]">
                            <div>
                              <div>Stock <strong className="text-[var(--color-text-secondary)]">{qty(stock)}</strong></div>
                              <div>Precio <strong className="text-[var(--color-text-secondary)]">{formatMoneyOrNd(row?.effectivePrice ?? null)}</strong></div>
                              <div>Costo <strong className="text-[var(--color-text-secondary)]">{formatMoneyOrNd(row?.effectiveCost ?? null)}</strong></div>
                            </div>
                            {alreadyAdded
                              ? <Check className="h-4 w-4 shrink-0 text-[var(--color-success-600)]" />
                              : <Plus className="h-4 w-4 shrink-0 text-[var(--color-master-600)]" />}
                          </div>
                        </div>
                      </button>
                    );
                  }) : (
                    <div className="px-3 py-3 text-xs text-[var(--color-text-muted)]">Sin resultados.</div>
                  )}
                </div>
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
                    <tr key={line.productId} className={c.priceBelowCost ? "bg-[var(--color-danger-50)]" : !c.validQuantity ? "bg-[var(--color-warning-50)]" : undefined}>
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
                        {c.willChangeWac && (
                          <div className="mt-1 text-[10.5px] leading-tight text-[var(--color-warning-700)] w-28">
                            {line.baselineCost != null
                              ? <>Cambia costo prom.: {money(line.baselineCost)} → {money(c.costo as number)}</>
                              : <>Fija el costo prom. en {money(c.costo as number)}</>}
                          </div>
                        )}
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
            <div className="rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3 text-xs text-[var(--color-warning-800)]">
              Hay productos sin costo o sin precio. Quedaran registrados solo con stock, pero deben revisarse luego en Precios y costos.
            </div>
          ) : null}
          {summary.belowCost > 0 ? (
            <div className="rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-3 text-xs text-[var(--color-danger-700)]">
              Hay productos con precio por debajo del costo. Se pedira confirmacion explicita antes de guardar.
            </div>
          ) : null}
          {/* Parte C.3 — "que el WAC deje de moverse sin que nadie lo decida":
              una planilla de varias filas con costo cargado reescribe el costo
              promedio de cada una. Antes de confirmar, se ve exactamente
              cuáles y el antes/después de cada una — no una cifra ciega. */}
          {summary.wacChanges > 0 ? (
            <div className="rounded-lg border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] p-3 text-xs text-[var(--color-warning-800)]">
              <p className="font-semibold mb-1.5">
                {summary.wacChanges} {summary.wacChanges === 1 ? "línea va" : "líneas van"} a modificar el costo promedio de ese producto (no solo cargar existencias):
              </p>
              <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                {lines.filter((line) => computeLine(line).willChangeWac).map((line) => {
                  const c = computeLine(line);
                  return (
                    <li key={line.productId} className="font-mono">
                      {line.sku} — {line.name}: {line.baselineCost != null ? money(line.baselineCost) : "sin costo"} → {money(c.costo as number)}
                    </li>
                  );
                })}
              </ul>
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
function isKardexIn(type: string) {
  return type.endsWith("_IN") || type === "PURCHASE_IN" || type === "PRODUCTION_OUTPUT";
}

/* ═══════════════════════════════════════════════════════════
   MOVEMENTS PANEL
   ═══════════════════════════════════════════════════════════ */
export function MovementsPanel({
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
          <Button variant="primary" size="sm" onClick={() => setShowAdjustment(true)} icon={<Plus className="h-4 w-4" />}>Ajuste manual</Button>
          <Button variant="success" size="sm" onClick={() => setShowOpening(true)} icon={<Package className="h-4 w-4" />}>Carga inicial</Button>
        </div>
      </div>
      <div className="p-4 space-y-4">
        {/* 7 controles de filtro de ancho similar y cantidad fija — auto-fit
            se acomoda solo a cualquier ancho en vez de necesitar más
            breakpoints (mismo patrón que pos-catalog-panel.tsx). */}
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
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
                      <div className="text-[11px] font-medium text-[var(--color-text-secondary)]">{ref.label}</div>
                      <div className="font-mono text-[10px] text-[var(--color-text-muted)]">{ref.shortId}</div>
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
        <OpeningBalanceModal
          branches={branches}
          fallbackProducts={products}
          activeBranchId={activeBranchId}
          onSelectBranch={onSelectBranch}
          onClose={() => setShowOpening(false)}
          onDone={onDone}
        />
      ) : null}
    </>
  );
}
