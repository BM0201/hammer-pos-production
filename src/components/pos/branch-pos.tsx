"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { measurePosMetric } from "@/lib/telemetry";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ProductRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  standardSalePrice: string;
  unit: string;
};

type TicketLine = {
  id: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  lineSubtotal: string;
  product?: { name?: string; sku?: string };
};

type TicketOrder = {
  id: string;
  orderNumber: string;
  status: string;
  grandTotal: string;
  subtotal: string;
  discountTotal: string;
  transportAmount?: string;
  lines: TicketLine[];
};

const POS_REASON_MESSAGES: Record<string, string> = {
  FORBIDDEN: "No tienes permiso para esta operación.",
  FORBIDDEN_ROLE: "Tu rol no puede realizar esta acción.",
  FORBIDDEN_BRANCH: "No tienes acceso a esta sucursal.",
  INVALID_PAYLOAD: "Datos inválidos. Revisa la captura.",
  INVALID_TRANSITION: "La orden ya no está en estado editable.",
  ORDER_EMPTY: "La orden está vacía. Agrega productos.",
  INSUFFICIENT_STOCK: "No hay inventario suficiente para completar la orden.",
  INSUFFICIENT_STOCK_AT_PAYMENT: "Stock insuficiente al momento de procesar.",
  ORDER_NOT_DRAFT: "La orden ya no está en estado borrador.",
  PRODUCT_INACTIVE: "El producto no está activo.",
  BRANCH_CLOSED: "La sucursal está cerrada.",
};

const ROW_HEIGHT = 82;
const OVERSCAN = 8;

function mapReasonMessage(message?: string, reason?: string) {
  if (reason && POS_REASON_MESSAGES[reason]) return POS_REASON_MESSAGES[reason];
  if (message && POS_REASON_MESSAGES[message]) return POS_REASON_MESSAGES[message];
  return message ?? "Operación no completada. Intenta nuevamente.";
}

export function BranchPos({ branchId }: { branchId: string }) {
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [topProducts, setTopProducts] = useState<ProductRow[]>([]);
  const [order, setOrder] = useState<TicketOrder | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  const [catalogScrollTop, setCatalogScrollTop] = useState(0);

  const [includeTransport, setIncludeTransport] = useState(false);
  const [transportAmount, setTransportAmount] = useState("");
  const [showingTopSelling, setShowingTopSelling] = useState(true);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const catalogViewportRef = useRef<HTMLDivElement | null>(null);
  const ticketPanelRef = useRef<HTMLDivElement | null>(null);
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);

  const orderLineByProductId = useMemo(() => {
    const map = new Map<string, TicketLine>();
    for (const line of order?.lines ?? []) map.set(line.productId, line);
    return map;
  }, [order?.lines]);

  const reloadOrder = useCallback(async () => {
    const query = new URLSearchParams({ branchId });
    const response = await fetch(`/api/sales/orders?${query.toString()}`);
    const json = (await response.json()) as { data?: TicketOrder[]; message?: string; reason?: string };

    if (!response.ok) {
      setNotice(mapReasonMessage(json.message, json.reason));
      return;
    }

    const orders = json.data ?? [];
    const editable = orders.find((item) => item.status === "DRAFT") ?? null;

    if (editable) {
      setOrder(editable);
      return;
    }

    const createResponse = await fetch("/api/sales/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId }),
    });

    const createJson = (await createResponse.json()) as { data?: TicketOrder; message?: string; reason?: string };
    if (!createResponse.ok) {
      setNotice(mapReasonMessage(createJson.message, createJson.reason));
      return;
    }

    setOrder(createJson.data ?? null);
  }, [branchId]);

  // Load top-selling products on mount
  const loadTopSelling = useCallback(async () => {
    try {
      const params = new URLSearchParams({ isActive: "true", topSelling: "true", limit: "5" });
      const response = await fetch(`/api/catalog/products?${params.toString()}`);
      const json = (await response.json()) as { data?: ProductRow[] };
      const rows = json.data ?? [];
      setTopProducts(rows);
      if (!search.trim()) {
        setProducts(rows);
        setShowingTopSelling(true);
      }
    } catch {
      // Silent fallback
    }
  }, []);

  const loadProducts = useCallback(async (query: string) => {
    if (!query.trim()) {
      // Show top-selling when search is empty
      setProducts(topProducts);
      setShowingTopSelling(true);
      setActiveProductIndex(0);
      setCatalogScrollTop(0);
      if (catalogViewportRef.current) catalogViewportRef.current.scrollTop = 0;
      return;
    }

    setShowingTopSelling(false);
    const stopMetric = measurePosMetric("search_latency", { queryLength: query.length });
    setLoadingProducts(true);
    const params = new URLSearchParams({ q: query, isActive: "true" });
    const response = await fetch(`/api/catalog/products?${params.toString()}`);
    const json = (await response.json()) as { data?: ProductRow[]; message?: string };

    if (!response.ok) {
      setNotice(mapReasonMessage(json.message));
      setLoadingProducts(false);
      stopMetric(false);
      return;
    }

    const rows = json.data ?? [];
    const q = query.trim().toLowerCase();
    const rank = (item: ProductRow) => {
      if (!q) return 99;
      if (item.name.toLowerCase().startsWith(q)) return 0;
      if (item.name.toLowerCase().includes(q)) return 1;
      if (item.sku.toLowerCase().startsWith(q)) return 2;
      if ((item.barcode ?? "").toLowerCase().startsWith(q)) return 3;
      return 9;
    };

    rows.sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      return a.name.localeCompare(b.name);
    });

    setProducts(rows);
    setActiveProductIndex(0);
    setCatalogScrollTop(0);
    if (catalogViewportRef.current) catalogViewportRef.current.scrollTop = 0;
    setLoadingProducts(false);
    stopMetric(true);
  }, [topProducts]);

  useEffect(() => {
    reloadOrder().catch(() => setNotice("No se pudo preparar el ticket de venta."));
    loadTopSelling();
  }, [reloadOrder, loadTopSelling]);

  useEffect(() => {
    const handler = setTimeout(() => {
      loadProducts(search).catch(() => setNotice("No se pudo cargar el catálogo."));
    }, 120);

    return () => clearTimeout(handler);
  }, [search, loadProducts]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const viewportHeight = 520;
  const totalHeight = products.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(catalogScrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(products.length, Math.ceil((catalogScrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const visibleProducts = products.slice(startIndex, endIndex);

  function ensureVisible(index: number) {
    const viewport = catalogViewportRef.current;
    if (!viewport) return;

    const itemTop = index * ROW_HEIGHT;
    const itemBottom = itemTop + ROW_HEIGHT;
    const viewTop = viewport.scrollTop;
    const viewBottom = viewTop + viewport.clientHeight;

    if (itemTop < viewTop) viewport.scrollTop = itemTop;
    else if (itemBottom > viewBottom) viewport.scrollTop = itemBottom - viewport.clientHeight;
  }

  async function addProduct(product: ProductRow) {
    if (!order || busy) return;
    const stopMetric = measurePosMetric("add_to_ticket_latency", { productId: product.id });
    let success = false;
    setBusy(true);

    try {
      const existing = orderLineByProductId.get(product.id);
      if (existing) {
        await updateLineQuantity(existing.id, Number(existing.quantity) + 1, true);
      } else {
        const response = await fetch(`/api/sales/orders/${order.id}/lines`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: product.id, quantity: 1 }),
        });

        const json = (await response.json()) as { message?: string; reason?: string };
        if (!response.ok) {
          setNotice(mapReasonMessage(json.message, json.reason));
          return;
        }
      }

      await reloadOrder();
      setNotice(`Producto agregado: ${product.name}.`);
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      success = true;
    } finally {
      setBusy(false);
      stopMetric(success);
    }
  }


  async function updateLineQuantity(lineId: string, quantity: number, silent = false) {
    if (!order) return;

    if (quantity <= 0) {
      await removeLine(lineId, silent);
      return;
    }

    const response = await fetch(`/api/sales/orders/${order.id}/lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity }),
    });
    const json = (await response.json()) as { message?: string; reason?: string };

    if (!response.ok) {
      setNotice(mapReasonMessage(json.message, json.reason));
      return;
    }

    await reloadOrder();
    if (!silent) setNotice("Cantidad actualizada.");
  }

  async function removeLine(lineId: string, silent = false) {
    if (!order) return;
    const response = await fetch(`/api/sales/orders/${order.id}/lines/${lineId}`, { method: "DELETE" });
    const json = (await response.json()) as { message?: string; reason?: string };

    if (!response.ok) {
      setNotice(mapReasonMessage(json.message, json.reason));
      return;
    }

    await reloadOrder();
    if (!silent) setNotice("Producto removido del ticket.");
  }

  async function sendToPayment() {
    if (!order || busy || order.lines.length === 0) return;

    setBusy(true);

    try {
      const body: Record<string, unknown> = { requiresTransport: includeTransport };
      if (includeTransport && transportAmount) {
        body.transportAmount = Number(transportAmount);
      }

      const response = await fetch(`/api/sales/orders/${order.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as { message?: string; reason?: string };

      if (!response.ok) {
        setNotice(mapReasonMessage(json.message, json.reason));
        return;
      }

      setNotice(includeTransport
        ? "Orden enviada a caja con transporte incluido."
        : "Orden enviada a caja: pendiente de pago.");
      setIncludeTransport(false);
      setTransportAmount("");
      await reloadOrder();
      setSearch("");
      setActiveProductIndex(0);
      searchInputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveProductIndex((prev) => {
        const next = Math.min(prev + 1, Math.max(products.length - 1, 0));
        ensureVisible(next);
        return next;
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveProductIndex((prev) => {
        const next = Math.max(prev - 1, 0);
        ensureVisible(next);
        return next;
      });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selected = products[activeProductIndex] ?? products[0];
      if (selected) addProduct(selected).catch(() => setNotice("No se pudo agregar el producto."));
      return;
    }

    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      ticketPanelRef.current?.focus();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setSearch("");
      setNotice("");
    }
  }

  function handleTicketKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      sendButtonRef.current?.focus();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      searchInputRef.current?.focus();
    }
  }

  return (
    <section className="space-y-3" data-testid="pos-root">
      <section className="h-[calc(100vh-10.5rem)] min-h-[34rem] overflow-hidden" >
      <div className="grid h-full gap-4 lg:grid-cols-[1.05fr_1.4fr]">
        <Card className="flex h-full flex-col overflow-hidden rounded-2xl" data-testid="pos-catalog-zone">
          <div className="px-4 pt-4 pb-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold">Catálogo rápido</h2>
              {showingTopSelling && !search.trim() && (
                <Badge variant="warning" className="text-[0.6rem]">Top vendidos</Badge>
              )}
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">Busca por nombre, SKU o código de barras.</p>
            <input
              ref={searchInputRef}
              className="mt-2 w-full rounded-xl border border-[var(--color-border)] px-3 py-2.5 text-sm focus:border-[var(--color-primary-500)] focus:ring-2 focus:ring-[var(--color-primary-100)] outline-none transition-all"
              placeholder="Buscar producto (↑ ↓ navega, Enter agrega)"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              disabled={busy}
              data-testid="pos-search-input"
            />
          </div>

          <div
            ref={catalogViewportRef}
            className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
            onScroll={(event) => setCatalogScrollTop(event.currentTarget.scrollTop)}
            data-testid="pos-catalog-viewport"
          >
            {loadingProducts ? <p className="text-xs text-[var(--color-text-soft)] p-2">Cargando catálogo...</p> : null}
            {!loadingProducts && products.length === 0 ? (
              <p className="text-xs text-[var(--color-text-soft)] p-2">No hay productos para esta búsqueda.</p>
            ) : null}
            <div style={{ height: `${totalHeight}px`, position: "relative" }}>
              {visibleProducts.map((product, localIndex) => {
                const index = startIndex + localIndex;
                const selected = index === activeProductIndex;

                return (
                  <button
                    key={product.id}
                    style={{
                      position: "absolute",
                      top: `${index * ROW_HEIGHT}px`,
                      left: 0,
                      right: 0,
                      height: `${ROW_HEIGHT - 6}px`,
                    }}
                    className={`rounded-xl border p-2.5 text-left text-sm transition-all hover:bg-[var(--color-surface-muted)] ${selected ? "border-[var(--color-success-600)] bg-[var(--color-success-50)] shadow-sm" : "border-[var(--color-border)]"}`}
                    onClick={() => {
                      setActiveProductIndex(index);
                      addProduct(product).catch(() => setNotice("No se pudo agregar el producto."));
                    }}
                    disabled={busy}
                    data-testid={`pos-product-${product.id}`}
                  >
                    <div className="font-medium">{product.name}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">SKU: {product.sku} {product.barcode ? `· BAR: ${product.barcode}` : ""}</div>
                    <div className="text-xs font-semibold text-[var(--color-success-700)]">C$ {Number(product.standardSalePrice).toFixed(2)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        <div
          ref={ticketPanelRef}
          tabIndex={0}
          onKeyDown={handleTicketKeyDown}
          className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-success-600)] rounded-2xl"
          data-testid="pos-ticket-zone"
        >
        <Card className="flex h-full flex-col overflow-hidden rounded-2xl">
          <div className="px-4 pt-4 pb-3">
            <h2 className="text-sm font-semibold">Ticket actual</h2>
            <p className="text-xs text-[var(--color-text-muted)]">Orden: {order?.orderNumber ?? "preparando..."} · Estado: {order?.status ?? "DRAFT"}</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" data-testid="pos-ticket-lines">
            <div className="overflow-x-auto">
            <table className="min-w-[34rem] w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-[var(--color-text-muted)]">
                  <th className="py-2">Producto</th>
                  <th>Precio</th>
                  <th>Cant.</th>
                  <th>Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {order?.lines.map((line) => (
                  <tr key={line.id} className="border-b border-[var(--color-border)]">
                    <td className="py-2">
                      <div>{line.product?.name ?? line.productId}</div>
                      {Number(line.discountAmount) > 0 && (
                        <div className="text-[0.65rem] text-[var(--color-success-700)] font-medium">
                          Desc: -C$ {Number(line.discountAmount).toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td>C$ {Number(line.unitPrice).toFixed(2)}</td>
                    <td>
                      <input
                        className="w-20 rounded-lg border px-2 py-1"
                        type="number"
                        min="0"
                        step="0.0001"
                        value={line.quantity}
                        disabled={busy}
                        data-testid={`pos-line-qty-${line.id}`}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          updateLineQuantity(line.id, Number.isFinite(next) ? next : 0).catch(() => setNotice("No se pudo cambiar cantidad."));
                        }}
                      />
                    </td>
                    <td className="font-medium">C$ {Number(line.lineSubtotal).toFixed(2)}</td>
                    <td>
                      <Button variant="secondary" size="sm" disabled={busy} data-testid={`pos-line-remove-${line.id}`} onClick={() => removeLine(line.id).catch(() => setNotice("No se pudo eliminar línea."))}>
                        Quitar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {order && order.lines.length === 0 ? (
              <p className="p-2 text-xs text-[var(--color-text-soft)]">Aún no agregas productos al ticket.</p>
            ) : null}
          </div>

          <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3 rounded-b-2xl" data-testid="pos-payment-zone">
            <div className="grid gap-1 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><strong>C$ {Number(order?.subtotal ?? 0).toFixed(2)}</strong></div>
              <div className="flex justify-between"><span>Descuento</span><strong>C$ {Number(order?.discountTotal ?? 0).toFixed(2)}</strong></div>
              {includeTransport && transportAmount && Number(transportAmount) > 0 && (
                <div className="flex justify-between text-[var(--color-primary-700)]">
                  <span>Transporte</span><strong>C$ {Number(transportAmount).toFixed(2)}</strong>
                </div>
              )}
              <div className="flex justify-between text-base border-t border-[var(--color-border)] pt-1 mt-1">
                <span>Total</span>
                <strong data-testid="pos-total">C$ {(Number(order?.subtotal ?? 0) + (includeTransport ? Number(transportAmount || 0) : 0)).toFixed(2)}</strong>
              </div>
            </div>

            {/* ── Transport service toggle ── */}
            <label className="mt-3 flex items-center gap-2 cursor-pointer select-none" data-testid="pos-transport-toggle">
              <input
                type="checkbox"
                checked={includeTransport}
                onChange={(e) => {
                  setIncludeTransport(e.target.checked);
                  if (!e.target.checked) setTransportAmount("");
                }}
                className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary-600)] focus:ring-[var(--color-primary-500)]"
                disabled={busy}
              />
              <span className="text-sm text-[var(--color-text-secondary)]">Requiere servicio de transporte</span>
            </label>

            {includeTransport && (
              <div className="mt-2 space-y-1">
                <label className="block text-xs font-medium text-[var(--color-text-muted)]">Monto de transporte (C$)</label>
                <input
                  className="w-full rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm focus:border-[var(--color-primary-500)] focus:ring-2 focus:ring-[var(--color-primary-100)] outline-none"
                  type="number"
                  min="0"
                  step="0.01"
                  value={transportAmount}
                  onChange={(e) => setTransportAmount(e.target.value)}
                  placeholder="Ej: 150.00"
                  disabled={busy}
                  data-testid="pos-transport-amount"
                />
              </div>
            )}

            <Button
              ref={sendButtonRef}
              variant="success"
              className="mt-3 w-full rounded-xl"
              onClick={() => sendToPayment().catch(() => setNotice("No se pudo enviar a pago."))}
              disabled={busy || !order || order.lines.length === 0}
              data-testid="pos-send-to-payment"
            >
              {busy ? "Procesando..." : includeTransport ? `Enviar a caja con transporte (C$ ${(Number(order?.subtotal ?? 0) + Number(transportAmount || 0)).toFixed(2)})` : "Enviar a caja (pendiente de pago)"}
            </Button>
          </div>
        </Card>
        </div>
      </div>
      </section>

      {notice ? <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2 text-sm text-[var(--color-text-secondary)]" data-testid="pos-notice">{notice}</p> : null}
    </section>
  );
}
