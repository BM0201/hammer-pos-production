"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Search, PackageSearch } from "lucide-react";
import { InventoryTopbar } from "@/components/inventory/inventory-topbar";
import { useInventoryScope } from "@/hooks/use-inventory-scope";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { qty } from "@/lib/format";

/**
 * prompt-inventario-unificado.md Commit 1 — "Existencias → Consultar
 * (escaneo)": antes esa subsección no apuntaba a nada real. Reusa los
 * endpoints que ya existen (ninguno nuevo): /api/master/inventory/products
 * para resolver el código escaneado (ya empareja por código exacto) y
 * /api/master/inventory/stock para la existencia por sucursal de ESE
 * producto — la misma matriz que ya alimenta Existencias/Por sucursal,
 * acá acotada a un solo producto.
 */

type ProductMatch = { id: string; sku: string; name: string; unit: string; barcode: string | null };
type StockRow = { productId: string; sku: string; name: string; branches: Array<{ branchId: string; branchCode: string; quantityOnHand: number; stockStatus: "NEGATIVE" | "ZERO" | "LOW" | "OK" }> };

const STATUS_LABEL: Record<StockRow["branches"][number]["stockStatus"], string> = {
  NEGATIVE: "Negativo", ZERO: "Sin stock", LOW: "Por agotarse", OK: "OK",
};
const STATUS_CLASS: Record<StockRow["branches"][number]["stockStatus"], string> = {
  NEGATIVE: "text-[var(--color-danger-700)]", ZERO: "text-[var(--color-text-muted)]", LOW: "text-[var(--color-warning-700)]", OK: "text-[var(--color-text)]",
};

export default function InventoryLookupPage() {
  return (
    <div className="flex min-h-full flex-col">
      <Suspense fallback={null}>
        <InventoryTopbar />
      </Suspense>
      <Suspense fallback={null}>
        <InventoryLookupContent />
      </Suspense>
    </div>
  );
}

function InventoryLookupContent() {
  const scope = useInventoryScope();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [product, setProduct] = useState<ProductMatch | null>(null);
  const [stock, setStock] = useState<StockRow | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const referenceBranchId = (scope.mode === "branch" ? scope.branchId : scope.branches[0]?.id) ?? "";

  async function lookup(code: string) {
    const term = code.trim();
    if (!term || !referenceBranchId) return;
    setLoading(true);
    setNotFound(false);
    setProduct(null);
    setStock(null);
    try {
      const params = new URLSearchParams({ q: term, limit: "5", branchId: referenceBranchId });
      const res = await apiFetch(`/api/master/inventory/products?${params}`);
      const raw = await res.json().catch(() => null);
      const rows = raw ? ((unwrapApiData(raw) as { rows: ProductMatch[] }).rows ?? []) : [];
      const normalized = term.toLowerCase();
      const exact = rows.find((r) => r.sku.toLowerCase() === normalized || (r.barcode && r.barcode.toLowerCase() === normalized)) ?? rows[0];
      if (!exact) { setNotFound(true); return; }
      setProduct(exact);

      const branchIds = scope.branches.map((b) => b.id).join(",");
      const stockRes = await apiFetch(`/api/master/inventory/stock?branchIds=${branchIds}&q=${encodeURIComponent(exact.sku)}`);
      const stockRaw = await stockRes.json().catch(() => null);
      const stockRows = stockRaw ? (unwrapApiData(stockRaw) as StockRow[]) : [];
      setStock(stockRows.find((r) => r.productId === exact.id) ?? null);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 p-5 lg:p-8">
      <div>
        <h1 className="text-sm font-semibold text-[var(--color-text)]">Consultar existencias</h1>
        <p className="text-xs text-[var(--color-text-muted)]">Escaneá o escribí un código — vas a ver cuánto hay en cada sucursal, sin crear ningún movimiento.</p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookup(query); } }}
          placeholder="Código de barras, SKU o nombre…"
          className="hm-input h-12 w-full pl-10 text-base"
        />
      </div>

      {loading ? <p className="text-sm text-[var(--color-text-muted)]">Buscando…</p> : null}

      {notFound && !loading ? (
        <div className="rounded-xl border border-[var(--color-border-strong)] p-4 text-sm text-[var(--color-text-muted)]">
          No encontramos ningún producto con ese código — probá buscando por nombre, o revisá si el código ya está registrado en{" "}
          <Link href={"/app/master/catalog/barcodes" as Route} className="font-semibold text-[var(--color-info-600)] hover:underline">Códigos de barra</Link>.
        </div>
      ) : null}

      {product ? (
        <div className="rounded-xl border border-[var(--color-border-strong)] p-4">
          <div className="flex items-start gap-3">
            <PackageSearch className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-master-600)]" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--color-text)]">{product.name}</p>
              <p className="font-mono text-xs text-[var(--color-text-muted)]">{product.sku}{product.barcode ? ` · ${product.barcode}` : ""} · {product.unit}</p>
            </div>
            <Link href={`/app/master/catalog-inventory/products/${product.id}` as Route} className="ml-auto shrink-0 text-xs font-semibold text-[var(--color-info-600)] hover:underline">Ver ficha →</Link>
          </div>

          <div className="mt-4 divide-y divide-[var(--color-border)]">
            {!stock || stock.branches.length === 0 ? (
              <p className="py-2 text-sm text-[var(--color-text-muted)]">Sin existencias registradas en ninguna sucursal.</p>
            ) : (
              stock.branches.map((b) => (
                <div key={b.branchId} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium text-[var(--color-text)]">{b.branchCode}</span>
                  <span className={`font-semibold ${STATUS_CLASS[b.stockStatus]}`}>{qty(b.quantityOnHand)} <span className="ml-1 text-xs font-normal">{STATUS_LABEL[b.stockStatus]}</span></span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
