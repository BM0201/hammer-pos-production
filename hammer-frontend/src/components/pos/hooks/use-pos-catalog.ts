"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mapPosErrorToSpanish, type ApiErrorPayload } from "@/lib/pos-ui";
import type { InventoryBalanceRow, ProductRow } from "../types";

export function usePosCatalog(branchId: string, onNotice: (msg: string) => void) {
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [showingTopSelling, setShowingTopSelling] = useState(true);
  const [stockByProductId, setStockByProductId] = useState<Record<string, number>>({});
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  const [catalogScrollTop, setCatalogScrollTop] = useState(0);

  // Stable refs — one instance per hook mount, never re-created on render.
  const searchRef = useRef("");
  const topProductsRef = useRef<ProductRow[]>([]);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchCacheRef = useRef<Map<string, ProductRow[]>>(new Map());
  const catalogViewportRef = useRef<HTMLDivElement | null>(null);
  // Mirror of stockByProductId state used by fetchStockForProduct so the
  // callback can remain stable (dep: branchId only) while still reading fresh values.
  const stockRef = useRef<Record<string, number>>({});

  useEffect(() => {
    stockRef.current = stockByProductId;
  }, [stockByProductId]);

  // Keep a live mirror of the current search term for async callbacks.
  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  const resolveError = useCallback(
    (params: { payload?: ApiErrorPayload; status?: number; fallback: string; thrownError?: unknown }) =>
      mapPosErrorToSpanish(params),
    [],
  );

  const seedSharedStock = useCallback((rows: ProductRow[]) => {
    const next: Record<string, number> = {};
    for (const row of rows) {
      if (typeof row.availableSaleStock === "number" && Number.isFinite(row.availableSaleStock)) {
        next[row.id] = row.availableSaleStock;
      } else if (row.sharedStock && Number.isFinite(row.sharedStock.saleQuantity)) {
        next[row.id] = row.sharedStock.saleQuantity;
      }
    }
    if (Object.keys(next).length > 0) {
      setStockByProductId((prev) => ({ ...prev, ...next }));
    }
  }, []);

  const applySearchRows = useCallback((rows: ProductRow[]) => {
    setProducts(rows);
    setActiveProductIndex(0);
    setCatalogScrollTop(0);
    if (catalogViewportRef.current) catalogViewportRef.current.scrollTop = 0;
  }, []);

  const loadTopSelling = useCallback(async () => {
    try {
      const params = new URLSearchParams({ isActive: "true", topSelling: "true", limit: "5", branchId });
      const response = await fetch(`/api/catalog/products?${params.toString()}`);
      const json = (await response.json()) as { data?: ProductRow[]; message?: string; reason?: string };

      if (!response.ok) {
        onNotice(resolveError({ payload: json, status: response.status, fallback: "No se pudieron cargar los productos más vendidos." }));
        return;
      }

      const rows = json.data ?? [];
      seedSharedStock(rows);
      topProductsRef.current = rows;
      // Only fill the visible list with top-sellers when the user is not
      // actively searching (read the live value via ref to avoid recreating
      // this callback on every keystroke).
      if (!searchRef.current.trim()) {
        setProducts(rows);
        setShowingTopSelling(true);
      }
    } catch (error) {
      console.error("[POS][loadTopSelling]", error);
      onNotice(resolveError({ fallback: "No se pudieron cargar los productos más vendidos.", thrownError: error }));
    }
  }, [branchId, resolveError, seedSharedStock, onNotice]);

  const loadProducts = useCallback(async (rawQuery: string) => {
    const query = rawQuery.trim();

    // Empty query → cancel any in-flight search and fall back to top-sellers.
    if (!query) {
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
        searchAbortRef.current = null;
      }
      setLoadingProducts(false);
      setShowingTopSelling(true);
      applySearchRows(topProductsRef.current);
      return;
    }

    setShowingTopSelling(false);
    const cacheKey = query.toLowerCase();

    // Cache hit → render instantly, no network round-trip or spinner.
    const cached = searchCacheRef.current.get(cacheKey);
    if (cached) {
      setLoadingProducts(false);
      applySearchRows(cached);
      return;
    }

    // Cancel the previous in-flight search so only the latest one wins.
    if (searchAbortRef.current) searchAbortRef.current.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setLoadingProducts(true);

    try {
      const params = new URLSearchParams({ q: query, isActive: "true", branchId, limit: "20" });
      const response = await fetch(`/api/catalog/products?${params.toString()}`, { signal: controller.signal });
      const json = (await response.json()) as { data?: ProductRow[]; message?: string; reason?: string };

      if (!response.ok) {
        onNotice(resolveError({ payload: json, status: response.status, fallback: "No se pudo cargar el catálogo." }));
        return;
      }

      const rows = json.data ?? [];
      seedSharedStock(rows);
      const q = cacheKey;
      const rank = (item: ProductRow) => {
        if (!q) return 99;
        if (item.name.toLowerCase().startsWith(q)) return 0;
        if (item.sku.toLowerCase().startsWith(q)) return 1;
        if ((item.barcode ?? "").toLowerCase().startsWith(q)) return 2;
        if (item.name.toLowerCase().includes(q)) return 3;
        if ((item.categoryName ?? "").toLowerCase().includes(q)) return 4;
        return 9;
      };

      rows.sort((a, b) => {
        const byRank = rank(a) - rank(b);
        if (byRank !== 0) return byRank;
        return a.name.localeCompare(b.name);
      });

      // Store in cache (cap size to keep memory bounded).
      if (searchCacheRef.current.size > 100) searchCacheRef.current.clear();
      searchCacheRef.current.set(cacheKey, rows);

      // Ignore results from a search that the user has already moved past.
      if (controller.signal.aborted || searchRef.current.trim().toLowerCase() !== cacheKey) {
        return;
      }

      applySearchRows(rows);
    } catch (error) {
      // A cancelled request is expected — never surface it as an error.
      if (controller.signal.aborted || (error as { name?: string })?.name === "AbortError") {
        return;
      }
      console.error("[POS][loadProducts]", error);
      onNotice(resolveError({ fallback: "No se pudo cargar el catálogo.", thrownError: error }));
    } finally {
      // Only the latest request clears the loading flag.
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
        setLoadingProducts(false);
      }
    }
  }, [branchId, resolveError, seedSharedStock, onNotice, applySearchRows]);

  // Load top-selling products once per branchId (replaces the combined effect in branch-pos).
  useEffect(() => {
    void loadTopSelling();
  }, [loadTopSelling]);

  // Debounced search. `loadProducts` is stable, so this only runs when the
  // search term changes. The debounce + in-flight cancellation keep it instant.
  useEffect(() => {
    const handler = setTimeout(() => { void loadProducts(search); }, 250);
    return () => clearTimeout(handler);
  }, [search, loadProducts]);

  // Abort any pending search request when the component unmounts.
  useEffect(() => {
    return () => {
      if (searchAbortRef.current) searchAbortRef.current.abort();
    };
  }, []);

  // fetchStockForProduct is stable (deps: branchId only) because it reads
  // stock from a ref mirror instead of the state directly.
  const fetchStockForProduct = useCallback(async (productId: string): Promise<number> => {
    const known = stockRef.current[productId];
    if (typeof known === "number") return known;

    const query = new URLSearchParams({ branchId, productId });
    const response = await fetch(`/api/inventory/balances?${query.toString()}`);
    const json = (await response.json()) as { data?: InventoryBalanceRow[]; message?: string; reason?: string };

    if (!response.ok) {
      throw new Error(mapPosErrorToSpanish({ payload: json, status: response.status, fallback: "No se pudo validar stock disponible." }));
    }

    const row = json.data?.[0];
    const qty = Number(row?.availableSaleStock ?? row?.sharedStock?.saleQuantity ?? row?.quantityOnHand ?? 0);
    const resolved = Number.isFinite(qty) ? qty : 0;
    setStockByProductId((prev) => ({ ...prev, [productId]: resolved }));
    return resolved;
  }, [branchId]);

  return {
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
    fetchStockForProduct,
    loadTopSelling,
  };
}
