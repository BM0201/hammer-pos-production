"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LockKeyhole, Loader2 } from "lucide-react";
import { usePosRealtimeSummary } from "./hooks/use-pos-realtime-summary";
import { usePosPrint } from "./hooks/use-pos-print";
import { usePosCatalog } from "./hooks/use-pos-catalog";
import { usePosCashContext } from "./hooks/use-pos-cash-context";
import { usePosOrder } from "./hooks/use-pos-order";
import { usePosCheckout } from "./hooks/use-pos-checkout";
import { useSession } from "@/lib/client/session";
import { canInAnyAssignedBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { PrintModal } from "@/components/print/print-modal";
import { PosCatalogPanel } from "./components/pos-catalog-panel";
import { PosTicketPanel } from "./components/pos-ticket-panel";
import { ChargeDialog } from "./components/charge-dialog";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api";
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
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const ticketPanelRef = useRef<HTMLDivElement | null>(null);
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);

  // Cash gate state
  const [openingBalance, setOpeningBalance] = useState("0");
  const [isOpeningSession, setIsOpeningSession] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

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
  } = usePosCatalog(branchId, onNoticeError);

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
            onAddProduct={addProduct}
            onTabToTicket={() => ticketPanelRef.current?.focus()}
            onClearSearch={() => { setSearch(""); setNoticeTimed(""); }}
          />

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
