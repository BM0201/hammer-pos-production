"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Boxes, History, Plus, RefreshCcw, Search } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
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

type ProductOption = { id: string; sku: string; name: string };
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

  const selectedMovementProduct = useMemo(
    () => products.find((item) => item.id === movement.productId) ?? null,
    [products, movement.productId],
  );

  const currentBranchLabel = `${branchCode} · ${branchName}`;

  const loadProducts = useCallback(async (query: string) => {
    const q = query.trim();
    const response = await fetch(`/api/catalog/products${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    const json = (await response.json()) as { data?: ProductOption[] };
    setProducts(json.data ?? []);
  }, []);

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
    loadProducts("").catch(() => undefined);
  }, [loadProducts]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadProducts(productSearch).catch(() => undefined);
    }, 150);

    return () => clearTimeout(timer);
  }, [loadProducts, productSearch]);

  useEffect(() => {
    loadInventoryData().catch(() => undefined);
  }, [branchId, filterProductId, loadInventoryData]);

  async function postMovement(event: React.FormEvent) {
    event.preventDefault();
    if (!movement.productId) return;
    setSavingMovement(true);

    try {
      const response = await apiFetch("/api/inventory/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...movement, branchId, quantity: Number(movement.quantity), unitCost: Number(movement.unitCost) }),
      });
      const json = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(json.message ?? "No se pudo registrar el movimiento.");
      }

      await loadInventoryData();
      toast.success(`Movimiento registrado en ${currentBranchLabel}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar el movimiento.");
    } finally {
      setSavingMovement(false);
    }
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
            onChange={(e) => setProductSearch(e.target.value)}
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
                {products.map((item) => (
                  <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>
                ))}
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