"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

type Product = { id: string; sku: string; name: string; unit: string };

type RecipeInputRow = {
  inputProductId: string;
  quantity: string;
  unit: string;
  notes: string;
};

const emptyInput = (): RecipeInputRow => ({
  inputProductId: "",
  quantity: "",
  unit: "",
  notes: "",
});

export default function NewRecipePage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [finishedProductId, setFinishedProductId] = useState("");
  const [expectedQuantity, setExpectedQuantity] = useState("");
  const [expectedUnit, setExpectedUnit] = useState("unidad");
  const [targetMarginPct, setTargetMarginPct] = useState("");
  const [inputs, setInputs] = useState<RecipeInputRow[]>([emptyInput()]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/catalog/products?isActive=true");
        if (!res.ok) throw new Error("No se pudo cargar productos");
        const data = unwrapApiData(await res.json());
        const list = Array.isArray(data) ? data : (data as { products: Product[] }).products ?? [];
        if (!cancelled) setProducts(list);
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoadingProducts(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const addInput = useCallback(() => {
    setInputs((prev) => [...prev, emptyInput()]);
  }, []);

  const removeInput = useCallback((idx: number) => {
    setInputs((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateInput = useCallback(
    (idx: number, field: keyof RecipeInputRow, value: string) => {
      setInputs((prev) => prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
    },
    [],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const body = {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        description: description.trim() || null,
        finishedProductId,
        expectedQuantity: parseFloat(expectedQuantity),
        expectedUnit: expectedUnit.trim(),
        targetMarginPct: targetMarginPct ? parseFloat(targetMarginPct) / 100 : null,
        inputs: inputs
          .filter((i) => i.inputProductId && i.quantity)
          .map((i) => ({
            inputProductId: i.inputProductId,
            quantity: parseFloat(i.quantity),
            unit: i.unit.trim() || "unidad",
            notes: i.notes.trim() || null,
          })),
      };

      if (body.inputs.length === 0) {
        setError("Agrega al menos un insumo.");
        setSaving(false);
        return;
      }

      const res = await apiFetch("/api/master/production/recipes", {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(
          errData?.error?.message ?? errData?.message ?? "Error al crear receta",
        );
      }

      router.push("/app/master/production/recipes");
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
          <h1 className="text-2xl font-bold text-gray-900">Nueva Receta de Material</h1>
        </div>
        <p className="text-sm text-gray-500 ml-4">Selecciona el producto terminado y sus insumos desde catalogo.</p>
      </div>

      <Link href="/app/master/production/recipes" className="text-sm text-indigo-600 hover:underline">
        ← Volver a recetas
      </Link>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 bg-white rounded-xl border p-6 shadow-sm">
        {/* Basic info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Bloque 10x20x40 Estándar"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Código *</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono uppercase focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="BLOQUE-10X20X40-STD"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Descripción</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            rows={2}
            placeholder="Descripción opcional..."
          />
        </div>

        {/* Finished product */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Producto Terminado *</label>
          <select
            value={finishedProductId}
            onChange={(e) => setFinishedProductId(e.target.value)}
            required
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">Seleccionar producto...</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} — {p.name}
              </option>
            ))}
          </select>
          {loadingProducts && <p className="text-xs text-gray-400 mt-1">Cargando productos...</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Cantidad Esperada *</label>
            <input
              type="number"
              value={expectedQuantity}
              onChange={(e) => setExpectedQuantity(e.target.value)}
              required
              min="0.01"
              step="any"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="1000"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Unidad *</label>
            <input
              type="text"
              value={expectedUnit}
              onChange={(e) => setExpectedUnit(e.target.value)}
              required
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="unidad"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Margen Objetivo (%)</label>
            <input
              type="number"
              value={targetMarginPct}
              onChange={(e) => setTargetMarginPct(e.target.value)}
              min="0"
              max="100"
              step="any"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="30"
            />
          </div>
        </div>

        {/* Inputs / Insumos */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">Insumos</h3>
            <button
              type="button"
              onClick={addInput}
              className="text-xs text-indigo-600 hover:underline"
            >
              + Agregar insumo
            </button>
          </div>

          <div className="space-y-3">
            {inputs.map((row, idx) => (
              <div key={idx} className="flex gap-2 items-end">
                <div className="flex-1">
                  {idx === 0 && <label className="block text-xs text-gray-500 mb-1">Producto</label>}
                  <select
                    value={row.inputProductId}
                    onChange={(e) => updateInput(idx, "inputProductId", e.target.value)}
                    required
                    className="w-full border rounded-lg px-2 py-1.5 text-sm"
                  >
                    <option value="">Seleccionar...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-24">
                  {idx === 0 && <label className="block text-xs text-gray-500 mb-1">Cantidad</label>}
                  <input
                    type="number"
                    value={row.quantity}
                    onChange={(e) => updateInput(idx, "quantity", e.target.value)}
                    required
                    min="0.01"
                    step="any"
                    className="w-full border rounded-lg px-2 py-1.5 text-sm"
                    placeholder="50"
                  />
                </div>
                <div className="w-24">
                  {idx === 0 && <label className="block text-xs text-gray-500 mb-1">Unidad</label>}
                  <input
                    type="text"
                    value={row.unit}
                    onChange={(e) => updateInput(idx, "unit", e.target.value)}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm"
                    placeholder="bolsa"
                  />
                </div>
                {inputs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeInput(idx)}
                    className="text-red-400 hover:text-red-600 text-xs pb-1"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
          >
            {saving ? "Guardando..." : "Crear Receta"}
          </button>
          <Link
            href="/app/master/production/recipes"
            className="px-6 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </section>
  );
}
