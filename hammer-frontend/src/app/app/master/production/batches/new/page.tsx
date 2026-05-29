"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

type Recipe = {
  id: string;
  name: string;
  code: string;
  expectedQuantity: number;
  expectedUnit: string;
  inputs: Array<{
    inputProduct: { id: string; sku: string; name: string };
    quantity: number;
    unit: string;
  }>;
};

type Branch = { id: string; code: string; name: string };

export default function NewBatchPage() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recipeId, setRecipeId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [plannedQuantity, setPlannedQuantity] = useState("");
  const [notes, setNotes] = useState("");

  const selectedRecipe = recipes.find((r) => r.id === recipeId);
  const multiplier = selectedRecipe && plannedQuantity
    ? parseFloat(plannedQuantity) / selectedRecipe.expectedQuantity
    : 0;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [recipesRes, branchesRes] = await Promise.all([
          apiFetch("/api/master/production/recipes?isActive=true"),
          apiFetch("/api/branches"),
        ]);
        if (recipesRes.ok) {
          const data = unwrapApiData(await recipesRes.json()) as Recipe[];
          if (!cancelled) setRecipes(data);
        }
        if (branchesRes.ok) {
          const data = unwrapApiData(await branchesRes.json());
          const list: Branch[] = Array.isArray(data) ? data : [];
          if (!cancelled) setBranches(list);
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const body = {
        recipeId,
        branchId,
        plannedQuantity: parseFloat(plannedQuantity),
        notes: notes.trim() || null,
      };

      const res = await apiFetch("/api/master/production/batches", {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error?.message ?? errData?.message ?? "Error al crear lote");
      }

      const created = unwrapApiData(await res.json());
      router.push(`/app/master/production/batches/${(created as { id: string }).id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6 max-w-3xl">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div
            className="h-8 w-1 rounded-full"
            style={{ background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))" }}
          />
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Nuevo Lote de Producción</h1>
        </div>
        <p className="text-sm text-[var(--color-text-muted)] ml-4">Crear un nuevo lote a partir de una receta</p>
      </div>

      <Link href="/app/master/production/batches" className="text-sm text-[var(--color-master-600)] hover:underline">
        ← Volver a lotes
      </Link>

      {error && (
        <div className="bg-[var(--color-danger-50)] border border-[var(--color-danger-200)] rounded-lg p-3 text-sm text-[var(--color-danger-700)]">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--color-text-soft)]">Cargando datos...</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6 bg-[var(--color-surface)] rounded-xl border p-6 shadow-sm">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Receta *</label>
            <select
              value={recipeId}
              onChange={(e) => setRecipeId(e.target.value)}
              required
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-master-500)] focus:border-[var(--color-master-500)]"
            >
              <option value="">Seleccionar receta...</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name} ({r.expectedQuantity} {r.expectedUnit}/lote)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Sucursal *</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              required
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-master-500)] focus:border-[var(--color-master-500)]"
            >
              <option value="">Seleccionar sucursal...</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              Cantidad Planeada * {selectedRecipe && <span className="text-[var(--color-text-soft)]">({selectedRecipe.expectedUnit})</span>}
            </label>
            <input
              type="number"
              value={plannedQuantity}
              onChange={(e) => setPlannedQuantity(e.target.value)}
              required
              min="0.01"
              step="any"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-master-500)] focus:border-[var(--color-master-500)]"
              placeholder={selectedRecipe ? String(selectedRecipe.expectedQuantity) : "1000"}
            />
          </div>

          {/* Show planned inputs */}
          {selectedRecipe && multiplier > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">Insumos Planeados</h3>
              <div className="bg-[var(--color-surface-alt)] rounded-lg p-3 space-y-1.5">
                {selectedRecipe.inputs.map((inp, idx) => {
                  const needed = Math.round(inp.quantity * multiplier * 100) / 100;
                  return (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-[var(--color-text)]">{inp.inputProduct.name}</span>
                      <span className="text-[var(--color-text-muted)] font-medium">
                        {needed.toLocaleString()} {inp.unit}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-[var(--color-text-soft)] mt-1">
                Multiplicador: {multiplier.toFixed(2)}x respecto a la receta base
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Notas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-master-500)] focus:border-[var(--color-master-500)]"
              rows={2}
              placeholder="Notas opcionales..."
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-[var(--color-master-600)] text-white rounded-lg text-sm font-medium hover:bg-[var(--color-master-700)] disabled:opacity-50 transition"
            >
              {saving ? "Creando..." : "Crear Lote (Borrador)"}
            </button>
            <Link
              href="/app/master/production/batches"
              className="px-6 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] rounded-lg text-sm font-medium hover:bg-[var(--color-surface-alt)] transition"
            >
              Cancelar
            </Link>
          </div>
        </form>
      )}
    </section>
  );
}
