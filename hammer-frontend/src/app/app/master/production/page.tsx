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
  DRAFT: { label: "Borrador", color: "bg-gray-100 text-gray-700" },
  PLANNED: { label: "Planificado", color: "bg-blue-100 text-blue-700" },
  IN_PROGRESS: { label: "En Proceso", color: "bg-yellow-100 text-yellow-700" },
  COMPLETED: { label: "Completado", color: "bg-green-100 text-green-700" },
  CANCELLED: { label: "Cancelado", color: "bg-red-100 text-red-700" },
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
          <h1 className="text-2xl font-bold text-gray-900">Produccion de Materiales</h1>
        </div>
        <p className="text-sm text-gray-500 ml-4">Recetas, insumos, costos y lotes para fabricar productos.</p>
      </div>

      {/* Quick actions */}
      <div className="flex gap-3 flex-wrap">
        <Link href="/app/master/production/batches/new" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition">+ Nuevo Lote</Link>
        <Link href="/app/master/production/recipes/new" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition">+ Crear Receta de Material</Link>
        <Link href="/app/master/production/recipes" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition">Recetas / Materiales</Link>
        <Link href="/app/master/catalog/products" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition">Catalogo de Productos</Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl border p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Recetas Activas</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{activeRecipes.length}</p>
        </div>
        <div className="bg-white rounded-xl border p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Lotes en Proceso</p>
          <p className="text-2xl font-bold text-indigo-600 mt-1">{activeBatches.length}</p>
        </div>
        <div className="bg-white rounded-xl border p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Producido</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totalProduced.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Costo Unit. Prom.</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">C${avgUnitCost.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl border p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Eficiencia Prom.</p>
          <p className={`text-2xl font-bold mt-1 ${avgEfficiency >= 90 ? "text-green-600" : avgEfficiency >= 70 ? "text-yellow-600" : "text-red-600"}`}>
            {avgEfficiency.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar chart: Costo promedio por receta */}
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Costo Promedio por Receta</h3>
          {costByRecipe.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Sin datos de costos aún</p>
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
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Lotes Completados por Mes</h3>
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
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Últimos Lotes</h2>
          <Link href="/app/master/production/batches" className="text-xs text-indigo-600 hover:underline">Ver todos →</Link>
        </div>

        {loading && <p className="px-4 py-8 text-center text-sm text-gray-400">Cargando...</p>}
        {error && <p className="px-4 py-8 text-center text-sm text-red-500">{error}</p>}
        {!loading && !error && batches.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-gray-400">No hay lotes de producción aún.</p>
        )}

        {!loading && !error && batches.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
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
              <tbody className="divide-y divide-gray-100">
                {batches.slice(0, 10).map((b) => {
                  const st = STATUS_LABELS[b.status] ?? { label: b.status, color: "bg-gray-100 text-gray-600" };
                  return (
                    <tr key={b.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        <Link href={`/app/master/production/batches/${b.id}` as any} className="text-indigo-600 hover:underline font-medium">{b.batchNumber}</Link>
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">{b.recipe.name}</td>
                      <td className="px-4 py-2.5 text-gray-500">{b.branch.name}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-700">{b.plannedQuantity.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-gray-700">{b.producedGoodQuantity != null ? b.producedGoodQuantity.toLocaleString() : "—"}</td>
                      <td className="px-4 py-2.5 text-right text-gray-700">{b.unitCost != null ? `C$${b.unitCost.toFixed(2)}` : "—"}</td>
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
