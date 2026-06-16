"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePosRealtimeSummary } from "./hooks/use-pos-realtime-summary";
import { usePosPrint } from "./hooks/use-pos-print";
import { usePosCatalog } from "./hooks/use-pos-catalog";
import { usePosCashContext } from "./hooks/use-pos-cash-context";
import { usePosOrder } from "./hooks/use-pos-order";
import { usePosCheckout } from "./hooks/use-pos-checkout";
import { PrintModal } from "@/components/print/print-modal";
import { PosSummaryCards } from "./components/pos-summary-cards";
import { PosCatalogPanel } from "./components/pos-catalog-panel";
import { PosTicketPanel } from "./components/pos-ticket-panel";
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
  const [notice, setNotice] = useState("");
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const ticketPanelRef = useRef<HTMLDivElement | null>(null);
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);

  const { realtimeSummary, summaryUpdatedAt, loadRealtimeSummary } = usePosRealtimeSummary(branchId);
  const {
    posContext,
    branchConfig,
    activeCashSessionId,
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

  // Stable callback — prevents usePosCatalog/usePosPrint from recreating their
  // internal useCallbacks on every BranchPos render, which caused loadTopSelling
  // and the search debounce to re-fire on every state change (typing, add product, etc.)
  const onNoticeError = useCallback((msg: string) => setNoticeTimed(msg, 10000), []);

  const { printModalOrderId, setPrintModalOrderId, printModalOrderNumber, setPrintModalOrderNumber, autoPrintCompletedOrder } =
    usePosPrint(branchId, onNoticeError);

  const {
    search, setSearch, products, loadingProducts, showingTopSelling,
    stockByProductId, activeProductIndex, setActiveProductIndex,
    catalogScrollTop, setCatalogScrollTop, catalogViewportRef, fetchStockForProduct,
  } = usePosCatalog(branchId, onNoticeError);

  const {
    order, isInitialLoading, isMutatingOrder, reloadOrder,
    addProduct, commitLineQuantity, removeLine,
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
    transportAmountValue, transportValidationError, completeTicket,
  } = usePosCheckout({
    order, ticketLines, reloadOrder,
    canSendToCashier, canCollectHere, activeCashSessionId,
    paymentMethod, branchConfig, loadRealtimeSummary,
    autoPrintCompletedOrder, setPrintModalOrderId, setPrintModalOrderNumber,
    onNotice: (msg, ms) => setNoticeTimed(msg, ms),
    onCompleted: () => {
      setSearch("");
      setActiveProductIndex(0);
      searchInputRef.current?.focus();
    },
  });

  useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); }, []);
  useEffect(() => { searchInputRef.current?.focus(); }, []);

  const isBusy = isMutatingOrder || isSubmittingPayment;
  const hasTicketLines = ticketLines.length > 0;
  const displayedTotalAmount = Number(order?.grandTotal ?? 0) + transportAmountValue;
  const orderStatusLabel = STATUS_LABELS[order?.status ?? "DRAFT"] ?? (order?.status ?? "Borrador");

  if (isInitialLoading) {
    return (
      <section className="flex h-[calc(100vh-12rem)] min-h-[34rem] items-center justify-center" data-testid="pos-root-loading">
        <div className="text-center space-y-2">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-info-600)]" />
          <p className="text-sm text-[var(--color-text-muted)]">Preparando punto de venta...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-[calc(100vh-7.5rem)] min-h-[34rem] flex-col gap-3 overflow-hidden" data-testid="pos-root">
      <PosSummaryCards
        realtimeSummary={realtimeSummary}
        summaryUpdatedAt={summaryUpdatedAt}
        activeCashSessionId={activeCashSessionId}
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
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            posContextMessages={posContext?.messages}
            displayedTotalAmount={displayedTotalAmount}
            sendButtonRef={sendButtonRef}
            onCompleteTicket={completeTicket}
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
