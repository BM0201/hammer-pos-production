"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Check, ShoppingCart, Trash2 } from "lucide-react";
import { measurePosMetric } from "@/lib/telemetry";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { mapPosErrorToSpanish, type ApiErrorPayload } from "@/lib/pos-ui";
import { apiFetch } from "@/lib/client/api";
import { PrintModal } from "@/components/print/print-modal";
import { openPrintableDocument, recordPrintAudit } from "@/lib/printing";
import "@/styles/responsive.css";

type ProductRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  standardSalePrice: string;
  branchPrice?: string | null;
  effectivePrice?: string;
  priceSource?: "BRANCH" | "STANDARD";
  unit: string;
  stockConversion?: {
    stockGroupId: string;
    stockGroupCode: string;
    stockGroupName: string;
    baseUnit: string;
    saleUnit: string;
    conversionFactor: string | number;
    isCanonical: boolean;
  } | null;
  sharedStock?: {
    baseQuantity: number;
    saleQuantity: number;
    baseUnit: string;
    saleUnit: string;
  } | null;
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
  taxTotal: string;
  transportAmount?: string;
  lines?: TicketLine[];
};

type InventoryBalanceRow = {
  productId: string;
  quantityOnHand: string;
};

const ROW_HEIGHT = 96;
const OVERSCAN = 8;
const MAX_REASONABLE_QUANTITY = 9999;
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Pagado",
  CANCELLED: "Cancelado",
};

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

  // ── Print Modal (FASE 3) ──
  const [printModalOrderId, setPrintModalOrderId] = useState<string | null>(null);
  const [printModalOrderNumber, setPrintModalOrderNumber] = useState<string>("");
  const [printSettings, setPrintSettings] = useState<{ autoPrintTicket?: boolean; autoPrintDelivery?: boolean } | null>(null);

  // ── Responsive (FASE 4) ──
  const isBusy = isMutatingOrder || isSubmittingPayment;
  const ticketLines = useMemo(() => order?.lines ?? [], [order?.lines]);
  const hasTicketLines = ticketLines.length > 0;
  const totalAmount = Number(order?.grandTotal ?? 0);
  const orderStatusLabel = STATUS_LABELS[order?.status ?? "DRAFT"] ?? (order?.status ?? "Borrador");

  const orderLineByProductId = useMemo(() => {
    const map = new Map<string, TicketLine>();
    for (const line of ticketLines) map.set(line.productId, line);
    return map;
  }, [ticketLines]);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/printing/settings?branchId=${branchId}`)
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json();
        if (!cancelled) setPrintSettings(payload.data ?? null);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [branchId]);

  const transportAmountNumber = Number(transportAmount);
  const transportAmountValue = includeTransport && Number.isFinite(transportAmountNumber) && transportAmountNumber > 0
    ? transportAmountNumber
    : 0;

  const seedSharedStock = useCallback((rows: ProductRow[]) => {
    const next: Record<string, number> = {};
    for (const row of rows) {
      if (row.sharedStock && Number.isFinite(row.sharedStock.saleQuantity)) {
        next[row.id] = row.sharedStock.saleQuantity;
      }
    }
    if (Object.keys(next).length > 0) {
      setStockByProductId((prev) => ({ ...prev, ...next }));
    }
  }, []);

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

  const autoPrintCompletedOrder = useCallback(async (completedOrder: TicketOrder) => {
    if (!printSettings?.autoPrintTicket && !printSettings?.autoPrintDelivery) return;
    try {
      if (printSettings.autoPrintTicket) {
        await openPrintableDocument(`/api/printing/sales/${completedOrder.id}/ticket?format=HTML`);
        await recordPrintAudit({ branchId, saleOrderId: completedOrder.id, entityType: "SaleOrder", entityId: completedOrder.id, documentType: "PURCHASE_TICKET" });
      }
      if (printSettings.autoPrintDelivery) {
        await openPrintableDocument(`/api/printing/sales/${completedOrder.id}/delivery-order?format=HTML`);
        await recordPrintAudit({ branchId, saleOrderId: completedOrder.id, entityType: "SaleOrder", entityId: completedOrder.id, documentType: "DELIVERY_ORDER" });
      }
    } catch {
      setNoticeTimed("La venta fue completada, pero no se pudo abrir la impresion automatica.", 10000);
    }
  }, [branchId, printSettings, setNoticeTimed]);

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
      const params = new URLSearchParams({ isActive: "true", topSelling: "true", limit: "5", branchId });
      const response = await fetch(`/api/catalog/products?${params.toString()}`);
      const json = (await response.json()) as { data?: ProductRow[]; message?: string; reason?: string };

      if (!response.ok) {
        setNoticeTimed(resolveApiMessage({ payload: json, status: response.status, fallback: "No se pudieron cargar los productos más vendidos." }), 10000);
        return;
      }

      const rows = json.data ?? [];
      seedSharedStock(rows);
      setTopProducts(rows);
      if (!search.trim()) {
        setProducts(rows);
        setShowingTopSelling(true);
      }
    } catch (error) {
      console.error("[POS][loadTopSelling]", error);
      setNoticeTimed(resolveApiMessage({ fallback: "No se pudieron cargar los productos más vendidos.", thrownError: error }), 10000);
    }
  }, [branchId, resolveApiMessage, seedSharedStock, setNoticeTimed, search]);

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
      const params = new URLSearchParams({ q: query, isActive: "true", branchId });
      const response = await fetch(`/api/catalog/products?${params.toString()}`);
      const json = (await response.json()) as { data?: ProductRow[]; message?: string; reason?: string };

      if (!response.ok) {
        setNoticeTimed(resolveApiMessage({ payload: json, status: response.status, fallback: "No se pudo cargar el catálogo." }), 10000);
        stopMetric(false);
        return;
      }

      const rows = json.data ?? [];
      seedSharedStock(rows);
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
  }, [branchId, resolveApiMessage, seedSharedStock, setNoticeTimed, topProducts]);

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
    if (branchConfig?.enableCashier !== false) {
      setActiveCashSessionId(null);
      return;
    }
    async function loadActiveCashSession() {
      try {
        const query = new URLSearchParams({ branchId });
        const res = await fetch(`/api/cashier/cash-sessions/active?${query.toString()}`);
        const json = await res.json();
        const data = json?.data ?? json;
        if (data?.id) {
          setActiveCashSessionId(data.id);
        } else {
          setActiveCashSessionId(null);
        }
      } catch {
        setActiveCashSessionId(null);
        // Will show error when trying to sell
      }
    }
    loadActiveCashSession();
  }, [branchConfig, branchId]);

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
    const nextLineIds = new Set(ticketLines.map((line) => line.id));

    setLineDraftQuantities((prev) => {
      const next: Record<string, string> = {};
      for (const line of ticketLines) {
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
  }, [ticketLines]);

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
    if (!order || isSubmittingPayment || ticketLines.length === 0) return;

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
        toast.success(completionMsg);
        await autoPrintCompletedOrder(order);

        // Mostrar modal de impresion post-pago
        if (order) {
          setPrintModalOrderId(order.id);
          setPrintModalOrderNumber(order.orderNumber);
        }
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
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-info-600)]" />
          <p className="text-sm text-[var(--color-text-muted)]">Preparando punto de venta...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3" data-testid="pos-root">
      <section className="h-[calc(100vh-10.5rem)] min-h-[34rem] overflow-hidden">
        <div className="grid h-full gap-4 grid-cols-1 lg:grid-cols-[1.05fr_1.4fr]">
          <Card className="flex h-full flex-col overflow-hidden rounded-lg" data-testid="pos-catalog-zone">
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
                className="mt-2 w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none transition-all focus:border-[var(--color-info-500)] focus:ring-2 focus:ring-[var(--color-info-100)]"
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
                  const displayPrice = product.effectivePrice ?? product.standardSalePrice;
                  const conversionFactor = Number(product.stockConversion?.conversionFactor ?? 0);
                  const sharedStock = product.sharedStock;

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
                      className={`rounded-lg border p-2.5 text-left text-sm transition-all hover:bg-[var(--color-surface-muted)] ${selected ? "border-[var(--color-info-400)] bg-[var(--color-info-50)] shadow-sm" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}
                      onClick={() => {
                        setActiveProductIndex(index);
                        addProduct(product);
                      }}
                      disabled={isBusy}
                      data-testid={`pos-product-${product.id}`}
                    >
                      <div className="font-medium">{product.name}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">SKU: {product.sku} {product.barcode ? `· BAR: ${product.barcode}` : ""}</div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--color-text)]">C$ {Number(displayPrice).toFixed(2)}</span>
                        {product.priceSource === "BRANCH" ? (
                          <span className="rounded border border-[var(--color-info-200)] px-1.5 py-0.5 text-[0.62rem] font-medium text-[var(--color-info-700)]">
                            Sucursal
                          </span>
                        ) : null}
                      </div>
                      {product.stockConversion && sharedStock ? (
                        <div className="mt-1 text-[0.65rem] text-[var(--color-text-muted)]">
                          Stock compartido: {sharedStock.saleQuantity.toFixed(2)} {sharedStock.saleUnit} / {sharedStock.baseQuantity.toFixed(2)} {sharedStock.baseUnit}
                          {conversionFactor > 1 ? ` - 1 ${sharedStock.saleUnit} = ${conversionFactor} ${sharedStock.baseUnit}` : ""}
                        </div>
                      ) : null}
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
            className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-strong)]"
            data-testid="pos-ticket-zone"
          >
            <Card className="flex h-full flex-col overflow-hidden rounded-lg">
              <div className="px-4 pt-4 pb-3">
                <h2 className="text-sm font-semibold">Ticket actual</h2>
                <p className="text-xs text-[var(--color-text-muted)]">Orden: {order?.orderNumber ?? "preparando..."} - Estado: {orderStatusLabel}</p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" data-testid="pos-ticket-lines">
                <div className="overflow-x-auto">
                  <table className="hm-table min-w-[34rem] w-full">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Precio</th>
                        <th>Cant.</th>
                        <th>Subtotal</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {ticketLines.map((line) => {
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
                                  icon={<Check className="h-3.5 w-3.5" />}
                                >
                                  Aplicar
                                </Button>
                              </div>
                              {qtyError ? <p className="mt-1 text-[0.7rem] text-[var(--color-danger-600)]">{qtyError}</p> : null}
                            </td>
                            <td className="font-medium">C$ {Number(line.lineSubtotal).toFixed(2)}</td>
                            <td>
                              <Button
                                variant="danger"
                                size="sm"
                                disabled={lineUpdatingId === line.id || isSubmittingPayment}
                                data-testid={`pos-line-remove-${line.id}`}
                                onClick={() => removeLine(line.id)}
                                icon={<Trash2 className="h-3.5 w-3.5" />}
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
                {order && !hasTicketLines ? (
                  <div className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] p-5 text-center">
                    <p className="text-sm font-semibold text-[var(--color-text)]">Ticket vacio</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">Agrega productos desde el catalogo rapido.</p>
                  </div>
                ) : null}
              </div>

              <div className="rounded-b-lg border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3" data-testid="pos-payment-zone">
                <div className="grid gap-1 text-sm">
                  <div className="flex justify-between"><span>Subtotal</span><strong>C$ {Number(order?.subtotal ?? 0).toFixed(2)}</strong></div>
                  <div className="flex justify-between"><span>Descuento</span><strong>C$ {Number(order?.discountTotal ?? 0).toFixed(2)}</strong></div>
                  {Number(order?.taxTotal ?? 0) > 0 ? (
                    <div className="flex justify-between text-[var(--color-text)]">
                      <span>IVA</span><strong>C$ {Number(order?.taxTotal ?? 0).toFixed(2)}</strong>
                    </div>
                  ) : null}
                  {includeTransport && transportAmountValue > 0 ? (
                    <div className="flex justify-between text-[var(--color-text)]">
                      <span>Transporte</span><strong>C$ {transportAmountValue.toFixed(2)}</strong>
                    </div>
                  ) : null}
                  <div className="mt-1 flex justify-between border-t border-[var(--color-border)] pt-2 text-lg">
                    <span>Total</span>
                    <strong data-testid="pos-total">C$ {totalAmount.toFixed(2)}</strong>
                  </div>
                </div>

                <label className={`mt-3 flex cursor-pointer select-none items-start gap-3 rounded-lg border p-3 transition-colors ${includeTransport ? "border-[var(--color-info-300)] bg-[var(--color-info-50)]" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`} data-testid="pos-transport-toggle">
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
                    className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-info-600)] focus:ring-[var(--color-info-500)]"
                    disabled={isBusy}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-[var(--color-text)]">Agregar transporte</span>
                    <span className="block text-xs text-[var(--color-text-muted)]">Flete, envio o entrega a domicilio</span>
                  </span>
                </label>

                {includeTransport ? (
                  <div className="mt-2 space-y-1">
                    <label className="block text-xs font-medium text-[var(--color-text-muted)]">Monto de transporte (C$)</label>
                    <input
                      className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 ${transportTouched && transportValidationError ? "border-[var(--color-danger-500)] focus:border-[var(--color-danger-500)] focus:ring-[var(--color-danger-100)]" : "border-[var(--color-border)] focus:border-[var(--color-info-500)] focus:ring-[var(--color-info-100)]"}`}
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
                      className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
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
                      <div className="rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-3">
                        <p className="text-xs text-[var(--color-danger-600)] font-medium">
                          ⚠️ No hay sesión de caja abierta para registrar venta directa.
                        </p>
                        <p className="text-xs text-[var(--color-danger-500)] mt-1">
                          Abra una sesión de caja desde el módulo de caja para poder realizar ventas.
                        </p>
                        <a
                          href="/app/branch/cashier/payments"
                          className="inline-block mt-2 text-xs font-medium text-[var(--color-primary-600)] hover:underline"
                        >
                          → Ir al módulo de caja
                        </a>
                      </div>
                    )}
                  </div>
                )}

                <Button
                  ref={sendButtonRef}
                  variant="success"
                  className="mt-3 w-full rounded-lg text-base"
                  onClick={sendToPayment}
                  disabled={isBusy || !order || !hasTicketLines || Boolean(includeTransport && transportValidationError)}
                  data-testid="pos-send-to-payment"
                  icon={<ShoppingCart className="h-5 w-5" />}
                  loading={isSubmittingPayment}
                >
                  {isSubmittingPayment
                    ? (branchConfig?.enableCashier === false ? "Registrando..." : "Enviando...")
                    : !hasTicketLines
                      ? "Agrega productos para enviar a caja"
                      : branchConfig?.enableCashier === false
                        ? `Registrar venta directa - C$ ${totalAmount.toFixed(2)}`
                        : `Enviar a caja - C$ ${totalAmount.toFixed(2)}`}
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

      {/* FASE 3: Modal de impresión post-pago */}
      {printModalOrderId && (
        <PrintModal
          orderId={printModalOrderId}
          orderNumber={printModalOrderNumber}
          onClose={() => {
            setPrintModalOrderId(null);
            setPrintModalOrderNumber("");
          }}
        />
      )}
    </section>
  );
}
