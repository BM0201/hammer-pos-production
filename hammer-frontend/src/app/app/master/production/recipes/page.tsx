"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Edit3, Factory, Plus, Search, ToggleLeft } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

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

const money = (value: number) => `C$${value.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const FAMILIES = [
  ["all", "Todas"],
  ["WOOD", "Madera"],
  ["CEMENT", "Cemento"],
  ["STONE", "Piedra"],
  ["METAL", "Metales"],
  ["BLOCKS", "Bloques"],
  ["GENERAL", "General"],
];

function estimatedCost(recipe: Recipe) {
  return recipe.inputs.reduce((sum, input) => sum + input.quantity, 0);
}

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
    const q = query.trim().toLowerCase();
    return recipes.filter((recipe) => {
      const statusOk = status === "all" || (status === "active" ? recipe.isActive : !recipe.isActive);
      const familyOk = family === "all" || recipe.recipeFamily === family;
      const text = `${recipe.name} ${recipe.code} ${recipe.finishedProduct?.name ?? ""} ${recipe.finishedProduct?.sku ?? ""}`.toLowerCase();
      return statusOk && familyOk && (!q || text.includes(q));
    });
  }, [recipes, query, status, family]);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
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
            className="w-full rounded-lg border border-[var(--color-border)] bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-master-500)] focus:ring-2 focus:ring-[var(--color-master-100)]"
          />
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-master-500)]"
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
                  <th className="px-4 py-3 text-right">Costo esperado</th>
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
                    <td className="px-4 py-3 text-center"><span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">{recipe.recipeType ?? "MANUFACTURING"}</span></td>
                    <td className="px-4 py-3 text-center"><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{recipe.recipeFamily ?? "GENERAL"}</span></td>
                    <td className="px-4 py-3 text-right">{recipe.expectedQuantity.toLocaleString("es-NI")}</td>
                    <td className="px-4 py-3 text-center">{recipe.expectedUnit}</td>
                    <td className="px-4 py-3 text-center">{recipe.yieldPercent == null ? "-" : `${(recipe.yieldPercent * 100).toFixed(1)}%`}</td>
                    <td className="px-4 py-3 text-center">{recipe.inputs.length}</td>
                    <td className="px-4 py-3 text-right">{recipe.inputs.length ? money(estimatedCost(recipe)) : "-"}</td>
                    <td className="px-4 py-3 text-right">{recipe.targetMarginPct == null ? "-" : `${(recipe.targetMarginPct * 100).toFixed(1)}%`}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${recipe.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {recipe.isActive ? "Activa" : "Inactiva"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Link title="Ver" href={`/app/master/production/recipes/${recipe.id}` as never} className="rounded-md border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] hover:text-[var(--color-master-700)]"><Search className="h-4 w-4" /></Link>
                        <Link title="Editar" href={`/app/master/production/recipes/${recipe.id}` as never} className="rounded-md border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] hover:text-[var(--color-master-700)]"><Edit3 className="h-4 w-4" /></Link>
                        <Link title="Crear lote desde receta" href={`/app/master/production/batches/new?recipeId=${recipe.id}` as never} className="rounded-md border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] hover:text-[var(--color-master-700)]"><Factory className="h-4 w-4" /></Link>
                        <button title="Desactivar" disabled className="rounded-md border border-[var(--color-border)] p-2 text-[var(--color-text-soft)] disabled:opacity-45"><ToggleLeft className="h-4 w-4" /></button>
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
