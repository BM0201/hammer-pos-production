"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Factory, PackageCheck, Play, Save, Search } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

type Recipe = {
  id: string;
  name: string;
  code: string;
  expectedQuantity: number;
  expectedUnit: string;
  targetMarginPct: number | null;
  finishedProduct?: { id: string; sku: string; name: string; unit?: string };
  inputs: Array<{
    inputProductId: string;
    inputProduct: { id: string; sku: string; name: string; unit?: string };
    quantity: number;
    unit: string;
  }>;
};

type Branch = { id: string; code: string; name: string };
type CostPreview = {
  inputs: Array<{
    productId: string;
    productName: string;
    productSku: string;
    neededQuantity: number;
    unit: string;
    currentWac: number;
    currentStock: number;
    estimatedCost: number;
    hasEnoughStock: boolean;
    stockConversion?: { baseUnit: string; saleUnit: string; conversionFactor: string } | null;
  }>;
  totalMaterialsCost: number;
  estimatedUnitCost: number;
  allInputsAvailable: boolean;
  suggestedPrice: number | null;
};

const money = (value: number | null | undefined) => value == null ? "-" : `C$${value.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (value: number) => value.toLocaleString("es-NI", { maximumFractionDigits: 4 });

export default function NewBatchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRecipeId = searchParams.get("recipeId") ?? "";

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [recipeQuery, setRecipeQuery] = useState("");
  const [recipeId, setRecipeId] = useState(initialRecipeId);
  const [branchId, setBranchId] = useState("");
  const [plannedQuantity, setPlannedQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<CostPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [recipesRes, branchesRes] = await Promise.all([
          apiFetch("/api/master/production/recipes?isActive=true"),
          apiFetch("/api/branches"),
        ]);
        if (!recipesRes.ok) throw new Error("No se pudieron cargar recetas.");
        const recipeData = unwrapApiData(await recipesRes.json()) as Recipe[];
        const branchData = branchesRes.ok ? unwrapApiData(await branchesRes.json()) as Branch[] : [];
        if (!cancelled) {
          setRecipes(recipeData);
          setBranches(Array.isArray(branchData) ? branchData : []);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectedRecipe = recipes.find((recipe) => recipe.id === recipeId);
  const plannedQty = Number(plannedQuantity || 0);
  const multiplier = selectedRecipe && plannedQty > 0 ? plannedQty / selectedRecipe.expectedQuantity : 0;

  const filteredRecipes = useMemo(() => {
    const qText = recipeQuery.trim().toLowerCase();
    return recipes.filter((recipe) => !qText || `${recipe.code} ${recipe.name} ${recipe.finishedProduct?.name ?? ""}`.toLowerCase().includes(qText)).slice(0, 12);
  }, [recipes, recipeQuery]);

  useEffect(() => {
    let cancelled = false;
    if (!recipeId || !branchId || plannedQty <= 0) {
      setPreview(null);
      return;
    }
    (async () => {
      setPreviewLoading(true);
      try {
        const res = await apiFetch("/api/master/production/calculate", {
          method: "POST",
          body: JSON.stringify({ recipeId, branchId, plannedQuantity: plannedQty }),
        });
        if (!res.ok) throw new Error("No se pudo calcular costo esperado.");
        const data = unwrapApiData(await res.json()) as CostPreview;
        if (!cancelled) setPreview(data);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [recipeId, branchId, plannedQty]);

  const warnings = [
    ...(preview && !preview.allInputsAvailable ? ["Hay insumos sin stock suficiente para completar el lote."] : []),
    ...(preview?.inputs.filter((input) => input.currentWac <= 0).map((input) => `${input.productName} no tiene costo efectivo en la sucursal.`) ?? []),
    ...(selectedRecipe?.finishedProduct ? [] : ["La receta no muestra producto terminado en la respuesta."]),
  ];

  const createBatch = async (startImmediately: boolean) => {
    setError(null);
    if (!recipeId) return setError("Selecciona una receta.");
    if (!branchId) return setError("Selecciona sucursal o bodega.");
    if (plannedQty <= 0) return setError("La cantidad a producir debe ser mayor a 0.");
    setSaving(true);
    try {
      const res = await apiFetch("/api/master/production/batches", {
        method: "POST",
        body: JSON.stringify({ recipeId, branchId, plannedQuantity: plannedQty, notes: notes.trim() || null }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error?.message ?? errData?.message ?? "Error al crear lote");
      }
      const created = unwrapApiData(await res.json()) as { id: string };
      if (startImmediately) {
        await apiFetch(`/api/master/production/batches/${created.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "IN_PROGRESS" }),
        });
      }
      router.push(`/app/master/production/batches/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Factory className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">Nuevo lote de produccion</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Selecciona receta, sucursal, cantidad y valida insumos antes de crear.</p>
          </div>
        </div>
        <Link href="/app/master/production/batches" className="text-sm font-medium text-[var(--color-master-600)] hover:underline">Volver a lotes</Link>
      </div>

      {error && <div className="rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-3 text-sm text-[var(--color-danger-700)]">{error}</div>}
      {loading ? <p className="text-sm text-[var(--color-text-muted)]">Cargando datos...</p> : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[var(--color-text)]">1. Seleccionar receta</h2>
            <div className="relative mt-4">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--color-text-muted)]" />
              <input value={recipeQuery} onChange={(event) => setRecipeQuery(event.target.value)} placeholder="Buscar por codigo, receta o producto..." className="w-full rounded-lg border border-[var(--color-border)] py-2 pl-9 pr-3 text-sm" />
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {filteredRecipes.map((recipe) => (
                <button key={recipe.id} type="button" onClick={() => setRecipeId(recipe.id)} className={`rounded-lg border p-3 text-left hover:bg-[var(--color-surface-alt)] ${recipeId === recipe.id ? "border-emerald-500 bg-emerald-50" : "border-[var(--color-border)]"}`}>
                  <p className="font-semibold text-[var(--color-text)]">{recipe.name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{recipe.code} · {recipe.expectedQuantity} {recipe.expectedUnit}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{recipe.finishedProduct?.name ?? "Producto terminado no visible"}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[var(--color-text)]">2. Produccion</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Sucursal / bodega</label>
                <select value={branchId} onChange={(event) => setBranchId(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
                  <option value="">Seleccionar...</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--color-text-muted)]">Cantidad a producir</label>
                <input type="number" min="0.01" step="any" value={plannedQuantity} onChange={(event) => setPlannedQuantity(event.target.value)} placeholder={selectedRecipe ? String(selectedRecipe.expectedQuantity) : "1000"} className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
            </div>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Notas del lote..." className="mt-4 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
          </section>

          {selectedRecipe && (
            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
              <h2 className="text-base font-semibold text-[var(--color-text)]">Detalle de receta e insumos</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg bg-[var(--color-surface-alt)] p-3"><p className="text-xs text-[var(--color-text-muted)]">Producto terminado</p><p className="font-semibold text-[var(--color-text)]">{selectedRecipe.finishedProduct?.name ?? "-"}</p></div>
                <div className="rounded-lg bg-[var(--color-surface-alt)] p-3"><p className="text-xs text-[var(--color-text-muted)]">Receta base</p><p className="font-semibold text-[var(--color-text)]">{qty(selectedRecipe.expectedQuantity)} {selectedRecipe.expectedUnit}</p></div>
                <div className="rounded-lg bg-[var(--color-surface-alt)] p-3"><p className="text-xs text-[var(--color-text-muted)]">Multiplicador</p><p className="font-semibold text-[var(--color-text)]">{multiplier > 0 ? `${multiplier.toFixed(2)}x` : "-"}</p></div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="hm-table w-full text-sm">
                  <thead className="bg-[var(--color-surface-alt)] text-xs uppercase text-[var(--color-text-muted)]">
                    <tr><th className="px-3 py-2 text-left">Insumo</th><th className="px-3 py-2 text-right">Requerido</th><th className="px-3 py-2 text-right">Stock disponible</th><th className="px-3 py-2 text-right">Costo unitario</th><th className="px-3 py-2 text-right">Costo linea</th></tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {(preview?.inputs ?? selectedRecipe.inputs.map((input) => ({
                      productId: input.inputProduct.id,
                      productName: input.inputProduct.name,
                      productSku: input.inputProduct.sku,
                      neededQuantity: multiplier > 0 ? input.quantity * multiplier : input.quantity,
                      unit: input.unit,
                      currentWac: 0,
                      currentStock: 0,
                      estimatedCost: 0,
                      hasEnoughStock: true,
                      stockConversion: null,
                    }))).map((input) => (
                      <tr key={input.productId}>
                        <td className="px-3 py-2"><p className="font-medium text-[var(--color-text)]">{input.productName}</p><p className="text-xs text-[var(--color-text-muted)]">{input.productSku}</p></td>
                        <td className="px-3 py-2 text-right">{qty(input.neededQuantity)} {input.unit}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${input.hasEnoughStock ? "text-[var(--color-text)]" : "text-[var(--color-danger-600)]"}`}>{preview ? qty(input.currentStock) : "-"} {input.unit}</td>
                        <td className="px-3 py-2 text-right">{preview ? money(input.currentWac) : "-"}</td>
                        <td className="px-3 py-2 text-right">{preview ? money(input.estimatedCost) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <div className="sticky top-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Costo esperado</h2>
            {previewLoading ? <p className="mt-4 text-sm text-[var(--color-text-muted)]">Calculando...</p> : (
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-[var(--color-text-muted)]">Materiales</dt><dd className="font-bold">{money(preview?.totalMaterialsCost)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-[var(--color-text-muted)]">Costo unitario</dt><dd className="font-bold">{money(preview?.estimatedUnitCost)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-[var(--color-text-muted)]">Precio sugerido</dt><dd className="font-bold">{money(preview?.suggestedPrice)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-[var(--color-text-muted)]">Disponibilidad</dt><dd className={`font-bold ${preview?.allInputsAvailable ? "text-emerald-700" : "text-amber-700"}`}>{preview ? (preview.allInputsAvailable ? "Lista" : "Revisar") : "-"}</dd></div>
              </dl>
            )}
            {warnings.length > 0 && (
              <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Warnings</div>
                {warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            )}
            <div className="mt-5 space-y-2">
              <button type="button" onClick={() => createBatch(false)} disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-master-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] disabled:opacity-50"><Save className="h-4 w-4" />Crear lote como borrador</button>
              <button type="button" onClick={() => createBatch(true)} disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] disabled:opacity-50"><Play className="h-4 w-4" />Crear e iniciar lote</button>
              <Link href="/app/master/production/batches" className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]"><PackageCheck className="h-4 w-4" />Cancelar</Link>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
