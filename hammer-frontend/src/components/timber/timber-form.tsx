"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { calculateTimber } from "@/modules/timber/calculator";
import { Save, TreePine, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

type TimberFormProps = {
  categories: Array<{ id: string; name: string }>;
  initialData?: {
    id?: string;
    name: string;
    thickness: number;
    width: number;
    length: number;
    categoryId?: string;
  };
  mode: "create" | "edit";
};

export function TimberForm({ categories, initialData, mode }: TimberFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initialData?.name ?? "");
  const [thickness, setThickness] = useState(String(initialData?.thickness ?? "1"));
  const [width, setWidth] = useState(String(initialData?.width ?? "12"));
  const [length, setLength] = useState(String(initialData?.length ?? "16"));
  const [categoryId, setCategoryId] = useState(initialData?.categoryId ?? "");

  // Real-time calculation preview
  const preview = useMemo(() => {
    const t = parseFloat(thickness);
    const w = parseFloat(width);
    const l = parseFloat(length);
    if (!t || !w || !l || t <= 0 || w <= 0 || l <= 0) return null;
    return calculateTimber({ thickness: t, width: w, length: l });
  }, [thickness, width, length]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        thickness: parseFloat(thickness),
        width: parseFloat(width),
        length: parseFloat(length),
      };

      // BUG FIX: Validate categoryId in create mode before sending request
      if (mode === "create" && !categoryId) {
        setError("Debe seleccionar una categoría");
        setLoading(false);
        return;
      }

      if (mode === "create") {
        body.categoryId = categoryId;
        const res = await apiFetch("/api/timber", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = unwrapApiData(await res.json());
          throw new Error(data.error || "Error al crear producto");
        }
      } else {
        const res = await apiFetch(`/api/timber/${initialData?.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = unwrapApiData(await res.json());
          throw new Error(data.error || "Error al actualizar producto");
        }
      }

      router.push("/app/master/timber");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [name, thickness, width, length, categoryId, mode, initialData, router]);

  const previewBadgeVariant = (group: string): "success" | "info" | "warning" => {
    if (group === "TABLA") return "success";
    if (group === "TABLILLA") return "info";
    return "warning";
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-lg border-l-4 border-[var(--color-danger-500)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Product info */}
      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">Información del Producto</h3>

        <Input
          label="Nombre del producto"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Tabla 1×12×16"
          required
        />

        {mode === "create" && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
              Categoría
            </label>
            <select
              className="w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-[var(--color-text)] placeholder-[var(--color-text-soft)] focus:ring-2 focus:ring-[var(--color-info-500)] focus:border-[var(--color-info-500)] transition-colors min-h-[44px]"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
            >
              <option value="">Seleccionar categoría...</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </Card>

      {/* Dimensions */}
      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">Dimensiones</h3>

        <div className="grid grid-cols-3 gap-4">
          <Input
            label="Grosor (pulgadas)"
            type="number"
            value={thickness}
            onChange={(e) => setThickness(e.target.value)}
            min="0.25"
            step="0.25"
            required
          />
          <Input
            label="Ancho (pulgadas)"
            type="number"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            min="1"
            step="1"
            required
          />
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
              Largo (pies)
            </label>
            <select
              className="w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-[var(--color-text)] placeholder-[var(--color-text-soft)] focus:ring-2 focus:ring-[var(--color-info-500)] focus:border-[var(--color-info-500)] transition-colors min-h-[44px]"
              value={length}
              onChange={(e) => setLength(e.target.value)}
              required
            >
              <option value="8">3 pies</option>
              <option value="11">4 pies</option>
              <option value="14">5 pies</option>
              <option value="16">6 pies</option>
            </select>
          </div>
        </div>

        {/* Live preview */}
        {preview && (
          <Card variant="outlined" className="mt-4 border-[var(--color-warehouse-200)] bg-[var(--color-warehouse-50)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <TreePine className="h-4 w-4 text-[var(--color-warehouse-600)]" />
              <span className="text-xs font-semibold text-[var(--color-warehouse-700)]">
                Preview de cálculo
              </span>
              <Badge variant={previewBadgeVariant(preview.priceGroup)}>
                {preview.priceGroup}
              </Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <span className="text-[var(--color-text-muted)] text-xs">Pies tablares:</span>
                <p className="font-semibold">{preview.boardFeet}</p>
              </div>
              <div>
                <span className="text-[var(--color-text-muted)] text-xs">Costo base:</span>
                <p className="font-semibold">C${preview.baseCost.toFixed(2)}</p>
              </div>
              <div>
                <span className="text-[var(--color-text-muted)] text-xs">Precio venta:</span>
                <p className="font-bold text-[var(--color-warehouse-700)]">C${preview.sellingPrice.toFixed(2)}</p>
              </div>
              <div>
                <span className="text-[var(--color-text-muted)] text-xs">Margen:</span>
                <p className="font-bold text-[var(--color-success-700)]">{(preview.marginPercent * 100).toFixed(1)}%</p>
              </div>
            </div>
          </Card>
        )}
      </Card>

      {/* Submit */}
      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.back()}
          disabled={loading}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={loading}
          loading={loading}
          icon={!loading ? <Save className="h-4 w-4" /> : undefined}
        >
          {mode === "create" ? "Crear Producto" : "Guardar Cambios"}
        </Button>
      </div>
    </form>
  );
}
