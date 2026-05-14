"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Search, RefreshCcw } from "lucide-react";
import { apiFetch } from "@/lib/client/api";

type Product = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  isActive: boolean;
  standardSalePrice: string;
  category: { name: string };
};

type Category = { id: string; name: string };

type ApiListResponse<T> = { data?: T[]; message?: string; error?: string; reason?: string };
type ApiItemResponse<T> = { data?: T; message?: string; error?: string; reason?: string };

const DEFAULT_FORM = {
  sku: "",
  name: "",
  unit: "UN",
  categoryId: "",
  standardSalePrice: "1",
};

function extractApiError(payload?: { message?: string; error?: string; reason?: string }, fallback?: string) {
  return payload?.message ?? payload?.error ?? payload?.reason ?? fallback ?? "No se pudo completar la operación.";
}

export function ProductsAdmin() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [q, setQ] = useState("");

  const [initialLoading, setInitialLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rowActionLoading, setRowActionLoading] = useState<Record<string, boolean>>({});
  const [errorState, setErrorState] = useState<string | null>(null);
  const [successFeedback, setSuccessFeedback] = useState<string | null>(null);

  const hasCategories = categories.length > 0;

  const updateForm = useCallback((field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const loadProducts = useCallback(async (search: string, mode: "initial" | "search" | "refresh" = "refresh") => {
    if (mode === "search") setSearching(true);
    else setProductsLoading(true);

    try {
      const query = search.trim();
      const response = await apiFetch(`/api/catalog/products${query ? `?q=${encodeURIComponent(query)}` : ""}`);
      const payload = (await response.json()) as ApiListResponse<Product>;

      if (!response.ok) {
        throw new Error(extractApiError(payload, "No se pudieron cargar los productos."));
      }

      setProducts(payload.data ?? []);
    } finally {
      if (mode === "search") setSearching(false);
      else setProductsLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);

    try {
      const response = await apiFetch("/api/catalog/categories");
      const payload = (await response.json()) as ApiListResponse<Category>;

      if (!response.ok) {
        throw new Error(extractApiError(payload, "No se pudieron cargar las categorías."));
      }

      const nextCategories = payload.data ?? [];
      setCategories(nextCategories);
      setForm((prev) => ({
        ...prev,
        categoryId: prev.categoryId || nextCategories[0]?.id || "",
      }));
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    setInitialLoading(true);
    setErrorState(null);

    try {
      await Promise.all([
        loadProducts("", "initial"),
        loadCategories(),
      ]);
    } catch (error) {
      setErrorState(error instanceof Error ? error.message : "No se pudo preparar el catálogo de productos.");
    } finally {
      setInitialLoading(false);
    }
  }, [loadCategories, loadProducts]);

  useEffect(() => {
    loadInitialData().catch(() => setErrorState("No se pudo preparar el catálogo de productos."));
  }, [loadInitialData]);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    setErrorState(null);
    setSuccessFeedback(null);

    try {
      await loadProducts(q, "search");
    } catch (error) {
      setErrorState(error instanceof Error ? error.message : "No se pudo ejecutar la búsqueda.");
    }
  }

  async function createProduct(event: React.FormEvent) {
    event.preventDefault();
    if (!hasCategories) {
      setErrorState("Debes tener al menos una categoría activa para crear productos.");
      return;
    }

    setSaving(true);
    setErrorState(null);
    setSuccessFeedback(null);

    try {
      const response = await apiFetch("/api/catalog/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          standardSalePrice: Number(form.standardSalePrice),
          allowsFraction: false,
          isTimber: false,
        }),
      });
      const payload = (await response.json()) as ApiItemResponse<Product>;

      if (!response.ok) {
        throw new Error(extractApiError(payload, "No se pudo crear el producto."));
      }

      setForm((prev) => ({ ...DEFAULT_FORM, categoryId: prev.categoryId }));
      setSuccessFeedback(`Producto creado: ${form.name}.`);
      await loadProducts(q, "refresh");
    } catch (error) {
      setErrorState(error instanceof Error ? error.message : "No se pudo crear el producto.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(item: Product) {
    setRowActionLoading((prev) => ({ ...prev, [item.id]: true }));
    setErrorState(null);
    setSuccessFeedback(null);

    try {
      const response = await apiFetch(`/api/catalog/products/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      const payload = (await response.json()) as ApiItemResponse<Product>;

      if (!response.ok) {
        throw new Error(extractApiError(payload, "No se pudo actualizar el estado del producto."));
      }

      setSuccessFeedback(`${item.name} ${item.isActive ? "desactivado" : "activado"} correctamente.`);
      await loadProducts(q, "refresh");
    } catch (error) {
      setErrorState(error instanceof Error ? error.message : "No se pudo cambiar el estado del producto.");
    } finally {
      setRowActionLoading((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  async function cleanupProduct(item: Product) {
    setRowActionLoading((prev) => ({ ...prev, [item.id]: true }));
    setErrorState(null);
    setSuccessFeedback(null);

    try {
      const response = await apiFetch(`/api/master/catalog/products/${item.id}/cleanup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "AUTO" }),
      });
      const payload = (await response.json()) as { data?: { action?: string }; message?: string; error?: string; reason?: string };

      if (!response.ok) {
        throw new Error(extractApiError(payload, "No se pudo depurar producto."));
      }

      const action = payload.data?.action === "DELETED" ? "eliminado definitivamente" : "archivado/desactivado";
      setSuccessFeedback(`${item.name} ${action} según política de historial.`);
      await loadProducts(q, "refresh");
    } catch (error) {
      setErrorState(error instanceof Error ? error.message : "No se pudo depurar producto.");
    } finally {
      setRowActionLoading((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  const isBusy = useMemo(
    () => saving || productsLoading || searching || Object.values(rowActionLoading).some(Boolean),
    [saving, productsLoading, searching, rowActionLoading],
  );

  return (
    <section className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Gestión de Productos</h2>
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-soft)]">
            {initialLoading ? <span>Inicializando catálogo...</span> : null}
            {productsLoading ? <span>Actualizando productos...</span> : null}
            {categoriesLoading ? <span>Cargando categorías...</span> : null}
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
              disabled={isBusy}
              onClick={() => loadProducts(q, "refresh").catch((error) => setErrorState(error instanceof Error ? error.message : "No se pudo refrescar."))}
              icon={<RefreshCcw className="h-4 w-4" />}
            >
              Refrescar
            </Button>
          </div>
        </form>
      </Card>

      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">Crear producto</h3>
        <form className="grid gap-2 md:grid-cols-6" onSubmit={createProduct}>
          <Input placeholder="SKU" value={form.sku} onChange={(e) => updateForm("sku", e.target.value)} required disabled={saving || initialLoading} />
          <Input placeholder="Nombre" value={form.name} onChange={(e) => updateForm("name", e.target.value)} required disabled={saving || initialLoading} />
          <select
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            value={form.categoryId}
            onChange={(e) => updateForm("categoryId", e.target.value)}
            required
            disabled={saving || initialLoading || categoriesLoading || !hasCategories}
          >
            {!hasCategories ? <option value="">Sin categorías disponibles</option> : null}
            {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
          <Input placeholder="Unidad" value={form.unit} onChange={(e) => updateForm("unit", e.target.value)} required disabled={saving || initialLoading} />
          <Input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Precio"
            value={form.standardSalePrice}
            onChange={(e) => updateForm("standardSalePrice", e.target.value)}
            required
            disabled={saving || initialLoading}
          />
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={initialLoading || categoriesLoading || !hasCategories}
            className="md:col-span-6"
            icon={<Plus className="h-4 w-4" />}
          >
            Crear producto
          </Button>
        </form>
      </Card>

      {errorState ? (
        <Card className="border-[var(--color-danger-300)] bg-[var(--color-danger-50)] p-3 text-sm text-[var(--color-danger-700)]">
          {errorState}
        </Card>
      ) : null}

      {successFeedback ? (
        <Card className="border-[var(--color-success-300)] bg-[var(--color-success-50)] p-3 text-sm text-[var(--color-success-700)]">
          {successFeedback}
        </Card>
      ) : null}

      <Card noPadding>
        <div className="overflow-x-auto">
          <table className="min-w-[780px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-soft)]">
                <th className="px-3 py-3">SKU</th>
                <th className="px-3 py-3">Nombre</th>
                <th className="px-3 py-3">Categoría</th>
                <th className="px-3 py-3">Unidad</th>
                <th className="px-3 py-3">Precio</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {initialLoading ? (
                <tr>
                  <td className="px-3 py-8 text-center text-[var(--color-text-soft)]" colSpan={7}>
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Cargando productos...
                    </span>
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-[var(--color-text-soft)]" colSpan={7}>
                    No hay productos para los filtros actuales.
                  </td>
                </tr>
              ) : (
                products.map((item) => {
                  const rowBusy = rowActionLoading[item.id] ?? false;
                  return (
                    <tr key={item.id} className="border-b border-[var(--color-border)]">
                      <td className="px-3 py-3 font-medium text-[var(--color-text)]">{item.sku}</td>
                      <td className="px-3 py-3">{item.name}</td>
                      <td className="px-3 py-3">{item.category?.name ?? "—"}</td>
                      <td className="px-3 py-3">{item.unit}</td>
                      <td className="px-3 py-3">{item.standardSalePrice}</td>
                      <td className="px-3 py-3">
                        <Badge variant={item.isActive ? "success" : "warning"}>{item.isActive ? "Activo" : "Inactivo"}</Badge>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant={item.isActive ? "secondary" : "primary"}
                            size="sm"
                            loading={rowBusy}
                            disabled={rowBusy || saving}
                            onClick={() => {
                              if (item.isActive && !confirm(`¿Desactivar ${item.name}?`)) return;
                              toggle(item);
                            }}
                          >
                            {item.isActive ? "Desactivar" : "Activar"}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={rowBusy}
                            disabled={rowBusy || saving}
                            onClick={() => {
                              if (!confirm("¿Depurar producto? Si tiene historial se desactivará, si no tiene historial se eliminará.")) return;
                              cleanupProduct(item);
                            }}
                          >
                            Depurar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
