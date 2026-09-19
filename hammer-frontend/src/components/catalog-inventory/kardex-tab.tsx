"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  Calendar,
  Filter,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { money, qty, fmtDateTime } from "@/lib/format";
import { movementLabel, isInboundMovement, isOutboundMovement, MovementIcon } from "@/components/catalog-inventory/movement-history-helpers";
import type { ProductDetail } from "@/components/catalog-inventory/product-360";

/**
 * Fase 5 (prompt-flujo-velocidad.md): extraído de product-360.tsx (era la
 * pestaña "movements", ~215 líneas) para poder cargarlo con next/dynamic —
 * solo se monta cuando el usuario abre esa pestaña, no en cada visita a la
 * ficha de producto. Mismo comportamiento, mismo componente, solo movido.
 */

type KardexMovement = ProductDetail["product"]["inventoryMovements"][number] & {
  notes?: string | null;
  product?: { id: string; sku: string; name: string };
};
type MovementPagination = { page: number; limit: number; total: number; totalPages: number };

export function KardexTab({
  productId,
  fallbackMovements,
}: {
  productId: string;
  fallbackMovements: ProductDetail["product"]["inventoryMovements"];
}) {
  const [movements, setMovements] = useState<KardexMovement[]>(fallbackMovements);
  const [pagination, setPagination] = useState<MovementPagination>({ page: 1, limit: 30, total: fallbackMovements.length, totalPages: 1 });
  const [filterBranch, setFilterBranch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);

  const loadMovements = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filterBranch) params.set("branchId", filterBranch);
      if (filterType) params.set("movementType", filterType);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const response = await fetch(`/api/master/catalog-inventory/products/${productId}/movements?${params}`, { cache: "no-store" });
      const raw = await response.json();
      if (!response.ok) throw new Error(raw?.error?.message ?? raw?.message ?? "No se pudo cargar Kardex.");
      const payload = raw.data as { rows: KardexMovement[]; pagination: MovementPagination };
      setMovements(payload.rows);
      setPagination(payload.pagination);
    } catch {
      setMovements(fallbackMovements);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, fallbackMovements, filterBranch, filterType, limit, page, productId]);

  useEffect(() => {
    void loadMovements();
  }, [loadMovements]);

  const branches = [...new Map([...fallbackMovements, ...movements].map((m) => [m.branch.id, m.branch])).values()].sort((a, b) => a.code.localeCompare(b.code));
  const types = [...new Set([...fallbackMovements, ...movements].map((m) => m.movementType))].sort();

  const sorted = [...movements].sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return sortAsc ? diff : -diff;
  });

  // Totals
  const totalEntries = sorted.filter((m) => isInboundMovement(m.movementType)).length;
  const totalExits = sorted.filter((m) => isOutboundMovement(m.movementType)).length;

  return (
    <div className="space-y-4">
      {/* ── Filters + Summary ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Branch filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-[var(--color-text-muted)]" />
          <select
            value={filterBranch}
            onChange={(e) => { setFilterBranch(e.target.value); setPage(1); }}
            className="hm-input !w-auto !py-1.5 !px-3 !text-sm"
          >
            <option value="">Todas las sucursales</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.code}</option>
            ))}
          </select>
        </div>
        {/* Type filter */}
        <select
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
          className="hm-input !w-auto !py-1.5 !px-3 !text-sm"
        >
          <option value="">Todos los tipos</option>
          {types.map((t) => {
            const lbl = movementLabel(t);
            return <option key={t} value={t}>{lbl.label}</option>;
          })}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="hm-input !w-auto !py-1.5 !px-3 !text-sm" />
        <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="hm-input !w-auto !py-1.5 !px-3 !text-sm" />
        <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} className="hm-input !w-auto !py-1.5 !px-3 !text-sm">
          <option value="30">30</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>

        {/* Sort toggle */}
        <button
          onClick={() => setSortAsc(!sortAsc)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-[var(--color-text-secondary)] bg-[var(--color-surface-alt)] hover:bg-[var(--color-surface-muted)] transition-colors border border-[var(--color-border)]"
        >
          <Calendar className="h-3.5 w-3.5" />
          {sortAsc ? "Antiguos primero" : "Recientes primero"}
          {sortAsc ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {/* Summary pills */}
        <div className="ml-auto flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-bold text-emerald-700">
            <TrendingUp className="h-3 w-3" /> {totalEntries} entradas
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-3 py-1 text-xs font-bold text-red-700">
            <TrendingDown className="h-3 w-3" /> {totalExits} salidas
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-300 px-3 py-1 text-xs font-bold text-slate-700">
            {pagination.total} total
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
        <span>Pagina {pagination.page} de {pagination.totalPages}{loading ? " · cargando..." : ""}</span>
        <div className="flex items-center gap-2">
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-md border border-[var(--color-border)] px-2 py-1 disabled:opacity-40">Anterior</button>
          <button type="button" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-[var(--color-border)] px-2 py-1 disabled:opacity-40">Siguiente</button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
        <div className="hm-card-header-green px-5 py-3 flex items-center gap-2">
          <ArrowLeftRight className="h-5 w-5" />
          <h2 className="font-semibold">Kardex de Movimientos</h2>
          <span className="ml-auto text-xs opacity-80">{pagination.total} registros</span>
        </div>

        {sorted.length === 0 ? (
          <div className="p-8 text-center">
            <ArrowLeftRight className="h-10 w-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">
              No hay movimientos {filterBranch || filterType ? "con los filtros seleccionados" : "registrados"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="hm-table">
              <thead>
                <tr>
                  <th className="w-8"></th>
                  <th>Fecha</th>
                  <th>Sucursal</th>
                  <th>Tipo</th>
                  <th className="text-right">Cantidad</th>
                  <th className="text-right">Costo unit.</th>
                  <th className="text-right">Valor total</th>
                  <th>Referencia</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => {
                  const ml = movementLabel(m.movementType);
                  const isNegative = isOutboundMovement(m.movementType);
                  const qtyVal = Number(m.quantity);
                  const costVal = Number(m.unitCost);
                  const totalVal = qtyVal * costVal;
                  const refLabel = {
                    OPENING_BALANCE: "Carga inicial",
                    OPENING_BALANCE_BULK: "Carga masiva",
                    MANUAL_ADJUSTMENT: "Ajuste manual",
                    SALE: "Venta",
                    SALE_RETURN: "Devolución",
                    PURCHASE: "Compra",
                    TRANSFER: "Traslado",
                    MANUAL: "Manual",
                  }[m.referenceType] ?? m.referenceType;
                  const refShort = m.referenceId.startsWith("OPENING-BULK-")
                    ? `Lote·${m.referenceId.split("-").pop()}`
                    : m.referenceId.length > 18 ? `${m.referenceId.slice(0, 16)}…` : m.referenceId;
                  const nota = m.notes?.trim() || null;
                  return (
                    <tr key={m.id} className="group hover:bg-[var(--color-surface-alt)]">
                      <td><MovementIcon type={m.movementType} /></td>
                      <td className="whitespace-nowrap text-[var(--color-text-secondary)] text-xs">{fmtDateTime(m.createdAt)}</td>
                      <td>
                        <span className="flex items-center justify-center w-6 h-6 rounded bg-[var(--color-master-50)] text-[var(--color-master-700)] text-[10px] font-bold">
                          {m.branch.code}
                        </span>
                      </td>
                      <td><Badge variant={ml.color}>{ml.label}</Badge></td>
                      <td className={`text-right font-mono font-semibold text-sm ${isNegative ? "text-red-600" : "text-emerald-600"}`}>
                        {isNegative ? "−" : "+"}{qty(qtyVal)}
                      </td>
                      <td className="text-right font-mono text-xs text-[var(--color-text-secondary)]">{money(costVal)}</td>
                      <td className="text-right font-mono text-xs font-semibold text-[var(--color-text)]">{money(totalVal)}</td>
                      <td>
                        <div className="text-[11px] font-medium text-[var(--color-text-secondary)]">{refLabel}</div>
                        <div className="font-mono text-[10px] text-[var(--color-text-muted)]">{refShort}</div>
                      </td>
                      <td className="max-w-[160px]">
                        {nota ? (
                          <span className="text-xs text-[var(--color-text-secondary)] line-clamp-2" title={nota}>{nota}</span>
                        ) : (
                          <span className="text-[10px] text-[var(--color-text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
