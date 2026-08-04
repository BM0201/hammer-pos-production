"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Factory, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { tokenize } from "@/lib/product-search";

/**
 * Producción v2 Fase 6 — "Planificar lote" (mockup vista 2). Planificar
 * RESERVA el stock disponible (antes no reservaba nada — el conflicto solo
 * aparecía al cerrar). El faltante no bloquea: el lote queda PLANIFICADO sin
 * reservar lo que falta, con aviso y acceso a Reposición.
 */

type Recipe = {
  id: string;
  name: string;
  code: string;
  expectedQuantity: number;
  expectedUnit: string;
  targetMarginPct: number | null;
  finishedProduct?: { id: string; sku: string; name: string; unit?: string };
  inputs: Array<{ inputProductId: string; inputProduct: { id: string; sku: string; name: string; unit?: string }; quantity: number; unit: string }>;
};

type Branch = { id: string; code: string; name: string };

type CostPreview = {
  inputs: Array<{ productId: string; productName: string; productSku: string; neededQuantity: number; unit: string; currentWac: number; currentStock: number; estimatedCost: number; hasEnoughStock: boolean }>;
  totalMaterialsCost: number;
  laborCost: number;
  overheadCost: number;
  estimatedUnitCost: number;
  allInputsAvailable: boolean;
  suggestedPrice: number | null;
};

type Reservation = { inputProductId: string; requestedQuantity: number; reservedQuantity: number; shortfall: number };

const money = (v: number | null | undefined) => v == null ? "—" : `C$${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (v: number) => v.toLocaleString("es-NI", { maximumFractionDigits: 4 });

function NewBatchContent() {
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [recipesRes, branchesRes] = await Promise.all([
          apiFetch("/api/master/production/recipes?isActive=true"),
          apiFetch("/api/branches"),
        ]);
        if (!recipesRes.ok) { showToast("error", "No se pudieron cargar recetas."); return; }
        const recipeData = unwrapApiData(await recipesRes.json()) as Recipe[];
        const branchData = branchesRes.ok ? unwrapApiData(await branchesRes.json()) as Branch[] : [];
        if (!cancelled) {
          setRecipes(recipeData);
          const list = Array.isArray(branchData) ? branchData : [];
          setBranches(list);
          setBranchId((current) => current || list[0]?.id || "");
        }
      } catch {
        if (!cancelled) showToast("error", "Error de red al cargar datos.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectedRecipe = recipes.find((recipe) => recipe.id === recipeId);
  const plannedQty = Number(plannedQuantity || 0);

  useEffect(() => {
    if (selectedRecipe && !plannedQuantity) setPlannedQuantity(String(selectedRecipe.expectedQuantity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId]);

  const filteredRecipes = useMemo(() => {
    const tokens = tokenize(recipeQuery);
    return recipes
      .filter((recipe) => {
        if (tokens.length === 0) return true;
        const text = `${recipe.code} ${recipe.name} ${recipe.finishedProduct?.name ?? ""}`.toUpperCase();
        return tokens.every((token) => text.includes(token));
      })
      .slice(0, 12);
  }, [recipes, recipeQuery]);

  useEffect(() => {
    let cancelled = false;
    if (!recipeId || !branchId || plannedQty <= 0) { setPreview(null); return; }
    (async () => {
      setPreviewLoading(true);
      try {
        const res = await apiFetch("/api/master/production/calculate", {
          method: "POST",
          body: JSON.stringify({ recipeId, branchId, plannedQuantity: plannedQty }),
        });
        if (!res.ok) throw new Error();
        setPreview(unwrapApiData(await res.json()) as CostPreview);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [recipeId, branchId, plannedQty]);

  const shortfalls = (preview?.inputs ?? []).filter((i) => !i.hasEnoughStock);

  async function planAndReserve() {
    if (!recipeId) return showToast("warning", "Selecciona una receta.");
    if (!branchId) return showToast("warning", "Selecciona sucursal o bodega.");
    if (plannedQty <= 0) return showToast("warning", "La cantidad a producir debe ser mayor a 0.");
    setSaving(true);
    try {
      const createRes = await apiFetch("/api/master/production/batches", {
        method: "POST",
        body: JSON.stringify({ recipeId, branchId, plannedQuantity: plannedQty, notes: notes.trim() || null }),
      });
      const createRaw = await createRes.json().catch(() => null);
      if (!createRes.ok) { showToast("error", createRaw?.error?.message ?? "No se pudo crear el lote."); return; }
      const created = unwrapApiData(createRaw) as { id: string };

      const planRes = await apiFetch(`/api/master/production/batches/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "PLANNED" }),
      });
      const planRaw = await planRes.json().catch(() => null);
      if (!planRes.ok) { showToast("error", planRaw?.error?.message ?? "El lote se creó pero no se pudo planificar/reservar."); router.push(`/app/master/production/batches/${created.id}`); return; }

      const plannedBatch = unwrapApiData(planRaw) as { reservation?: Reservation[] };
      const withShortfall = (plannedBatch.reservation ?? []).filter((r) => r.shortfall > 0);
      if (withShortfall.length > 0) {
        showToast("warning", `Planificado con ${withShortfall.length} insumo(s) sin reserva completa — revisa el lote.`);
      } else {
        showToast("success", "Lote planificado y stock reservado.");
      }
      router.push(`/app/master/production/batches/${created.id}`);
    } catch {
      showToast("error", "Error de red al planificar el lote.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="hm-icon-wrap-md hm-icon-wrap"><Factory className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-[var(--color-text)]">Planificar lote de producción</h1>
          <p className="text-[12.5px] text-[var(--color-text-muted)]">Calcula insumos por regla de tres desde la receta y reserva lo disponible.</p>
        </div>
        <Link href="/app/master/production/batches" className="text-[12.5px] font-medium text-[var(--color-master-600)] hover:underline">Volver a lotes</Link>
      </div>

      {loading ? <p className="text-sm text-[var(--color-text-muted)]">Cargando datos…</p> : null}

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Card>
            <div className="hm-section-rule">Receta y cantidad</div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--color-text-muted)]" />
              <input value={recipeQuery} onChange={(e) => setRecipeQuery(e.target.value)} placeholder="Buscar por código, receta o producto…" className="hm-input w-full pl-9" />
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {filteredRecipes.map((recipe) => (
                <button key={recipe.id} type="button" onClick={() => setRecipeId(recipe.id)} className="rounded-lg border p-3 text-left" style={{ borderColor: recipeId === recipe.id ? "var(--color-master-500)" : "var(--color-border)", background: recipeId === recipe.id ? "var(--color-master-50)" : "var(--color-surface)" }}>
                  <p className="text-[12.5px] font-semibold text-[var(--color-text)]">{recipe.name}</p>
                  <p className="text-[11px] text-[var(--color-text-muted)]">{recipe.code} · {recipe.expectedQuantity} {recipe.expectedUnit}</p>
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase text-[var(--color-text-muted)]">Cantidad a producir</span>
                <input type="number" min="0.01" step="any" value={plannedQuantity} onChange={(e) => setPlannedQuantity(e.target.value)} className="hm-input mt-1 w-full text-right" />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase text-[var(--color-text-muted)]">Sucursal</span>
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="hm-input mt-1 w-full">
                  <option value="">Seleccionar…</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase text-[var(--color-text-muted)]">Notas</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className="hm-input mt-1 w-full" />
              </label>
            </div>
          </Card>

          {selectedRecipe && (
            <Card noPadding>
              <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2.5">
                <b className="text-[12.5px]">Insumos requeridos · se reservan al planificar</b>
              </div>
              <table className="hm-sheet-table">
                <thead><tr><th>Insumo</th><th className="r">Requerido</th><th className="r">Disponible</th><th>Estado</th></tr></thead>
                <tbody>
                  {selectedRecipe.inputs.map((input) => {
                    const line = preview?.inputs.find((p) => p.productId === input.inputProductId);
                    const shortfall = line && !line.hasEnoughStock ? line.neededQuantity - line.currentStock : 0;
                    return (
                      <tr key={input.inputProductId}>
                        <td><b>{input.inputProduct.name}</b></td>
                        <td className="hm-num">{line ? qty(line.neededQuantity) : "…"} {input.unit}</td>
                        <td className="hm-num">{line ? qty(line.currentStock) : "—"} {input.unit}</td>
                        <td>
                          {!line ? <Badge variant="neutral">Calculando…</Badge>
                            : line.currentStock <= 0 && line.currentWac <= 0 ? <Badge variant="neutral">No inventariado</Badge>
                            : line.hasEnoughStock ? <Badge variant="success">✓ Suficiente</Badge>
                            : <Badge variant="danger">⚠ Faltan {qty(shortfall)} {input.unit}</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {shortfalls.length > 0 && (
                <div className="hm-alert hm-alert-warning m-3">
                  ⚠ Falta stock en {shortfalls.length} insumo(s). Podés planificar igual (queda PLANIFICADO sin reservar el faltante) o{" "}
                  <Link href="/app/master/replenishment" className="font-semibold underline">generar un pedido de compra desde Reposición</Link>.
                </div>
              )}
            </Card>
          )}
        </div>

        <aside className="space-y-3">
          <Card>
            <div className="hm-section-rule">Costo estándar planeado</div>
            {previewLoading ? <p className="text-[12.5px] text-[var(--color-text-muted)]">Calculando…</p> : (
              <dl className="space-y-1.5 text-[12.5px]">
                <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Materiales</dt><dd className="hm-num font-semibold">{money(preview?.totalMaterialsCost)}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Mano de obra</dt><dd className="hm-num font-semibold">{money(preview?.laborCost ?? 0)}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Overhead</dt><dd className="hm-num font-semibold">{money(preview?.overheadCost ?? 0)}</dd></div>
                <div className="flex justify-between border-t border-[var(--color-border)] pt-1.5"><dt className="text-[var(--color-text-muted)]">Total</dt><dd className="hm-num font-bold">{money((preview?.totalMaterialsCost ?? 0) + (preview?.laborCost ?? 0) + (preview?.overheadCost ?? 0))}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Costo unitario estándar</dt><dd className="hm-num font-bold">{money(preview?.estimatedUnitCost)}</dd></div>
              </dl>
            )}
            <Button variant="primary" className="mt-3 w-full" loading={saving} onClick={planAndReserve}>
              Planificar y reservar insumos
            </Button>
          </Card>
          <div className="hm-alert hm-alert-info">
            💡 Al planificar, el estado pasa a <b>PLANIFICADO</b> y los insumos disponibles quedan reservados hasta que cierres o canceles el lote.
          </div>
        </aside>
      </div>
    </section>
  );
}

export default function NewBatchPage() {
  return (
    <Suspense fallback={null}>
      <NewBatchContent />
    </Suspense>
  );
}
