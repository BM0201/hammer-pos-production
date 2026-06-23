"use client";

import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import { Search, ScanLine, ShoppingCart } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ProductRow } from "../types";

const ROW_HEIGHT = 96;
const OVERSCAN = 8;
const VIEWPORT_HEIGHT = 520;

type PosCatalogPanelProps = {
  search: string;
  setSearch: (value: string) => void;
  products: ProductRow[];
  loadingProducts: boolean;
  showingTopSelling: boolean;
  stockByProductId: Record<string, number>;
  activeProductIndex: number;
  setActiveProductIndex: Dispatch<SetStateAction<number>>;
  catalogScrollTop: number;
  setCatalogScrollTop: (top: number) => void;
  catalogViewportRef: { current: HTMLDivElement | null };
  searchInputRef: { current: HTMLInputElement | null };
  isBusy: boolean;
  onAddProduct: (product: ProductRow) => void;
  /** Called on Tab key — focus the ticket panel. */
  onTabToTicket: () => void;
  /** Called on Escape key — clear search and dismiss the notice. */
  onClearSearch: () => void;
};

export function PosCatalogPanel({
  search,
  setSearch,
  products,
  loadingProducts,
  showingTopSelling,
  stockByProductId,
  activeProductIndex,
  setActiveProductIndex,
  catalogScrollTop,
  setCatalogScrollTop,
  catalogViewportRef,
  searchInputRef,
  isBusy,
  onAddProduct,
  onTabToTicket,
  onClearSearch,
}: PosCatalogPanelProps) {
  const totalHeight = products.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(catalogScrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    products.length,
    Math.ceil((catalogScrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN,
  );
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

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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
      if (selected) onAddProduct(selected);
      return;
    }

    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      onTabToTicket();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onClearSearch();
    }
  }

  return (
    <Card
      noPadding
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border-[var(--color-border)] shadow-sm"
      data-testid="pos-catalog-zone"
    >
      {/* ── Flat header (no gradient) ── */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-[var(--color-text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Catálogo rápido</h2>
        </div>
        {showingTopSelling && !search.trim() ? (
          <span className="rounded-full bg-[var(--color-success-100)] px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--color-success-700)]">
            Top vendidos
          </span>
        ) : null}
      </div>

      {/* ── Search bar ── */}
      <div className="px-4 pt-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-soft)]" />
          <input
            ref={searchInputRef}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 pl-9 pr-10 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-soft)] transition-colors focus:border-[var(--color-pay)] focus:ring-2 focus:ring-[var(--color-pay)]/10"
            placeholder="Buscar o escanear · Enter agrega"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            disabled={isBusy}
            data-testid="pos-search-input"
          />
          <ScanLine className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-soft)]" />
        </div>
      </div>

      {/* ── Product grid ── */}
      <div
        ref={catalogViewportRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
        onScroll={(event) => setCatalogScrollTop(event.currentTarget.scrollTop)}
        data-testid="pos-catalog-viewport"
      >
        {loadingProducts ? (
          <p className="p-2 text-xs text-[var(--color-text-soft)]">Cargando catálogo...</p>
        ) : null}
        {!loadingProducts && products.length === 0 ? (
          <p className="p-2 text-xs text-[var(--color-text-soft)]">No hay productos para esta búsqueda.</p>
        ) : null}

        <div style={{ height: `${totalHeight}px`, position: "relative" }}>
          {visibleProducts.map((product, localIndex) => {
            const index = startIndex + localIndex;
            const selected = index === activeProductIndex;
            const displayPrice = product.effectivePrice ?? product.standardSalePrice;
            const conversionFactor = Number(
              product.stockConversion?.conversionFactorToBase ?? product.stockConversion?.conversionFactor ?? 0,
            );
            const sharedStock = product.sharedStock;
            const availableStock =
              product.availableSaleStock ??
              sharedStock?.saleQuantity ??
              product.availableStock ??
              stockByProductId[product.id] ??
              0;
            const hasNoStock = availableStock <= 0;
            const isLowStock = !hasNoStock && availableStock < 5;

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
                className={[
                  "rounded-lg border p-2.5 text-left text-sm",
                  "transition-colors hover:bg-[var(--color-surface-muted)] active:scale-[0.99]",
                  selected
                    ? "border-[var(--color-pay)] bg-[color-mix(in_srgb,var(--color-pay)_8%,transparent)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)]",
                  hasNoStock ? "opacity-70" : "",
                ].join(" ")}
                onClick={() => {
                  setActiveProductIndex(index);
                  onAddProduct(product);
                }}
                disabled={isBusy || hasNoStock}
                data-testid={`pos-product-${product.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-[var(--color-text)] leading-tight">{product.name}</div>
                  {hasNoStock ? (
                    <span className="shrink-0 rounded border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-1.5 py-0.5 text-[0.62rem] font-semibold text-[var(--color-warning-700)]">
                      Sin stock
                    </span>
                  ) : null}
                </div>
                <div className="text-[0.68rem] text-[var(--color-text-muted)]">
                  SKU: {product.sku} {product.barcode ? `· BAR: ${product.barcode}` : ""}
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="font-semibold tabular-nums text-[var(--color-text)]">
                    C$ {Number(displayPrice).toFixed(2)}
                  </span>
                  {product.priceSource === "BRANCH" ? (
                    <span className="rounded border border-[var(--color-info-200)] px-1.5 py-0.5 text-[0.62rem] font-medium text-[var(--color-info-700)]">
                      Sucursal
                    </span>
                  ) : null}
                  <span className={[
                    "text-[0.65rem]",
                    isLowStock ? "text-[var(--color-warning-700)]" : "text-[var(--color-text-muted)]",
                  ].join(" ")}>
                    Stock: {availableStock.toFixed(2)} {product.saleUnit ?? product.unit}
                  </span>
                </div>
                {product.stockConversion && sharedStock ? (
                  <div className="mt-0.5 text-[0.63rem] text-[var(--color-text-muted)]">
                    {product.stockConversion.tracksPackages && sharedStock.packageStock ? (
                      product.stockConversion.isPackagePresentation ? (
                        <>
                          Cerrados: {sharedStock.packageStock.closedPackageQuantity.toFixed(2)}{" "}
                          {sharedStock.packageStock.packageUnit}
                          {conversionFactor > 1
                            ? ` · 1 ${sharedStock.packageStock.packageUnit} = ${conversionFactor} ${sharedStock.packageStock.baseUnit}`
                            : ""}
                        </>
                      ) : (
                        <>
                          Sueltos: {sharedStock.packageStock.looseUnitQuantity.toFixed(2)}{" "}
                          {sharedStock.packageStock.baseUnit}
                          {" | "}
                          Abrible: {(sharedStock.packageStock.autoOpenableUnitsTotal ?? 0).toFixed(2)}{" "}
                          {sharedStock.packageStock.baseUnit}
                          {conversionFactor > 1
                            ? ` · 1 ${sharedStock.packageStock.packageUnit} = ${conversionFactor} ${sharedStock.packageStock.baseUnit}`
                            : ""}
                        </>
                      )
                    ) : (
                      <>
                        Stock compartido: {sharedStock.saleQuantity.toFixed(2)} {sharedStock.saleUnit} /{" "}
                        {sharedStock.baseQuantity.toFixed(2)} {sharedStock.baseUnit}
                        {conversionFactor > 1
                          ? ` · 1 ${sharedStock.saleUnit} = ${conversionFactor} ${sharedStock.baseUnit}`
                          : ""}
                      </>
                    )}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
