"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Boxes, History, Info, Plus, RefreshCcw } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { money, qty } from "@/lib/format";

type BalanceRow = {
  id: string;
  quantityOnHand: string;
  weightedAverageCost: string;
  product: { name: string; sku: string };
};

/**
 * prompt-kardex-ux-wac.md, Parte 2.1 — stockConversion solo viene si
 * loadProducts pide branchId (catalog/service.ts, batchMapProductsWithBranchInventory).
 * Antes esta pantalla ni siquiera lo pedía: el formulario no tenía forma
 * de saber si el producto elegido era un miembro DERIVADO de una fusión
 * (ej. METRO, factor 44 sobre LATA) — la causa raíz de que un costo
 * tecleado en la unidad equivocada pasara desapercibido hasta que el
 * guard de WAC lo rechazaba sin explicación accionable en esta pantalla.
 */
type ProductOption = {
  id: string;
  sku: string;
  name: string;
  stockConversion?: {
    baseUnit: string;
    saleUnit: string;
    conversionFactor: string | number;
    isCanonical: boolean;
  } | null;
};

type MovementPreview =
  | { available: true; currentWac: number; newWac: number; percentChange: number | null; saleUnit: string | null; baseUnit: string | null; conversionFactor: number | null; baseUnitCost: number | null }
  | { available: false; reason: string };
type MovementRow = {
  id: string;
  movementType: string;
  quantity: string;
  unitCost: string;
  referenceType: string;
  referenceId: string;
  createdAt: string;
  product: { sku: string; name: string };
};

export function InventoryAdmin({
  branchId,
  branchCode,
  branchName,
  canPostManualMovements = true,
}: {
  branchId: string;
  branchCode: string;
  branchName: string;
  canPostManualMovements?: boolean;
}) {
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [filterProductId, setFilterProductId] = useState("");
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [balancesError, setBalancesError] = useState<string | null>(null);
  const [movementsError, setMovementsError] = useState<string | null>(null);
  const [movement, setMovement] = useState({
    productId: "",
    movementType: "PURCHASE_IN",
    quantity: "1",
    unitCost: "1",
    referenceType: "MANUAL",
    referenceId: "INIT",
  });
  const [preview, setPreview] = useState<MovementPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const selectedMovementProduct = useMemo(
    () => products.find((item) => item.id === movement.productId) ?? null,
    [products, movement.productId],
  );
  // Parte 2.1 — solo un miembro DERIVADO (factor != 1) necesita el
  // recordatorio de unidad; el canónico y los productos sin fusión
  // guardan tal cual se escribe, sin conversión de por medio.
  const conversionFactor = selectedMovementProduct?.stockConversion
    ? Number(selectedMovementProduct.stockConversion.conversionFactor)
    : 1;
  const isDerivedPresentation = Boolean(selectedMovementProduct?.stockConversion) && conversionFactor !== 1;

  const currentBranchLabel = `${branchCode} · ${branchName}`;

  const loadProducts = useCallback(async (query: string) => {
    const q = query.trim();
    // Parte 2.1 — branchId es lo que hace que /api/catalog/products
    // devuelva stockConversion (catalog/service.ts, batchMapProductsWithBranchInventory) —
    // sin esto el formulario no tiene forma de saber si el producto
    // elegido es un miembro derivado de una fusión.
    const params = new URLSearchParams({ branchId });
    if (q) params.set("q", q);
    const response = await fetch(`/api/catalog/products?${params.toString()}`);
    const json = (await response.json()) as { data?: ProductOption[] };
    setProducts(json.data ?? []);
  }, [branchId]);

  const loadBalances = useCallback(async () => {
    setBalancesLoading(true);
    setBalancesError(null);
    const query = new URLSearchParams({ branchId, ...(filterProductId ? { productId: filterProductId } : {}) });
    try {
      const res = await fetch(`/api/inventory/balances?${query.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as { data?: BalanceRow[]; message?: string };
      if (!res.ok) {
        throw new Error(json.message ?? "No se pudieron cargar los balances.");
      }
      setRows(json.data ?? []);
    } catch (error) {
      setRows([]);
      setBalancesError(error instanceof Error ? error.message : "No se pudieron cargar los balances.");
    } finally {
      setBalancesLoading(false);
    }
  }, [branchId, filterProductId]);

  const loadMovements = useCallback(async () => {
    setMovementsLoading(true);
    setMovementsError(null);
    const query = new URLSearchParams({ branchId, ...(filterProductId ? { productId: filterProductId } : {}) });
    try {
      const res = await fetch(`/api/inventory/movements?${query.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as { data?: MovementRow[]; message?: string };
      if (!res.ok) {
        throw new Error(json.message ?? "No se pudieron cargar los movimientos.");
      }
      setMovements(json.data ?? []);
    } catch (error) {
      setMovements([]);
      setMovementsError(error instanceof Error ? error.message : "No se pudieron cargar los movimientos.");
    } finally {
      setMovementsLoading(false);
    }
  }, [branchId, filterProductId]);

  const loadInventoryData = useCallback(async () => {
    await Promise.all([loadBalances(), loadMovements()]);
  }, [loadBalances, loadMovements]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadProducts(productSearch).catch(() => undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [loadProducts, productSearch]);

  useEffect(() => {
    loadInventoryData().catch(() => undefined);
  }, [branchId, filterProductId, loadInventoryData]);

  // Parte 2.2 — vista previa del WAC ANTES de enviar (GET /api/inventory/
  // movements/preview, sin escribir nada — reusa recalculateWeightedAverage
  // por dentro, no una aproximación aparte en el frontend). Debounced para
  // no pedirla en cada tecla; se limpia sola si los campos quedan
  // incompletos o inválidos.
  useEffect(() => {
    const qtyNum = Number(movement.quantity);
    const costNum = Number(movement.unitCost);
    if (!movement.productId || !Number.isFinite(qtyNum) || qtyNum <= 0 || !Number.isFinite(costNum) || costNum < 0) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const params = new URLSearchParams({
          branchId,
          productId: movement.productId,
          movementType: movement.movementType,
          quantity: String(qtyNum),
          unitCost: String(costNum),
        });
        const res = await fetch(`/api/inventory/movements/preview?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) { setPreview(null); return; }
        const json = await res.json();
        setPreview(unwrapApiData(json) as MovementPreview);
      } catch {
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [branchId, movement.productId, movement.movementType, movement.quantity, movement.unitCost]);

  // prompt-kardex-ux-wac.md, Parte 2.3 — mismo patrón ya establecido en
  // fusion-pricing-panel.tsx (líneas ~167-171) y catalog-inventory-admin.tsx
  // (~684-690): SUSPECTED_PACKAGE_COST_AS_UNIT_COST y EXCESSIVE_WAC_JUMP
  // son preguntas, no errores de payload — antes quedaban truncados acá en
  // un toast genérico, sin forma de reintentar autorizando. Separado de
  // postMovement (el onSubmit del form) para poder reintentar sin volver a
  // pasar el FormEvent.
  async function submitMovement(allowHighUnitCost = false, allowLargeWacJump = false) {
    setSavingMovement(true);
    try {
      const response = await apiFetch("/api/inventory/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...movement,
          branchId,
          quantity: Number(movement.quantity),
          unitCost: Number(movement.unitCost),
          allowHighUnitCost: allowHighUnitCost || undefined,
          allowLargeWacJump: allowLargeWacJump || undefined,
        }),
      });
      const json = (await response.json().catch(() => null)) as { message?: string; error?: { code?: string; message?: string } } | null;
      if (!response.ok) {
        if (json?.error?.code === "SUSPECTED_PACKAGE_COST_AS_UNIT_COST") {
          const confirmed = window.confirm(`${json.error.message}\n\n¿Confirmás que el costo es correcto tal cual lo escribiste?`);
          if (confirmed) { await submitMovement(true, allowLargeWacJump); return; }
          return;
        }
        if (json?.error?.code === "EXCESSIVE_WAC_JUMP") {
          const confirmed = window.confirm(`${json.error.message}\n\n¿Confirmás que el salto de costo es correcto?`);
          if (confirmed) { await submitMovement(allowHighUnitCost, true); return; }
          return;
        }
        throw new Error(json?.error?.message ?? json?.message ?? "No se pudo registrar el movimiento.");
      }

      await loadInventoryData();
      setPreview(null);
      toast.success(`Movimiento registrado en ${currentBranchLabel}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar el movimiento.");
    } finally {
      setSavingMovement(false);
    }
  }

  function postMovement(event: React.FormEvent) {
    event.preventDefault();
    if (!movement.productId) return;
    void submitMovement();
  }

  return (
    <section className="space-y-4">
      {/* Contexto de sucursal */}
      <Card noPadding>
        <div className="hm-card-header-teal">
          <p className="text-sm font-semibold">Contexto activo: {currentBranchLabel}</p>
          <p className="text-xs opacity-90">Balances, disponibilidad y movimientos se filtran por esta sucursal.</p>
        </div>
      </Card>

      {/* Filtros */}
      <Card className="p-4">
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input
            className="hm-input"
            placeholder="🔍 Buscar producto por nombre o SKU"
            value={productSearch}
            onChange={(e) => {
              setProductSearch(e.target.value);
              setFilterProductId("");
            }}
          />
          <select className="hm-input" value={filterProductId} onChange={(e) => setFilterProductId(e.target.value)}>
            <option value="">Todos los productos</option>
            {products.map((item) => (
              <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => loadInventoryData()} icon={<RefreshCcw className="h-4 w-4" />}>
            Refrescar
          </Button>
        </div>
      </Card>

      {/* Formulario de movimiento */}
      {canPostManualMovements ? (
        <Card noPadding>
          <div className="hm-card-header-purple">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Plus className="h-4 w-4" /> Registrar movimiento manual</h3>
          </div>
          <div className="p-4">
            <form className="grid gap-2 md:grid-cols-3" onSubmit={postMovement}>
              <select className="hm-input" value={movement.productId} onChange={(e) => setMovement({ ...movement, productId: e.target.value })} required>
                <option value="">Selecciona producto</option>
                {products.map((item) => {
                  // Parte 2.1 — distingue en el propio picker cuál SKU es
                  // el derivado (METRO, ×factor) del canónico (LATA) —
                  // antes los dos se veían idénticos en la lista, la
                  // primera oportunidad de elegir el equivocado.
                  const conv = item.stockConversion;
                  const suffix = conv && Number(conv.conversionFactor) !== 1
                    ? ` (${conv.saleUnit}, ×${Number(conv.conversionFactor)} ${conv.baseUnit})`
                    : "";
                  return <option key={item.id} value={item.id}>{item.sku} · {item.name}{suffix}</option>;
                })}
              </select>
              <select className="hm-input" value={movement.movementType} onChange={(e) => setMovement({ ...movement, movementType: e.target.value })}>
                <option>PURCHASE_IN</option><option>RETURN_IN</option><option>ADJUSTMENT_IN</option><option>TRANSFER_IN</option>
                <option>RETURN_OUT</option><option>ADJUSTMENT_OUT</option><option>TRANSFER_OUT</option>
              </select>
              <input className="hm-input" type="number" min="0.0001" step="0.0001" value={movement.quantity} onChange={(e) => setMovement({ ...movement, quantity: e.target.value })} required />
              <input className="hm-input" type="number" min="0" step="0.000001" value={movement.unitCost} onChange={(e) => setMovement({ ...movement, unitCost: e.target.value })} required />
              <input className="hm-input" placeholder="Tipo referencia" value={movement.referenceType} onChange={(e) => setMovement({ ...movement, referenceType: e.target.value })} required />
              <input className="hm-input" placeholder="ID referencia" value={movement.referenceId} onChange={(e) => setMovement({ ...movement, referenceId: e.target.value })} required />
              <div className="md:col-span-3">
                <Button type="submit" variant="success" className="w-full" loading={savingMovement} icon={<Plus className="h-4 w-4" />}>
                  {savingMovement ? "Registrando..." : "Registrar movimiento"}
                </Button>
              </div>
            </form>
            {selectedMovementProduct ? (
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Producto seleccionado: <strong>{selectedMovementProduct.sku}</strong> · {selectedMovementProduct.name}
              </p>
            ) : null}
            {/* prompt-kardex-ux-wac.md, Parte 2.1 — sin esto, nada en la
                pantalla decía que "METRO" es una presentación derivada de
                "LATA" (factor 25/44/etc.): la cantidad y el costo que se
                escriben son en la unidad de VENTA (saleUnit), no en la
                unidad BASE que guarda el balance/WAC. La conversión ya la
                hace el backend bien (convertSaleQtyToBaseQty/
                convertSaleUnitCostToBaseUnitCost, sin tocar) — esto es
                solo hacerla visible ANTES de guardar. */}
            {isDerivedPresentation && selectedMovementProduct?.stockConversion ? (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-[var(--color-info-200)] bg-[var(--color-info-50)] px-3 py-2 text-xs text-[var(--color-info-700)]">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Guardando en <strong>{selectedMovementProduct.stockConversion.saleUnit}</strong> (= {conversionFactor} {selectedMovementProduct.stockConversion.baseUnit}).
                  {" "}Costo equivalente: <strong>{money(Number(movement.unitCost) / conversionFactor)}</strong> por {selectedMovementProduct.stockConversion.baseUnit}.
                </span>
              </p>
            ) : null}
            {/* Parte 2.2 — vista previa del WAC antes de enviar. */}
            {previewLoading ? (
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">Calculando el efecto en el WAC…</p>
            ) : preview?.available ? (
              <p className="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2 text-xs">
                WAC actual: <strong>{money(preview.currentWac)}</strong>{preview.baseUnit ? `/${preview.baseUnit}` : ""}
                {" → "}WAC nuevo: <strong>{money(preview.newWac)}</strong>{preview.baseUnit ? `/${preview.baseUnit}` : ""}
                {preview.percentChange !== null ? (
                  <span className={preview.percentChange > 50 ? "font-semibold text-[var(--color-danger-600)]" : preview.percentChange !== 0 ? "text-[var(--color-text-muted)]" : ""}>
                    {" "}({preview.percentChange >= 0 ? "+" : ""}{preview.percentChange.toFixed(1)}%)
                  </span>
                ) : null}
              </p>
            ) : preview && !preview.available ? (
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">{preview.reason}</p>
            ) : null}
          </div>
        </Card>
      ) : (
        <Card className="border-[var(--color-warning-300)] bg-[var(--color-warning-50)] p-3 text-sm text-[var(--color-warning-700)]">
          Tu rol tiene acceso de supervisión. Los movimientos manuales deben solicitarse mediante flujo de aprobación.
        </Card>
      )}

      {/* Balances */}
      <Card noPadding>
        <div className="hm-card-header-blue">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Boxes className="h-4 w-4" /> Balances y disponibilidad</h3>
        </div>
        <div className="p-4">
          {balancesLoading ? <p className="text-sm text-[var(--color-text-muted)] animate-pulse">Cargando balances...</p> : null}
          {balancesError ? <p className="text-sm text-[var(--color-danger-700)]">{balancesError}</p> : null}
          {!balancesLoading && !balancesError ? (
            rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">
                No hay balances para la sucursal seleccionada.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="hm-table w-full">
                  <thead><tr><th>SKU</th><th>Producto</th><th>Cantidad</th><th>Costo promedio</th></tr></thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="font-semibold">{row.product.sku}</td>
                        <td>{row.product.name}</td>
                        <td>{qty(row.quantityOnHand)}</td>
                        <td>{money(row.weightedAverageCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </div>
      </Card>

      {/* Movimientos recientes */}
      <Card noPadding>
        <div className="hm-card-header-amber">
          <h3 className="text-sm font-semibold flex items-center gap-2"><History className="h-4 w-4" /> Movimientos recientes</h3>
        </div>
        <div className="p-4">
          {movementsLoading ? <p className="text-sm text-[var(--color-text-muted)] animate-pulse">Cargando movimientos...</p> : null}
          {movementsError ? <p className="text-sm text-[var(--color-danger-700)]">{movementsError}</p> : null}
          {!movementsLoading && !movementsError ? (
            movements.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">
                No hay movimientos para la sucursal seleccionada.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="hm-table w-full">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>SKU</th>
                      <th>Producto</th>
                      <th>Tipo</th>
                      <th>Cantidad</th>
                      <th>Costo unitario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((item) => (
                      <tr key={item.id}>
                        <td>{new Date(item.createdAt).toLocaleString("es-NI")}</td>
                        <td className="font-semibold">{item.product.sku}</td>
                        <td>{item.product.name}</td>
                        <td><Badge variant={item.movementType.includes("IN") ? "success" : "warning"}>{item.movementType}</Badge></td>
                        <td>{qty(item.quantity)}</td>
                        <td>{money(item.unitCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </div>
      </Card>
    </section>
  );
}
