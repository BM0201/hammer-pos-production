"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { Check, Info, Loader2, RefreshCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnitPicker } from "@/components/inventory/unit-picker";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { displayUnit, normalizePresentationUnit } from "@/lib/inventory/presentation-units";
import type { Category, ProductRow } from "./catalog-inventory-admin";

type ProductEditDraft = { name: string; categoryId: string; unit: string; applySuggestedSku: boolean };

/** Lo que el panel necesita del producto — la fila de la lista y el perfil (Product360) lo arman cada uno con lo que tienen. */
export type EditableProduct = Pick<ProductRow, "id" | "sku" | "name" | "unit" | "stockConversion"> & {
  category?: { id?: string; name: string } | null;
  /** Tiene stock o historial: cambiar el SKU pide confirmación. */
  hasHistory: boolean;
};

/**
 * Editar producto en un panel lateral — nombre, categoría, SKU y "se vende
 * por", cada uno con su etiqueta y su espacio. Se abre desde la lista de
 * Productos y desde el perfil del producto; la lógica (sugerencia de SKU,
 * guardar) vive acá para que ambos editen igual.
 */
export function ProductEditDrawer({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: EditableProduct;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ProductEditDraft>({ name: product.name, categoryId: product.category?.id ?? "", unit: product.stockConversion?.saleUnit ?? product.unit, applySuggestedSku: false });
  const [skuPreview, setSkuPreview] = useState("");
  const [generatingSku, setGeneratingSku] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  // Sugerencia de SKU al cambiar nombre o categoría.
  useEffect(() => {
    const nameChanged = draft.name.trim() !== product.name;
    const catChanged = draft.categoryId !== (product.category?.id ?? "");
    if (!draft.name.trim() || !draft.categoryId || (!nameChanged && !catChanged)) {
      setSkuPreview("");
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/catalog/products/sku-suggestion?name=${encodeURIComponent(draft.name.trim())}&categoryId=${encodeURIComponent(draft.categoryId)}&productId=${encodeURIComponent(product.id)}`);
        if (!response.ok) return;
        setSkuPreview(unwrapApiData(await response.json()).suggestedSku ?? "");
      } catch {
        setSkuPreview("");
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [draft.categoryId, draft.name, product.category?.id, product.id, product.name]);

  async function onRegenerateSku() {
    const name = draft.name.trim() || product.name;
    const catId = draft.categoryId || product.category?.id || "";
    if (!catId) {
      toast.error("Selecciona una categoría primero para regenerar el SKU.");
      return;
    }
    setGeneratingSku(true);
    try {
      const response = await fetch(`/api/catalog/products/sku-suggestion?name=${encodeURIComponent(name)}&categoryId=${encodeURIComponent(catId)}&productId=${encodeURIComponent(product.id)}`);
      if (!response.ok) throw new Error("No se pudo generar el SKU.");
      const result = unwrapApiData(await response.json());
      if (result.suggestedSku) {
        setSkuPreview(result.suggestedSku);
        setDraft((prev) => ({ ...prev, applySuggestedSku: true }));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al generar SKU.");
    } finally {
      setGeneratingSku(false);
    }
  }

  async function onSave() {
    if (!draft.name.trim()) { toast.error("El nombre es obligatorio."); return; }
    const body: Record<string, unknown> = {};
    if (draft.name.trim() !== product.name) body.name = draft.name.trim();
    if (draft.categoryId && draft.categoryId !== product.category?.id) body.categoryId = draft.categoryId;
    // En una fusión, el servidor cambia también su "se vende por" (el factor no se toca).
    if (draft.unit.trim() && normalizePresentationUnit(draft.unit) !== normalizePresentationUnit(product.stockConversion?.saleUnit ?? product.unit)) body.unit = draft.unit.trim();
    if (draft.applySuggestedSku && skuPreview) {
      if (product.hasHistory && !window.confirm("Este producto ya tiene historial o inventario. Cambiar el SKU no borra movimientos, pero puede afectar reportes externos. Deseas actualizar el SKU?")) return;
      body.skuUpdateMode = "USE_SUGGESTED";
      body.suggestedSku = skuPreview;
    } else if (draft.categoryId && draft.categoryId !== product.category?.id) {
      body.skuUpdateMode = "KEEP_CURRENT";
    }
    if (Object.keys(body).length === 0) { onClose(); return; }
    setSaving(true);
    try {
      const response = await apiFetch(`/api/catalog/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error?.message ?? json?.message ?? "No se pudo actualizar el producto.");
      }
      toast.success("Producto actualizado");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al guardar producto.");
    } finally {
      setSaving(false);
    }
  }

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
                onChange={(e) => setDraft({ ...draft, name: e.target.value, applySuggestedSku: false })}
              />
            </div>

            <div>
              <label htmlFor="edit-product-category" className="mb-1 block text-xs font-semibold text-[var(--color-text-secondary)]">Categoría</label>
              <select
                id="edit-product-category"
                className="hm-input h-10 w-full"
                value={draft.categoryId}
                onChange={(e) => setDraft({ ...draft, categoryId: e.target.value, applySuggestedSku: false })}
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
                  onClick={() => void onRegenerateSku()}
                  disabled={generatingSku}
                  className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-master-700)] hover:bg-[var(--color-master-50)] disabled:opacity-50"
                >
                  {generatingSku ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                  Regenerar SKU
                </button>
              </div>
              {skuPreview && (
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                  <input type="checkbox" checked={draft.applySuggestedSku} onChange={(e) => setDraft({ ...draft, applySuggestedSku: e.target.checked })} />
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
            <UnitPicker inline value={draft.unit} onChange={(unit) => setDraft({ ...draft, unit })} label="Se vende por" />
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="success" onClick={() => void onSave()} loading={saving} icon={<Check className="h-4 w-4" />}>Guardar cambios</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
