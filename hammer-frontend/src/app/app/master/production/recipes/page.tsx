"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Edit3, Factory, Plus, Search, ToggleLeft, ToggleRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { tokenize } from "@/lib/product-search";

type RecipeInput = {
  id: string;
  quantity: number;
  unit: string;
  inputProduct: { id: string; sku: string; name: string; unit?: string };
};

type Recipe = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  expectedQuantity: number;
  expectedUnit: string;
  recipeType: string;
  recipeFamily: string;
  yieldPercent: number | null;
  wastePercent: number | null;
  targetMarginPct: number | null;
  isActive: boolean;
  finishedProduct: { id: string; sku: string; name: string; unit?: string; category?: { name: string } };
  inputs: RecipeInput[];
  _count?: { batches: number };
};

const FAMILIES = [
  ["all", "Todas"],
  ["WOOD", "Madera"],
  ["CEMENT", "Cemento"],
  ["STONE", "Piedra"],
  ["METAL", "Metales"],
  ["BLOCKS", "Bloques"],
  ["PAINT", "Pintura"],
  ["GENERAL", "General"],
];

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [family, setFamily] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/master/production/recipes");
        if (!res.ok) throw new Error("Error al cargar recetas");
        const data = unwrapApiData(await res.json()) as Recipe[];
        if (!cancelled) setRecipes(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    // Tokenizado: cada palabra debe aparecer en algún lugar del texto, en
    // vez de exigir la frase completa pegada (mismo criterio que POS/catálogo).
    const tokens = tokenize(query);
    return recipes.filter((recipe) => {
      const statusOk = status === "all" || (status === "active" ? recipe.isActive : !recipe.isActive);
      const familyOk = family === "all" || recipe.recipeFamily === family;
      const text = `${recipe.name} ${recipe.code} ${recipe.finishedProduct?.name ?? ""} ${recipe.finishedProduct?.sku ?? ""}`.toUpperCase();
      const queryOk = tokens.every((token) => text.includes(token));
      return statusOk && familyOk && queryOk;
    });
  }, [recipes, query, status, family]);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const toggleActive = async (recipe: Recipe) => {
    setTogglingId(recipe.id);
    setError(null);
    try {
      const res = await apiFetch(`/api/master/production/recipes/${recipe.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !recipe.isActive }) });
      if (!res.ok) throw new Error("No se pudo cambiar el estado de la receta.");
      setRecipes((prev) => prev.map((r) => r.id === recipe.id ? { ...r, isActive: !r.isActive } : r));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-success-50)] text-[var(--color-success-700)]">
              <Factory className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text)]">Recetas de Produccion</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Materiales, productos terminados, costos esperados y estado operativo.</p>
            </div>
          </div>
        </div>
        <Link href="/app/master/production/recipes/new" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-master-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)]">
          <Plus className="h-4 w-4" />Crear receta
        </Link>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--color-text-muted)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre, codigo o producto terminado..."
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-master-500)] focus:ring-2 focus:ring-[var(--color-master-100)]"
          />
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-master-500)]"
        >
          <option value="all">Todos los estados</option>
          <option value="active">Activas</option>
          <option value="inactive">Inactivas</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        {FAMILIES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFamily(value)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${family === value ? "bg-[var(--color-master-600)] text-white" : "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-3 text-sm text-[var(--color-danger-700)]">{error}</div>}

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <p className="text-sm font-semibold text-[var(--color-text)]">{filtered.length} receta{filtered.length === 1 ? "" : "s"}</p>
          <Link href="/app/master/production" className="text-sm font-medium text-[var(--color-master-600)] hover:underline">Dashboard</Link>
        </div>

        {loading ? (
          <p className="p-6 text-sm text-[var(--color-text-muted)]">Cargando recetas...</p>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] p-6 text-center">
              <p className="font-semibold text-[var(--color-text)]">No hay recetas creadas.</p>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">Crea una receta para fabricar bloques, huellas, mezclas o productos propios.</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="hm-table w-full text-sm">
              <thead className="bg-[var(--color-surface-alt)] text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-4 py-3 text-left">Codigo</th>
                  <th className="px-4 py-3 text-left">Nombre</th>
                  <th className="px-4 py-3 text-left">Producto terminado</th>
                  <th className="px-4 py-3 text-center">Tipo</th>
                  <th className="px-4 py-3 text-center">Familia</th>
                  <th className="px-4 py-3 text-right">Cantidad esperada</th>
                  <th className="px-4 py-3 text-center">Unidad</th>
                  <th className="px-4 py-3 text-center">Rendimiento</th>
                  <th className="px-4 py-3 text-center">Insumos</th>
                  <th className="px-4 py-3 text-right">Margen objetivo</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {filtered.map((recipe) => (
                  <tr key={recipe.id} className="hover:bg-[var(--color-surface-alt)]">
                    <td className="px-4 py-3"><Link href={`/app/master/production/recipes/${recipe.id}` as never} className="font-mono text-xs font-semibold text-[var(--color-master-600)] hover:underline">{recipe.code}</Link></td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[var(--color-text)]">{recipe.name}</p>
                      {recipe.description && <p className="max-w-64 truncate text-xs text-[var(--color-text-muted)]">{recipe.description}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--color-text)]">{recipe.finishedProduct?.name ?? "-"}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{recipe.finishedProduct?.sku ?? "-"}</p>
                    </td>
                    <td className="px-4 py-3 text-center"><Badge variant="info">{recipe.recipeType ?? "MANUFACTURING"}</Badge></td>
                    <td className="px-4 py-3 text-center"><Badge variant="success">{recipe.recipeFamily ?? "GENERAL"}</Badge></td>
                    <td className="px-4 py-3 text-right">{recipe.expectedQuantity.toLocaleString("es-NI")}</td>
                    <td className="px-4 py-3 text-center">{recipe.expectedUnit}</td>
                    <td className="px-4 py-3 text-center">{recipe.yieldPercent == null ? "-" : `${(recipe.yieldPercent * 100).toFixed(1)}%`}</td>
                    <td className="px-4 py-3 text-center">{recipe.inputs.length}</td>
                    <td className="px-4 py-3 text-right">{recipe.targetMarginPct == null ? "-" : `${(recipe.targetMarginPct * 100).toFixed(1)}%`}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={recipe.isActive ? "success" : "neutral"}>{recipe.isActive ? "Activa" : "Inactiva"}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Link title="Ver" href={`/app/master/production/recipes/${recipe.id}` as never} className="rounded-md border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] hover:text-[var(--color-master-700)]"><Search className="h-4 w-4" /></Link>
                        <Link title="Editar" href={`/app/master/production/recipes/${recipe.id}/edit` as never} className="rounded-md border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] hover:text-[var(--color-master-700)]"><Edit3 className="h-4 w-4" /></Link>
                        <Link title="Crear lote desde receta" href={`/app/master/production/batches/new?recipeId=${recipe.id}` as never} className="rounded-md border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] hover:text-[var(--color-master-700)]"><Factory className="h-4 w-4" /></Link>
                        <button type="button" title={recipe.isActive ? "Desactivar" : "Activar"} disabled={togglingId === recipe.id} onClick={() => void toggleActive(recipe)} className="rounded-md border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] hover:text-[var(--color-master-700)] disabled:opacity-45">{recipe.isActive ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
