"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Factory } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

/**
 * Producción v2 Fase 6 — "Receta" (mockup vista 1). La receta ES el costo
 * estándar del producto: insumos con unidad validada contra catálogo, costo
 * calculado solo con el WAC vigente de cada material, y rentabilidad al
 * precio de venta actual — sin fabricar un solo lote.
 */

type Recipe = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  expectedQuantity: number;
  expectedUnit: string;
  recipeType: string;
  recipeFamily: string;
  targetMarginPct: number | null;
  yieldPercent: number | null;
  wastePercent: number | null;
  laborEnabled: boolean;
  laborCostPerBatch: number | null;
  overheadMode: string;
  processingCostPerBatch: number | null;
  finishedProduct: { id: string; sku: string; name: string; unit: string };
  inputs: Array<{ id: string; inputProductId: string; quantity: number; unit: string; inputProduct: { id: string; sku: string; name: string; unit: string } }>;
};

type Branch = { id: string; code: string; name: string };

type CostPreview = {
  inputs: Array<{ productId: string; productName: string; productSku: string; neededQuantity: number; unit: string; currentWac: number; estimatedCost: number; hasEnoughStock: boolean }>;
  totalMaterialsCost: number;
  laborCost: number;
  overheadCost: number;
  estimatedUnitCost: number;
};

const money = (v: number | null | undefined) => v == null ? "—" : `C$ ${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number | null | undefined) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;

const OVERHEAD_MODE_LABEL: Record<string, string> = { NONE: "Desactivado", FIXED: "Monto fijo", PCT_MAT: "% de materiales" };

export default function RecipeDetailPage() {
  const params = useParams<{ id: string }>();
  const recipeId = params.id;

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [preview, setPreview] = useState<CostPreview | null>(null);
  const [branchPrice, setBranchPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [recipeRes, branchesRes] = await Promise.all([
          apiFetch(`/api/master/production/recipes/${recipeId}`),
          apiFetch("/api/branches"),
        ]);
        if (!recipeRes.ok) { showToast("error", "No se pudo cargar la receta."); return; }
        const recipeData = unwrapApiData(await recipeRes.json()) as Recipe;
        const branchData = branchesRes.ok ? unwrapApiData(await branchesRes.json()) as Branch[] : [];
        if (!cancelled) {
          setRecipe(recipeData);
          const list = Array.isArray(branchData) ? branchData : [];
          setBranches(list);
          setBranchId((current) => current || list[0]?.id || "");
        }
      } catch {
        if (!cancelled) showToast("error", "Error de red al cargar la receta.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [recipeId]);

  const loadPreview = useCallback(async () => {
    if (!recipe || !branchId) return;
    setPreviewLoading(true);
    try {
      const [calcRes, productsRes] = await Promise.all([
        apiFetch("/api/master/production/calculate", {
          method: "POST",
          body: JSON.stringify({ recipeId: recipe.id, branchId, plannedQuantity: recipe.expectedQuantity }),
        }),
        apiFetch(`/api/catalog/products?q=${encodeURIComponent(recipe.finishedProduct.sku)}&branchId=${branchId}`),
      ]);
      if (calcRes.ok) setPreview(unwrapApiData(await calcRes.json()) as CostPreview);
      if (productsRes.ok) {
        const products = unwrapApiData(await productsRes.json()) as Array<{ id: string; standardSalePrice: number | null; branchProductSettings?: Array<{ branchPrice: number | null }> }>;
        const match = products.find((p) => p.id === recipe.finishedProduct.id);
        setBranchPrice(match?.branchProductSettings?.[0]?.branchPrice ?? match?.standardSalePrice ?? null);
      }
    } catch {
      showToast("error", "No se pudo calcular el costo estándar.");
    } finally {
      setPreviewLoading(false);
    }
  }, [recipe, branchId]);

  useEffect(() => { void loadPreview(); }, [loadPreview]);

  const totalStandardCost = (preview?.totalMaterialsCost ?? 0) + (preview?.laborCost ?? 0) + (preview?.overheadCost ?? 0);
  const marginAtStandardCost = useMemo(() => {
    if (!branchPrice || branchPrice <= 0 || !preview) return null;
    return (branchPrice - preview.estimatedUnitCost) / branchPrice;
  }, [branchPrice, preview]);
  const isProfitable = marginAtStandardCost != null && recipe?.targetMarginPct != null
    ? marginAtStandardCost >= recipe.targetMarginPct
    : marginAtStandardCost != null && marginAtStandardCost > 0;

  if (loading) return <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">Cargando receta…</div>;
  if (!recipe) return <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">Receta no encontrada.</div>;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="hm-icon-wrap-md hm-icon-wrap"><Factory className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-[var(--color-text)]">{recipe.name}</h1>
          <p className="text-[12.5px] text-[var(--color-text-muted)]">
            <span className="font-mono">{recipe.code}</span> · {recipe.recipeType.toLowerCase()} · familia {recipe.recipeFamily} · rinde {recipe.expectedQuantity.toLocaleString("es-NI")} {recipe.expectedUnit}
          </p>
        </div>
        <Badge variant={recipe.isActive ? "success" : "neutral"}>{recipe.isActive ? "Activa" : "Inactiva"}</Badge>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="hm-input w-44">
          {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
        </select>
        <Link href={`/app/master/production/batches/new?recipeId=${recipe.id}`}>
          <Button variant="secondary" size="sm">Planificar lote</Button>
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card noPadding>
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2.5">
            <b className="text-[12.5px]">Insumos por lote de {recipe.expectedQuantity.toLocaleString("es-NI")}</b>
          </div>
          <table className="hm-sheet-table">
            <thead>
              <tr><th>Insumo</th><th className="r">Cantidad</th><th>Unidad</th><th className="r">WAC actual</th><th className="r">Costo</th></tr>
            </thead>
            <tbody>
              {recipe.inputs.map((input) => {
                const line = preview?.inputs.find((p) => p.productId === input.inputProductId);
                return (
                  <tr key={input.id}>
                    <td><b>{input.inputProduct.name}</b> <span className="font-mono text-[10.5px] text-[var(--color-text-muted)]">{input.inputProduct.sku}</span></td>
                    <td className="hm-num">{input.quantity.toLocaleString("es-NI")}</td>
                    <td><Badge variant="neutral">{input.unit}</Badge></td>
                    <td className="hm-num">{previewLoading ? "…" : line ? money(line.currentWac) : "—"}</td>
                    <td className="hm-num" style={{ fontWeight: 600 }}>{previewLoading ? "…" : line ? money(line.estimatedCost) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}>Materiales estándar</td><td className="hm-num">{money(preview?.totalMaterialsCost)}</td></tr>
            </tfoot>
          </table>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="hm-section-rule">Costo estándar del lote</div>
            <dl className="space-y-1.5 text-[12.5px]">
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Materiales</dt><dd className="hm-num font-semibold">{money(preview?.totalMaterialsCost)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Mano de obra {!recipe.laborEnabled && <Badge variant="neutral" className="ml-1">en planilla</Badge>}</dt><dd className="hm-num font-semibold">{money(preview?.laborCost ?? 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Overhead {recipe.overheadMode === "NONE" && <Badge variant="neutral" className="ml-1">a mano</Badge>}</dt><dd className="hm-num font-semibold">{money(preview?.overheadCost ?? 0)}</dd></div>
              <div className="flex justify-between border-t border-[var(--color-border)] pt-1.5"><dt className="text-[var(--color-text-muted)]">Total estándar</dt><dd className="hm-num font-bold">{money(totalStandardCost)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Costo unitario estándar</dt><dd className="hm-num font-bold">{money(preview?.estimatedUnitCost)}</dd></div>
            </dl>
          </Card>

          <Card>
            <div className="hm-section-rule">Rentabilidad al precio actual</div>
            <dl className="space-y-1.5 text-[12.5px]">
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Precio de venta</dt><dd className="hm-num font-semibold">{money(branchPrice)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Margen al costo estándar</dt><dd className="hm-num font-semibold" style={{ color: marginAtStandardCost != null && marginAtStandardCost > 0 ? "var(--color-success-700)" : "var(--color-danger-700)" }}>{pct(marginAtStandardCost)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Margen objetivo receta</dt><dd className="hm-num font-semibold">{pct(recipe.targetMarginPct)}</dd></div>
            </dl>
            {marginAtStandardCost != null && (
              <div className="mt-2">
                <Badge variant={isProfitable ? "success" : "danger"}>{isProfitable ? "✓ Rentable — cumple el objetivo" : "⚠ Por debajo del margen objetivo"}</Badge>
              </div>
            )}
          </Card>

          <Card>
            <div className="hm-section-rule">Parámetros</div>
            <dl className="space-y-1.5 text-[12.5px]">
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Rendimiento esperado</dt><dd className="font-semibold">{pct(recipe.yieldPercent)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Merma esperada</dt><dd className="font-semibold">{pct(recipe.wastePercent)} · se rompe y reusa</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Mano de obra</dt><dd className="font-semibold">{recipe.laborEnabled ? money(recipe.laborCostPerBatch) : "Desactivada (0)"}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Overhead</dt><dd className="font-semibold">{OVERHEAD_MODE_LABEL[recipe.overheadMode] ?? recipe.overheadMode}</dd></div>
            </dl>
          </Card>
        </div>
      </div>
    </section>
  );
}
