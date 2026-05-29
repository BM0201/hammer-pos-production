"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

type RecipeInput = {
  id: string;
  quantity: number;
  unit: string;
  inputProduct: { id: string; sku: string; name: string; unit: string };
};

type Recipe = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  expectedQuantity: number;
  expectedUnit: string;
  targetMarginPct: number | null;
  finishedProduct: { id: string; sku: string; name: string; unit: string };
  inputs: RecipeInput[];
  createdBy: { id: string; fullName: string };
  _count: { batches: number };
};

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

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
    return recipes.filter((r) => {
      // Filtro de estado
      if (statusFilter === "active" && !r.isActive) return false;
      if (statusFilter === "inactive" && r.isActive) return false;
      // Búsqueda por nombre o código
      if (search) {
        const q = search.toLowerCase();
        return r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q);
      }
      return true;
    });
  }, [recipes, search, statusFilter]);

  // Estimar costo por unidad (suma de cantidades × indicador básico)
  const estimateCostIndicator = (recipe: Recipe) => {
    // Simple: cantidad de insumos como indicador de complejidad
    return recipe.inputs.length;
  };

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="h-8 w-1 rounded-full" style={{ background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))" }} />
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Recetas de Producción</h1>
        </div>
        <p className="text-sm text-[var(--color-text-muted)] ml-4">Gestiona las recetas de fabricación</p>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <input
          type="text"
          placeholder="Buscar por nombre o código..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-master-500)] focus:border-transparent"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
          className="px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm bg-[var(--color-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-master-500)]"
        >
          <option value="all">Todos los estados</option>
          <option value="active">Activas</option>
          <option value="inactive">Inactivas</option>
        </select>
        <Link
          href="/app/master/production/recipes/new"
          className="px-4 py-2 bg-[var(--color-master-600)] text-white rounded-lg text-sm font-medium hover:bg-[var(--color-master-700)] transition whitespace-nowrap"
        >
          + Nueva Receta
        </Link>
      </div>

      {/* Results count */}
      <p className="text-xs text-[var(--color-text-muted)]">{filtered.length} receta{filtered.length !== 1 ? "s" : ""} encontrada{filtered.length !== 1 ? "s" : ""}</p>

      {/* Table */}
      <div className="bg-[var(--color-surface)] rounded-xl border shadow-sm">
        {loading && <p className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">Cargando...</p>}
        {error && <p className="px-4 py-8 text-center text-sm text-[var(--color-danger-600)]">{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">No se encontraron recetas.</p>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="hm-table w-full text-sm">
              <thead className="bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Código</th>
                  <th className="px-4 py-2.5 text-left font-medium">Nombre</th>
                  <th className="px-4 py-2.5 text-left font-medium">Producto Terminado</th>
                  <th className="px-4 py-2.5 text-right font-medium">Cant. Esperada</th>
                  <th className="px-4 py-2.5 text-center font-medium">Insumos</th>
                  <th className="px-4 py-2.5 text-center font-medium">Lotes</th>
                  <th className="px-4 py-2.5 text-center font-medium">Costo Est.</th>
                  <th className="px-4 py-2.5 text-center font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--color-surface-alt)]">
                    <td className="px-4 py-2.5">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      <Link href={`/app/master/production/recipes/${r.id}` as any} className="text-[var(--color-master-600)] hover:underline font-mono text-xs">
                        {r.code}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{r.name}</td>
                    <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{r.finishedProduct.name}</td>
                    <td className="px-4 py-2.5 text-right text-[var(--color-text)]">{r.expectedQuantity.toLocaleString()} {r.expectedUnit}</td>
                    <td className="px-4 py-2.5 text-center text-[var(--color-text-muted)]">{r.inputs.length}</td>
                    <td className="px-4 py-2.5 text-center text-[var(--color-text-muted)]">{r._count.batches}</td>
                    <td className="px-4 py-2.5 text-center">
                      {/* Indicador visual de complejidad de costos */}
                      <div className="flex items-center justify-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <div
                            key={i}
                            className={`w-2 h-2 rounded-full ${i <= estimateCostIndicator(r) ? "bg-[var(--color-master-500)]" : "bg-[var(--color-surface-alt)]"}`}
                          />
                        ))}
                      </div>
                      <span className="text-[10px] text-[var(--color-text-soft)]">{r.inputs.length} insumos</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${r.isActive ? "bg-[var(--color-success-50)] text-[var(--color-success-700)]" : "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]"}`}>
                        {r.isActive ? "Activa" : "Inactiva"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Back link */}
      <div className="mt-4">
        <Link href="/app/master/production" className="text-sm text-[var(--color-master-600)] hover:underline">← Volver al Dashboard</Link>
      </div>
    </section>
  );
}
