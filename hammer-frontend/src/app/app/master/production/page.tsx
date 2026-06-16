"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  Factory,
  PackageSearch,
  Plus,
  ReceiptText,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

type BatchSummary = {
  id: string;
  batchNumber: string;
  status: string;
  plannedQuantity: number;
  producedGoodQuantity: number | null;
  unitCost: number | null;
  createdAt: string;
  completedAt: string | null;
  recipe: { id: string; name: string; code: string };
  branch: { id: string; code: string; name: string };
};

type RecipeSummary = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  expectedQuantity: number;
  expectedUnit: string;
  targetMarginPct: number | null;
  inputs?: Array<{ quantity: number; inputProduct?: { name: string } }>;
  _count?: { batches: number };
};

type Branch = { id: string; code: string; name: string };
type ProductionRecommendation = {
  id: string;
  branchId: string;
  targetProductId: string;
  targetProductName: string;
  targetSku: string;
  targetStockOnHand: number;
  targetShortageQty: number;
  recipeId: string;
  recipeName: string;
  recipeType: string;
  recipeFamily: string;
  inputSummary: Array<{ productName: string; excessQty: number; availableStock: number; requiredQtyPerBatch: number }>;
  suggestedBatches: number;
  expectedOutputQty: number;
  estimatedUnitCost: number | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  recommendationType: string;
  message: string;
  warnings: string[];
  recommendedActions: string[];
};

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Borrador", cls: "bg-slate-100 text-slate-700" },
  PLANNED: { label: "Planificado", cls: "bg-sky-50 text-sky-700" },
  IN_PROGRESS: { label: "En proceso", cls: "bg-amber-50 text-amber-700" },
  COMPLETED: { label: "Completado", cls: "bg-emerald-50 text-emerald-700" },
  CANCELLED: { label: "Cancelado", cls: "bg-rose-50 text-rose-700" },
};

const money = (value: number | null | undefined) => value == null ? "-" : `C$${value.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (value: number | null | undefined) => value == null ? "-" : value.toLocaleString("es-NI", { maximumFractionDigits: 2 });
type KpiItem = { label: string; value: string | number; Icon: LucideIcon };

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-5">
      <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{body}</p>
    </div>
  );
}

export default function ProductionDashboardPage() {
  const router = useRouter();
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [recommendations, setRecommendations] = useState<ProductionRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [creatingRecommendationId, setCreatingRecommendationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [batchRes, recipeRes, branchRes] = await Promise.all([
          apiFetch("/api/master/production/batches?limit=80"),
          apiFetch("/api/master/production/recipes"),
          apiFetch("/api/branches"),
        ]);
        if (!batchRes.ok || !recipeRes.ok) throw new Error("No se pudo cargar produccion.");
        const batchData = unwrapApiData(await batchRes.json()) as BatchSummary[];
        const recipeData = unwrapApiData(await recipeRes.json()) as RecipeSummary[];
        const branchData = branchRes.ok ? unwrapApiData(await branchRes.json()) as Branch[] : [];
        if (!cancelled) {
          setBatches(batchData);
          setRecipes(recipeData);
          const branchList = Array.isArray(branchData) ? branchData : [];
          setBranches(branchList);
          setSelectedBranchId((current) => current || branchList[0]?.id || "");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!selectedBranchId) {
      setRecommendations([]);
      return;
    }
    (async () => {
      setRecommendationsLoading(true);
      try {
        const res = await apiFetch(`/api/master/production/recommendations?branchId=${encodeURIComponent(selectedBranchId)}`);
        if (!res.ok) throw new Error("No se pudieron cargar recomendaciones.");
        const data = unwrapApiData(await res.json()) as { recommendations?: ProductionRecommendation[] };
        if (!cancelled) setRecommendations(data.recommendations ?? []);
      } catch {
        if (!cancelled) setRecommendations([]);
      } finally {
        if (!cancelled) setRecommendationsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedBranchId]);

  const createSuggestedBatch = async (recommendation: ProductionRecommendation) => {
    if (!confirm(`Crear lote borrador para ${recommendation.targetProductName}?`)) return;
    setCreatingRecommendationId(recommendation.id);
    setError(null);
    try {
      const res = await apiFetch("/api/master/production/recommendations/create-batch", {
        method: "POST",
        body: JSON.stringify({
          branchId: recommendation.branchId,
          recipeId: recommendation.recipeId,
          suggestedBatches: recommendation.suggestedBatches,
          targetProductId: recommendation.targetProductId,
          notes: `Lote sugerido: ${recommendation.message}`,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error?.message ?? errData?.message ?? "No se pudo crear el lote sugerido.");
      }
      const created = unwrapApiData(await res.json()) as { id: string };
      router.push(`/app/master/production/batches/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setCreatingRecommendationId(null);
    }
  };

  const completed = batches.filter((batch) => batch.status === "COMPLETED");
  const inProcess = batches.filter((batch) => batch.status === "IN_PROGRESS" || batch.status === "PLANNED");
  const activeRecipes = recipes.filter((recipe) => recipe.isActive);
  const recipesWithoutInputs = recipes.filter((recipe) => recipe.isActive && (recipe.inputs?.length ?? 0) === 0);
  const recipesWithoutCost = recipes.filter((recipe) => recipe.isActive && (recipe.inputs ?? []).some((input) => !input.quantity || input.quantity <= 0));
  const totalProduced = completed.reduce((sum, batch) => sum + (batch.producedGoodQuantity ?? 0), 0);
  const avgUnitCost = completed.length ? completed.reduce((sum, batch) => sum + (batch.unitCost ?? 0), 0) / completed.length : 0;
  const avgEfficiency = useMemo(() => {
    const rows = completed.filter((batch) => batch.plannedQuantity > 0 && batch.producedGoodQuantity != null);
    if (!rows.length) return 0;
    return rows.reduce((sum, batch) => sum + ((batch.producedGoodQuantity ?? 0) / batch.plannedQuantity), 0) / rows.length * 100;
  }, [completed]);

  const costByRecipe = useMemo(() => {
    const map = new Map<string, { name: string; total: number; count: number }>();
    for (const batch of completed) {
      if (batch.unitCost == null) continue;
      const row = map.get(batch.recipe.id) ?? { name: batch.recipe.name, total: 0, count: 0 };
      row.total += batch.unitCost;
      row.count += 1;
      map.set(batch.recipe.id, row);
    }
    return Array.from(map.values()).map((row) => ({ ...row, avg: row.total / row.count })).slice(0, 6);
  }, [completed]);

  const priorities = [
    ...inProcess.slice(0, 3).map((batch) => ({ label: batch.batchNumber, detail: `${batch.recipe.name} en ${batch.branch.name}`, tone: "warning" })),
    ...recipesWithoutInputs.slice(0, 2).map((recipe) => ({ label: recipe.code, detail: "Receta activa sin insumos.", tone: "danger" })),
    ...recipesWithoutCost.slice(0, 2).map((recipe) => ({ label: recipe.code, detail: "Revisar cantidades/costos esperados.", tone: "info" })),
  ];

  return (
    <section className="space-y-6">
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex flex-col gap-5 bg-gradient-to-r from-slate-950 via-slate-800 to-emerald-800 px-5 py-6 text-white lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-white/12">
              <Factory className="h-6 w-6" />
            </div>
            <h1 className="text-3xl font-bold tracking-normal">Produccion de Materiales</h1>
            <p className="mt-2 text-sm text-white/80">Recetas, insumos, costos y lotes para fabricar productos.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/app/master/production/batches/new" className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-white/90"><Plus className="h-4 w-4" />Nuevo lote</Link>
            <Link href="/app/master/production/recipes/new" className="inline-flex items-center gap-2 rounded-lg bg-white/12 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/25 hover:bg-white/18"><Plus className="h-4 w-4" />Crear receta</Link>
            <Link href="/app/master/production/recipes" className="inline-flex items-center gap-2 rounded-lg bg-white/12 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/25 hover:bg-white/18"><ReceiptText className="h-4 w-4" />Recetas / Materiales</Link>
            <Link href="/app/master/catalog/products" className="inline-flex items-center gap-2 rounded-lg bg-white/12 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/25 hover:bg-white/18"><PackageSearch className="h-4 w-4" />Catalogo de productos</Link>
          </div>
        </div>
      </div>

      {error && <div className="rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-3 text-sm text-[var(--color-danger-700)]">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {([
          { label: "Recetas activas", value: activeRecipes.length, Icon: ClipboardList },
          { label: "Lotes en proceso", value: inProcess.length, Icon: Factory },
          { label: "Total producido", value: num(totalProduced), Icon: Boxes },
          { label: "Costo unitario promedio", value: money(avgUnitCost), Icon: TrendingUp },
          { label: "Eficiencia promedio", value: `${avgEfficiency.toFixed(1)}%`, Icon: TrendingUp },
          { label: "Insumos criticos", value: recipesWithoutInputs.length + recipesWithoutCost.length, Icon: AlertTriangle },
        ] satisfies KpiItem[]).map(({ label, value, Icon }) => (
          <div key={label} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</p>
              <Icon className="h-4 w-4 text-[var(--color-master-600)]" />
            </div>
            <p className="mt-2 text-2xl font-bold text-[var(--color-text)]">{String(value)}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">Recomendaciones de produccion</h2>
            <p className="text-sm text-[var(--color-text-muted)]">Detecta productos bajos que pueden fabricarse desde insumos disponibles o excedentes.</p>
          </div>
          <select
            value={selectedBranchId}
            onChange={(event) => setSelectedBranchId(event.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
          >
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>)}
          </select>
        </div>

        {recommendationsLoading ? (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">Buscando oportunidades de produccion...</p>
        ) : recommendations.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="Sin recomendaciones por ahora" body="Cuando falte un producto y exista una receta viable con insumos disponibles, aparecera aqui." />
          </div>
        ) : (
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {recommendations.slice(0, 6).map((recommendation) => {
              const input = recommendation.inputSummary[0];
              const canCreate = recommendation.suggestedBatches > 0
                && recommendation.recommendedActions.includes("CREATE_PRODUCTION_BATCH")
                && recommendation.recommendationType !== "NOT_ENOUGH_INPUTS"
                && recommendation.recommendationType !== "REVIEW_RECIPE";
              return (
                <div key={recommendation.id} className="rounded-lg border border-[var(--color-border)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Falta</p>
                      <h3 className="mt-1 text-base font-bold text-[var(--color-text)]">{recommendation.targetProductName}</h3>
                      <p className="text-xs text-[var(--color-text-muted)]">{recommendation.targetSku} · Stock actual: {num(recommendation.targetStockOnHand)} · Falta: {num(recommendation.targetShortageQty)}</p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${recommendation.priority === "URGENT" ? "bg-rose-50 text-rose-700" : recommendation.priority === "HIGH" ? "bg-amber-50 text-amber-700" : "bg-sky-50 text-sky-700"}`}>
                      {recommendation.priority}
                    </span>
                  </div>
                  <div className="mt-3 rounded-lg bg-[var(--color-surface-alt)] p-3 text-sm">
                    <p><span className="font-semibold">Receta:</span> {recommendation.recipeName}</p>
                    <p><span className="font-semibold">Tipo/familia:</span> {recommendation.recipeType} · {recommendation.recipeFamily}</p>
                    {input && <p><span className="font-semibold">Insumo disponible:</span> {input.productName}, exceso {num(input.excessQty)} / stock {num(input.availableStock)}</p>}
                    <p><span className="font-semibold">Sugerencia:</span> producir {num(recommendation.expectedOutputQty)} unidades</p>
                    <p><span className="font-semibold">Costo estimado:</span> {money(recommendation.estimatedUnitCost)} por unidad</p>
                  </div>
                  {recommendation.warnings.length > 0 && (
                    <div className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                      {recommendation.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={!canCreate || creatingRecommendationId === recommendation.id}
                    onClick={() => createSuggestedBatch(recommendation)}
                    className="mt-3 rounded-lg bg-[var(--color-master-600)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creatingRecommendationId === recommendation.id ? "Creando..." : "Crear lote sugerido"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.35fr]">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Prioridades de produccion</h2>
          <div className="mt-4 space-y-3">
            {loading ? <p className="text-sm text-[var(--color-text-muted)]">Cargando prioridades...</p> : priorities.length === 0 ? (
              <EmptyState title="Sin prioridades pendientes" body="Cuando existan lotes en proceso, recetas incompletas o costos por revisar apareceran aqui." />
            ) : priorities.map((item) => (
              <div key={`${item.label}-${item.detail}`} className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] px-3 py-3">
                <span className={`mt-1 h-2.5 w-2.5 rounded-full ${item.tone === "danger" ? "bg-rose-500" : item.tone === "warning" ? "bg-amber-500" : "bg-sky-500"}`} />
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text)]">{item.label}</p>
                  <p className="text-sm text-[var(--color-text-muted)]">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Ultimos lotes</h2>
            <Link href="/app/master/production/batches" className="text-sm font-medium text-[var(--color-master-600)] hover:underline">Ver todos</Link>
          </div>
          {loading ? <p className="p-5 text-sm text-[var(--color-text-muted)]">Cargando lotes...</p> : batches.length === 0 ? (
            <div className="p-4"><EmptyState title="No hay lotes creados" body="Crea un lote desde una receta activa para validar insumos, producir y registrar Kardex." /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="hm-table w-full text-sm">
                <thead className="bg-[var(--color-surface-alt)] text-xs uppercase text-[var(--color-text-muted)]">
                  <tr>
                    <th className="px-4 py-3 text-left">Lote</th>
                    <th className="px-4 py-3 text-left">Receta</th>
                    <th className="px-4 py-3 text-left">Producto terminado</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                    <th className="px-4 py-3 text-right">Cantidad</th>
                    <th className="px-4 py-3 text-right">Costo unitario</th>
                    <th className="px-4 py-3 text-left">Fecha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {batches.slice(0, 8).map((batch) => {
                    const st = STATUS[batch.status] ?? { label: batch.status, cls: "bg-slate-100 text-slate-700" };
                    return (
                      <tr key={batch.id} className="hover:bg-[var(--color-surface-alt)]">
                        <td className="px-4 py-3"><Link href={`/app/master/production/batches/${batch.id}` as never} className="font-semibold text-[var(--color-master-600)] hover:underline">{batch.batchNumber}</Link></td>
                        <td className="px-4 py-3 text-[var(--color-text)]">{batch.recipe.name}</td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">{batch.recipe.code}</td>
                        <td className="px-4 py-3 text-center"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${st.cls}`}>{st.label}</span></td>
                        <td className="px-4 py-3 text-right">{num(batch.producedGoodQuantity ?? batch.plannedQuantity)}</td>
                        <td className="px-4 py-3 text-right">{money(batch.unitCost)}</td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">{new Date(batch.completedAt ?? batch.createdAt).toLocaleDateString("es-NI")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Costos por receta</h2>
        {costByRecipe.length === 0 ? (
          <div className="mt-4"><EmptyState title="Sin costos historicos" body="Los costos aparecen cuando se completan lotes con insumos consumidos y producto terminado recibido." /></div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {costByRecipe.map((row) => (
              <div key={row.name} className="rounded-lg border border-[var(--color-border)] p-3">
                <p className="truncate text-sm font-semibold text-[var(--color-text)]">{row.name}</p>
                <p className="mt-2 text-xl font-bold text-[var(--color-text)]">{money(row.avg)}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{row.count} lote{row.count === 1 ? "" : "s"} completado{row.count === 1 ? "" : "s"}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
