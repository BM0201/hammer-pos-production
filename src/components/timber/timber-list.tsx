"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Trash2,
  Edit2,
  TreePine,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { apiFetch } from "@/lib/client/api";

type TimberItem = {
  id: string;
  timberType: string;
  thickness: { toString(): string };
  width: { toString(): string };
  length: { toString(): string };
  varaLength?: number;
  boardFeet: { toString(): string };
  baseCost: { toString(): string };
  sellingPrice: { toString(): string };
  product: {
    id: string;
    name: string;
    sku: string;
    isActive: boolean;
    category: { name: string };
  };
};

/** Conversion map: internal vara lengths → display pies */
const VARA_TO_PIES: Record<number, number> = { 16: 6, 14: 5, 11: 4, 8: 3 };

type TimberListData = {
  items: TimberItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export function TimberList() {
  const router = useRouter();
  const [data, setData] = useState<TimberListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (typeFilter) params.set("timberType", typeFilter);
      params.set("page", String(page));
      params.set("limit", "15");

      const res = await apiFetch(`/api/timber?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        setError("Error al cargar productos de madera");
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("¿Está seguro de eliminar este producto de madera?")) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await apiFetch(`/api/timber/${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Error al eliminar producto");
      }
    } catch {
      setError("Error de conexión al eliminar");
    } finally {
      setDeletingId(null);
    }
  }, [fetchData]);

  const calcMargin = (baseCost: string, sellingPrice: string) => {
    const bc = parseFloat(baseCost);
    const sp = parseFloat(sellingPrice);
    if (sp === 0) return "0";
    return (((sp - bc) / sp) * 100).toFixed(1);
  };

  const timberBadgeVariant = (type: string): "success" | "info" | "warning" => {
    if (type === "TABLA") return "success";
    if (type === "TABLILLA") return "info";
    return "warning";
  };

  return (
    <div className="space-y-4">
      {/* Error notification */}
      {error && (
        <div className="hm-alert hm-alert-danger">
          <span></span> {error}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-soft)]" />
            <Input
              type="text"
              className="pl-9"
              placeholder="Buscar por nombre o SKU..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <select
            className="hm-input w-auto min-w-[140px]"
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          >
            <option value="">Todos los tipos</option>
            <option value="TABLA">Tabla</option>
            <option value="TABLILLA">Tablilla</option>
            <option value="CUADRO">Cuadro</option>
          </select>
        </div>

        <Link href="/app/master/timber/new">
          <Button variant="primary" icon={<Plus className="h-4 w-4" />}>
            Nuevo Producto
          </Button>
        </Link>
      </div>

      {/* Table */}
      <Card noPadding>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--color-text-soft)]" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="text-center py-12 px-4">
            <TreePine className="h-10 w-10 mx-auto mb-3 text-[var(--color-text-soft)] opacity-30" />
            <p className="text-sm font-medium text-[var(--color-text-muted)]">
              {search || typeFilter ? "No se encontraron productos" : "No hay productos de madera"}
            </p>
            <p className="text-xs text-[var(--color-text-soft)] mt-1">
              {!search && !typeFilter && "Crea tu primer producto de madera con el botón de arriba."}
            </p>
          </div>
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Producto</TH>
                  <TH>Tipo</TH>
                  <TH className="text-center">Dimensiones</TH>
                  <TH className="text-right">Pies</TH>
                  <TH className="text-right">Costo Base</TH>
                  <TH className="text-right">Precio Venta</TH>
                  <TH className="text-right">Margen</TH>
                  <TH className="text-center">Acciones</TH>
                </TR>
              </THead>
              <TBody>
                {data.items.map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-warehouse-50)] text-[var(--color-warehouse-700)]">
                          <TreePine className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium text-[var(--color-text)] truncate">{item.product.name}</p>
                          <p className="text-[0.65rem] text-[var(--color-text-soft)]">{item.product.sku}</p>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <Badge variant={timberBadgeVariant(item.timberType)}>
                        {item.timberType}
                      </Badge>
                    </TD>
                    <TD className="text-center">
                      <span className="font-mono text-xs">
                        {item.thickness.toString()}&quot;×{item.width.toString()}&quot;×{item.varaLength ?? VARA_TO_PIES[parseInt(item.length.toString())] ?? item.length.toString()} pies
                      </span>
                    </TD>
                    <TD className="text-right font-mono">{parseFloat(item.boardFeet.toString()).toFixed(2)}</TD>
                    <TD className="text-right font-mono">C${parseFloat(item.baseCost.toString()).toFixed(2)}</TD>
                    <TD className="text-right font-mono font-semibold text-[var(--color-warehouse-700)]">
                      C${parseFloat(item.sellingPrice.toString()).toFixed(2)}
                    </TD>
                    <TD className="text-right">
                      <Badge variant="success">
                        {calcMargin(item.baseCost.toString(), item.sellingPrice.toString())}%
                      </Badge>
                    </TD>
                    <TD>
                      <div className="flex items-center justify-center gap-1">
                        <Link href={`/app/master/timber/${item.id}/edit`}>
                          <Button variant="ghost" size="sm" title="Editar">
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-[var(--color-danger-600)] hover:text-[var(--color-danger-700)]"
                          title="Eliminar"
                          onClick={() => handleDelete(item.id)}
                          disabled={deletingId === item.id}
                        >
                          {deletingId === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {/* Pagination */}
            {data.totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-text-muted)]">
                  {data.total} productos · Página {data.page} de {data.totalPages}
                </p>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page >= data.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
