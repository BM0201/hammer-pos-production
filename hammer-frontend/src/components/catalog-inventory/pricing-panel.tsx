"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { DollarSign, Loader2, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tokenize } from "@/lib/product-search";
import { buildBranchPricingCostRow, formatMoneyOrNd, formatMarginOrNd, marginBadgeVariant } from "@/components/catalog-inventory/catalog-inventory-admin";
import type { Branch, ProductRow } from "@/components/catalog-inventory/catalog-inventory-admin";

/**
 * Fase 5 (prompt-flujo-velocidad.md): extraído de catalog-inventory-admin.tsx
 * (era la pestaña "pricing") para poder cargarlo con next/dynamic — solo se
 * monta cuando el usuario abre esa pestaña. Mismo comportamiento, solo
 * movido. La lógica de guardado (onSave/onSaveGlobalCost/
 * onToggleBranchAssignment) sigue viviendo en el componente padre — este
 * panel solo la recibe por props, no la reimplementa.
 */

/* ═══════════════════════════════════════════════════════════
   PRICING PANEL — FULL REWRITE
   Pre-populates inputs with current branchProductSettings,
   uses controlled state, shows save button per cell, toast.
   ═══════════════════════════════════════════════════════════ */
/** Parte B (prompt-huecos-fase1-fase3-despliegue.md) — reason: visible y obligatorio (≥3 caracteres) solo mientras la celda está dirty, cierra el hueco de "excepción sin motivo" que este editor creaba. */
type PricingDraft = Record<string, Record<string, { price: string; dirty: boolean; reason: string }>>;

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
        reason: "",
      };
    }
  }
  return draft;
}

/**
 * "el ultimo costo que se meta es el que gana en las fusiones... con las
 * derivadas y la factorización equivalente al producto se ajuste" — el
 * costo de compra de un miembro DERIVADO ahora se edita en su propia fila
 * (el backend redirige y convierte al canónico, ver resolveGlobalCostWriteTarget
 * en catalog/service.ts) — este es el valor que se pre-carga en ese input:
 * el costo efectivo YA convertido a la unidad de ESTA presentación
 * (row.effectiveCost), no product.globalCost (que para un derivado
 * siempre es null — nunca guarda su propio costo, esa regla no cambió).
 */
function globalCostServerValue(product: ProductRow, activeBranch: Branch | null | undefined): string {
  if (product.stockConversion && !product.stockConversion.isCanonical && activeBranch) {
    const row = buildBranchPricingCostRow(product, activeBranch);
    return row.effectiveCost != null ? String(row.effectiveCost) : "";
  }
  return product.globalCost != null ? String(product.globalCost) : "";
}

export function PricingPanel({
  branches,
  products,
  selectedBranchId,
  focusedProductId,
  missingPriceCount,
  onlyMissing,
  onToggleOnlyMissing,
  onSelectBranch,
  onSave,
  onSaveGlobalCost,
  onToggleBranchAssignment,
}: {
  branches: Branch[];
  products: ProductRow[];
  selectedBranchId?: string;
  focusedProductId?: string | null;
  missingPriceCount: number;
  onlyMissing: boolean;
  onToggleOnlyMissing: () => void;
  onSelectBranch: (branchId: string) => void;
  onSave: (product: ProductRow, branch: Branch, field: "branchPrice", value: string, reason?: string) => Promise<void>;
  onSaveGlobalCost?: (product: ProductRow, value: string) => Promise<void>;
  onToggleBranchAssignment?: (product: ProductRow, branchId: string, isAvailable: boolean) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PricingDraft>(() => buildPricingDraft(products, branches));
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [productFilter, setProductFilter] = useState("");
  const productsRef = useRef(products);
  // docs/COSTO-UNA-FUENTE.md (C.4) — "Precios y costos" es por definición
  // por sucursal (edita branchPrice/branchCost, campos que no existen sin
  // una). Antes caía a branches[0] en silencio, tanto acá como en un
  // useEffect que además reescribía el branchId COMPARTIDO con el resto
  // de la pantalla (el mismo select de "Sucursal" de la barra de filtros
  // controla este panel) — entrar a esta pestaña sin sucursal elegida
  // mutaba la selección global sin que nadie lo pidiera. Ahora sin
  // sucursal, activeBranch es null y el panel lo pide explícito.
  const activeBranch = useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId) ?? null,
    [branches, selectedBranchId],
  );
  const pricingBranches = useMemo(() => activeBranch ? [activeBranch] : [], [activeBranch]);
  // activeBranch tiene que existir ANTES de este estado — para un miembro
  // derivado, el valor inicial sale de globalCostServerValue (el costo
  // efectivo YA convertido a su unidad), que necesita la sucursal activa.
  const [globalCostDraft, setGlobalCostDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(products.map((p) => [p.id, globalCostServerValue(p, activeBranch)]))
  );

  const filteredProducts = useMemo(() => products.filter((product) => {
    if (focusedProductId && product.id !== focusedProductId) return false;
    const tokens = tokenize(productFilter);
    if (tokens.length === 0) return true;
    const text = `${product.name} ${product.sku} ${product.category?.name ?? ""}`.toUpperCase();
    return tokens.every((token) => text.includes(token));
  }), [focusedProductId, productFilter, products]);

  // Re-sync draft when products reference changes (after external load).
  //
  // Antes esto reconstruía los drafts DESDE CERO en cada recarga (guardar un
  // precio/costo, buscar, filtrar…), borrando cualquier valor que el usuario
  // estuviera tecleando en OTRA fila sin guardar: el "se resetea solo" que
  // reportó el usuario. Ahora se fusiona: se toman los valores del servidor
  // pero se conservan las celdas de precio marcadas dirty y los costos que el
  // usuario cambió y todavía no guardó.
  //
  // También re-sincroniza cuando cambia la sucursal activa SIN una recarga
  // nueva de products (branchEffectivePricing ya trae todas las sucursales
  // en la misma carga) — si no, el costo pre-cargado de un derivado
  // (globalCostServerValue, branch-aware) quedaría mostrando la sucursal
  // anterior hasta la próxima recarga real.
  const activeBranchIdRef = useRef(activeBranch?.id);
  useEffect(() => {
    if (productsRef.current !== products || activeBranchIdRef.current !== activeBranch?.id) {
      productsRef.current = products;
      activeBranchIdRef.current = activeBranch?.id;
      const serverDraft = buildPricingDraft(products, branches);
      setDraft((prev) => {
        for (const product of products) {
          const prevRow = prev[product.id];
          if (!prevRow) continue;
          for (const branch of branches) {
            if (prevRow[branch.id]?.dirty) {
              serverDraft[product.id][branch.id] = prevRow[branch.id];
            }
          }
        }
        return serverDraft;
      });
      setGlobalCostDraft((prev) => {
        const next: Record<string, string> = {};
        for (const product of products) {
          const serverValue = globalCostServerValue(product, activeBranch);
          const prevValue = prev[product.id];
          // El usuario tecleó algo distinto al valor del servidor y aún no lo
          // guardó → se conserva su edición en curso; si coincide, se toma el
          // valor del servidor (ya guardado / actualizado).
          next[product.id] = prevValue !== undefined && prevValue !== serverValue ? prevValue : serverValue;
        }
        return next;
      });
    }
  }, [products, branches, activeBranch]);

  function updateCell(productId: string, branchId: string, field: "price", value: string) {
    setDraft((prev) => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        [branchId]: { ...prev[productId][branchId], [field]: value, dirty: true },
      },
    }));
  }

  function updateReason(productId: string, branchId: string, value: string) {
    setDraft((prev) => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        [branchId]: { ...prev[productId][branchId], reason: value },
      },
    }));
  }

  async function saveCell(product: ProductRow, branch: Branch, field: "price") {
    const cell = draft[product.id]?.[branch.id];
    if (!cell) return;
    // Parte B.2 — obligatorio, mínimo 3 caracteres, solo cuando se está
    // FIJANDO un precio (no al limpiarlo a vacío = volver a seguir el
    // general, que no exige motivo). Validación del lado del cliente — el
    // servidor (setBranchPriceTx) la exige igual, el payload se puede editar.
    if (cell.price.trim() !== "" && cell.reason.trim().length < 3) {
      toast.error("Escribí el motivo de este precio (mínimo 3 caracteres).");
      return;
    }
    const apiField = "branchPrice";
    const key = `${product.id}-${branch.id}-${field}`;
    setSavingKey(key);
    try {
      await onSave(product, branch, apiField, cell[field], cell.reason.trim());
      // Mark cell as no longer dirty after successful save (optimistic)
      setDraft((prev) => ({
        ...prev,
        [product.id]: {
          ...prev[product.id],
          [branch.id]: { ...prev[product.id][branch.id], dirty: false, reason: "" },
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
        if (cell.price.trim() !== "" && cell.reason.trim().length < 3) {
          toast.error(`Escribí el motivo del precio de ${branch.code} (mínimo 3 caracteres).`);
          continue;
        }
        await onSave(product, branch, "branchPrice", cell.price, cell.reason.trim());
        saved++;
      }
    }
    if (saved > 0) {
      // Mark all cells for this product as not dirty
      setDraft((prev) => {
        const updated = { ...prev[product.id] };
        for (const branch of pricingBranches) {
          if (updated[branch.id]) updated[branch.id] = { ...updated[branch.id], dirty: false, reason: "" };
        }
        return { ...prev, [product.id]: updated };
      });
    } else {
      toast("Sin cambios pendientes", { icon: "ℹ️" });
    }
  }

  const healthyMarginCount = filteredProducts.reduce((count, product) => {
    if (!activeBranch) return count;
    const row = buildBranchPricingCostRow(product, activeBranch);
    return marginBadgeVariant(row.effectiveMarginPercent) === "success" ? count + 1 : count;
  }, 0);

  return (
    <Card noPadding>
      <div className="hm-card-header-green">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <DollarSign className="h-4 w-4" /> Precios de venta {activeBranch ? `· ${activeBranch.code} · ${activeBranch.name}` : ""}
        </h2>
        <p className="mt-0.5 text-xs opacity-90">El costo de compra es el mismo para todas las sucursales. El precio de venta es obligatorio en esta vista.</p>
      </div>

      {/* Franja de costo global — solo lectura/enlace, el costo se gestiona una sola vez */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-info-100)] text-[var(--color-info-700)]">
            <DollarSign className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">Costos de compra</p>
            <p className="text-xs text-[var(--color-text-muted)]">Se gestionan una sola vez y aplican a todas las sucursales</p>
          </div>
        </div>
      </div>

      {/* Franja de KPIs */}
      <div className="flex flex-wrap gap-2 px-4 pt-3">
        <div className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm">
          <span className="font-bold text-[var(--color-text)]">{filteredProducts.length}</span>{" "}
          <span className="text-xs text-[var(--color-text-muted)]">productos cargados{activeBranch ? ` en ${activeBranch.code}` : ""}</span>
        </div>
        <div className="rounded-lg border border-[var(--color-danger-200)] px-3 py-1.5 text-sm">
          <span className="font-bold text-[var(--color-danger-600)]">{missingPriceCount}</span>{" "}
          <span className="text-xs text-[var(--color-text-muted)]">sin precio asignado</span>
        </div>
        <div className="rounded-lg border border-[var(--color-success-200)] px-3 py-1.5 text-sm">
          <span className="font-bold text-[var(--color-success-700)]">{healthyMarginCount}</span>{" "}
          <span className="text-xs text-[var(--color-text-muted)]">con margen saludable</span>
        </div>
      </div>

      {/* Branch pricing filters */}
      <div className="grid gap-2 px-4 pt-3 md:grid-cols-[240px_1fr_auto_auto_auto]">
        <select className="hm-input" value={activeBranch?.id ?? ""} onChange={(event) => onSelectBranch(event.target.value)}>
          <option value="">Elegí una sucursal</option>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>)}
        </select>
        <Input value={productFilter} onChange={(event) => setProductFilter(event.target.value)} placeholder="Buscar producto, SKU o categoria" />
        <Button variant={onlyMissing ? "secondary" : "ghost"} onClick={onToggleOnlyMissing}>Solo sin precio</Button>
        <Button variant={comparisonMode ? "secondary" : "ghost"} onClick={() => setComparisonMode((value) => !value)}>Vista comparativa</Button>
        <Button variant="ghost" onClick={() => setProductFilter("")}>Limpiar</Button>
      </div>
      {/* C.4 — esta pantalla edita branchPrice/branchCost, campos que no
          existen sin sucursal: a diferencia de Catálogo (que sí tiene
          sentido en red), acá no hay nada que editar sin elegir una. */}
      {!activeBranch ? (
        <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
          Elegí una sucursal arriba para ver y editar precios y costos — esta vista es por sucursal.
        </p>
      ) : null}
      {comparisonMode ? (
        <div className="overflow-x-auto p-4">
          <table className="hm-table min-w-[900px] w-full">
            <thead><tr><th>Producto</th>{branches.map((branch) => <th key={branch.id}>{branch.code} precio / costo</th>)}<th>Modo</th></tr></thead>
            <tbody>
              {filteredProducts.map((product) => (
                <tr key={product.id}>
                  <td className="font-medium">{product.sku} - {product.name}</td>
                  {branches.map((branch) => {
                    const row = buildBranchPricingCostRow(product, branch);
                    return (
                      <td key={branch.id} className="text-xs">
                        <div>Precio: {formatMoneyOrNd(row.effectivePrice)} ({row.priceSource === "BRANCH" ? "Sucursal" : row.priceSource === "STANDARD" ? "Precio general" : row.priceSource === "FUSION_DERIVED" ? "Derivado de fusión" : "Sin precio"})</div>
                        <div className="flex items-center gap-1">
                          <span>Costo de compra: {formatMoneyOrNd(row.effectiveCost)} <span className="text-[var(--color-text-muted)]">· {row.costExplanation}</span></span>
                          {/* Parte B (prompt-precios-mejoras-bandeja-visibilidad.md) — visibilidad, no bloqueo: esta sucursal NO usa el costo global. */}
                          {row.costSource === "BRANCH" && (
                            <Badge variant="info" title="Este producto NO usa el costo global en esta sucursal — alguien fijó un costo manual aquí.">Manual</Badge>
                          )}
                        </div>
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
      {activeBranch ? (
      <div className="overflow-x-auto p-4">
        <table className="hm-table min-w-[900px] w-full">
          <thead>
            <tr>
              <th className="min-w-[220px]">Producto</th>
              <th title="Costo que aplica a todas las sucursales. Se puede sobreescribir por sucursal.">Costo de compra ↕</th>
              <th>Precio de venta · {activeBranch.code}</th>
              <th>Margen</th>
              <th title="Asignación manual: activa el producto en esta sucursal aunque no tenga stock ni historial">Asignado ★</th>
              <th className="min-w-[100px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((p) => {
              if (!activeBranch) return null;
              const row = buildBranchPricingCostRow(p, activeBranch);
              const cell = draft[p.id]?.[activeBranch.id] ?? { price: "", dirty: false };
              const priceKey = `${p.id}-${activeBranch.id}-price`;
              const hasDirty = Boolean(cell.dirty);
              // Sobre branchPrice (la excepción propia de esta sucursal), no
              // effectivePrice — "sigue el precio general" ya NO es "sin
              // precio" acá (B.2), sigue siendo un estado que esta tabla
              // quiere que alguien revise y decida si declarar una excepción.
              const isMissing = row.branchPrice === null;
              const actionVariant = isMissing ? "danger" : hasDirty ? "success" : "ghost";
              const actionLabel = isMissing ? "Asignar" : hasDirty ? "Guardar cambios" : "Guardado";
              return (
                <tr key={p.id} className={isMissing ? "bg-[color-mix(in_srgb,var(--color-danger-500)_6%,transparent)]" : undefined}>
                  <td className="font-medium">
                    <div>{p.sku} - {p.name}</div>
                    {row.isConvertibleStock ? (
                      <div className="mt-1 flex flex-wrap gap-1 text-[0.65rem]">
                        <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5">Stock compartido</span>
                        {row.conversionFactor && row.conversionFactor > 1 ? <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5">WAC convertido x {row.conversionFactor}</span> : null}
                      </div>
                    ) : null}
                    {row.warnings.filter((w) => w !== "Sin precio en esta sucursal").map((warning) => (
                      <Badge key={warning} variant={warning.includes("bajo costo") ? "danger" : "warning"}>{warning}</Badge>
                    ))}
                  </td>
                  <td className="py-1.5">
                    {/* "el ultimo costo que se meta es el que gana en las
                        fusiones... con las derivadas y la factorización
                        equivalente al producto se ajuste" — un miembro
                        DERIVADO de una fusión ahora SÍ se edita acá: el
                        backend (resolveGlobalCostWriteTarget, catalog/
                        service.ts) convierte lo que se escriba por el
                        factor de esta fusión y lo aplica al canónico — la
                        única fuente real de costo sigue siendo esa, nunca
                        el derivado, eso no cambió. Antes esto era de solo
                        lectura y mandaba a editar la unidad base a mano
                        (la conversión que el usuario tenía que hacer en la
                        cabeza y a veces salía mal — el origen real de los
                        datos de piedrín/arena mal cargados). */}
                    {onSaveGlobalCost ? (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1">
                          <Input
                            className={`h-7 text-xs flex-1 ${globalCostDraft[p.id] !== globalCostServerValue(p, activeBranch) ? "ring-2 ring-amber-300/60" : ""}`}
                            type="number" min="0" step="0.01"
                            placeholder="Sin costo de compra"
                            value={globalCostDraft[p.id] ?? ""}
                            onChange={(e) => setGlobalCostDraft((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            title={p.stockConversion && !p.stockConversion.isCanonical
                              ? `Costo de esta presentación (${p.stockConversion.saleUnit || "unidad"}) — se convierte automáticamente al producto canónico`
                              : "Costo de compra — aplica a todas las sucursales sin override"}
                          />
                          <button type="button" title="Guardar costo de compra"
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
                        {/* B.3 — el margen de al lado se calculó con este costo,
                            no necesariamente con lo que muestra el input de
                            arriba: si esta sucursal tiene un costo propio
                            (branchCost) o un WAC real, esos ganan sobre el
                            costo de compra general recién editado. Para un
                            derivado, aclara además que se convierte, no que
                            se guarda tal cual. */}
                        <span className="flex flex-wrap items-center gap-1 text-[0.6rem] text-[var(--color-text-muted)]">
                          {p.stockConversion && !p.stockConversion.isCanonical
                            ? `${row.costExplanation} · se convierte al producto canónico (${p.stockConversion.baseUnit} × ${Number(p.stockConversion.conversionFactor)})`
                            : `Margen calculado con: ${formatMoneyOrNd(row.effectiveCost)} (${row.costExplanation})`}
                          {/* Parte B (prompt-precios-mejoras-bandeja-visibilidad.md) — visibilidad, no bloqueo. */}
                          {row.costSource === "BRANCH" && (
                            <Badge variant="info" title="Este producto NO usa el costo global en esta sucursal — alguien fijó un costo manual aquí.">Manual</Badge>
                          )}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-xs">{formatMoneyOrNd(row.effectiveCost)}</span>
                        <span className="flex flex-wrap items-center gap-1 text-[0.6rem] text-[var(--color-text-muted)]">
                          {row.costExplanation}
                          {row.costSource === "BRANCH" && (
                            <Badge variant="info" title="Este producto NO usa el costo global en esta sucursal — alguien fijó un costo manual aquí.">Manual</Badge>
                          )}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-1">
                      <Input
                        className={`h-7 text-xs flex-1 ${isMissing ? "border-[var(--color-danger-400)] bg-[color-mix(in_srgb,var(--color-danger-500)_8%,var(--color-surface))]" : ""} ${cell.dirty ? "ring-2 ring-amber-300/60" : ""}`}
                        type="number" min="0" step="0.01"
                        placeholder="C$ 0.00"
                        value={cell.price}
                        onChange={(e) => updateCell(p.id, activeBranch.id, "price", e.target.value)}
                      />
                      <button type="button" title="Guardar precio" className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white transition-all disabled:opacity-50 ${savingKey === priceKey ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700 shadow-sm hover:shadow"}`} disabled={savingKey === priceKey} onClick={() => saveCell(p, activeBranch, "price")}>
                        {savingKey === priceKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      </button>
                    </div>
                    {/* Parte B.2 — motivo obligatorio, visible solo mientras se escribe un precio distinto del actual. */}
                    {cell.dirty && (
                      <Input
                        className="mt-1 h-6 text-[0.6875rem]"
                        placeholder="Motivo del precio (mínimo 3 caracteres)…"
                        value={cell.reason}
                        onChange={(e) => updateReason(p.id, activeBranch.id, e.target.value)}
                      />
                    )}
                    <div className={`mt-1 text-[0.6875rem] ${isMissing ? "font-semibold text-[var(--color-danger-600)]" : "text-[var(--color-text-muted)]"}`}>
                      {isMissing ? "⚠ Falta precio en esta sucursal" : "Precio asignado en esta sucursal"}
                    </div>
                  </td>
                  <td><Badge variant={marginBadgeVariant(row.effectiveMarginPercent)}>{formatMarginOrNd(row.effectiveMarginPercent)}</Badge></td>
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
                    <Button variant={actionVariant} size="sm" onClick={() => saveAllDirty(p)} icon={<Save className="h-3.5 w-3.5" />}>{actionLabel}</Button>
                  </td>
                </tr>
              );
            })}
            {filteredProducts.length === 0 ? (
              <tr><td colSpan={6} className="py-6 text-center text-[var(--color-text-muted)]">No hay productos.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      ) : null}
    </Card>
  );
}
