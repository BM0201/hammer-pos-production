"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LockKeyhole, Loader2, Minus, Plus, Trash2, WifiOff } from "lucide-react";
import { usePosRealtimeSummary } from "./hooks/use-pos-realtime-summary";
import { usePosPrint } from "./hooks/use-pos-print";
import { usePosCatalog } from "./hooks/use-pos-catalog";
import { usePosCashContext } from "./hooks/use-pos-cash-context";
import { usePosOrder } from "./hooks/use-pos-order";
import { usePosCheckout } from "./hooks/use-pos-checkout";
import { useOfflineMode } from "@/hooks/use-offline-mode";
import { useOfflineCart } from "./hooks/use-offline-cart";
import { useSession } from "@/lib/client/session";
import { canInAnyAssignedBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { PrintModal } from "@/components/print/print-modal";
import { PosCatalogPanel } from "./components/pos-catalog-panel";
import { PosTicketPanel } from "./components/pos-ticket-panel";
import { ChargeDialog } from "./components/charge-dialog";
import { OfflineBanner } from "./offline-banner";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api";
import { enqueueOfflineSale } from "@/lib/offline-db";
import { money } from "@/lib/format";
import type { CachedProduct } from "@/lib/offline-db";
import "@/styles/responsive.css";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Pagado",
  DISPATCH_PENDING: "Pendiente de despacho",
  DISPATCHED: "Despachado",
  CANCELLED: "Cancelado",
};

export function BranchPos({ branchId }: { branchId: string }) {
  const sessionState = useSession();
  const [notice, setNotice] = useState("");
  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  const [offlineCheckoutOpen, setOfflineCheckoutOpen] = useState(false);
  const [isSavingOffline, setIsSavingOffline] = useState(false);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const ticketPanelRef = useRef<HTMLDivElement | null>(null);
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);

  // Cash gate state
  const [openingBalance, setOpeningBalance] = useState("0");
  const [isOpeningSession, setIsOpeningSession] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  const { isOffline, pendingCount, syncState, lastSyncResult, syncQueue, refreshPendingCount } = useOfflineMode();
  const offlineCart = useOfflineCart();

  const { loadRealtimeSummary } = usePosRealtimeSummary(branchId);
  const {
    posContext,
    branchConfig,
    activeCashSessionId,
    hasOpenCashSession,
    paymentMethod,
    setPaymentMethod,
    canSendToCashier,
    canCollectHere,
  } = usePosCashContext(branchId);

  const setNoticeTimed = useCallback((msg: string, ms = 6000) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice(msg);
    if (msg) noticeTimerRef.current = setTimeout(() => setNotice(""), ms);
  }, []);

  const onNoticeError = useCallback((msg: string) => setNoticeTimed(msg, 10000), [setNoticeTimed]);

  const { printModalOrderId, setPrintModalOrderId, printModalOrderNumber, setPrintModalOrderNumber, autoPrintCompletedOrder } =
    usePosPrint(branchId, onNoticeError);

  const {
    search, setSearch, products, loadingProducts, showingTopSelling,
    stockByProductId, activeProductIndex, setActiveProductIndex,
    catalogScrollTop, setCatalogScrollTop, catalogViewportRef, fetchStockForProduct,
  } = usePosCatalog(branchId, onNoticeError, isOffline);

  const {
    order, isInitialLoading, isMutatingOrder, reloadOrder,
    addProduct, commitLineQuantity, removeLine, updateOrderNotes,
    ticketLines, lineDraftQuantities, setLineDraftQuantities,
    lineQuantityErrors, setLineQuantityErrors, lineUpdatingId,
  } = usePosOrder(branchId, {
    fetchStockForProduct,
    stockByProductId,
    onNotice: (msg, ms) => setNoticeTimed(msg, ms),
    onProductAdded: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
  });

  const {
    isSubmittingPayment, includeTransport, setIncludeTransport,
    transportAmount, setTransportAmount, transportTouched, setTransportTouched,
    transportAmountValue, transportValidationError,
    referenceNumber, setReferenceNumber,
    completeTicket,
  } = usePosCheckout({
    order, ticketLines, reloadOrder,
    canSendToCashier, canCollectHere, activeCashSessionId,
    paymentMethod, branchConfig, loadRealtimeSummary,
    autoPrintCompletedOrder, setPrintModalOrderId, setPrintModalOrderNumber,
    onNotice: (msg, ms) => setNoticeTimed(msg, ms),
    onCompleted: () => {
      setSearch("");
      setActiveProductIndex(0);
      setChargeDialogOpen(false);
      searchInputRef.current?.focus();
    },
  });

  useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); }, []);
  useEffect(() => { searchInputRef.current?.focus(); }, []);

  // ── Cash session gate: open session handler ──
  async function handleOpenSession() {
    setIsOpeningSession(true);
    setGateError(null);
    try {
      // Fetch first available cash box for this branch
      const boxRes = await apiFetch(`/api/cashier/cash-boxes?branchId=${encodeURIComponent(branchId)}`);
      const boxJson = await boxRes.json();
      const boxes: Array<{ id: string; name: string }> = (boxJson?.data ?? boxJson) ?? [];
      if (!boxes.length) {
        setGateError("No hay cajas físicas configuradas para esta sucursal. Pide a un administrador que cree una.");
        return;
      }
      const physicalCashBoxId = boxes[0].id;
      const balance = Number(openingBalance) || 0;

      const res = await apiFetch("/api/cashier/cash-sessions/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ physicalCashBoxId, openingBalance: balance, branchId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setGateError((err as { message?: string })?.message ?? "No se pudo abrir la sesión.");
        return;
      }
      // Reload context so hasOpenCashSession becomes true
      window.location.reload();
    } catch {
      setGateError("Error de red. Verifica tu conexión.");
    } finally {
      setIsOpeningSession(false);
    }
  }

  // ── Offline checkout handler ──
  const handleOfflineCheckout = useCallback(async () => {
    if (!activeCashSessionId) {
      setNoticeTimed("Sin sesión de caja — no se puede registrar venta offline.", 10000);
      return;
    }
    const session = sessionState.status === "authenticated" ? sessionState.session : null;
    if (!session?.userId) {
      setNoticeTimed("Sin sesión de usuario — no se puede registrar venta offline.", 10000);
      return;
    }
    if (offlineCart.lines.length === 0) return;

    setIsSavingOffline(true);
    try {
      await enqueueOfflineSale({
        offlineId: `OFFLINE-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        branchId,
        cashSessionId: activeCashSessionId,
        operatorUserId: session.userId,
        lines: offlineCart.lines.map(l => ({
          productId: l.productId,
          productName: l.productName,
          sku: l.sku,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountAmount: l.discountAmount,
          lineSubtotal: l.lineSubtotal,
        })),
        grandTotal: offlineCart.grandTotal,
        notes: offlineCart.notes || undefined,
        createdAt: new Date().toISOString(),
        status: "PENDING_SYNC",
      });
      await refreshPendingCount();
      offlineCart.clear();
      setOfflineCheckoutOpen(false);
      setNoticeTimed(`Venta guardada offline (${pendingCount + 1} en cola). Se sincronizará al reconectarse.`, 8000);
    } catch {
      setNoticeTimed("No se pudo guardar la venta offline. Intenta de nuevo.", 10000);
    } finally {
      setIsSavingOffline(false);
    }
  }, [activeCashSessionId, sessionState, offlineCart, branchId, pendingCount, refreshPendingCount, setNoticeTimed]);

  const isBusy = isMutatingOrder || isSubmittingPayment;
  const hasTicketLines = ticketLines.length > 0;
  const displayedTotalAmount = Number(order?.grandTotal ?? 0) + transportAmountValue;
  const orderStatusLabel = STATUS_LABELS[order?.status ?? "DRAFT"] ?? (order?.status ?? "Borrador");

  // ── Loading ──
  if (isInitialLoading) {
    return (
      <section className="flex h-full items-center justify-center" data-testid="pos-root-loading">
        <div className="text-center space-y-2">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--color-text-soft)]" />
          <p className="text-sm text-[var(--color-text-muted)]">Preparando punto de venta...</p>
        </div>
      </section>
    );
  }

  // ── Cash session gate ──
  // Solo bloquea si el usuario necesita cobrar directamente y no hay sesión.
  // Usuarios que solo envían a caja (SALES puro) pueden crear órdenes sin sesión.
  if (!hasOpenCashSession && canCollectHere && !canSendToCashier) {
    const session = sessionState.status === "authenticated" ? sessionState.session : null;
    const canOpen = session ? canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPEN) : false;

    return (
      <section className="flex h-full items-center justify-center p-6" data-testid="pos-cash-gate">
        <div className="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-[var(--shadow-lg)]">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface-alt)]">
            <LockKeyhole className="h-7 w-7 text-[var(--color-text-muted)]" />
          </div>
          <h2 className="text-base font-bold text-[var(--color-text)]">La caja está cerrada</h2>

          {canOpen ? (
            <>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                Ingresa el monto inicial para abrir la sesión de hoy.
              </p>
              <div className="mt-4 text-left">
                <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                  Monto inicial (caja chica) C$
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-soft)] focus:border-[var(--color-pay)] focus:ring-2 focus:ring-[var(--color-pay)]/10"
                  value={openingBalance}
                  onChange={(e) => { setOpeningBalance(e.target.value); setGateError(null); }}
                  placeholder="0.00"
                />
              </div>
              {gateError ? (
                <p className="mt-2 text-xs text-[var(--color-danger-600)]">{gateError}</p>
              ) : null}
              <Button
                variant="success"
                className="mt-4 w-full rounded-xl"
                onClick={handleOpenSession}
                loading={isOpeningSession}
              >
                Abrir caja
              </Button>
            </>
          ) : (
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              La caja aún no está abierta. Pide a un administrador o master que la abra.
            </p>
          )}
        </div>
      </section>
    );
  }

  // ── Main POS ──
  return (
    <section className="flex h-full min-h-0 flex-col gap-3 overflow-hidden" data-testid="pos-root">

      <OfflineBanner
        isOffline={isOffline}
        pendingCount={pendingCount}
        syncState={syncState}
        lastSyncResult={lastSyncResult}
        onSync={syncQueue}
      />

      <section className="min-h-0 flex-1 overflow-hidden">
        <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(12rem,0.75fr)_minmax(0,1.25fr)] gap-4 xl:grid-cols-[0.9fr_1.1fr] xl:grid-rows-1">
          <PosCatalogPanel
            search={search}
            setSearch={setSearch}
            products={products}
            loadingProducts={loadingProducts}
            showingTopSelling={showingTopSelling}
            stockByProductId={stockByProductId}
            activeProductIndex={activeProductIndex}
            setActiveProductIndex={setActiveProductIndex}
            catalogScrollTop={catalogScrollTop}
            setCatalogScrollTop={setCatalogScrollTop}
            catalogViewportRef={catalogViewportRef}
            searchInputRef={searchInputRef}
            isBusy={isBusy}
            onAddProduct={isOffline
              ? (product) => offlineCart.addProduct(product as unknown as CachedProduct)
              : addProduct}
            onTabToTicket={() => ticketPanelRef.current?.focus()}
            onClearSearch={() => { setSearch(""); setNoticeTimed(""); }}
          />

          {/* ── Offline ticket panel ── */}
          {isOffline ? (
            <div className="flex flex-col gap-3 min-h-0 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <WifiOff className="h-4 w-4" style={{ color: "var(--color-danger-500)" }} />
                  <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                    Venta offline
                  </p>
                </div>
                <span className="text-xs rounded-full px-2 py-0.5" style={{ background: "var(--color-danger-100)", color: "var(--color-danger-700)" }}>
                  Solo efectivo
                </span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
                {offlineCart.lines.length === 0 ? (
                  <p className="text-sm text-center py-8" style={{ color: "var(--color-text-muted)" }}>
                    Agrega productos desde el catálogo
                  </p>
                ) : offlineCart.lines.map(line => (
                  <div key={line.lineId} className="flex items-center gap-2 rounded-lg p-2" style={{ background: "var(--color-surface-alt)", border: "0.5px solid var(--color-border)" }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>{line.productName}</p>
                      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{money(line.unitPrice)} × {line.quantity}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => offlineCart.updateQuantity(line.lineId, line.quantity - 1)} className="rounded p-1 hover:bg-[var(--color-surface-raised)]">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                      <button onClick={() => offlineCart.updateQuantity(line.lineId, line.quantity + 1)} className="rounded p-1 hover:bg-[var(--color-surface-raised)]">
                        <Plus className="h-3 w-3" />
                      </button>
                      <button onClick={() => offlineCart.removeLine(line.lineId)} className="rounded p-1 ml-1" style={{ color: "var(--color-danger-500)" }}>
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="text-sm font-bold tabular-nums w-20 text-right shrink-0" style={{ color: "var(--color-text)" }}>
                      {money(line.lineSubtotal)}
                    </p>
                  </div>
                ))}
              </div>

              {offlineCart.lines.length > 0 && (
                <div className="space-y-3 pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium" style={{ color: "var(--color-text-muted)" }}>Total</span>
                    <span className="text-xl font-bold tabular-nums" style={{ color: "var(--color-text)" }}>{money(offlineCart.grandTotal)}</span>
                  </div>
                  <Button
                    variant="success"
                    className="w-full rounded-xl"
                    onClick={() => setOfflineCheckoutOpen(true)}
                    disabled={!activeCashSessionId}
                  >
                    {activeCashSessionId ? "Cobrar en efectivo" : "Sin sesión de caja"}
                  </Button>
                  <button onClick={offlineCart.clear} className="w-full text-xs py-1 rounded-lg transition-colors hover:bg-[var(--color-surface-raised)]" style={{ color: "var(--color-text-muted)" }}>
                    Limpiar carrito
                  </button>
                </div>
              )}
            </div>
          ) : (
            <PosTicketPanel
              ticketPanelRef={ticketPanelRef}
              onEscapeToSearch={() => searchInputRef.current?.focus()}
              order={order}
              orderStatusLabel={orderStatusLabel}
              hasTicketLines={hasTicketLines}
              ticketLines={ticketLines}
              lineDraftQuantities={lineDraftQuantities}
              lineQuantityErrors={lineQuantityErrors}
              lineUpdatingId={lineUpdatingId}
              isSubmittingPayment={isSubmittingPayment}
              isBusy={isBusy}
              setLineDraftQuantities={setLineDraftQuantities}
              setLineQuantityErrors={setLineQuantityErrors}
              commitLineQuantity={commitLineQuantity}
              removeLine={removeLine}
              includeTransport={includeTransport}
              setIncludeTransport={setIncludeTransport}
              transportAmount={transportAmount}
              setTransportAmount={setTransportAmount}
              transportTouched={transportTouched}
              setTransportTouched={setTransportTouched}
              transportAmountValue={transportAmountValue}
              transportValidationError={transportValidationError}
              onClearNotice={() => setNoticeTimed("")}
              canCollectHere={canCollectHere}
              canSendToCashier={canSendToCashier}
              activeCashSessionId={activeCashSessionId}
              posContextMessages={posContext?.messages}
              displayedTotalAmount={displayedTotalAmount}
              sendButtonRef={sendButtonRef}
              onCompleteQueue={() => completeTicket("QUEUE")}
              onOpenChargeDialog={() => setChargeDialogOpen(true)}
              onUpdateNotes={updateOrderNotes}
            />
          )}
        </div>
      </section>

      {notice ? (
        <p
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2 text-sm text-[var(--color-text-secondary)]"
          data-testid="pos-notice"
        >
          {notice}
        </p>
      ) : null}

      {/* ── Offline checkout confirm modal ── */}
      {offlineCheckoutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}>
            <h3 className="text-base font-bold" style={{ color: "var(--color-text)" }}>Confirmar venta offline</h3>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              Esta venta se guardará localmente y se sincronizará con el servidor al recuperar la conexión.
            </p>
            <div className="rounded-lg p-3 space-y-1" style={{ background: "var(--color-surface-alt)", border: "0.5px solid var(--color-border)" }}>
              {offlineCart.lines.map(l => (
                <div key={l.lineId} className="flex justify-between text-sm">
                  <span style={{ color: "var(--color-text-secondary)" }}>{l.productName} ×{l.quantity}</span>
                  <span className="tabular-nums font-medium" style={{ color: "var(--color-text)" }}>{money(l.lineSubtotal)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm font-bold pt-2 border-t mt-2" style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}>
                <span>Total efectivo</span>
                <span className="tabular-nums">{money(offlineCart.grandTotal)}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setOfflineCheckoutOpen(false)}
                className="flex-1 rounded-xl py-2 text-sm border"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
              >
                Cancelar
              </button>
              <Button
                variant="success"
                className="flex-1 rounded-xl"
                onClick={handleOfflineCheckout}
                loading={isSavingOffline}
              >
                Confirmar y guardar
              </Button>
            </div>
          </div>
        </div>
      )}

      <ChargeDialog
        open={chargeDialogOpen}
        onClose={() => setChargeDialogOpen(false)}
        total={displayedTotalAmount}
        paymentMethod={paymentMethod}
        setPaymentMethod={setPaymentMethod}
        referenceNumber={referenceNumber}
        setReferenceNumber={setReferenceNumber}
        onConfirm={() => completeTicket("DIRECT")}
        isSubmitting={isSubmittingPayment}
      />

      {printModalOrderId ? (
        <PrintModal
          orderId={printModalOrderId}
          orderNumber={printModalOrderNumber}
          onClose={() => {
            setPrintModalOrderId(null);
            setPrintModalOrderNumber("");
          }}
        />
      ) : null}
    </section>
  );
}
