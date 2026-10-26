"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Check, Info, Loader2, RefreshCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnitPicker } from "@/components/inventory/unit-picker";
import { displayUnit, normalizePresentationUnit } from "@/lib/inventory/presentation-units";
import type { Category, ProductRow } from "./catalog-inventory-admin";

export type ProductEditDraft = { name: string; categoryId: string; sku: string; unit: string; applySuggestedSku: boolean };

/**
 * Editar producto en un panel lateral — antes la edición era dentro de la
 * fila de una tabla de 10 columnas: cada campo apretado en su celda, y la
 * unidad era un datalist que solo mostraba la que ya estaba escrita. Acá
 * cada campo tiene su etiqueta y su espacio, y la unidad se elige de la
 * grilla completa. La lógica (sugerencia de SKU, guardar) sigue en
 * CatalogInventoryAdmin: este panel solo la presenta.
 */
export function ProductEditDrawer({
  product,
  categories,
  draft,
  onDraftChange,
  skuPreview,
  generatingSku,
  onRegenerateSku,
  saving,
  onSave,
  onClose,
}: {
  product: ProductRow;
  categories: Category[];
  draft: ProductEditDraft;
  onDraftChange: (draft: ProductEditDraft) => void;
  skuPreview: string;
  generatingSku: boolean;
  onRegenerateSku: () => void;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const conversion = product.stockConversion ?? null;
  const currentUnit = conversion?.saleUnit ?? product.unit;
  const unitChanged = Boolean(draft.unit.trim()) && normalizePresentationUnit(draft.unit) !== normalizePresentationUnit(currentUnit);
  const categoryChanged = draft.categoryId !== (product.category?.id ?? "");
  const newCategoryName = categories.find((c) => c.id === draft.categoryId)?.name ?? "Sin categoría";

  // Portal: la página vive dentro de un contenedor con transform (animación
  // de entrada), y ahí `fixed` se ubica contra ese contenedor, no la ventana
  // — el panel quedaba corrido hacia arriba, con el título fuera de vista.
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => { if (!saving) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-edit-title"
        className="flex h-full w-full max-w-lg flex-col bg-[var(--color-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <h2 id="product-edit-title" className="text-sm font-bold text-[var(--color-text)]">Editar producto</h2>
            <p className="truncate text-xs text-[var(--color-text-muted)]"><span className="font-mono">{product.sku}</span> · {product.name}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-soft)] hover:bg-[var(--color-surface-alt)]" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <section className="space-y-4">
            <div>
              <label htmlFor="edit-product-name" className="mb-1 block text-xs font-semibold text-[var(--color-text-secondary)]">Nombre</label>
              <input
                id="edit-product-name"
                className="hm-input h-10 w-full"
                value={draft.name}
                onChange={(e) => onDraftChange({ ...draft, name: e.target.value, applySuggestedSku: false })}
              />
            </div>

            <div>
              <label htmlFor="edit-product-category" className="mb-1 block text-xs font-semibold text-[var(--color-text-secondary)]">Categoría</label>
              <select
                id="edit-product-category"
                className="hm-input h-10 w-full"
                value={draft.categoryId}
                onChange={(e) => onDraftChange({ ...draft, categoryId: e.target.value, applySuggestedSku: false })}
              >
                <option value="">Sin categoría</option>
                {categories.filter((c) => c.isActive || c.id === product.category?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {categoryChanged && (
                <p className="mt-1.5 text-xs text-[var(--color-warning-700)]">
                  {product.category?.name ?? "Sin categoría"} → {newCategoryName}. El SKU actual puede no corresponder a la categoría nueva.
                </p>
              )}
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold text-[var(--color-text-secondary)]">SKU</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-mono text-sm ${draft.applySuggestedSku && skuPreview ? "text-[var(--color-text-muted)] line-through" : "font-semibold text-[var(--color-text)]"}`}>{product.sku}</span>
                {draft.applySuggestedSku && skuPreview && (
                  <span className="font-mono text-sm font-semibold text-[var(--color-success-600)]">→ {skuPreview}</span>
                )}
                <button
                  type="button"
                  onClick={onRegenerateSku}
                  disabled={generatingSku}
                  className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-master-700)] hover:bg-[var(--color-master-50)] disabled:opacity-50"
                >
                  {generatingSku ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                  Regenerar SKU
                </button>
              </div>
              {skuPreview && (
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                  <input type="checkbox" checked={draft.applySuggestedSku} onChange={(e) => onDraftChange({ ...draft, applySuggestedSku: e.target.checked })} />
                  Aplicar el SKU nuevo ({skuPreview})
                </label>
              )}
            </div>
          </section>

          <section className="space-y-2 border-t border-[var(--color-border)] pt-5">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold text-[var(--color-text-secondary)]">Se vende por</h3>
              <span className="text-xs text-[var(--color-text-muted)]">
                {unitChanged ? <>{displayUnit(normalizePresentationUnit(currentUnit))} → <b className="text-[var(--color-text)]">{displayUnit(normalizePresentationUnit(draft.unit))}</b></> : <>Actual: {displayUnit(normalizePresentationUnit(currentUnit))}</>}
              </span>
            </div>
            {conversion && (
              <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-info-50)] px-3 py-2 text-xs text-[var(--color-info-700)]">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Está en la fusión <b>{conversion.stockGroupName}</b>
                  {conversion.isCanonical
                    ? " como unidad base."
                    : ` (1 ${displayUnit(normalizePresentationUnit(currentUnit))} = ${Number(conversion.conversionFactor)} ${displayUnit(conversion.baseUnit)}).`}
                  {" "}Cambiar la unidad acá también la cambia en la fusión; el factor queda igual.
                </span>
              </p>
            )}
            <UnitPicker inline value={draft.unit} onChange={(unit) => onDraftChange({ ...draft, unit })} label="Se vende por" />
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="success" onClick={onSave} loading={saving} icon={<Check className="h-4 w-4" />}>Guardar cambios</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
