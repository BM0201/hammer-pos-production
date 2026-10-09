"use client";

import { useState, useEffect, useMemo, useRef } from "react";

/**
 * Combobox de producto (búsqueda por SKU/nombre, sin librerías nuevas).
 * Extraído de purchase-orders/page.tsx (donde vivía sin exportar) para
 * reusarlo en product-barcodes-tab.tsx (Fase 2, prompt-codigos-y-duplicados.md
 * — "mover este código a otro producto") y en el asistente de unificación
 * (Fase 4, "elegir principal"). Filtra en memoria sobre una lista ya
 * cargada — igual que el original, no pide al servidor por tecla.
 */
export type ComboboxProduct = { id: string; sku: string; name: string; unit: string };

export function ProductCombobox({
  products,
  value,
  onSelect,
  placeholder = "Buscar por SKU o nombre...",
  excludeId,
}: {
  products: ComboboxProduct[];
  value: ComboboxProduct | null;
  onSelect: (product: ComboboxProduct) => void;
  placeholder?: string;
  /** Oculta un producto de los resultados (ej. el propio producto que se está editando). */
  excludeId?: string;
}) {
  const [query, setQuery] = useState(value ? `${value.sku} — ${value.name}` : "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(value ? `${value.sku} — ${value.name}` : "");
  }, [value?.id]);

  useEffect(() => () => { if (blurTimeout.current) clearTimeout(blurTimeout.current); }, []);

  const filtered = useMemo(() => {
    const pool = excludeId ? products.filter((p) => p.id !== excludeId) : products;
    const q = query.trim().toLowerCase();
    const base = !q ? pool : pool.filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
    return base.slice(0, 30);
  }, [products, query, excludeId]);

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
