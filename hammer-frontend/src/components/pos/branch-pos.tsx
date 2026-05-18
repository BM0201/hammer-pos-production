"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { measurePosMetric } from "@/lib/telemetry";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { mapPosErrorToSpanish, type ApiErrorPayload } from "@/lib/pos-ui";
import { apiFetch } from "@/lib/client/api";

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

type InventoryBalanceRow = {
  productId: string;
  quantityOnHand: string;
};

const ROW_HEIGHT = 82;
const OVERSCAN = 8;
const MAX_REASONABLE_QUANTITY = 9999;

export function BranchPos({ branchId }: { branchId: string }) {
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [topProducts, setTopProducts] = useState<ProductRow[]>([]);
  const [order, setOrder] = useState<TicketOrder | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isMutatingOrder, setIsMutatingOrder] = useState(false);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [notice, setNotice] = useState("");
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  const [catalogScrollTop, setCatalogScrollTop] = useState(0);

  const [lineDraftQuantities, setLineDraftQuantities] = useState<Record<string, string>>({});
  const [lineQuantityErrors, setLineQuantityErrors] = useState<Record<string, string>>({});
  const [lineUpdatingId, setLineUpdatingId] = useState<string | null>(null);
  const [stockByProductId, setStockByProductId] = useState<Record<string, number>>({});

  const [includeTransport, setIncludeTransport] = useState(false);
  const [transportAmount, setTransportAmount] = useState("");
  const [transportTouched, setTransportTouched] = useState(false);
  const [showingTopSelling, setShowingTopSelling] = useState(true);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const catalogViewportRef = useRef<HTMLDivElement | null>(null);
  const ticketPanelRef = useRef<HTMLDivElement | null>(null);
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);

  const [branchConfig, setBranchConfig] = useState<{ enableCashier: boolean; enableDispatch: boolean } | null>(null);
  const [activeCashSessionId, setActiveCashSessionId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>("CASH");

  const isBusy = isMutatingOrder || isSubmittingPayment;

  const orderLineByProductId = useMemo(() => {
    const map = new Map<string, TicketLine>();
    for (const line of order?.lines ?? []) map.set(line.productId, line);
    return map;
  }, [order?.lines]);

  const transportAmountNumber = Number(transportAmount);
  const transportAmountValue = includeTransport && Number.isFinite(transportAmountNumber) && transportAmountNumber > 0
    ? transportAmountNumber
    : 0;

  const transportValidationError = useMemo(() => {
    if (!includeTransport) return null;
    if (!transportAmount.trim()) return "El transporte está activado, pero falta el monto.";

    const parsed = Number(transportAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return "El monto de transporte debe ser un número mayor que 0.";
    }

    return null;
  }, [includeTransport, transportAmount]);

  /** Set notice with auto-dismiss after `ms` (default 6s). Errors stay longer (10s). */
  const setNoticeTimed = useCallback((msg: string, ms = 6000) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice(msg);
    if (msg) {
      noticeTimerRef.current = setTimeout(() => setNotice(""), ms);
    }
  }, []);

  useEffect(() => {
    return () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); };
  }, []);

  const resolveApiMessage = useCallback((params: {
    payload?: ApiErrorPayload;
    status?: number;
    fallback: string;
    thrownError?: unknown;
  }) => {
    return mapPosErrorToSpanish({
      payload: params.payload,
      status: params.status,
      fallback: params.fallback,
      thrownError: params.thrownError,
    });
  }, []);

  const reloadOrder = useCallback(async () => {
    try {
      const query = new URLSearchParams({ branchId });
      const response = await fetch(`/api/sales/orders?${query.toString()}`);
      const json = (await response.json()) as { data?: TicketOrder[]; message?: string; reason?: string };

      if (!response.ok) {
        setNoticeTimed(resolveApiMessage({ payload: json, status: response.status, fallback: "No se pudo preparar el ticket de venta." }), 10000);
        return;
      }

      const orders = json.data ?? [];
      const editable = orders.find((item) => item.status === "DRAFT") ?? null;

      if (editable) {
        setOrder(editable);
        return;
      }

      const createResponse = await apiFetch("/api/sales/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId }),
      });

      const createJson = (await createResponse.json()) as { data?: TicketOrder; message?: string; reason?: string };
      if (!createResponse.ok) {
        setNoticeTimed(resolveApiMessage({ payload: createJson, status: createResponse.status, fallback: "No se pudo crear el ticket." }), 10000);
        return;
      }

      setOrder(createJson.data ?? null);
    } catch (error) {
      console.error("[POS][reloadOrder]", error);
      setNoticeTimed(resolveApiMessage({ fallback: "No se pudo preparar el ticket de venta.", thrownError: error }), 10000);
    } finally {
      setIsInitialLoading(false);
    }
  }, [branchId, resolveApiMessage, setNoticeTimed]);

  const loadTopSelling = useCallback(async () => {
    try {
      const params = new URLSearchParams({ isActive: "true", topSelling: "true", limit: "5" });
      const response = await fetch(`/api/catalog/products?${params.toString()}`);
      const json = (await response.json()) as { data?: ProductRow[]; message?: string; reason?: string };

      if (!response.ok) {
        setNoticeTimed(resolveApiMessage({ payload: json, status: response.status, fallback: "No se pudieron cargar los productos más vendidos." }), 10000);
        return;
      }

      const rows = json.data ?? [];
      setTopProducts(rows);
      if (!search.trim()) {
        setProducts(rows);
        setShowingTopSelling(true);
      }
    } catch (error) {
      console.error("[POS][loadTopSelling]", error);
      setNoticeTimed(resolveApiMessage({ fallback: "No se pudieron cargar los productos más vendidos.", thrownError: error }), 10000);
    }
  }, [resolveApiMessage, setNoticeTimed, search]);

  const loadProducts = useCallback(async (query: string) => {
    if (!query.trim()) {
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

    try {
      const params = new URLSearchParams({ q: query, isActive: "true" });
      const response = await fetch(`/api/catalog/products?${params.toString()}`);
      const json = (await response.json()) as { data?: ProductRow[]; message?: string; reason?: string };

      if (!response.ok) {
        setNoticeTimed(resolveApiMessage({ payload: json, status: response.status, fallback: "No se pudo cargar el catálogo." }), 10000);
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
      stopMetric(true);
    } catch (error) {
      console.error("[POS][loadProducts]", error);
      setNoticeTimed(resolveApiMessage({ fallback: "No se pudo cargar el catálogo.", thrownError: error }), 10000);
      stopMetric(false);
    } finally {
      setLoadingProducts(false);
    }
  }, [resolveApiMessage, topProducts]);

  // Load branch config (enableCashier / enableDispatch)
  useEffect(() => {
    async function loadBranchConfig() {
      try {
        const res = await fetch(`/api/branch-config/${branchId}`);
        const json = await res.json();
        const data = json?.data ?? json;
        setBranchConfig({
          enableCashier: data?.enableCashier ?? true,
          enableDispatch: data?.enableDispatch ?? true,
        });
      } catch {
        setBranchConfig({ enableCashier: true, enableDispatch: true });
      }
    }
    loadBranchConfig();
  }, [branchId]);

  // Load active cash session for direct-sale flow
  useEffect(() => {
    if (branchConfig?.enableCashier !== false) return;
    async function loadActiveCashSession() {
      try {
        const res = await fetch("/api/cashier/cash-sessions/active");
        const json = await res.json();
        const data = json?.data ?? json;
        if (data?.id) {
          setActiveCashSessionId(data.id);
        }
      } catch {
        // Will show error when trying to sell
      }
    }
    loadActiveCashSession();
  }, [branchConfig]);

  useEffect(() => {
    reloadOrder();
    loadTopSelling();
  }, [reloadOrder, loadTopSelling]);

  useEffect(() => {
    const handler = setTimeout(() => {
      loadProducts(search);
    }, 120);

    return () => clearTimeout(handler);
  }, [search, loadProducts]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const nextLineIds = new Set((order?.lines ?? []).map((line) => line.id));

    setLineDraftQuantities((prev) => {
      const next: Record<string, string> = {};
      for (const line of order?.lines ?? []) {
        next[line.id] = prev[line.id] ?? line.quantity;
      }
      return next;
    });

    setLineQuantityErrors((prev) => {
      const next: Record<string, string> = {};
      for (const [lineId, value] of Object.entries(prev)) {
        if (nextLineIds.has(lineId)) next[lineId] = value;
      }
      return next;
    });
  }, [order?.lines]);

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

  async function fetchStockForProduct(productId: string): Promise<number> {
    const known = stockByProductId[productId];
    if (typeof known === "number") return known;

    const query = new URLSearchParams({ branchId, productId });
    const response = await fetch(`/api/inventory/balances?${query.toString()}`);
    const json = (await response.json()) as { data?: InventoryBalanceRow[]; message?: string; reason?: string };

    if (!response.ok) {
      throw new Error(resolveApiMessage({ payload: json, status: response.status, fallback: "No se pudo validar stock disponible." }));
    }

    const qty = Number(json.data?.[0]?.quantityOnHand ?? 0);
    const resolved = Number.isFinite(qty) ? qty : 0;
    setStockByProductId((prev) => ({ ...prev, [productId]: resolved }));
    return resolved;
  }

  async function addProduct(product: ProductRow) {
    if (!order || isBusy) return;
    const stopMetric = measurePosMetric("add_to_ticket_latency", { productId: product.id });
    let success = false;
    setIsMutatingOrder(true);

    try {
      const existing = orderLineByProductId.get(product.id);
      if (existing) {
        await commitLineQuantity(existing, Number(existing.quantity) + 1, true);
      } else {
        const response = await apiFetch(`/api/sales/orders/${order.id}/lines`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: product.id, quantity: 1 }),
        });

        const json = (await response.json()) as ApiErrorPayload;
        if (!response.ok) {
          setNoticeTimed(resolveApiMessage({ payload: json, status: response.status, fallback: "No se pudo agregar el producto." }), 10000);
          return;
        }
      }

      await reloadOrder();
      setNoticeTimed(`Producto agregado: ${product.name}.`);
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      success = true;
    } catch (error) {
      console.error("[POS][addProduct]", error);
      setNoticeTimed(resolveApiMessage({ fallback: "No se pudo agregar el producto.", thrownError: error }), 10000);
    } finally {
      setIsMutatingOrder(false);
      stopMetric(success);
    }
  }

  function validateQuantityInput(rawQuantity: string): { value: number | null; error: string | null } {
    const cleaned = rawQuantity.trim();
    if (!cleaned) return { value: null, error: "La cantidad es obligatoria." };

    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return { value: null, error: "La cantidad debe ser numérica." };
    if (parsed <= 0) return { value: null, error: "La cantidad debe ser mayor que 0." };
    if (parsed > MAX_REASONABLE_QUANTITY) {
      return { value: null, error: `La cantidad es demasiado alta (máximo ${MAX_REASONABLE_QUANTITY}).` };
    }

    return { value: parsed, error: null };
  }

  async function updateLineQuantity(lineId: string, quantity: number, silent = false): Promise<boolean> {
    if (!order) return false;

    const response = await apiFetch(`/api/sales/orders/${order.id}/lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity }),
    });
    const json = (await response.json()) as ApiErrorPayload;

    if (!response.ok) {
      setNoticeTimed(resolveApiMessage({ payload: json, status: response.status, fallback: "No se pudo actualizar la cantidad." }), 10000);
      return false;
    }

    await reloadOrder();
    if (!silent) setNoticeTimed("Cantidad actualizada.");
    return true;
  }

  async function commitLineQuantity(line: TicketLine, forcedValue?: number, silent = false) {
    if (lineUpdatingId || isSubmittingPayment) return;

    const currentDraft = forcedValue !== undefined ? String(forcedValue) : (lineDraftQuantities[line.id] ?? line.quantity);
    const validation = validateQuantityInput(currentDraft);

    if (validation.error || validation.value == null) {
      setLineQuantityErrors((prev) => ({ ...prev, [line.id]: validation.error ?? "Cantidad inválida." }));
      return;
    }

    setLineUpdatingId(line.id);
    try {
      const availableStock = await fetchStockForProduct(line.productId);
      if (validation.value > availableStock) {
        setLineQuantityErrors((prev) => ({
          ...prev,
          [line.id]: `Stock insuficiente. Disponible: ${availableStock.toFixed(2)}.`,
        }));
        return;
      }

      const updated = await updateLineQuantity(line.id, validation.value, silent);
      if (!updated) return;

      setLineQuantityErrors((prev) => {
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
      setLineDraftQuantities((prev) => ({ ...prev, [line.id]: String(validation.value) }));
    } catch (error) {
      console.error("[POS][commitLineQuantity]", error);
      setNoticeTimed(resolveApiMessage({ fallback: "No se pudo cambiar cantidad.", thrownError: error }), 10000);
    } finally {
      setLineUpdatingId(null);
    }
  }

  async function removeLine(lineId: string, silent = false) {
    if (!order || lineUpdatingId || isSubmittingPayment) return;
    setLineUpdatingId(lineId);

    try {
      const response = await apiFetch(`/api/sales/orders/${order.id}/lines/${lineId}`, { method: "DELETE" });
      const json = (await response.json()) as ApiErrorPayload;

      if (!response.ok) {
        setNoticeTimed(resolveApiMessage({ payload: json, status: response.status, fallback: "No se pudo eliminar la línea." }), 10000);
        return;
      }

      await reloadOrder();
      if (!silent) setNoticeTimed("Producto removido del ticket.");
    } catch (error) {
      console.error("[POS][removeLine]", error);
      setNoticeTimed(resolveApiMessage({ fallback: "No se pudo eliminar la línea.", thrownError: error }), 10000);
    } finally {
      setLineUpdatingId(null);
    }
  }

  async function sendToPayment() {
    if (!order || isSubmittingPayment || order.lines.length === 0) return;

    if (includeTransport && transportValidationError) {
      setTransportTouched(true);
      setNoticeTimed(transportValidationError, 10000);
      return;
    }

    const isDirectSale = branchConfig?.enableCashier === false;

    // Direct sale requires active cash session
    if (isDirectSale && !activeCashSessionId) {
      setNoticeTimed("No hay sesión de caja abierta para registrar venta directa. Abra una sesión de caja primero.", 10000);
      return;
    }

    setIsSubmittingPayment(true);

    try {
      if (isDirectSale) {
        // Direct sale flow: seller submits + pays in one step
        const body: Record<string, unknown> = {
          cashSessionId: activeCashSessionId,
          method: paymentMethod,
          requiresTransport: includeTransport,
        };
        if (includeTransport) {
          body.transportAmount = transportAmountValue;
        }

        const response = await apiFetch(`/api/sales/orders/${order.id}/direct-sale`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await response.json()) as ApiErrorPayload;

        if (!response.ok) {
          // Map specific error codes
          const errorCode = (json as Record<string, unknown>)?.error && typeof (json as Record<string, unknown>).error === "object"
            ? ((json as Record<string, { code?: string }>).error?.code ?? "")
            : "";
          if (errorCode === "CASHIER_MODULE_ENABLED") {
            setNoticeTimed("El módulo de caja está activo. Use el flujo estándar de enviar a caja.", 10000);
          } else if (errorCode === "NO_ACTIVE_CASH_SESSION") {
            setNoticeTimed("No hay sesión de caja abierta para registrar venta directa.", 10000);
          } else {
            setNoticeTimed(resolveApiMessage({ payload: json, status: response.status, fallback: "No se pudo registrar la venta directa." }), 10000);
          }
          return;
        }

        const completionMsg = branchConfig?.enableDispatch === false
          ? "Venta completada y marcada como entregada automáticamente. ✓"
          : "Venta completada. Pendiente de despacho. ✓";
        setNoticeTimed(completionMsg);
      } else {
        // Standard flow: submit to cashier
        const body: Record<string, unknown> = {
          requiresTransport: includeTransport,
        };
        if (includeTransport) {
          body.transportAmount = transportAmountValue;
        }

        const response = await apiFetch(`/api/sales/orders/${order.id}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await response.json()) as ApiErrorPayload;

        if (!response.ok) {
          setNoticeTimed(resolveApiMessage({ payload: json, status: response.status, fallback: "No se pudo enviar la orden a caja." }), 10000);
          return;
        }

        setNoticeTimed(includeTransport
          ? "Orden enviada a caja con transporte incluido. ✓"
          : "Orden enviada a caja: pendiente de pago. ✓");
      }

      setIncludeTransport(false);
      setTransportAmount("");
      setTransportTouched(false);
      await reloadOrder();
      setSearch("");
      setActiveProductIndex(0);
      searchInputRef.current?.focus();
    } catch (error) {
      console.error("[POS][sendToPayment]", error);
      setNoticeTimed(resolveApiMessage({ fallback: "No se pudo completar la operación.", thrownError: error }), 10000);
    } finally {
      setIsSubmittingPayment(false);
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
      if (selected) addProduct(selected);
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
      setNoticeTimed("");
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

  if (isInitialLoading) {
    return (
      <section className="flex h-[calc(100vh-10.5rem)] min-h-[34rem] items-center justify-center" data-testid="pos-root-loading">
        <div className="text-center space-y-2">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--color-primary-200)] border-t-[var(--color-primary-600)]" />
          <p className="text-sm text-[var(--color-text-muted)]">Preparando punto de venta...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3" data-testid="pos-root">
      <section className="h-[calc(100vh-10.5rem)] min-h-[34rem] overflow-hidden">
        <div className="grid h-full gap-4 lg:grid-cols-[1.05fr_1.4fr]">
          <Card className="flex h-full flex-col overflow-hidden rounded-2xl" data-testid="pos-catalog-zone">
            <div className="px-4 pt-4 pb-3">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Catálogo rápido</h2>
                {showingTopSelling && !search.trim() ? (
                  <Badge variant="neutral" className="text-[0.6rem]">Top vendidos</Badge>
                ) : null}
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">Busca por nombre, SKU o código de barras.</p>
              <input
                ref={searchInputRef}
                className="mt-2 w-full rounded-xl border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none transition-all focus:border-[var(--color-primary-500)] focus:ring-2 focus:ring-[var(--color-primary-100)]"
                placeholder="Buscar producto (↑ ↓ navega, Enter agrega)"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                disabled={isBusy}
                data-testid="pos-search-input"
              />
            </div>

            <div
              ref={catalogViewportRef}
              className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
              onScroll={(event) => setCatalogScrollTop(event.currentTarget.scrollTop)}
              data-testid="pos-catalog-viewport"
            >
              {loadingProducts ? <p className="p-2 text-xs text-[var(--color-text-soft)]">Cargando catálogo...</p> : null}
              {!loadingProducts && products.length === 0 ? (
                <p className="p-2 text-xs text-[var(--color-text-soft)]">No hay productos para esta búsqueda.</p>
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
                      className={`rounded-xl border p-2.5 text-left text-sm transition-all hover:bg-[var(--color-surface-muted)] ${selected ? "border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] shadow-sm" : "border-[var(--color-border)]"}`}
                      onClick={() => {
                        setActiveProductIndex(index);
                        addProduct(product);
                      }}
                      disabled={isBusy}
                      data-testid={`pos-product-${product.id}`}
                    >
                      <div className="font-medium">{product.name}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">SKU: {product.sku} {product.barcode ? `· BAR: ${product.barcode}` : ""}</div>
                      <div className="text-xs font-semibold text-[var(--color-text)]">C$ {Number(product.standardSalePrice).toFixed(2)}</div>
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
            className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-strong)]"
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
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {order?.lines.map((line) => {
                        const qtyError = lineQuantityErrors[line.id];
                        const qtyValue = lineDraftQuantities[line.id] ?? line.quantity;

                        return (
                          <tr key={line.id} className="border-b border-[var(--color-border)]">
                            <td className="py-2">
                              <div>{line.product?.name ?? line.productId}</div>
                              {Number(line.discountAmount) > 0 ? (
                                <div className="text-[0.65rem] font-medium text-[var(--color-text-muted)]">
                                  Desc: -C$ {Number(line.discountAmount).toFixed(2)}
                                </div>
                              ) : null}
                            </td>
                            <td>C$ {Number(line.unitPrice).toFixed(2)}</td>
                            <td>
                              <div className="flex items-center gap-2">
                                <input
                                  className={`w-20 rounded-lg border px-2 py-1 ${qtyError ? "border-[var(--color-danger-500)]" : "border-[var(--color-border)]"}`}
                                  type="text"
                                  inputMode="decimal"
                                  value={qtyValue}
                                  disabled={lineUpdatingId === line.id || isSubmittingPayment}
                                  data-testid={`pos-line-qty-${line.id}`}
                                  onChange={(event) => {
                                    const next = event.target.value;
                                    setLineDraftQuantities((prev) => ({ ...prev, [line.id]: next }));
                                    if (!next.trim()) {
                                      setLineQuantityErrors((prev) => ({ ...prev, [line.id]: "La cantidad es obligatoria." }));
                                      return;
                                    }
                                    setLineQuantityErrors((prev) => {
                                      const copy = { ...prev };
                                      delete copy[line.id];
                                      return copy;
                                    });
                                  }}
                                  onBlur={() => {
                                    commitLineQuantity(line);
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      commitLineQuantity(line);
                                    }
                                  }}
                                />
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={lineUpdatingId === line.id || isSubmittingPayment}
                                  onClick={() => commitLineQuantity(line)}
                                  data-testid={`pos-line-apply-${line.id}`}
                                >
                                  Aplicar
                                </Button>
                              </div>
                              {qtyError ? <p className="mt-1 text-[0.7rem] text-[var(--color-danger-600)]">{qtyError}</p> : null}
                            </td>
                            <td className="font-medium">C$ {Number(line.lineSubtotal).toFixed(2)}</td>
                            <td>
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={lineUpdatingId === line.id || isSubmittingPayment}
                                data-testid={`pos-line-remove-${line.id}`}
                                onClick={() => removeLine(line.id)}
                              >
                                Quitar
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {order && order.lines.length === 0 ? (
                  <p className="p-2 text-xs text-[var(--color-text-soft)]">Aún no agregas productos al ticket.</p>
                ) : null}
              </div>

              <div className="rounded-b-2xl border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3" data-testid="pos-payment-zone">
                <div className="grid gap-1 text-sm">
                  <div className="flex justify-between"><span>Subtotal</span><strong>C$ {Number(order?.subtotal ?? 0).toFixed(2)}</strong></div>
                  <div className="flex justify-between"><span>Descuento</span><strong>C$ {Number(order?.discountTotal ?? 0).toFixed(2)}</strong></div>
                  {includeTransport && transportAmountValue > 0 ? (
                    <div className="flex justify-between text-[var(--color-text)]">
                      <span>Transporte</span><strong>C$ {transportAmountValue.toFixed(2)}</strong>
                    </div>
                  ) : null}
                  <div className="mt-1 flex justify-between border-t border-[var(--color-border)] pt-1 text-base">
                    <span>Total</span>
                    <strong data-testid="pos-total">C$ {(Number(order?.subtotal ?? 0) + transportAmountValue).toFixed(2)}</strong>
                  </div>
                </div>

                <label className="mt-3 flex cursor-pointer select-none items-center gap-2" data-testid="pos-transport-toggle">
                  <input
                    type="checkbox"
                    checked={includeTransport}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setIncludeTransport(checked);
                      if (!checked) {
                        setTransportAmount("");
                        setTransportTouched(false);
                      }
                    }}
                    className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary-600)] focus:ring-[var(--color-primary-500)]"
                    disabled={isBusy}
                  />
                  <span className="text-sm text-[var(--color-text-secondary)]">Requiere servicio de transporte</span>
                </label>

                {includeTransport ? (
                  <div className="mt-2 space-y-1">
                    <label className="block text-xs font-medium text-[var(--color-text-muted)]">Monto de transporte (C$)</label>
                    <input
                      className={`w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 ${transportTouched && transportValidationError ? "border-[var(--color-danger-500)] focus:border-[var(--color-danger-500)] focus:ring-[var(--color-danger-100)]" : "border-[var(--color-border)] focus:border-[var(--color-primary-500)] focus:ring-[var(--color-primary-100)]"}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={transportAmount}
                      onChange={(event) => {
                        setTransportAmount(event.target.value);
                        if (transportTouched) {
                          setNoticeTimed("");
                        }
                      }}
                      onBlur={() => setTransportTouched(true)}
                      placeholder="Ej: 150.00"
                      disabled={isBusy}
                      data-testid="pos-transport-amount"
                    />
                    {transportTouched && transportValidationError ? (
                      <p className="text-xs text-[var(--color-danger-600)]" data-testid="pos-transport-error">
                        {transportValidationError}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {branchConfig?.enableCashier === false && (
                  <div className="mt-3 space-y-2">
                    <label className="block text-xs font-medium text-[var(--color-text-muted)]">Método de pago</label>
                    <select
                      className="w-full rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm"
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      disabled={isBusy}
                      data-testid="pos-payment-method"
                    >
                      <option value="CASH">Efectivo</option>
                      <option value="CARD">Tarjeta</option>
                      <option value="TRANSFER">Transferencia</option>
                      <option value="CREDIT">Crédito</option>
                    </select>
                    {!activeCashSessionId && (
                      <p className="text-xs text-[var(--color-danger-600)]">
                        No hay sesión de caja abierta para registrar venta directa.
                      </p>
                    )}
                  </div>
                )}

                <Button
                  ref={sendButtonRef}
                  variant="success"
                  className="mt-3 w-full rounded-xl"
                  onClick={sendToPayment}
                  disabled={isBusy || !order || order.lines.length === 0 || Boolean(includeTransport && transportValidationError)}
                  data-testid="pos-send-to-payment"
                >
                  {isSubmittingPayment
                    ? (branchConfig?.enableCashier === false ? "Registrando venta directa..." : "Enviando a caja...")
                    : branchConfig?.enableCashier === false
                      ? (includeTransport
                          ? `Registrar venta directa con transporte (C$ ${(Number(order?.subtotal ?? 0) + transportAmountValue).toFixed(2)})`
                          : "Registrar venta directa")
                      : (includeTransport
                          ? `Enviar a caja con transporte (C$ ${(Number(order?.subtotal ?? 0) + transportAmountValue).toFixed(2)})`
                          : "Enviar a caja (pendiente de pago)")}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {notice ? (
        <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2 text-sm text-[var(--color-text-secondary)]" data-testid="pos-notice">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
