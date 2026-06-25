"use client";

import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import { Search, ScanLine } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ProductRow } from "../types";

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
  onTabToTicket: () => void;
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
  setCatalogScrollTop,
  catalogViewportRef,
  searchInputRef,
  isBusy,
  onAddProduct,
  onTabToTicket,
  onClearSearch,
}: PosCatalogPanelProps) {
  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveProductIndex((prev) => Math.min(prev + 1, products.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveProductIndex((prev) => Math.max(prev - 1, 0));
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
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Catálogo</h2>
        {showingTopSelling && !search.trim() ? (
          <span className="rounded-full bg-[var(--color-success-100)] px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--color-success-700)]">
            Top vendidos
          </span>
        ) : null}
      </div>

      {/* Search bar */}
      <div className="flex flex-shrink-0 gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-soft)]" />
          <input
            ref={searchInputRef}
            className="w-full rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] py-3 pl-9 pr-3 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-soft)] transition-colors focus:border-[var(--color-pay)] focus:ring-2 focus:ring-[var(--color-pay)]/10"
            placeholder="Buscar o escanear · Enter agrega"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            disabled={isBusy}
            data-testid="pos-search-input"
          />
        </div>
        <button
          className="flex w-12 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-muted)]"
          tabIndex={-1}
          aria-label="Escanear código"
        >
          <ScanLine className="h-5 w-5" />
        </button>
      </div>

      {/* Product grid */}
      <div
        ref={catalogViewportRef}
        className="min-h-0 flex-1 overflow-y-auto p-3"
        onScroll={(e) => setCatalogScrollTop(e.currentTarget.scrollTop)}
        data-testid="pos-catalog-viewport"
      >
        {loadingProducts ? (
          <p className="p-2 text-xs text-[var(--color-text-soft)]">Cargando catálogo...</p>
        ) : null}
        {!loadingProducts && products.length === 0 ? (
          <p className="p-2 text-xs text-[var(--color-text-soft)]">
            No hay productos para esta búsqueda.
          </p>
        ) : null}

        <div
          className="grid gap-2.5"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))" }}
        >
          {products.map((product, index) => {
            const selected = index === activeProductIndex;
            const displayPrice = product.effectivePrice ?? product.standardSalePrice;
            const availableStock =
              product.availableSaleStock ??
              product.sharedStock?.saleQuantity ??
              product.availableStock ??
              stockByProductId[product.id] ??
              0;
            const hasNoStock = availableStock <= 0;
            const isLowStock = !hasNoStock && availableStock < 5;

            return (
              <button
                key={product.id}
                className={[
                  "flex min-h-[92px] flex-col gap-1 rounded-[14px] border p-3 text-left",
                  "transition-[border-color,background-color,transform] active:scale-[0.97]",
                  selected
                    ? "border-[var(--color-pay)] bg-[color-mix(in_srgb,var(--color-pay)_8%,transparent)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]",
                  hasNoStock ? "opacity-60" : "",
                ].join(" ")}
                onClick={() => {
                  setActiveProductIndex(index);
                  onAddProduct(product);
                }}
                disabled={isBusy || hasNoStock}
                data-testid={`pos-product-${product.id}`}
              >
                <div className="line-clamp-2 text-[13px] font-medium leading-snug text-[var(--color-text)]">
                  {product.name}
                </div>
                <div className="mt-auto text-[17px] font-semibold tabular-nums text-[var(--color-text)]">
                  C$ {Number(displayPrice).toFixed(2)}
                </div>
                <div
                  className={[
                    "text-[11px]",
                    isLowStock
                      ? "text-[var(--color-warning-700)]"
                      : hasNoStock
                        ? "text-[var(--color-danger-600)]"
                        : "text-[var(--color-text-soft)]",
                  ].join(" ")}
                >
                  {hasNoStock
                    ? "Sin stock"
                    : `Stock ${availableStock % 1 === 0 ? availableStock : availableStock.toFixed(2)}`}
                  {product.saleUnit ? ` ${product.saleUnit}` : ""}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
