"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

type BatchSummary = {
  id: string;
  batchNumber: string;
  status: string;
  plannedQuantity: number;
  producedGoodQuantity: number | null;
  totalCost: number | null;
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
  _count: { batches: number };
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "Borrador", color: "bg-[var(--color-surface-alt)] text-[var(--color-text)]" },
  PLANNED: { label: "Planificado", color: "bg-[var(--color-info-50)] text-[var(--color-info-700)]" },
  IN_PROGRESS: { label: "En Proceso", color: "bg-[var(--color-warning-100)] text-[var(--color-warning-700)]" },
  COMPLETED: { label: "Completado", color: "bg-[var(--color-success-50)] text-[var(--color-success-700)]" },
  CANCELLED: { label: "Cancelado", color: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]" },
};

export default function ProductionDashboardPage() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [batchRes, recipeRes] = await Promise.all([
          apiFetch("/api/master/production/batches?limit=50"),
          apiFetch("/api/master/production/recipes"),
        ]);
        if (!batchRes.ok) throw new Error("Error al cargar lotes");
        if (!recipeRes.ok) throw new Error("Error al cargar recetas");
        const batchData = unwrapApiData(await batchRes.json()) as BatchSummary[];
        const recipeData = unwrapApiData(await recipeRes.json()) as RecipeSummary[];
        if (!cancelled) {
          setBatches(batchData);
          setRecipes(recipeData);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const completedBatches = batches.filter((b) => b.status === "COMPLETED");
  const activeBatches = batches.filter((b) => b.status === "IN_PROGRESS" || b.status === "PLANNED");
  const activeRecipes = recipes.filter((r) => r.isActive);

  const totalProduced = completedBatches.reduce((s, b) => s + (b.producedGoodQuantity ?? 0), 0);
  const avgUnitCost = completedBatches.length > 0
    ? completedBatches.reduce((s, b) => s + (b.unitCost ?? 0), 0) / completedBatches.length
    : 0;

  // Eficiencia promedio: producido / planificado
  const avgEfficiency = useMemo(() => {
    const eligible = completedBatches.filter((b) => b.plannedQuantity > 0 && b.producedGoodQuantity != null);
    if (eligible.length === 0) return 0;
    return eligible.reduce((s, b) => s + (b.producedGoodQuantity! / b.plannedQuantity), 0) / eligible.length * 100;
  }, [completedBatches]);

  // Costo promedio por receta (últimas 10 recetas con lotes completados)
  const costByRecipe = useMemo(() => {
    const map = new Map<string, { name: string; totalCost: number; count: number }>();
    for (const b of completedBatches) {
      if (b.unitCost == null) continue;
      const existing = map.get(b.recipe.id) ?? { name: b.recipe.name, totalCost: 0, count: 0 };
      existing.totalCost += b.unitCost;
      existing.count += 1;
      map.set(b.recipe.id, existing);
    }
    return Array.from(map.values())
      .map((r) => ({ name: r.name.length > 20 ? r.name.slice(0, 18) + "…" : r.name, costoPromedio: Math.round((r.totalCost / r.count) * 100) / 100 }))
      .slice(0, 10);
  }, [completedBatches]);

  // Lotes completados por mes (últimos 6 meses)
  const batchesByMonth = useMemo(() => {
    const now = new Date();
    const months: { month: string; completados: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleString("es", { month: "short", year: "2-digit" });
      const count = completedBatches.filter((b) => {
        const cd = b.completedAt ? new Date(b.completedAt) : new Date(b.createdAt);
        return cd.getFullYear() === d.getFullYear() && cd.getMonth() === d.getMonth();
      }).length;
      months.push({ month: label, completados: count });
    }
    return months;
  }, [completedBatches]);

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="h-8 w-1 rounded-full" style={{ background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))" }} />
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Produccion de Materiales</h1>
        </div>
        <p className="text-sm text-[var(--color-text-muted)] ml-4">Recetas, insumos, costos y lotes para fabricar productos.</p>
      </div>

      {/* Quick actions */}
      <div className="flex gap-3 flex-wrap">
        <Link href="/app/master/production/batches/new" className="px-4 py-2 bg-[var(--color-master-600)] text-white rounded-lg text-sm font-medium hover:bg-[var(--color-master-700)] transition">+ Nuevo Lote</Link>
        <Link href="/app/master/production/recipes/new" className="px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] rounded-lg text-sm font-medium hover:bg-[var(--color-surface-alt)] transition">+ Crear Receta de Material</Link>
        <Link href="/app/master/production/recipes" className="px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] rounded-lg text-sm font-medium hover:bg-[var(--color-surface-alt)] transition">Recetas / Materiales</Link>
        <Link href="/app/master/catalog/products" className="px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] rounded-lg text-sm font-medium hover:bg-[var(--color-surface-alt)] transition">Catalogo de Productos</Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-[var(--color-surface)] rounded-xl border p-4 shadow-sm">
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Recetas Activas</p>
          <p className="text-2xl font-bold text-[var(--color-text)] mt-1">{activeRecipes.length}</p>
        </div>
        <div className="bg-[var(--color-surface)] rounded-xl border p-4 shadow-sm">
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Lotes en Proceso</p>
          <p className="text-2xl font-bold text-[var(--color-master-600)] mt-1">{activeBatches.length}</p>
        </div>
        <div className="bg-[var(--color-surface)] rounded-xl border p-4 shadow-sm">
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Total Producido</p>
          <p className="text-2xl font-bold text-[var(--color-text)] mt-1">{totalProduced.toLocaleString()}</p>
        </div>
        <div className="bg-[var(--color-surface)] rounded-xl border p-4 shadow-sm">
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Costo Unit. Prom.</p>
          <p className="text-2xl font-bold text-[var(--color-text)] mt-1">C${avgUnitCost.toFixed(2)}</p>
        </div>
        <div className="bg-[var(--color-surface)] rounded-xl border p-4 shadow-sm">
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Eficiencia Prom.</p>
          <p className={`text-2xl font-bold mt-1 ${avgEfficiency >= 90 ? "text-[var(--color-success-700)]" : avgEfficiency >= 70 ? "text-yellow-600" : "text-[var(--color-danger-600)]"}`}>
            {avgEfficiency.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar chart: Costo promedio por receta */}
        <div className="bg-[var(--color-surface)] rounded-xl border shadow-sm p-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">Costo Promedio por Receta</h3>
          {costByRecipe.length === 0 ? (
            <p className="text-sm text-[var(--color-text-soft)] text-center py-8">Sin datos de costos aún</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={costByRecipe} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Tooltip formatter={(v: any) => [`C$${Number(v).toFixed(2)}`, "Costo Prom."]} />
                <Bar dataKey="costoPromedio" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Line chart: Lotes completados por mes */}
        <div className="bg-[var(--color-surface)] rounded-xl border shadow-sm p-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">Lotes Completados por Mes</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={batchesByMonth} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="completados" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} name="Completados" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent batches */}
      <div className="bg-[var(--color-surface)] rounded-xl border shadow-sm">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Últimos Lotes</h2>
          <Link href="/app/master/production/batches" className="text-xs text-[var(--color-master-600)] hover:underline">Ver todos →</Link>
        </div>

        {loading && <p className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">Cargando...</p>}
        {error && <p className="px-4 py-8 text-center text-sm text-[var(--color-danger-600)]">{error}</p>}
        {!loading && !error && batches.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">No hay lotes de producción aún.</p>
        )}

        {!loading && !error && batches.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Lote</th>
                  <th className="px-4 py-2.5 text-left font-medium">Receta</th>
                  <th className="px-4 py-2.5 text-left font-medium">Sucursal</th>
                  <th className="px-4 py-2.5 text-center font-medium">Estado</th>
                  <th className="px-4 py-2.5 text-right font-medium">Planificado</th>
                  <th className="px-4 py-2.5 text-right font-medium">Producido</th>
                  <th className="px-4 py-2.5 text-right font-medium">Costo Unit.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {batches.slice(0, 10).map((b) => {
                  const st = STATUS_LABELS[b.status] ?? { label: b.status, color: "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]" };
                  return (
                    <tr key={b.id} className="hover:bg-[var(--color-surface-alt)]">
                      <td className="px-4 py-2.5">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        <Link href={`/app/master/production/batches/${b.id}` as any} className="text-[var(--color-master-600)] hover:underline font-medium">{b.batchNumber}</Link>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--color-text)]">{b.recipe.name}</td>
                      <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{b.branch.name}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[var(--color-text)]">{b.plannedQuantity.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--color-text)]">{b.producedGoodQuantity != null ? b.producedGoodQuantity.toLocaleString() : "—"}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--color-text)]">{b.unitCost != null ? `C$${b.unitCost.toFixed(2)}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
