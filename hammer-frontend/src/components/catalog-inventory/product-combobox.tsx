"use client";

import { useState, useEffect, useRef } from "react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

export type ComboboxProduct = { id: string; sku: string; name: string; unit: string };

/**
 * Busca productos en el servidor mientras se escribe. Cargar la lista completa
 * y filtrar en el navegador topa en 1000 (listProducts) y deja productos sin
 * poder elegirse. Usa la misma búsqueda por palabras, SKU y códigos del resto.
 */
export function useProductSearch(term: string, options: { branchId?: string; excludeTimber?: boolean; limit?: number } = {}) {
  const { branchId, excludeTimber, limit = 20 } = options;
  const [results, setResults] = useState<ComboboxProduct[]>([]);
  useEffect(() => {
    // Se vacía antes de buscar: Enter o un clic no deben elegir un resultado del texto anterior.
    setResults([]);
    const q = term.trim();
    if (!q) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ isActive: "true", limit: String(limit), q });
      if (branchId) params.set("branchId", branchId);
      if (excludeTimber) params.set("excludeTimber", "true");
      apiFetch(`/api/catalog/products?${params}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((raw) => {
          const data = unwrapApiData(raw);
          setResults(Array.isArray(data) ? data : []);
        })
        .catch(() => {});
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [term, branchId, excludeTimber, limit]);
  return results;
}

/** Combobox de producto (búsqueda por SKU/nombre/código, sin librerías nuevas). */

export function ProductCombobox({
  value,
  onSelect,
  placeholder = "Buscar por SKU o nombre...",
  excludeId,
  branchId,
}: {
  value: ComboboxProduct | null;
  onSelect: (product: ComboboxProduct) => void;
  placeholder?: string;
  /** Oculta un producto de los resultados (ej. el propio producto que se está editando). */
  excludeId?: string;
  /** Búsqueda en servidor: solo productos visibles en esta sucursal. */
  branchId?: string;
}) {
  const [query, setQuery] = useState(value ? `${value.sku} — ${value.name}` : "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // El texto del producto ya elegido no es una búsqueda.
  const results = useProductSearch(value && query === `${value.sku} — ${value.name}` ? "" : query, { branchId });

  useEffect(() => {
    setQuery(value ? `${value.sku} — ${value.name}` : "");
  }, [value?.id]);

  useEffect(() => () => { if (blurTimeout.current) clearTimeout(blurTimeout.current); }, []);

  const filtered = excludeId ? results.filter((p) => p.id !== excludeId) : results;

  function selectProduct(p: ComboboxProduct) {
    onSelect(p);
    setQuery(`${p.sku} — ${p.name}`);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimeout.current = setTimeout(() => setOpen(false), 150); }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlight]) selectProduct(filtered[highlight]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        className="hm-input w-full rounded-lg text-sm"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-lg">
          {filtered.map((p, i) => (
            <button
              type="button"
              key={p.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectProduct(p)}
              className={`flex w-full items-center gap-2 border-b border-[var(--color-border)] px-2.5 py-2 text-left text-[0.78rem] last:border-b-0 ${
                i === highlight ? "bg-[var(--color-master-50)]" : "hover:bg-[var(--color-surface-alt)]"
              }`}
            >
              <span className="min-w-[4.5rem] font-mono text-[0.68rem] text-[var(--color-text-muted)]">{p.sku}</span>
              <span className="flex-1 truncate text-[var(--color-text)]">{p.name}</span>
              <span className="text-[0.68rem] text-[var(--color-text-soft)]">{p.unit}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
