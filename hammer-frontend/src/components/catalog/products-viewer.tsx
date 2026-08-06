"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCcw, Search } from "lucide-react";

type Product = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  isActive: boolean;
  standardSalePrice: string;
  category: { name: string };
};

type ApiListResponse<T> = { data?: T[]; message?: string; error?: string; reason?: string };

function extractApiError(payload?: { message?: string; error?: string; reason?: string }, fallback?: string) {
  return payload?.message ?? payload?.error ?? payload?.reason ?? fallback ?? "No se pudo completar la operación.";
}

export function ProductsViewer() {
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [errorState, setErrorState] = useState<string | null>(null);

  const loadProducts = useCallback(async (search: string, mode: "initial" | "search" | "refresh" = "refresh") => {
    if (mode === "search") setSearching(true);
    else setLoading(true);

    try {
      const query = search.trim();
      const response = await fetch(`/api/catalog/products${query ? `?q=${encodeURIComponent(query)}` : ""}`);
      const payload = (await response.json()) as ApiListResponse<Product>;

      if (!response.ok) {
        throw new Error(extractApiError(payload, "No se pudieron cargar los productos."));
      }

      setProducts(payload.data ?? []);
    } finally {
      if (mode === "search") setSearching(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    setInitialLoading(true);
    setErrorState(null);

    loadProducts("", "initial")
      .catch((error) => setErrorState(error instanceof Error ? error.message : "No se pudieron cargar los productos."))
      .finally(() => setInitialLoading(false));
  }, [loadProducts]);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    setErrorState(null);

    try {
      await loadProducts(q, "search");
    } catch (error) {
      setErrorState(error instanceof Error ? error.message : "No se pudo ejecutar la búsqueda.");
    }
  }

  return (
    <section className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Consulta de Productos</h2>
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-soft)]">
            {initialLoading ? <span>Inicializando catálogo...</span> : null}
            {loading ? <span>Actualizando productos...</span> : null}
          </div>
        </div>

        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleSearch}>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-soft)]" />
            <Input
              className="pl-9"
              placeholder="Buscar por SKU o nombre"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              disabled={initialLoading || searching}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" loading={searching} disabled={initialLoading} icon={<Search className="h-4 w-4" />}>
              Buscar
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={loading || searching}
              onClick={() => loadProducts(q, "refresh").catch((error) => setErrorState(error instanceof Error ? error.message : "No se pudo refrescar."))}
              icon={<RefreshCcw className="h-4 w-4" />}
            >
              Refrescar
            </Button>
          </div>
        </form>
      </Card>

      {errorState ? (
        <Card className="border-[var(--color-danger-300)] bg-[var(--color-danger-50)] p-3 text-sm text-[var(--color-danger-700)]">
          {errorState}
        </Card>
      ) : null}

      <Card noPadding>
        <div className="overflow-x-auto">
          <table className="min-w-[720px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-soft)]">
                <th className="px-3 py-3">SKU</th>
                <th className="px-3 py-3">Nombre</th>
                <th className="px-3 py-3">Categoría</th>
                <th className="px-3 py-3">Unidad</th>
                <th className="px-3 py-3">Precio</th>
                <th className="px-3 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {initialLoading ? (
                <tr>
                  <td className="px-3 py-8 text-center text-[var(--color-text-soft)]" colSpan={6}>
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Cargando productos...
                    </span>
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-[var(--color-text-soft)]" colSpan={6}>
                    No hay productos para los filtros actuales.
                  </td>
                </tr>
              ) : (
                products.map((item) => (
                  <tr key={item.id} className="border-b border-[var(--color-border)]">
                    <td className="px-3 py-3 font-medium text-[var(--color-text)]">{item.sku}</td>
                    <td className="px-3 py-3">{item.name}</td>
                    <td className="px-3 py-3">{item.category?.name ?? "—"}</td>
                    <td className="px-3 py-3">{item.unit}</td>
                    <td className="px-3 py-3">{item.standardSalePrice}</td>
                    <td className="px-3 py-3">
                      <Badge variant={item.isActive ? "success" : "warning"}>{item.isActive ? "Activo" : "Inactivo"}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
